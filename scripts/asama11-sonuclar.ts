// Aşama 11 (madde 2) sonuçları: takvim hatasını gözlemden düzeltme, gerçek Horizons dosyalarıyla (public/data):
//   npx vite-node scripts/asama11-sonuclar.ts [duzeltme|deger]
// Çıktıdaki tüm sayılar VARSAYIMSALDIR (src/config/hypothetical.ts); gerçek bir görev sonucu değildir. Horizons'a erişmez.
import { HYPOTHETICAL } from '../src/config/hypothetical';
import type { AdaptiveRobustConfig, ForecastError, Policy } from '../src/network/scheduler';
import type { Metrics } from '../src/network/sweep';
import { valuePct } from '../src/network/sweep';
import type { ValueAwareConfig } from '../src/network/scheduler';
import { adaptiveRobustConfig, correctConfig, valueAwareConfig, valueHalfLivesSec, valueModelsConfig } from '../src/network/timeline';
import { cell, f, isoOf, marsScn, moonScn, run, windows, type Scn } from './asama9-lib';

const only = process.argv[2];
const DAY = 86400;
const step = HYPOTHETICAL.forecastScan.stepSec;
const dropOf = (m: Metrics) => m.dropPct + m.abandonedPct;
const sg = (x: number, d = 2) => `${x >= 0 ? '+' : '−'}${f(Math.abs(x), d)}`;
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];
const mm = (v: number[]) => `${sg(Math.min(...v))} / ${sg(med(v))} / ${sg(Math.max(...v))}`;
const NONE: Partial<AdaptiveRobustConfig> = { capSec: undefined, histFactor: undefined, trustMin: undefined, fallbackSec: undefined };
const COR = correctConfig();

