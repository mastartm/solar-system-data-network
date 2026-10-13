import { describe, expect, it } from 'vitest';
import type { Track } from '../data/types';
import { AU_KM } from '../map/ephemeris';
import { genLinkStates, mulberry32, simulate, type BurstConfig, type CoverageConfig, type LinkSample, type SchedConfig, type SchedTopology, type StrategyConfig } from './scheduler';
import { hasBlackout, runPolicies, sweepPoint, sweepValues } from './sweep';
import { buildLinkTimeline, defaultParams, lightDelaySeries, restrictToRelay, withParams } from './timeline';

// BU TESTLER SENTETİKTİR: uydurma tek araçlı topoloji, uydurma hızlar. Gerçek bir göreve ait değildir.
const topo: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r', dataRateKbps: 1000 }], relays: ['r'] };
const cfg = (over: Partial<SchedConfig> = {}): SchedConfig => ({
  classes: [
    { id: 'tel', priority: 0, share: 0.2, packetMb: 1 },
    { id: 'sci', priority: 1, share: 0.8, packetMb: 10 },
  ],
  dutyCycle: 1, // 1 Mb/sn üretim
  surfaceLinkKbps: { x: 5000 }, relayDownlinkKbps: { r: 2000 },
  assetBufferMb: { x: 1e6 }, relayBufferMb: { r: 1e6 },
  delayedAfterSec: 600, stepSec: 10, seriesEverySec: 100,
  ...over,
});
const samples = (n: number, up: (i: number) => { s?: boolean; e?: boolean; b?: boolean } = () => ({}), delay = 0): LinkSample[] =>
  Array.from({ length: n }, (_, i) => {
    const u = up(i);
    return { surfaceUp: [u.s ?? true], surfaceDelaySec: [0], earthUp: [u.e ?? true], earthDelaySec: [delay], earthBlackout: [u.b ?? false] };
  });
const conserved = (r: ReturnType<typeof simulate>) => {
  expect(r.total.generated).toBe(r.total.delivered + r.total.dropped + r.total.abandoned + r.total.remaining);
  for (const c of Object.values(r.perClass)) expect(c.generated).toBe(c.delivered + c.dropped + c.abandoned + c.remaining);
};

