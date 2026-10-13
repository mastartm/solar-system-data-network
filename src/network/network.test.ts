import { describe, expect, it } from 'vitest';
import type { Track } from '../data/types';
import { C_KM_S, AU_KM } from '../map/ephemeris';
import { computeNetwork, findBlackoutWindows, marsSunSeparationDeg, segmentHitsSphere } from './network';

// Sentetik (gerçek DEĞİL) izler: sabit konumlu cisimler. Hız sıfır, tek aralık.
const fixed = (p: [number, number, number]): Track => ({
  startJD: 2450000, stepDays: 1000, count: 2,
  pos: Float64Array.from([...p, ...p]), vel: new Float64Array(6),
});
const tracks = (mars: [number, number, number], moonOffset: [number, number, number] = [384400, 0, 0]) => ({
  earth: fixed([AU_KM, 0, 0]), mars: fixed(mars), moon: fixed(moonOffset),
});
const JD = 2450100;

describe('Güneş–Mars açısı', () => {
  it('Mars Güneş’in arkasındayken ~0°', () => {
    expect(marsSunSeparationDeg(tracks([-1.5 * AU_KM, 0, 0]) as never, JD)).toBeCloseTo(0, 3);
  });
  it('dik konumda 90°', () => {
    expect(marsSunSeparationDeg(tracks([AU_KM, 1.5 * AU_KM, 0]) as never, JD)).toBeCloseTo(90, 3);
  });
});

describe('Mars kavuşumu kesintisi', () => {
  it('kavuşumda Mars bağlantıları kesilir, Ay etkilenmez', () => {
    const n = computeNetwork(tracks([-1.5 * AU_KM, 0, 0]) as never, JD);
    expect(n.marsBlackout).toBe(true);
    for (const s of n.statuses.filter((s) => s.asset.body === 'mars')) {
      expect(s.earthLink).toBe('blackout');
      expect(s.connected).toBe(false);
    }
    expect(n.statuses.some((s) => s.asset.body === 'moon' && s.earthLink !== 'blackout')).toBe(true);
  });
  it('dik konumda kesinti yok', () => {
    expect(computeNetwork(tracks([AU_KM, 1.5 * AU_KM, 0]) as never, JD).marsBlackout).toBe(false);
  });
  it('pencere taraması sabit düzende pencere bulmaz/bulur', () => {
    expect(findBlackoutWindows(tracks([-1.5 * AU_KM, 0, 0]) as never).length).toBe(1);
    expect(findBlackoutWindows(tracks([AU_KM, 1.5 * AU_KM, 0]) as never).length).toBe(0);
  });
});

describe('ışık gecikmesi', () => {
  it('Mars gecikmesi ≈ Dünya–Mars mesafesi / c (±uydu yarıçapı)', () => {
    const m: [number, number, number] = [AU_KM, 1.5 * AU_KM, 0];
    const n = computeNetwork(tracks(m) as never, JD);
    const d = 1.5 * AU_KM;
    for (const s of n.statuses.filter((s) => s.asset.body === 'mars')) {
      expect(Math.abs(s.delaySec - d / C_KM_S)).toBeLessThan(20000 / C_KM_S);
    }
  });
  it('Ay gecikmesi yaklaşık 1,3 sn', () => {
    const n = computeNetwork(tracks([AU_KM, 1.5 * AU_KM, 0]) as never, JD);
    const s = n.statuses.find((s) => s.asset.body === 'moon')!;
    expect(s.delaySec).toBeGreaterThan(1.0);
    expect(s.delaySec).toBeLessThan(1.7);
  });
});

describe('geometri', () => {
  it('kürenin arkasındaki doğru parçası kesişir', () => {
    expect(segmentHitsSphere([-10, 0, 0], [10, 0, 0], 1)).toBe(true);
    expect(segmentHitsSphere([-10, 5, 0], [10, 5, 0], 1)).toBe(false);
  });
});
