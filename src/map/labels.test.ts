import { describe, expect, it } from 'vitest';
import { directionOrder, LabelCollector, LabelPriority, placeLabels, type Bounds, type LabelRequest } from './labels';

// Tüm veriler SENTETİKTİR (uydurma konumlar ve boyutlar); gerçek bir ekran veya görev değildir.
const B: Bounds = { x0: 0, y0: 0, x1: 400, y1: 300 };
const req = (id: string, ax: number, ay: number, priority: number, extra: Partial<LabelRequest> = {}): LabelRequest => ({
  id, text: id, ax, ay, radius: 4, priority, w: 60, h: 14, ...extra,
});
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('placeLabels', () => {
  it('birbirine çok yakın nesnelerin etiketleri çakışmaz', () => {
    const reqs = Array.from({ length: 8 }, (_, i) => req(`r${i}`, 200 + i * 3, 150 + (i % 2) * 2, LabelPriority.asset));
    const out = placeLabels(reqs, [], B);
    expect(out.length).toBeGreaterThan(1);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlap(out[i], out[j])).toBe(false);
  });

  it('öncelikli etiket tercih edilen yeri alır, düşük öncelikli kayar ya da atlanır', () => {
    // Aynı noktada iki nesne: öncelik 0 olan tercih edilen yönde (merkezden dışa = sağ) kalır.
    const hi = req('hi', 200, 150, LabelPriority.selected, { cx: 100, cy: 150 });
    const lo = req('lo', 200, 150, LabelPriority.delay, { cx: 100, cy: 150 });
    const out = placeLabels([lo, hi], [], B); // giriş sırası ters: öncelik kazanmalı
    expect(out[0].id).toBe('hi');
    expect(out[0].dirIndex).toBe(0);
    expect(out[0].distIndex).toBe(0);
    const loPlaced = out.find((o) => o.id === 'lo');
    expect(loPlaced === undefined || loPlaced.dirIndex > 0 || loPlaced.distIndex > 0).toBe(true);
  });

  it('yer yoksa zorunlu olmayan atlanır, zorunlu olan yine yerleştirilir', () => {
    const tiny: Bounds = { x0: 0, y0: 0, x1: 90, y1: 20 }; // yalnızca bir etiket sığar
    const a = req('a', 10, 10, LabelPriority.planet, { radius: 1 });
    const b = req('b', 12, 10, LabelPriority.asset, { radius: 1 });
    const c = req('c', 14, 10, LabelPriority.asset, { radius: 1, mandatory: true });
    const out = placeLabels([a, b, c], [], tiny);
    expect(out.find((o) => o.id === 'a')?.forced).toBe(false);
    expect(out.find((o) => o.id === 'b')).toBeUndefined();
    const forced = out.find((o) => o.id === 'c');
    expect(forced).toBeDefined();
    expect(forced!.forced).toBe(true);
  });

  it('tüm etiketler sınır içinde kalır (kenara yakın nesne için yön değişir)', () => {
    const reqs = [
      req('sağ', 395, 150, LabelPriority.planet),
      req('sol', 3, 150, LabelPriority.planet),
      req('üst', 200, 2, LabelPriority.planet),
      req('alt', 200, 298, LabelPriority.planet),
    ];
    const out = placeLabels(reqs, [], B);
    expect(out).toHaveLength(4);
    for (const o of out) {
      expect(o.x).toBeGreaterThanOrEqual(B.x0);
      expect(o.y).toBeGreaterThanOrEqual(B.y0);
      expect(o.x + o.w).toBeLessThanOrEqual(B.x1);
      expect(o.y + o.h).toBeLessThanOrEqual(B.y1);
    }
    expect(out.find((o) => o.id === 'sağ')!.dirIndex).toBeGreaterThan(0); // E sığmaz
  });

  it('belirleyici: aynı girdi aynı çıktıyı verir', () => {
    const reqs = Array.from({ length: 12 }, (_, i) => req(`n${i}`, 120 + (i % 4) * 7, 100 + Math.floor(i / 4) * 5, i % 6, { cx: 120, cy: 100 }));
    const a = placeLabels(reqs, [], B);
    const b = placeLabels(reqs.map((r) => ({ ...r })), [], B);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('tercih edilen yön cisim merkezinden dışa doğrudur', () => {
    const dirs = (cx: number, cy: number) => directionOrder({ ax: 200, ay: 150, cx, cy })[0];
    expect(dirs(100, 150)).toBe(0); // merkez solda → E
    expect(dirs(300, 150)).toBe(4); // merkez sağda → W
    expect(dirs(200, 250)).toBe(6); // merkez aşağıda → N
    expect(dirs(200, 50)).toBe(2); // merkez yukarıda → S
    expect(dirs(100, 50)).toBe(1); // merkez sol-yukarıda → SE
    expect(directionOrder({ ax: 1, ay: 1 })[0]).toBe(0); // merkez yoksa E
    expect(directionOrder({ ax: 1, ay: 1, cx: 1, cy: 1 })[0]).toBe(0); // merkezle aynı nokta
    const out = placeLabels([req('x', 200, 150, 1, { cx: 300, cy: 150 })], [], B);
    expect(out[0].x + out[0].w).toBeLessThan(200); // etiket nesnenin solunda
  });

  it('engelle (işaret/cisim diski) çakışmaz; kendi engeli yoksayılır', () => {
    const own = { x: 200, y: 150, r: 4, owner: 'a' };
    const blocker = { x: 230, y: 150, r: 6, owner: 'other' };
    const out = placeLabels([req('a', 200, 150, 1, { cx: 100, cy: 150 })], [own, blocker], B);
    expect(out).toHaveLength(1);
    const o = out[0];
    // sağdaki engelin dairesinin kare sınır kutusuyla çakışmamalı
    expect(overlap(o, { x: 224, y: 144, w: 12, h: 12 })).toBe(false);
  });

  it('uzağa giden etiket için çıkıntı çizgisi üretilir, yakınlar için üretilmez', () => {
    const near = placeLabels([req('a', 200, 150, 1)], [], B);
    expect(near[0].leader).toBeNull();
    // Büyük bir cisim diski: yakın adaylar engelli, etiket uzağa gitmeli ve çizgi çizilmeli
    const far = placeLabels([req('a', 200, 150, 1, { radius: 2 })], [{ x: 200, y: 150, r: 45, owner: 'a' }, { x: 200, y: 150, r: 45, owner: 'big' }], B);
    expect(far).toHaveLength(1);
    const f = far[0];
    expect(f.distIndex).toBeGreaterThanOrEqual(2);
    expect(f.leader).not.toBeNull();
    expect(f.leader!.x2).toBeGreaterThanOrEqual(f.x - 1e-9);
    expect(f.leader!.x2).toBeLessThanOrEqual(f.x + f.w + 1e-9);
    expect(f.leader!.y2).toBeGreaterThanOrEqual(f.y - 1e-9);
    expect(f.leader!.y2).toBeLessThanOrEqual(f.y + f.h + 1e-9);
  });

  it('öncelik sırası: seçili > gezegen > Ay > aktarma > araç > gecikme', () => {
    const p = LabelPriority;
    expect([p.selected, p.planet, p.moon, p.relay, p.asset, p.delay]).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('LabelCollector', () => {
  it('metni ölçüp istek ve engel toplar', () => {
    const c = new LabelCollector((t) => ({ w: t.length * 6, h: 12 }));
    c.label({ id: 'a', text: 'Ay', ax: 1, ay: 2, radius: 3, priority: 2 });
    c.obstacle(1, 2, 3, 'a');
    expect(c.requests[0].w).toBe(12);
    expect(c.obstacles).toHaveLength(1);
    c.clear();
    expect(c.requests).toHaveLength(0);
  });
});