describe('çizelgeleyici (sentetik)', () => {
  it('bağlantı hep açık ve kapasite yeterliyse her şey ulaşır, kayıp yok', () => {
    for (const p of ['fifo', 'priority'] as const) {
      const r = simulate(topo, samples(500), p, cfg());
      expect(r.total.dropped).toBe(0);
      expect(r.total.delivered).toBeGreaterThan(0);
      expect(r.total.remaining).toBeLessThan(5);
      conserved(r);
    }
  });

  it('Dünya bağlantısı kesilince tampon dolar, açılınca boşalır; paketler tamponlanır', () => {
    const r = simulate(topo, samples(600, (i) => ({ e: i < 100 || i >= 300 })), 'fifo', cfg());
    const peak = Math.max(...r.series.map((s) => s.relayFill[0]));
    expect(peak).toBeGreaterThan(0);
    expect(r.total.stored).toBeGreaterThan(0);
    expect(r.series.at(-1)!.relayFill[0]).toBe(0);
    expect(r.total.dropped).toBe(0);
    conserved(r);
  });

  it('araç ufkun altındayken veri araç tamponunda bekler', () => {
    const r = simulate(topo, samples(300, (i) => ({ s: i >= 150 })), 'fifo', cfg());
    expect(r.series.find((s) => s.tSec === 1000)!.assetFill[0]).toBeGreaterThan(0);
    conserved(r);
  });

  it('tampon küçükse uzun kesintide veri düşer; öncelikli çizelge telemetriyi korur', () => {
    const c = cfg({ relayBufferMb: { r: 100 }, assetBufferMb: { x: 100 } });
    const s = samples(1500, (i) => ({ e: i < 100 || i >= 900 }));
    const fifo = simulate(topo, s, 'fifo', c);
    const prio = simulate(topo, s, 'priority', c);
    expect(fifo.total.dropped).toBeGreaterThan(0);
    expect(prio.perClass.tel.dropped).toBeLessThan(fifo.perClass.tel.dropped);
    // not: FIFO düşürdüğü telemetriyi ortalamaya katmaz (hayatta kalma yanlılığı), bu yüzden süre değil teslim sayısı karşılaştırılır
    expect(prio.perClass.tel.delivered).toBeGreaterThan(fifo.perClass.tel.delivered);
    conserved(fifo); conserved(prio);
  });

  it('öncelikli çizelge önce telemetriyi boşaltır (birikmiş kuyrukta)', () => {
    const s = samples(900, (i) => ({ e: i < 100 || i >= 400 }));
    const fifo = simulate(topo, s, 'fifo', cfg());
    const prio = simulate(topo, s, 'priority', cfg());
    expect(prio.perClass.tel.latencyP95Sec).toBeLessThan(fifo.perClass.tel.latencyP95Sec);
    // toplam teslim aynı iş-korumalı olduğundan yaklaşık eşit
    expect(Math.abs(prio.total.deliveredMb - fifo.total.deliveredMb)).toBeLessThan(30);
  });

  it('ışık gecikmesi teslim süresine eklenir', () => {
    const a = simulate(topo, samples(200, () => ({}), 0), 'fifo', cfg());
    const b = simulate(topo, samples(200, () => ({}), 600), 'fifo', cfg());
    expect(b.total.latencyMeanSec - a.total.latencyMeanSec).toBeCloseTo(600, 3);
  });

  it('deterministiktir', () => {
    const s = samples(400, (i) => ({ e: i % 7 !== 0 }));
    expect(simulate(topo, s, 'priority', cfg())).toEqual(simulate(topo, s, 'priority', cfg()));
  });
});

 
describe('kavuşum stratejisi (sentetik)', () => {
  // 200–1200. adımlar arası "kavuşum": Dünya hattı kapalı ve strateji bunu önceden biliyor. Küçük tamponlar → öncelikli çizelge taşar.
  const strat: StrategyConfig = { lookaheadSec: 200, margin: 0.9, minFactor: 0 };
  const c = cfg({ dutyCycle: 0.6, relayBufferMb: { r: 3000 }, assetBufferMb: { x: 1000 }, strategy: strat });
  const blackout = samples(2000, (i) => ({ e: !(i >= 200 && i < 1200), b: i >= 200 && i < 1200 }));

  it('kesinti işareti yoksa strateji öncelikliyle birebir aynı sonucu verir', () => {
    const s = samples(800, (i) => ({ e: i < 100 || i >= 400 })); // kapalı ama "kavuşum" olarak işaretli değil
    const a = simulate(topo, s, 'priority', c);
    const b = simulate(topo, s, 'strategy', c);
    expect({ ...b, policy: 'priority' }).toEqual(a);
    expect(b.total.suppressed).toBe(0);
  });

  it('üretimi kısar: öncelikli taşarken strateji neredeyse hiç düşürmez, kısılan "üretilmeyen" sayılır', () => {
    const p = simulate(topo, blackout, 'priority', c);
    const g = simulate(topo, blackout, 'strategy', c);
    expect(p.total.dropped).toBeGreaterThan(0);
    expect(g.total.suppressed).toBeGreaterThan(0);
    expect(g.total.dropped).toBeLessThan(p.total.dropped * 0.2);
    expect(g.total.generated).toBeLessThan(p.total.generated);
  });

  it('telemetri (en önemli sınıf) hiç kısılmaz ve düşmez', () => {
    const g = simulate(topo, blackout, 'strategy', c);
    expect(g.perClass.tel.suppressed).toBe(0);
    expect(g.perClass.tel.dropped).toBe(0);
    expect(g.perClass.sci.suppressed).toBeGreaterThan(0);
  });

  it('korunum: üretilen = teslim + düşen + kalan; talep (üretilen + üretilmeyen) öncelikli çizelgenin üretimine eşit (±1 paket)', () => {
    const p = simulate(topo, blackout, 'priority', c);
    const g = simulate(topo, blackout, 'strategy', c);
    conserved(g);
    for (const k of ['tel', 'sci']) {
      const demand = g.perClass[k].generated + g.perClass[k].suppressed;
      expect(Math.abs(demand - p.perClass[k].generated)).toBeLessThanOrEqual(1);
      expect(Math.abs(g.perClass[k].generatedMb + g.perClass[k].suppressedMb - p.perClass[k].generatedMb)).toBeLessThan(c.classes.find((x) => x.id === k)!.packetMb + 1e-6);
    }
  });

  it('deterministiktir ve girdiyi değiştirmez', () => {
    const copy = JSON.stringify(blackout);
    expect(simulate(topo, blackout, 'strategy', c)).toEqual(simulate(topo, blackout, 'strategy', c));
    expect(JSON.stringify(blackout)).toBe(copy);
  });

  it('strateji ayarı yoksa kısma yapmaz', () => {
    const r = simulate(topo, blackout, 'strategy', { ...c, strategy: undefined });
    expect(r.total.suppressed).toBe(0);
  });
});

