import type { BodyId } from './types';

/**
 * Cisimlerin genel fiziksel bilgileri (bilgi panelinde gösterilir).
 * GERÇEK değerlere yakın GENEL BİLGİDİR; NASA/JPL Horizons verisi DEĞİLDİR ve kaynağı bu projede DOĞRULANMAMIŞTIR
 * (hafızadan yazıldı). Varsayımsal ağ değerleri değildir; onlar src/config/hypothetical.ts içindedir.
 */
export const FACTS_DISCLAIMER = 'Genel bilgidir; Horizons verisi değildir, kaynağı doğrulanmamıştır.';

export interface BodyFacts {
  /** Ortalama yarıçap (km). */
  radiusKm: number;
  /** Yörünge dönemi (gün); Ay için Dünya çevresindeki dönem. Güneş için yok. */
  orbitalPeriodDays?: number;
  /** Güneş'e ortalama uzaklık (milyon km); Ay için Dünya'nınki. Güneş için yok. */
  sunDistanceMKm?: number;
  /** Dönme periyodu (gün; eksi = ters yönde). */
  rotationDays: number;
  /** Bilinen doğal uydu sayısı; lowerBound true ise "≥" (dev gezegenlerde sayı hâlâ artıyor, tarihe bağlıdır). */
  moons: number;
  moonsLowerBound?: boolean;
  /** Dönme ekseninin yörünge düzlemine eğikliği (derece); kart çiziminde kullanılır. */
  axialTiltDeg: number;
}

export const FACTS: Record<BodyId, BodyFacts> = {
  sun: { radiusKm: 695700, rotationDays: 25.4, moons: 0, axialTiltDeg: 7.25 },
  mercury: { radiusKm: 2439.7, orbitalPeriodDays: 87.97, sunDistanceMKm: 57.9, rotationDays: 58.65, moons: 0, axialTiltDeg: 0.03 },
  venus: { radiusKm: 6051.8, orbitalPeriodDays: 224.7, sunDistanceMKm: 108.2, rotationDays: -243.02, moons: 0, axialTiltDeg: 177.4 },
  earth: { radiusKm: 6371.0, orbitalPeriodDays: 365.256, sunDistanceMKm: 149.6, rotationDays: 0.99727, moons: 1, axialTiltDeg: 23.44 },
  moon: { radiusKm: 1737.4, orbitalPeriodDays: 27.32, sunDistanceMKm: 149.6, rotationDays: 27.32, moons: 0, axialTiltDeg: 6.68 },
  mars: { radiusKm: 3389.5, orbitalPeriodDays: 686.98, sunDistanceMKm: 227.9, rotationDays: 1.026, moons: 2, axialTiltDeg: 25.19 },
  jupiter: { radiusKm: 69911, orbitalPeriodDays: 4332.59, sunDistanceMKm: 778.5, rotationDays: 0.4135, moons: 95, moonsLowerBound: true, axialTiltDeg: 3.13 },
  saturn: { radiusKm: 58232, orbitalPeriodDays: 10759.2, sunDistanceMKm: 1434, rotationDays: 0.444, moons: 274, moonsLowerBound: true, axialTiltDeg: 26.73 },
  uranus: { radiusKm: 25362, orbitalPeriodDays: 30688.5, sunDistanceMKm: 2871, rotationDays: -0.718, moons: 28, moonsLowerBound: true, axialTiltDeg: 97.77 },
  neptune: { radiusKm: 24622, orbitalPeriodDays: 60182, sunDistanceMKm: 4495, rotationDays: 0.671, moons: 16, moonsLowerBound: true, axialTiltDeg: 28.32 },
};

const nf = (n: number, d = 0) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Gün sayısını okunur metne çevirir (gün / yıl; saat dönme periyodunda 1 günden kısaysa). */
export function formatDays(days: number): string {
  const a = Math.abs(days);
  if (a >= 700) return `${nf(a / 365.256, 1)} yıl`;
  if (a < 2) return `${nf(a * 24, 1)} saat`;
  return `${nf(a, a < 100 ? 1 : 0)} gün`;
}

/** Kartın yanında gösterilen satırlar: [etiket, değer]. */
export function factRows(id: BodyId): [string, string][] {
  const f = FACTS[id];
  const rows: [string, string][] = [['Yarıçap', `${nf(f.radiusKm, f.radiusKm < 10000 ? 1 : 0)} km`]];
  rows.push([id === 'moon' ? 'Yörünge dönemi (Dünya çevresi)' : 'Yörünge dönemi', f.orbitalPeriodDays ? formatDays(f.orbitalPeriodDays) : '—']);
  rows.push([id === 'moon' ? 'Güneş\'e ort. uzaklık (Dünya ile aynı)' : 'Güneş\'e ort. uzaklık', f.sunDistanceMKm ? `${nf(f.sunDistanceMKm, f.sunDistanceMKm < 1000 ? 1 : 0)} milyon km` : '—']);
  rows.push(['Dönme periyodu', `${formatDays(f.rotationDays)}${f.rotationDays < 0 ? ' (ters yön)' : ''}`]);
  rows.push(['Bilinen uydu', id === 'sun' ? '—' : `${f.moonsLowerBound ? '≥ ' : ''}${nf(f.moons)}`]);
  return rows;
}
