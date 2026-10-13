// Aşama 7 sonuçlarını gerçek Horizons dosyalarıyla (public/data) betikle üretir: `npx vite-node scripts/asama7-sonuclar.ts [bölüm]`.
// Çıktıdaki tüm sayılar VARSAYIMSALDIR (src/config/hypothetical.ts); gerçek bir görev sonucu değildir. Horizons'a erişmez, dosyaları okur.
import { readFileSync } from 'node:fs';
import { HYPOTHETICAL } from '../src/config/hypothetical';
import type { Track } from '../src/data/types';
import { findBlackoutWindows } from '../src/network/network';
import { simulate, type Policy } from '../src/network/scheduler';
import { POLICIES, metricsOf, type Metrics } from '../src/network/sweep';
import { MARS_RELAY, MOON_RELAY, buildLinkTimeline, defaultParams, restrictToRelay, schedConfig, schedTopology, withParams, type LinkMode } from '../src/network/timeline';

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

function mars(w: typeof w2028, stations: number, mode: LinkMode, policy: Policy, over: Record<string, unknown> = {}) {
  const full = buildLinkTimeline(tracks, w.startJD - pad.before, w.endJD + pad.after, STEP, schedTopology(), stations);
  const { topo, samples } = restrictToRelay(schedTopology(), full, MARS_RELAY);
  const cfg = { ...withParams(schedConfig(mode), defaultParams()), ...over };
  const r = simulate(topo, samples, policy, cfg);
  const open = samples.filter((s) => s.earthUp[0]).length / samples.length;
  return { r, m: metricsOf(r, cfg), open };
}
function moon(startISO: string, days: number, stations: number, mode: LinkMode, policy: Policy) {
  const a = jdOf(startISO);
  const full = buildLinkTimeline(tracks, a, a + days, STEP, schedTopology(), stations);
  const { topo, samples } = restrictToRelay(schedTopology(), full, MOON_RELAY);
  const cfg = withParams(schedConfig(mode), defaultParams(MOON_RELAY), MOON_RELAY);
  const r = simulate(topo, samples, policy, cfg);
  return { r, m: metricsOf(r, cfg), open: samples.filter((s) => s.earthUp[0]).length / samples.length };
}
const row = (m: Metrics) => `${f(m.dropPct)} / ${f(m.lossPct)} / ${f(m.deliveredPct)}`;