describe('duyarlılık yardımcıları (sentetik)', () => {
  it('withParams girdiyi değiştirmez; Mars değerlerini uygular', () => {
    const base = cfg({ relayBufferMb: { r: 5, 'mars-aktarma': 7 }, relayDownlinkKbps: { r: 1, 'mars-aktarma': 2 } });
    const before = JSON.stringify(base);
    const out = withParams(base, { relayBufferMb: 70, relayDownlinkKbps: 20, dutyCycle: 0.3, earthLossPct: 9 });
    expect(JSON.stringify(base)).toBe(before);
    expect(out.relayBufferMb).toEqual({ r: 5, 'mars-aktarma': 70 });
    expect(out.relayDownlinkKbps['mars-aktarma']).toBe(20);
    expect(out.dutyCycle).toBe(0.3);
    expect(withParams(base, defaultParams()).dutyCycle).toBe(defaultParams().dutyCycle);
  });

  it('daha büyük tampon (diğerleri sabit) daha az düşürür; tarama tekdüzedir', () => {
    const s = samples(1500, (i) => ({ e: i < 100 || i >= 900 }));
    let prev = Infinity;
    for (const buf of [50, 100, 200, 400, 800]) {
      const r = simulate(topo, s, 'priority', cfg({ relayBufferMb: { r: buf }, assetBufferMb: { x: 50 } }));
      expect(r.total.dropped).toBeLessThanOrEqual(prev);
      conserved(r);
      prev = r.total.dropped;
    }
  });

  it('restrictToRelay yalnızca o uyduyu ve araçlarını bırakır', () => {
    const two: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r1', dataRateKbps: 1 }, { id: 'b', body: 'y', relay: 'r2', dataRateKbps: 1 }], relays: ['r1', 'r2'] };
    const smp: LinkSample[] = [{ surfaceUp: [true, false], surfaceDelaySec: [1, 2], earthUp: [false, true], earthDelaySec: [3, 4], earthBlackout: [false, true] }];
    const r = restrictToRelay(two, smp, 'r2');
    expect(r.topo).toEqual({ assets: [two.assets[1]], relays: ['r2'] });
    expect(r.samples[0]).toEqual({ surfaceUp: [false], surfaceDelaySec: [2], earthUp: [true], earthDelaySec: [4], earthBlackout: [true] });
    expect(() => restrictToRelay(two, smp, 'yok')).toThrow();
  });
});

