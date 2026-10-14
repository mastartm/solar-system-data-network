// Aşama 10 sonuçlarını gerçek Horizons dosyalarıyla (public/data) betikle üretir:
//   npx vite-node scripts/asama10-sonuclar.ts [deger|deger-esik|deger-model|dayanikli|yonlendirme|presesyon|golge|guc|telemetri]
// (bölüm adı verilmezse hepsi çalışır; README sayıları buradan gelir.) Çıktıdaki tüm sayılar VARSAYIMSALDIR (src/config/hypothetical.ts); gerçek bir görev sonucu değildir.
// Horizons'a erişmez, dosyaları okur.
import { HYPOTHETICAL } from '../src/config/hypothetical';
import { MarsPower, applyPower, computeNetwork, marsAxisTiltDeg, type NetOptions } from '../src/network/network';
import { coverageRow } from '../src/network/coverage';
import type { AdaptiveRobustConfig, Policy, ProjectionOptions, ValueAwareConfig } from '../src/network/scheduler';
import { valuePct, type Metrics } from '../src/network/sweep';
import { MARS_RELAY, adaptiveRobustConfig, routingConfig, valueAwareConfig } from '../src/network/timeline';
import { cell, f, isoOf, jdOf, marsScn, moonScn, run, tracks, windows, type Scn } from './asama9-lib';

const only = process.argv[2];
const HL = HYPOTHETICAL.value.decayOptionsDays; // 3, 7, 14, 30, 90 gün
const TW = HYPOTHETICAL.value.telemetryWeightScan; // 1…32
const sg = (x: number, d = 2) => `${x >= 0 ? '+' : '−'}${f(Math.abs(x), d)}`;
const w4 = (tw: number) => ({ weightOf: (p: { id: string; weight: number }) => (p.id === 'telemetri' ? tw : 1) });
const mmm = (v: number[], d = 2) => { const s = [...v].sort((a, b) => a - b); return `${sg(s[0], d)} / ${sg(s[Math.floor(s.length / 2)], d)} / ${sg(s[s.length - 1], d)}`; };
const pc = (x: number, n: number) => f((100 * x) / n, 1);
const DAY = 86400;
const NONE: Partial<AdaptiveRobustConfig> = { capSec: undefined, histFactor: undefined, trustMin: undefined, fallbackSec: undefined };
const marsFree = (net?: NetOptions, days: number = HYPOTHETICAL.marsFreeScenario.defaultDays): Scn => ({ kind: 'mars', relay: MARS_RELAY, startJD: jdOf(HYPOTHETICAL.marsFreeScenario.defaultStart), endJD: jdOf(HYPOTHETICAL.marsFreeScenario.defaultStart) + days, net });
const dropOf = (m: Metrics) => m.dropPct + m.abandonedPct;

