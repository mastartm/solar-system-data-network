import { HYPOTHETICAL } from '../config/hypothetical';
import type { Track } from '../data/types';
import { C_KM_S, dist, sample, trackEndJD } from '../map/ephemeris';
import { computeNetwork, effectiveAssets, effectiveRelays, relayCandidates, type NetOptions } from './network';
import type { AdaptiveConfig, ArqConfig, CoverageConfig, LinkSample, ProjectionOptions, RollingConfig, SchedAsset, SchedConfig, SchedTopology, StrategyConfig } from './scheduler';

/** net (Aşama 9): ağ seçenekleri; varsayılan = Aşama 2-8 topolojisi. Ay araçları ikinci uydu seçilince `alt` olarak ikinci uyduyu da listeler. */
export const schedTopology = (net: NetOptions = {}): SchedTopology => ({
  assets: effectiveAssets(net).map((a) => {
    const alt = relayCandidates(a, net).slice(1);
    return { id: a.id, body: a.body, relay: a.relay, dataRateKbps: a.dataRateKbps, ...(alt.length ? { alt } : {}) };
  }),
  relays: effectiveRelays(net).map((r) => r.id),
});

export const strategyConfig = (): StrategyConfig => {
  const { lookaheadDays, ...rest } = HYPOTHETICAL.strategy;
  return { ...rest, lookaheadSec: lookaheadDays * 86400 };
};

export const coverageConfig = (): CoverageConfig => {
  const { lookaheadDays, recoveryDays, ...rest } = HYPOTHETICAL.coverageStrategy;
  return { ...rest, lookaheadSec: lookaheadDays * 86400, recoverySec: recoveryDays * 86400 };
};

export const rollingConfig = (rollingDays: number = HYPOTHETICAL.rollingStrategy.rollingDays): RollingConfig => {
  const { rollingDays: _d, rollingDaysOptions: _o, ...rest } = HYPOTHETICAL.rollingStrategy;
  return { ...rest, rollingSec: rollingDays * 86400 };
};

export const adaptiveConfig = (): AdaptiveConfig => {
  const { minDays, maxDays, leadDays, ...rest } = HYPOTHETICAL.adaptiveStrategy;
  return { ...rest, minSec: minDays * 86400, maxSec: maxDays * 86400, leadSec: leadDays * 86400 };
};

/** Yarı ömürler (sn): her çalıştırmada eşzamanlı hesaplanır (değer taraması). */
export const valueHalfLivesSec = (): number[] => HYPOTHETICAL.value.decayOptionsDays.map((d) => d * 86400);

/**
 * Hat modu: 'ideal' = kayıpsız hat (Aşama 3-4); 'loss' = hatalı hat, yeniden iletimsiz (maxAttempts 1); 'arq' = hatalı hat (periyodik kayıp)
 * + yeniden iletim; 'burst' (Aşama 7) = aynı ortalama kayıp, kümelenmiş (iki durumlu) dağılım + yeniden iletim.
 */
export type LinkMode = 'ideal' | 'loss' | 'arq' | 'burst';
export const LINK_MODE_LABEL: Record<LinkMode, string> = {
  ideal: 'Kayıpsız hat', loss: 'Hatalı hat, yeniden iletimsiz', arq: 'Hatalı hat + yeniden iletim', burst: 'Kümelenmiş hata + yeniden iletim',
};

export const arqConfig = (mode: LinkMode, earthLossPct = HYPOTHETICAL.arq.earthLossPct, surfaceRetrySec = HYPOTHETICAL.arq.surfaceRetrySec): ArqConfig | undefined =>
  mode === 'ideal' ? undefined : {
    surfaceLossPct: HYPOTHETICAL.arq.surfaceLossPct, earthLossPct,
    maxAttempts: mode === 'loss' ? 1 : HYPOTHETICAL.arq.maxAttempts,
    ...(surfaceRetrySec > 0 ? { surfaceRetrySec } : {}),
    ...(mode === 'burst' ? { burst: { ...HYPOTHETICAL.arq.burst } } : {}),
  };

export const projectionOptions = (): ProjectionOptions => ({ ...HYPOTHETICAL.projection });

export const schedConfig = (mode: LinkMode = 'ideal'): SchedConfig => ({
  ...HYPOTHETICAL.scheduler, strategy: strategyConfig(), coverage: coverageConfig(), rolling: rollingConfig(), adaptive: adaptiveConfig(), arq: arqConfig(mode),
  projection: projectionOptions(), valueHalfLivesSec: valueHalfLivesSec(),
});

export const MARS_RELAY = 'mars-aktarma';
export const MOON_RELAY = 'ay-aktarma';

/**
 * Duyarlılık analizinin değiştirdiği parametreler: senaryodaki aktarma uydusunun (Mars ya da Ay, Aşama 7) tamponu ve Dünya hat hızı,
 * görev döngüsü ve Dünya hattı kaybı. Başlangıç değerleri config'ten gelir. (Aşama 4-6'da adları marsRelay* idi; davranış aynı.)
 */
export interface SweepParams { relayBufferMb: number; relayDownlinkKbps: number; dutyCycle: number; earthLossPct: number }

