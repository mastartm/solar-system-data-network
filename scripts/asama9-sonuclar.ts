// Aşama 9 sonuçlarını gerçek Horizons dosyalarıyla (public/data) betikle üretir:
//   npx vite-node scripts/asama9-sonuclar.ts [projeksiyon|deger|adaptif|yorunge|golge|genelleme|tahmin-genelleme]
// Çıktıdaki tüm sayılar VARSAYIMSALDIR (src/config/hypothetical.ts); gerçek bir görev sonucu değildir. Horizons'a erişmez, dosyaları okur.
import { HYPOTHETICAL } from '../src/config/hypothetical';
import type { ProjectionOptions, Policy } from '../src/network/scheduler';
import { coverageRow } from '../src/network/coverage';
import { computeNetwork, type NetOptions } from '../src/network/network';
import { valuePct, type Metrics } from '../src/network/sweep';
import { tracks, w2028, windows, jdOf, isoOf } from './asama9-lib';
import { cell, f, moonScn, marsScn, run, type Scn } from './asama9-lib';

const only = process.argv[2];

if (!only || only === 'projeksiyon') {
  // Madde 1: iyimser varsayımların kaldırılması. 'coverage' (yalnızca Mars: Ay'da kesinti işareti yok), 'rolling' ve 'adaptive'.
  console.log('## Madde 1 — projeksiyon seçenekleri (300 sn, hatalı + yeniden iletim [periyodik]); hücre: düşen+hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]');
  const OPT: [string, ProjectionOptions][] = [['varsayılan (Aşama 8)', {}], ['yüzey hattı kapalılığı', { surfaceClosure: true }], ['ARQ kopyası RTT tampon', { arqHold: true }], ['ikisi birden', { surfaceClosure: true, arqHold: true }]];
  const maxd: Record<string, number> = {};
  for (const [name, sc, pols] of [
    ['Ay 2028-03-03, 60 gün', moonScn(), ['rolling', 'adaptive']],
    ['Mars 2028-03-08 penceresi', marsScn(), ['coverage', 'rolling', 'adaptive']],
  ] as [string, Scn, Policy[]][]) {
    for (const p of pols) {
      console.log(`### ${name} — ${p}`);
      console.log('| İst. | ' + OPT.map((o) => o[0]).join(' | ') + ' | öncelikli (referans) |');
      for (const n of [1, 2, 3]) {
        const ms = OPT.map(([, po]) => run(sc, n, p, { projection: po }).m);
        ms.slice(1).forEach((m, j) => {
          for (const [k, v] of Object.entries({ düşen: m.dropPct + m.abandonedPct - ms[0].dropPct - ms[0].abandonedPct, toplam: m.lossPct - ms[0].lossPct, teslim: m.deliveredPct - ms[0].deliveredPct, üretilmeyen: (m.suppressedMb - ms[0].suppressedMb) / (m.demandMb || 1) * 100 })) {
            const key = `${OPT[j + 1][0]}|${k}`;
            maxd[key] = Math.max(maxd[key] ?? 0, Math.abs(v));
          }
        });
        console.log(`| ${n} | ${ms.map(cell).join(' | ')} | ${cell(run(sc, n, 'priority').m)} |`);
      }
    }
  }
  console.log('### Varsayılana göre en büyük mutlak fark (puan; yukarıdaki tüm hücreler):');
  for (const [k, v] of Object.entries(maxd)) console.log(`  ${k}: ${f(v, 3)}`);
}

