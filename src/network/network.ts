import { HYPOTHETICAL, type AssetConfig, type GroundStationConfig, type OrbitElements, type RelayConfig } from '../config/hypothetical';
import type { Track, Vec3 } from '../data/types';
import { C_KM_S, sample, trackEndJD } from '../map/ephemeris';
import { bestStation } from './stations';

// Fiziksel sabitler (gerçek değerler). Varsayımsal sayılar config/hypothetical.ts içindedir.
const BODY = {
  moon: { radiusKm: 1737.4, mu: 4902.8, rotDays: 27.321661 },
  mars: { radiusKm: 3389.5, mu: 42828.37, rotDays: 1.02595675 },
} as const;
type BodyKey = keyof typeof BODY;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export type LinkState = 'up' | 'horizon' | 'occulted' | 'blackout' | 'nostation' | 'eclipse';

/**
 * Aşama 9: ağ seçenekleri (hepsi VARSAYIMSAL; varsayılan = Aşama 2-8 ağı, sonuçlar birebir aynı).
 * moonOrbit: Ay aktarma uydusu yörüngesi ('equatorial' = 3000 km dairesel ekvatoral; 'elliptical' = HYPOTHETICAL.moonOrbits.elliptical).
 * moonSecond: ikinci Ay aktarma uydusu ('none'; 'best' = araç uyduyu gören(ler) arasında önce Dünya hattı açık olanı, sonra en yüksek yükseklikte olanı kullanır; 'order' = hat sırası).
 * marsEclipse: Mars aktarma uydusu gölgesi ('none'; 'earth' = gölgede yalnız uydu → Dünya hattı kapalı; 'both' = yüzey hattı da kapalı). Güç modeli yok.
 * moonPolarAsset: HYPOTHETICAL.moonPolarAsset araç olarak eklenir.
 * Aşama 10 (hepsi seçenek, varsayılan kapalı): moonPrecession = eliptik Ay yörüngesinde düğüm/periapsis kayması (HYPOTHETICAL.moonPrecession); marsAxis = 'tilted': Mars ekseni eğik
 * (HYPOTHETICAL.marsAxis; yörünge düzlemi ve yüzey araçları bu eksene göre döner); marsEclipse = 'power': gölgede hemen kapanma yerine basit batarya modeli (MarsPower; zaman çizelgesinde uygulanır);
 * moonIsl = ikinci Ay uydusu varken uydular arası bağlantı durumu hesaplanır (NetworkState.isl).
 */
export interface NetOptions {
  moonOrbit?: 'equatorial' | 'elliptical';
  moonSecond?: 'none' | 'best' | 'order';
  marsEclipse?: 'none' | 'earth' | 'both' | 'power';
  moonPolarAsset?: boolean;
  /** true: HYPOTHETICAL.moonPrecession hızları; nesne: hızları geçersiz kılar (derece/gün; tarama için). */
  moonPrecession?: boolean | { raanRateDegPerDay?: number; argPeriRateDegPerDay?: number };
  marsAxis?: 'parallel' | 'tilted';
  moonIsl?: boolean;
  /** Aşama 10: güç modelinde batarya kapasitesi (Wh) geçersiz kılma (tarama için); yoksa HYPOTHETICAL.marsPower.batteryWh. */
  marsPowerBatteryWh?: number;
}

/** Seçeneklere göre aktarma uyduları: varsayılan HYPOTHETICAL.relays; eliptik seçilirse Ay uydusunun yörüngesi değişir; ikinci uydu sona eklenir. */
export function effectiveRelays(o: NetOptions = {}): RelayConfig[] {
  const base = HYPOTHETICAL.relays.map((r) => (r.body === 'moon' && o.moonOrbit === 'elliptical' ? { ...r, orbit: HYPOTHETICAL.moonOrbits.elliptical } : r));
  if (o.moonSecond && o.moonSecond !== 'none') {
    const r2 = HYPOTHETICAL.moonRelay2;
    base.push({ id: r2.id, name: r2.name, body: 'moon', altitudeKm: 0, orbit: r2.orbit });
  }
  return base;
}

export function effectiveAssets(o: NetOptions = {}): AssetConfig[] {
  return o.moonPolarAsset ? [...HYPOTHETICAL.assets, HYPOTHETICAL.moonPolarAsset] : HYPOTHETICAL.assets;
}

