import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, LAYER_KEY, loadLayers, parseLayers, saveLayers } from './layers';

// Sentetik: sahte depolama nesneleri; gerçek tarayıcı verisi değildir.
const fake = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const throwing = {
  getItem: () => { throw new Error('engelli'); },
  setItem: () => { throw new Error('engelli'); },
};

describe('katman tercihleri', () => {
  it('kayıt yoksa varsayılan (hepsi açık)', () => {
    expect(loadLayers(fake())).toEqual(DEFAULT_LAYERS);
    expect(Object.values(DEFAULT_LAYERS).every(Boolean)).toBe(true);
  });
  it('kaydedip geri okur', () => {
    const s = fake();
    saveLayers({ ...DEFAULT_LAYERS, flow: false, orbits: false }, s);
    expect(loadLayers(s)).toEqual({ ...DEFAULT_LAYERS, flow: false, orbits: false });
    expect(s.m.has(LAYER_KEY)).toBe(true);
  });
  it('bozuk veya yabancı kayıt varsayılana düşer, geçerli alanlar korunur', () => {
    expect(parseLayers('{bozuk')).toEqual(DEFAULT_LAYERS);
    expect(parseLayers('42')).toEqual(DEFAULT_LAYERS);
    expect(parseLayers('{"network":false,"names":"evet","x":1}')).toEqual({ ...DEFAULT_LAYERS, network: false });
  });
  it('depolama yoksa ya da hata verirse çökmez', () => {
    expect(loadLayers(null)).toEqual(DEFAULT_LAYERS);
    expect(loadLayers(throwing)).toEqual(DEFAULT_LAYERS);
    expect(() => saveLayers(DEFAULT_LAYERS, throwing)).not.toThrow();
    expect(() => saveLayers(DEFAULT_LAYERS, null)).not.toThrow();
  });
});
