import { describe, expect, it } from 'vitest';
import { simulate, type AdaptiveRobustConfig, type LinkSample, type SchedConfig, type SchedTopology } from './scheduler';
import { metricsOf } from './sweep';
import { correctConfig } from './timeline';

// BU TESTLER SENTETİKTİR: uydurma tek uydulu topoloji, uydurma hızlar ve periyodik hat boşlukları (gerçek Horizons verisi değil).
// Aşama 11: takvim hatasını gözlemden düzeltme (adaptiveRobust.correct).
const topo: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r', dataRateKbps: 1000 }], relays: ['r'] };
const cfg = (over: Partial<SchedConfig> = {}): SchedConfig => ({
  classes: [
    { id: 'tel', priority: 0, share: 0.2, packetMb: 1, valuePerMb: 4 },
    { id: 'sci', priority: 1, share: 0.8, packetMb: 10, valuePerMb: 1 },
  ],
  dutyCycle: 0.6,
  surfaceLinkKbps: { x: 5000 }, relayDownlinkKbps: { r: 2000 },
  assetBufferMb: { x: 100 }, relayBufferMb: { r: 200 },
  delayedAfterSec: 600, stepSec: 10, seriesEverySec: 100,
  adaptive: { minSec: 500, maxSec: 20000, leadSec: 1000, tailFactor: 1, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 },
  valueHalfLivesSec: [3000],
  ...over,
});
const COR = { learnSec: 8000, minWindows: 3, maxShiftSec: 600 };
const rb = (over: Partial<AdaptiveRobustConfig> = {}): AdaptiveRobustConfig => ({ ...cfg().adaptive!, ...over });
const mk = (n: number, e: (i: number) => boolean): LinkSample[] =>
  Array.from({ length: n }, (_, i) => ({ surfaceUp: [true], surfaceDelaySec: [0], earthUp: [e(i)], earthDelaySec: [2], earthBlackout: [false] }));
const gaps = mk(6000, (i) => i % 100 < 40); // her 100 adımda 40 adım (400 sn) açık
const arqMode = { surfaceLossPct: 1, earthLossPct: 5, maxAttempts: 4 };
const loss = (c: SchedConfig, s: LinkSample[], pol: 'adaptiveRobust' | 'adaptive' | 'priority') => { const m = metricsOf(simulate(topo, s, pol, c), c); return m.lossPct; };
const conserved = (r: ReturnType<typeof simulate>) => {
  for (const c of [r.total, ...Object.values(r.perClass)]) expect(c.generated).toBe(c.delivered + c.dropped + c.abandoned + c.expired + c.remaining);
};