if (!only || only === 'adaptif') {
  console.log('## Madde 2b — uyarlamalı ufuk (adaptive) — düşen+hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]');
  const POL: Policy[] = ['priority', 'strategy', 'coverage', 'rolling', 'adaptive'];
  for (const [name, sc] of [['Ay 2028-03-03, 60 g', moonScn()], ['Mars 2028-03-08', marsScn()]] as [string, Scn][]) {
    console.log(`### ${name}`);
    console.log('| İst. | ' + POL.join(' | ') + ' |');
    for (const n of [1, 2, 3]) console.log(`| ${n} | ${POL.map((p) => cell(run(sc, n, p).m)).join(' | ')} |`);
    console.log(`#### adaptive duyarlılık (tailFactor / minDays / leadDays), 1 ve 3 istasyon`);
    for (const n of [1, 3]) {
      for (const tf of [0, 0.25, 0.5, 1, 2]) console.log(`  ${n} ist. tailFactor ${tf}: ${cell(run(sc, n, 'adaptive', { adaptive: { tailFactor: tf } }).m)}`);
      for (const md of [0.5, 1, 3]) console.log(`  ${n} ist. minDays ${md}: ${cell(run(sc, n, 'adaptive', { adaptive: { minSec: md * 86400 } }).m)}`);
      for (const ld of [0.25, 1, 3]) console.log(`  ${n} ist. leadDays ${ld}: ${cell(run(sc, n, 'adaptive', { adaptive: { leadSec: ld * 86400 } }).m)}`);
    }
  }
}

if (!only || only === 'deger') {
  console.log('## Madde 2 — değer ağırlıklı fayda: değer % = teslim edilen değer / talep edilen değer (telemetri ağırlığı w_t, bilim verisi = 1; bilim verisi isteğe bağlı 2^(−yaş/yarı ömür))');
  const POL: Policy[] = ['fifo', 'priority', 'strategy', 'coverage', 'rolling', 'adaptive'];
  const hl = HYPOTHETICAL.value.decayOptionsDays;
  for (const [name, sc, pols] of [['Ay 2028-03-03, 60 g', moonScn(), ['fifo', 'priority', 'rolling', 'adaptive']], ['Mars 2028-03-08', marsScn(), POL]] as [string, Scn, Policy[]][]) {
    for (const n of [1, 3]) {
      const ms = Object.fromEntries(pols.map((p) => [p, run(sc, n, p).m])) as Record<Policy, Metrics>;
      console.log(`### ${name}, ${n} istasyon — teslim % (hacim): ` + pols.map((p) => `${p} ${f(ms[p].deliveredPct)}`).join(' · '));
      const hdr = ['w_t', 'yarı ömür', ...pols.map((p) => p)];
      console.log('| ' + hdr.join(' | ') + ' |');
      for (const wt of HYPOTHETICAL.value.telemetryWeightScan) {
        for (const h of [undefined, ...hl.map((_, i) => i)]) {
          const o = { weightOf: (p: { id: string; weight: number }) => (p.id === 'telemetri' ? wt : 1), halfLifeIdx: h };
          const base = valuePct(ms.priority, o);
          console.log(`| ${wt} | ${h === undefined ? 'sabit' : hl[h] + ' g'} | ` + pols.map((p) => { const v = valuePct(ms[p], o); return `${f(v)}${p === 'priority' ? '' : ` (${v - base >= 0 ? '+' : ''}${f(v - base, 2)})`}`; }).join(' | ') + ' |');
        }
      }
    }
  }
}

