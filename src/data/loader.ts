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

/**
 * Yüklenen verinin temel sağlık kontrolü. Sorun listesi döner (boşsa veri kullanılabilir).
 * Amaç: bozuk/eksik veride panoyu çökertmek yerine kullanıcıya açık bir mesaj göstermek.
 */
export function validateTracks(tracks: Record<string, Track>): string[] {
  const problems: string[] = [];
  for (const id of ['earth', 'mars', 'moon', 'mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const t = tracks[id];
    if (!t) { problems.push(`${id}: veri yok`); continue; }
    if (!(t.count >= 2) || !(t.stepDays > 0) || !Number.isFinite(t.startJD)) { problems.push(`${id}: başlık alanları geçersiz`); continue; }
    if (t.pos.length !== t.count * 3 || t.vel.length !== t.count * 3) { problems.push(`${id}: uzunluk uyuşmuyor (pos ${t.pos.length}, vel ${t.vel.length}, beklenen ${t.count * 3})`); continue; }
    for (let i = 0; i < t.pos.length; i++) {
      if (!Number.isFinite(t.pos[i]) || !Number.isFinite(t.vel[i])) { problems.push(`${id}: sayısal olmayan değer (indeks ${Math.floor(i / 3)})`); break; }
    }
  }
  return problems;
}
