import { dateToJd, jdToDate } from '../map/ephemeris';

export interface Controls {
  setJD(jd: number): void;
  isPlaying(): boolean;
  speed(): number; // gün/sn
}

export function createControls(
  root: HTMLElement,
  minJD: number,
  maxJD: number,
  onChange: (jd: number) => void,
  onZoom: (factor: number | 'reset') => void,
): Controls {
  root.innerHTML = `
    <button id="play" type="button">▶ Oynat</button>
    <label>Hız
      <select id="speed">
        <option value="1">1 gün/sn</option>
        <option value="10" selected>10 gün/sn</option>
        <option value="30">30 gün/sn</option>
        <option value="100">100 gün/sn</option>
      </select>
    </label>
    <input id="slider" type="range" min="0" max="${Math.floor((maxJD - minJD) * 10)}" step="1" value="0" aria-label="Tarih" />
    <input id="date" type="date" aria-label="Tarih seç" />
    <button id="today" type="button">Bugün</button>
    <span class="zoom">
      <button id="zin" type="button" aria-label="Yakınlaştır">+</button>
      <button id="zout" type="button" aria-label="Uzaklaştır">−</button>
      <button id="zreset" type="button">Sıfırla</button>
    </span>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const slider = $<HTMLInputElement>('slider');
  const date = $<HTMLInputElement>('date');
  const play = $<HTMLButtonElement>('play');
  const speed = $<HTMLSelectElement>('speed');
  let playing = false;

  const iso = (jd: number) => jdToDate(jd).toISOString().slice(0, 10);
  date.min = iso(minJD); date.max = iso(maxJD);

  const setJD = (jd: number) => {
    jd = Math.min(Math.max(jd, minJD), maxJD);
    slider.value = String(Math.round((jd - minJD) * 10));
    date.value = iso(jd);
    onChange(jd);
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
  $('zin').addEventListener('click', () => onZoom(1.4));
  $('zout').addEventListener('click', () => onZoom(1 / 1.4));
  $('zreset').addEventListener('click', () => onZoom('reset'));

  return { setJD, isPlaying: () => playing, speed: () => +speed.value };
}
