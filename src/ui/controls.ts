import type { Eclipse } from '../data/eclipses';
import { eclipseLabel, isCentral } from '../data/eclipses';
import { dateToJd, jdToDate } from '../map/ephemeris';
import type { ViewMode } from '../map/MapView';

export interface Controls {
  setJD(jd: number): void;
  isPlaying(): boolean;
  speed(): number; // gün/sn
}

export interface ControlOptions {
  minJD: number;
  maxJD: number;
  eclipses: Eclipse[];
  onChange: (jd: number) => void;
  onZoom: (factor: number | 'reset') => void;
  onView: (mode: ViewMode) => void;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

export function createControls(root: HTMLElement, o: ControlOptions): Controls {
  const { minJD, maxJD } = o;
  const span = maxJD - minJD;
  const list = o.eclipses.filter((e) => e.jd >= minJD && e.jd <= maxJD);

  const ticks = list
    .map((e) => {
      const f = (e.jd - minJD) / span;
      const cls = `tick ${e.type}${isCentral(e) ? ' central' : ''}`;
      return `<button type="button" class="${cls}" data-jd="${e.jd}" style="left:calc(8px + (100% - 16px) * ${f})" title="${eclipseLabel(e)} · ${fmtDate(e.time)}" aria-label="${eclipseLabel(e)}"></button>`;
    })
    .join('');

  root.innerHTML = `
    <div class="row">
      <button id="play" type="button">▶ Oynat</button>
      <label>Hız
        <select id="speed">
          <option value="1">1 gün/sn</option>
          <option value="10" selected>10 gün/sn</option>
          <option value="30">30 gün/sn</option>
          <option value="100">100 gün/sn</option>
        </select>
      </label>
      <div class="timeline">
        <div class="ticks">${ticks}</div>
        <input id="slider" type="range" min="0" max="${Math.floor(span * 10)}" step="1" value="0" aria-label="Tarih" />
      </div>
      <input id="date" type="date" aria-label="Tarih seç" />
      <button id="today" type="button">Bugün</button>
    </div>
    <div class="row">
      <span class="seg" role="group" aria-label="Görünüm">
        <button id="v2" type="button" class="on">2B</button>
        <button id="v3" type="button">3B</button>
      </span>
      <span class="zoom">
        <button id="zin" type="button" aria-label="Yakınlaştır">+</button>
        <button id="zout" type="button" aria-label="Uzaklaştır">−</button>
        <button id="zreset" type="button">Sıfırla</button>
      </span>
      <span class="grow"></span>
      <span class="legend"><i class="tick solar central"></i> Güneş tutulması <i class="tick lunar central"></i> Ay tutulması <small>(dolu: tam/halkalı, boş: kısmi)</small></span>
      <button id="eprev" type="button">◀ Önceki tutulma</button>
      <button id="enext" type="button">Sonraki tutulma ▶</button>
      <button id="elist" type="button">Tutulmalar (${list.length})</button>
    </div>
    <div id="elist-panel" hidden>
      ${list
        .map(
          (e) =>
            `<button type="button" class="eitem" data-jd="${e.jd}"><i class="tick ${e.type}${isCentral(e) ? ' central' : ''}"></i><span>${fmtDate(e.time)}</span><b>${eclipseLabel(e)}</b></button>`,
        )
        .join('')}
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const slider = $<HTMLInputElement>('slider');
  const date = $<HTMLInputElement>('date');
  const play = $<HTMLButtonElement>('play');
  const speed = $<HTMLSelectElement>('speed');
  const panel = $<HTMLElement>('elist-panel');
  let playing = false;

  const iso = (jd: number) => jdToDate(jd).toISOString().slice(0, 10);
  date.min = iso(minJD);
  date.max = iso(maxJD);

  let current = minJD;
  const setJD = (jd: number) => {
    jd = Math.min(Math.max(jd, minJD), maxJD);
    current = jd;
    slider.value = String(Math.round((jd - minJD) * 10));
    date.value = iso(jd);
    o.onChange(jd);
  };
  const jumpTo = (jd: number) => {
    playing = false;
    play.textContent = '▶ Oynat';
    setJD(jd);
  };

  slider.addEventListener('input', () => setJD(minJD + +slider.value / 10));
  date.addEventListener('change', () => {
    if (date.value) setJD(dateToJd(new Date(date.value + 'T00:00:00Z')));
  });
  $('today').addEventListener('click', () => setJD(dateToJd(new Date())));
  play.addEventListener('click', () => {
    playing = !playing;
    play.textContent = playing ? '❚❚ Durdur' : '▶ Oynat';
  });
  $('zin').addEventListener('click', () => o.onZoom(1.4));
  $('zout').addEventListener('click', () => o.onZoom(1 / 1.4));
  $('zreset').addEventListener('click', () => o.onZoom('reset'));

  const setView = (m: ViewMode) => {
    $('v2').classList.toggle('on', m === '2d');
    $('v3').classList.toggle('on', m === '3d');
    o.onView(m);
  };
  $('v2').addEventListener('click', () => setView('2d'));
  $('v3').addEventListener('click', () => setView('3d'));

  $('eprev').addEventListener('click', () => {
    const prev = [...list].reverse().find((e) => e.jd < current - 0.5);
    if (prev) jumpTo(prev.jd);
  });
  $('enext').addEventListener('click', () => {
    const next = list.find((e) => e.jd > current + 0.5);
    if (next) jumpTo(next.jd);
  });
  $('elist').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-jd]');
    if (el) jumpTo(+el.dataset.jd!);
  });

  return { setJD, isPlaying: () => playing, speed: () => +speed.value };
}