describe('hat hatası ve yeniden iletim (sentetik)', () => {
  const arq = (over: Partial<NonNullable<SchedConfig['arq']>> = {}) => ({ surfaceLossPct: 0, earthLossPct: 20, maxAttempts: 10, ...over });
  const run = (c: SchedConfig, delay = 0, n = 2000, up?: (i: number) => { s?: boolean; e?: boolean }) => simulate(topo, samples(n, up, delay), 'priority', c);

  it('kayıpsız ARQ (0 %) hiçbir şeyi kaybetmez; korunum tutar', () => {
    const r = run(cfg({ arq: arq({ earthLossPct: 0 }) }));
    expect(r.total.txLost).toBe(0); expect(r.total.abandoned).toBe(0); expect(r.total.retransmissions).toBe(0);
    expect(r.total.delivered).toBeGreaterThan(0);
    conserved(r);
  });

  it('yeniden iletim yokken (maxAttempts 1) kaybolan deneme kalıcı kayıptır; kayıp ≈ oran', () => {
    const r = run(cfg({ arq: arq({ maxAttempts: 1 }) }));
    expect(r.total.abandoned).toBeLessThanOrEqual(r.total.txLost);
    expect(r.total.txLost - r.total.abandoned).toBeLessThanOrEqual(2); // en fazla birkaç red, simülasyon sonunda henüz işlenmemiş
    expect(r.total.retransmissions).toBe(0);
    const attempts = r.total.delivered + r.total.txLost;
    expect(r.total.txLost / attempts).toBeGreaterThan(0.15); expect(r.total.txLost / attempts).toBeLessThan(0.25); // %20 ± deterministik sapma
    conserved(r);
  });

  it('yeniden iletim kaybı kurtarır: teslim artar, kalıcı kayıp neredeyse sıfır, süre uzar', () => {
    const none = run(cfg({ arq: arq({ maxAttempts: 1 }) }), 60);
    const withArq = run(cfg({ arq: arq() }), 60);
    expect(withArq.total.retransmissions).toBeGreaterThan(0);
    expect(withArq.total.retransmissions).toBeLessThanOrEqual(withArq.total.txLost - withArq.total.abandoned);
    expect(withArq.total.txLost - withArq.total.abandoned - withArq.total.retransmissions).toBeLessThanOrEqual(15); // sonda RTT (120 sn) içinde bekleyen redler
    expect(withArq.total.delivered).toBeGreaterThan(none.total.delivered);
    expect(withArq.total.abandoned).toBeLessThan(none.total.abandoned * 0.05 + 1);
    expect(withArq.total.latencyMaxSec).toBeGreaterThan(none.total.latencyMaxSec); // geri gelen paket RTT kadar geç
    conserved(none); conserved(withArq);
  });

  it('gönderici kopyayı RTT boyunca tutar: ışık gecikmesi büyüdükçe tampon doluluğu artar', () => {
    const c = cfg({ arq: arq({ earthLossPct: 0 }), relayBufferMb: { r: 5000 } });
    const near = run(c, 0), far = run(c, 400); // RTT 800 sn
    expect(far.peakRelayFill.r).toBeGreaterThan(near.peakRelayFill.r);
    conserved(near); conserved(far);
  });

  it('küçük tamponda kopya tutma, yeniden iletim ve taşma birlikte korunumu bozmaz (öncelikli ve FIFO)', () => {
    for (const p of ['fifo', 'priority'] as const) {
      const r = simulate(topo, samples(1500, (i) => ({ e: i < 100 || i >= 900 }), 300), p, cfg({ arq: arq({ surfaceLossPct: 3 }), relayBufferMb: { r: 200 }, assetBufferMb: { x: 100 } }));
      expect(r.total.dropped).toBeGreaterThan(0);
      conserved(r);
    }
  });

  it('deterministiktir ve ARQ yokken eski davranışı (txLost 0) korur', () => {
    const c = cfg({ arq: arq() });
    expect(run(c, 30)).toEqual(run(c, 30));
    const off = run(cfg(), 30);
    expect(off.total.txLost).toBe(0); expect(off.total.abandoned).toBe(0);
  });
});

