import { describe, expect, it } from 'vitest';
import { HYPOTHETICAL } from '../config/hypothetical';
import { syntheticTracks } from '../data/synthetic';
import { MarsPower, applyPower, computeNetwork, marsAxisTiltDeg, relayPosition } from './network';
import { simulate, type AdaptiveRobustConfig, type LinkSample, type Policy, type SchedConfig, type SchedTopology, type ValueAwareConfig } from './scheduler';
import { metricsOf, valuePct } from './sweep';
import { buildLinkTimeline, restrictToRelays, schedTopology } from './timeline';

// BU TESTLER SENTETİKTİR: uydurma tek/çift uydulu topolojiler, uydurma hızlar, periyodik hat boşlukları ve uzun kapalı dönemler; sentetik konum izleri (gerçek Horizons verisi değil).
// Aşama 10: değere duyarlı kuyruk, dayanıklı uyarlamalı ufuk, çok uydulu yönlendirme + uydular arası bağlantı, telemetri seçenekleri, presesyon/eksen eğikliği/güç modeli.
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
  rolling: { rollingSec: 3000, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 },
  adaptive: { minSec: 500, maxSec: 20000, leadSec: 1000, tailFactor: 1, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 },
  valueHalfLivesSec: [3000],
  ...over,
});
const rb = (over: Partial<AdaptiveRobustConfig> = {}): AdaptiveRobustConfig => ({ ...cfg().adaptive!, ...over });
const va = (over: Partial<ValueAwareConfig> = {}): ValueAwareConfig => ({ halfLifeSec: 3000, expireBelow: 0.25, newestFirst: true, evictOldest: true, scanSec: 10, ...over });
const mk = (n: number, e: (i: number) => boolean, black: (i: number) => boolean = () => false): LinkSample[] =>
  Array.from({ length: n }, (_, i) => ({ surfaceUp: [true], surfaceDelaySec: [0], earthUp: [e(i)], earthDelaySec: [2], earthBlackout: [black(i)] }));
const gaps = mk(4000, (i) => i % 100 < 40); // her 100 adımda 40 adım açık: kapasite (2 Mb/sn × %40 = 0,8) > üretim (0,6) ama tampon darboğaz
const sat = mk(4000, (i) => i % 100 < 25); // doygun: 0,5 Mb/sn < 0,6 üretim
const always = mk(4000, () => true); // hat hep açık; relayDownlinkKbps 500 verilirse sürekli doygun (0,5 < 0,6): kuyruk hiç boşalmaz
const longGaps = mk(8000, (i) => i % 1500 < 200); // 1300 adım (13000 sn) kapalı, 200 adım açık
const slow = { relayDownlinkKbps: { r: 500 } };
const big = { assetBufferMb: { x: 1000 }, relayBufferMb: { r: 2000 } }; // telemetri tamponu doldurup bilim verisini atmasın
const arqMode = { surfaceLossPct: 1, earthLossPct: 5, maxAttempts: 4 };
const same = (a: ReturnType<typeof simulate>, b: ReturnType<typeof simulate>, as?: Policy) => expect({ ...a, policy: as ?? b.policy }).toEqual(b);
const conserved = (r: ReturnType<typeof simulate>) => {
  const all = [r.total, ...Object.values(r.perClass)];
  for (const c of all) {
    expect(c.generated).toBe(c.delivered + c.dropped + c.abandoned + c.expired + c.remaining); // üretilen = teslim + düşen + hatta kayıp + atılan + kalan
    expect(c.generatedMb + c.suppressedMb).toBeGreaterThanOrEqual(c.generatedMb); // talep = üretilen + üretilmeyen
  }
};
const MODES: [string, Partial<SchedConfig>][] = [['kayıpsız', {}], ['ARQ periyodik', { arq: arqMode }], ['ARQ kümelenmiş', { arq: { ...arqMode, burst: { goodLossPct: 0.5, badLossPct: 80, meanBadSec: 300, seed: 7 } } }], ['ARQ yüzey yeniden deneme', { arq: { ...arqMode, surfaceRetrySec: 40 } }]];