if (!only || only === 'duzeltme') {
  console.log('## Madde 2 — takvim hatasını gözlemden düzeltme (600 sn; 1 istasyon; hatalı + yeniden iletim [periyodik]). Hata: pencere kenarı kayması (+ iyimser, − kötümser) ve pencere ötelemesi, dakika.');
  console.log(`Düzeltme: öğrenme penceresi ${HYPOTHETICAL.adaptiveRobust.correct.learnDays} g, en az ${COR.minWindows} pencere, |kayma| ≤ ${HYPOTHETICAL.adaptiveRobust.correct.maxShiftHours} sa.`);
  const VAR: [string, Policy, Partial<AdaptiveRobustConfig> | null][] = [
    ['uyarlamalı', 'adaptive', null],
    ['dayanıklı (Aşama 10 varsayılanı)', 'adaptiveRobust', {}],
    ['dayanıklı + düzeltme', 'adaptiveRobust', { correct: COR }],
    ['yalnız düzeltme (geri çekilme ve güven aralığı yok)', 'adaptiveRobust', { ...NONE, correct: COR }],
  ];
  const ERR: [string, (v: number) => ForecastError, number[]][] = [
    ['kenar kayması', (v) => ({ edgeShiftSec: v * 60 }), [-240, -120, -60, 60, 120]],
    ['öteleme', (v) => ({ offsetSec: v * 60 }), [-120, -60, 60, 120]],
  ];
  const cases: [string, Scn][] = [
    ...HYPOTHETICAL.generalization.moonStarts.map((iso) => [`Ay ${iso}`, moonScn(iso, HYPOTHETICAL.generalization.moonDays)] as [string, Scn]),
    ...windows.map((w) => [`Mars ${isoOf(w.startJD)}`, marsScn(w)] as [string, Scn]),
  ];
  for (const kind of ['moon', 'mars'] as const) {
    const cs = cases.filter(([, sc]) => sc.kind === kind);
    console.log(`### ${kind === 'moon' ? 'Ay' : 'Mars'} (${cs.length} senaryo)`);
    console.log('Hücre: toplam kayıp farkı, puan (öncelikliye göre; min / medyan / maks) | düşen+hatta % (medyan) | öncelikliden kötü senaryo sayısı (düşen+hatta)');
    console.log('| hata | ' + VAR.map((v) => v[0]).join(' | ') + ' |');
    const prs = cs.map(([, sc]) => run(sc, 1, 'priority', { step }).m);
    console.log(`| (öncelikli) | düşen+hatta ${f(med(prs.map(dropOf)), 1)} | | | |`);
    for (const [en, mkE, grid] of ERR) {
      for (const v of [0, ...grid]) {
        const cells = VAR.map(([, pol, over]) => {
          const ms = cs.map(([, sc]) => run(sc, 1, pol, { step, ...(v !== 0 ? { forecast: mkE(v) } : {}), ...(over ? { cfg: { adaptiveRobust: adaptiveRobustConfig(over) } } : {}) }).m);
          const worse = ms.filter((m, i) => dropOf(m) - dropOf(prs[i]) > 0.1).length;
          return `${mm(ms.map((m, i) => m.lossPct - prs[i].lossPct))} | ${f(med(ms.map(dropOf)), 1)} | ${worse}/${cs.length}`;
        });
        if (v === 0 && en !== ERR[0][0]) continue;
        console.log(`| ${v === 0 ? 'hata yok' : `${en} ${v > 0 ? '+' : '−'}${Math.abs(v)}`} | ${cells.join(' | ')} |`);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------ Madde 2: değer modelini sorgulamak
if (!only || only === 'deger') {
  const models = valueModelsConfig();
  const H0 = valueHalfLivesSec().length; // decayMb'de modeller bundan sonra
  const tw = { weightOf: (p: { id: string; weight: number }) => (p.id === 'telemetri' ? 4 : 1) }; // telemetri ağırlığı 4 (Aşama 10 ile aynı)
  const modelDays = (id: string) => { const m = HYPOTHETICAL.value.models.find((x) => x.id === id)!; return m.decay.kind === 'step' ? m.decay.deadlineDays : 0; };
  console.log('## Madde 2 — değer modelini sorgulamak: kuyruk kuralının kazancı gerçek değer modeline bağlı mı? (300 sn, hatalı + yeniden iletim [periyodik]; telemetri ağırlığı 4)');
  console.log('Hücre: değer kazancı (puan; politika − öncelikli, her satırın KENDİ gerçek değer modeline göre). Kurallar: A = Aşama 10 "hepsi" (en yeni önce + eşik 0,25 + en eskiyi at; kural üstel 14 g varsayar), B = yalnız en yeni önce,');
  console.log('C = son tarihe uyan kural (son tarih = gerçek modelin son tarihi: en yeni önce + son tarihte atma + en eskiyi at; yalnız basamak modelleri için), D = yalnız son tarihte atma. "kısma" = Aşama 9 uyarlamalı ufuk (üretilmeyen veri).');
  for (const [name, sc, n] of [['Ay 2028-03-03 (60 g)', moonScn(), 1], ['Mars 2028 kavuşum penceresi', marsScn(), 1], ['Mars 2028 kavuşum penceresi', marsScn(), 3]] as [string, Scn, number][]) {
    const cfgM = { valueModels: models };
    const pr = run(sc, n, 'priority', { cfg: cfgM }).m, ad = run(sc, n, 'adaptive', { cfg: cfgM }).m;
    const vaRun = (v: ValueAwareConfig) => run(sc, n, 'valueAware', { cfg: { ...cfgM, valueAware: v } }).m;
    const A = vaRun(valueAwareConfig(14 * DAY)), B = vaRun(valueAwareConfig(14 * DAY, { expireBelow: 0, evictOldest: false }));
    const deadlines = [...new Set(HYPOTHETICAL.value.models.map((m) => modelDays(m.id)).filter((d) => d > 0))];
    const C = new Map(deadlines.map((d) => [d, vaRun(valueAwareConfig(14 * DAY, { expireBelow: 0, expireAfterSec: d * DAY }))]));
    const Dm = new Map(deadlines.map((d) => [d, vaRun(valueAwareConfig(14 * DAY, { expireBelow: 0, expireAfterSec: d * DAY, newestFirst: false, evictOldest: false }))]));
    console.log(`### ${name}, ${n} istasyon — öncelikli: düşen+hatta / toplam / teslim [üretilmeyen] = ${cell(pr)}`);
    console.log('| gerçek değer modeli | kısma | A: hepsi (üstel 14 g varsayar) | B: yalnız en yeni önce | C: son tarihe uyan kural | D: yalnız son tarihte atma |');
    models.forEach((mo, j) => {
      const o = { ...tw, halfLifeIdx: H0 + j, topDecays: !!mo.top };
      const g = (m: Metrics) => sg(valuePct(m, o) - valuePct(pr, o));
      const d = modelDays(mo.id);
      console.log(`| ${HYPOTHETICAL.value.models[j].label} (öncelikli değer % ${f(valuePct(pr, o), 1)}) | ${g(ad)} | ${g(A)} | ${g(B)} | ${d > 0 ? g(C.get(d)!) : '—'} | ${d > 0 ? g(Dm.get(d)!) : '—'} |`);
    });
    const ex = (m: Metrics) => `${f(m.expiredPct, 1)}`;
    console.log(`Atılan %: A ${ex(A)}; ` + deadlines.map((d) => `son tarih ${d} g: C ${ex(C.get(d)!)} / D ${ex(Dm.get(d)!)}`).join('; ') + `. Teslim farkı (puan, öncelikliye göre): A ${sg(A.deliveredPct - pr.deliveredPct, 1)}, B ${sg(B.deliveredPct - pr.deliveredPct, 1)}, ` + deadlines.map((d) => `C(${d} g) ${sg(C.get(d)!.deliveredPct - pr.deliveredPct, 1)}`).join(', ') + '.');
  }
}
void DAY;
