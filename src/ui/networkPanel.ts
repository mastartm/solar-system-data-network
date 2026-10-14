import { HYPOTHETICAL, HYPOTHETICAL_LABEL } from '../config/hypothetical';
import type { NetworkLayer } from '../map/networkLayer';
import { jdToDate } from '../map/ephemeris';
import type { BlackoutWindow, LinkState, NetworkState } from '../network/network';
import { nf as fmt, t } from '../i18n';
const day = (jd: number) => jdToDate(jd).toISOString().slice(0, 10);

const delayText = (sec: number) => (sec < 120 ? t('{n} sn', { n: fmt(sec, 2) }) : t('{n} dk', { n: fmt(sec / 60, 1) }));
const why: Record<LinkState, string> = {
  up: t('açık'),
  horizon: t('uydu ufkun altında'),
  occulted: t('Dünya cismin arkasında kaldı'),
  blackout: t('Mars kavuşumu: kesinti'),
  nostation: t('hiçbir yer istasyonu uyduyu görmüyor'),
  eclipse: t('uydu Mars gölgesinde (varsayımsal kesinti)'),
};

export function renderNetwork(el: HTMLElement, jd: number, net: NetworkState, layer: NetworkLayer, windows: BlackoutWindow[]) {
  const rows = net.statuses
    .map((s) => {
      const b = layer.buffered(s.asset.id);
      const state = s.connected ? `<b class="ok">${t('bağlı')}</b>` : `<b class="bad">${t('kesik')}</b> <small>(${s.surfaceLink !== 'up' ? why[s.surfaceLink] : why[s.earthLink]})</small>`;
      return `<div class="asset"><div><span class="dot" style="background:${s.asset.color}"></span>${s.asset.name} ${state}</div>
        <small>${t('{hiz} kbit/sn · tek yön gecikme {gecikme} · araç→uydu {yuzey} km · uydu→Dünya {dunya} km · bekleyen paket: {bekleyen} · ulaşan: {ulasan}', { hiz: fmt(s.asset.dataRateKbps), gecikme: delayText(s.delaySec), yuzey: fmt(s.surfaceKm), dunya: fmt(s.earthKm), bekleyen: b.atAsset + b.atRelay, ulasan: layer.delivered.get(s.asset.id) ?? 0 })}${net.stationCount ? ` · ${t('yer istasyonu:')} ${s.station ? `${s.station.name.split(' (')[0]} (${fmt(s.station.elevDeg)}°)` : t('görüş yok')}` : ''}</small></div>`;
    })
    .join('');
  const next = windows.find((w) => w.endJD >= jd);
  const win = next
    ? `<p class="hint">${net.marsBlackout ? t('Şu an kesinti penceresinde.') : t('Sonraki kesinti:')} ${day(next.startJD)} – ${day(next.endJD)} ${t('(en küçük açı {aci}°)', { aci: fmt(next.minSepDeg, 2) })}</p>`
    : `<p class="hint">${t('Veri aralığında başka kesinti penceresi yok.')}</p>`;
  el.innerHTML = `<h3>${t('Veri ağı')} <span class="badge-hyp">${HYPOTHETICAL_LABEL}</span></h3>
    <p class="hint">${t('Araçlar, uydular, veri hızları ve {aci}° kesinti eşiği uydurmadır; gerçek bir görev değildir. Gerçek olan: Horizons konumları ve ışık hızı.', { aci: HYPOTHETICAL.conjunctionBlackoutAngleDeg })}</p>
    <dl><dt>${t('Güneş–Mars açısı (Dünya\'dan)')}</dt><dd>${fmt(net.marsSepDeg, 1)}° ${net.marsBlackout ? `<b class="bad">${t('kesinti')}</b>` : ''}</dd></dl>
    ${win}${rows}
    <p class="hint">${t('Paket animasyonu üsluptur (ölçekli değil); gerçek gecikme yukarıdaki sayıdır. Tarih ilerledikçe hareket eder.')}</p>`;
}
