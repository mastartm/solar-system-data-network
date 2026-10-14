// Aşama 11 (madde 2) sonuçları: takvim hatasını gözlemden düzeltme, gerçek Horizons dosyalarıyla (public/data):
//   npx vite-node scripts/asama11-sonuclar.ts [duzeltme]
// Çıktıdaki tüm sayılar VARSAYIMSALDIR (src/config/hypothetical.ts); gerçek bir görev sonucu değildir. Horizons'a erişmez.
import { HYPOTHETICAL } from '../src/config/hypothetical';
import type { AdaptiveRobustConfig, ForecastError, Policy } from '../src/network/scheduler';
import type { Metrics } from '../src/network/sweep';
import { adaptiveRobustConfig, correctConfig } from '../src/network/timeline';
import { f, isoOf, marsScn, moonScn, run, windows, type Scn } from './asama9-lib';

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
void DAY;
