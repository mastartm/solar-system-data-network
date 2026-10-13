// Aşama 8 sonuçlarını gerçek Horizons dosyalarıyla (public/data) betikle üretir:
//   npx vite-node scripts/asama8-sonuclar.ts [ay|mars|ufuk|tahmin|capraz|hata|yuzey|tum-pencereler]
// Çıktıdaki tüm sayılar VARSAYIMSALDIR (src/config/hypothetical.ts); gerçek bir görev sonucu değildir. Horizons'a erişmez, dosyaları okur.
import { readFileSync } from 'node:fs';
import { HYPOTHETICAL } from '../src/config/hypothetical';
import type { Track } from '../src/data/types';
import { findBlackoutWindows } from '../src/network/network';
import { simulate, type ForecastError, type Policy, type SchedConfig } from '../src/network/scheduler';
import { metricsOf, type Metrics } from '../src/network/sweep';
import { MARS_RELAY, MOON_RELAY, buildLinkTimeline, defaultParams, restrictToRelay, rollingConfig, schedConfig, schedTopology, withParams, type LinkMode } from '../src/network/timeline';

function load(file: string): Record<string, Track> {
  const j = JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as { bodies: Record<string, { startJD: number; stepDays: number; count: number; pos: number[]; vel: number[] }> };
  return Object.fromEntries(Object.entries(j.bodies).map(([k, b]) => [k, { startJD: b.startJD, stepDays: b.stepDays, count: b.count, pos: Float64Array.from(b.pos), vel: Float64Array.from(b.vel, (v) => v * 86400) } as Track]));
}
const tracks = { ...load('planets.json'), ...load('moon.json') };
const f = (x: number, d = 1) => x.toFixed(d).replace('.', ',');
const jdOf = (iso: string) => Date.parse(iso + 'T00:00:00Z') / 86400000 + 2440587.5;
const STEP = HYPOTHETICAL.scheduler.stepSec;
const pad = HYPOTHETICAL.scheduler.scenarioPadDays;
const only = process.argv[2];

const windows = findBlackoutWindows(tracks);
const w2028 = windows.find((w) => w.startJD > jdOf('2028-03-01') && w.startJD < jdOf('2028-04-01'))!;

interface Scn { kind: 'mars' | 'moon'; relay: string; startJD: number; endJD: number }
const marsScn = (w = w2028): Scn => ({ kind: 'mars', relay: MARS_RELAY, startJD: w.startJD - pad.before, endJD: w.endJD + pad.after });
const moonScn = (iso = HYPOTHETICAL.moonScenario.defaultStart, days = HYPOTHETICAL.moonScenario.defaultDays): Scn => ({ kind: 'moon', relay: MOON_RELAY, startJD: jdOf(iso), endJD: jdOf(iso) + days });

const tl = new Map<string, ReturnType<typeof restrictToRelay>>();
function timeline(sc: Scn, stations: number, step: number) {
  const key = `${sc.kind}|${sc.startJD}|${stations}|${step}`;
  let t = tl.get(key);
  if (!t) { t = restrictToRelay(schedTopology(), buildLinkTimeline(tracks, sc.startJD, sc.endJD, step, schedTopology(), stations), sc.relay); tl.set(key, t); }
  return t;
}
interface RunOpt { mode?: LinkMode; step?: number; rollingDays?: number; forecast?: ForecastError; cfg?: Partial<SchedConfig>; arq?: Partial<NonNullable<SchedConfig['arq']>>; burst?: Partial<NonNullable<NonNullable<SchedConfig['arq']>['burst']>>; earthLossPct?: number }
function run(sc: Scn, stations: number, policy: Policy, o: RunOpt = {}) {
  const step = o.step ?? STEP;
  const { topo, samples } = timeline(sc, stations, step);
  let cfg: SchedConfig = { ...withParams(schedConfig(o.mode ?? 'arq'), defaultParams(sc.relay), sc.relay), stepSec: step };
  if (o.earthLossPct !== undefined && cfg.arq) cfg.arq = { ...cfg.arq, earthLossPct: o.earthLossPct };
  if (o.rollingDays !== undefined) cfg.rolling = rollingConfig(o.rollingDays);
  if (o.forecast) cfg.forecast = o.forecast;
  if (o.arq && cfg.arq) cfg.arq = { ...cfg.arq, ...o.arq };
  if (o.burst && cfg.arq?.burst) cfg.arq = { ...cfg.arq, burst: { ...cfg.arq.burst, ...o.burst } };
  if (o.cfg) cfg = { ...cfg, ...o.cfg };
  const r = simulate(topo, samples, policy, cfg);
  return { r, m: metricsOf(r, cfg), open: samples.filter((s) => s.earthUp[0]).length / samples.length };
}
const row = (m: Metrics) => `${f(m.dropPct + m.abandonedPct)} / ${f(m.lossPct)} / ${f(m.deliveredPct)}`;
const supp = (m: Metrics) => f((100 * m.suppressedMb) / (m.demandMb || 1));
const POL: Policy[] = ['fifo', 'priority', 'strategy', 'coverage', 'rolling'];

