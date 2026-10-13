// Uzun hesapların saf işleyicisi (DOM yok, Web Worker'a bağımlı değil): Çizelgeleyici paneli bu işleri bir Web Worker havuzunda çalıştırır
// (computeClient.ts), aynı işleyici testte ve Worker olmayan ortamda doğrudan çağrılır. Girdi/çıktı düz veridir (postMessage ile taşınır).
// Tüm sayılar varsayımsaldır (src/config/hypothetical.ts); sonuçlar gerçek bir görev sonucu değildir. Horizons'a erişmez; konumlar çağıranın verdiği izlerdir.
import type { Track } from '../data/types';
import { computeNetwork } from './network';
import { simulate, type Policy, type SchedConfig, type SchedTopology, type SimResult } from './scheduler';
import { hasBlackout, metricsOf, runPolicy, type Metrics } from './sweep';
import { buildLinkTimeline, restrictToRelay, schedTopology, type SweepParams } from './timeline';

/** Bir bağlantı çizelgesinin tanımı: tarih aralığı, adım, yer istasyonu sayısı, hangi aktarma uydusu. */
export interface TlSpec { startJD: number; endJD: number; stepSec: number; stations: number; relayId: string }

export interface TlInfo {
  n: number;
  /** Dünya hattının açık olduğu adımların oranı (0–1). */
  openFrac: number;
  /** Kavuşum kesintisi (earthBlackout) var mı. */
  blackout: boolean;
  /** Dünya hattının kapalı olduğu aralıklar (gün, başlangıçtan). */
  closed: [number, number][];
  topo: SchedTopology;
}

export interface CoverageRow { n: number; steps: number; see: Record<string, number>; up: Record<string, number>; surf: Record<string, number> }

export type Req =
  | { op: 'init'; tracks: Record<string, Track> }
  | { op: 'tlInfo'; tl: TlSpec }
  | { op: 'sim'; tl: TlSpec; policy: Policy; cfg: SchedConfig; full?: boolean }
  | { op: 'policy'; tl: TlSpec; cfg: SchedConfig; params: SweepParams; policy: Policy; override: Partial<SweepParams> }
  | { op: 'coverage'; startJD: number; endJD: number; n: number };
export interface SimOut { metrics: Metrics; result?: SimResult }
export type Res = { op: 'init' } | TlInfo | SimOut | Metrics | CoverageRow;

/** Durumlu işleyici: izleri ve bağlantı çizelgesi önbelleğini tutar (her Worker kendi kopyasına sahiptir). */
export function createHandler(): (req: Req) => unknown {
  let tracks: Record<string, Track> | null = null;
  const cache = new Map<string, { topo: SchedTopology; samples: ReturnType<typeof buildLinkTimeline> }>();
  const need = () => { if (!tracks) throw new Error('Hesap işleyicisi başlatılmadı: konum izleri yok.'); return tracks; };

  function timeline(s: TlSpec) {
    const key = `${s.startJD}|${s.endJD}|${s.stepSec}|${s.stations}|${s.relayId}`;
    let t = cache.get(key);
    if (!t) {
      const full = buildLinkTimeline(need(), s.startJD, s.endJD, s.stepSec, schedTopology(), s.stations);
      if (!full.length) throw new Error('Bağlantı çizelgesi boş: tarih aralığı veri dışında.');
      if (full.some((x) => [...x.surfaceDelaySec, ...x.earthDelaySec].some((v) => !Number.isFinite(v)))) throw new Error('Işık gecikmesi sayısal değil: konum verisi bozuk görünüyor.');
      t = restrictToRelay(schedTopology(), full, s.relayId);
      cache.set(key, t);
      if (cache.size > 16) cache.delete(cache.keys().next().value as string);
    }
    return t;
  }

  return (req) => {
    switch (req.op) {
      case 'init': tracks = req.tracks; cache.clear(); return { op: 'init' };
      case 'tlInfo': {
        const { topo, samples } = timeline(req.tl);
        const dt = req.tl.stepSec / 86400;
        const closed: [number, number][] = [];
        let from = -1;
        samples.forEach((x, i) => { if (!x.earthUp[0]) { if (from < 0) from = i; } else if (from >= 0) { closed.push([from * dt, i * dt]); from = -1; } });
        if (from >= 0) closed.push([from * dt, samples.length * dt]);
        const out: TlInfo = { n: samples.length, openFrac: samples.filter((x) => x.earthUp[0]).length / samples.length, blackout: hasBlackout(samples), closed, topo };
        return out;
      }
      case 'sim': {
        const { topo, samples } = timeline(req.tl);
        const result = simulate(topo, samples, req.policy, req.cfg);
        const out: SimOut = { metrics: metricsOf(result, req.cfg), ...(req.full ? { result } : {}) };
        return out;
      }
      case 'policy': {
        const { topo, samples } = timeline(req.tl);
        return runPolicy(topo, samples, req.cfg, req.params, req.policy, req.override, req.tl.relayId);
      }
      case 'coverage': {
        const see: Record<string, number> = {}, up: Record<string, number> = {}, surf: Record<string, number> = {};
        let steps = 0;
        for (let jd = req.startJD; jd < req.endJD; jd += 1 / 48) {
          steps++;
          for (const st of computeNetwork(need(), jd, req.n).statuses) {
            see[st.relay.id] = (see[st.relay.id] ?? 0) + (req.n === 0 || st.station ? 1 : 0);
            up[st.relay.id] = (up[st.relay.id] ?? 0) + (st.earthLink === 'up' ? 1 : 0);
            surf[st.asset.id] = (surf[st.asset.id] ?? 0) + (st.surfaceLink === 'up' ? 1 : 0);
          }
        }
        const out: CoverageRow = { n: req.n, steps, see, up, surf };
        return out;
      }
    }
  };
}
