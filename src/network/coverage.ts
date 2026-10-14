// Kapsama özeti (saf fonksiyon, DOM yok): bir tarih aralığında 30 dk adımla uyduyu gören yer istasyonu, Dünya hattı açıklığı ve yüzey görüşü.
// Tüm sayılar VARSAYIMSAL ağa aittir (src/config/hypothetical.ts); konumlar çağıranın verdiği (Horizons) izlerdendir.
import { HYPOTHETICAL } from '../config/hypothetical';
import type { Track } from '../data/types';
import { MarsPower, applyPower, computeNetwork, type NetOptions } from './network';

/**
 * Sayaçlar adım sayısıdır (yüzde için `steps`e bölün). see/up uydu başına (her adımda bir kez; araç sayısından bağımsız), surf/pathUp araç başına:
 * see = en az bir yer istasyonu uyduyu eşik üstünde görüyor (n = 0 → hep); up = Dünya hattı açık; surf = araç seçtiği uyduyu ufkun üstünde görüyor;
 * pathUp = araç → uydu → Dünya yolu açık (surf ve up); anyUp = en az bir uydunun Dünya hattı açık; surfAny = araç adaylardan en az birini görüyor.
 */
export interface CoverageRow {
  n: number;
  steps: number;
  see: Record<string, number>;
  up: Record<string, number>;
  surf: Record<string, number>;
  pathUp: Record<string, number>;
  surfAny: Record<string, number>;
  anyUp: number;
}

export function coverageRow(tracks: Record<string, Track>, startJD: number, endJD: number, n: number, net: NetOptions = {}): CoverageRow {
  const see: Record<string, number> = {}, up: Record<string, number> = {}, surf: Record<string, number> = {}, pathUp: Record<string, number> = {}, surfAny: Record<string, number> = {};
  let steps = 0, anyUp = 0;
  const pw = net.marsEclipse === 'power' ? new MarsPower(net.marsPowerBatteryWh !== undefined ? { ...HYPOTHETICAL.marsPower, batteryWh: net.marsPowerBatteryWh } : undefined) : null; // Aşama 10: durumlu güç modeli (30 dk adım)
  for (let jd = startJD; jd < endJD; jd += 1 / 48) {
    steps++;
    const state = computeNetwork(tracks, jd, n, net);
    if (pw) applyPower(state, pw, 1800);
    let any = false;
    for (const rs of state.relayStates) {
      see[rs.relay.id] = (see[rs.relay.id] ?? 0) + (n === 0 || rs.station ? 1 : 0);
      up[rs.relay.id] = (up[rs.relay.id] ?? 0) + (rs.earthLink === 'up' ? 1 : 0);
      if (rs.earthLink === 'up') any = true;
    }
    if (any) anyUp++;
    for (const st of state.statuses) {
      surf[st.asset.id] = (surf[st.asset.id] ?? 0) + (st.surfaceLink === 'up' ? 1 : 0);
      pathUp[st.asset.id] = (pathUp[st.asset.id] ?? 0) + (st.connected ? 1 : 0);
      surfAny[st.asset.id] = (surfAny[st.asset.id] ?? 0) + (st.candidates.some((c) => c.visible) ? 1 : 0);
    }
  }
  return { n, steps, see, up, surf, pathUp, surfAny, anyUp };
}
