import { describe, expect, it } from 'vitest';
import type { Track } from '../data/types';
import { AU_KM } from '../map/ephemeris';
import { simulate, type LinkSample, type SchedConfig, type SchedTopology } from './scheduler';
import { buildLinkTimeline, lightDelaySeries } from './timeline';

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
const samples = (n: number, up: (i: number) => { s?: boolean; e?: boolean } = () => ({}), delay = 0): LinkSample[] =>
  Array.from({ length: n }, (_, i) => {
    const u = up(i);
    return { surfaceUp: [u.s ?? true], surfaceDelaySec: [0], earthUp: [u.e ?? true], earthDelaySec: [delay] };
  });
const conserved = (r: ReturnType<typeof simulate>) =>
  expect(r.total.generated).toBe(r.total.delivered + r.total.dropped + r.total.remaining);

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
