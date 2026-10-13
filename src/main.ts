import './style.css';
import { loadTracks } from './data/loader';
import type { BodyId } from './data/types';
import { dateToJd, trackEndJD } from './map/ephemeris';
import { MapView } from './map/MapView';
import { createControls } from './ui/controls';
import { renderInfo } from './ui/infoPanel';

async function start() {
  const info = document.getElementById('info')!;
  let tracks;
  try {
    tracks = await loadTracks();
  } catch (e) {
    info.innerHTML = `<h2>Veri yüklenemedi</h2>
      <p>${(e as Error).message}</p>
      <p><code>npm run fetch-data</code> komutunu çalıştırıp sayfayı yenileyin.</p>`;
    return;
  }

  const planetTrack = tracks.earth;
  const minJD = planetTrack.startJD;
  const maxJD = Math.min(trackEndJD(planetTrack), trackEndJD(tracks.moon));

  const map = new MapView(document.getElementById('map') as HTMLCanvasElement, tracks);
  let jd = Math.min(Math.max(dateToJd(new Date()), minJD), maxJD);
  let selected: BodyId = 'earth';
  const dateLabel = document.createElement('div');
  dateLabel.id = 'date-label';
  document.querySelector('main')!.appendChild(dateLabel);

  const controls = createControls(
    document.getElementById('controls')!, minJD, maxJD,
    (v) => { jd = v; map.dirty = true; },
    (f) => (f === 'reset' ? map.resetView() : map.zoomBy(f)),
  );
  map.onSelect = (id) => { selected = id; };
  controls.setJD(jd);

  let last = performance.now();
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (controls.isPlaying()) {
      let next = jd + controls.speed() * dt;
      if (next >= maxJD) next = minJD; // sona gelince başa dön
      controls.setJD(next);
    }
    if (map.dirty) {
      map.dirty = false;
      map.render(jd);
      renderInfo(info, selected, jd, tracks);
      dateLabel.textContent = new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
