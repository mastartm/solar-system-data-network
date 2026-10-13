import { HYPOTHETICAL, HYPOTHETICAL_LABEL } from '../config/hypothetical';
import type { NetworkLayer } from '../map/networkLayer';
import { jdToDate } from '../map/ephemeris';
import type { BlackoutWindow, LinkState, NetworkState } from '../network/network';

const fmt = (n: number, d = 0) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (jd: number) => jdToDate(jd).toISOString().slice(0, 10);

const delayText = (sec: number) => (sec < 120 ? `${fmt(sec, 2)} sn` : `${fmt(sec / 60, 1)} dk`);
const why: Record<LinkState, string> = {
  up: 'açık',
  horizon: 'uydu ufkun altında',
  occulted: 'Dünya cismin arkasında kaldı',
  blackout: 'Mars kavuşumu: kesinti',
  nostation: 'hiçbir yer istasyonu uyduyu görmüyor',
};

export function renderNetwork(el: HTMLElement, jd: number, net: NetworkState, layer: NetworkLayer, windows: BlackoutWindow[]) {
  const rows = net.statuses
    .map((s) => {
      const b = layer.buffered(s.asset.id);
      const state = s.connected ? '<b class="ok">bağlı</b>' : `<b class="bad">kesik</b> <small>(${s.surfaceLink !== 'up' ? why[s.surfaceLink] : why[s.earthLink]})</small>`;
      return `<div class="asset"><div><span class="dot" style="background:${s.asset.color}"></span>${s.asset.name} ${state}</div>
        <small>${fmt(s.asset.dataRateKbps)} kbit/sn · tek yön gecikme ${delayText(s.delaySec)} · araç→uydu ${fmt(s.surfaceKm)} km · uydu→Dünya ${fmt(s.earthKm)} km · bekleyen paket: ${b.atAsset + b.atRelay} · ulaşan: ${layer.delivered.get(s.asset.id) ?? 0}${net.stationCount ? ` · yer istasyonu: ${s.station ? `${s.station.name.split(' (')[0]} (${fmt(s.station.elevDeg)}°)` : 'görüş yok'}` : ''}</small></div>`;
    })
    .join('');
  const next = windows.find((w) => w.endJD >= jd);
  const win = next
    ? `<p class="hint">${net.marsBlackout ? 'Şu an kesinti penceresinde.' : 'Sonraki kesinti:'} ${day(next.startJD)} – ${day(next.endJD)} (en küçük açı ${fmt(next.minSepDeg, 2)}°)</p>`
    : '<p class="hint">Veri aralığında başka kesinti penceresi yok.</p>';
  el.innerHTML = `<h3>Veri ağı <span class="badge-hyp">${HYPOTHETICAL_LABEL}</span></h3>
    <p class="hint">Araçlar, uydular, veri hızları ve ${HYPOTHETICAL.conjunctionBlackoutAngleDeg}° kesinti eşiği uydurmadır; gerçek bir görev değildir. Gerçek olan: Horizons konumları ve ışık hızı.</p>
    <dl><dt>Güneş–Mars açısı (Dünya'dan)</dt><dd>${fmt(net.marsSepDeg, 1)}° ${net.marsBlackout ? '<b class="bad">kesinti</b>' : ''}</dd></dl>
    ${win}${rows}
    <p class="hint">Paket animasyonu üsluptur (ölçekli değil); gerçek gecikme yukarıdaki sayıdır. Tarih ilerledikçe hareket eder.</p>`;
}
