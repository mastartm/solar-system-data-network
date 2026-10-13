import type { BodyId } from '../data/types';
import { TEX_H, TEX_W } from './planetTextures';

// Dönen, ışıklandırılmış küre kartının hesabı (saf, DOM yok). Kamera, ışık ve eksen eğikliği sabit olduğundan
// piksel başına geometri bir kez hazırlanır (prepareScene); her karede yalnızca boylam kayması ve doku okuması yapılır.

export interface SphereOptions {
  /** Dönme ekseninin eğikliği (derece, 0-180; >90 ters dönme: yan yatık eksen çizimi için eşdeğer eğikliğe indirgenir). */
  tiltDeg: number;
  ring?: boolean;
  emissive?: boolean;
}

export interface SphereScene {
  size: number;
  /** 0 boş, 1 küre, 2 sabit (halka/ışıma; rgba hazır), 3 küre önünde halka (karede harmanlanır). */
  kind: Uint8Array;
  u0: Float32Array; // [0,1) boylam başlangıcı
  vrow: Uint16Array; // doku satırı
  shade: Float32Array;
  /** kind 2 ve 3 için hazır renk ve alfa. */
  rgba: Uint8ClampedArray;
  /** +1 / −1: dönme yönü (ters dönenler eksi). */
  spinSign: number;
}

const VIEW_ELEV = 0.38; // rad; kameranın kutup üstünden eğimi
const LIGHT = (() => {
  const v = [-0.65, 0.4, 0.65];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / l) as [number, number, number];
})();

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Satürn halkası: yarıçap oranına (küre yarıçapı = 1) göre [r, g, b, alfa]. */
export function ringColor(rho: number): [number, number, number, number] {
  if (rho < 1.24 || rho > 2.27) return [0, 0, 0, 0];
  const bands = 0.5 + 0.5 * Math.sin(rho * 55) * Math.cos(rho * 17);
  let a: number;
  if (rho < 1.53) a = 0.18 + 0.1 * bands; // C halkası: soluk
  else if (rho < 1.95) a = 0.85 - 0.25 * bands; // B halkası: yoğun
  else if (rho < 2.03) a = 0.06; // Cassini aralığı
  else a = 0.55 - 0.2 * bands; // A halkası
  const edge = smooth(1.24, 1.3, rho) * (1 - smooth(2.22, 2.27, rho));
  const k = 0.8 + 0.2 * bands;
  return [226 * k, 204 * k, 158 * k, a * edge];
}

