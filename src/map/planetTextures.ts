import type { BodyId } from '../data/types';

// Prosedürel, BELİRLEYİCİ dokular (rastgelelik yok: sabit karma işlevi + sabit tohum). Şematiktir; gerçek yüzey dokusu değildir.

export const TEX_W = 256;
export const TEX_H = 128;

type RGB = [number, number, number];

// ---- belirleyici gürültü ----
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2147483647) ^ Math.imul(seed + 1, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => fade(clamp01((v - a) / (b - a)));

/** 3B değer gürültüsü, [0,1]. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = fade(x - xi), fy = fade(y - yi), fz = fade(z - zi);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

/** Fraktal gürültü, [0,1]. */
export function fbm3(x: number, y: number, z: number, oct = 4, seed = 0): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f, seed + i * 17);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

/** En yakın özellik noktasına uzaklık (Worley), yaklaşık [0,1]; krater benzeri yuvarlak desenler için. */
export function worley3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz;
    const px = cx + hash3(cx, cy, cz, seed), py = cy + hash3(cx, cy, cz, seed + 31), pz = cz + hash3(cx, cy, cz, seed + 67);
    const d = Math.hypot(px - x, py - y, pz - z);
    if (d < best) best = d;
  }
  return Math.min(best, 1);
}

const mixc = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Krater benzeri koyu/açık halka alanı: [-1,1] (negatif = çukur gölgesi, pozitif = kenar). */
function craters(x: number, y: number, z: number, seed: number, freq: number): number {
  const d = worley3(x * freq, y * freq, z * freq, seed);
  const bowl = smooth(0.32, 0.12, d); // merkezde çukur
  const rim = smooth(0.32, 0.38, d) * smooth(0.5, 0.38, d); // kenar
  return rim * 0.7 - bowl * 0.5;
}

// ---- cisim başına renk işlevleri: (birim yön vektörü, enlem rad) → RGB (0-255) ----
type Painter = (x: number, y: number, z: number, lat: number) => RGB;

const earth: Painter = (x, y, z, lat) => {
  const alat = Math.abs(lat);
  const land = fbm3(x * 2.2 + 3, y * 2.2, z * 2.2, 5, 1) + (fbm3(x * 6, y * 6, z * 6, 3, 2) - 0.5) * 0.12;
  let col: RGB;
  if (land < 0.5) {
    const depth = clamp01((0.5 - land) / 0.2);
    col = mixc([40, 120, 190], [8, 40, 110], depth); // sığ → derin okyanus
  } else {
    const dry = clamp01(1 - Math.abs(alat - 0.45) * 3.2 + (fbm3(x * 4, y * 4, z * 4, 3, 5) - 0.5) * 0.8);
    const base = mixc([46, 120, 50], [176, 150, 96], dry); // yeşil ↔ çöl
    col = mixc(base, [225, 225, 230], smooth(0.6, 0.75, land) * 0.35 * smooth(0.5, 1.1, alat)); // yüksek yer
  }
  const ice = smooth(1.12, 1.28, alat + (fbm3(x * 5, y * 5, z * 5, 3, 9) - 0.5) * 0.18); // kutup buzu (~65°+)
  col = mixc(col, [238, 244, 250], ice);
  const cloud = smooth(0.52, 0.72, fbm3(x * 3 + 7, y * 3, z * 3, 5, 21));
  return mixc(col, [250, 250, 252], cloud * 0.85);
};

const mars: Painter = (x, y, z, lat) => {
  const n = fbm3(x * 3, y * 3, z * 3, 5, 31);
  const dark = smooth(0.5, 0.7, fbm3(x * 2 + 5, y * 2, z * 2, 4, 33));
  let col = mixc([196, 108, 64], [150, 78, 48], n);
  col = mixc(col, [88, 56, 46], dark * 0.55);
  col = mixc(col, [214, 150, 100], smooth(0.62, 0.8, fbm3(x * 6, y * 6, z * 6, 3, 35)) * 0.4);
  const cap = smooth(1.3, 1.42, Math.abs(lat) + (fbm3(x * 6, y * 6, z * 6, 2, 37) - 0.5) * 0.1);
  return mixc(col, [240, 240, 244], cap);
};

const moon: Painter = (x, y, z) => {
  const maria = smooth(0.5, 0.62, fbm3(x * 1.6 + 2, y * 1.6, z * 1.6, 4, 41));
  let v = lerp(168, 104, maria * 0.8) + (fbm3(x * 8, y * 8, z * 8, 4, 43) - 0.5) * 36;
  v += craters(x, y, z, 45, 5) * 40 + craters(x, y, z, 47, 11) * 30;
  v = Math.max(40, Math.min(235, v));
  return [v, v * 0.985, v * 0.96];
};

const mercury: Painter = (x, y, z) => {
  let v = 128 + (fbm3(x * 6, y * 6, z * 6, 5, 51) - 0.5) * 60;
  v += craters(x, y, z, 53, 4.5) * 46 + craters(x, y, z, 55, 10) * 36 + craters(x, y, z, 57, 20) * 22;
  v = Math.max(36, Math.min(220, v));
  return [v * 1.02, v * 0.97, v * 0.92];
};

const venus: Painter = (x, y, z, lat) => {
  // enlem boyunca uzanan, çalkantılı bulut şeritleri
  const w = fbm3(x * 2.5, y * 2.5, z * 2.5, 4, 61) * 2.4;
  const stripes = 0.5 + 0.5 * Math.sin(lat * 14 + w * 3.2);
  const fine = fbm3(x * 9, y * 9 + w, z * 9, 3, 63);
  const t = clamp01(stripes * 0.55 + fine * 0.45);
  return mixc([214, 170, 96], [244, 224, 170], t);
};