describe('zaman çizelgesi ve gecikme serisi (sentetik izler)', () => {
  const fixed = (p: [number, number, number]): Track => ({
    startJD: 2450000, stepDays: 1000, count: 2, pos: Float64Array.from([...p, ...p]), vel: new Float64Array(6),
  });
  const tr = (mars: [number, number, number]) => ({ earth: fixed([AU_KM, 0, 0]), mars: fixed(mars), moon: fixed([384400, 0, 0]) });

  it('kavuşumda Mars uydusunun Dünya bağlantısı hiç açılmaz', () => {
    const t = buildLinkTimeline(tr([-1.5 * AU_KM, 0, 0]), 2450100, 2450101, 600);
    expect(t.length).toBe(144);
    expect(t.every((x) => !x.earthUp[1])).toBe(true); // relays: [ay, mars]
  });
  it('Mars gecikmesi = mesafe / c', () => {
    const d = lightDelaySeries(tr([AU_KM, 1.5 * AU_KM, 0]), 'mars', 10);
    expect(d[0].sec).toBeCloseTo((1.5 * AU_KM) / 299792.458, 3);
    expect(lightDelaySeries(tr([AU_KM, 1.5 * AU_KM, 0]), 'moon', 10)[0].sec).toBeCloseTo(1.282, 2);
  });
});

describe('tarama (sentetik)', () => {
  const sp = { relayBufferMb: 1000, relayDownlinkKbps: 2000, dutyCycle: 1, earthLossPct: 0 }; // dutyCycle: 1 → 1 Mb/sn
  const base = cfg({ relayBufferMb: { r: 1000 }, assetBufferMb: { x: 100 }, relayDownlinkKbps: { r: 2000 }, strategy: { lookaheadSec: 100, margin: 0.9, minFactor: 0 } });
  // 'mars-aktarma' anahtarı bu sentetik topolojide yok; withParams onu ekler ama kullanılmaz. Tarama için gerçek anahtarı kullanan topoloji:
  const tp: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'mars-aktarma', dataRateKbps: 1000 }], relays: ['mars-aktarma'] };
  const smp = samples(1500, (i) => ({ e: !(i >= 100 && i < 900), b: i >= 100 && i < 900 }));

  it('sweepValues eşit aralıklıdır ve verilen değeri araya sokar', () => {
    expect(sweepValues(0, 10, 3)).toEqual([0, 5, 10]);
    expect(sweepValues(0, 10, 3, 2)).toEqual([0, 2, 5, 10]);
    expect(sweepValues(0, 10, 3, 5)).toEqual([0, 5, 10]);
  });

  it('tampon büyüdükçe öncelikli çizelgede düşen oranı azalır; strateji düşenleri üretilmeyene çevirir; talep eşit', () => {
    const rows = [200, 1000, 3000].map((b) => sweepPoint(tp, smp, base, sp, 'relayBufferMb', b));
    for (let i = 1; i < rows.length; i++) expect(rows[i].priority.dropPct).toBeLessThanOrEqual(rows[i - 1].priority.dropPct);
    for (const m of rows) {
      expect(m.strategy.suppressedMb).toBeGreaterThanOrEqual(0);
      expect(m.strategy.dropPct).toBeLessThanOrEqual(m.priority.dropPct + 1e-9);
      expect(Math.abs(m.strategy.demandMb - m.priority.demandMb)).toBeLessThan(25); // en büyük paket 10 Mb
      expect(m.fifo.suppressedMb).toBe(0);
    }
    expect(rows[0].priority.dropPct).toBeGreaterThan(0);
  });
});