if (!only || only === 'yorunge') {
  console.log('## Madde 3 — Ay aktarma uydusu yörüngesi: kapsama ve teslim/kayıp (2028-03-03, 60 gün, hatalı + yeniden iletim [periyodik], 300 sn)');
  const CFG: [string, NetOptions, boolean?][] = [
    ['ekvatoral dairesel (mevcut)', {}],
    ['eğimli/eliptik (kutupsal, apolün güneyde)', { moonOrbit: 'elliptical' }],
    ['ekvatoral + 2. uydu (en iyi görünen)', { moonSecond: 'best' }],
    ['ekvatoral + 2. uydu (hat sırası)', { moonSecond: 'order' }],
    ['eliptik + 2. uydu (en iyi görünen)', { moonOrbit: 'elliptical', moonSecond: 'best' }],
    ['eliptik + 2. uydu (hat sırası)', { moonOrbit: 'elliptical', moonSecond: 'order' }],
  ];
  const days = HYPOTHETICAL.moonScenario.defaultDays;
  for (const polar of [false, true]) {
    console.log(`### ${polar ? 'Kutup aracı C EKLİ (3 araç)' : '2 araç (mevcut)'}`);
    for (const n of [1, 2, 3]) {
      console.log(`#### ${n} istasyon`);
      console.log('| Yapılandırma | uyduyu gören ist. % (uydu1 / uydu2) | Dünya hattı açık % (uydu1 / uydu2 / herhangi) | yüzey görüşü % (araçlar) | araç→Dünya yolu açık % (araçlar) | öncelikli | rolling | adaptive |');
      for (const [name, net0] of CFG) {
        const net: NetOptions = { ...net0, ...(polar ? { moonPolarAsset: true } : {}) };
        const sc = moonScn(HYPOTHETICAL.moonScenario.defaultStart, days, net);
        const cov = coverageRow(tracks, sc.startJD, sc.endJD, n, net);
        const pc = (v: number) => f((100 * v) / cov.steps);
        const r1 = 'ay-aktarma', r2 = HYPOTHETICAL.moonRelay2.id;
        const assets = Object.keys(cov.surf).filter((a) => a.startsWith('ay-'));
        console.log(`| ${name} | ${pc(cov.see[r1])}${cov.see[r2] !== undefined ? ' / ' + pc(cov.see[r2]) : ''} | ${pc(cov.up[r1])}${cov.up[r2] !== undefined ? ' / ' + pc(cov.up[r2]) : ''} / ${pc(cov.anyUp)} | ${assets.map((a) => pc(cov.surfAny[a])).join(' / ')} | ${assets.map((a) => pc(cov.pathUp[a])).join(' / ')} | ${(['priority', 'rolling', 'adaptive'] as Policy[]).map((p) => cell(run(sc, n, p).m)).join(' | ')} |`);
      }
      // kapasite kontrolü: tek ekvatoral uydu, hat hızı ve tampon iki katı
      const sc0 = moonScn(HYPOTHETICAL.moonScenario.defaultStart, days, polar ? { moonPolarAsset: true } : undefined);
      const p0 = { relayBufferMb: 2 * HYPOTHETICAL.scheduler.relayBufferMb['ay-aktarma'], relayDownlinkKbps: 2 * HYPOTHETICAL.scheduler.relayDownlinkKbps['ay-aktarma'] };
      console.log(`| (kontrol) tek ekvatoral uydu, hat hızı ve tampon 2× | — | — | — | — | ${(['priority', 'rolling', 'adaptive'] as Policy[]).map((p) => cell(run(sc0, n, p, { params: p0 }).m)).join(' | ')} |`);
    }
  }
}