if (!only || only === 'kapsama') {
  console.log('## Kapsama bilen strateji (Mars hattı, 2028 penceresi, hat modu: hatalı + yeniden iletim) — düşen % / düşen+üretilmeyen % / teslim %');
  console.log('| İstasyon | Hat açık % | ' + POLICIES.join(' | ') + ' |');
  for (const n of [1, 2, 3]) {
    const cells = POLICIES.map((p) => { const t0 = performance.now(); const x = mars(w2028, n, 'arq', p); return { x, ms: performance.now() - t0 }; });
    console.log(`| ${n} | ${f(cells[0].x.open * 100)} | ${cells.map((c) => row(c.x.m)).join(' | ')} |   (ms: ${cells.map((c) => Math.round(c.ms)).join('/')})`);
  }
}
if (!only || only === 'tum-pencereler') {
  console.log('## 9 pencere, 1 istasyon: düşen+üretilmeyen % (strateji / kapsama) ve düşen %');
  for (const w of windows) {
    const s = mars(w, 1, 'arq', 'strategy').m, c = mars(w, 1, 'arq', 'coverage').m, p = mars(w, 1, 'arq', 'priority').m;
    console.log(`${new Date((w.startJD - 2440587.5) * 86400000).toISOString().slice(0, 10)}: öncelikli ${row(p)} | strateji ${row(s)} | kapsama ${row(c)}`);
  }
}
if (!only || only === 'ufuk') {
  console.log('## Toparlanma ufku ve pay duyarlılığı (kapsama bilen strateji, 2028, hatalı + yeniden iletim): düşen % / düşen+üretilmeyen % / teslim %');
  for (const n of [1, 3]) for (const margin of [0.9, 0.97]) for (const d of [0, 3, 7, 14, 21, 30]) {
    const cfgOver = { coverage: { lookaheadSec: 86400, recoverySec: d * 86400, margin, minFactor: 0, assetBufferShare: HYPOTHETICAL.coverageStrategy.assetBufferShare } };
    console.log(`${n} ist., pay ${margin}, toparlanma ${d} gün: ${row(mars(w2028, n, 'arq', 'coverage', cfgOver).m)}`);
  }
}
if (only === 'havuz') {
  console.log('## Araç tamponu payı (assetBufferShare) ve pay: düşen % / düşen+üretilmeyen % / teslim %');
  for (const n of [1, 2, 3]) for (const margin of [0.9, 0.97]) for (const sh of [0, 0.5, 1]) {
    const over = { coverage: { lookaheadSec: 86400, recoverySec: 30 * 86400, margin, minFactor: 0, assetBufferShare: sh } };
    console.log(`${n} ist., pay ${margin}, araç payı ${sh}: ${row(mars(w2028, n, 'arq', 'coverage', over).m)}`);
  }
}
if (!only || only === 'hata') {
  console.log('## Hata modeli: periyodik ve kümelenmiş (öncelikli çizelge, 3 istasyon) — deneme sayısı, kaybolan deneme %, yeniden gönderilen, hatta kayıp paket (maxAttempts aşımı), en uzun art arda kayıp, düşen %, teslim %');
  for (const [name, fn] of [
    ['Mars 2028', (mode: LinkMode, n: number) => mars(w2028, n, mode, 'priority')],
    ['Ay 2028-03-03 60 g', (mode: LinkMode, n: number) => moon('2028-03-03', 60, n, mode, 'priority')],
  ] as const) {
    for (const n of [3, 1]) for (const mode of ['arq', 'burst'] as LinkMode[]) {
      const x = fn(mode, n);
      console.log(`${name} | ${n} ist. | ${mode}: ${x.m.attempts} deneme, kayıp ${f(x.m.txLostPct, 2)}%, yeniden ${x.m.retransmissions}, hatta kayıp ${x.m.abandoned} (${f(x.m.abandonedPct, 2)}%), en uzun ${x.m.maxLossRun}, düşen ${f(x.m.dropPct)}%, teslim ${f(x.m.deliveredPct)}%`);
    }
  }
}
if (!only || only === 'ay') {
  console.log('## Ay hattı (2028-03-03, 60 gün, öncelikli): teslim % / düşen % / hatta kayıp %, telemetri ort. süre (sa)');
  for (const n of [1, 2, 3]) for (const mode of ['ideal', 'loss', 'arq', 'burst'] as LinkMode[]) {
    const x = moon('2028-03-03', 60, n, mode, 'priority');
    console.log(`${n} ist. ${mode}: ${f(x.m.deliveredPct)} / ${f(x.m.dropPct)} / ${f(x.m.abandonedPct, 2)}, tel ${f(x.m.topMeanSec / 3600)} sa, hat açık ${f(x.open * 100)}%`);
  }
}
if (only === 'hat-ayrimi') {
  // Hatta kaybın hangi hattan geldiği: yüzey hattı kaybını 0 yaparak ve Dünya hattı kaybını 0 yaparak ayrı ayrı çalıştır.
  console.log('## Hatta kayıp paket ayrımı (kümelenmiş, öncelikli, 3 istasyon): ayarlar → hatta kayıp paket');
  const base = schedConfig('burst').arq!;
  for (const [name, a] of [['yüzey %1 + Dünya %5 (varsayılan)', base], ['yalnızca Dünya hattı (yüzey %0)', { ...base, surfaceLossPct: 0 }], ['yalnızca yüzey hattı (Dünya %0)', { ...base, earthLossPct: 0 }]] as const) {
    const m = mars(w2028, 3, 'burst', 'priority', { arq: a }).m;
    const mo = (() => { const s0 = jdOf('2028-03-03'); const full = buildLinkTimeline(tracks, s0, s0 + 60, STEP, schedTopology(), 3); const { topo, samples } = restrictToRelay(schedTopology(), full, MOON_RELAY); const cfg = { ...withParams(schedConfig('burst'), defaultParams(MOON_RELAY), MOON_RELAY), arq: a }; return metricsOf(simulate(topo, samples, 'priority', cfg), cfg); })();
    console.log(`${name}: Mars hatta kayıp ${m.abandoned} paket, Ay ${mo.abandoned} paket`);
  }
}
