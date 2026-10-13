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
  console.log('### Kavuşumdan uzak aralık (2029-06-01, 35 gün; kavuşum yok, strateji/kapsama bilen = öncelikli)');
  console.log('| İstasyon | Yapılandırma | Dünya hattı açık % | yüzey görüşü % (araçlar) | öncelikli | kayan ufuklu | uyarlamalı |');
  for (const n of [1, 3]) for (const [name, net] of MODES) {
    const sc: Scn = { kind: 'mars', relay: 'mars-aktarma', startJD: jdOf('2029-06-01'), endJD: jdOf('2029-06-01') + 35, net };
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