if (!only || only === 'golge') {
  console.log('## Madde 3 — Mars aktarma uydusu gölgesi (silindirik; güç modeli yok) — Mars 2028-03-08 penceresi, hatalı + yeniden iletim [periyodik], 300 sn');
  const MODES: [string, NetOptions][] = [['gölge yok (mevcut)', {}], ['gölgede yalnız Dünya hattı kapalı', { marsEclipse: 'earth' }], ['gölgede yüzey + Dünya hattı kapalı', { marsEclipse: 'both' }]];
  for (const n of [1, 2, 3]) {
    console.log(`### ${n} istasyon`);
    console.log('| Yapılandırma | uyduyu gören ist. % | Dünya hattı açık % | yüzey görüşü % (araçlar) | öncelikli | strateji | kapsama bilen | kayan ufuklu | uyarlamalı |');
    for (const [name, net] of MODES) {
      const sc = marsScn(w2028, net);
      const cov = coverageRow(tracks, sc.startJD, sc.endJD, n, net);
      const pc = (v: number) => f((100 * v) / cov.steps);
      const assets = Object.keys(cov.surf).filter((a) => a.startsWith('mars-'));
      console.log(`| ${name} | ${pc(cov.see['mars-aktarma'])} | ${pc(cov.up['mars-aktarma'])} | ${assets.map((a) => pc(cov.surf[a])).join(' / ')} | ${(['priority', 'strategy', 'coverage', 'rolling', 'adaptive'] as Policy[]).map((p) => cell(run(sc, n, p).m)).join(' | ')} |`);
    }
  }
  // Kavuşumdan uzak bir aralık: Dünya ile Güneş'in Mars'tan görünen yönleri ayrı olduğundan gölge, cisim arkası kapanmasıyla örtüşmez.
  console.log(`### Kavuşumdan uzak aralık (${HYPOTHETICAL.marsFreeScenario.defaultStart}, ${HYPOTHETICAL.marsFreeScenario.defaultDays} gün; kavuşum yok, strateji/kapsama bilen = öncelikli)`);
  console.log('| İstasyon | Yapılandırma | Dünya hattı açık % | yüzey görüşü % (araçlar) | öncelikli | kayan ufuklu | uyarlamalı |');
  for (const n of [1, 3]) for (const [name, net] of MODES) {
    const sc: Scn = { kind: 'mars', relay: 'mars-aktarma', startJD: jdOf(HYPOTHETICAL.marsFreeScenario.defaultStart), endJD: jdOf(HYPOTHETICAL.marsFreeScenario.defaultStart) + HYPOTHETICAL.marsFreeScenario.defaultDays, net };
    const cov = coverageRow(tracks, sc.startJD, sc.endJD, n, net);
    const pc = (v: number) => f((100 * v) / cov.steps);
    const assets = Object.keys(cov.surf).filter((a) => a.startsWith('mars-'));
    console.log(`| ${n} | ${name} | ${pc(cov.up['mars-aktarma'])} | ${assets.map((a) => pc(cov.surf[a])).join(' / ')} | ${(['priority', 'rolling', 'adaptive'] as Policy[]).map((p) => cell(run(sc, n, p).m)).join(' | ')} |`);
  }
  // gölgenin kendi büyüklüğü: uydu gölgede geçen süre oranı (Dünya hattının başka nedenle kapalı olması bunu değiştirmez) ve bunun ne kadarı Dünya hattını ZATEN kapalı bırakan nedenlerle (cisim arkası) örtüşüyor
  const net = { marsEclipse: 'earth' } as NetOptions;
  let inSh = 0, shAndOcc = 0, tot = 0;
  const jd0 = w2028.startJD - 5;
  for (let jd = jd0; jd < jd0 + 35; jd += 1 / 288) {
    tot++;
    const rs = computeNetwork(tracks, jd, 0, net).relayStates.find((r) => r.relay.id === 'mars-aktarma')!;
    const rs0 = computeNetwork(tracks, jd, 0).relayStates.find((r) => r.relay.id === 'mars-aktarma')!;
    if (rs.eclipsed) { inSh++; if (rs0.earthLink !== 'up') shAndOcc++; }
  }
  console.log(`Gölgede geçen süre oranı (istasyon modeli kapalı, senaryo aralığı 35 gün): %${f((100 * inSh) / tot)}; bunun %${f((100 * shAndOcc) / Math.max(1, inSh))}'i gölge olmasa da Dünya hattı kapalıydı (kavuşum / cisim arkası).`);
}

const stat = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return { min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1], mean: v.reduce((a, b) => a + b, 0) / v.length }; };
const fs = (v: number[], d = 1) => { const t = stat(v); return `${f(t.min, d)} / ${f(t.med, d)} / ${f(t.max, d)}`; };

