import { describe, expect, it } from 'vitest';
import { dateToJd, jdToDate, lightMinutes, sample } from './ephemeris';
import type { Track } from '../data/types';

// Test verisi: yarıçapı 1e8 km, dönemi 100 gün olan sentetik daire (gerçek veri DEĞİL).
function circle(step: number, count: number): Track {
  const R = 1e8, w = (2 * Math.PI) / 100;
  const pos = new Float64Array(count * 3), vel = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = w * i * step;
    pos.set([R * Math.cos(a), R * Math.sin(a), 0], i * 3);
    vel.set([-R * w * Math.sin(a), R * w * Math.cos(a), 0], i * 3);
  }
  return { startJD: 2450000, stepDays: step, count, pos, vel };
}

describe('sample', () => {
  it('örnek noktalarında tam değeri verir', () => {
    const t = circle(2, 60);
    expect(sample(t, 2450000)[0]).toBeCloseTo(1e8, 0);
  });
  it('ara günlerde dairesel yörüngeyi küçük hatayla izler', () => {
    const t = circle(2, 60);
    const jd = 2450000 + 13.3;
    const a = (2 * Math.PI * 13.3) / 100;
    const [x, y] = sample(t, jd);
    expect(Math.hypot(x - 1e8 * Math.cos(a), y - 1e8 * Math.sin(a))).toBeLessThan(1e4);
  });
  it('aralık dışında uca sabitlenir', () => {
    const t = circle(2, 10);
    expect(sample(t, 1)).toEqual(sample(t, 2450000));
  });
});

describe('yardımcılar', () => {
  it('1 AU yaklaşık 8,32 ışık dakikasıdır', () => {
    expect(lightMinutes(149597870.7)).toBeCloseTo(8.317, 2);
  });
  it('JD <-> tarih gidiş-dönüş', () => {
    const d = new Date(Date.UTC(2026, 9, 13));
    expect(jdToDate(dateToJd(d)).getTime()).toBe(d.getTime());
  });
});