const jupiter: Painter = (x, y, z, lat) => {
  const lon = Math.atan2(y, x);
  const warp = (fbm3(x * 4, y * 4, z * 4, 4, 71) - 0.5) * 0.35;
  const band = 0.5 + 0.5 * Math.sin((lat + warp) * 17);
  const fine = fbm3(x * 14, y * 3 + 40, z * 14, 3, 73);
  let col = mixc([182, 124, 84], [240, 222, 190], clamp01(band * 0.75 + fine * 0.3 - 0.05));
  col = mixc(col, [150, 96, 66], smooth(0.62, 0.8, Math.sin((lat + warp) * 8.5 + 1) * 0.5 + 0.5) * 0.35);
  // Büyük Kırmızı Leke: sabit enlem/boylamda eliptik leke
  const dl = Math.atan2(Math.sin(lon - 0.9), Math.cos(lon - 0.9));
  const la = (lat - -0.39) / 0.12, lo = dl / 0.26;
  const r = Math.hypot(la, lo + (fbm3(x * 20, y * 20, z * 20, 2, 75) - 0.5) * 0.25);
  const spot = 1 - smooth(0.7, 1.0, r);
  const ring = smooth(0.95, 1.2, r) * (1 - smooth(1.2, 1.5, r));
  col = mixc(col, [236, 220, 200], ring * 0.35);
  return mixc(col, [176, 64, 44], spot * 0.92);
};

const saturn: Painter = (x, y, z, lat) => {
  const warp = (fbm3(x * 3, y * 3, z * 3, 3, 81) - 0.5) * 0.18;
  const band = 0.5 + 0.5 * Math.sin((lat + warp) * 22);
  const fine = fbm3(x * 6, y * 6 + 20, z * 6, 3, 83);
  let col = mixc([200, 170, 112], [242, 222, 170], clamp01(band * 0.6 + fine * 0.35));
  col = mixc(col, [176, 150, 104], smooth(0.7, 0.9, Math.abs(lat) / 1.5) * 0.4); // kutuplara doğru koyulaşır
  return col;
};

const uranus: Painter = (x, y, z, lat) => {
  const band = 0.5 + 0.5 * Math.sin(lat * 13 + (fbm3(x * 2, y * 2, z * 2, 3, 91) - 0.5) * 0.8);
  const t = clamp01(band * 0.75 + fbm3(x * 3, y * 3, z * 3, 3, 93) * 0.2);
  return mixc([96, 176, 190], [184, 236, 238], t);
};

const neptune: Painter = (x, y, z, lat) => {
  const lon = Math.atan2(y, x);
  const band = 0.5 + 0.5 * Math.sin(lat * 11 + (fbm3(x * 3, y * 3, z * 3, 4, 101) - 0.5) * 1.2);
  let col = mixc([48, 82, 196], [76, 120, 230], clamp01(band * 0.7 + fbm3(x * 5, y * 5, z * 5, 3, 103) * 0.25));
  const dl = Math.atan2(Math.sin(lon - 2.2), Math.cos(lon - 2.2));
  const dark = 1 - smooth(0.6, 1.0, Math.hypot((lat + 0.35) / 0.12, dl / 0.3)); // Büyük Karanlık Leke benzeri
  col = mixc(col, [24, 40, 120], dark * 0.7);
  const streak = smooth(0.7, 0.85, fbm3(x * 5 + 3, y * 12, z * 5, 3, 105)) * smooth(0.1, 0.5, Math.abs(Math.sin(lat * 3)));
  return mixc(col, [214, 228, 255], streak * 0.55);
};

const sun: Painter = (x, y, z) => {
  const g = fbm3(x * 9, y * 9, z * 9, 4, 111);
  let col = mixc([255, 150, 30], [255, 232, 120], g);
  const spots = smooth(0.72, 0.8, fbm3(x * 3 + 9, y * 3, z * 3, 3, 113)) * smooth(0.0, 0.2, 0.35 - Math.abs(y));
  col = mixc(col, [150, 60, 10], spots * 0.8);
  return col;
};

const PAINTERS: Record<BodyId, Painter> = { earth, mars, moon, mercury, venus, jupiter, saturn, uranus, neptune, sun };

/**
 * Dokunun [j0, j1) satırlarını `out`a yazar (her piksel yalnızca kendi konumundan hesaplanır, satırlar bağımsızdır). Sayfa başlatırken dokuyu parçalara bölüp ana iş parçacığını
 * 50 ms'den uzun tutmamak için kullanılır; tüm satırlar birlikte generateTexture ile bayt bayt aynı sonucu verir.
 */
export function generateTextureRows(id: BodyId, w: number, h: number, j0: number, j1: number, out: Uint8ClampedArray): void {
  const paint = PAINTERS[id];
  for (let j = j0; j < j1; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * Math.PI * 2;
      const c = paint(cl * Math.cos(lon), cl * Math.sin(lon), sl, lat);
      const o = (j * w + i) * 3;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    }
  }
}

/** Cisim dokusu: TEX_W×TEX_H, RGB (3 bayt/piksel), eşdikdörtgen (boylam soldan sağa, enlem yukarıdan aşağıya). Belirleyici. */
export function generateTexture(id: BodyId, w = TEX_W, h = TEX_H): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 3);
  generateTextureRows(id, w, h, 0, h, out);
  return out;
}