if (!only || only === 'ay' || only === 'mars') {
  for (const [name, sc] of [['Ay 2028-03-03, 60 gün', moonScn()], ['Mars 2028-03-08 penceresi', marsScn()]] as const) {
    if (only && !name.toLowerCase().startsWith(only)) continue;
    console.log(`## ${name}, hatalı + yeniden iletim (periyodik), ${STEP} sn — düşen+hatta kayıp % / düşen+hatta kayıp+üretilmeyen % / teslim % [üretilmeyen %]`);
    console.log('| İstasyon | Hat açık % | ' + POL.join(' | ') + ' |');
    for (const n of [1, 2, 3]) {
      const cells = POL.map((p) => { const t0 = performance.now(); const x = run(sc, n, p); return { x, ms: performance.now() - t0 }; });
      console.log(`| ${n} | ${f(cells[0].x.open * 100)} | ${cells.map((c) => `${row(c.x.m)} [${supp(c.x.m)}]`).join(' | ')} |   (ms: ${cells.map((c) => Math.round(c.ms)).join('/')})`);
    }
  }
}
if (!only || only === 'ufuk') {
  console.log('## Kayan ufuk duyarlılığı (rolling) — düşen+hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]');
  for (const [name, sc] of [['Ay', moonScn()], ['Mars', marsScn()]] as const) for (const n of [1, 3]) {
    console.log(`${name}, ${n} ist.:`);
    for (const d of HYPOTHETICAL.rollingStrategy.rollingDaysOptions) { const m = run(sc, n, 'rolling', { rollingDays: d }).m; console.log(`  ufuk ${d} gün: ${row(m)} [${supp(m)}]`); }
    const m = run(sc, n, 'priority').m; console.log(`  (öncelikli: ${row(m)})`);
  }
}
if (only === 'tum-pencereler') {
  console.log('## 9 Mars penceresi, 1 istasyon, düşen+hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]');
  for (const w of windows) {
    const sc = marsScn(w);
    console.log(`${new Date((w.startJD - 2440587.5) * 86400000).toISOString().slice(0, 10)}: ` + (['priority', 'coverage', 'rolling'] as Policy[]).map((p) => { const m = run(sc, 1, p, { step: 1800, rollingDays: 30 }).m; return `${p} ${row(m)} [${supp(m)}]`; }).join(' | '));
  }
}
if (!only || only === 'tahmin') {
  const fs = HYPOTHETICAL.forecastScan;
  for (const [name, sc, n] of [['Ay 2028-03-03, 60 g, 1 istasyon', moonScn(), 1], ['Ay 2028-03-03, 60 g, 2 istasyon', moonScn(), 2], ['Mars 2028, 1 istasyon', marsScn(), 1]] as const) {
    for (const [what, vals, mk] of [
      ['pencere genişlet(+)/daralt(−) dk', fs.edgeShiftMin, (v: number): ForecastError => ({ edgeShiftSec: v * 60 })],
      ['pencere öteleme dk', fs.offsetMin, (v: number): ForecastError => ({ offsetSec: v * 60 })],
      ['ortalama kayıp sapması %', fs.lossBiasPct, (v: number): ForecastError => ({ lossBiasPct: v })],
    ] as const) {
      console.log(`## ${name} — ${what}: düşen+hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]`);
      const pr = run(sc, n, 'priority', { step: fs.stepSec }).m;
      console.log(`  öncelikli: ${row(pr)}`);
      for (const v of vals) {
        const cells = (['strategy', 'coverage', 'rolling'] as Policy[]).map((p) => { const m = run(sc, n, p, { step: fs.stepSec, forecast: mk(v) }).m; return `${p} ${row(m)} [${supp(m)}]`; });
        console.log(`  ${v}: ${cells.join(' | ')}`);
      }
    }
  }
}
if (only === 'capraz') {
  // Kayan ufuklu stratejinin öncelikli çizelgenin (ve Mars'ta Aşama 4 stratejisinin) "altına düştüğü" ilk hata düzeyi; 0,1 puandan fazla kötüleşme.
  const EPS = 0.1;
  const drop = (m: Metrics) => m.dropPct + m.abandonedPct;
  const grid = [-480, -360, -240, -180, -120, -90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
  for (const [name, sc, n] of [['Ay 2028-03-03, 60 g, 1 istasyon', moonScn(), 1], ['Ay 2028-03-03, 60 g, 2 istasyon', moonScn(), 2], ['Mars 2028, 1 istasyon', marsScn(), 1], ['Mars 2028, 3 istasyon', marsScn(), 3]] as const) {
    const step = HYPOTHETICAL.forecastScan.stepSec;
    const pr = run(sc, n, 'priority', { step }).m;
    const a4 = sc.kind === 'mars' ? run(sc, n, 'strategy', { step }).m : pr;
    console.log(`## ${name} (pencere başı/sonu kayması, dk; + iyimser) — öncelikli: ${row(pr)}`);
    const roll0 = grid.map((v) => ({ v, m: run(sc, n, 'rolling', { step, forecast: { edgeShiftSec: v * 60 } }).m }));
    const first = (cond: (m: Metrics) => boolean, sign: number) => roll0.filter((x) => Math.sign(x.v) === sign).sort((a, b) => Math.abs(a.v) - Math.abs(b.v)).find((x) => cond(x.m))?.v ?? 'yok';
    const z = roll0.find((x) => x.v === 0)!.m;
    const items: [string, (m: Metrics) => boolean, number][] = [
      ['düşen+hatta kayıp > öncelikli', (m) => drop(m) - drop(pr) > EPS, drop(z) - drop(pr)],
      ['düşen+hatta kayıp > Aşama 4 strateji', (m) => drop(m) - drop(a4) > EPS, drop(z) - drop(a4)],
      ['toplam kayıp > öncelikli', (m) => m.lossPct - pr.lossPct > EPS, z.lossPct - pr.lossPct],
      ['teslim < öncelikli', (m) => pr.deliveredPct - m.deliveredPct > EPS, pr.deliveredPct - z.deliveredPct],
    ];
    for (const [what, cond, d0] of items) console.log(`  ${what}: hata yokken fark ${f(d0, 2)} puan; ilk kötüleşme − yönde: ${first(cond, -1)}, + yönde: ${first(cond, 1)}`);
    // Mars'ta coverage da
    if (sc.kind === 'mars') {
      const cov = grid.map((v) => ({ v, m: run(sc, n, 'coverage', { step, forecast: { edgeShiftSec: v * 60 } }).m }));
      const c0 = cov.find((x) => x.v === 0)!.m;
      console.log(`  (kapsama bilen strateji hata yokken: ${row(c0)}; −120 dk: ${row(cov.find((x) => x.v === -120)!.m)}; +120 dk: ${row(cov.find((x) => x.v === 120)!.m)})`);
    }
  }
}
if (!only || only === 'hata') {
  const es = HYPOTHETICAL.errorScan, step = HYPOTHETICAL.forecastScan.stepSec;
  for (const [name, sc] of [['Mars 2028', marsScn()], ['Ay 2028-03-03, 60 g', moonScn()]] as const) {
    const n = 3;
    const per = run(sc, n, 'priority', { step, mode: 'arq' }).m;
    console.log(`## ${name}, ${n} istasyon, kümelenmiş, öncelikli (adım ${step} sn) — hatta kayıp paket (yüzey / Dünya) | kaybolan deneme % | düşen % | teslim %; periyodik referans: ${per.abandoned} (${per.abandonedSurface} / ${per.abandoned - per.abandonedSurface})`);
    const line = (label: string, o: RunOpt) => { const m = run(sc, n, 'priority', { step, mode: 'burst', ...o }).m; console.log(`  ${label}: ${m.abandoned} (${m.abandonedSurface} / ${m.abandoned - m.abandonedSurface}) | ${f(m.txLostPct, 2)} | ${f(m.dropPct)} | ${f(m.deliveredPct)}`); };
    for (const v of es.badLossPct) line(`kötü durum kaybı %${v}`, { burst: { badLossPct: v } });
    for (const v of es.meanBadSec) line(`kötü durum ort. süre ${v / 60} dk`, { burst: { meanBadSec: v } });
    for (const v of es.surfaceRetrySec) line(`yüzey yeniden deneme aralığı ${v / 60} dk`, { arq: { surfaceRetrySec: v } });
  }
}
