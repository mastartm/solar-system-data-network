import './style.css';
import { eclipseLabel, loadEclipses, nearestEclipse } from './data/eclipses';
import { isSynthetic, loadTracks, validateTracks } from './data/loader';
import type { BodyId } from './data/types';
import { dateToJd, trackEndJD } from './map/ephemeris';
import { MapView } from './map/MapView';
import { createControls } from './ui/controls';
import { renderInfo } from './ui/infoPanel';
import { renderNetwork } from './ui/networkPanel';
import { mountScheduler } from './ui/schedulerPanel';
import { NetworkLayer } from './map/networkLayer';
import { computeNetwork, findBlackoutWindows } from './network/network';

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

  const problems = validateTracks(tracks);
  if (problems.length) {
    info.innerHTML = `<h2>Veri bozuk ya da eksik</h2>
      <p>Horizons verisi beklenen biçimde değil; harita ve çizelgeleyici başlatılmadı:</p>
      <ul>${problems.map((p) => `<li>${p}</li>`).join('')}</ul>
      <p><code>npm run fetch-data -- --force</code> ile veriyi yeniden çekin.</p>`;
    return;
  }

  const eclipses = await loadEclipses();
  const planetTrack = tracks.earth;
  const minJD = planetTrack.startJD;
  const maxJD = Math.min(trackEndJD(planetTrack), trackEndJD(tracks.moon));

  const map = new MapView(document.getElementById('map') as HTMLCanvasElement, tracks);
  let jd = Math.min(Math.max(dateToJd(new Date()), minJD), maxJD);
  let selected: BodyId = 'earth';
  const dateLabel = document.createElement('div');
  dateLabel.id = 'date-label';
  document.querySelector('main')!.appendChild(dateLabel);

  const controls = createControls(document.getElementById('controls')!, {
    minJD, maxJD, eclipses,
    onChange: (v) => { jd = v; map.dirty = true; },
    onZoom: (f) => (f === 'reset' ? map.resetView() : map.zoomBy(f)),
    onView: (m) => map.setMode(m),
  });
  map.onSelect = (id) => { selected = id; };

  // Aşama 2: veri ağı katmanı (tüm sayılar src/config/hypothetical.ts içinde, varsayımsal)
  const layer = new NetworkLayer();
  const windows = findBlackoutWindows(tracks);
  const netEl = document.getElementById('net')!;
  let net = computeNetwork(tracks, jd);
  map.overlay = (ctx, screen, radii, zoom) => layer.draw(ctx, screen, radii, zoom, net);
  const jumpRow = document.createElement('div');
  jumpRow.className = 'row';
  jumpRow.innerHTML = '<button id="cprev" type="button">◀ Önceki Mars kavuşumu</button><button id="cnext" type="button">Sonraki Mars kavuşumu ▶</button><span class="legend">Kesinti penceresinin başına gider (Güneş–Mars açısı eşiğin altında).</span>';
  document.getElementById('controls')!.appendChild(jumpRow);
  jumpRow.querySelector('#cprev')!.addEventListener('click', () => {
    const w = [...windows].reverse().find((x) => x.startJD - 3 < jd - 0.5); // atlanan hedef (başlangıç − 3 gün) bugünden geride olmalı
    if (w) controls.jumpTo(w.startJD - 3);
  });
  jumpRow.querySelector('#cnext')!.addEventListener('click', () => {
    const w = windows.find((x) => x.startJD - 3 > jd + 0.5); // aynı pencerede takılmasın: hedef bugünden ileride olmalı
    if (w) controls.jumpTo(w.startJD - 3);
  });
  let lastPanel = 0;

  // Aşama 3: çizelgeleyici sekmesi (harita gizlenir, çizim döngüsü durur; geri gelince olduğu gibi devam eder)
  const main = document.querySelector('main') as HTMLElement;
  const footer = document.getElementById('controls')!;
  const schedEl = document.getElementById('sched')!;
  const sched = mountScheduler(schedEl, tracks, windows, isSynthetic());
  let tab: 'map' | 'sched' = 'map';
  const setTab = (t: 'map' | 'sched') => {
    tab = t;
    main.hidden = footer.hidden = t !== 'map';
    schedEl.hidden = t !== 'sched';
    for (const [id, name] of [['tab-map', 'map'], ['tab-sched', 'sched']] as const) {
      const b = document.getElementById(id)!;
      b.classList.toggle('on', name === t);
      b.setAttribute('aria-selected', String(name === t));
    }
    if (t === 'sched') void sched.show();
    else map.dirty = true;
  };
  document.getElementById('tab-map')!.addEventListener('click', () => setTab('map'));
  document.getElementById('tab-sched')!.addEventListener('click', () => setTab('sched'));
  if (location.hash === '#cizelgeleyici') setTab('sched');
  controls.setJD(jd);

  let last = performance.now();
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (tab !== 'map') { requestAnimationFrame(frame); return; }
    if (controls.isPlaying()) {
      let next = jd + controls.speed() * dt;
      if (next >= maxJD) next = minJD; // sona gelince başa dön
      controls.setJD(next);
    }
    net = computeNetwork(tracks, jd);
    layer.step(Math.min(dt, 0.1), net);
    map.dirty = true; // paket animasyonu her karede çizim ister
    if (map.dirty) {
      map.dirty = false;
      map.render(jd);
      if (now - lastPanel > 250) {
        lastPanel = now;
        renderInfo(info, selected, jd, tracks);
        renderNetwork(netEl, jd, net, layer, windows);
      }
      const day = new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);
      const near = nearestEclipse(eclipses, jd);
      dateLabel.textContent = day;
      if (near && Math.abs(near.days) < 0.75) {
        const badge = document.createElement('div');
        badge.className = 'eclipse-badge';
        badge.textContent = `${eclipseLabel(near.eclipse)} (en yüksek an civarı)`;
        dateLabel.appendChild(badge);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
