// Uzun hesapların saf işleyicisi (DOM yok, Web Worker'a bağımlı değil): Çizelgeleyici paneli bu işleri bir Web Worker havuzunda çalıştırır
// (computeClient.ts), aynı işleyici testte ve Worker olmayan ortamda doğrudan çağrılır. Girdi/çıktı düz veridir (postMessage ile taşınır).
// Tüm sayılar varsayımsaldır (src/config/hypothetical.ts); sonuçlar gerçek bir görev sonucu değildir. Horizons'a erişmez; konumlar çağıranın verdiği izlerdir.
import type { Track } from '../data/types';
import { coverageRow, type CoverageRow } from './coverage';
import type { NetOptions } from './network';
import { simulate, type Policy, type SchedConfig, type SchedTopology, type SimResult } from './scheduler';
import { hasBlackout, metricsOf, runPolicy, type Metrics } from './sweep';
import { buildLinkTimeline, restrictToRelays, schedTopology, type SweepParams } from './timeline';
import { HYPOTHETICAL } from '../config/hypothetical';

/**
 * Bir bağlantı çizelgesinin tanımı: tarih aralığı, adım, yer istasyonu sayısı, hangi aktarma uydusu. net (Aşama 9): ağ seçenekleri (Ay yörüngesi, ikinci Ay uydusu,
 * Mars gölgesi, kutup aracı); yoksa Aşama 2-8 ağı. İkinci Ay uydusu seçiliyse Ay çizelgesi iki uyduyu birlikte içerir.
 */
export interface TlSpec { startJD: number; endJD: number; stepSec: number; stations: number; relayId: string; net?: NetOptions }

/** Çizelgeye giren aktarma uyduları: tek uydu (relayId) ya da ikinci Ay uydusu seçiliyse ikisi. */
export const relayIdsOf = (relayId: string, net?: NetOptions): string[] =>
  net?.moonSecond && net.moonSecond !== 'none' && HYPOTHETICAL.relays.find((r) => r.id === relayId)?.body === 'moon' ? [relayId, HYPOTHETICAL.moonRelay2.id] : [relayId];

export interface TlInfo {
  n: number;
  /** Birinci uydunun Dünya hattının açık olduğu adımların oranı (0–1). */
  openFrac: number;
  /** Aşama 9: uydu başına açık oranı (topo.relays sırasında) ve en az bir uydunun açık olduğu oranı (tek uyduda ikisi de openFrac ile aynı). */
  openFracByRelay: number[];
  openFracAny: number;
  /** Kavuşum kesintisi (earthBlackout) var mı. */
  blackout: boolean;
  /** Dünya hattının kapalı olduğu aralıklar (gün, başlangıçtan). */
  closed: [number, number][];
  topo: SchedTopology;
}

export type { CoverageRow };

export type Req =
  | { op: 'init'; tracks: Record<string, Track> }
  | { op: 'tlInfo'; tl: TlSpec }
  | { op: 'sim'; tl: TlSpec; policy: Policy; cfg: SchedConfig; full?: boolean }
  | { op: 'policy'; tl: TlSpec; cfg: SchedConfig; params: SweepParams; policy: Policy; override: Partial<SweepParams> }
  | { op: 'coverage'; startJD: number; endJD: number; n: number; net?: NetOptions };
export interface SimOut { metrics: Metrics; result?: SimResult }
export type Res = { op: 'init' } | TlInfo | SimOut | Metrics | CoverageRow;

/** Durumlu işleyici: izleri ve bağlantı çizelgesi önbelleğini tutar (her Worker kendi kopyasına sahiptir). */
export function createHandler(): (req: Req) => unknown {
  let tracks: Record<string, Track> | null = null;
  const cache = new Map<string, { topo: SchedTopology; samples: ReturnType<typeof buildLinkTimeline> }>();
  const need = () => { if (!tracks) throw new Error('Hesap işleyicisi başlatılmadı: konum izleri yok.'); return tracks; };

  function timeline(s: TlSpec) {
    const key = `${s.startJD}|${s.endJD}|${s.stepSec}|${s.stations}|${s.relayId}|${JSON.stringify(s.net ?? {})}`;
    let t = cache.get(key);
    if (!t) {
      const topo0 = schedTopology(s.net);
      const full = buildLinkTimeline(need(), s.startJD, s.endJD, s.stepSec, topo0, s.stations, s.net);
      if (!full.length) throw new Error('Bağlantı çizelgesi boş: tarih aralığı veri dışında.');
      if (full.some((x) => [...x.surfaceDelaySec, ...x.earthDelaySec].some((v) => !Number.isFinite(v)))) throw new Error('Işık gecikmesi sayısal değil: konum verisi bozuk görünüyor.');
      t = restrictToRelays(topo0, full, relayIdsOf(s.relayId, s.net));
      cache.set(key, t);
      if (cache.size > 48) cache.delete(cache.keys().next().value as string);
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
        // kapalı aralık: hiçbir uydunun Dünya hattı açık değil (tek uyduda birinci uydunun kapalı olduğu aralık)
        samples.forEach((x, i) => { if (!x.earthUp.some(Boolean)) { if (from < 0) from = i; } else if (from >= 0) { closed.push([from * dt, i * dt]); from = -1; } });
        if (from >= 0) closed.push([from * dt, samples.length * dt]);
        const out: TlInfo = {
          n: samples.length, openFrac: samples.filter((x) => x.earthUp[0]).length / samples.length,
          openFracByRelay: topo.relays.map((_, ri) => samples.filter((x) => x.earthUp[ri]).length / samples.length),
          openFracAny: samples.filter((x) => x.earthUp.some(Boolean)).length / samples.length,
          blackout: hasBlackout(samples), closed, topo,
        };
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
        return runPolicy(topo, samples, req.cfg, req.params, req.policy, req.override, req.tl.relayId, relayIdsOf(req.tl.relayId, req.tl.net).slice(1));
      }
      case 'coverage': return coverageRow(need(), req.startJD, req.endJD, req.n, req.net);
    }
  };
}
