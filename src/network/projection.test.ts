import { describe, expect, it } from 'vitest';
import { simulate, type LinkSample, type SchedConfig, type SchedTopology } from './scheduler';

// BU TESTLER SENTETİKTİR: uydurma tek araçlı topoloji, uydurma hızlar, uydurma periyodik hat boşlukları. Gerçek bir göreve ait değildir.
const topo: SchedTopology = { assets: [{ id: 'a', body: 'x', relay: 'r', dataRateKbps: 1000 }], relays: ['r'] };
const cfg = (over: Partial<SchedConfig> = {}): SchedConfig => ({
  classes: [
    { id: 'tel', priority: 0, share: 0.2, packetMb: 1 },
    { id: 'sci', priority: 1, share: 0.8, packetMb: 10 },
  ],
  dutyCycle: 0.6, // 0,6 Mb/sn üretim
  surfaceLinkKbps: { x: 5000 }, relayDownlinkKbps: { r: 2000 },
  assetBufferMb: { x: 100 }, relayBufferMb: { r: 200 },
  delayedAfterSec: 600, stepSec: 10, seriesEverySec: 100,
  rolling: { rollingSec: 3000, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 },
  ...over,
});
const mk = (n: number, e: (i: number) => boolean, s: (i: number) => boolean = () => true, delay = 0): LinkSample[] =>
  Array.from({ length: n }, (_, i) => ({ surfaceUp: [s(i)], surfaceDelaySec: [0], earthUp: [e(i)], earthDelaySec: [delay], earthBlackout: [false] }));
const conserved = (r: ReturnType<typeof simulate>) => {
  expect(r.total.generated).toBe(r.total.delivered + r.total.dropped + r.total.abandoned + r.total.remaining);
  for (const c of Object.values(r.perClass)) expect(c.generated).toBe(c.delivered + c.dropped + c.abandoned + c.remaining);
};
// Dünya hattı her 100 adımda 40 adım açık
const earthGaps = (i: number) => i % 100 < 40;

describe('havuz projeksiyonu seçenekleri (sentetik)', () => {
  it('seçenekler yok / ikisi de kapalı: Aşama 8 davranışıyla birebir aynı', () => {
    const s = mk(3000, earthGaps, (i) => i % 100 >= 20);
    for (const pol of ['rolling', 'adaptive'] as const) {
      const base = simulate(topo, s, pol, cfg({ adaptive: { minSec: 500, maxSec: 3000, leadSec: 500, tailFactor: 1, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 } }));
      const off = simulate(topo, s, pol, cfg({ projection: { surfaceClosure: false, arqHold: false }, adaptive: { minSec: 500, maxSec: 3000, leadSec: 500, tailFactor: 1, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 } }));
      expect(off).toEqual(base);
    }
  });

  it('yüzey hattı sık ve hızlıyken yüzey kapalılığı sonucu değiştirmez (iki aşamalı model tek havuza iner)', () => {
    const s = mk(3000, earthGaps); // yüzey hep açık, 5 Mb/sn ≫ üretim
    const a = simulate(topo, s, 'rolling', cfg());
    const b = simulate(topo, s, 'rolling', cfg({ projection: { surfaceClosure: true } }));
    expect(b.total.suppressed).toBe(a.total.suppressed);
    expect(b.total.dropped).toBe(a.total.dropped);
  });

  it('yüzey hattı uzun süre kapalıyken, kapalılığı hesaba katan projeksiyon daha çok kısar ve daha az düşürür; korunum sürer', () => {
    // Yüzey hattı her 100 adımda yalnız son 10 adım açık; Dünya hattı ilk 40 adım açık: araç tamponu yüzey kapalıyken boşalmaz.
    const s = mk(4000, earthGaps, (i) => i % 100 >= 90);
    const a = simulate(topo, s, 'rolling', cfg());
    const b = simulate(topo, s, 'rolling', cfg({ projection: { surfaceClosure: true } }));
    expect(b.total.suppressed).toBeGreaterThan(a.total.suppressed);
    expect(b.total.dropped).toBeLessThan(a.total.dropped);
    conserved(a); conserved(b);
    // talep = üretilen + üretilmeyen; öncelikli çizelgenin üretimine ±1 paket eşit
    const p = simulate(topo, s, 'priority', cfg());
    expect(Math.abs(b.total.generated + b.total.suppressed - p.total.generated)).toBeLessThanOrEqual(2);
  });

  it('ARQ kopyası RTT boyunca tampon tutuyorsa, RTT uzunken projeksiyon daha çok kısar; korunum sürer', () => {
    // ışık gecikmesi 300 sn → RTT 600 sn = 60 adım; Dünya hattı açık dönemi 40 adım, hat kapalı dönemi 60 adım: kopyalar kapalı dönemin başında hâlâ tamponda.
    const s = mk(4000, earthGaps, () => true, 300);
    const arq = { surfaceLossPct: 0, earthLossPct: 0, maxAttempts: 4 };
    const a = simulate(topo, s, 'rolling', cfg({ arq }));
    const b = simulate(topo, s, 'rolling', cfg({ arq, projection: { arqHold: true } }));
    expect(b.total.suppressed).toBeGreaterThanOrEqual(a.total.suppressed);
    expect(b.total.suppressed).toBeGreaterThan(0);
    conserved(a); conserved(b);
  });

  it('ARQ yokken arqHold hiçbir şey yapmaz', () => {
    const s = mk(3000, earthGaps, () => true, 300);
    const a = simulate(topo, s, 'rolling', cfg());
    const b = simulate(topo, s, 'rolling', cfg({ projection: { arqHold: true } }));
    expect(b).toEqual(a);
  });

  it('iki seçenek birlikte: korunum ve deterministiklik; girdiyi değiştirmez', () => {
    const s = mk(4000, earthGaps, (i) => i % 100 >= 80, 200);
    const sCopy = JSON.stringify(s);
    const c = cfg({ arq: { surfaceLossPct: 1, earthLossPct: 5, maxAttempts: 4 }, projection: { surfaceClosure: true, arqHold: true } });
    const r1 = simulate(topo, s, 'rolling', c), r2 = simulate(topo, s, 'rolling', c);
    expect(r2).toEqual(r1);
    expect(JSON.stringify(s)).toBe(sCopy);
    conserved(r1);
  });

  it('kesinti işareti ve kapsama stratejisi de seçeneklerle korunumu bozmaz', () => {
    const s = mk(4000, (i) => i % 100 < 40 && !(i > 1000 && i < 1800), (i) => i % 100 >= 50).map((x, i) => ({ ...x, earthBlackout: [i > 1000 && i < 1800] }));
    const cv = { lookaheadSec: 200, recoverySec: 3000, margin: 0.9, minFactor: 0, assetBufferShare: 1, refreshSec: 100 };
    for (const po of [{}, { surfaceClosure: true }, { arqHold: true }, { surfaceClosure: true, arqHold: true }]) {
      const r = simulate(topo, s, 'coverage', cfg({ coverage: cv, arq: { surfaceLossPct: 1, earthLossPct: 5, maxAttempts: 4 }, projection: po }));
      conserved(r);
    }
  });
});
