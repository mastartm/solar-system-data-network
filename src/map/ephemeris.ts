import type { Track, Vec3 } from '../data/types';

export const C_KM_S = 299792.458;
export const AU_KM = 149597870.7;

/** Verilen JD'de konumu (km) kübik Hermite ile hesaplar. Aralık dışıysa uca sabitler. */
export function sample(track: Track, jd: number): Vec3 {
  const last = track.count - 1;
  let f = (jd - track.startJD) / track.stepDays;
  f = Math.min(Math.max(f, 0), last);
  const i = Math.min(Math.floor(f), last - 1);
  const t = f - i;
  const h = track.stepDays;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const a = i * 3;
  const b = (i + 1) * 3;
  const out: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] =
      h00 * track.pos[a + k] + h10 * h * track.vel[a + k] +
      h01 * track.pos[b + k] + h11 * h * track.vel[b + k];
  }
  return out;
}

export function trackEndJD(track: Track): number {
  return track.startJD + (track.count - 1) * track.stepDays;
}

export const dist = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const lightMinutes = (km: number): number => km / C_KM_S / 60;

export const jdToDate = (jd: number): Date => new Date((jd - 2440587.5) * 86400000);
export const dateToJd = (d: Date): number => d.getTime() / 86400000 + 2440587.5;
