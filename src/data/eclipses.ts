export interface Eclipse {
  type: 'solar' | 'lunar';
  kind: string; // total | annular | partial | penumbral
  jd: number; // tutulmanın en yüksek anı (JD)
  time: string; // ISO, UTC
}

const KIND_TR: Record<string, string> = {
  total: 'Tam', annular: 'Halkalı', partial: 'Kısmi', penumbral: 'Yarıgölge',
};

export const eclipseLabel = (e: Eclipse): string =>
  `${KIND_TR[e.kind] ?? e.kind} ${e.type === 'solar' ? 'güneş' : 'Ay'} tutulması`;

/** Merkezi (tam/halkalı) tutulmalar dolu, diğerleri boş işaretle gösterilir. */
export const isCentral = (e: Eclipse): boolean => e.kind === 'total' || e.kind === 'annular';

/** Tutulma listesi yüklenemezse site yine çalışır (boş liste döner). */
export async function loadEclipses(): Promise<Eclipse[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/eclipses.json`);
    if (!res.ok) return [];
    const json = (await res.json()) as { eclipses: { type: 'solar' | 'lunar'; kind: string; time: string }[] };
    return json.eclipses.map((e) => ({ ...e, jd: Date.parse(e.time) / 86400000 + 2440587.5 }));
  } catch {
    return [];
  }
}

/** Verilen JD'ye en yakın tutulma ve aradaki gün farkı. */
export function nearestEclipse(list: Eclipse[], jd: number): { eclipse: Eclipse; days: number } | null {
  let best: Eclipse | null = null;
  for (const e of list) if (!best || Math.abs(e.jd - jd) < Math.abs(best.jd - jd)) best = e;
  return best ? { eclipse: best, days: best.jd - jd } : null;
}