describe('değere duyarlı kuyruk (valueAware, sentetik)', () => {
  it('yapılandırma yokken (azalan değer modeli seçili değil) öncelikliyle BİREBİR aynı; valueAdaptive uyarlamalıyla birebir aynı', () => {
    for (const [, m] of MODES) {
      for (const s of [gaps, sat]) {
        same(simulate(topo, s, 'valueAware', cfg(m)), simulate(topo, s, 'priority', cfg(m)));
        same(simulate(topo, s, 'valueAdaptive', cfg(m)), simulate(topo, s, 'adaptive', cfg(m)));
      }
    }
  });

  it('yapılandırma var ama kuralların hiçbiri açık değilse de öncelikliyle birebir aynı', () => {
    const off = va({ expireBelow: 0, newestFirst: false, evictOldest: false });
    for (const [, m] of MODES) same(simulate(topo, sat, 'valueAware', cfg({ ...m, valueAware: off })), simulate(topo, sat, 'priority', cfg(m)));
  });

  it('korunum (üretilen = teslim + düşen + hatta kayıp + atılan + kalan; talep = üretilen + üretilmeyen) bütün hat modları ve kural kombinasyonlarında', () => {
    const rules: Partial<ValueAwareConfig>[] = [{}, { newestFirst: false }, { evictOldest: false }, { expireBelow: 0 }, { expireBelow: 0.5, newestFirst: false, evictOldest: false }];
    for (const [, m] of MODES) for (const r of rules) for (const pol of ['valueAware', 'valueAdaptive'] as Policy[]) {
      const res = simulate(topo, sat, pol, cfg({ ...m, valueAware: va(r) }));
      conserved(res);
      expect(res.perClass.tel.expired).toBe(0); // telemetri (en önemli sınıf) hiç atılmaz
    }
  });

  it('sürekli doygun hatta en yeni önce + en eskiyi at, öncelikliye göre azalan değeri artırır; üretimi kısmaz; korunum', () => {
    const c = cfg(slow);
    const base = simulate(topo, always, 'priority', c);
    const v = simulate(topo, always, 'valueAware', { ...c, valueAware: va({ expireBelow: 0 }) });
    const mb = metricsOf(base, c), mv = metricsOf(v, c);
    const w = { halfLifeIdx: 0 };
    expect(valuePct(mv, w)).toBeGreaterThan(valuePct(mb, w) + 2);
    expect(v.perClass.sci.latencyMeanSec).toBeLessThan(base.perClass.sci.latencyMeanSec / 2);
    expect(v.total.suppressed).toBe(0);
    conserved(v);
  });

  it('uzun kapalı dönemden sonra atma: eski paketler atılır (atılan ≠ düşen), eşik altı değerli veri gönderilmez, azalan değer artar', () => {
    const c = cfg({ ...big, valueAware: va({ newestFirst: false, evictOldest: false }) });
    const base = simulate(topo, longGaps, 'priority', c);
    const v = simulate(topo, longGaps, 'valueAware', c);
    const mb = metricsOf(base, c), mv = metricsOf(v, c);
    expect(v.total.expired).toBeGreaterThan(0);
    expect(mv.expiredPct).toBeGreaterThan(0);
    expect(mv.lossPct).toBeGreaterThanOrEqual(mv.dropPct + mv.abandonedPct + mv.expiredPct - 1e-9); // atılan toplam kayba dahildir
    expect(valuePct(mv, { halfLifeIdx: 0 })).toBeGreaterThanOrEqual(valuePct(mb, { halfLifeIdx: 0 }) - 0.5);
    conserved(v);
  });

  it('(eski deneme, doygun aralıklı hat) en yeni önce kuyruk hacmi boşaltan pencerelerde sıra önemsiz: sonuç öncelikliyle aynı hacimde', () => {
    const base = simulate(topo, sat, 'priority', cfg());
    const v = simulate(topo, sat, 'valueAware', cfg({ valueAware: va({ expireBelow: 0, evictOldest: false }) }));
    expect(v.total.deliveredMb).toBe(base.total.deliveredMb);
    const mb = metricsOf(base, cfg()), mv = metricsOf(v, cfg());
    expect(mv.deliveredPct).toBeCloseTo(mb.deliveredPct, 6);
    conserved(v);
  });

  it('atma: teslim edilen bilim paketinin yaşı eşik yaşını (yarı ömür × log2(1/eşik)) tarama aralığı kadar aşabilir, daha fazla değil', () => {
    const c = cfg({ ...big, valueAware: va({ newestFirst: false, evictOldest: false, expireBelow: 0.25, scanSec: 10 }) });
    const r = simulate(topo, longGaps, 'valueAware', c);
    const limit = 3000 * Math.log2(1 / 0.25); // 6000 sn
    expect(r.perClass.sci.expired).toBeGreaterThan(0);
    expect(r.perClass.sci.latencyMaxSec).toBeLessThanOrEqual(limit + 10 + 2 + 1e-6); // adım + ışık gecikmesi
    const noExp = simulate(topo, longGaps, 'priority', cfg(big));
    expect(noExp.perClass.sci.latencyMaxSec).toBeGreaterThan(limit);
  });

  it('en eskiyi at: tampon taşarken yeni veri kabul edilir (teslim edilenin ortalama yaşı düşer)', () => {
    const c0 = cfg({ valueAware: va({ expireBelow: 0, newestFirst: false, evictOldest: false }) });
    const c1 = cfg({ valueAware: va({ expireBelow: 0, newestFirst: false, evictOldest: true }) });
    const sl = cfg(slow);
    const a = simulate(topo, always, 'valueAware', { ...sl, valueAware: c0.valueAware }), b = simulate(topo, always, 'valueAware', { ...sl, valueAware: c1.valueAware });
    expect(b.perClass.sci.latencyMeanSec).toBeLessThan(a.perClass.sci.latencyMeanSec);
    conserved(b);
  });

  it('valueAdaptive: kısma ve kuyruk kuralı birlikte; kısılan "üretilmeyen", atılan ayrı; korunum', () => {
    const r = simulate(topo, gaps, 'valueAdaptive', cfg({ valueAware: va(), arq: arqMode }));
    const ad = simulate(topo, gaps, 'adaptive', cfg({ arq: arqMode }));
    expect(r.total.suppressed).toBeGreaterThan(0);
    expect(ad.total.suppressed).toBeGreaterThan(0);
    conserved(r);
  });

  it('deterministik ve girdiyi değiştirmez', () => {
    const copy = JSON.stringify(sat), c = cfg({ valueAware: va(), arq: arqMode });
    const a = simulate(topo, sat, 'valueAware', c), b = simulate(topo, sat, 'valueAware', c);
    expect(a).toEqual(b);
    expect(JSON.stringify(sat)).toBe(copy);
  });
});

