import { describe, expect, it } from 'vitest';
import { eclipseLabel, nearestEclipse, type Eclipse } from './eclipses';

const e = (kind: string, type: 'solar' | 'lunar', jd: number): Eclipse => ({ kind, type, jd, time: '' });

describe('eclipses', () => {
  it('en yakın tutulmayı bulur', () => {
    const list = [e('total', 'solar', 100), e('partial', 'lunar', 130)];
    expect(nearestEclipse(list, 120)?.eclipse.jd).toBe(130);
    expect(nearestEclipse(list, 120)?.days).toBe(10);
    expect(nearestEclipse([], 1)).toBeNull();
  });
  it('Türkçe etiket üretir', () => {
    expect(eclipseLabel(e('annular', 'solar', 0))).toBe('Halkalı güneş tutulması');
    expect(eclipseLabel(e('total', 'lunar', 0))).toBe('Tam Ay tutulması');
  });
});
