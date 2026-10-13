import { HYPOTHETICAL } from '../config/hypothetical';
import type { Track } from '../data/types';
import { C_KM_S, dist, sample, trackEndJD } from '../map/ephemeris';
import { computeNetwork } from './network';
import type { ArqConfig, LinkSample, SchedConfig, SchedTopology, StrategyConfig } from './scheduler';

export const schedTopology = (): SchedTopology => ({
  assets: HYPOTHETICAL.assets.map((a) => ({ id: a.id, body: a.body, relay: a.relay, dataRateKbps: a.dataRateKbps })),
  relays: HYPOTHETICAL.relays.map((r) => r.id),
});

export const strategyConfig = (): StrategyConfig => {
  const { lookaheadDays, ...rest } = HYPOTHETICAL.strategy;
  return { ...rest, lookaheadSec: lookaheadDays * 86400 };
};

/** Hat modu: 'ideal' = kayıpsız hat (Aşama 3-4); 'loss' = hatalı hat, yeniden iletimsiz (maxAttempts 1); 'arq' = hatalı hat + yeniden iletim. */
export type LinkMode = 'ideal' | 'loss' | 'arq';
export const LINK_MODE_LABEL: Record<LinkMode, string> = { ideal: 'Kayıpsız hat', loss: 'Hatalı hat, yeniden iletimsiz', arq: 'Hatalı hat + yeniden iletim' };

export const arqConfig = (mode: LinkMode, earthLossPct = HYPOTHETICAL.arq.earthLossPct): ArqConfig | undefined =>
  mode === 'ideal' ? undefined : {
    surfaceLossPct: HYPOTHETICAL.arq.surfaceLossPct, earthLossPct,
    maxAttempts: mode === 'loss' ? 1 : HYPOTHETICAL.arq.maxAttempts,
  };

export const schedConfig = (mode: LinkMode = 'ideal'): SchedConfig => ({ ...HYPOTHETICAL.scheduler, strategy: strategyConfig(), arq: arqConfig(mode) });

/** Duyarlılık analizinin değiştirdiği parametreler (Mars tarafı). Başlangıç değerleri config'ten gelir. */
export interface SweepParams { marsRelayBufferMb: number; marsRelayDownlinkKbps: number; dutyCycle: number; earthLossPct: number }

export const defaultParams = (): SweepParams => ({
  marsRelayBufferMb: HYPOTHETICAL.scheduler.relayBufferMb['mars-aktarma'],
  marsRelayDownlinkKbps: HYPOTHETICAL.scheduler.relayDownlinkKbps['mars-aktarma'],
  dutyCycle: HYPOTHETICAL.scheduler.dutyCycle,
  earthLossPct: HYPOTHETICAL.arq.earthLossPct,
});

/** Ayarlara parametreleri uygular (girdiyi değiştirmez). */
export const withParams = (cfg: SchedConfig, p: SweepParams): SchedConfig => ({
  ...cfg,
  ...(cfg.arq ? { arq: { ...cfg.arq, earthLossPct: p.earthLossPct } } : {}),
  dutyCycle: p.dutyCycle,
  relayBufferMb: { ...cfg.relayBufferMb, 'mars-aktarma': p.marsRelayBufferMb },
  relayDownlinkKbps: { ...cfg.relayDownlinkKbps, 'mars-aktarma': p.marsRelayDownlinkKbps },
});

/**
 * [startJD, endJD) aralığını stepSec adımla tarar; her adımda computeNetwork'ten bağlantı pencerelerini
 * (ufuk görüşü, Dünya görüşü, Mars kavuşumu) ve ışık gecikmesini (Horizons konumlarından) alır.
 */
export function buildLinkTimeline(tracks: Record<string, Track>, startJD: number, endJD: number, stepSec: number, topo = schedTopology(), stationCount: number = HYPOTHETICAL.groundStations.stations.length): LinkSample[] {
  const n = Math.max(0, Math.floor(((endJD - startJD) * 86400) / stepSec));
  const out: LinkSample[] = [];
  for (let i = 0; i < n; i++) {
    const net = computeNetwork(tracks, startJD + (i * stepSec) / 86400, stationCount);
    const byAsset = new Map(net.statuses.map((s) => [s.asset.id, s]));
    const byRelay = new Map(net.statuses.map((s) => [s.relay.id, s]));
    out.push({
      surfaceUp: topo.assets.map((a) => byAsset.get(a.id)!.surfaceLink === 'up'),
      surfaceDelaySec: topo.assets.map((a) => byAsset.get(a.id)!.surfaceKm / C_KM_S),
      earthUp: topo.relays.map((r) => byRelay.get(r)!.earthLink === 'up'),
      earthDelaySec: topo.relays.map((r) => byRelay.get(r)!.earthKm / C_KM_S),
      earthBlackout: topo.relays.map((r) => byRelay.get(r)!.earthLink === 'blackout'),
    });
  }
  return out;
}

/** Topolojiyi ve bağlantı çizelgesini tek bir aktarma uydusuna (ve ona bağlı araçlara) indirger. Saf fonksiyon. */
export function restrictToRelay(topo: SchedTopology, samples: LinkSample[], relayId: string): { topo: SchedTopology; samples: LinkSample[] } {
  const ri = topo.relays.indexOf(relayId);
  if (ri < 0) throw new Error(`Bilinmeyen aktarma uydusu: ${relayId}`);
  const keep = topo.assets.map((a) => a.relay === relayId);
  const pick = <T>(arr: T[]) => arr.filter((_, i) => keep[i]);
  return {
    topo: { assets: pick(topo.assets), relays: [relayId] },
    samples: samples.map((x) => ({
      surfaceUp: pick(x.surfaceUp), surfaceDelaySec: pick(x.surfaceDelaySec),
      earthUp: [x.earthUp[ri]], earthDelaySec: [x.earthDelaySec[ri]],
      ...(x.earthBlackout ? { earthBlackout: [x.earthBlackout[ri]] } : {}),
    })),
  };
}

export interface DelayPoint { jd: number; sec: number }

/** Dünya merkezi – cisim merkezi tek yön ışık gecikmesi (gerçek Horizons konumları; uydu/yüzey yok). */
export function lightDelaySeries(tracks: Record<string, Track>, body: 'moon' | 'mars', stepDays: number): DelayPoint[] {
  const t = tracks[body === 'moon' ? 'moon' : 'mars'];
  const end = body === 'moon' ? trackEndJD(tracks.moon) : Math.min(trackEndJD(tracks.mars), trackEndJD(tracks.earth));
  const out: DelayPoint[] = [];
  for (let jd = t.startJD; jd <= end; jd += stepDays) {
    const km = body === 'moon' ? Math.hypot(...sample(tracks.moon, jd)) : dist(sample(tracks.earth, jd), sample(tracks.mars, jd));
    out.push({ jd, sec: km / C_KM_S });
  }
  return out;
}