// ------------------------------------------------------------------------------------------------------------------ Madde 1: değere duyarlı kuyruk
if (!only || only === 'deger') {
  console.log('## Madde 1 — değere duyarlı kuyruk: değer % kazancı (puan; politika − öncelikli; telemetri ağırlığı 4, 300 sn, hatalı + yeniden iletim [periyodik])');
  console.log('Kuralların hepsi açık: en yeni önce + eşik altı atma (0,25) + en eskiyi at. "kısma" = Aşama 9 uyarlamalı ufuk (üretilmeyen veri).');
  const VAR: [string, Partial<ValueAwareConfig>][] = [['hepsi', {}], ['yalnız en yeni önce', { expireBelow: 0, evictOldest: false }], ['yalnız atma', { newestFirst: false, evictOldest: false }], ['yalnız en eskiyi at', { expireBelow: 0, newestFirst: false }]];
  for (const [name, sc] of [['Ay 2028-03-03 (60 g)', moonScn()], ['Mars 2028 kavuşum penceresi', marsScn()]] as [string, Scn][]) {
    for (const n of [1, 2, 3]) {
      const pr = run(sc, n, 'priority').m, ad = run(sc, n, 'adaptive').m;
      console.log(`### ${name}, ${n} istasyon — öncelikli: düşen+hatta / toplam / teslim [üretilmeyen] = ${cell(pr)}`);
      console.log('| yarı ömür | kısma (uyarlamalı) | ' + VAR.map((v) => v[0]).join(' | ') + ' | kısma + hepsi (valueAdaptive) |');
      for (let h = 0; h < HL.length; h++) {
        const o = { halfLifeIdx: h, ...w4(4) };
        const base = valuePct(pr, o);
        const cells = VAR.map(([, over]) => { const m = run(sc, n, 'valueAware', { cfg: { valueAware: valueAwareConfig(HL[h] * 86400, over) } }).m; return `${sg(valuePct(m, o) - base)} (kayıp ${sg(m.lossPct - pr.lossPct, 1)}, teslim ${sg(m.deliveredPct - pr.deliveredPct, 1)})`; });
        const va = run(sc, n, 'valueAdaptive', { cfg: { valueAware: valueAwareConfig(HL[h] * 86400) } }).m;
        console.log(`| ${HL[h]} g | ${sg(valuePct(ad, o) - base)} (kayıp ${sg(ad.lossPct - pr.lossPct, 1)}, teslim ${sg(ad.deliveredPct - pr.deliveredPct, 1)}) | ${cells.join(' | ')} | ${sg(valuePct(va, o) - base)} (kayıp ${sg(va.lossPct - pr.lossPct, 1)}) |`);
      }
    }
  }
}

if (!only || only === 'deger-esik') {
  console.log('## Madde 1 — telemetri ağırlığı × yarı ömür: "hepsi açık" kuralın kazancı (puan; öncelikli ve kısma ile karşılaştırma). Hücre: kuyruk kuralı / kısma');
  for (const [name, sc] of [['Ay 2028 (60 g)', moonScn()], ['Mars 2028', marsScn()]] as [string, Scn][]) {
    for (const n of [1, 2, 3]) {
      const pr = run(sc, n, 'priority').m, ad = run(sc, n, 'adaptive').m;
      const vas = HL.map((d) => run(sc, n, 'valueAware', { cfg: { valueAware: valueAwareConfig(d * 86400) } }).m);
      console.log(`### ${name}, ${n} ist.`);
      console.log('| yarı ömür \\ telemetri ağırlığı | ' + TW.map((w) => `${w}×`).join(' | ') + ' |');
      HL.forEach((d, h) => console.log(`| ${d} g | ` + TW.map((tw) => { const o = { halfLifeIdx: h, ...w4(tw) }; return `${sg(valuePct(vas[h], o) - valuePct(pr, o))} / ${sg(valuePct(ad, o) - valuePct(pr, o))}`; }).join(' | ') + ' |'));
    }
  }
  // eşik taraması
  console.log('## eşik taraması (expireBelow; yarı ömür 14 g, telemetri 4×): değer kazancı (puan) ve atılan %');
  for (const [name, sc, n] of [['Ay 2028', moonScn(), 1], ['Mars 2028', marsScn(), 1], ['Mars 2028', marsScn(), 3]] as [string, Scn, number][]) {
    const pr = run(sc, n, 'priority').m;
    const o = { halfLifeIdx: 2, ...w4(4) };
    console.log(`${name}, ${n} ist.: ` + HYPOTHETICAL.valueAware.scan.expireBelow.map((e) => { const m = run(sc, n, 'valueAware', { cfg: { valueAware: valueAwareConfig(14 * 86400, { expireBelow: e }) } }).m; return `eşik ${e}: ${sg(valuePct(m, o) - valuePct(pr, o))} (atılan %${f(m.expiredPct, 1)}, düşen ${f(dropOf(m), 1)})`; }).join(' · '));
  }
}

