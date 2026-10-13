import { describe, expect, it } from 'vitest';
import type { Track } from '../data/types';
import type { CoverageRow } from './coverage';
import { createHandler, relayIdsOf, type SimOut, type TlInfo } from './compute';
import { ComputePool, inlineTransport } from './computeClient';
import { simulate } from './scheduler';
import { hasBlackout, metricsOf, runPolicy } from './sweep';
import { buildLinkTimeline, defaultParams, MARS_RELAY, MOON_RELAY, restrictToRelay, restrictToRelays, schedConfig, schedTopology, withParams } from './timeline';

// BU TESTLER SENTETİKTİR: uydurma dairesel yörüngeli konum izleri (gerçek Horizons verisi değil). Hesap işleyicisinin doğrudan çağrıyla aynı
// sonucu verdiğini, havuzun işleri sıralayıp dağıttığını ve iptal belirtecinin bekleyen işleri hiç başlatmadığını doğrular.
const mkTrack = (rKm: number, periodDays: number, n = 400, step = 1): Track => {
  const pos = new Float64Array(n * 3), vel = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i * step) / periodDays;
    pos.set([rKm * Math.cos(a), rKm * Math.sin(a), 0], i * 3);
    vel.set([-rKm * Math.sin(a) * ((2 * Math.PI) / periodDays), rKm * Math.cos(a) * ((2 * Math.PI) / periodDays), 0], i * 3);
  }
  return { startJD: 2460000, stepDays: step, count: n, pos, vel } as Track;
};
const AU = 149597870.7;
const tracks: Record<string, Track> = {
  sun: mkTrack(1, 1e9), mercury: mkTrack(0.39 * AU, 88), venus: mkTrack(0.72 * AU, 225), earth: mkTrack(AU, 365.25), mars: mkTrack(1.52 * AU, 687),
  jupiter: mkTrack(5.2 * AU, 4333), saturn: mkTrack(9.5 * AU, 10759), uranus: mkTrack(19.2 * AU, 30687), neptune: mkTrack(30 * AU, 60190), moon: mkTrack(384400, 27.3),
};
const tl = { startJD: 2460010, endJD: 2460012, stepSec: 1800, stations: 3, relayId: MARS_RELAY };

describe('hesap işleyicisi (sentetik izler)', () => {
  it('başlatılmadan çağrılırsa anlaşılır hata verir', () => {
    expect(() => createHandler()({ op: 'tlInfo', tl })).toThrow(/başlatılmadı/);
  });

  it('sim işlemi doğrudan çağrıyla birebir aynı sonucu verir; tlInfo özet doğru', () => {
    const h = createHandler();
    h({ op: 'init', tracks });
    const cfg = withParams(schedConfig('arq'), defaultParams(), MARS_RELAY);
    const out = h({ op: 'sim', tl, policy: 'rolling', cfg, full: true }) as SimOut;
    const full = buildLinkTimeline(tracks, tl.startJD, tl.endJD, tl.stepSec, schedTopology(), tl.stations);
    const { topo, samples } = restrictToRelay(schedTopology(), full, MARS_RELAY);
    const direct = simulate(topo, samples, 'rolling', cfg);
    expect(out.result).toEqual(direct);
    expect(out.metrics).toEqual(metricsOf(direct, cfg));
    expect((h({ op: 'sim', tl, policy: 'priority', cfg }) as SimOut).result).toBeUndefined(); // full istenmezse sonuç taşınmaz
    const info = h({ op: 'tlInfo', tl }) as TlInfo;
    expect(info.n).toBe(samples.length);
    expect(info.blackout).toBe(hasBlackout(samples));
    expect(info.openFrac).toBeCloseTo(samples.filter((x) => x.earthUp[0]).length / samples.length, 12);
    expect(info.topo).toEqual(topo);
  });

  it('policy işlemi runPolicy ile aynıdır; coverage işlemi sayaçları verir; bozuk aralık hata verir', () => {
    const h = createHandler();
    h({ op: 'init', tracks });
    const cfg = { ...schedConfig('arq'), stepSec: 1800 };
    const params = defaultParams();
    const got = h({ op: 'policy', tl, cfg, params, policy: 'priority', override: { relayBufferMb: 9000 } });
    const full = buildLinkTimeline(tracks, tl.startJD, tl.endJD, tl.stepSec, schedTopology(), tl.stations);
    const { topo, samples } = restrictToRelay(schedTopology(), full, MARS_RELAY);
    expect(got).toEqual(runPolicy(topo, samples, cfg, params, 'priority', { relayBufferMb: 9000 }, MARS_RELAY));
    const cov = h({ op: 'coverage', startJD: tl.startJD, endJD: tl.endJD, n: 3 }) as { steps: number; up: Record<string, number> };
    expect(cov.steps).toBe(96);
    expect(Object.keys(cov.up).length).toBeGreaterThan(0);
    expect(() => h({ op: 'tlInfo', tl: { ...tl, startJD: 2460012, endJD: 2460010 } })).toThrow();
  });
});