/** Ay araçlarının ikinci uyduyu kullanabildiği durumlarda aday uydular (ana uydu önce). */
export function relayCandidates(a: AssetConfig, o: NetOptions = {}): string[] {
  return a.body === 'moon' && o.moonSecond && o.moonSecond !== 'none' ? [a.relay, HYPOTHETICAL.moonRelay2.id] : [a.relay];
}

export interface AssetStatus {
  asset: AssetConfig;
  relay: RelayConfig;
  /** araç → uydu bağlantısı: 'up' veya 'horizon' (uydu ufkun altında). */
  surfaceLink: LinkState;
  /** uydu → Dünya bağlantısı: 'up', 'occulted' (cisim arkasında) veya 'blackout' (Mars kavuşumu) veya 'nostation' (hiçbir yer istasyonu uyduyu göremiyor). */
  earthLink: LinkState;
  surfaceKm: number;
  earthKm: number;
  /** Tek yönlü gecikme (sn) = (araç→uydu + uydu→Dünya) / c. Bağlantı kopuk olsa da geometrik değerdir. */
  delaySec: number;
  /** Uçtan uca yol açık mı? */
  connected: boolean;
  /** Aşama 9: araç için aday uydular (ana uydu önce) ve her birinin görünürlüğü/yüksekliği; `relay` bunlardan seçilen uydudur. */
  candidates: { relayId: string; visible: boolean; elevDeg: number; surfaceKm: number }[];
  /** Uyduyu gören en yüksek yer istasyonu (yoksa null; istasyon modeli kapalıysa da null). */
  station: { name: string; elevDeg: number } | null;
}

/** Bir aktarma uydusunun Dünya hattı durumu (araç sayısından bağımsız; ikinci uydunun hiç aracı olmayabilir). */
export interface RelayState {
  relay: RelayConfig;
  earthLink: LinkState;
  earthKm: number;
  station: { name: string; elevDeg: number } | null;
  /** Aşama 9: uydu Mars gölgesinde mi (marsEclipse seçeneği açıkken; Dünya hattının başka nedenle kapalı olması bunu değiştirmez). */
  eclipsed: boolean;
}

const NO_ISL: IslState[] = [];
/** Aşama 10: iki aktarma uydusu arasındaki bağlantı (Ay'ın engellemediği görüş hattı ve en çok islMaxKm mesafe). */
export interface IslState { a: string; b: string; up: boolean; km: number }