if (!only || only === 'genelleme') {
  console.log('## Madde 4a — genelleme: hata yokken karşılaştırma (düşen+hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %])');
  const hl14 = HYPOTHETICAL.value.decayOptionsDays.indexOf(14);
  console.log('### Ay (60 gün, hatalı + yeniden iletim [periyodik], 300 sn)');
  const POLM: Policy[] = ['fifo', 'priority', 'rolling', 'adaptive'];
  for (const n of [1, 2]) {
    console.log(`#### ${n} istasyon`);
    console.log('| Başlangıç | Hat açık % | ' + POLM.join(' | ') + ' | değer% (w_t=4): öncelikli → uyarlamalı (sabit / 14 g) |');
    const diffs: Record<string, number[]> = { dropR: [], dropA: [], totR: [], totA: [], delR: [], delA: [], vA: [], vD: [] };
    for (const iso of HYPOTHETICAL.generalization.moonStarts) {
      const sc = moonScn(iso, HYPOTHETICAL.generalization.moonDays);
      const rs = POLM.map((p) => run(sc, n, p));
      const m = Object.fromEntries(POLM.map((p, i) => [p, rs[i].m])) as Record<Policy, Metrics>;
      diffs.dropR.push(m.rolling.dropPct + m.rolling.abandonedPct - m.priority.dropPct - m.priority.abandonedPct);
      diffs.dropA.push(m.adaptive.dropPct + m.adaptive.abandonedPct - m.priority.dropPct - m.priority.abandonedPct);
      diffs.totR.push(m.rolling.lossPct - m.priority.lossPct); diffs.totA.push(m.adaptive.lossPct - m.priority.lossPct);
      diffs.delR.push(m.rolling.deliveredPct - m.priority.deliveredPct); diffs.delA.push(m.adaptive.deliveredPct - m.priority.deliveredPct);
      diffs.vA.push(valuePct(m.adaptive) - valuePct(m.priority)); diffs.vD.push(valuePct(m.adaptive, { halfLifeIdx: hl14 }) - valuePct(m.priority, { halfLifeIdx: hl14 }));
      console.log(`| ${iso} | ${f(rs[0].open * 100)} | ${POLM.map((p) => cell(m[p])).join(' | ')} | ${f(valuePct(m.priority))} → ${f(valuePct(m.adaptive))} / ${f(valuePct(m.priority, { halfLifeIdx: hl14 }))} → ${f(valuePct(m.adaptive, { halfLifeIdx: hl14 }))} |`);
    }
    console.log(`Özet (min / medyan / maks; puan farkı, kayan ufuklu − öncelikli ve uyarlamalı − öncelikli): düşen ${fs(diffs.dropR)} | ${fs(diffs.dropA)} · toplam kayıp ${fs(diffs.totR, 2)} | ${fs(diffs.totA, 2)} · teslim ${fs(diffs.delR, 2)} | ${fs(diffs.delA, 2)} · değer (sabit) ${fs(diffs.vA, 2)} · değer (14 g) ${fs(diffs.vD, 2)}`);
  }
  console.log('### Mars: 9 kavuşum penceresi (1800 sn tarama adımı, kayan ufuk 30 gün [Aşama 8 ile aynı], hatalı + yeniden iletim [periyodik])');
  const POLR: Policy[] = ['priority', 'strategy', 'coverage', 'rolling', 'adaptive'];
  for (const n of [1, 3]) {
    console.log(`#### ${n} istasyon`);
    console.log('| Pencere | Hat açık % | ' + POLR.join(' | ') + ' | değer% (14 g): öncelikli → uyarlamalı |');
    const d: Record<string, number[]> = { dropC: [], dropR: [], dropA: [], totC: [], totR: [], totA: [], delC: [], delR: [], delA: [], vD: [] };
    for (const w of windows) {
      const sc = marsScn(w);
      const rs = POLR.map((p) => run(sc, n, p, { step: 1800, rollingDays: 30 }));
      const m = Object.fromEntries(POLR.map((p, i) => [p, rs[i].m])) as Record<Policy, Metrics>;
      const dr = (x: Metrics) => x.dropPct + x.abandonedPct;
      d.dropC.push(dr(m.coverage) - dr(m.priority)); d.dropR.push(dr(m.rolling) - dr(m.priority)); d.dropA.push(dr(m.adaptive) - dr(m.priority));
      d.totC.push(m.coverage.lossPct - m.priority.lossPct); d.totR.push(m.rolling.lossPct - m.priority.lossPct); d.totA.push(m.adaptive.lossPct - m.priority.lossPct);
      d.delC.push(m.coverage.deliveredPct - m.priority.deliveredPct); d.delR.push(m.rolling.deliveredPct - m.priority.deliveredPct); d.delA.push(m.adaptive.deliveredPct - m.priority.deliveredPct);
      d.vD.push(valuePct(m.adaptive, { halfLifeIdx: hl14 }) - valuePct(m.priority, { halfLifeIdx: hl14 }));
      console.log(`| ${isoOf(w.startJD)} | ${f(rs[0].open * 100)} | ${POLR.map((p) => cell(m[p])).join(' | ')} | ${f(valuePct(m.priority, { halfLifeIdx: hl14 }))} → ${f(valuePct(m.adaptive, { halfLifeIdx: hl14 }))} |`);
    }
    console.log(`Özet (min / medyan / maks; puan farkı, politika − öncelikli): düşen kapsama ${fs(d.dropC)} · kayan(30 g) ${fs(d.dropR)} · uyarlamalı ${fs(d.dropA)}; toplam kayıp kapsama ${fs(d.totC, 2)} · kayan ${fs(d.totR, 2)} · uyarlamalı ${fs(d.totA, 2)}; teslim kapsama ${fs(d.delC, 2)} · kayan ${fs(d.delR, 2)} · uyarlamalı ${fs(d.delA, 2)}; değer(14 g) uyarlamalı ${fs(d.vD, 2)}`);
  }
}

