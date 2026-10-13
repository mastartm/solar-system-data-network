import { syntheticTracks } from './synthetic';
import type { Track } from './types';

/** Gerçek veri yerine sentetik yörüngeler (yalnızca ?sentetik=1). */
export const isSynthetic = () => new URLSearchParams(location.search).has('sentetik');

interface RawBody {
  startJD: number;
  stepDays: number;
  count: number;
  pos: number[];
  vel: number[];
}

async function loadFile(name: string): Promise<Record<string, Track>> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`${name} okunamadı (HTTP ${res.status})`);
  const json = (await res.json()) as { bodies: Record<string, RawBody> };
  const out: Record<string, Track> = {};
  for (const [id, b] of Object.entries(json.bodies)) {
    out[id] = {
      startJD: b.startJD,
      stepDays: b.stepDays,
      count: b.count,
      pos: Float64Array.from(b.pos),
      vel: Float64Array.from(b.vel, (v) => v * 86400), // km/s -> km/gün
    };
  }
  return out;
}

export async function loadTracks(): Promise<Record<string, Track>> {
  if (isSynthetic()) return syntheticTracks();
  const [planets, moon] = await Promise.all([loadFile('planets.json'), loadFile('moon.json')]);
  return { ...planets, ...moon };
}
