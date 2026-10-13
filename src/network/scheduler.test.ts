import { describe, expect, it } from 'vitest';
import type { Track } from '../data/types';
import { AU_KM } from '../map/ephemeris';
import { simulate, type LinkSample, type SchedConfig, type SchedTopology, type StrategyConfig } from './scheduler';
import { sweepPoint, sweepValues } from './sweep';
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
  expect(r.total.generated).toBe(r.total.delivered + r.total.dropped + r.total.remaining);
  for (const c of Object.values(r.perClass)) expect(c.generated).toBe(c.delivered + c.dropped + c.remaining);
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
    const out = withParams(base, { marsRelayBufferMb: 70, marsRelayDownlinkKbps: 20, dutyCycle: 0.3 });
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
  const sp = { marsRelayBufferMb: 1000, marsRelayDownlinkKbps: 2000, dutyCycle: 1 }; // dutyCycle: 1 → 1 Mb/sn
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
    const rows = [200, 1000, 3000].map((b) => sweepPoint(tp, smp, base, sp, 'marsRelayBufferMb', b));
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