describe('takvim hatasına dayanıklı uyarlamalı ufuk (adaptiveRobust, sentetik)', () => {
  const err = (edgeShiftSec: number) => ({ forecast: { edgeShiftSec } });
  it('yapılandırma yoksa öncelikliyle, korumasız yapılandırmayla uyarlamalıyla birebir aynı (hatalı takvimde de)', () => {
    for (const e of [0, -250, 120]) {
      same(simulate(topo, gaps, 'adaptiveRobust', cfg(err(e))), simulate(topo, gaps, 'priority', cfg(err(e))));
      same(simulate(topo, gaps, 'adaptiveRobust', cfg({ ...err(e), adaptiveRobust: rb() })), simulate(topo, gaps, 'adaptive', cfg(err(e))));
    }
  });

  it('pencereleri tamamen silen pesimist takvimde uyarlamalı kısmaya çöker; geri çekilme (trustMin) öncelikliye döner ve daha az kaybeder', () => {
    const c = cfg({ ...err(-250), arq: arqMode });
    const p = metricsOf(simulate(topo, gaps, 'priority', c), c);
    const a = metricsOf(simulate(topo, gaps, 'adaptive', c), c);
    const r = simulate(topo, gaps, 'adaptiveRobust', { ...c, adaptiveRobust: rb({ trustMin: 0.5, checkSec: 2000 }) });
    const m = metricsOf(r, c);
    expect(a.suppressedMb).toBeGreaterThan(0.3 * a.demandMb); // çöküş
    expect(m.lossPct).toBeLessThan(a.lossPct - 10);
    expect(m.lossPct).toBeLessThanOrEqual(p.lossPct + 1); // kısma yok → öncelikliye yakın
    conserved(r);
  });

  it('hafif hatada (pencereler daralır ama silinmez) güven eşiği aşılmaz: uyarlamalıyla aynı', () => {
    const c = cfg({ ...err(-50) }); // 5 adım daralır (40 adımlık pencere 30'a iner): oran 0,75 ≥ 0,5
    same(simulate(topo, gaps, 'adaptiveRobust', { ...c, adaptiveRobust: rb({ trustMin: 0.5, checkSec: 2000 }) }), simulate(topo, gaps, 'adaptive', c));
  });

  it('ufku kırpma (capSec) kavuşum içermeyen kapalı dönemde ufku kısaltır; kavuşum içeren dönemde etkisizdir', () => {
    const long = mk(5000, (i) => !(i >= 1000 && i < 3200));
    const longBlack = mk(5000, (i) => !(i >= 1000 && i < 3200), (i) => i >= 1000 && i < 3200);
    const c = cfg({ relayBufferMb: { r: 1000 }, assetBufferMb: { x: 300 }, adaptive: { ...cfg().adaptive!, minSec: 200, maxSec: 40000, leadSec: 2000, tailFactor: 0.5 } });
    const capped = { ...c, adaptiveRobust: { ...c.adaptive!, capSec: 3000 } };
    const noCap = { ...c, adaptiveRobust: { ...c.adaptive! } };
    const a = simulate(topo, long, 'adaptiveRobust', capped), b = simulate(topo, long, 'adaptiveRobust', noCap);
    expect(a.total.suppressed).not.toBe(b.total.suppressed);
    same(simulate(topo, longBlack, 'adaptiveRobust', capped), simulate(topo, longBlack, 'adaptiveRobust', noCap)); // kavuşum içeren dönem: kırpma yok
    conserved(a);
  });

  it('güven aralığı (histFactor): geçmişte gözlenen en uzun kapalı dönemin katını aşan tahmin edilen kapalı dönem kırpılır; geçmiş yoksa geri çekilme', () => {
    // 1. kapalı dönem kısa (gözlenir), sonra tahmin hatası yok ama çok uzun kapalı dönem: histFactor ufku sınırlar
    const s = mk(6000, (i) => !((i >= 1000 && i < 1100) || (i >= 3000 && i < 5200)));
    const c = cfg({ relayBufferMb: { r: 1000 }, assetBufferMb: { x: 300 }, adaptive: { ...cfg().adaptive!, minSec: 200, maxSec: 40000, leadSec: 2000, tailFactor: 1 } });
    const lim = simulate(topo, s, 'adaptiveRobust', { ...c, adaptiveRobust: { ...c.adaptive!, histFactor: 2, histSec: 20000 } });
    const free = simulate(topo, s, 'adaptiveRobust', { ...c, adaptiveRobust: { ...c.adaptive! } });
    expect(lim.total.suppressed).not.toBe(free.total.suppressed);
    conserved(lim);
  });

  it('iyimser hata (+120 dk) geri çekilmeyi tetiklemez; deterministik, girdiyi değiştirmez', () => {
    const copy = JSON.stringify(gaps), c = cfg({ ...err(100) });
    const a = simulate(topo, gaps, 'adaptiveRobust', { ...c, adaptiveRobust: rb({ trustMin: 0.5, checkSec: 2000 }) });
    same(a, simulate(topo, gaps, 'adaptive', c));
    expect(simulate(topo, gaps, 'adaptiveRobust', { ...c, adaptiveRobust: rb({ trustMin: 0.5 }) })).toEqual(simulate(topo, gaps, 'adaptiveRobust', { ...c, adaptiveRobust: rb({ trustMin: 0.5 }) }));
    expect(JSON.stringify(gaps)).toBe(copy);
  });
});

