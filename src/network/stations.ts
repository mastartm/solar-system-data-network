// Yer istasyonu geometrisi: saf fonksiyonlar. Dünya küresel (yarıçap 6378,137 km), dönüş GMST ile.
// Çerçeve: Horizons verisiyle aynı (ICRF, ekliptik düzlem). Konumlar varsayımsaldır (config/hypothetical.ts).
import type { GroundStationConfig } from '../config/hypothetical';
import type { Vec3 } from '../data/types';

export const EARTH_RADIUS_KM = 6378.137;
const OBLIQUITY = (23.4392911 * Math.PI) / 180; // J2000 ekliptik eğikliği
const D2R = Math.PI / 180;

/** Greenwich ortalama yıldız zamanı (derece), JD (UT1 ≈ TDB; ~1 dk fark, 0,3° — bu model için önemsiz). */
export const gmstDeg = (jd: number) => (((280.46061837 + 360.98564736629 * (jd - 2451545)) % 360) + 360) % 360;

/** İstasyonun Dünya merkezli ekliptik çerçevedeki konumu (km). */
export function stationPosition(st: Pick<GroundStationConfig, 'latDeg' | 'lonDeg'>, jd: number): Vec3 {
  const lat = st.latDeg * D2R, ra = (st.lonDeg + gmstDeg(jd)) * D2R;
  const x = EARTH_RADIUS_KM * Math.cos(lat) * Math.cos(ra);
  const y = EARTH_RADIUS_KM * Math.cos(lat) * Math.sin(ra);
  const z = EARTH_RADIUS_KM * Math.sin(lat);
  // ekvatoral → ekliptik: x ekseni etrafında −ε
  return [x, y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY), -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)];
}

/** Hedefin (Dünya merkezli ekliptik konum, km) istasyondan görülen yüksekliği (derece). Ufkun altında negatif. */
export function elevationDeg(st: Pick<GroundStationConfig, 'latDeg' | 'lonDeg'>, jd: number, target: Vec3): number {
  const p = stationPosition(st, jd);
  const d: Vec3 = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
  const dn = Math.hypot(d[0], d[1], d[2]), pn = Math.hypot(p[0], p[1], p[2]);
  const s = (d[0] * p[0] + d[1] * p[1] + d[2] * p[2]) / (dn * pn);
  return Math.asin(Math.min(1, Math.max(-1, s))) / D2R;
}

/** Hedefi minElevationDeg üstünde gören en yüksek istasyon (yoksa null). */
export function bestStation(stations: GroundStationConfig[], jd: number, target: Vec3, minElevationDeg: number): { station: GroundStationConfig; elevDeg: number } | null {
  let best: { station: GroundStationConfig; elevDeg: number } | null = null;
  for (const st of stations) {
    const e = elevationDeg(st, jd, target);
    if (e >= minElevationDeg && (!best || e > best.elevDeg)) best = { station: st, elevDeg: e };
  }
  return best;
}
