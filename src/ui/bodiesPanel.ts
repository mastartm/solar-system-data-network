import { HYPOTHETICAL, HYPOTHETICAL_LABEL } from '../config/hypothetical';
import { BODIES, type BodyId } from '../data/types';
import type { LinkState, NetworkState } from '../network/network';
import { LAYER_META, type LayerState } from './layers';
import { nf as fmt, t } from '../i18n';
const signed = (n: number) => `${n < 0 ? '−' : ''}${fmt(Math.abs(n), Math.abs(n) % 1 ? 1 : 0)}°`;

const WHY: Record<LinkState, string> = {
  up: t('açık'),
  horizon: t('uydu ufkun altında'),
  occulted: t('Dünya cismin arkasında'),
  blackout: t('Mars kavuşumu: kesinti'),
  nostation: t('hiçbir yer istasyonu uyduyu görmüyor'),
  eclipse: t('uydu Mars gölgesinde (varsayımsal kesinti)'),
};

/** Cisim başına varsayımsal sayılar: hepsi config/hypothetical.ts'ten türetilir. */
export function countsFor(id: BodyId) {
  return {
    relays: HYPOTHETICAL.relays.filter((r) => r.body === id).length,
    assets: HYPOTHETICAL.assets.filter((a) => a.body === id).length,
    stations: id === 'earth' ? HYPOTHETICAL.groundStations.stations.length : 0,
  };
}

/** Listede gösterim sırası: Güneş, gezegenler, Ay Dünya'nın altında (girintili). */
export const ORDER: BodyId[] = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

export interface BodiesPanel {
  setSelected(id: BodyId): void;
  /** Yalnızca durum metinlerini günceller; DOM yeniden kurulmaz. */
  update(net: NetworkState): void;
  setLayers(l: LayerState): void;
}

export interface BodiesPanelOptions {
  onSelect: (id: BodyId) => void;
  onLayer: (key: keyof LayerState, on: boolean) => void;
  layers: LayerState;
  /** Dar ekranda başlangıçta katlı mı? */
  collapsed: boolean;
}

