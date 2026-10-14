import { factRows, FACTS_DISCLAIMER } from '../data/bodyFacts';
import { BODIES, type BodyId, type Track } from '../data/types';
import { dist, lightMinutes, sample } from '../map/ephemeris';
import { PlanetCard } from './planetCard';
import { nf as fmt, t } from '../i18n';
const CARD_PX = 124;

export interface InfoPanel {
  /** Seçili cisim değişince iskeleti bir kez kurar (kart canvas'ı yeniden yaratılmaz, titremez). */
  setSelected(id: BodyId): void;
  /** Yalnızca sayıları günceller (innerHTML yok). */
  update(jd: number): void;
  setActive(active: boolean): void;
  readonly card: PlanetCard;
}

/**
 * Bilgi paneli: seçili cismin küre kartı + genel fiziksel bilgiler (doğrulanmamış) + Dünya'ya uzaklık ve ışık gecikmesi (gerçek Horizons).
 * İskelet seçim değişince bir kez kurulur; 250 ms'lik güncellemede yalnızca metinler değişir.
 */
export function createInfoPanel(el: HTMLElement, tracks: Record<string, Track>): InfoPanel {
  let id: BodyId | null = null;
  let kmEl: HTMLElement | null = null, minEl: HTMLElement | null = null;
  let card: PlanetCard | null = null;

  // Kart canvas'ı panel boyunca tek örnek; seçimde yalnızca iskeletin geri kalanı yeniden kurulur ve canvas yeniden eklenir.
  const canvas = document.createElement('canvas');
  canvas.className = 'pcard-canvas';
  canvas.setAttribute('aria-label', t('Seçili cismin şematik küre görünümü'));
  card = new PlanetCard(canvas, CARD_PX);

  const setText = (e: HTMLElement | null, txt: string) => { if (e && e.textContent !== txt) e.textContent = txt; };

  return {
    card,
    setActive: (a) => card!.setActive(a),
    setSelected(next) {
      if (next === id) return;
      id = next;
      const body = BODIES.find((b) => b.id === next)!;
      const rows = factRows(next).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
      const live = next === 'earth'
        ? `<p>${t('Dünya, ölçümlerin referans noktasıdır.')}</p>`
        : `<dl class="live"><dt>${t('Dünya\'ya uzaklık')} <span class="tag-real">Horizons</span></dt><dd data-k="km"></dd>
           <dt>${t('Işık gecikmesi')} <span class="tag-real">Horizons</span></dt><dd data-k="min"></dd></dl>`;
      el.innerHTML = `<h2><span class="dot" style="background:${body.color}"></span>${body.name}</h2>
        <div class="pcard"><figure class="pcard-vis"><div class="pcard-slot"></div><figcaption>${t('Şematik görünüm; gerçek yüzey dokusu değildir')}</figcaption></figure>
        <dl class="pfacts">${rows}</dl></div>
        <p class="hint facts-note">${t('Yarıçap, dönem, uzaklık, dönme ve uydu sayısı:')} ${FACTS_DISCLAIMER}</p>
        ${live}
        <p class="hint">${t('Tarih kaydırıcısıyla değerlerin zamanla nasıl değiştiğini izleyin.')}</p>`;
      el.querySelector('.pcard-slot')!.appendChild(canvas);
      kmEl = el.querySelector('[data-k="km"]');
      minEl = el.querySelector('[data-k="min"]');
      card!.setBody(next);
    },
    update(jd) {
      if (!id || id === 'earth') return;
      const earth = sample(tracks.earth, jd);
      let km: number;
      if (id === 'moon') km = dist(sample(tracks.moon, jd), [0, 0, 0]);
      else if (id === 'sun') km = dist([0, 0, 0], earth);
      else km = dist(sample(tracks[id], jd), earth);
      const min = lightMinutes(km);
      setText(kmEl, `${fmt(km)} km`);
      setText(minEl, t('{dk} dakika ({sn} sn)', { dk: fmt(min, 2), sn: fmt(min * 60, min < 1 ? 2 : 0) }));
    },
  };
}
