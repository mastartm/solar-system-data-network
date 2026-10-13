export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'moon';

export interface BodyInfo {
  id: BodyId;
  name: string;
  color: string;
  radiusPx: number;
  /** Yaklaşık yörünge dönemi (gün). Sadece yörünge çizgisi için. */
  periodDays?: number;
}

export const BODIES: BodyInfo[] = [
  { id: 'sun', name: 'Güneş', color: '#ffd24a', radiusPx: 9 },
  { id: 'mercury', name: 'Merkür', color: '#b5b0a8', radiusPx: 3, periodDays: 88 },
  { id: 'venus', name: 'Venüs', color: '#e8c98a', radiusPx: 4.5, periodDays: 225 },
  { id: 'earth', name: 'Dünya', color: '#4a90e2', radiusPx: 5, periodDays: 365.25 },
  { id: 'mars', name: 'Mars', color: '#d9593a', radiusPx: 4, periodDays: 687 },
  { id: 'jupiter', name: 'Jüpiter', color: '#d8a878', radiusPx: 8, periodDays: 4333 },
  { id: 'saturn', name: 'Satürn', color: '#e3cf9a', radiusPx: 7, periodDays: 10759 },
  { id: 'uranus', name: 'Uranüs', color: '#8fd6dd', radiusPx: 5.5, periodDays: 30687 },
  { id: 'neptune', name: 'Neptün', color: '#4f6fe0', radiusPx: 5.5, periodDays: 60190 },
  { id: 'moon', name: 'Ay', color: '#cfcfcf', radiusPx: 2.5 },
];

/** Düzenli aralıklı örneklenmiş konum/hız tablosu. Birimler: km ve km/gün. */
export interface Track {
  startJD: number;
  stepDays: number;
  count: number;
  pos: Float64Array; // x,y,z (km)
  vel: Float64Array; // vx,vy,vz (km/gün)
}

export type Vec3 = [number, number, number];