describe('takvim hatasını gözlemden düzeltme (adaptiveRobust.correct, sentetik)', () => {
  it('correct yoksa Aşama 10 ile, hata yokken correct varsa correct yokmuş gibi birebir aynı sonuç', () => {
    for (const m of [{}, { arq: arqMode }]) {
      const base = cfg({ ...m, adaptiveRobust: rb() });
      expect(simulate(topo, gaps, 'adaptiveRobust', cfg({ ...m, adaptiveRobust: rb({ correct: COR }) }))).toEqual(simulate(topo, gaps, 'adaptiveRobust', base));
    }
  });

  it('pencere kenarları kısalmışsa (−100 sn) ve öteleme varsa kayma gözlemden bulunur: hata yokken elde edilen sonuca, düzeltmesizden daha yakın', () => {
    for (const fc of [{ edgeShiftSec: -100 }, { offsetSec: 100 }, { edgeShiftSec: 60, offsetSec: -80 }]) {
      const perfect = loss(cfg({ arq: arqMode, adaptiveRobust: rb() }), gaps, 'adaptiveRobust');
      const off = loss(cfg({ arq: arqMode, forecast: fc, adaptiveRobust: rb() }), gaps, 'adaptiveRobust');
      const on = loss(cfg({ arq: arqMode, forecast: fc, adaptiveRobust: rb({ correct: COR }) }), gaps, 'adaptiveRobust');
      expect(Math.abs(on - perfect)).toBeLessThanOrEqual(Math.abs(off - perfect) + 1e-9);
      expect(on !== off || off === perfect).toBe(true); // düzeltme gerçekten çalıştı (etkisiz değil) ya da düzeltilecek bir şey yoktu
    }
  });

  it('kenar kısalması (−100 sn) toplam kaybı belirgin artırır; düzeltme bunu hatasız takvimin 1 puan yakınına indirir', () => {
    const c = (a: AdaptiveRobustConfig) => cfg({ arq: arqMode, forecast: { edgeShiftSec: -100 }, adaptiveRobust: a });
    const perfect = loss(cfg({ arq: arqMode, adaptiveRobust: rb() }), gaps, 'adaptiveRobust');
    const off = loss(c(rb()), gaps, 'adaptiveRobust'), on = loss(c(rb({ correct: COR })), gaps, 'adaptiveRobust');
    expect(off - perfect).toBeGreaterThan(5);
    expect(on - perfect).toBeLessThan(1);
  });

  it('iyimser hatada komşu pencereler birleşirse (boşluk 100 sn < 2 × 150 sn) birebir eşleşme yoktur: yanlış kayma öğrenilmez, düzeltme sonucu bozmaz', () => {
    const close = mk(6000, (i) => i % 100 < 40 || (i % 100 >= 50 && i % 100 < 90)); // iki açık pencere, aralarında 10 adımlık (100 sn) boşluk
    const c = (a: AdaptiveRobustConfig) => cfg({ arq: arqMode, forecast: { edgeShiftSec: 150 }, adaptiveRobust: a });
    expect(simulate(topo, close, 'adaptiveRobust', c(rb({ correct: COR })))).toEqual(simulate(topo, close, 'adaptiveRobust', c(rb())));
  });

  it('pencereleri tamamen silen hatada (−250 sn: 400 sn pencere kalmaz) eşlenecek tahmin penceresi yoktur: düzeltme yapılmaz, sonuç correct yokkenle aynı', () => {
    const c = { arq: arqMode, forecast: { edgeShiftSec: -250 } };
    expect(simulate(topo, gaps, 'adaptiveRobust', cfg({ ...c, adaptiveRobust: rb({ correct: COR }) }))).toEqual(simulate(topo, gaps, 'adaptiveRobust', cfg({ ...c, adaptiveRobust: rb() })));
  });

  it('tahmin edilen kayma maxShiftSec’i aşarsa ya da gözlenen pencere sayısı yetmezse düzeltme yapılmaz', () => {
    const c = { arq: arqMode, forecast: { edgeShiftSec: -100 } };
    const none = simulate(topo, gaps, 'adaptiveRobust', cfg({ ...c, adaptiveRobust: rb() }));
    expect(simulate(topo, gaps, 'adaptiveRobust', cfg({ ...c, adaptiveRobust: rb({ correct: { ...COR, maxShiftSec: 50 } }) }))).toEqual(none);
    expect(simulate(topo, gaps, 'adaptiveRobust', cfg({ ...c, adaptiveRobust: rb({ correct: { ...COR, minWindows: 1000 } }) }))).toEqual(none);
  });

  it('korunum denklemleri düzeltmeli yollarda tutar (hatasız/hatalı takvim, kayıpsız/ARQ/yüzey kapalılığı + ayrı tamponlar)', () => {
    for (const m of [{}, { arq: arqMode }, { arq: arqMode, projection: { surfaceClosure: true, arqHold: true, separateRelays: true } }]) {
      for (const fc of [undefined, { edgeShiftSec: -100 }, { offsetSec: -150 }, { edgeShiftSec: 80 }]) {
        const c = cfg({ ...m, ...(fc ? { forecast: fc } : {}), adaptiveRobust: rb({ correct: COR, trustMin: 0.3, checkSec: 2000 }) });
        const r = simulate(topo, gaps, 'adaptiveRobust', c);
        conserved(r);
        expect(r.total.generatedMb + r.total.suppressedMb).toBeGreaterThan(0);
      }
    }
  });

  it('belirleyici (aynı girdi, aynı sonuç) ve correctConfig varsayımsal değerlerden gelir', () => {
    const c = cfg({ forecast: { edgeShiftSec: -100 }, adaptiveRobust: rb({ correct: COR }) });
    expect(simulate(topo, gaps, 'adaptiveRobust', c)).toEqual(simulate(topo, gaps, 'adaptiveRobust', c));
    expect(correctConfig()).toEqual({ learnSec: 7 * 86400, minWindows: 3, maxShiftSec: 6 * 3600 });
  });
});
