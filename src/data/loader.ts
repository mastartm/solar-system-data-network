import { syntheticTracks } from './synthetic';
import { t } from '../i18n';
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
  if (!res.ok) throw new Error(t('{ad} okunamadı (HTTP {kod})', { ad: name, kod: res.status }));
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
    const tk = tracks[id];
    if (!tk) { problems.push(t('{id}: veri yok', { id })); continue; }
    if (!(tk.count >= 2) || !(tk.stepDays > 0) || !Number.isFinite(tk.startJD)) { problems.push(t('{id}: başlık alanları geçersiz', { id })); continue; }
    if (tk.pos.length !== tk.count * 3 || tk.vel.length !== tk.count * 3) { problems.push(t('{id}: uzunluk uyuşmuyor (pos {pos}, vel {vel}, beklenen {beklenen})', { id, pos: tk.pos.length, vel: tk.vel.length, beklenen: tk.count * 3 })); continue; }
    for (let i = 0; i < tk.pos.length; i++) {
      if (!Number.isFinite(tk.pos[i]) || !Number.isFinite(tk.vel[i])) { problems.push(t('{id}: sayısal olmayan değer (indeks {indeks})', { id, indeks: Math.floor(i / 3) })); break; }
    }
  }
  return problems;
}