describe('kapsama bilen strateji (sentetik)', () => {
  // BU TESTLER SENTETİKTİR. 200–1200. adımlar arası "kavuşum" (hat kapalı, işaretli). Sonrasında hat YALNIZCA her 10 adımın 2'sinde açık
  // (zayıf yer istasyonu kapsaması); hat hızı 2 Mb/sn → açık oran %20 ile ortalama boşaltma 0,4 Mb/sn, üretim 0,6 Mb/sn.
  const strat: StrategyConfig = { lookaheadSec: 200, margin: 0.9, minFactor: 0 };
  const cov: CoverageConfig = { lookaheadSec: 200, recoverySec: 18000, margin: 0.9, minFactor: 0 }; // toparlanma ufku simülasyon sonuna kadar
  const c = cfg({ dutyCycle: 0.6, relayBufferMb: { r: 3000 }, assetBufferMb: { x: 1000 }, strategy: strat, coverage: cov });
  const weak = samples(3000, (i) => ({ e: i >= 1200 ? i % 10 < 2 : i < 200, b: i >= 200 && i < 1200 }));
  const full = samples(3000, (i) => ({ e: !(i >= 200 && i < 1200), b: i >= 200 && i < 1200 }));

  it('kesinti işareti yoksa kapsama stratejisi öncelikliyle birebir aynıdır (kısma yok)', () => {
    const s = samples(800, (i) => ({ e: i < 100 || i >= 400 }));
    const a = simulate(topo, s, 'priority', c);
    const b = simulate(topo, s, 'coverage', c);
    expect({ ...b, policy: 'priority' }).toEqual(a);
    expect(b.total.suppressed).toBe(0);
    expect(hasBlackout(s)).toBe(false);
  });

  it('zayıf kapsamada: eski strateji kavuşum sonrası taşar, kapsama bilen strateji daha az düşürür ve daha çok kısar', () => {
    const p = simulate(topo, weak, 'priority', c);
    const g = simulate(topo, weak, 'strategy', c);
    const k = simulate(topo, weak, 'coverage', c);
    expect(g.total.dropped).toBeGreaterThan(0); // eski strateji kapsamayı bilmediği için kavuşum sonrası yine taşar
    expect(k.total.dropped).toBeLessThan(g.total.dropped * 0.2);
    expect(k.total.suppressed).toBeGreaterThan(g.total.suppressed);
    expect(p.total.dropped).toBeGreaterThan(g.total.dropped);
  });

  it('tam kapsamada kapsama bilen strateji eskisiyle yakın davranır (aşırı kısmaz)', () => {
    const g = simulate(topo, full, 'strategy', c);
    const k = simulate(topo, full, 'coverage', c);
    expect(k.total.dropped).toBeLessThanOrEqual(g.total.dropped + 2);
    // bütçe yalnızca uydu tamponu payına dayandığı için (araç tamponu sayılmaz) biraz daha çok kısabilir, ama aşırıya kaçmaz
    expect(k.total.suppressedMb).toBeLessThan(g.total.suppressedMb * 2 + 50);
    expect(k.total.suppressedMb).toBeGreaterThan(0);
  });

  it('telemetri kısılmaz ve düşmez; korunum ve talep denklemleri tutar', () => {
    const p = simulate(topo, weak, 'priority', c);
    const k = simulate(topo, weak, 'coverage', c);
    expect(k.perClass.tel.suppressed).toBe(0);
    expect(k.perClass.tel.dropped).toBe(0);
    conserved(k);
    for (const id of ['tel', 'sci']) {
      expect(Math.abs(k.perClass[id].generated + k.perClass[id].suppressed - p.perClass[id].generated)).toBeLessThanOrEqual(1);
    }
  });

  it('daha uzun toparlanma ufku daha çok kısar (tekdüze), korunum tutar; deterministiktir ve girdiyi değiştirmez', () => {
    const copy = JSON.stringify(weak);
    let prev = -1;
    for (const rec of [0, 3000, 6000, 12000, 18000]) {
      const r = simulate(topo, weak, 'coverage', { ...c, coverage: { ...cov, recoverySec: rec } });
      expect(r.total.suppressedMb).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r.total.suppressedMb;
      conserved(r);
    }
    expect(simulate(topo, weak, 'coverage', c)).toEqual(simulate(topo, weak, 'coverage', c));
    expect(JSON.stringify(weak)).toBe(copy);
  });

  it('ayar yoksa kısma yapmaz; hat kaybı varken (ARQ) de korunum tutar', () => {
    expect(simulate(topo, weak, 'coverage', { ...c, coverage: undefined }).total.suppressed).toBe(0);
    const r = simulate(topo, weak, 'coverage', { ...c, arq: { surfaceLossPct: 1, earthLossPct: 10, maxAttempts: 4 } });
    conserved(r);
    expect(r.total.suppressed).toBeGreaterThan(0);
  });

  it('runPolicies kesinti yokken kısayol kullanır ve gerçek hesapla aynı sonucu verir', () => {
    const tp: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'mars-aktarma', dataRateKbps: 1000 }], relays: ['mars-aktarma'] };
    const s = samples(600, (i) => ({ e: i < 100 || i >= 400 }));
    const base = cfg({ relayBufferMb: { 'mars-aktarma': 300 }, assetBufferMb: { x: 100 }, relayDownlinkKbps: { 'mars-aktarma': 2000 }, strategy: strat, coverage: cov });
    const sp = { relayBufferMb: 300, relayDownlinkKbps: 2000, dutyCycle: 1, earthLossPct: 0 };
    const { metrics } = runPolicies(tp, s, base, sp);
    const real = simulate(tp, s, 'coverage', base);
    expect(metrics.coverage.deliveredMb).toBe(real.total.deliveredMb);
    expect(metrics.coverage.dropPct).toBeGreaterThan(0);
    expect(metrics.coverage.dropPct).toBe(metrics.priority.dropPct);
  });
});