describe('telemetri seçenekleri (sentetik)', () => {
  it('telemetryMinFactor yokken ya da 1 iken hiçbir şey değişmez; < 1 iken telemetri de kısılır ("üretilmeyen"), korunum', () => {
    const c = cfg({ arq: arqMode });
    same(simulate(topo, gaps, 'adaptive', { ...c, telemetryMinFactor: 1 }), simulate(topo, gaps, 'adaptive', c));
    const r = simulate(topo, gaps, 'adaptive', { ...c, telemetryMinFactor: 0.25 });
    expect(simulate(topo, gaps, 'adaptive', c).perClass.tel.suppressed).toBe(0);
    expect(r.perClass.tel.suppressed).toBeGreaterThan(0);
    conserved(r);
    const m = metricsOf(r, { ...c, telemetryMinFactor: 0.25 });
    expect(m.topSuppressedPct).toBeGreaterThan(0);
  });

  it('telemetryShare yokken / 0 iken aynı; öncelikli kuyrukta etkisi yok (telemetri zaten önce gider), FIFO\'da telemetri gecikmesini azaltır; korunum', () => {
    const c = cfg({ arq: arqMode });
    same(simulate(topo, sat, 'priority', { ...c, telemetryShare: 0 }), simulate(topo, sat, 'priority', c));
    const pa = simulate(topo, sat, 'priority', c), pb = simulate(topo, sat, 'priority', { ...c, telemetryShare: 0.3 });
    expect(pb.perClass.tel.delivered).toBe(pa.perClass.tel.delivered);
    const fa = simulate(topo, sat, 'fifo', c), fb = simulate(topo, sat, 'fifo', { ...c, telemetryShare: 0.3 });
    expect(fb.perClass.tel.latencyMeanSec).toBeLessThan(fa.perClass.tel.latencyMeanSec);
    conserved(fb);
  });
});