if (!only || only === 'deger-model') {
  // Kural yanlış belirtilmişse: kuyruk kuralı H_kural yarı ömrüne göre (atma eşiği) çalışır, ama gerçek değer farklı yarı ömürle ya da sabit.
  console.log('## Madde 1 — kural yarı ömrü ≠ gerçek değer yarı ömrü; telemetri 4×. Hücre: değer kazancı (puan, öncelikliye göre) / teslim farkı (puan) / bilim verisi gecikme p95 (gün, öncelikli → kural)');
  for (const [name, sc, n] of [['Ay 2028', moonScn(), 1], ['Mars 2028', marsScn(), 1], ['Mars 2028', marsScn(), 2]] as [string, Scn, number][]) {
    const pr = run(sc, n, 'priority').m;
    console.log(`### ${name}, ${n} ist. (öncelikli: değer% sabit ${f(valuePct(pr, w4(4)), 1)}; yarı ömür 3 g ${f(valuePct(pr, { ...w4(4), halfLifeIdx: 0 }), 1)}, 14 g ${f(valuePct(pr, { ...w4(4), halfLifeIdx: 2 }), 1)}, 90 g ${f(valuePct(pr, { ...w4(4), halfLifeIdx: 4 }), 1)}; bilim gecikme p95 ${f(pr.lowP95Sec / 86400, 1)} g)`);
    console.log('| kural yarı ömrü | gerçek: sabit değer | 3 g | 14 g | 90 g | bilim gecikme p95 (gün) |');
    for (const hq of [3, 14, 90]) {
      const m = run(sc, n, 'valueAware', { cfg: { valueAware: valueAwareConfig(hq * 86400) } }).m;
      const g = (hi?: number) => `${sg(valuePct(m, { ...w4(4), halfLifeIdx: hi }) - valuePct(pr, { ...w4(4), halfLifeIdx: hi }))}`;
      console.log(`| ${hq} g | ${g()} (teslim ${sg(m.deliveredPct - pr.deliveredPct, 1)}) | ${g(0)} | ${g(2)} | ${g(4)} | ${f(pr.lowP95Sec / 86400, 1)} → ${f(m.lowP95Sec / 86400, 1)} |`);
    }
  }
}

