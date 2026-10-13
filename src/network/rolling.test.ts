import { describe, expect, it } from 'vitest';
import { forecastFlags, simulate, type BurstConfig, type LinkSample, type RollingConfig, type SchedConfig, type SchedTopology } from './scheduler';
import { hasBlackout, metricsOf } from './sweep';

// BU TESTLER SENTETİKTİR: uydurma tek araçlı topoloji, uydurma hızlar, uydurma periyodik "yer istasyonu boşluğu" deseni. Gerçek bir göreve ait değildir.
const topo: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r', dataRateKbps: 1000 }], relays: ['r'] };
const roll: RollingConfig = { rollingSec: 3000, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 };
const cfg = (over: Partial<SchedConfig> = {}): SchedConfig => ({
  classes: [
    { id: 'tel', priority: 0, share: 0.2, packetMb: 1 },
    { id: 'sci', priority: 1, share: 0.8, packetMb: 10 },
  ],
  dutyCycle: 0.6, // 0,6 Mb/sn üretim
  surfaceLinkKbps: { x: 5000 }, relayDownlinkKbps: { r: 2000 },
  assetBufferMb: { x: 100 }, relayBufferMb: { r: 200 },
  delayedAfterSec: 600, stepSec: 10, seriesEverySec: 100,
  rolling: roll,
  ...over,
});
const mk = (n: number, e: (i: number) => boolean, delay = 0, black: (i: number) => boolean = () => false): LinkSample[] =>
  Array.from({ length: n }, (_, i) => ({ surfaceUp: [true], surfaceDelaySec: [0], earthUp: [e(i)], earthDelaySec: [delay], earthBlackout: [black(i)] }));
// Her 100 adımda 40 adım açık, 60 adım kapalı (600 sn): 0,6 Mb/sn × 600 sn = 360 Mb birikir, tampon 300 Mb → öncelikli taşar. Ortalama boşaltma 0,8 > 0,6 Mb/sn.
const gaps = mk(4000, (i) => i % 100 < 40);
const conserved = (r: ReturnType<typeof simulate>) => {
  expect(r.total.generated).toBe(r.total.delivered + r.total.dropped + r.total.abandoned + r.total.remaining);
  for (const c of Object.values(r.perClass)) expect(c.generated).toBe(c.delivered + c.dropped + c.abandoned + c.remaining);
};

