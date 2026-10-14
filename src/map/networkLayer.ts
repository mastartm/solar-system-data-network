import { HYPOTHETICAL } from '../config/hypothetical';
import { t } from '../i18n';
import type { BodyId } from '../data/types';
import type { LayerState } from '../ui/layers';
import { detailOf } from './MapView';
import { LabelPriority, type LabelSink } from './labels';
import type { LinkState, NetworkState } from '../network/network';

type Screen = Map<BodyId, [number, number, number]>;
interface Packet { assetId: string; leg: 0 | 1; t: number }
interface Pt { x: number; y: number }

const RELAY_RADIUS_FACTOR = 3.2; // aktarma uydusu halkası = cisim yarıçapı × bu

/** Araç → aktarma uydusu → Dünya veri akışı katmanı. Paket hareketi üsluptur (ölçekli değil). */
export class NetworkLayer {
  private packets: Packet[] = [];
  private spawn = new Map<string, number>();
  delivered = new Map<string, number>();

  /** Paketleri duvar saati süresiyle ilerletir. Bağlantı yoksa paket olduğu düğümde bekler (tamponlanır). */
  step(dt: number, net: NetworkState) {
    const a = HYPOTHETICAL.animation;
    for (const s of net.statuses) {
      const id = s.asset.id;
      const queued = this.packets.filter((p) => p.assetId === id).length;
      const timer = (this.spawn.get(id) ?? 0) - dt;
      if (timer <= 0 && queued < a.maxPacketsPerAsset) {
        this.packets.push({ assetId: id, leg: 0, t: 0 });
        this.spawn.set(id, Math.max(0.3, a.spawnSecondsAt100Kbps * Math.sqrt(100 / s.asset.dataRateKbps)));
      } else this.spawn.set(id, timer);

      const mine = this.packets.filter((p) => p.assetId === id);
      for (const p of mine) {
        if (p.leg === 0) {
          if (s.surfaceLink === 'up') p.t += dt / a.legSeconds[0];
          if (p.t >= 1) { p.leg = 1; p.t = 0; }
        } else if (s.earthLink === 'up') {
          p.t += dt / a.legSeconds[1];
          if (p.t >= 1) {
            this.delivered.set(id, (this.delivered.get(id) ?? 0) + 1);
            p.t = 2;
          }
        }
      }
    }
    this.packets = this.packets.filter((p) => p.t <= 1);
  }

  /** Tamponda bekleyen paket sayısı (araçta / aktarma uydusunda). */
  buffered(assetId: string) {
    const mine = this.packets.filter((p) => p.assetId === assetId);
    return { atAsset: mine.filter((p) => p.leg === 0).length, atRelay: mine.filter((p) => p.leg === 1).length };
  }