if (!only || only === 'dayanikli') {
  console.log('## Madde 2 — takvim hatasına dayanıklı uyarlamalı ufuk. Tahmin hatası genellemesi (600 sn; pencere başı/sonu kayması −240…+240 dk; + iyimser, − kötümser; 1 istasyon)');
  const grid = [-240, -120, -60, 0, 60, 120, 240];
  const step = HYPOTHETICAL.forecastScan.stepSec;
  const R = HYPOTHETICAL.adaptiveRobust;
  const chk = R.checkDays * DAY;
  const VAR: [string, Partial<AdaptiveRobustConfig>][] = [
    ['geri çekilme (eşik 0,2)', { ...NONE, trustMin: 0.2, checkSec: chk }],
    ['geri çekilme (eşik 0,3)', { ...NONE, trustMin: 0.3, checkSec: chk }],
    ['geri çekilme (eşik 0,5)', { ...NONE, trustMin: 0.5, checkSec: chk }],
    ['geri çekilme (0,3) → sabit 3 g ufuk', { ...NONE, trustMin: 0.3, checkSec: chk, fallbackSec: 3 * DAY }],
    ['yalnız güven aralığı (×2)', { ...NONE, histFactor: R.histFactor, histSec: R.histDays * DAY }],
    ['yalnız ufku kırpma (6 g)', { ...NONE, capSec: R.capDays * DAY }],
    ['geri çekilme (0,3) + güven aralığı', { ...NONE, trustMin: 0.3, checkSec: chk, histFactor: R.histFactor, histSec: R.histDays * DAY }],
    ['geri çekilme (0,3) + güven aralığı + kırpma (6 g)', { ...NONE, trustMin: 0.3, checkSec: chk, histFactor: R.histFactor, histSec: R.histDays * DAY, capSec: 6 * DAY }],
    ['varsayılan (hypothetical.ts: geri çekilme 0,3 + güven aralığı ×2)', {}],
  ];
  const cases: [string, Scn][] = [
    ...HYPOTHETICAL.generalization.moonStarts.map((iso) => [`Ay ${iso}`, moonScn(iso, HYPOTHETICAL.generalization.moonDays)] as [string, Scn]),
    ...windows.map((w) => [`Mars ${isoOf(w.startJD)}`, marsScn(w)] as [string, Scn]),
  ];
  type Acc = Record<string, number[]>;
  const agg: Record<string, Acc> = {};
  const push = (k: string, a: string, v: number) => ((agg[k] ??= {})[a] ??= []).push(v);
  for (const [name, sc] of cases) {
    const pr = run(sc, 1, 'priority', { step }).m;
    const pols: [string, Policy, number, Partial<AdaptiveRobustConfig> | null][] = sc.kind === 'mars'
      ? [['coverage', 'coverage', 0, null], ['rolling 30 g', 'rolling', 30, null], ['adaptive', 'adaptive', 0, null]]
      : [['rolling 3 g', 'rolling', 3, null], ['adaptive', 'adaptive', 0, null]];
    for (const [vn, o] of VAR) pols.push([vn, 'adaptiveRobust', 0, o]);
    for (const [label, pol, rd, over] of pols) {
      const ms = grid.map((v) => ({ v, m: run(sc, 1, pol, { step, rollingDays: rd || undefined, forecast: { edgeShiftSec: v * 60 }, ...(over ? { cfg: { adaptiveRobust: adaptiveRobustConfig(over) } } : {}) }).m }));
      const at = (v: number) => ms.find((x) => x.v === v)!.m;
      const k = `${sc.kind}|${label}`;
      push(k, '|e|≤120 en kötü', Math.max(...ms.filter((x) => Math.abs(x.v) <= 120).map((x) => x.m.lossPct - pr.lossPct)));
      for (const v of [-240, -120, 0, 120, 240]) push(k, `${v}`, at(v).lossPct - pr.lossPct);
      push(k, 'düşen kötüleşen', ms.some((x) => dropOf(x.m) - dropOf(pr) > 0.1) ? 1 : 0);
      for (const v of [-240, -120, 120]) push(k, `d${v}`, dropOf(at(v)));
      push(k, 'd0', dropOf(at(0)));
      push(k, 'dpr', dropOf(pr));
      if (/2028-03-0[35]$/.test(name)) console.log(`  ${name} ${label}: −240 ${cell(at(-240))} | −120 ${cell(at(-120))} | 0 ${cell(at(0))} | +240 ${cell(at(240))} (öncelikli ${cell(pr)})`);
    }
  }
  console.log('Özet — toplam kayıp farkı (puan, öncelikliye göre; min / medyan / maks senaryolar üzerinde):');
  console.log('| Hat / politika | \\|hata\\| ≤ 120 dk içindeki en kötü | −240 dk | −120 dk | 0 | +120 dk | +240 dk | düşen+hatta öncelikliden kötü senaryo | düşen+hatta % (medyan): öncelikli / hata yok / −120 / −240 |');
  for (const [k, a] of Object.entries(agg)) {
    const [kind, label] = k.split('|');
    console.log(`| ${kind === 'moon' ? 'Ay' : 'Mars'} ${label} | ${mmm(a['|e|≤120 en kötü'])} | ${mmm(a['-240'])} | ${mmm(a['-120'])} | ${mmm(a['0'])} | ${mmm(a['120'])} | ${mmm(a['240'])} | ${a['düşen kötüleşen'].reduce((x, y) => x + y, 0)} / ${a['0'].length} | ${[a.dpr, a.d0, a['d-120'], a['d-240']].map((v) => f([...v].sort((x, y) => x - y)[Math.floor(v.length / 2)], 1)).join(' / ')} |`);
  }
}