export function prepareScene(size: number, o: SphereOptions): SphereScene {
  const extent = o.ring ? 2.45 : o.emissive ? 1.3 : 1.12;
  const retro = o.tiltDeg > 90;
  const roll = ((retro ? 180 - o.tiltDeg : o.tiltDeg) * Math.PI) / 180;
  const ay = Math.cos(VIEW_ELEV), az = Math.sin(VIEW_ELEV);
  const a: [number, number, number] = [ay * Math.sin(roll), ay * Math.cos(roll), az];
  // e1 = a × ẑ (normalleştirilmiş), e2 = a × e1
  let e1: [number, number, number] = [a[1], -a[0], 0];
  const l1 = Math.hypot(e1[0], e1[1]);
  e1 = [e1[0] / l1, e1[1] / l1, 0];
  const e2: [number, number, number] = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];

  const n = size * size;
  const kind = new Uint8Array(n);
  const u0 = new Float32Array(n);
  const vrow = new Uint16Array(n);
  const shade = new Float32Array(n);
  const rgba = new Uint8ClampedArray(n * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = py * size + px;
      const x = ((px + 0.5) / size * 2 - 1) * extent;
      const y = -((py + 0.5) / size * 2 - 1) * extent;
      const r2 = x * x + y * y;
      const onSphere = r2 < 1;
      const zs = onSphere ? Math.sqrt(1 - r2) : -Infinity;

      let ringHit = false, zr = 0, rc: [number, number, number, number] = [0, 0, 0, 0];
      if (o.ring && Math.abs(a[2]) > 1e-6) {
        zr = -(a[0] * x + a[1] * y) / a[2];
        rc = ringColor(Math.hypot(x, y, zr));
        ringHit = rc[3] > 0.01;
        if (ringHit) {
          // Kürenin halka üstündeki gölgesi: halka noktasından ışığa doğru ışın küreyi kesiyor mu?
          const b = x * LIGHT[0] + y * LIGHT[1] + zr * LIGHT[2];
          const c = x * x + y * y + zr * zr - 1;
          if (b < 0 && b * b - c > 0) rc = [rc[0] * 0.25, rc[1] * 0.25, rc[2] * 0.25, rc[3]];
        }
      }

      if (onSphere && !(ringHit && zr > zs)) {
        const nz = zs;
        const lat = Math.asin(Math.max(-1, Math.min(1, x * a[0] + y * a[1] + nz * a[2])));
        let lon = Math.atan2(x * e2[0] + y * e2[1] + nz * e2[2], x * e1[0] + y * e1[1] + nz * e1[2]) / (Math.PI * 2);
        lon -= Math.floor(lon);
        u0[idx] = lon;
        vrow[idx] = Math.min(TEX_H - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * TEX_H)));
        if (o.emissive) shade[idx] = 0.6 + 0.4 * Math.pow(nz, 0.6);
        else {
          const d = x * LIGHT[0] + y * LIGHT[1] + nz * LIGHT[2];
          shade[idx] = 0.06 + 0.94 * Math.pow(Math.max(0, d), 0.85);
        }
        kind[idx] = 1;
      } else if (onSphere && ringHit) {
        // Halka küreyi örter (önünde): küre rengi karede belirlenir, halka sabit harmanlanır.
        const nz = zs;
        const lat = Math.asin(Math.max(-1, Math.min(1, x * a[0] + y * a[1] + nz * a[2])));
        let lon = Math.atan2(x * e2[0] + y * e2[1] + nz * e2[2], x * e1[0] + y * e1[1] + nz * e1[2]) / (Math.PI * 2);
        lon -= Math.floor(lon);
        u0[idx] = lon;
        vrow[idx] = Math.min(TEX_H - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * TEX_H)));
        const d = x * LIGHT[0] + y * LIGHT[1] + nz * LIGHT[2];
        shade[idx] = 0.06 + 0.94 * Math.pow(Math.max(0, d), 0.85);
        kind[idx] = 3;
      }
      if (kind[idx] === 3 || (kind[idx] === 0 && ringHit)) {
        if (kind[idx] === 0) kind[idx] = 2;
        rgba[idx * 4] = rc[0]; rgba[idx * 4 + 1] = rc[1]; rgba[idx * 4 + 2] = rc[2]; rgba[idx * 4 + 3] = rc[3] * 255;
      } else if (kind[idx] === 0 && o.emissive) {
        const rr = Math.sqrt(r2);
        const glow = Math.pow(1 - smooth(1, extent, rr), 2) * 0.7;
        if (glow > 0.01) {
          kind[idx] = 2;
          rgba[idx * 4] = 255; rgba[idx * 4 + 1] = 190; rgba[idx * 4 + 2] = 70; rgba[idx * 4 + 3] = glow * 255;
        }
      }
    }
  }
  return { size, kind, u0, vrow, shade, rgba, spinSign: retro ? -1 : 1 };
}

/** Bir kareyi `out` (RGBA, size×size) içine yazar. spin: tur cinsinden dönme (1 = tam tur). */
export function renderFrame(scene: SphereScene, tex: Uint8ClampedArray, spin: number, out: Uint8ClampedArray): void {
  const { size, kind, u0, vrow, shade, rgba } = scene;
  const s = spin * scene.spinSign;
  const n = size * size;
  for (let i = 0; i < n; i++) {
    const k = kind[i];
    const o = i * 4;
    if (k === 0) { out[o + 3] = 0; continue; }
    if (k === 2) { out[o] = rgba[o]; out[o + 1] = rgba[o + 1]; out[o + 2] = rgba[o + 2]; out[o + 3] = rgba[o + 3]; continue; }
    let u = u0[i] + s;
    u -= Math.floor(u);
    const fu = u * TEX_W - 0.5;
    const i0 = Math.floor(fu), t = fu - i0;
    const row = vrow[i] * TEX_W;
    const a = ((i0 + TEX_W) % TEX_W + row) * 3;
    const b = (((i0 + 1) % TEX_W + TEX_W) % TEX_W + row) * 3;
    const sh = shade[i];
    let r = (tex[a] * (1 - t) + tex[b] * t) * sh;
    let g = (tex[a + 1] * (1 - t) + tex[b + 1] * t) * sh;
    let bl = (tex[a + 2] * (1 - t) + tex[b + 2] * t) * sh;
    if (k === 3) {
      const al = rgba[o + 3] / 255;
      r = r * (1 - al) + rgba[o] * al;
      g = g * (1 - al) + rgba[o + 1] * al;
      bl = bl * (1 - al) + rgba[o + 2] * al;
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = 255;
  }
}

/** Kart ayarları (şematik; gerçek eksen yönü ve dönme hızı değildir). */
export function sphereOptionsFor(id: BodyId, axialTiltDeg: number): SphereOptions {
  return { tiltDeg: axialTiltDeg, ring: id === 'saturn', emissive: id === 'sun' };
}