  /** Ağ katmanını çizer. Etiketler doğrudan çizilmez: `labels` toplayıcısına istek olarak verilir (MapView yerleştirir). */
  draw(ctx: CanvasRenderingContext2D, scr: Screen, radii: Map<BodyId, number>, zoom: number, net: NetworkState, labels: LabelSink, layers: LayerState) {
    const detail = detailOf(zoom);
    const rb = (id: 'moon' | 'mars') => radii.get(id) ?? 3;
    const earth = scr.get('earth');
    if (!earth) return;
    const e: Pt = { x: earth[0], y: earth[1] };
    const asset = new Map<string, Pt>();
    const relay = new Map<string, Pt>();

    for (const r of HYPOTHETICAL.relays) {
      const b = scr.get(r.body);
      if (!b) continue;
      const ph = net.relayPhase[r.id];
      relay.set(r.id, { x: b[0] + Math.cos(ph) * rb(r.body) * RELAY_RADIUS_FACTOR, y: b[1] - Math.sin(ph) * rb(r.body) * RELAY_RADIUS_FACTOR });
      ctx.strokeStyle = 'rgba(180,200,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(b[0], b[1], rb(r.body) * RELAY_RADIUS_FACTOR, 0, Math.PI * 2); ctx.stroke();
    }
    HYPOTHETICAL.assets.forEach((a, i) => {
      const b = scr.get(a.body);
      if (!b) return;
      const n = HYPOTHETICAL.assets.filter((q) => q.body === a.body);
      const k = n.indexOf(a);
      const ang = -Math.PI / 2 + (k / n.length) * Math.PI * 2 + i * 0.01;
      asset.set(a.id, { x: b[0] + Math.cos(ang) * rb(a.body), y: b[1] + Math.sin(ang) * rb(a.body) });
    });

    const lineColor = (s: LinkState) => (s === 'up' ? 'rgba(90,220,255,0.75)' : s === 'blackout' ? 'rgba(255,70,70,0.9)' : s === 'occulted' ? 'rgba(255,190,60,0.8)' : 'rgba(150,150,150,0.6)');
    const line = (a: Pt, b: Pt, s: LinkState) => {
      ctx.strokeStyle = lineColor(s);
      ctx.lineWidth = s === 'up' ? 1.4 : 1;
      ctx.setLineDash(s === 'up' ? [] : [4, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    };

    const drawnRelayLink = new Set<string>();
    for (const s of net.statuses) {
      const a = asset.get(s.asset.id), r = relay.get(s.relay.id);
      if (!a || !r) continue;
      line(a, r, s.surfaceLink);
      if (!drawnRelayLink.has(s.relay.id)) {
        line(r, e, s.earthLink);
        drawnRelayLink.add(s.relay.id);
      }
    }

    // paketler (veri akışı katmanı)
    const stalled = new Map<string, number>();
    for (const p of layers.flow ? this.packets : []) {
      const st = net.statuses.find((s) => s.asset.id === p.assetId);
      const a = asset.get(p.assetId);
      const r = st && relay.get(st.relay.id);
      if (!st || !a || !r) continue;
      const from = p.leg === 0 ? a : r, to = p.leg === 0 ? r : e;
      const key = `${p.assetId}:${p.leg}`;
      const waiting = p.t === 0 && (p.leg === 0 ? st.surfaceLink !== 'up' : st.earthLink !== 'up');
      let x = from.x + (to.x - from.x) * p.t, y = from.y + (to.y - from.y) * p.t;
      if (waiting) {
        const n = stalled.get(key) ?? 0;
        stalled.set(key, n + 1);
        x += (n % 4) * 2.2 - 3;
        y += Math.floor(n / 4) * 2.2 - 3;
      }
      ctx.fillStyle = waiting ? 'rgba(255,255,255,0.5)' : st.asset.color;
      ctx.beginPath(); ctx.arc(x, y, waiting ? 1.3 : 2, 0, Math.PI * 2); ctx.fill();
    }

    // işaretler
    for (const a of HYPOTHETICAL.assets) {
      const p = asset.get(a.id);
      if (!p) continue;
      ctx.fillStyle = a.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    for (const r of HYPOTHETICAL.relays) {
      const p = relay.get(r.id);
      if (!p) continue;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 4, p.y); ctx.lineTo(p.x, p.y + 4); ctx.lineTo(p.x - 4, p.y);
      ctx.closePath(); ctx.stroke();
    }

    // Çizilen işaretler etiketlere engeldir (kendi etiketi hariç).
    for (const a of HYPOTHETICAL.assets) { const p = asset.get(a.id); if (p) labels.obstacle(p.x, p.y, 4, `asset:${a.id}`); }
    for (const r of HYPOTHETICAL.relays) { const p = relay.get(r.id); if (p) labels.obstacle(p.x, p.y, 6, `relay:${r.id}`); }

    // yakınlaşınca ayrıntı: adlar ve tek yön gecikme (ağ etiketleri katmanı)
    if (layers.netLabels) {
      if (detail > 2.5) {
        for (const a of HYPOTHETICAL.assets) {
          const p = asset.get(a.id), b = scr.get(a.body);
          if (p) labels.label({ id: `asset:${a.id}`, text: a.name, ax: p.x, ay: p.y, radius: 4, priority: LabelPriority.asset, cx: b?.[0], cy: b?.[1], color: 'rgba(255,255,255,0.8)' });
        }
        for (const r of HYPOTHETICAL.relays) {
          const p = relay.get(r.id), b = scr.get(r.body);
          if (p) labels.label({ id: `relay:${r.id}`, text: r.name, ax: p.x, ay: p.y, radius: 6, priority: LabelPriority.relay, cx: b?.[0], cy: b?.[1], color: 'rgba(255,255,255,0.85)' });
        }
      }
      if (detail > 1.5) {
        const done = new Set<string>();
        for (const s of net.statuses) {
          const r = relay.get(s.relay.id);
          if (!r || done.has(s.relay.id)) continue;
          done.add(s.relay.id);
          const sec = s.earthKm / 299792.458;
          labels.label({
            id: `delay:${s.relay.id}`, text: sec < 120 ? t('{n} sn', { n: sec.toFixed(2) }) : t('{n} dk', { n: (sec / 60).toFixed(1) }),
            ax: (r.x + e.x) / 2, ay: (r.y + e.y) / 2, radius: 1, priority: LabelPriority.delay, cx: e.x, cy: e.y, color: 'rgba(160,230,255,0.9)',
          });
        }
      }
    }

    // kavuşum uyarısı
    if (net.marsBlackout) {
      const m = scr.get('mars');
      if (m) labels.label({ id: 'alert:mars-blackout', text: t('Mars kavuşumu: iletişim kesintisi'), ax: m[0], ay: m[1], radius: (radii.get('mars') ?? 4) + 2, priority: LabelPriority.planet, cx: scr.get('sun')?.[0], cy: scr.get('sun')?.[1], color: 'rgba(255,90,90,0.95)', font: '12px system-ui, sans-serif' });
    }
  }
}