if (!only || only === 'yonlendirme') {
  console.log('## Madde 3 — gerçek çok uydulu yönlendirme (Ay 2028-03-03, 60 g, 300 sn, hatalı + yeniden iletim [periyodik]); hücre: düşen+hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]');
  console.log('Veri girdiği uydunun tamponunda kalır (uydu tamponları ayrı). "havuz" = Aşama 9 projeksiyonu (uydu tamponları birbirinin yerine kullanılabilir sayılır), "ayrı" = separateRelays.');
  const ROUTES: [string, ReturnType<typeof routingConfig> | undefined][] = [
    ['çizelge seçimi (Aşama 9)', undefined],
    ['en az dolu tamponlu görünen uydu', routingConfig('leastFilled')],
    ['önce Dünya hattı açık, sonra en az dolu', routingConfig('openFirst')],
    ['çizelge seçimi + uydular arası bağlantı', routingConfig('timeline', true)],
    ['en az dolu + uydular arası bağlantı', routingConfig('leastFilled', true)],
  ];
  const PROJ: [string, Policy, ProjectionOptions | undefined][] = [
    ['öncelikli', 'priority', undefined],
    ['kayan ufuklu (havuz)', 'rolling', undefined],
    ['kayan ufuklu (ayrı)', 'rolling', { separateRelays: true }],
    ['uyarlamalı (havuz)', 'adaptive', undefined],
    ['uyarlamalı (ayrı)', 'adaptive', { separateRelays: true }],
  ];
  const nets: [string, NetOptions][] = [
    ['eliptik + 2. uydu (en iyi)', { moonOrbit: 'elliptical', moonSecond: 'best', moonIsl: true }],
    ['eliptik + 2. uydu (en iyi) + kutup aracı', { moonOrbit: 'elliptical', moonSecond: 'best', moonIsl: true, moonPolarAsset: true }],
    ['ekvatoral + 2. uydu (en iyi)', { moonSecond: 'best', moonIsl: true }],
  ];
  const kind = (net: NetOptions) => net;
  for (const [nn, net] of nets) {
    for (const n of [1, 2, 3]) {
      const sc = moonScn(undefined, undefined, net);
      console.log(`### ${nn}, ${n} istasyon`);
      const cov = coverageRow(tracks, sc.startJD, sc.endJD, n, net);
      console.log('(uydu başına Dünya hattı açık %: ' + Object.entries(cov.up).filter(([k]) => k.startsWith('ay-')).map(([k, v]) => `${k} ${f((100 * v) / cov.steps, 1)}`).join(', ') + ')');
      console.log('| Uydu seçimi | ' + PROJ.map((p) => p[0]).join(' | ') + ' |');
      for (const [rn, rc] of ROUTES) {
        const cells = PROJ.map(([, pol, pj]) => cell(run(sc, n, pol, { projection: pj, cfg: rc ? { routing: rc } : undefined }).m));
        console.log(`| ${rn} | ${cells.join(' | ')} |`);
      }
    }
  }
  // kontrol: tek ekvatoral uydu, 2× kapasite
  for (const n of [1, 2, 3]) {
    const sc = moonScn();
    const p = HYPOTHETICAL.scheduler;
    const par = { relayBufferMb: 2 * p.relayBufferMb['ay-aktarma'], relayDownlinkKbps: 2 * p.relayDownlinkKbps['ay-aktarma'] };
    console.log(`### kontrol: tek ekvatoral uydu, hat hızı ve tampon 2×, ${n} ist.: ` + (['priority', 'rolling', 'adaptive'] as Policy[]).map((pol) => `${pol} ${cell(run(sc, n, pol, { params: par }).m)}`).join(' | '));
  }
}