describe('kayan ufuklu strateji (sentetik)', () => {
  it('hiç kapalı dönem yoksa öncelikliyle birebir aynıdır', () => {
    const s = mk(1500, () => true);
    const a = simulate(topo, s, 'priority', cfg());
    const b = simulate(topo, s, 'rolling', cfg());
    expect({ ...b, policy: 'priority' }).toEqual(a);
    expect(b.total.suppressed).toBe(0);
  });

  it('kavuşum işareti OLMADAN, tekrarlayan hat boşluklarında kısar: öncelikli taşarken kayan ufuklu çok daha az düşürür; "düşen" ile "üretilmeyen" ayrı', () => {
    expect(hasBlackout(gaps)).toBe(false);
    const p = simulate(topo, gaps, 'priority', cfg());
    const g = simulate(topo, gaps, 'rolling', cfg());
    expect(p.total.dropped).toBeGreaterThan(50);
    expect(g.total.dropped).toBeLessThan(p.total.dropped * 0.3);
    expect(g.total.suppressed).toBeGreaterThan(0);
    expect(p.total.suppressed).toBe(0);
    // Aşama 4 ve Aşama 7 stratejileri bu desende (kesinti işareti yok) hiçbir şey yapmaz
    for (const pol of ['strategy', 'coverage'] as const) {
      const x = simulate(topo, gaps, pol, cfg({ strategy: { lookaheadSec: 200, margin: 0.9, minFactor: 0 }, coverage: { lookaheadSec: 200, recoverySec: 3000, margin: 0.9, minFactor: 0 } }));
      expect({ ...x, policy: 'priority' }).toEqual(p);
    }
  });

  it('telemetri (en önemli sınıf) kısılmaz ve düşmez', () => {
    const g = simulate(topo, gaps, 'rolling', cfg());
    expect(g.perClass.tel.suppressed).toBe(0);
    expect(g.perClass.tel.dropped).toBe(0);
    expect(g.perClass.sci.suppressed).toBeGreaterThan(0);
  });

  it('korunum: üretilen = teslim + düşen + hatta kayıp + kalan (her sınıf); talep = üretilen + üretilmeyen, öncelikli çizelgenin üretimine ±1 paket eşit', () => {
    for (const arq of [undefined, { surfaceLossPct: 1, earthLossPct: 5, maxAttempts: 4 }]) {
      const g = simulate(topo, gaps, 'rolling', cfg({ arq }));
      const p = simulate(topo, gaps, 'priority', cfg({ arq }));
      conserved(g); conserved(p);
      for (const id of ['tel', 'sci']) {
        const packet = id === 'tel' ? 1 : 10;
        const demand = g.perClass[id].generatedMb + g.perClass[id].suppressedMb;
        expect(Math.abs(demand - p.perClass[id].generatedMb)).toBeLessThanOrEqual(packet + 1e-6);
      }
    }
  });

  it('kısma toplam kaybı iyileştirmez: teslim edilen hacim öncelikliyi (anlamlı ölçüde) aşmaz, düşen + üretilmeyen ≥ öncelikli düşen − 1 paket payı', () => {
    const p = simulate(topo, gaps, 'priority', cfg());
    const g = simulate(topo, gaps, 'rolling', cfg());
    // Hat kapasitesi sınırlayıcıdır: kısma, taşan veriyi hiç üretmemeye çevirir
    expect(g.total.deliveredMb).toBeLessThanOrEqual(p.total.deliveredMb + 10 + 1e-6);
    expect(g.total.droppedMb + g.total.suppressedMb).toBeGreaterThanOrEqual(p.total.droppedMb - 10 - 1e-6);
  });

  it('kavuşum işaretiyle de çalışır (uzun kapalı dönem, ufuk onu görecek kadar uzun); deterministik ve girdiyi değiştirmez', () => {
    const s = mk(3000, (i) => !(i >= 200 && i < 1200), 0, (i) => i >= 200 && i < 1200);
    const c = cfg({ relayBufferMb: { r: 3000 }, assetBufferMb: { x: 1000 }, rolling: { ...roll, rollingSec: 15000 } });
    const copy = JSON.stringify(s);
    const p = simulate(topo, s, 'priority', c);
    const g = simulate(topo, s, 'rolling', c);
    expect(g.total.dropped).toBeLessThan(p.total.dropped);
    expect(g.total.suppressed).toBeGreaterThan(0);
    expect(simulate(topo, s, 'rolling', c)).toEqual(g);
    expect(JSON.stringify(s)).toBe(copy);
    conserved(g);
  });

  it('rolling ayarı yoksa kısma yapmaz', () => {
    const p = simulate(topo, gaps, 'priority', cfg());
    const g = simulate(topo, gaps, 'rolling', cfg({ rolling: undefined }));
    expect({ ...g, policy: 'priority' }).toEqual(p);
  });
});

