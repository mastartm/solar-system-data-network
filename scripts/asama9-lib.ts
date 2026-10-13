// Aşama 9 betikleri için ortak yardımcılar (gerçek Horizons dosyalarını public/data'dan okur; Horizons'a erişmez). Tüm sayılar VARSAYIMSALDIR.
import { readFileSync } from 'node:fs';
import { HYPOTHETICAL } from '../src/config/hypothetical';
import type { Track } from '../src/data/types';
import { findBlackoutWindows, type NetOptions } from '../src/network/network';
import { simulate, type AdaptiveConfig, type ForecastError, type Policy, type ProjectionOptions, type SchedConfig } from '../src/network/scheduler';
import { metricsOf, type Metrics } from '../src/network/sweep';
import { MARS_RELAY, MOON_RELAY, adaptiveConfig, buildLinkTimeline, defaultParams, restrictToRelays, rollingConfig, schedConfig, schedTopology, withParams, type LinkMode } from '../src/network/timeline';

function load(file: string): Record<string, Track> {
  const j = JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as { bodies: Record<string, { startJD: number; stepDays: number; count: number; pos: number[]; vel: number[] }> };
  return Object.fromEntries(Object.entries(j.bodies).map(([k, b]) => [k, { startJD: b.startJD, stepDays: b.stepDays, count: b.count, pos: Float64Array.from(b.pos), vel: Float64Array.from(b.vel, (v) => v * 86400) } as Track]));
}
export const tracks = { ...load('planets.json'), ...load('moon.json') };
export const f = (x: number, d = 1) => x.toFixed(d).replace('.', ',');
export const jdOf = (iso: string) => Date.parse(iso + 'T00:00:00Z') / 86400000 + 2440587.5;
export const isoOf = (jd: number) => new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);
export const STEP = HYPOTHETICAL.scheduler.stepSec;
export const pad = HYPOTHETICAL.scheduler.scenarioPadDays;

export const windows = findBlackoutWindows(tracks);
export const w2028 = windows.find((w) => w.startJD > jdOf('2028-03-01') && w.startJD < jdOf('2028-04-01'))!;

export interface Scn { kind: 'mars' | 'moon'; relay: string; startJD: number; endJD: number; net?: NetOptions }
export const marsScn = (w = w2028, net?: NetOptions): Scn => ({ kind: 'mars', relay: MARS_RELAY, startJD: w.startJD - pad.before, endJD: w.endJD + pad.after, net });
export const moonScn = (iso = HYPOTHETICAL.moonScenario.defaultStart, days = HYPOTHETICAL.moonScenario.defaultDays, net?: NetOptions): Scn => ({ kind: 'moon', relay: MOON_RELAY, startJD: jdOf(iso), endJD: jdOf(iso) + days, net });

const tl = new Map<string, ReturnType<typeof restrictToRelays>>();
function timeline(sc: Scn, stations: number, step: number) {
  const key = `${sc.kind}|${sc.startJD}|${sc.endJD}|${stations}|${step}|${JSON.stringify(sc.net ?? {})}`;
  let t = tl.get(key);
  if (!t) {
    const net = sc.net ?? {};
    const topo = schedTopology(net);
    const ids = sc.kind === 'moon' && net.moonSecond && net.moonSecond !== 'none' ? [MOON_RELAY, HYPOTHETICAL.moonRelay2.id] : [sc.relay];
    t = restrictToRelays(topo, buildLinkTimeline(tracks, sc.startJD, sc.endJD, step, topo, stations, net), ids);
    tl.set(key, t);
  }
  return t;
}
export interface RunOpt { mode?: LinkMode; step?: number; rollingDays?: number; forecast?: ForecastError; projection?: ProjectionOptions; adaptive?: Partial<AdaptiveConfig>; cfg?: Partial<SchedConfig>; params?: Partial<ReturnType<typeof defaultParams>>; classes?: SchedConfig['classes'] }
export function run(sc: Scn, stations: number, policy: Policy, o: RunOpt = {}) {
  const step = o.step ?? STEP;
  const { topo, samples } = timeline(sc, stations, step);
  const second = sc.kind === 'moon' && sc.net?.moonSecond && sc.net.moonSecond !== 'none' ? [HYPOTHETICAL.moonRelay2.id] : [];
  let cfg: SchedConfig = { ...withParams(schedConfig(o.mode ?? 'arq'), { ...defaultParams(sc.relay), ...o.params }, sc.relay, second), stepSec: step };
  if (o.rollingDays !== undefined) cfg.rolling = rollingConfig(o.rollingDays);
  if (o.forecast) cfg.forecast = o.forecast;
  if (o.projection) cfg.projection = o.projection;
  if (o.adaptive) cfg.adaptive = { ...adaptiveConfig(), ...o.adaptive };
  if (o.classes) cfg.classes = o.classes;
  if (o.cfg) cfg = { ...cfg, ...o.cfg };
  const r = simulate(topo, samples, policy, cfg);
  return { r, m: metricsOf(r, cfg), cfg, open: samples.filter((s) => s.earthUp.some(Boolean)).length / samples.length };
}
export const row = (m: Metrics) => `${f(m.dropPct + m.abandonedPct)} / ${f(m.lossPct)} / ${f(m.deliveredPct)}`;
export const supp = (m: Metrics) => f((100 * m.suppressedMb) / (m.demandMb || 1));
export const cell = (m: Metrics) => `${row(m)} [${supp(m)}]`;