if (!only || only === 'presesyon') {
  console.log('## Madde 4a — Ay yörünge presesyonu (eliptik/kutupsal; RAAN hızı gün başına derece; epoch 2028-03-03; 60 g; 300 sn; hızlar UYDURMADIR)');
  for (const [nn, base] of [['eliptik, tek uydu', { moonOrbit: 'elliptical' as const }], ['eliptik + 2. uydu (en iyi)', { moonOrbit: 'elliptical' as const, moonSecond: 'best' as const }]] as [string, NetOptions][]) {
    for (const withPolar of [false, true]) {
      const lbl = `${nn}${withPolar ? ' + kutup aracı' : ''}`;
      console.log(`### ${lbl}: yüzey görüşü % (Ay Aracı A / İniş Aracı B${withPolar ? ' / Kutup Aracı C' : ''}); düşen+hatta / teslim (öncelikli) 1 ist. ve 3 ist.`);
      console.log('| RAAN hızı (°/gün) | Dünya hattı açık % (1 ist., uydu 1) | yüzey görüşü % | 1 ist.: öncelikli | 3 ist.: öncelikli |');
      const rates: (number | 'yok')[] = ['yok', ...HYPOTHETICAL.moonPrecession.scan];
      for (const r of rates) {
        const net: NetOptions = { ...base, ...(withPolar ? { moonPolarAsset: true } : {}), ...(r === 'yok' ? {} : { moonPrecession: { raanRateDegPerDay: r } }) };
        const sc = moonScn(undefined, undefined, net);
        const cov = coverageRow(tracks, sc.startJD, sc.endJD, 1, net);
        const ids = Object.keys(cov.surf).filter((k) => k.startsWith('ay-'));
        const m1 = run(sc, 1, 'priority').m, m3 = run(sc, 3, 'priority').m;
        console.log(`| ${r === 'yok' ? 'yok (sabit düzlem)' : f(r, 1)} | ${pc(cov.up['ay-aktarma'], cov.steps)} | ${ids.map((k) => pc(cov.surf[k], cov.steps)).join(' / ')} | ${f(m1.dropPct + m1.abandonedPct)} / ${f(m1.deliveredPct)} | ${f(m3.dropPct + m3.abandonedPct)} / ${f(m3.deliveredPct)} |`);
      }
    }
  }
  // genelleme: başka bir başlangıç tarihi (epoch'tan 6 yıl sonra), varsayılan hız
  console.log('### genelleme: başka başlangıç (2034-05-01, epoch\'tan ~6 yıl sonra) — presesyon −1 °/gün; eliptik tek uydu; B aracı yüzey görüşü %');
  for (const net of [{ moonOrbit: 'elliptical' as const }, { moonOrbit: 'elliptical' as const, moonPrecession: true }] as NetOptions[]) {
    const sc = moonScn('2034-05-01', 60, net);
    const cov = coverageRow(tracks, sc.startJD, sc.endJD, 1, net);
    console.log(`  ${net.moonPrecession ? 'presesyonlu' : 'sabit düzlem'}: A ${pc(cov.surf['ay-1'], cov.steps)} / B ${pc(cov.surf['ay-2'], cov.steps)}; öncelikli 3 ist. düşen ${f(run(sc, 3, 'priority').m.dropPct)}`);
  }
}

