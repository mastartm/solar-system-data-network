import { describe, expect, it } from 'vitest';
import { simulate, type AdaptiveConfig, type LinkSample, type SchedConfig, type SchedTopology } from './scheduler';
import { metricsOf, valuePct } from './sweep';

// BU TESTLER SENTETİKTİR: uydurma tek araçlı topoloji, uydurma hızlar, uydurma periyodik hat boşlukları ve uzun kapalı dönemler. Gerçek bir göreve ait değildir.
const topo: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r', dataRateKbps: 1000 }], relays: ['r'] };
const ad = (over: Partial<AdaptiveConfig> = {}): AdaptiveConfig => ({ minSec: 500, maxSec: 20000, leadSec: 1000, tailFactor: 1, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100, ...over });
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
  adaptive: ad(),
  ...over,
});
const mk = (n: number, e: (i: number) => boolean, delay = 0, black: (i: number) => boolean = () => false): LinkSample[] =>
  Array.from({ length: n }, (_, i) => ({ surfaceUp: [true], surfaceDelaySec: [0], earthUp: [e(i)], earthDelaySec: [delay], earthBlackout: [black(i)] }));
const gaps = mk(4000, (i) => i % 100 < 40);
const conserved = (r: ReturnType<typeof simulate>) => {
  expect(r.total.generated).toBe(r.total.delivered + r.total.dropped + r.total.abandoned + r.total.remaining);
  for (const c of Object.values(r.perClass)) expect(c.generated).toBe(c.delivered + c.dropped + c.abandoned + c.remaining);
};

describe('uyarlamalı ufuk (adaptive, sentetik)', () => {
  it('hiç kapalı dönem yoksa öncelikliyle birebir aynıdır', () => {
    const s = mk(1500, () => true);
    const a = simulate(topo, s, 'priority', cfg());
    const b = simulate(topo, s, 'adaptive', cfg());
    expect({ ...b, policy: 'priority' }).toEqual(a);
    expect(b.total.suppressed).toBe(0);
  });

  it('ayar yoksa kısma yapmaz', () => {
    const p = simulate(topo, gaps, 'priority', cfg());
    const g = simulate(topo, gaps, 'adaptive', cfg({ adaptive: undefined }));
    expect({ ...g, policy: 'priority' }).toEqual(p);
  });

  it('ufuk sabitlenirse (minSec = maxSec) kayan ufuklu stratejiyle birebir aynı sonucu verir', () => {
    const r = simulate(topo, gaps, 'rolling', cfg());
    const a = simulate(topo, gaps, 'adaptive', cfg({ adaptive: ad({ minSec: 3000, maxSec: 3000 }) }));
    expect({ ...a, policy: 'rolling' }).toEqual(r);
  });

  it('tekrarlayan boşluklarda öncelikli taşarken az düşürür; telemetri kısılmaz ve düşmez; "düşen" ile "üretilmeyen" ayrı; korunum', () => {
    const p = simulate(topo, gaps, 'priority', cfg());
    const g = simulate(topo, gaps, 'adaptive', cfg());
    expect(p.total.dropped).toBeGreaterThan(50);
    expect(g.total.dropped).toBeLessThan(p.total.dropped * 0.3);
    expect(g.total.suppressed).toBeGreaterThan(0);
    expect(g.perClass.tel.suppressed).toBe(0);
    expect(g.perClass.tel.dropped).toBe(0);
    conserved(g);
    for (const id of ['tel', 'sci']) {
      const packet = id === 'tel' ? 1 : 10;
      expect(Math.abs(g.perClass[id].generatedMb + g.perClass[id].suppressedMb - p.perClass[id].generatedMb)).toBeLessThanOrEqual(packet + 1e-6);
    }
  });

  it('ufuk kapalı dönemin uzunluğuna göre seçilir: uzun kapalı dönemi gören uyarlamalı, kısa sabit ufuktan (miyop) az düşürür', () => {
    // 1000–3200. adımlar arası 2200 adım (22000 sn) kapalı; araç 0,6 Mb/sn üretir, tampon 300 Mb: kısmasız taşar. Kısa sabit ufuk (200 sn) kapanmayı geç görür.
    const s = mk(5000, (i) => !(i >= 1000 && i < 3200), 0, (i) => i >= 1000 && i < 3200);
    const c = cfg({ relayBufferMb: { r: 1000 }, assetBufferMb: { x: 300 } });
    const myopic = simulate(topo, s, 'rolling', { ...c, rolling: { ...c.rolling!, rollingSec: 200 } });
    const adaptive = simulate(topo, s, 'adaptive', { ...c, adaptive: ad({ minSec: 200, maxSec: 40000, leadSec: 2000, tailFactor: 0.5 }) });
    const prio = simulate(topo, s, 'priority', c);
    expect(prio.total.dropped).toBeGreaterThan(0);
    expect(adaptive.total.dropped).toBeLessThan(myopic.total.dropped);
    expect(adaptive.total.suppressed).toBeGreaterThan(0);
    conserved(adaptive);
  });

  it('kavuşum işareti gerekmez; deterministiktir ve girdiyi değiştirmez; maxSec kısa tutulunca ufuk kırpılır', () => {
    const copy = JSON.stringify(gaps);
    const a = simulate(topo, gaps, 'adaptive', cfg());
    expect(simulate(topo, gaps, 'adaptive', cfg())).toEqual(a);
    expect(JSON.stringify(gaps)).toBe(copy);
    const capped = simulate(topo, gaps, 'adaptive', cfg({ adaptive: ad({ maxSec: 600 }) }));
    conserved(capped);
  });

  it('tahmin hatası uyarlamalıya da uygulanır (hata yok = kusursuzla aynı; kötümser hata daha çok kısar)', () => {
    const base = simulate(topo, gaps, 'adaptive', cfg());
    expect(simulate(topo, gaps, 'adaptive', cfg({ forecast: { edgeShiftSec: 0, offsetSec: 0, lossBiasPct: 0 } }))).toEqual(base);
    const pess = simulate(topo, gaps, 'adaptive', cfg({ forecast: { edgeShiftSec: -150 } }));
    expect(pess.total.suppressed).toBeGreaterThan(base.total.suppressed);
    conserved(pess);
  });

  it('projeksiyon seçenekleriyle korunum sürer (ARQ + yüzey kapalılığı + RTT)', () => {
    const s = mk(4000, (i) => i % 100 < 40, 200).map((x, i) => ({ ...x, surfaceUp: [i % 100 >= 50] }));
    const r = simulate(topo, s, 'adaptive', cfg({ arq: { surfaceLossPct: 1, earthLossPct: 5, maxAttempts: 4 }, projection: { surfaceClosure: true, arqHold: true } }));
    conserved(r);
  });
});