/** Sol panel: katmanlar + "Cisimler" listesi. Satır tıklanınca cisim seçilir ve satır açılıp ayrıntı gösterir. */
export function createBodiesPanel(root: HTMLElement, o: BodiesPanelOptions): BodiesPanel {
  const live = new Map<string, HTMLElement>();
  const rows = new Map<BodyId, { btn: HTMLButtonElement; det: HTMLElement }>();
  let selected: BodyId | null = null;
  let collapsedRow = false; // seçili satırı kullanıcı kapattı mı

  root.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'lp-head';
  head.innerHTML = `<h2>${t('Cisimler')}</h2><span class="badge-hyp">${HYPOTHETICAL_LABEL}</span>
    <button type="button" class="lp-toggle" aria-expanded="${!o.collapsed}" aria-controls="lp-body" title="${t('Paneli aç/kapat')}">${o.collapsed ? '▸' : '▾'}</button>`;
  const body = document.createElement('div');
  body.id = 'lp-body';
  body.hidden = o.collapsed;
  root.append(head, body);
  const toggle = head.querySelector('.lp-toggle') as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.textContent = body.hidden ? '▸' : '▾';
  });

  // Katmanlar
  const layerBox = document.createElement('fieldset');
  layerBox.className = 'layers';
  layerBox.innerHTML = `<legend>${t('Katmanlar')}</legend>`;
  const inputs = new Map<keyof LayerState, HTMLInputElement>();
  for (const m of LAYER_META) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-layer="${m.key}"><span>${m.label}</span>`;
    const input = label.querySelector('input')!;
    input.checked = o.layers[m.key];
    input.addEventListener('change', () => o.onLayer(m.key, input.checked));
    inputs.set(m.key, input);
    layerBox.appendChild(label);
  }
  body.appendChild(layerBox);

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = t('Uydu, araç ve yer istasyonu sayıları varsayımsaldır (gerçek bir görev değildir). Satıra tıklayınca cisim seçilir.');
  body.appendChild(note);

  const list = document.createElement('div');
  list.className = 'blist';
  body.appendChild(list);

  for (const id of ORDER) {
    const b = BODIES.find((q) => q.id === id)!;
    const c = countsFor(id);
    const wrap = document.createElement('div');
    wrap.className = `bitem${id === 'moon' ? ' sub' : ''}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'brow';
    btn.dataset.body = id;
    btn.setAttribute('aria-expanded', 'false');
    const cnt = (n: number, label: string, title: string) => `<span class="cnt${n ? '' : ' zero'}" title="${title}">${label} ${n}</span>`;
    btn.innerHTML = `<span class="dot" style="background:${b.color}"></span><span class="bname">${b.name}</span>
      <span class="cnts">${cnt(c.relays, t('Uydu'), t('Aktarma uydusu sayısı (varsayımsal)'))}${cnt(c.assets, t('Araç'), t('Yüzey aracı sayısı (varsayımsal)'))}${id === 'earth' ? cnt(c.stations, t('İst.'), t('Yer istasyonu sayısı (varsayımsal)')) : ''}</span>`;
    const det = document.createElement('div');
    det.className = 'bdet';
    det.hidden = true;
    det.innerHTML = detailHtml(id);
    for (const e of det.querySelectorAll<HTMLElement>('[data-live]')) live.set(e.dataset.live!, e);
    btn.addEventListener('click', () => {
      if (selected === id) { collapsedRow = !collapsedRow; refresh(); return; } // seçili satıra tekrar tıklayınca açılır/kapanır
      collapsedRow = false;
      o.onSelect(id); // dış seçim setSelected'ı çağırır
    });
    wrap.append(btn, det);
    list.appendChild(wrap);
    rows.set(id, { btn, det });
  }

  function refresh() {
    for (const [id, r] of rows) {
      const sel = id === selected;
      const open = sel && !collapsedRow;
      r.btn.classList.toggle('sel', sel);
      r.btn.setAttribute('aria-expanded', String(open));
      r.btn.setAttribute('aria-current', String(sel));
      r.det.hidden = !open;
    }
  }

  const setLive = (key: string, text: string, cls?: 'ok' | 'bad' | '') => {
    const e = live.get(key);
    if (!e) return;
    if (e.textContent !== text) e.textContent = text;
    if (cls !== undefined) { const want = cls; if (e.className !== want) e.className = want; }
  };

  return {
    setSelected(id) {
      if (id !== selected) collapsedRow = false;
      selected = id;
      refresh();
      rows.get(id)?.btn.scrollIntoView?.({ block: 'nearest' });
    },
    setLayers(l) {
      for (const m of LAYER_META) {
        const i = inputs.get(m.key)!;
        if (i.checked !== l[m.key]) i.checked = l[m.key];
        i.disabled = !!m.needsNetwork && !l.network;
        i.parentElement!.classList.toggle('dim', i.disabled);
        i.parentElement!.title = i.disabled ? t('Ağ katmanı kapalı olduğu için çizilmez') : '';
      }
    },
    update(net) {
      for (const r of HYPOTHETICAL.relays) {
        const s = net.statuses.find((q) => q.relay.id === r.id);
        if (!s) continue;
        setLive(`relay:${r.id}:link`, s.earthLink === 'up' ? t('açık') : t('kapalı ({neden})', { neden: WHY[s.earthLink] }), s.earthLink === 'up' ? 'ok' : 'bad');
        setLive(`relay:${r.id}:station`, !net.stationCount ? t('yer istasyonu modeli kapalı') : s.station ? `${s.station.name.split(' (')[0]} (${fmt(s.station.elevDeg)}°)` : t('görüş yok'), '');
      }
      for (const s of net.statuses) {
        setLive(`asset:${s.asset.id}:link`, s.connected ? t('bağlı') : t('kesik ({neden})', { neden: s.surfaceLink !== 'up' ? WHY[s.surfaceLink] : WHY[s.earthLink] }), s.connected ? 'ok' : 'bad');
      }
    },
  };
}

function detailHtml(id: BodyId): string {
  const relays = HYPOTHETICAL.relays.filter((r) => r.body === id);
  const assets = HYPOTHETICAL.assets.filter((a) => a.body === id);
  const parts: string[] = [];
  if (relays.length) {
    parts.push(...relays.map((r) => `<div class="ditem"><b>${r.name}</b><small>${t('yükseklik {km} km (varsayımsal)', { km: fmt(r.altitudeKm) })}</small>
      <small>${t('Dünya hattı:')} <span data-live="relay:${r.id}:link">…</span></small>
      <small>${t('Görünen yer istasyonu:')} <span data-live="relay:${r.id}:station">…</span></small></div>`));
  }
  if (assets.length) {
    parts.push(...assets.map((a) => `<div class="ditem"><b><span class="sq" style="background:${a.color}"></span>${a.name}</b>
      <small>${t('enlem {enlem} · boylam {boylam} · {hiz} kbit/sn (varsayımsal)', { enlem: signed(a.latDeg), boylam: signed(a.lonDeg), hiz: fmt(a.dataRateKbps) })}</small>
      <small>${t('Bağlantı:')} <span data-live="asset:${a.id}:link">…</span></small></div>`));
  }
  if (id === 'earth') {
    parts.push(...HYPOTHETICAL.groundStations.stations.map((g) => `<div class="ditem"><b>${g.name}</b><small>${t('enlem {enlem} · boylam {boylam} (varsayımsal)', { enlem: signed(g.latDeg), boylam: signed(g.lonDeg) })}</small></div>`));
  }
  if (!parts.length) parts.push(`<div class="ditem"><small>${t('Bu cisimde varsayımsal uydu, araç ya da istasyon yok.')}</small></div>`);
  return parts.join('');
}