if (!only || only === 'golge') {
  console.log(`## Madde 4b — Mars eksen eğikliği (eksen ekliptik kutbundan ${f(marsAxisTiltDeg(), 1)}° eğik; yön VARSAYIM) ve gölge`);
  // mevsimsel gölge oranı: 20 günlük pencereler, 30 dk adım
  console.log('### Mars aktarma uydusu gölgede/cisim arkasında/hat açık oranı, 20 günlük pencereler (başlangıç 2029-06-01 + k×57 g), 1 istasyon');
  console.log('| pencere | eksen paralel: gölge % / cisim arkası % / hat açık % | eksen eğik: gölge % / cisim arkası % / hat açık % |');
  const frac = (jd0: number, o: NetOptions) => {
    let n = 0, sh = 0, oc = 0, up = 0;
    for (let jd = jd0; jd < jd0 + 20; jd += 1 / 48) { n++; const rs = computeNetwork(tracks, jd, 1, { marsEclipse: 'earth', ...o }).relayStates.find((r) => r.relay.id === MARS_RELAY)!; if (rs.eclipsed) sh++; if (rs.earthLink === 'occulted') oc++; if (rs.earthLink === 'up') up++; }
    return `${pc(sh, n)} / ${pc(oc, n)} / ${pc(up, n)}`;
  };
  const j0 = jdOf(HYPOTHETICAL.marsFreeScenario.defaultStart);
  for (let k = 0; k < 13; k++) console.log(`| ${new Date((j0 + k * 57 - 2440587.5) * 86400000).toISOString().slice(0, 10)} | ${frac(j0 + k * 57, {})} | ${frac(j0 + k * 57, { marsAxis: 'tilted' })} |`);

  console.log('### Senaryo sonuçları — kavuşumsuz aralık (2029-06-01, 60 g) ve kavuşum penceresi (2028-03-08); düşen+hatta / toplam / teslim [üretilmeyen]; 300 sn');
  const modes: [string, NetOptions][] = [
    ['gölge yok, eksen paralel', {}],
    ['gölge yok, eksen eğik', { marsAxis: 'tilted' }],
    ["gölgede Dünya hattı kapalı ('earth'), eksen paralel", { marsEclipse: 'earth' }],
    ["gölgede Dünya hattı kapalı ('earth'), eksen eğik", { marsEclipse: 'earth', marsAxis: 'tilted' }],
    ["gölgede yüzey + Dünya hattı kapalı ('both'), eksen eğik", { marsEclipse: 'both', marsAxis: 'tilted' }],
    ["güç modeli ('power'), eksen paralel", { marsEclipse: 'power' }],
    ["güç modeli ('power'), eksen eğik", { marsEclipse: 'power', marsAxis: 'tilted' }],
  ];
  for (const [nm, mk] of [['kavuşumsuz aralık 2029-06-01 (60 g)', (net: NetOptions) => marsFree(net)], ['kavuşum penceresi 2028-03-08', (net: NetOptions) => marsScn(undefined, net)]] as [string, (n: NetOptions) => Scn][]) {
    for (const n of [1, 3]) {
      console.log(`#### ${nm}, ${n} istasyon`);
      console.log('| Yapılandırma | Dünya hattı açık % | yüzey görüşü % (A / B) | öncelikli | kayan ufuklu | uyarlamalı |');
      for (const [mn, net] of modes) {
        const sc = mk(net);
        const cov = coverageRow(tracks, sc.startJD, sc.endJD, n, net);
        console.log(`| ${mn} | ${pc(cov.up[MARS_RELAY], cov.steps)} | ${pc(cov.surf['mars-1'], cov.steps)} / ${pc(cov.surf['mars-2'], cov.steps)} | ${(['priority', 'rolling', 'adaptive'] as Policy[]).map((p) => cell(run(sc, n, p, { rollingDays: 30 }).m)).join(' | ')} |`);
      }
    }
  }
}