if (!only || only === 'tahmin-genelleme') {
  console.log('## Madde 4a — tahmin hatası genellemesi (tarama adımı 600 sn; kayan ufuk 3 gün [Ay], 30 gün [Mars]; pencere başı/sonu kayması dk, + iyimser)');
  const EPS = 0.1;
  const grid = [-240, -120, -60, 0, 60, 120, 240];
  const dr = (x: Metrics) => x.dropPct + x.abandonedPct;
  const step = HYPOTHETICAL.forecastScan.stepSec;
  const cases: [string, Scn, number][] = [
    ...HYPOTHETICAL.generalization.moonStarts.map((iso) => [`Ay ${iso}`, moonScn(iso, HYPOTHETICAL.generalization.moonDays), 1] as [string, Scn, number]),
    ...windows.map((w) => [`Mars ${isoOf(w.startJD)}`, marsScn(w), 1] as [string, Scn, number]),
  ];
  console.log('| Senaryo (1 ist.) | öncelikli | politika | hata yokken (düşen / toplam / teslim [üretilmeyen]) | −240 dk | −120 dk | +120 dk | +240 dk | toplam kayıp farkı, en kötü |hata| ≤ 120 dk (puan; öncelikli ref.) | toplam kayıp farkı, −240 dk | düşen > öncelikli olduğu en küçük |hata| |');
  const worst: Record<string, number[]> = {}, dropWorse: Record<string, number> = {};
  for (const [name, sc, n] of cases) {
    const pr = run(sc, n, 'priority', { step }).m;
    const pols: [Policy, number][] = sc.kind === 'mars' ? [['coverage', 0], ['rolling', 30], ['adaptive', 0]] : [['rolling', 3], ['adaptive', 0]];
    for (const [pol, rd] of pols) {
      const ms = grid.map((v) => ({ v, m: run(sc, n, pol, { step, rollingDays: rd || undefined, forecast: { edgeShiftSec: v * 60 } }).m }));
      const z = ms.find((x) => x.v === 0)!.m;
      const at = (v: number) => ms.find((x) => x.v === v)!.m;
      const maxTot = Math.max(...ms.filter((x) => Math.abs(x.v) <= 120).map((x) => x.m.lossPct - pr.lossPct));
      const at240 = at(-240).lossPct - pr.lossPct;
      (worst[`${sc.kind}|${pol}|−240`] ??= []).push(at240);
      const firstDrop = ms.filter((x) => dr(x.m) - dr(pr) > EPS).sort((a, b) => Math.abs(a.v) - Math.abs(b.v))[0]?.v;
      (worst[`${sc.kind}|${pol}`] ??= []).push(maxTot);
      dropWorse[`${sc.kind}|${pol}`] = (dropWorse[`${sc.kind}|${pol}`] ?? 0) + (firstDrop !== undefined ? 1 : 0);
      console.log(`| ${name} | ${cell(pr)} | ${pol} | ${cell(z)} | ${cell(at(-240))} | ${cell(at(-120))} | ${cell(at(120))} | ${cell(at(240))} | ${f(maxTot, 2)} | ${f(at240, 2)} | ${firstDrop === undefined ? 'yok' : firstDrop} |`);
    }
  }
  console.log('Özet: toplam kayıp farkı (puan; min / medyan / maks; |hata| ≤ 120 dk içindeki en kötü, ve ayrıca −240 dk) ve "düşen öncelikliden kötü" olan senaryo sayısı:');
  for (const [k, v] of Object.entries(worst)) console.log(`  ${k}: ${fs(v, 2)}${k.endsWith('−240') ? '' : ` · düşen öncelikliden kötüleşen senaryo: ${dropWorse[k]} / ${v.length}`}`);
}