export interface NetworkState {
  /** Aşama 10: uydular arası bağlantılar (yalnızca moonIsl seçiliyken). */
  isl: IslState[];
  statuses: AssetStatus[];
  /** Aşama 9: her aktarma uydusu için Dünya hattı durumu (effectiveRelays sırasında). */
  relayStates: RelayState[];
  /** Dünya'dan bakınca Güneş–Mars açısı (derece). */
  marsSepDeg: number;
  marsBlackout: boolean;
  /** Ekliptik çerçevede cisim merkezli aktarma uydusu konumları (km) ve faz açıları (rad). */
  relayPhase: Record<string, number>;
  /** Kullanılan yer istasyonu sayısı (0 = istasyon modeli kapalı, Dünya merkezi hedef). */
  stationCount: number;
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

/** Kepler denklemi E − e sin E = M (Newton). */
function solveKepler(M: number, e: number): number {
  const m = Math.atan2(Math.sin(M), Math.cos(M));
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/** Kepler yörüngesinde cisim merkezli, ekliptiğe paralel çerçevede konum (km). */
export function keplerPosition(o: OrbitElements, mu: number, jd: number): { pos: Vec3; phase: number } {
  const D2R = Math.PI / 180;
  const a = o.semiMajorKm, e = o.ecc;
  const n = Math.sqrt(mu / (a * a * a)); // rad/sn
  const M = o.meanAnomalyDeg * D2R + n * (jd - 2451545) * 86400;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cO = Math.cos(o.raanDeg * D2R), sO = Math.sin(o.raanDeg * D2R), ci = Math.cos(o.incDeg * D2R), si = Math.sin(o.incDeg * D2R);
  const cw = Math.cos(o.argPeriDeg * D2R), sw = Math.sin(o.argPeriDeg * D2R);
  return {
    pos: [
      (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp,
      (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp,
      sw * si * xp + cw * si * yp,
    ],
    phase: M,
  };
}

/**
 * Aşama 10: Mars ekvator çerçevesinden (z = dönme ekseni) ekliptik çerçeveye dönüş matrisi (satır sıralı 3×3). Eksen yönü HYPOTHETICAL.marsAxis (ICRS RA/Dec; VARSAYIM).
 * x ekseni çıkış düğümü yönü (ekliptik kutbu × eksen), y = z × x.
 */
let marsFrameCache: number[] | null = null;
function marsFrame(): number[] {
  if (marsFrameCache) return marsFrameCache;
  const D2R = Math.PI / 180, ax = HYPOTHETICAL.marsAxis;
  const x = Math.cos(ax.decDeg * D2R) * Math.cos(ax.raDeg * D2R), y = Math.cos(ax.decDeg * D2R) * Math.sin(ax.raDeg * D2R), z = Math.sin(ax.decDeg * D2R);
  const ce = Math.cos(ax.obliquityDeg * D2R), se = Math.sin(ax.obliquityDeg * D2R);
  const k: Vec3 = [x, y * ce + z * se, -y * se + z * ce]; // eksen, ekliptik çerçevede
  const nx = Math.hypot(k[1], k[0]);
  const i: Vec3 = [-k[1] / nx, k[0] / nx, 0]; // ẑ_ekliptik × k, normalize
  const j: Vec3 = [k[1] * i[2] - k[2] * i[1], k[2] * i[0] - k[0] * i[2], k[0] * i[1] - k[1] * i[0]];
  marsFrameCache = [i[0], j[0], k[0], i[1], j[1], k[1], i[2], j[2], k[2]];
  return marsFrameCache;
}
const rotMars = (v: Vec3): Vec3 => { const m = marsFrame(); return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; };
/** Mars ekseninin ekliptik kutbuna göre eğikliği (derece) — çerçeve doğrulaması için. */
export function marsAxisTiltDeg(): number { const m = marsFrame(); return (Math.acos(Math.min(1, Math.max(-1, m[8]))) * 180) / Math.PI; }

export function relayPosition(r: RelayConfig, jd: number, o: NetOptions = {}): { pos: Vec3; phase: number } {
  const b = BODY[r.body];
  if (r.orbit) {
    let orbit = r.orbit;
    if (o.moonPrecession && r.body === 'moon') {
      const pr = HYPOTHETICAL.moonPrecession, dd = jd - pr.epochJD, ov = typeof o.moonPrecession === 'object' ? o.moonPrecession : {};
      orbit = { ...orbit, raanDeg: orbit.raanDeg + (ov.raanRateDegPerDay ?? pr.raanRateDegPerDay) * dd, argPeriDeg: orbit.argPeriDeg + (ov.argPeriRateDegPerDay ?? pr.argPeriRateDegPerDay) * dd };
    }
    return keplerPosition(orbit, b.mu, jd);
  }
  const a = b.radiusKm + r.altitudeKm;
  const periodDays = (2 * Math.PI * Math.sqrt((a * a * a) / b.mu)) / 86400;
  const phase = ((jd - 2451545) / periodDays) * 2 * Math.PI;
  const pos: Vec3 = [a * Math.cos(phase), a * Math.sin(phase), 0];
  return { pos: r.body === 'mars' && o.marsAxis === 'tilted' ? rotMars(pos) : pos, phase };
}

function surfacePosition(a: AssetConfig, jd: number, o: NetOptions = {}): { pos: Vec3; normal: Vec3 } {
  const b = BODY[a.body];
  const lon = (a.lonDeg * Math.PI) / 180 + ((jd - 2451545) / b.rotDays) * 2 * Math.PI;
  const lat = (a.latDeg * Math.PI) / 180;
  let n: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  if (a.body === 'mars' && o.marsAxis === 'tilted') n = rotMars(n);
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

/**
 * Aşama 9: silindirik gölge. pos: cisim merkezli konum (km), sunDir: cisimden Güneş'e birim vektör. Konum Güneş'in ters yönünde ve eksene R'den yakınsa gölgededir.
 * (Kenar yarıgölgesi ve Güneş'in çapı yok; güç modeli yok.)
 */
export function inCylinderShadow(pos: Vec3, sunDir: Vec3, R: number): boolean {
  const d = dot(pos, sunDir);
  if (d >= 0) return false;
  return Math.hypot(pos[0] - d * sunDir[0], pos[1] - d * sunDir[1], pos[2] - d * sunDir[2]) < R;
}

/**
 * stationCount: config'teki ilk N yer istasyonu kullanılır (varsayılan: hepsi); 0 → istasyon modeli kapalı
 * (Aşama 2-4 davranışı: Dünya merkezi hedef, yer görüşü kısıtı yok).
 */
export function computeNetwork(tracks: Record<string, Track>, jd: number, stationCount: number = HYPOTHETICAL.groundStations.stations.length, opts: NetOptions = {}): NetworkState {
  const stations: GroundStationConfig[] = HYPOTHETICAL.groundStations.stations.slice(0, Math.max(0, stationCount));
  const marsSepDeg = marsSunSeparationDeg(tracks, jd);
  const marsBlackout = marsSepDeg < HYPOTHETICAL.conjunctionBlackoutAngleDeg;
  const statuses: AssetStatus[] = [];
  const relayPhase: Record<string, number> = {};
  const relays = effectiveRelays(opts);
  const assets = effectiveAssets(opts);
  const eclipseMode = opts.marsEclipse ?? 'none';
  const sunFromMars: Vec3 | null = eclipseMode !== 'none' ? (() => { const m = sample(tracks.mars, jd); const n = norm(m); return [-m[0] / n, -m[1] / n, -m[2] / n] as Vec3; })() : null;

  // 1) Her aktarma uydusu: konum, Dünya hattı
  const rinfo = new Map<string, { rp: { pos: Vec3; phase: number }; earthKm: number; earthLink: LinkState; station: { name: string; elevDeg: number } | null; eclipsed: boolean }>();
  const relayStates: RelayState[] = [];
  for (const relay of relays) {
    const rp = relayPosition(relay, jd, opts);
    relayPhase[relay.id] = rp.phase;
    const R = BODY[relay.body].radiusKm;
    const earthVec = earthRelative(tracks, relay.body, jd); // cisim merkezli Dünya konumu
    const toEarthFromRelay = sub(earthVec, rp.pos);
    const earthKm = norm(toEarthFromRelay);
    const occulted = segmentHitsSphere(rp.pos, earthVec, R);
    // Uydunun Dünya merkezli konumu = Dünya→cisim vektörü + uydunun cisim merkezli konumu
    const relayFromEarth: Vec3 = [rp.pos[0] - earthVec[0], rp.pos[1] - earthVec[1], rp.pos[2] - earthVec[2]];
    const gs = stations.length ? bestStation(stations, jd, relayFromEarth, HYPOTHETICAL.groundStations.minElevationDeg) : null;
    const station = gs ? { name: gs.station.name, elevDeg: gs.elevDeg } : null;
    const eclipsed = relay.body === 'mars' && !!sunFromMars && inCylinderShadow(rp.pos, sunFromMars, R);
    const earthLink: LinkState = relay.body === 'mars' && marsBlackout ? 'blackout' : occulted ? 'occulted' : eclipsed && eclipseMode !== 'power' ? 'eclipse' : stations.length && !gs ? 'nostation' : 'up';
    rinfo.set(relay.id, { rp, earthKm, earthLink, station, eclipsed });
    relayStates.push({ relay, earthLink, earthKm, station, eclipsed });
  }

  // 2) Araçlar (ana uyduya göre gruplu: eski sıra korunur). İkinci uydu varsa araç adaylar arasından seçer.
  for (const home of relays) {
    for (const asset of assets.filter((a) => a.relay === home.id)) {
      const s = surfacePosition(asset, jd, opts);
      const candidates = relayCandidates(asset, opts).map((rid) => {
        const ri = rinfo.get(rid)!;
        const toRelay = sub(ri.rp.pos, s.pos);
        const surfaceKm = norm(toRelay);
        const d = dot(s.normal, toRelay);
        return { relayId: rid, visible: d > 0, elevDeg: (Math.asin(Math.min(1, Math.max(-1, d / surfaceKm))) * 180) / Math.PI, surfaceKm };
      });
      let chosen = candidates[0];
      if (candidates.length > 1) {
        const vis = candidates.filter((c) => c.visible);
        if (vis.length) {
          if (opts.moonSecond === 'order') chosen = vis[0];
          else chosen = [...vis].sort((x, y) => (Number(rinfo.get(y.relayId)!.earthLink === 'up') - Number(rinfo.get(x.relayId)!.earthLink === 'up')) || (y.elevDeg - x.elevDeg))[0];
        }
      }
      const ri = rinfo.get(chosen.relayId)!;
      const relay = relays.find((r) => r.id === chosen.relayId)!;
      const surfaceLink: LinkState = !chosen.visible ? 'horizon' : relay.body === 'mars' && eclipseMode === 'both' && ri.eclipsed ? 'eclipse' : 'up';
      statuses.push({
        asset, relay, surfaceLink, earthLink: ri.earthLink, surfaceKm: chosen.surfaceKm, earthKm: ri.earthKm,
        delaySec: (chosen.surfaceKm + ri.earthKm) / C_KM_S,
        connected: surfaceLink === 'up' && ri.earthLink === 'up',
        station: ri.station,
        candidates,
      });
    }
  }
  // Aşama 10: uydular arası bağlantı (yalnızca ikinci Ay uydusu varken; Ay'ın engellemediği görüş hattı, en çok islMaxKm)
  const isl: IslState[] = opts.moonIsl ? [] : NO_ISL; // varsayılanda ortak boş dizi (her çağrıda yeni dizi ayırma)
  if (opts.moonIsl && opts.moonSecond && opts.moonSecond !== 'none') {
    const aId = HYPOTHETICAL.relays.find((r) => r.body === 'moon')!.id, bId = HYPOTHETICAL.moonRelay2.id;
    const ra = rinfo.get(aId), rb = rinfo.get(bId);
    if (ra && rb) {
      const km = norm(sub(ra.rp.pos, rb.rp.pos));
      isl.push({ a: aId, b: bId, km, up: km <= HYPOTHETICAL.routing.islMaxKm && !segmentHitsSphere(ra.rp.pos, rb.rp.pos, BODY.moon.radiusKm) });
    }
  }
  return { isl, statuses, relayStates, marsSepDeg, marsBlackout, relayPhase, stationCount: stations.length };
}

/** Aşama 10: Mars aktarma uydusu için çok basit güç modeli (parametreler: HYPOTHETICAL.marsPower; UYDURMA). Durumludur: zaman çizelgesi adımlarında sırayla çağrılır. */
export interface PowerParams { batteryWh: number; solarW: number; baseLoadW: number; linkLoadW: number; cutoffFrac: number; resumeFrac: number; initialFrac: number }
export class MarsPower {
  soc: number;
  on = true;
  /** Hat kapalı geçen adım sayısı (yalnızca güç nedeniyle). */
  offSteps = 0;
  constructor(readonly p: PowerParams = HYPOTHETICAL.marsPower) { this.soc = p.initialFrac * p.batteryWh; }
  /** Bir adım (dtSec) ilerletir; dönüş: bu adımdaki hat durumu (açık mı). eclipsed: uydu gölgede; linkWanted: hat jeometrik olarak açık (yük çeker). */
  step(eclipsed: boolean, linkWanted: boolean, dtSec: number): boolean {
    const { p } = this;
    const load = p.baseLoadW + (this.on && linkWanted ? p.linkLoadW : 0);
    const gen = eclipsed ? 0 : p.solarW;
    this.soc = Math.min(p.batteryWh, Math.max(0, this.soc + ((gen - load) * dtSec) / 3600));
    if (this.on && this.soc < p.cutoffFrac * p.batteryWh) this.on = false;
    else if (!this.on && this.soc >= p.resumeFrac * p.batteryWh) this.on = true;
    if (!this.on) this.offSteps++;
    return this.on;
  }
}

/** Aşama 10: güç modeli kapalıysa ('power' modunda) Mars aktarma uydusunun yüzey ve Dünya hatlarını 'eclipse' durumuna alır (computeNetwork çıktısını yerinde değiştirir). */
export function applyPower(net: NetworkState, pw: MarsPower, dtSec: number): boolean {
  const rs = net.relayStates.find((r) => r.relay.body === 'mars');
  if (!rs) return true;
  const on = pw.step(rs.eclipsed, rs.earthLink === 'up', dtSec);
  if (on) return true;
  if (rs.earthLink === 'up') rs.earthLink = 'eclipse';
  for (const st of net.statuses) {
    if (st.relay.id !== rs.relay.id) continue;
    st.earthLink = rs.earthLink;
    if (st.surfaceLink === 'up') st.surfaceLink = 'eclipse';
    st.connected = false;
  }
  return false;
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

