import { t } from '../i18n';
// Harita katmanlarının aç/kapa durumu; tercihler localStorage'da saklanır (yoksa ya da hata verirse varsayılanla çalışır).

export interface LayerState {
  /** Ağ katmanı: aktarma uyduları, yüzey araçları, bağlantı çizgileri. */
  network: boolean;
  /** Veri akışı: paketler (ağ katmanı kapalıyken çizilmez). */
  flow: boolean;
  /** Güneş, gezegenler ve Ay adları. */
  names: boolean;
  /** Ağ etiketleri: uydu/araç adları ve ışık gecikmesi yazısı (ağ katmanı kapalıyken çizilmez). */
  netLabels: boolean;
  /** Yörünge çizgileri (gezegen izleri, Ay yörüngesi, 3B başvuru halkaları). */
  orbits: boolean;
}

export const LAYER_KEY = 'ssdn.layers.v1';
export const DEFAULT_LAYERS: LayerState = { network: true, flow: true, names: true, netLabels: true, orbits: true };

export const LAYER_META: { key: keyof LayerState; label: string; needsNetwork?: boolean }[] = [
  { key: 'network', label: t('Ağ katmanı (uydular, araçlar, bağlantılar)') },
  { key: 'flow', label: t('Veri akışı (paketler)'), needsNetwork: true },
  { key: 'names', label: t('Gezegen adları (Güneş ve Ay dahil)') },
  { key: 'netLabels', label: t('Ağ etiketleri (ad, gecikme)'), needsNetwork: true },
  { key: 'orbits', label: t('Yörünge çizgileri') },
];

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Bozuk ya da eksik kayıt varsayılana düşer; yalnızca boolean alanlar kabul edilir. */
export function parseLayers(raw: string | null | undefined): LayerState {
  const out = { ...DEFAULT_LAYERS };
  if (!raw) return out;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') for (const k of Object.keys(out) as (keyof LayerState)[]) if (typeof o[k] === 'boolean') out[k] = o[k];
  } catch {
    /* bozuk JSON: varsayılan */
  }
  return out;
}

const defaultStorage = (): StorageLike | null => {
  try {
    return window.localStorage;
  } catch {
    return null; // erişim engelli (gizli pencere, çerez kapalı)
  }
};

export function loadLayers(storage: StorageLike | null = defaultStorage()): LayerState {
  try {
    return parseLayers(storage?.getItem(LAYER_KEY));
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

export function saveLayers(state: LayerState, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(LAYER_KEY, JSON.stringify(state));
  } catch {
    /* kota dolu ya da engelli: sessizce yoksay */
  }
}
