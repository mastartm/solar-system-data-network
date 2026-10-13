import { BODIES, type BodyId, type Track, type Vec3 } from '../data/types';
import { AU_KM, sample } from './ephemeris';

const MOON_DRAW_PX = 20; // Ay'ın Dünya çevresindeki ÇİZİM yarıçapı (abartılı, gerçek ölçek değil)

export class MapView {
  private ctx: CanvasRenderingContext2D;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private w = 0;
  private h = 0;
  private positions = new Map<BodyId, [number, number]>(); // ekran koordinatları
  selected: BodyId = 'earth';
  onSelect: (id: BodyId) => void = () => {};

  constructor(private canvas: HTMLCanvasElement, private tracks: Record<string, Track>) {
    this.ctx = canvas.getContext('2d')!;
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Sıkıştırılmış ölçek: ekran yarıçapı ~ sqrt(AU). Açı gerçek kalır. */
  private project(p: Vec3): [number, number] {
    const rAU = Math.hypot(p[0], p[1]) / AU_KM;
    const s = rAU === 0 ? 0 : Math.sqrt(rAU) / rAU;
    const unit = (Math.min(this.w, this.h) / 2 - 24) / Math.sqrt(30.5) * this.zoom;
    return [this.w / 2 + this.panX + (p[0] / AU_KM) * s * unit, this.h / 2 + this.panY - (p[1] / AU_KM) * s * unit];
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  dirty = true;
  zoomBy(f: number) {
    this.zoom = Math.min(Math.max(this.zoom * f, 0.5), 40);
    this.dirty = true;
  }
  resetView() {
    this.zoom = 1; this.panX = 0; this.panY = 0; this.dirty = true;
  }

  private bindInput() {
    const c = this.canvas;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        this.panX += dx; this.panY += dy;
        drag.x = e.clientX; drag.y = e.clientY;
        this.dirty = true;
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.pick(e);
      drag = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
  }

  private pick(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best: BodyId | null = null, bestD = 16;
    for (const [id, [px, py]] of this.positions) {
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best) { this.selected = best; this.dirty = true; this.onSelect(best); }
  }

  render(jd: number) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    this.positions.clear();

    const sun = this.project([0, 0, 0]);

    // Yörünge izi: veri aralığının başından itibaren bir dönem (veri sınırında biter).
    // Yavaş gezegenlerde (Satürn ve ötesi) iz tam daire değil, 2020-2040 yayıdır.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    for (const b of BODIES) {
      if (!b.periodDays || !this.tracks[b.id]) continue;
      const t = this.tracks[b.id];
      const span = Math.min(b.periodDays, (t.count - 1) * t.stepDays);
      const n = 160;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const [x, y] = this.project(sample(t, t.startJD + (i / n) * span));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Güneş
    this.drawBody('sun', sun);

    // Gezegenler
    const screen: Partial<Record<BodyId, [number, number]>> = {};
    for (const b of BODIES) {
      if (b.id === 'sun' || b.id === 'moon') continue;
      const s = this.project(sample(this.tracks[b.id], jd));
      screen[b.id] = s;
      this.drawBody(b.id, s);
    }

    // Ay: Dünya çevresinde, gerçek yönde ama sabit/abartılı uzaklıkta
    const e = screen.earth!;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(e[0], e[1], MOON_DRAW_PX, 0, Math.PI * 2); ctx.stroke();
    const m = sample(this.tracks.moon, jd);
    const mr = Math.hypot(m[0], m[1]) || 1;
    this.drawBody('moon', [e[0] + (m[0] / mr) * MOON_DRAW_PX, e[1] - (m[1] / mr) * MOON_DRAW_PX]);
  }

  private drawBody(id: BodyId, [x, y]: [number, number]) {
    const { ctx } = this;
    const b = BODIES.find((q) => q.id === id)!;
    this.positions.set(id, [x, y]);
    if (id === 'sun') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, b.radiusPx * 3);
      g.addColorStop(0, 'rgba(255,210,74,0.5)'); g.addColorStop(1, 'rgba(255,210,74,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, b.radiusPx * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(x, y, b.radiusPx, 0, Math.PI * 2); ctx.fill();
    if (id === this.selected) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, b.radiusPx + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(b.name, x + b.radiusPx + 6, y + 4);
  }
}
