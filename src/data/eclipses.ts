import { t } from '../i18n';

export interface Eclipse {
  type: 'solar' | 'lunar';
  kind: string; // total | annular | partial | penumbral
  jd: number; // tutulmanın en yüksek anı (JD)
  time: string; // ISO, UTC
}

// Etiketler tam ifade olarak çevrilir (dil bilgisi iki dilde farklıdır); bilinmeyen tür ham hâliyle gösterilir.
const labels = (): Record<'solar' | 'lunar', Record<string, string>> => ({
  solar: { total: t('Tam güneş tutulması'), annular: t('Halkalı güneş tutulması'), partial: t('Kısmi güneş tutulması'), penumbral: t('Yarıgölge güneş tutulması') },
  lunar: { total: t('Tam Ay tutulması'), annular: t('Halkalı Ay tutulması'), partial: t('Kısmi Ay tutulması'), penumbral: t('Yarıgölge Ay tutulması') },
});

export const eclipseLabel = (e: Eclipse): string => labels()[e.type][e.kind] ?? (e.type === 'solar' ? t('{tür} güneş tutulması', { tür: e.kind }) : t('{tür} Ay tutulması', { tür: e.kind }));

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
