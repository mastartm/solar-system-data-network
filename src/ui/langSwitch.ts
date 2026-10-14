import { lang, setLang, t, type Lang } from '../i18n';

/** index.html'deki statik metinleri seçili dile çevirir: `data-i18n` öğelerinin metni, `data-i18n-aria` öğelerinin aria-label'ı anahtar olarak kullanılır (içindeki Türkçe metin). */
export function applyStaticText(root: ParentNode = document): void {
  document.documentElement.lang = lang;
  document.title = t('Güneş Sistemi Veri Ağı');
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.textContent ?? ''); });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('aria-label') ?? '')); });
}

/** Başlığa TR / EN düğmesi koyar; seçim kaydedilir ve sayfa seçilen dille yeniden yüklenir. */
export function mountLangSwitch(header: HTMLElement): void {
  const box = document.createElement('span');
  box.className = 'seg lang-switch';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t('Dil'));
  for (const l of ['tr', 'en'] as Lang[]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.toUpperCase();
    b.lang = l;
    b.title = l === 'tr' ? 'Türkçe' : 'English';
    b.className = l === lang ? 'on' : '';
    b.setAttribute('aria-pressed', String(l === lang));
    b.addEventListener('click', () => { if (l !== lang) setLang(l); });
    box.appendChild(b);
  }
  header.appendChild(box);
}