describe('tahmin hatası (sentetik)', () => {
  it('forecastFlags: genişletme, daraltma, öteleme; veri kenarına değen uçlar kaydırılmaz; kesinti için ters', () => {
    const t = [0, 0, 1, 1, 1, 0, 0, 0, 1, 1];
    const show = (a: Uint8Array) => Array.from(a).join('');
    expect(show(forecastFlags(t, 0, 0, false))).toBe('0011100011');
    expect(show(forecastFlags(t, 1, 0, false))).toBe('0111110111'); // başta/sonda 1 adım genişler; son pencerenin sonu veri sonuna değdiği için kaymaz
    expect(show(forecastFlags(t, -1, 0, false))).toBe('0001000001'); // 1 adım daralır; son pencere de başından daralır, sonu kenarda kalır
    expect(show(forecastFlags(t, 0, 1, false))).toBe('0001110001'); // 1 adım geç
    expect(show(forecastFlags(t, 0, -1, false))).toBe('0111000110'); // 1 adım erken (öteleme veri kenarındaki ucu da kaydırır)
    expect(show(forecastFlags(t, 1, 0, true))).toBe(show(forecastFlags(t, -1, 0, false))); // kesinti için ters: iyimser (+) kesinti kısa öngörülür
    expect(forecastFlags([true, false, true], 0, 0, false)).toEqual(Uint8Array.from([1, 0, 1]));
  });

  const run = (forecast: SchedConfig['forecast'], pol: 'rolling' | 'priority' = 'rolling', over: Partial<SchedConfig> = {}) => simulate(topo, gaps, pol, cfg({ forecast, ...over }));

  it('hata sıfır (ya da yok) ise kusursuz tahminle birebir aynı sonuç', () => {
    const base = run(undefined);
    expect(run({})).toEqual(base);
    expect(run({ edgeShiftSec: 0, offsetSec: 0, lossBiasPct: 0 })).toEqual(base);
  });

  it('öncelikli çizelge tahmin hatasından etkilenmez (tahmin kullanmaz)', () => {
    expect(run({ edgeShiftSec: 300, offsetSec: 200, lossBiasPct: 100 }, 'priority')).toEqual(run(undefined, 'priority'));
  });

  it('pencereler fazla uzun sanılırsa (iyimser) kayan ufuklu daha çok düşürür; kısa sanılırsa (kötümser) daha çok kısar', () => {
    const perfect = run(undefined);
    const optimistic = run({ edgeShiftSec: 200 }); // her pencere başta ve sonda 200 sn uzun sanılır (20 adım)
    const pessimistic = run({ edgeShiftSec: -150 });
    expect(optimistic.total.dropped).toBeGreaterThan(perfect.total.dropped);
    expect(optimistic.total.suppressed).toBeLessThan(perfect.total.suppressed);
    expect(pessimistic.total.suppressed).toBeGreaterThan(perfect.total.suppressed);
    expect(pessimistic.total.dropped).toBeLessThanOrEqual(perfect.total.dropped);
    for (const r of [perfect, optimistic, pessimistic]) conserved(r);
  });

  it('ortalama kayıp küçük sanılırsa boşaltma kapasitesi fazla sanılır: daha az kısar (ARQ varken), korunum tutar', () => {
    const arq = { surfaceLossPct: 0, earthLossPct: 30, maxAttempts: 4 };
    const low = run({ lossBiasPct: -100 }, 'rolling', { arq });
    const high = run({ lossBiasPct: 100 }, 'rolling', { arq });
    expect(high.total.suppressed).toBeGreaterThanOrEqual(low.total.suppressed);
    conserved(low); conserved(high);
  });

  it('pencere ötelemesi de belirleyicidir ve korunumu bozmaz', () => {
    const a = run({ offsetSec: 300 });
    expect(run({ offsetSec: 300 })).toEqual(a);
    conserved(a);
  });

  it('metrikler: lossPct düşen + hatta kayıp + üretilmeyen, talep üzerinden', () => {
    const r = run(undefined);
    const m = metricsOf(r, cfg());
    expect(m.lossPct).toBeCloseTo((100 * (r.total.droppedMb + r.total.abandonedMb + r.total.suppressedMb)) / (r.total.generatedMb + r.total.suppressedMb), 9);
  });
});

describe('yüzey hattı yeniden deneme aralığı (sentetik, sabit tohumlu)', () => {
  const burst: BurstConfig = { goodLossPct: 0.5, badLossPct: 80, meanBadSec: 600, seed: 7 };
  const s = mk(6000, () => true);
  const arq = (surfaceRetrySec?: number) => ({ surfaceLossPct: 5, earthLossPct: 0, maxAttempts: 4, burst, ...(surfaceRetrySec !== undefined ? { surfaceRetrySec } : {}) });
  const run = (r?: number, over: Partial<SchedConfig> = {}) => simulate(topo, s, 'priority', cfg({ dutyCycle: 0.8, relayDownlinkKbps: { r: 4000 }, stepSec: 60, assetBufferMb: { x: 1e6 }, relayBufferMb: { r: 1e6 }, arq: arq(r), ...over }));

  it('0 ya da yok = aynı adımda (Aşama 5-7 davranışı), sonuç birebir aynı', () => {
    expect(run(0)).toEqual(run(undefined));
  });

  it('korunum: beklemedeki (yeniden denenecek) paketler "tamponda kalan" sayılır', () => {
    for (const r of [60, 600, 3600, 20000]) { const x = run(r); conserved(x); }
    // simülasyon sonunda bekleyen paket olabilir: kalan ≥ 0 ve korunum tutuyor
    expect(run(20000).total.remaining).toBeGreaterThanOrEqual(0);
  });

  it('kötü durumdan uzun bir yeniden deneme aralığı yüzey hattında hatta kaybı azaltır (kötü durumdan kaçar)', () => {
    const same = run(0), late = run(3600);
    expect(same.abandonedSurface).toBeGreaterThan(0);
    expect(late.abandonedSurface).toBeLessThan(same.abandonedSurface);
    expect(late.abandonedSurface).toBe(late.total.abandoned); // Dünya hattı kayıpsız
  });

  it('deterministiktir', () => { expect(run(900)).toEqual(run(900)); });

  it('küçük tamponla birlikte (bekleyen kopya yer tutar) korunumu bozmaz', () => {
    const x = run(1800, { assetBufferMb: { x: 60 }, relayBufferMb: { r: 100 } });
    conserved(x);
  });
});