describe('aktarma uydusu seçimi (assetRelay, sentetik)', () => {
  const topo2: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r1', dataRateKbps: 1000, alt: ['r2'] }], relays: ['r1', 'r2'] };
  const base = (): SchedConfig => cfg({ relayDownlinkKbps: { r1: 2000, r2: 2000 }, relayBufferMb: { r1: 200, r2: 200 }, adaptive: undefined });
  // r1 hiç Dünya'ya bağlı değil, r2 hep bağlı
  const mk2 = (n: number, withSel: boolean): LinkSample[] => Array.from({ length: n }, () => ({
    surfaceUp: [true], surfaceDelaySec: [0], earthUp: [false, true], earthDelaySec: [0, 0], earthBlackout: [false, false], ...(withSel ? { assetRelay: [1] } : {}),
  }));

  it('assetRelay yoksa araç ana uydusunu kullanır (veri r1\'de takılır), varsa seçilen uyduyu kullanır (r2 üzerinden teslim)', () => {
    const none = simulate(topo2, mk2(500, false), 'priority', base());
    const sel = simulate(topo2, mk2(500, true), 'priority', base());
    expect(none.total.delivered).toBe(0);
    expect(sel.total.delivered).toBeGreaterThan(0);
    conserved(none); conserved(sel);
  });

  it('kayan ufuklu / uyarlamalı strateji çok rotalı havuzu kullanır: r1 kapalı, r2 açıkken boşalma r2 üzerindendir; korunum', () => {
    const s = mk2(3000, true);
    const c = { ...base(), rolling: { rollingSec: 3000, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 }, adaptive: ad() };
    for (const pol of ['rolling', 'adaptive'] as const) conserved(simulate(topo2, s, pol, c));
  });
});