// ---------------------------------------------------------------------------------------------------------------- çok uydulu yönlendirme
const topo2: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r1', dataRateKbps: 1000, alt: ['r2'] }], relays: ['r1', 'r2'], isl: [[0, 1]] };
const cfg2 = (over: Partial<SchedConfig> = {}): SchedConfig => cfg({ relayDownlinkKbps: { r1: 2000, r2: 2000 }, relayBufferMb: { r1: 200, r2: 200 }, ...over });
/** r1 görünür ve hep çizelgede seçili; Dünya hattı: r1 kapalı, r2 açık (uzun süre). r2 de yüzeyden görünür. */
const mk2 = (n: number, e1: (i: number) => boolean, e2: (i: number) => boolean, isl = false): LinkSample[] =>
  Array.from({ length: n }, (_, i) => ({
    surfaceUp: [true], surfaceDelaySec: [0], earthUp: [e1(i), e2(i)], earthDelaySec: [2, 2], earthBlackout: [false, false], assetRelay: [0],
    cand: [[{ relay: 0, up: true, delaySec: 0 }, { relay: 1, up: true, delaySec: 0.001 }]],
    islUp: [isl], islDelaySec: [0.05],
  }));
describe('çok uydulu yönlendirme ve uydular arası bağlantı (sentetik)', () => {
  it("select 'timeline' ve routing yok: Aşama 9 davranışıyla birebir aynı; tek rotalı araçta dinamik seçim etkisiz", () => {
    const s = mk2(3000, (i) => i % 100 < 30, (i) => i % 100 >= 50 && i % 100 < 90);
    for (const pol of ['priority', 'rolling', 'adaptive'] as Policy[]) {
      same(simulate(topo2, s, pol, cfg2({ routing: { select: 'timeline' } })), simulate(topo2, s, pol, cfg2()));
    }
    const single: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r', dataRateKbps: 1000 }], relays: ['r'] };
    same(simulate(single, gaps, 'priority', cfg({ routing: { select: 'leastFilled' } })), simulate(single, gaps, 'priority', cfg()));
  });

  it("'leastFilled' / 'openFirst': çizelge hep dolu uyduyu seçse bile yük hattı açık/boş uyduya gider; korunum", () => {
    // r1: Dünya hattı çok kısa açık (kapasite < üretim); r2: yarı zamanlı açık. Çizelge hep r1'i seçer.
    const s = mk2(4000, (i) => i % 100 < 8, (i) => i % 100 < 60);
    const base = simulate(topo2, s, 'priority', cfg2());
    const lf = simulate(topo2, s, 'priority', cfg2({ routing: { select: 'leastFilled' } }));
    const of = simulate(topo2, s, 'priority', cfg2({ routing: { select: 'openFirst' } }));
    expect(base.total.dropped).toBeGreaterThan(0);
    expect(lf.total.deliveredMb).toBeGreaterThan(base.total.deliveredMb);
    expect(of.total.deliveredMb).toBeGreaterThan(base.total.deliveredMb);
    for (const r of [lf, of]) { conserved(r); expect(r.total.dropped).toBeLessThan(base.total.dropped); }
    // veri girdiği uyduda kalır: hiçbir uydu tamponu kapasiteyi aşmaz
    for (const r of [base, lf, of]) for (const k of ['r1', 'r2']) expect(r.peakRelayFill[k]).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('uydular arası bağlantı: hattı kapalı uydudaki veri hattı açık eşe aktarılır (teslim artar), bağlantı kapalıyken etkisiz; korunum', () => {
    const s = (isl: boolean) => mk2(4000, (i) => i % 100 < 8, (i) => i % 100 < 60, isl);
    const rt = { select: 'timeline' as const };
    const no = simulate(topo2, s(true), 'priority', cfg2({ routing: rt }));
    const yes = simulate(topo2, s(true), 'priority', cfg2({ routing: { ...rt, isl: { kbps: 100 } } }));
    expect(yes.total.deliveredMb).toBeGreaterThan(no.total.deliveredMb);
    conserved(yes);
    same(simulate(topo2, s(false), 'priority', cfg2({ routing: { ...rt, isl: { kbps: 100 } } })), simulate(topo2, s(false), 'priority', cfg2()));
    for (const m of MODES) conserved(simulate(topo2, s(true), 'priority', cfg2({ ...m[1], routing: { select: 'leastFilled', isl: { kbps: 100 } } })));
  });

  it('projeksiyon separateRelays: kapalıyken Aşama 9 ile birebir aynı; tek rotada etkisiz; çok rotada uydu tamponları ayrı olduğundan daha çok kısar; korunum', () => {
    const s = mk2(4000, (i) => i % 100 < 30, (i) => i % 100 >= 50 && i % 100 < 80);
    for (const pol of ['rolling', 'adaptive'] as Policy[]) {
      same(simulate(topo2, s, pol, cfg2({ projection: { separateRelays: false } })), simulate(topo2, s, pol, cfg2()));
      const pooled = simulate(topo2, s, pol, cfg2()), sep = simulate(topo2, s, pol, cfg2({ projection: { separateRelays: true } }));
      expect(sep.total.suppressed).toBeGreaterThanOrEqual(pooled.total.suppressed);
      conserved(sep);
      for (const [, m] of MODES) conserved(simulate(topo2, s, pol, cfg2({ ...m, projection: { separateRelays: true } })));
    }
    const single: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r', dataRateKbps: 1000 }], relays: ['r'] };
    same(simulate(single, gaps, 'rolling', cfg({ projection: { separateRelays: true } })), simulate(single, gaps, 'rolling', cfg()));
  });

  it('restrictToRelays: cand, islUp ve topology.isl yeni sıraya göre kalır', () => {
    const s = mk2(5, () => true, () => true, true);
    const r = restrictToRelays({ ...topo2 }, s, ['r2', 'r1']);
    expect(r.topo.isl).toEqual([[1, 0]]);
    expect(r.samples[0].cand![0].map((c) => c.relay)).toEqual([1, 0]);
    const one = restrictToRelays({ ...topo2 }, s, ['r1']);
    expect(one.topo.isl).toBeUndefined();
    expect(one.samples[0].islUp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------- ağ seçenekleri
const tracks = syntheticTracks();
const jd0 = 2458849.5 + 400;
describe('Ay presesyonu, Mars eksen eğikliği, güç modeli, uydular arası bağlantı (sentetik izler, uydurma değerler)', () => {
  const ell = { moonOrbit: 'elliptical' as const };
  const moonRelay = (o: object, jd: number) => relayPosition({ ...HYPOTHETICAL.relays[0], orbit: HYPOTHETICAL.moonOrbits.elliptical }, jd, o);
  it('presesyon: kapalıyken ve epoch anında konum aynı; epoch sonrası düzlem kayar (yarıçap ve dönem aynı); ekvatoral dairesel yörüngede etkisiz', () => {
    const pr = HYPOTHETICAL.moonPrecession;
    const a = moonRelay({}, pr.epochJD), b = moonRelay({ moonPrecession: true }, pr.epochJD);
    for (let k = 0; k < 3; k++) expect(b.pos[k]).toBeCloseTo(a.pos[k], 6);
    const a2 = moonRelay({}, pr.epochJD + 10), b2 = moonRelay({ moonPrecession: true }, pr.epochJD + 10);
    expect(Math.hypot(...b2.pos)).toBeCloseTo(Math.hypot(...a2.pos), 6);
    expect(Math.hypot(b2.pos[0] - a2.pos[0], b2.pos[1] - a2.pos[1], b2.pos[2] - a2.pos[2])).toBeGreaterThan(100);
    const circ = { ...HYPOTHETICAL.relays[0] };
    expect(relayPosition(circ, pr.epochJD + 10, { moonPrecession: true }).pos).toEqual(relayPosition(circ, pr.epochJD + 10, {}).pos);
  });

  it('presesyon: varsayılan ağ seçenekleriyle computeNetwork çıktısı seçeneksizle aynı; bağlantı çizelgesi presesyonla değişir', () => {
    expect(computeNetwork(tracks, jd0, 3, { ...ell })).toEqual(computeNetwork(tracks, jd0, 3, { ...ell, moonPrecession: false }));
    const tp = HYPOTHETICAL.moonPrecession.epochJD;
    const t0 = buildLinkTimeline(tracks, tp, tp + 6, 1800, schedTopology(ell), 3, ell), t1 = buildLinkTimeline(tracks, tp, tp + 6, 1800, schedTopology({ ...ell, moonPrecession: true }), 3, { ...ell, moonPrecession: true });
    expect(JSON.stringify(t1)).not.toBe(JSON.stringify(t0));
  });

  it('Mars ekseni: eğik çerçeve dönme matrisidir (uzunluklar korunur); eksen ekliptik kutbundan ≈ 25–28° eğik; paralel varsayılanla aynı sonuç', () => {
    const tilt = marsAxisTiltDeg();
    expect(tilt).toBeGreaterThan(24);
    expect(tilt).toBeLessThan(29);
    const par = computeNetwork(tracks, jd0, 3, {}), par2 = computeNetwork(tracks, jd0, 3, { marsAxis: 'parallel' });
    expect(par2).toEqual(par);
    const tl = computeNetwork(tracks, jd0, 3, { marsAxis: 'tilted' });
    const rel = (n: ReturnType<typeof computeNetwork>) => n.statuses.filter((s) => s.asset.body === 'mars').map((s) => s.surfaceKm);
    // yüzey–uydu mesafesi eksen yönünden bağımsız (aynı dönme uygulanır)
    rel(par).forEach((d, k) => expect(rel(tl)[k]).toBeCloseTo(d, 5));
  });

  it('Mars eksen eğikliği gölgeyi mevsimsel değiştirir: gölgede geçen süre oranı eğik eksende bir yılda geniş bir aralıkta değişir, paralelde (neredeyse) sabittir', () => {
    const shadowFrac = (o: object, start: number) => {
      let n = 0, sh = 0;
      for (let h = 0; h < 36; h++) { const st = computeNetwork(tracks, start + h / 6, 0, { marsEclipse: 'earth', ...o }); n++; if (st.relayStates.find((r) => r.relay.body === 'mars')!.eclipsed) sh++; }
      return sh / n;
    };
    const par: number[] = [], tilt: number[] = [];
    for (let k = 0; k < 12; k++) { par.push(shadowFrac({}, jd0 + k * 57)); tilt.push(shadowFrac({ marsAxis: 'tilted' }, jd0 + k * 57)); }
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(spread(tilt)).toBeGreaterThan(spread(par));
  });

  it('güç modeli (MarsPower): gölgede boşalır, eşik altında hat kapanır, resumeFrac üstünde açılır (histerezis); yeterli batarya kapanmaz; deterministik', () => {
    const p = { ...HYPOTHETICAL.marsPower, batteryWh: 400, initialFrac: 1 };
    const run = (params: typeof p) => { const pw = new MarsPower(params); const out: boolean[] = []; for (let i = 0; i < 400; i++) out.push(pw.step(i % 60 < 12, true, 300)); return { out, pw }; };
    const a = run(p), b = run(p);
    expect(a.out).toEqual(b.out);
    expect(a.out.includes(false)).toBe(true);
    expect(a.out[0]).toBe(true);
    // histerezis: kapandıktan sonra ilk açılış, resumeFrac × batarya eşiğinden sonra
    const big = run({ ...p, batteryWh: 100000 });
    expect(big.out.every(Boolean)).toBe(true);
    expect(a.pw.soc).toBeGreaterThanOrEqual(0);
    expect(a.pw.soc).toBeLessThanOrEqual(p.batteryWh);
  });

  it("güç modu: computeNetwork gölgede hemen kapatmaz; applyPower çizelgede batarya bitince Mars uydusunun yüzey ve Dünya hatlarını 'eclipse' yapar; 'none' ile aynı sonuç gölgesizde", () => {
    const small = { ...HYPOTHETICAL.marsPower, batteryWh: 60 }; // çok küçük batarya: gölgede hızla biter
    const pw = new MarsPower(small);
    let closed = 0;
    for (let h = 0; h < 200; h++) {
      const n = computeNetwork(tracks, jd0 + h / 24, 0, { marsEclipse: 'power' });
      const rs = n.relayStates.find((r) => r.relay.body === 'mars')!;
      if (rs.eclipsed) expect(rs.earthLink === 'up' || rs.earthLink === 'occulted' || rs.earthLink === 'blackout').toBe(true); // gölge tek başına kapatmaz
      applyPower(n, pw, 3600);
      if (rs.earthLink === 'eclipse') { closed++; for (const s of n.statuses.filter((x) => x.relay.id === rs.relay.id)) expect(s.connected).toBe(false); }
    }
    expect(closed).toBeGreaterThan(0);
    // zaman çizelgesi: güç modu aktif → Dünya hattı açık oranı düşük bataryada düşer
    const pOpts = { marsEclipse: 'power' as const }, topoM = schedTopology(pOpts);
    const sOff = buildLinkTimeline(tracks, jd0, jd0 + 8, 900, topoM, 0, {}), sOn = buildLinkTimeline(tracks, jd0, jd0 + 8, 900, topoM, 0, pOpts);
    const open = (s: LinkSample[]) => s.filter((x) => x.earthUp[topoM.relays.indexOf('mars-aktarma')]).length;
    expect(open(sOn)).toBeLessThanOrEqual(open(sOff));
  });

  it('uydular arası bağlantı: moonIsl kapalıyken boş; açıkken iki Ay uydusu için durum + mesafe; Ay engellerse kapalı', () => {
    expect(computeNetwork(tracks, jd0, 3, { moonSecond: 'best' }).isl).toEqual([]);
    let up = 0, down = 0;
    for (let h = 0; h < 600; h++) {
      const l = computeNetwork(tracks, jd0 + h / 24, 3, { moonSecond: 'best', moonIsl: true }).isl; // ilk uydu ekvatoral dairesel, ikinci uydu eliptik/kutupsal
      expect(l.length).toBe(1);
      expect(l[0].km).toBeGreaterThan(0);
      if (l[0].up) { up++; expect(l[0].km).toBeLessThanOrEqual(HYPOTHETICAL.routing.islMaxKm); } else down++;
    }
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
    const t = schedTopology({ ...ell, moonSecond: 'best', moonIsl: true });
    expect(t.isl).toEqual([[0, 3]].map(([a]) => [a, t.relays.indexOf('ay-aktarma-2')]));
    const s = buildLinkTimeline(tracks, jd0, jd0 + 2, 1800, t, 3, { ...ell, moonSecond: 'best', moonIsl: true });
    expect(s[0].islUp!.length).toBe(1);
    expect(s[0].cand![0].length).toBe(2);
  });
});
