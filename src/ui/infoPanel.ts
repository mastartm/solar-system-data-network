import { BODIES, type BodyId, type Track } from '../data/types';
import { dist, lightMinutes, sample } from '../map/ephemeris';

const fmt = (n: number, d = 0) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Seçili cismin Dünya'ya uzaklığını (km ve ışık dakikası) gösterir. */
export function renderInfo(el: HTMLElement, id: BodyId, jd: number, tracks: Record<string, Track>) {
  const body = BODIES.find((b) => b.id === id)!;
  let html = `<h2><span class="dot" style="background:${body.color}"></span>${body.name}</h2>`;
  if (id === 'earth') {
    html += '<p>Dünya, ölçümlerin referans noktasıdır.</p>';
  } else {
    const earth = sample(tracks.earth, jd);
    let km: number;
    if (id === 'moon') km = dist(sample(tracks.moon, jd), [0, 0, 0]);
    else if (id === 'sun') km = dist([0, 0, 0], earth);
    else km = dist(sample(tracks[id], jd), earth);
    const min = lightMinutes(km);
    html += `<dl>
      <dt>Dünya'ya uzaklık</dt><dd>${fmt(km)} km</dd>
      <dt>Işık gecikmesi</dt><dd>${fmt(min, 2)} dakika (${fmt(min * 60, min < 1 ? 2 : 0)} sn)</dd>
    </dl>`;
  }
  html += '<p class="hint">Tarih kaydırıcısıyla değerlerin zamanla nasıl değiştiğini izleyin.</p>';
  el.innerHTML = html;
}