export const defaultParams = (relayId: string = MARS_RELAY): SweepParams => ({
  relayBufferMb: HYPOTHETICAL.scheduler.relayBufferMb[relayId],
  relayDownlinkKbps: HYPOTHETICAL.scheduler.relayDownlinkKbps[relayId],
  dutyCycle: HYPOTHETICAL.scheduler.dutyCycle,
  earthLossPct: HYPOTHETICAL.arq.earthLossPct,
});

/**
 * Ayarlara parametreleri uygular (girdiyi değiştirmez). relayId: tampon ve hat hızı hangi uyduya uygulanır (varsayılan Mars).
 * extraRelayIds (Aşama 9): aynı tampon ve hat hızı bu uydulara da uygulanır (ikinci Ay uydusu).
 */
export const withParams = (cfg: SchedConfig, p: SweepParams, relayId: string = MARS_RELAY, extraRelayIds: string[] = []): SchedConfig => ({
  ...cfg,
  ...(cfg.arq ? { arq: { ...cfg.arq, earthLossPct: p.earthLossPct } } : {}),
  dutyCycle: p.dutyCycle,
  relayBufferMb: { ...cfg.relayBufferMb, ...Object.fromEntries([relayId, ...extraRelayIds].map((r) => [r, p.relayBufferMb])) },
  relayDownlinkKbps: { ...cfg.relayDownlinkKbps, ...Object.fromEntries([relayId, ...extraRelayIds].map((r) => [r, p.relayDownlinkKbps])) },
});

/**
 * [startJD, endJD) aralığını stepSec adımla tarar; her adımda computeNetwork'ten bağlantı pencerelerini
 * (ufuk görüşü, Dünya görüşü, Mars kavuşumu) ve ışık gecikmesini (Horizons konumlarından) alır.
 */
export function buildLinkTimeline(tracks: Record<string, Track>, startJD: number, endJD: number, stepSec: number, topo = schedTopology(), stationCount: number = HYPOTHETICAL.groundStations.stations.length, netOpts: NetOptions = {}): LinkSample[] {
  const n = Math.max(0, Math.floor(((endJD - startJD) * 86400) / stepSec));
  const out: LinkSample[] = [];
  const multi = topo.assets.some((a) => a.alt?.length);
  for (let i = 0; i < n; i++) {
    const net = computeNetwork(tracks, startJD + (i * stepSec) / 86400, stationCount, netOpts);
    const byAsset = new Map(net.statuses.map((s) => [s.asset.id, s]));
    const byRelay = new Map(net.relayStates.map((s) => [s.relay.id, s]));
    out.push({
      surfaceUp: topo.assets.map((a) => byAsset.get(a.id)!.surfaceLink === 'up'),
      surfaceDelaySec: topo.assets.map((a) => byAsset.get(a.id)!.surfaceKm / C_KM_S),
      earthUp: topo.relays.map((r) => byRelay.get(r)!.earthLink === 'up'),
      earthDelaySec: topo.relays.map((r) => byRelay.get(r)!.earthKm / C_KM_S),
      earthBlackout: topo.relays.map((r) => byRelay.get(r)!.earthLink === 'blackout'),
      ...(multi ? { assetRelay: topo.assets.map((a) => topo.relays.indexOf(byAsset.get(a.id)!.relay.id)) } : {}),
    });
  }
  return out;
}

/**
 * Topolojiyi ve bağlantı çizelgesini verilen aktarma uydularına (ve ana uydusu bunlardan olan araçlara) indirger. Saf fonksiyon.
 * Birden çok uydu (ikinci Ay uydusu, Aşama 9) verilirse araçların `alt` listesi ve `assetRelay` dizisi yeni sıraya göre kalır.
 */
export function restrictToRelays(topo: SchedTopology, samples: LinkSample[], relayIds: string[]): { topo: SchedTopology; samples: LinkSample[] } {
  const idx = relayIds.map((id) => {
    const i = topo.relays.indexOf(id);
    if (i < 0) throw new Error(`Bilinmeyen aktarma uydusu: ${id}`);
    return i;
  });
  const keep = topo.assets.map((a) => relayIds.includes(a.relay));
  const pick = <T>(arr: T[]) => arr.filter((_, i) => keep[i]);
  const assets: SchedAsset[] = pick(topo.assets).map((a): SchedAsset => {
    if (!a.alt) return a;
    const alt = a.alt.filter((r) => relayIds.includes(r));
    const { alt: _drop, ...rest } = a;
    return alt.length ? { ...rest, alt } : rest;
  });
  const multi = assets.some((a) => a.alt?.length);
  return {
    topo: { assets, relays: [...relayIds] },
    samples: samples.map((x) => ({
      surfaceUp: pick(x.surfaceUp), surfaceDelaySec: pick(x.surfaceDelaySec),
      earthUp: idx.map((i) => x.earthUp[i]), earthDelaySec: idx.map((i) => x.earthDelaySec[i]),
      ...(x.earthBlackout ? { earthBlackout: idx.map((i) => x.earthBlackout![i]) } : {}),
      ...(multi && x.assetRelay ? { assetRelay: pick(x.assetRelay).map((r) => Math.max(0, idx.indexOf(r))) } : {}),
    })),
  };
}

/** Tek bir aktarma uydusuna (ve ona bağlı araçlara) indirger. */
export function restrictToRelay(topo: SchedTopology, samples: LinkSample[], relayId: string): { topo: SchedTopology; samples: LinkSample[] } {
  return restrictToRelays(topo, samples, [relayId]);
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
