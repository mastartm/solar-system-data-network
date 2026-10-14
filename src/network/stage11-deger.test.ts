import { describe, expect, it } from 'vitest';
import { curveValue, simulate, type LinkSample, type SchedConfig, type SchedTopology, type ValueAwareConfig, type ValueModel } from './scheduler';
import { metricsOf, valuePct } from './sweep';
import { valueModelsConfig } from './timeline';
import { HYPOTHETICAL } from '../config/hypothetical';

// BU TESTLER SENTETİKTİR: uydurma tek uydulu topoloji, uydurma hızlar ve periyodik hat boşlukları (gerçek Horizons verisi değil).
// Aşama 11, madde 2: alternatif değer modelleri (ölçüt) ve son tarihe göre atma (expireAfterSec).
const topo: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r', dataRateKbps: 1000 }], relays: ['r'] };
const cfg = (over: Partial<SchedConfig> = {}): SchedConfig => ({
  classes: [
    { id: 'tel', priority: 0, share: 0.2, packetMb: 1, valuePerMb: 4 },
    { id: 'sci', priority: 1, share: 0.8, packetMb: 10, valuePerMb: 1 },
  ],
  dutyCycle: 0.6,
  surfaceLinkKbps: { x: 5000 }, relayDownlinkKbps: { r: 500 },
  assetBufferMb: { x: 1000 }, relayBufferMb: { r: 2000 },
  delayedAfterSec: 600, stepSec: 10, seriesEverySec: 100,
  valueHalfLivesSec: [3000],
  ...over,
});
const mk = (n: number, e: (i: number) => boolean): LinkSample[] =>
  Array.from({ length: n }, (_, i) => ({ surfaceUp: [true], surfaceDelaySec: [0], earthUp: [e(i)], earthDelaySec: [2], earthBlackout: [false] }));
const gaps = mk(4000, (i) => i % 100 < 30); // doygun: 0,5 Mb/sn × %30 < 0,6 üretim ⇒ kuyruk birikir, gecikme büyür
const arqMode = { surfaceLossPct: 1, earthLossPct: 5, maxAttempts: 4 };
const va = (over: Partial<ValueAwareConfig> = {}): ValueAwareConfig => ({ halfLifeSec: 3000, expireBelow: 0, newestFirst: false, evictOldest: false, scanSec: 10, ...over });
const stripDecay = (r: ReturnType<typeof simulate>) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'decayMb' ? undefined : v)));
const conserved = (r: ReturnType<typeof simulate>) => {
  for (const c of [r.total, ...Object.values(r.perClass)]) expect(c.generated).toBe(c.delivered + c.dropped + c.abandoned + c.expired + c.remaining);
};
const D = 86400;

describe('değer eğrileri (curveValue, sentetik)', () => {
  it('üstel: yarı ömürde 0,5; basamak: son tarihte 1, sonra after; taban: sonsuzda floor; doğrusal: sıfır noktasında 0', () => {
    expect(curveValue({ kind: 'exp', halfLifeSec: 100 }, 100)).toBeCloseTo(0.5, 12);
    expect(curveValue({ kind: 'step', deadlineSec: 50 }, 50)).toBe(1);
    expect(curveValue({ kind: 'step', deadlineSec: 50 }, 50.001)).toBe(0);
    expect(curveValue({ kind: 'step', deadlineSec: 50, after: 0.5 }, 99)).toBe(0.5);
    expect(curveValue({ kind: 'floor', halfLifeSec: 100, floor: 0.3 }, 1e9)).toBeCloseTo(0.3, 12);
    expect(curveValue({ kind: 'floor', halfLifeSec: 100, floor: 0.3 }, 0)).toBeCloseTo(1, 12);
    expect(curveValue({ kind: 'linear', zeroAtSec: 80 }, 40)).toBeCloseTo(0.5, 12);
    expect(curveValue({ kind: 'linear', zeroAtSec: 80 }, 200)).toBe(0);
  });
  it('varsayımsal model listesi saniyeye çevrilir, sıra korunur', () => {
    const m = valueModelsConfig();
    expect(m.map((x) => x.id)).toEqual(HYPOTHETICAL.value.models.map((x) => x.id));
    expect(m.find((x) => x.id === 'step3')!.decay).toEqual({ kind: 'step', deadlineSec: 3 * D, after: 0 });
    expect(m.find((x) => x.id === 'tel1')!.top).toEqual({ kind: 'step', deadlineSec: D, after: 0 });
  });
});