if (!only || only === 'guc') {
  console.log('## Madde 4c — güç modeli: batarya kapasitesi taraması (kavuşumsuz aralık 2029-06-01, 60 g; 1 ve 3 istasyon; 300 sn; eksen paralel ve eğik)');
  console.log('| Batarya (Wh) | eksen | Dünya hattı açık % (1 ist.) | güç nedeniyle hat kapalı % (adım) | öncelikli 1 ist. | öncelikli 3 ist. |');
  for (const ax of ['parallel', 'tilted'] as const) for (const wh of [...HYPOTHETICAL.marsPower.scanBatteryWh, 'gölgede kapalı (earth)' as const]) {
    const net: NetOptions = wh === 'gölgede kapalı (earth)' ? { marsEclipse: 'earth', marsAxis: ax } : { marsEclipse: 'power', marsAxis: ax, marsPowerBatteryWh: wh };
    const sc = marsFree(net);
    const cov = coverageRow(tracks, sc.startJD, sc.endJD, 1, net);
    // güç nedeniyle kapalı oranı: aynı modelde 'eclipse' durumu
    let off = 0, n = 0;
    {
      const pw = new MarsPower(wh === 'gölgede kapalı (earth)' ? undefined : { ...HYPOTHETICAL.marsPower, batteryWh: wh as number });
      for (let jd = sc.startJD; jd < sc.endJD; jd += 1 / 48) { n++; const st = computeNetwork(tracks, jd, 1, wh === 'gölgede kapalı (earth)' ? net : { ...net, marsEclipse: 'power' }); if (wh !== 'gölgede kapalı (earth)') applyPower(st, pw, 1800); if (st.relayStates.find((r) => r.relay.id === MARS_RELAY)!.earthLink === 'eclipse') off++; }
    }
    console.log(`| ${wh} | ${ax === 'tilted' ? 'eğik' : 'paralel'} | ${pc(cov.up[MARS_RELAY], cov.steps)} | ${pc(off, n)} | ${cell(run(sc, 1, 'priority').m)} | ${cell(run(sc, 3, 'priority').m)} |`);
  }
}

if (!only || only === 'telemetri') {
  console.log('## Madde 5 — telemetri denemesi (300 sn, hatalı + yeniden iletim [periyodik]); telemetri p95 gecikme (sn) ve bilim verisi değeri (sabit değer; azalan değer 14 g yarı ömür)');
  const cases: [string, Scn, number][] = [['Ay 2028-03-03, 1 ist.', moonScn(), 1], ['Mars 2028, 1 ist.', marsScn(), 1], ['Mars 2028, 3 ist.', marsScn(), 3]];
  const tw = { weightOf: (p: { id: string; weight: number }) => p.weight };
  const val = (m: ReturnType<typeof run>['m']) => `${f(valuePct(m, tw), 1)} / ${f(valuePct(m, { ...tw, halfLifeIdx: 2 }), 1)}`;
  const cls = HYPOTHETICAL.scheduler.classes;
  for (const [name, sc, n] of cases) {
    console.log(`### ${name}`);
    console.log('| Deney | Politika | düşen+hatta / toplam / teslim [üretilmeyen] | telemetri düşen+hatta % | telemetri üretilmeyen % | telemetri gecikme p95 (sn) | değer % (sabit / azalan 14 g) |');
    const row = (label: string, pol: Policy, o: Parameters<typeof run>[3] = {}) => { const m = run(sc, n, pol, o).m; console.log(`| ${label} | ${pol} | ${cell(m)} | ${f(m.topDropPct, 2)} | ${f(m.topSuppressedPct, 1)} | ${f(m.topP95Sec, 0)} | ${val(m)} |`); };
    for (const pm of HYPOTHETICAL.telemetry.packetMb) for (const pol of ['priority', 'adaptive'] as Policy[]) row(`telemetri paketi ${pm} Mb`, pol, { classes: cls.map((c, i) => (i === 0 ? { ...c, packetMb: pm } : c)) });
    for (const sh of HYPOTHETICAL.telemetry.reservedShare) for (const pol of ['fifo', 'priority'] as Policy[]) row(`ayrılmış telemetri payı ${sh}`, pol, { cfg: { telemetryShare: sh } });
    for (const mf of HYPOTHETICAL.telemetry.minFactor) for (const pol of ['adaptive'] as Policy[]) row(`telemetri de kısılır (alt sınır ${mf})`, pol, { cfg: { telemetryMinFactor: mf } });
  }
}