describe('hesap işleyicisi: Aşama 9 ağ seçenekleri (sentetik izler)', () => {
  const net = { moonSecond: 'best' as const, moonOrbit: 'elliptical' as const };
  const tl9 = { startJD: 2460010, endJD: 2460014, stepSec: 1800, stations: 2, relayId: MOON_RELAY, net };

  it('ikinci Ay uydulu çizelge: sim doğrudan çağrıyla aynı; tlInfo uydu başına ve en az bir uydunun açık oranını verir; kapsama ağ seçeneklerini kullanır', () => {
    const h = createHandler();
    h({ op: 'init', tracks });
    const cfg = withParams(schedConfig('arq'), defaultParams(MOON_RELAY), MOON_RELAY, ['ay-aktarma-2']);
    const out = h({ op: 'sim', tl: tl9, policy: 'adaptive', cfg, full: true }) as SimOut;
    const topo0 = schedTopology(net);
    const { topo, samples } = restrictToRelays(topo0, buildLinkTimeline(tracks, tl9.startJD, tl9.endJD, tl9.stepSec, topo0, tl9.stations, net), relayIdsOf(MOON_RELAY, net));
    expect(out.result).toEqual(simulate(topo, samples, 'adaptive', cfg));
    expect(topo.relays).toEqual(['ay-aktarma', 'ay-aktarma-2']);
    const info = h({ op: 'tlInfo', tl: tl9 }) as TlInfo;
    expect(info.openFracByRelay.length).toBe(2);
    expect(info.openFracAny).toBeGreaterThanOrEqual(Math.max(...info.openFracByRelay));
    expect(info.openFracAny).toBeLessThanOrEqual(1);
    const cov = h({ op: 'coverage', startJD: tl9.startJD, endJD: tl9.endJD, n: 2, net }) as CoverageRow;
    expect(Object.keys(cov.up)).toContain('ay-aktarma-2');
    expect(cov.anyUp).toBeGreaterThanOrEqual(Math.max(cov.up['ay-aktarma'], cov.up['ay-aktarma-2']));
    // seçeneksiz çizelge ayrı önbellek anahtarıdır ve tek uyduludur
    expect((h({ op: 'tlInfo', tl: { ...tl9, net: undefined } }) as TlInfo).topo.relays).toEqual(['ay-aktarma']);
  });

  it('policy işlemi ikinci uydunun kaydırıcı değerlerini de uygular (tampon/hat hızı iki uyduya)', () => {
    const h = createHandler();
    h({ op: 'init', tracks });
    const cfg = { ...schedConfig('arq'), stepSec: 1800 };
    const params = defaultParams(MOON_RELAY);
    const got = h({ op: 'policy', tl: tl9, cfg, params, policy: 'priority', override: { relayDownlinkKbps: 15 } });
    const topo0 = schedTopology(net);
    const { topo, samples } = restrictToRelays(topo0, buildLinkTimeline(tracks, tl9.startJD, tl9.endJD, tl9.stepSec, topo0, tl9.stations, net), relayIdsOf(MOON_RELAY, net));
    expect(got).toEqual(runPolicy(topo, samples, cfg, params, 'priority', { relayDownlinkKbps: 15 }, MOON_RELAY, ['ay-aktarma-2']));
  });
});

describe('hesap havuzu (satır içi aktarım, sentetik)', () => {
  const mkPool = (size: number) => { const p = new ComputePool(inlineTransport, size); void p.init(tracks); return p; };
  const cfg = withParams(schedConfig('arq'), defaultParams(), MARS_RELAY);

  it('işleri dağıtır; sonuç havuzdan geçince doğrudan çağrıyla aynıdır (1 ve 3 işçi)', async () => {
    const ref = createHandler(); ref({ op: 'init', tracks });
    const want = (ref({ op: 'sim', tl, policy: 'fifo', cfg }) as SimOut).metrics;
    for (const size of [1, 3]) {
      const pool = mkPool(size);
      const outs = await Promise.all(['fifo', 'fifo', 'fifo', 'fifo'].map(() => pool.call<SimOut>({ op: 'sim', tl, policy: 'fifo', cfg })));
      for (const o of outs) expect(o.metrics).toEqual(want);
    }
  });

  it('iptal: bekleyen işler hiç başlamaz, sürmekte olanın sonucu atılır (sözler sonuçlanmaz); sonraki işler çalışır', async () => {
    const pool = mkPool(1);
    const state = { settled: 0 };
    const jobs = Array.from({ length: 6 }, () => pool.call<SimOut>({ op: 'sim', tl, policy: 'priority', cfg }).then(() => state.settled++, () => state.settled++));
    expect(jobs).toHaveLength(6);
    await new Promise((r) => setTimeout(r, 0));
    const startedBefore = pool.started; // init + çalışmaya başlayan ilk iş
    pool.cancel();
    await new Promise((r) => setTimeout(r, 400)); // sürmekte olan iş biter, sonucu atılır
    expect(state.settled).toBe(0); // hiçbiri çözülmedi/reddedilmedi
    expect(pool.started).toBe(startedBefore); // iptal sonrası yeni iş başlamadı
    expect(pool.dropped).toBe(6); // 5 bekleyen + 1 sürmekte olan
    const ok = await pool.call<SimOut>({ op: 'sim', tl, policy: 'priority', cfg });
    expect(ok.metrics.demandMb).toBeGreaterThan(0);
  });

  it('işleyici hatası reddedilir (iptal değil); havuz sonrasında çalışmaya devam eder', async () => {
    const pool = mkPool(2);
    await expect(pool.call({ op: 'tlInfo', tl: { ...tl, startJD: 2460012, endJD: 2460010 } })).rejects.toThrow(/boş|veri dışında|NaN|sayısal/i);
    expect((await pool.call<TlInfo>({ op: 'tlInfo', tl })).n).toBeGreaterThan(0);
  });
});
