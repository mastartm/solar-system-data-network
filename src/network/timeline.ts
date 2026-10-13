import { HYPOTHETICAL } from '../config/hypothetical';
import type { Track } from '../data/types';
import { C_KM_S, dist, sample, trackEndJD } from '../map/ephemeris';
import { computeNetwork } from './network';
import type { LinkSample, SchedConfig, SchedTopology } from './scheduler';

export const schedTopology = (): SchedTopology => ({
  assets: HYPOTHETICAL.assets.map((a) => ({ id: a.id, body: a.body, relay: a.relay, dataRateKbps: a.dataRateKbps })),
  relays: HYPOTHETICAL.relays.map((r) => r.id),
});

export const schedConfig = (): SchedConfig => ({ ...HYPOTHETICAL.scheduler });

/**
 * [startJD, endJD) aralığını stepSec adımla tarar; her adımda computeNetwork'ten bağlantı pencerelerini
 * (ufuk görüşü, Dünya görüşü, Mars kavuşumu) ve ışık gecikmesini (Horizons konumlarından) alır.
 */
export function buildLinkTimeline(tracks: Record<string, Track>, startJD: number, endJD: number, stepSec: number, topo = schedTopology()): LinkSample[] {
  const n = Math.max(0, Math.floor(((endJD - startJD) * 86400) / stepSec));
  const out: LinkSample[] = [];
  for (let i = 0; i < n; i++) {
    const net = computeNetwork(tracks, startJD + (i * stepSec) / 86400);
    const byAsset = new Map(net.statuses.map((s) => [s.asset.id, s]));
    const byRelay = new Map(net.statuses.map((s) => [s.relay.id, s]));
    out.push({
      surfaceUp: topo.assets.map((a) => byAsset.get(a.id)!.surfaceLink === 'up'),
      surfaceDelaySec: topo.assets.map((a) => byAsset.get(a.id)!.surfaceKm / C_KM_S),
      earthUp: topo.relays.map((r) => byRelay.get(r)!.earthLink === 'up'),
      earthDelaySec: topo.relays.map((r) => byRelay.get(r)!.earthKm / C_KM_S),
    });
  }
  return out;
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
