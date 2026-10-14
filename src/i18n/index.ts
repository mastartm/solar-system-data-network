// Arayüz dili (Türkçe / İngilizce). Anahtar Türkçe metnin KENDİSİdir: t('Oynat') → İngilizcede en.json'daki karşılığı; karşılık yoksa Türkçe görünür (yarım çeviri bozulmaz).
// Parametreler {ad} yer tutucularıyla verilir: t('Hesaplanıyor… {n}/{toplam}', { n: 3, toplam: 9 }). İçine `${…}` konan şablon dizgisi anahtar OLAMAZ (denetim: scripts/check-i18n.mjs).
// Dil seçimi: ?lang=tr|en > hatırlanan tercih (localStorage) > tarayıcı dili (tr ile başlıyorsa Türkçe, başka dil varsa İngilizce) > Türkçe (sayfa dışı ortam: testler, betikler).
import en from './en.json';

export type Lang = 'tr' | 'en';
export const LANG_KEY = 'ssdn.lang.v1';

const asLang = (v: unknown): Lang | null => (v === 'tr' || v === 'en' ? v : null);

/** Saf dil çözümleyici (testli). */
export function resolveLang(env: { search?: string | null; stored?: string | null; nav?: string | null }): Lang {
  const q = env.search ? asLang(new URLSearchParams(env.search).get('lang')) : null;
  if (q) return q;
  const s = asLang(env.stored);
  if (s) return s;
  if (env.nav) return env.nav.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  return 'tr';
}

function detect(): Lang {
  let search: string | null = null, stored: string | null = null, nav: string | null = null;
  try { search = globalThis.location?.search ?? null; } catch { /* yok */ }
  try { stored = globalThis.localStorage?.getItem(LANG_KEY) ?? null; } catch { /* erişim engelli: tercih hatırlanmaz */ }
  // Node 21+ da global `navigator.language` tanımlar; tarayıcı dili yalnızca gerçek bir sayfada (document var) dikkate alınır: testler ve betikler Türkçe kalır.
  try { if (typeof document !== 'undefined') nav = globalThis.navigator?.language ?? null; } catch { /* yok */ }
  return resolveLang({ search, stored, nav });
}

export const lang: Lang = detect();
/** Sayı ve tarih biçimleri için yerel ayar. */
export const locale = lang === 'en' ? 'en-US' : 'tr-TR';
/** Tarih biçimi için yerel ayar (İngilizcede 24 saatli, gün-ay-yıl sırası). */
export const dateLocale = lang === 'en' ? 'en-GB' : 'tr-TR';

const table = en as Record<string, string>;

/** Çeviri: `tr` Türkçe kaynak metin (anahtar); `{ad}` yer tutucuları params ile doldurulur. */
export function tr(text: string, lg: Lang = lang): string {
  return lg === 'en' ? table[text] ?? text : text;
}
export function t(text: string, params?: Record<string, string | number>): string {
  const s = tr(text);
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** Tercihi kaydedip sayfayı seçilen dilde yeniden yükler (arayüz tek seferde kurulduğu için canlı geçiş yerine yeniden yükleme). */
export function setLang(next: Lang): void {
  try { globalThis.localStorage?.setItem(LANG_KEY, next); } catch { /* tercih hatırlanmaz */ }
  const loc = globalThis.location;
  if (!loc) return;
  const u = new URL(loc.href);
  u.searchParams.set('lang', next);
  loc.href = u.toString();
}

/** Sayı biçimi (Türkçede virgül, İngilizcede nokta). */
export const nf = (n: number, d = 0): string => n.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