describe('alternatif değer modelleri (valueModels, sentetik)', () => {
  const models: ValueModel[] = [
    { id: 'exp', decay: { kind: 'exp', halfLifeSec: 3000 } },
    { id: 'stepBig', decay: { kind: 'step', deadlineSec: 1e12 } },
    { id: 'stepZero', decay: { kind: 'step', deadlineSec: 0 } },
    { id: 'stepHalf', decay: { kind: 'step', deadlineSec: 0, after: 0.5 } },
    { id: 'floor1', decay: { kind: 'floor', halfLifeSec: 3000, floor: 1 } },
    { id: 'floor0', decay: { kind: 'floor', halfLifeSec: 3000, floor: 0 } },
    { id: 'floor3', decay: { kind: 'floor', halfLifeSec: 3000, floor: 0.3 } },
    { id: 'lin', decay: { kind: 'linear', zeroAtSec: 1e12 } },
    { id: 'telStep', decay: { kind: 'exp', halfLifeSec: 3000 }, top: { kind: 'step', deadlineSec: 0 } },
  ];
  it('model yokken ya da boş listeyle sonuç aynı; modeller yalnızca decayMb dizisini uzatır (çizelge sonucu değişmez)', () => {
    const base = simulate(topo, gaps, 'priority', cfg({ arq: arqMode }));
    expect(simulate(topo, gaps, 'priority', cfg({ arq: arqMode, valueModels: [] }))).toEqual(base);
    const withM = simulate(topo, gaps, 'priority', cfg({ arq: arqMode, valueModels: models }));
    expect(stripDecay(withM)).toEqual(stripDecay(base));
    expect(withM.total.decayMb.length).toBe(1 + models.length);
    expect(withM.total.decayMb[0]).toBe(base.total.decayMb[0]); // yarı ömür girdisi aynı
  });
  it('üstel model, aynı yarı ömürlü valueHalfLivesSec girdisiyle aynı; son tarih/taban/doğrusal uç durumları beklenen değeri verir', () => {
    const r = simulate(topo, gaps, 'priority', cfg({ valueModels: models }));
    for (const c of [r.total, ...Object.values(r.perClass)]) {
      const [h, exp, stepBig, stepZero, stepHalf, floor1, floor0, floor3, lin] = c.decayMb;
      expect(c.deliveredMb).toBeGreaterThan(0);
      expect(exp).toBeCloseTo(h, 6);
      expect(stepBig).toBeCloseTo(c.deliveredMb, 6);
      expect(stepZero).toBeCloseTo(0, 9);
      expect(stepHalf).toBeCloseTo(0.5 * c.deliveredMb, 6);
      expect(floor1).toBeCloseTo(c.deliveredMb, 6);
      expect(floor0).toBeCloseTo(h, 6);
      expect(floor3).toBeGreaterThanOrEqual(h);
      expect(floor3).toBeLessThanOrEqual(c.deliveredMb);
      expect(lin).toBeCloseTo(c.deliveredMb, 3);
    }
  });
  it('top eğrisi verilmişse en önemli sınıf (telemetri) bu eğriyle azalır; yoksa ölçüt telemetriyi sabit sayar (valuePct, topDecays)', () => {
    const c = cfg({ valueModels: models });
    const r = simulate(topo, gaps, 'priority', c), m = metricsOf(r, c);
    const idx = 1 + models.findIndex((x) => x.id === 'telStep');
    expect(r.perClass.tel.decayMb[idx]).toBeCloseTo(0, 9); // son tarih 0: telemetri değersiz
    const fixedTop = valuePct(m, { halfLifeIdx: idx });
    const decTop = valuePct(m, { halfLifeIdx: idx, topDecays: true });
    expect(decTop).toBeLessThan(fixedTop);
    // top eğrisi yok (exp modeli): topDecays telemetriyi aynı üstel eğriyle sayar
    const e = 1 + models.findIndex((x) => x.id === 'exp');
    expect(valuePct(m, { halfLifeIdx: e, topDecays: true })).toBeLessThan(valuePct(m, { halfLifeIdx: e }));
    // sabit değer yolu (halfLifeIdx yok) etkilenmez
    expect(valuePct(m, {})).toBe(valuePct(m, { topDecays: true }));
  });
});

describe('son tarihe göre atma (valueAware.expireAfterSec, sentetik)', () => {
  it('expireAfterSec yokken ve expireBelow = 0 iken atma yok; expireBelow ile eşdeğer yaşta expireAfterSec aynı sonucu verir (yarı ömür 3000, eşik 0,25 → 6000 sn)', () => {
    const none = simulate(topo, gaps, 'valueAware', cfg({ arq: arqMode, valueAware: va() }));
    expect(none.total.expired).toBe(0);
    const viaBelow = simulate(topo, gaps, 'valueAware', cfg({ arq: arqMode, valueAware: va({ expireBelow: 0.25 }) }));
    const viaAfter = simulate(topo, gaps, 'valueAware', cfg({ arq: arqMode, valueAware: va({ expireAfterSec: 6000 }) }));
    expect(viaBelow.total.expired).toBeGreaterThan(0);
    expect(viaAfter).toEqual(viaBelow);
  });
  it('son tarih aşan bilim paketleri atılır (atılan ≠ düşen); telemetri atılmaz; daha kısa son tarih daha çok atar', () => {
    const a = simulate(topo, gaps, 'valueAware', cfg({ valueAware: va({ expireAfterSec: 8000 }) }));
    const b = simulate(topo, gaps, 'valueAware', cfg({ valueAware: va({ expireAfterSec: 2000 }) }));
    expect(a.perClass.tel.expired).toBe(0);
    expect(b.total.expired).toBeGreaterThan(a.total.expired);
    expect(b.total.expiredMb).toBeGreaterThan(0);
  });
  it('korunum denklemleri (üretilen = teslim + düşen + hatta kayıp + atılan + kalan; talep = üretilen + üretilmeyen) yeni yollarda tutar', () => {
    for (const m of [{}, { arq: arqMode }]) {
      for (const v of [va({ expireAfterSec: 3000 }), va({ expireAfterSec: 3000, newestFirst: true, evictOldest: true }), va({ expireAfterSec: 500, newestFirst: true })]) {
        for (const pol of ['valueAware', 'valueAdaptive'] as const) {
          const r = simulate(topo, gaps, pol, cfg({ ...m, valueAware: v, valueModels: valueModelsConfig(), adaptive: { minSec: 500, maxSec: 20000, leadSec: 1000, tailFactor: 1, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 } }));
          conserved(r);
          expect(r.total.generatedMb + r.total.suppressedMb).toBeGreaterThan(0);
          for (const c of Object.values(r.perClass)) expect(c.decayMb.length).toBe(1 + HYPOTHETICAL.value.models.length);
        }
      }
    }
  });
});
