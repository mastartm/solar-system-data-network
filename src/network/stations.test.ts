import { describe, expect, it } from 'vitest';
import { HYPOTHETICAL } from '../config/hypothetical';
import { syntheticTracks } from '../data/synthetic';
import { computeNetwork } from './network';
import { EARTH_RADIUS_KM, bestStation, elevationDeg, gmstDeg, stationPosition } from './stations';

// BU TESTLER SENTETİKTİR: sentetik dairesel yörüngeler ve uydurma hedef vektörleri; gerçek Horizons verisi değildir.
const st = { latDeg: 35.4, lonDeg: -116.9 };

describe('yer istasyonu geometrisi (sentetik)', () => {
  it('GMST J2000 anında 280,46° ve her 0,99727 günde bir tur', () => {
    expect(gmstDeg(2451545)).toBeCloseTo(280.4606, 3);
    expect(gmstDeg(2451545 + 0.9972696)).toBeCloseTo(280.4606, 1);
  });
  it('istasyon konumunun uzunluğu Dünya yarıçapıdır', () => {
    const p = stationPosition(st, 2460000.3);
    expect(Math.hypot(...p)).toBeCloseTo(EARTH_RADIUS_KM, 6);
  });
  it('tam tepedeki hedef 90°, Dünya’nın öbür tarafındaki hedef negatif', () => {
    const jd = 2460000.3, p = stationPosition(st, jd), k = 400000 / EARTH_RADIUS_KM;
    expect(elevationDeg(st, jd, [p[0] * k, p[1] * k, p[2] * k])).toBeCloseTo(90, 3);
    expect(elevationDeg(st, jd, [-p[0] * k, -p[1] * k, -p[2] * k])).toBeLessThan(0);
  });
  it('bestStation: eşik altı hedefte null, üstünde en yüksek istasyonu seçer', () => {
    const jd = 2460000.3, p = stationPosition(HYPOTHETICAL.groundStations.stations[0], jd), k = 400000 / EARTH_RADIUS_KM;
    const up = bestStation(HYPOTHETICAL.groundStations.stations, jd, [p[0] * k, p[1] * k, p[2] * k], 10);
    expect(up?.station.id).toBe('yi-a');
    expect(bestStation([HYPOTHETICAL.groundStations.stations[0]], jd, [-p[0] * k, -p[1] * k, -p[2] * k], 10)).toBeNull(); // tek istasyon, hedef onun antipodunda
  });
});

describe('ağ modeli: yer istasyonu ve Ay Aracı A (sentetik izler)', () => {
  const tracks = syntheticTracks();
  const jd0 = 2458849.5 + 400;
  const frac = (f: (jd: number) => boolean, hours = 24 * 30) => {
    let n = 0, t = 0;
    for (let h = 0; h < hours; h += 0.5) { t++; if (f(jd0 + h / 24)) n++; }
    return n / t;
  };
  const moonCov = (count: number) => frac((jd) => computeNetwork(tracks, jd, count).statuses.find((s) => s.relay.id === 'ay-aktarma')!.station !== null);

  it('daha çok istasyon, daha çok kapsama (tekdüze) ve hiçbiri tam kapsamaz ya da hiç görmez', () => {
    const c1 = moonCov(1), c2 = moonCov(2), c3 = moonCov(3);
    expect(c1).toBeLessThanOrEqual(c2); expect(c2).toBeLessThanOrEqual(c3);
    expect(c1).toBeGreaterThan(0.1); expect(c1).toBeLessThan(0.9);
    expect(c3).toBeGreaterThan(c1);
  });
  it('istasyon modeli kapalıyken (0) Dünya hattı yalnızca cisim kapanmasına bağlıdır', () => {
    const net = computeNetwork(tracks, jd0, 0);
    expect(net.stationCount).toBe(0);
    expect(net.statuses.every((s) => s.station === null && s.earthLink !== 'nostation')).toBe(true);
  });
  it('görüş yoksa earthLink "nostation" olur ve bağlantı kesiktir', () => {
    for (let h = 0; h < 24 * 5; h += 0.5) {
      const net = computeNetwork(tracks, jd0 + h / 24, 1);
      for (const s of net.statuses) if (s.earthLink === 'nostation') { expect(s.connected).toBe(false); expect(s.station).toBeNull(); return; }
    }
    throw new Error('5 günde hiç "nostation" görülmedi (tek istasyonlu Ay hattı için beklenmezdi)');
  });
  it('Ay Aracı A artık uyduyu görebiliyor (eski −85° enlemde hiç görmüyordu)', () => {
    const up = frac((jd) => computeNetwork(tracks, jd, 0).statuses.find((s) => s.asset.id === 'ay-1')!.surfaceLink === 'up');
    expect(up).toBeGreaterThan(0.2);
  });
});
