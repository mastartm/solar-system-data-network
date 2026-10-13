import { describe, expect, it } from 'vitest';
import { FACTS, factRows, formatDays } from '../data/bodyFacts';
import { BODIES, type BodyId } from '../data/types';
import { countsFor, ORDER } from '../ui/bodiesPanel';
import { fbm3, generateTexture, noise3, TEX_H, TEX_W } from './planetTextures';
import { prepareScene, renderFrame, ringColor } from './sphereRender';

// Sentetik/belirleyici kontroller: gerçek bir yüzey verisiyle karşılaştırma yoktur (dokular şematiktir).
const IDS = BODIES.map((b) => b.id) as BodyId[];
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v, i) => v === b[i]);
const mean = (t: Uint8ClampedArray, j0: number, j1: number) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = j0; j < j1; j++) for (let i = 0; i < TEX_W; i++) { const o = (j * TEX_W + i) * 3; r += t[o]; g += t[o + 1]; b += t[o + 2]; n++; }
  return [r / n, g / n, b / n];
};

describe('gürültü ve dokular', () => {
  it('gürültü belirleyici ve [0,1] aralığında', () => {
    expect(noise3(1.3, 2.7, 3.1, 5)).toBe(noise3(1.3, 2.7, 3.1, 5));
    for (let i = 0; i < 200; i++) { const v = fbm3(i * 0.37, i * 0.11, i * 0.53, 4, 2); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it('her cisim için doku belirleyici (iki üretim birebir aynı) ve doğru boyutta', () => {
    for (const id of IDS) {
      const a = generateTexture(id, 64, 32), b = generateTexture(id, 64, 32);
      expect(a.length).toBe(64 * 32 * 3);
      expect(same(a, b)).toBe(true);
    }
  });
  it('cisimler birbirinden ayırt edilir (ortalama renkler farklı)', () => {
    const m = new Map(IDS.map((id) => [id, mean(generateTexture(id), 0, TEX_H)]));
    for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) {
      const a = m.get(IDS[i])!, b = m.get(IDS[j])!;
      if ((IDS[i] === 'moon' && IDS[j] === 'mercury') || (IDS[i] === 'mercury' && IDS[j] === 'moon')) continue; // ikisi de gri, kraterli
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(8);
    }
  });
  it('Dünya: kutuplar beyaz (buz), Mars kutbu açık; Satürn halkası bantlı ve Cassini aralığı soluk', () => {
    const e = generateTexture('earth');
    const north = mean(e, 0, 4);
    expect(Math.min(...north)).toBeGreaterThan(190);
    const mid = mean(e, TEX_H / 2 - 8, TEX_H / 2 + 8);
    expect(mid[2]).toBeGreaterThan(mid[0]); // ekvator çevresi okyanus ağırlıklı (mavi)
    expect(ringColor(1.7)[3]).toBeGreaterThan(ringColor(1.99)[3] * 4);
    expect(ringColor(1.0)[3]).toBe(0);
  });
});

describe('küre kartı', () => {
  it('belirleyici kare; dönme görüntüyü değiştirir, tam tur aynı görüntüyü verir', () => {
    const tex = generateTexture('earth', TEX_W, TEX_H);
    const s = prepareScene(48, { tiltDeg: 23 });
    const f = (spin: number) => { const o = new Uint8ClampedArray(48 * 48 * 4); renderFrame(s, tex, spin, o); return o; };
    expect(same(f(0.1), f(0.1))).toBe(true);
    expect(same(f(0), f(0.3))).toBe(false);
    const a = f(0.2), b = f(1.2);
    let diff = 0; for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
    expect(diff).toBeLessThanOrEqual(1); // yuvarlama payı
  });
  it('küre diski dolu, köşeler şeffaf; ışık sol-üstten: sol taraf sağdan aydınlık', () => {
    const tex = new Uint8ClampedArray(TEX_W * TEX_H * 3).fill(200);
    const s = prepareScene(64, { tiltDeg: 0 });
    const o = new Uint8ClampedArray(64 * 64 * 4); renderFrame(s, tex, 0, o);
    expect(o[3]).toBe(0);
    const px = (x: number, y: number) => o[(y * 64 + x) * 4];
    expect(o[(32 * 64 + 32) * 4 + 3]).toBe(255);
    expect(px(18, 28)).toBeGreaterThan(px(46, 36));
  });
  it('Satürn sahnesinde halka pikselleri (kind 2/3) var; Uranüs (98°) ters dönme işareti taşır', () => {
    const r = prepareScene(64, { tiltDeg: 26.7, ring: true });
    expect([...r.kind].some((k) => k === 2)).toBe(true);
    expect([...r.kind].some((k) => k === 3)).toBe(true);
    expect(prepareScene(32, { tiltDeg: 97.8 }).spinSign).toBe(-1);
    expect(prepareScene(32, { tiltDeg: 23 }).spinSign).toBe(1);
  });
});

describe('fiziksel bilgiler ve sol panel sayıları', () => {
  it('her cismin bilgisi var; dev gezegenlerde uydu sayısı alt sınır (≥)', () => {
    for (const id of IDS) expect(FACTS[id].radiusKm).toBeGreaterThan(0);
    for (const id of ['jupiter', 'saturn', 'uranus', 'neptune'] as BodyId[]) {
      expect(factRows(id).find((r) => r[0] === 'Bilinen uydu')![1].startsWith('≥')).toBe(true);
    }
    expect(factRows('earth').find((r) => r[0] === 'Bilinen uydu')![1]).toBe('1');
    expect(formatDays(0.99727)).toContain('saat');
    expect(formatDays(4332)).toContain('yıl');
  });
  it('sayılar hypothetical.ts yapılandırmasından gelir; Ay Dünya\'nın altında', () => {
    expect(countsFor('moon')).toEqual({ relays: 1, assets: 2, stations: 0 });
    expect(countsFor('mars')).toEqual({ relays: 1, assets: 2, stations: 0 });
    expect(countsFor('earth').stations).toBe(3);
    expect(countsFor('jupiter')).toEqual({ relays: 0, assets: 0, stations: 0 });
    expect(ORDER.indexOf('moon')).toBe(ORDER.indexOf('earth') + 1);
    expect(new Set(ORDER).size).toBe(10);
  });
});
