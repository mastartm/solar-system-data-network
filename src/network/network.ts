import { HYPOTHETICAL, type AssetConfig, type RelayConfig } from '../config/hypothetical';
import type { Track, Vec3 } from '../data/types';
import { C_KM_S, sample, trackEndJD } from '../map/ephemeris';

// Fiziksel sabitler (gerçek değerler). Varsayımsal sayılar config/hypothetical.ts içindedir.
const BODY = {
  moon: { radiusKm: 1737.4, mu: 4902.8, rotDays: 27.321661 },
  mars: { radiusKm: 3389.5, mu: 42828.37, rotDays: 1.02595675 },
} as const;
type BodyKey = keyof typeof BODY;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export type LinkState = 'up' | 'horizon' | 'occulted' | 'blackout';

export interface AssetStatus {
  asset: AssetConfig;
  relay: RelayConfig;
  /** araç → uydu bağlantısı: 'up' veya 'horizon' (uydu ufkun altında). */
  surfaceLink: LinkState;
  /** uydu → Dünya bağlantısı: 'up', 'occulted' (cisim arkasında) veya 'blackout' (Mars kavuşumu). */
  earthLink: LinkState;
  surfaceKm: number;
  earthKm: number;
  /** Tek yönlü gecikme (sn) = (araç→uydu + uydu→Dünya) / c. Bağlantı kopuk olsa da geometrik değerdir. */
  delaySec: number;
  /** Uçtan uca yol açık mı? */
  connected: boolean;
}

export interface NetworkState {
  statuses: AssetStatus[];
  /** Dünya'dan bakınca Güneş–Mars açısı (derece). */
  marsSepDeg: number;
  marsBlackout: boolean;
  /** Ekliptik çerçevede cisim merkezli aktarma uydusu konumları (km) ve faz açıları (rad). */
  relayPhase: Record<string, number>;
}

/** Cisim merkezli, ekliptiğe paralel çerçevede Dünya yönü (km). */
function earthRelative(tracks: Record<string, Track>, body: BodyKey, jd: number): Vec3 {
  if (body === 'moon') {
    const m = sample(tracks.moon, jd); // Dünya merkezli
    return [-m[0], -m[1], -m[2]];
  }
  return sub(sample(tracks.earth, jd), sample(tracks.mars, jd));
}

export function marsSunSeparationDeg(tracks: Record<string, Track>, jd: number): number {
  const earth = sample(tracks.earth, jd);
  const toSun: Vec3 = [-earth[0], -earth[1], -earth[2]];
  const toMars = sub(sample(tracks.mars, jd), earth);
  const c = dot(toSun, toMars) / (norm(toSun) * norm(toMars));
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

function relayPosition(r: RelayConfig, jd: number): { pos: Vec3; phase: number } {
  const b = BODY[r.body];
  const a = b.radiusKm + r.altitudeKm;
  const periodDays = (2 * Math.PI * Math.sqrt((a * a * a) / b.mu)) / 86400;
  const phase = ((jd - 2451545) / periodDays) * 2 * Math.PI;
  return { pos: [a * Math.cos(phase), a * Math.sin(phase), 0], phase };
}

function surfacePosition(a: AssetConfig, jd: number): { pos: Vec3; normal: Vec3 } {
  const b = BODY[a.body];
  const lon = (a.lonDeg * Math.PI) / 180 + ((jd - 2451545) / b.rotDays) * 2 * Math.PI;
  const lat = (a.latDeg * Math.PI) / 180;
  const n: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  return { pos: [n[0] * b.radiusKm, n[1] * b.radiusKm, n[2] * b.radiusKm], normal: n };
}

/** Doğru parçası (p→q), merkezi orijinde R yarıçaplı küreyi kesiyor mu? */
export function segmentHitsSphere(p: Vec3, q: Vec3, R: number): boolean {
  const d = sub(q, p);
  const dd = dot(d, d);
  const t = Math.min(1, Math.max(0, -dot(p, d) / dd));
  const c: Vec3 = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
  return norm(c) < R;
}

export function computeNetwork(tracks: Record<string, Track>, jd: number): NetworkState {
  const marsSepDeg = marsSunSeparationDeg(tracks, jd);
  const marsBlackout = marsSepDeg < HYPOTHETICAL.conjunctionBlackoutAngleDeg;
  const statuses: AssetStatus[] = [];
  const relayPhase: Record<string, number> = {};

  for (const relay of HYPOTHETICAL.relays) {
    const rp = relayPosition(relay, jd);
    relayPhase[relay.id] = rp.phase;
    const R = BODY[relay.body].radiusKm;
    const earthVec = earthRelative(tracks, relay.body, jd); // cisim merkezli Dünya konumu
    const toEarthFromRelay = sub(earthVec, rp.pos);
    const earthKm = norm(toEarthFromRelay);
    const occulted = segmentHitsSphere(rp.pos, earthVec, R);

    for (const asset of HYPOTHETICAL.assets.filter((a) => a.relay === relay.id)) {
      const s = surfacePosition(asset, jd);
      const toRelay = sub(rp.pos, s.pos);
      const surfaceKm = norm(toRelay);
      const visible = dot(s.normal, toRelay) > 0;
      const surfaceLink: LinkState = visible ? 'up' : 'horizon';
      const earthLink: LinkState = relay.body === 'mars' && marsBlackout ? 'blackout' : occulted ? 'occulted' : 'up';
      statuses.push({
        asset, relay, surfaceLink, earthLink, surfaceKm, earthKm,
        delaySec: (surfaceKm + earthKm) / C_KM_S,
        connected: surfaceLink === 'up' && earthLink === 'up',
      });
    }
  }
  return { statuses, marsSepDeg, marsBlackout, relayPhase };
}

export interface BlackoutWindow { startJD: number; endJD: number; peakJD: number; minSepDeg: number }

/** Veri aralığında Mars kavuşumu kesinti pencereleri (0,25 gün adımla taranır). */
export function findBlackoutWindows(tracks: Record<string, Track>, thresholdDeg = HYPOTHETICAL.conjunctionBlackoutAngleDeg): BlackoutWindow[] {
  const end = Math.min(trackEndJD(tracks.earth), trackEndJD(tracks.mars));
  const out: BlackoutWindow[] = [];
  let cur: BlackoutWindow | null = null;
  for (let jd = tracks.earth.startJD; jd <= end; jd += 0.25) {
    const sep = marsSunSeparationDeg(tracks, jd);
    if (sep < thresholdDeg) {
      if (!cur) cur = { startJD: jd, endJD: jd, peakJD: jd, minSepDeg: sep };
      cur.endJD = jd;
      if (sep < cur.minSepDeg) { cur.minSepDeg = sep; cur.peakJD = jd; }
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

