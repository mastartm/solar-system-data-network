import { describe, expect, it } from 'vitest';
import { validateTracks } from './loader';
import { syntheticTracks } from './synthetic';

// BU TESTLER SENTETİKTİR: sentetik dairesel yörüngeler ve bilerek bozulmuş kopyalar; gerçek Horizons verisi değildir.
describe('validateTracks (sentetik)', () => {
  it('sağlam veride sorun bildirmez', () => expect(validateTracks(syntheticTracks())).toEqual([]));
  it('eksik gövdeyi bildirir', () => {
    const t = syntheticTracks(); delete t.mars;
    expect(validateTracks(t).join()).toContain('mars: veri yok');
  });
  it('uzunluk uyuşmazlığını ve NaN değerini bildirir, çökmez', () => {
    const t = syntheticTracks();
    t.earth = { ...t.earth, pos: t.earth.pos.slice(3) };
    t.venus = { ...t.venus, pos: Float64Array.from(t.venus.pos, (v, i) => (i === 3 ? NaN : v)) };
    const p = validateTracks(t).join('|');
    expect(p).toContain('earth: uzunluk');
    expect(p).toContain('venus: sayısal olmayan');
  });
});