if (!only || only === 'deger-esik') {
  // Kısmanın değerce kazanç sağladığı koşul: yarı ömür ve telemetri ağırlığına göre kazanç (politika − öncelikli, puan) ve kazancın işaret değiştirdiği yarı ömür.
  console.log('## Madde 2a — kısma değerce ne zaman kazandırır? Kazanç = değer%(politika) − değer%(öncelikli), puan');
  const HL = [1, 2, 3, 5, 7, 10, 14, 20, 30, 45, 60, 90, 180, 365];
  const POL: Policy[] = ['strategy', 'coverage', 'rolling', 'adaptive'];
  for (const [name, sc, n, pols] of [
    ['Ay 2028-03-03 (60 g), 1 ist.', moonScn(), 1, ['rolling', 'adaptive']],
    ['Mars 2028, 1 ist.', marsScn(), 1, POL],
    ['Mars 2028, 2 ist.', marsScn(), 2, POL],
    ['Mars 2028, 3 ist.', marsScn(), 3, POL],
  ] as [string, Scn, number, Policy[]][]) {
    const cfgHL = { valueHalfLivesSec: HL.map((d) => d * 86400) };
    const pr = run(sc, n, 'priority', { cfg: cfgHL }).m;
    const ms = Object.fromEntries(pols.map((p) => [p, run(sc, n, p, { cfg: cfgHL }).m])) as Record<Policy, Metrics>;
    for (const wt of [1, 4, 16]) {
      const w = { weightOf: (p: { id: string; weight: number }) => (p.id === 'telemetri' ? wt : 1) };
      console.log(`### ${name}, w_t=${wt}: ` + 'sabit değer: ' + pols.map((p) => `${p} ${f(valuePct(ms[p], w) - valuePct(pr, w), 2)}`).join(' · '));
      console.log('| yarı ömür (gün) | ' + pols.join(' | ') + ' |');
      let line = '';
      for (let i = 0; i < HL.length; i++) line += `| ${HL[i]} | ${pols.map((p) => { const g = valuePct(ms[p], { ...w, halfLifeIdx: i }) - valuePct(pr, { ...w, halfLifeIdx: i }); return `${g >= 0 ? '+' : ''}${f(g, 2)}`; }).join(' | ')} |\n`;
      console.log(line.trimEnd());
    }
  }
}