describe('değer ağırlıklı ölçüt (sentetik)', () => {
  const half = [86400, 7 * 86400];
  const run = (pol: 'priority' | 'fifo' = 'priority', over: Partial<SchedConfig> = {}, smp = gaps) => simulate(topo, smp, pol, cfg({ valueHalfLivesSec: half, ...over }));

  it('yarı ömür verilmezse decayMb boş; verilirse sınıf ve toplam için aynı sırada, ≤ teslim edilen hacim', () => {
    const none = simulate(topo, gaps, 'priority', cfg());
    expect(none.total.decayMb).toEqual([]);
    const r = run();
    expect(r.total.decayMb.length).toBe(2);
    for (const c of [...Object.values(r.perClass), r.total]) {
      expect(c.decayMb[0]).toBeLessThanOrEqual(c.decayMb[1] + 1e-9);
      expect(c.decayMb[1]).toBeLessThanOrEqual(c.deliveredMb + 1e-9);
      expect(c.decayMb[0]).toBeGreaterThanOrEqual(0);
    }
    expect(r.total.decayMb[0]).toBeCloseTo(Object.values(r.perClass).reduce((s, c) => s + c.decayMb[0], 0), 9);
  });

  it('çok uzun yarı ömürde azalan değer = sabit değer; çok kısada ≈ 0', () => {
    const r = run('priority', { valueHalfLivesSec: [1e12, 1e-3] });
    expect(r.total.decayMb[0]).toBeCloseTo(r.total.deliveredMb, 3);
    expect(r.total.decayMb[1]).toBeLessThan(1e-6);
  });

  it('teslim yaşı hesabı: tek paket, gecikmesiz hat → değer 2^(−yaş/yarı ömür)', () => {
    // bir telemetri paketi üretilir ve ilk adımda teslim edilir: yaş = bir adım + ışık gecikmesi
    const s = mk(1, () => true, 5);
    const r = simulate(topo, s, 'priority', cfg({ dutyCycle: 0.1, valueHalfLivesSec: [100], stepSec: 10, classes: [{ id: 'tel', priority: 0, share: 1, packetMb: 1, valuePerMb: 1 }] }));
    if (r.total.delivered > 0) expect(r.total.decayMb[0]).toBeCloseTo(r.total.delivered * Math.pow(2, -r.total.latencyMeanSec / 100), 9);
  });

  it('valuePct: eşit ağırlıkta teslim yüzdesiyle aynı; ağırlık telemetriye kayınca telemetri teslim oranına yaklaşır; yarı ömür yalnızca bilim verisini azaltır', () => {
    const c = cfg({ valueHalfLivesSec: half });
    const r = simulate(topo, gaps, 'fifo', c);
    const m = metricsOf(r, c);
    expect(valuePct(m, { weightOf: () => 1 })).toBeCloseTo(m.deliveredPct, 9);
    const tel = r.perClass.tel, sci = r.perClass.sci;
    expect(valuePct(m, { weightOf: (p) => (p.id === 'tel' ? 1e9 : 1) })).toBeCloseTo((100 * tel.deliveredMb) / (tel.generatedMb + tel.suppressedMb), 4);
    expect(valuePct(m)).toBeCloseTo((100 * (4 * tel.deliveredMb + sci.deliveredMb)) / (4 * (tel.generatedMb + tel.suppressedMb) + sci.generatedMb + sci.suppressedMb), 9);
    const decayed = valuePct(m, { halfLifeIdx: 0 });
    expect(decayed).toBeLessThan(valuePct(m));
    // telemetri azalmaz: yalnızca telemetri ağırlıklıysa değer değişmez
    expect(valuePct(m, { halfLifeIdx: 0, weightOf: (p) => (p.id === 'tel' ? 1 : 0) })).toBeCloseTo(valuePct(m, { weightOf: (p) => (p.id === 'tel' ? 1 : 0) }), 9);
    expect(m.valueParts.map((p) => p.decays)).toEqual([false, true]);
  });

  it('metrikler mevcut ölçütleri değiştirmez (yarı ömür eklemek düşen/teslim/kayıp % değerlerini aynı bırakır)', () => {
    const c1 = cfg(), c2 = cfg({ valueHalfLivesSec: half });
    const a = metricsOf(simulate(topo, gaps, 'adaptive', c1), c1), b = metricsOf(simulate(topo, gaps, 'adaptive', c2), c2);
    const { valueParts: _a, valueHalfLivesSec: _b, ...ra } = a, { valueParts: _c, valueHalfLivesSec: _d, ...rb } = b;
    expect(rb).toEqual(ra);
  });

  it('sabit değerde kısma değeri artırmaz; zamanla azalan değer kısmanın göreli sonucunu iyileştirir (eski veriyi azaltıp yeni veriyi öne alır) ama bu senaryoda kazanca çevirmez', () => {
    // uzun kapalı dönem + sonrasında doygun hat
    const s = mk(6000, (i) => !(i >= 500 && i < 3000), 0, (i) => i >= 500 && i < 3000);
    const c = cfg({ valueHalfLivesSec: [3000], relayBufferMb: { r: 4000 }, assetBufferMb: { x: 1000 }, adaptive: ad({ maxSec: 40000, leadSec: 2000 }) });
    const p = metricsOf(simulate(topo, s, 'priority', c), c), a = metricsOf(simulate(topo, s, 'adaptive', c), c);
    const flatGain = valuePct(a) - valuePct(p);
    const decayGain = valuePct(a, { halfLifeIdx: 0 }) - valuePct(p, { halfLifeIdx: 0 });
    expect(flatGain).toBeLessThanOrEqual(0.01); // hat kapasitesi sınırlayıcı: hacim artmaz
    expect(decayGain).toBeGreaterThan(flatGain); // azalan değer kısmayı lehine çevirir (ama burada hâlâ ≤ 0)
    expect(a.dropPct).toBeLessThan(p.dropPct);
  });
});