describe('kümelenmiş hata modeli (sentetik, sabit tohumlu)', () => {
  // BU TESTLER SENTETİKTİR: uydurma hat, uydurma kayıp değerleri.
  const burst: BurstConfig = { goodLossPct: 0.5, badLossPct: 80, meanBadSec: 600, seed: 7 };
  const runs = (a: Uint8Array) => { const out: number[] = []; let n = 0; for (const v of a) { if (v) n++; else if (n) { out.push(n); n = 0; } } if (n) out.push(n); return out; };

  it('üreteç belirleyicidir ve [0,1) verir; farklı tohum farklı dizi', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const xa = Array.from({ length: 5 }, a), xb = Array.from({ length: 5 }, b), xc = Array.from({ length: 5 }, c);
    expect(xa).toEqual(xb); expect(xa).not.toEqual(xc);
    expect(xa.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('durum zincirinin kötü oranı ve ortalama kötü süresi hedefe yakındır', () => {
    const n = 200000, dt = 100;
    const st = genLinkStates(n, dt, 5, burst, 1);
    const pi = (5 - 0.5) / (80 - 0.5);
    const frac = st.reduce((x, v) => x + v, 0) / n;
    expect(Math.abs(frac - pi)).toBeLessThan(0.01);
    const r = runs(st);
    const mean = (r.reduce((x, y) => x + y, 0) / r.length) * dt;
    expect(mean).toBeGreaterThan(450); expect(mean).toBeLessThan(750); // 600 sn hedef
    expect(genLinkStates(n, dt, 5, burst, 1)).toEqual(st); // belirleyici
    expect(genLinkStates(100, dt, 0.5, burst, 1).every((v) => v === 0)).toBe(true); // ortalama ≤ iyi kayıp → hep iyi
  });

  const arq = (over: Partial<NonNullable<SchedConfig['arq']>> = {}) => ({ surfaceLossPct: 0, earthLossPct: 5, maxAttempts: 4, ...over });
  const run = (a: NonNullable<SchedConfig['arq']>, delay = 0, n = 6000, over: Partial<SchedConfig> = {}) =>
    simulate(topo, samples(n, undefined, delay), 'priority', cfg({ arq: a, dutyCycle: 0.8, relayDownlinkKbps: { r: 4000 }, stepSec: 60, ...over }));

  it('ortalama kayıp periyodik modele yakın (aynı), ama kayıplar kümelenir: art arda kayıp daha uzun, maxAttempts aşımı daha çok', () => {
    const per = run(arq());
    const bur = run(arq({ burst }));
    // denemeler iki hattaki tüm denemelerdir (yüzey hattı kayıpsız): Dünya hattı %5 → toplam ≈ %2,5
    expect(per.total.txLost / per.total.attempts).toBeGreaterThan(0.02); expect(per.total.txLost / per.total.attempts).toBeLessThan(0.03);
    const rate = bur.total.txLost / bur.total.attempts;
    // nominal ≈ %2,5; kötü durumda yeniden denemeler yığıldığı için (denemeler kötü durumda aşırı temsil edilir) gerçekleşen oran daha yüksek olabilir
    expect(rate).toBeGreaterThan(0.012); expect(rate).toBeLessThan(0.09);
    expect(per.maxLossRun).toBeLessThanOrEqual(1);
    expect(bur.maxLossRun).toBeGreaterThan(per.maxLossRun + 2);
    expect(per.total.abandoned).toBe(0);
    expect(bur.total.abandoned).toBeGreaterThan(0); // kısa RTT: yeniden deneme aynı kötü durumda kalır
    conserved(per); conserved(bur);
  });

  it('uzun RTT (kötü durumdan uzun) yeniden denemeyi kötü durumdan kurtarır: hatta kayıp azalır', () => {
    const shortRtt = run(arq({ burst }), 0);
    const longRtt = run(arq({ burst }), 3000); // RTT 6000 sn ≫ 600 sn ortalama kötü süre
    expect(longRtt.total.abandoned).toBeLessThan(shortRtt.total.abandoned);
    conserved(shortRtt); conserved(longRtt);
  });

  it('belirleyicidir, burst yokken eski periyodik sonuç değişmez, tohum değişince dizi değişir', () => {
    const a = arq({ burst });
    expect(run(a)).toEqual(run(a));
    expect(run(a)).not.toEqual(run(arq({ burst: { ...burst, seed: 8 } })));
    const noBurst = run(arq());
    expect(noBurst.total.txLost).toBe(run(arq({ burst: undefined })).total.txLost);
  });

  it('hatta kayıp, kaybın hangi hattan geldiğini ayırır (yüzey / Dünya)', () => {
    const onlySurface = run(arq({ surfaceLossPct: 5, earthLossPct: 0, burst }));
    expect(onlySurface.total.abandoned).toBeGreaterThan(0);
    expect(onlySurface.abandonedSurface).toBe(onlySurface.total.abandoned);
    const onlyEarth = run(arq({ surfaceLossPct: 0, earthLossPct: 5, burst }));
    expect(onlyEarth.abandonedSurface).toBe(0);
    expect(onlyEarth.total.abandoned).toBeGreaterThan(0);
  });

  it('küçük tampon, kapsama stratejisi ve kümelenmiş hata birlikte korunumu bozmaz', () => {
    const cv: CoverageConfig = { lookaheadSec: 200, recoverySec: 3000, margin: 0.9, minFactor: 0 };
    const s = samples(2500, (i) => ({ e: i < 200 || i >= 1300, b: i >= 200 && i < 1300 }), 100);
    for (const p of ['fifo', 'priority', 'strategy', 'coverage'] as const) {
      const r = simulate(topo, s, p, cfg({ dutyCycle: 0.6, relayBufferMb: { r: 800 }, assetBufferMb: { x: 400 }, strategy: { lookaheadSec: 200, margin: 0.9, minFactor: 0 }, coverage: cv, arq: arq({ surfaceLossPct: 2, burst }) }));
      conserved(r);
    }
  });
});
