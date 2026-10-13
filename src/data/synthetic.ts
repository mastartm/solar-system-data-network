import { AU_KM } from '../map/ephemeris';
import type { Track } from './types';

// SENTETİK VERİ — gerçek Horizons değil. Yalnızca ?sentetik=1 ile açılır (Horizons'a erişilemeyen
// ortamlarda arayüzü denemek için). Coplanar dairesel yörüngeler; mesafeler ve kavuşum zamanları gerçeği YANSITMAZ.
const PLANETS: Record<string, { au: number; days: number; phase: number }> = {
  mercury: { au: 0.387, days: 87.97, phase: 0.3 }, venus: { au: 0.723, days: 224.7, phase: 1.2 },
  earth: { au: 1.0, days: 365.25, phase: 1.75 }, mars: { au: 1.524, days: 686.98, phase: 3.9 },
  jupiter: { au: 5.2, days: 4332.6, phase: 0.5 }, saturn: { au: 9.58, days: 10759, phase: 2.0 },
  uranus: { au: 19.2, days: 30688, phase: 4.0 }, neptune: { au: 30.05, days: 60182, phase: 5.5 },
};
const START_JD = 2458849.5; // 2020-01-01
const SPAN_DAYS = 7305;

function circle(radiusKm: number, periodDays: number, phase: number, stepDays: number): Track {
  const count = Math.floor(SPAN_DAYS / stepDays) + 1;
  const pos = new Float64Array(count * 3), vel = new Float64Array(count * 3);
  const w = (2 * Math.PI) / periodDays;
  for (let i = 0; i < count; i++) {
    const a = phase + w * i * stepDays;
    pos.set([radiusKm * Math.cos(a), radiusKm * Math.sin(a), 0], i * 3);
    vel.set([-radiusKm * w * Math.sin(a), radiusKm * w * Math.cos(a), 0], i * 3); // km/gün
  }
  return { startJD: START_JD, stepDays, count, pos, vel };
}

export function syntheticTracks(): Record<string, Track> {
  const out: Record<string, Track> = {};
  for (const [id, p] of Object.entries(PLANETS)) out[id] = circle(p.au * AU_KM, p.days, p.phase, 2);
  out.moon = circle(384400, 27.321661, 0.4, 1);
  return out;
}
