import { BODIES, type BodyId, type Track, type Vec3 } from '../data/types';
import { AU_KM, sample } from './ephemeris';

export type ViewMode = '2d' | '3d';

/** Yakınlaştıkça yerel sistemler (Dünya–Ay, Mars çevresi) büyür: ayrıntı görünsün diye. */
export const detailOf = (zoom: number) => Math.min(Math.max(zoom, 1) ** 0.8, 25);
/** Dünya, Ay ve Mars yakınlaştıkça biraz büyür (en çok 4 kat). */
export const localBodyScale = (id: BodyId, zoom: number) =>
  id === 'earth' || id === 'moon' || id === 'mars' ? Math.min(1 + (detailOf(zoom) - 1) * 0.35, 4) : 1;

const MIN_ZOOM = 0.8; // daha fazla uzaklaşınca galaksi/boşluk görünür, bu yüzden sınırlı
const PAN_LIMIT = 0.7; // sahne yarıçapının bu kadarı kadar kaydırılabilir
const MOON_DRAW_PX = 20; // Ay'ın Dünya çevresindeki ÇİZİM yarıçapı (abartılı, gerçek ölçek değil)
const Z_EXAGGERATION = 3; // 3B'de gezegenlerin ekliptik düzlemden sapması 3 kat abartılır (görünsün diye)
const DEFAULT_YAW = -0.55;
const DEFAULT_TILT = 1.0; // rad; 0 = tepeden bakış, π/2 = yandan bakış
const RINGS_AU = [1, 2, 5, 10, 20, 30];

interface Item {
  id: BodyId;
  x: number;
  y: number;
  depth: number;
  k: number;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (c: string, t: number) =>
  `rgb(${hex(c).map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t))).join(',')})`;

export class MapView {
  private ctx: CanvasRenderingContext2D;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private w = 0;
  private h = 0;
  private mode: ViewMode = '2d';
  private yaw = 0;
  private tilt = 0;
  private yaw3d = DEFAULT_YAW;
  private tilt3d = DEFAULT_TILT;
  private stars: [number, number, number][] = [];
  private positions = new Map<BodyId, [number, number, number]>(); // x, y, tıklama yarıçapı
  selected: BodyId = 'earth';
  onSelect: (id: BodyId) => void = () => {};
  dirty = true;
  /** Cisimler çizildikten sonra çağrılır; ekran konumları (x, y, tıklama yarıçapı) verilir. */
  overlay: ((ctx: CanvasRenderingContext2D, screen: Map<BodyId, [number, number, number]>, radii: Map<BodyId, number>, zoom: number) => void) | null = null;
  private radii = new Map<BodyId, number>();

  constructor(private canvas: HTMLCanvasElement, private tracks: Record<string, Track>) {
    this.ctx = canvas.getContext('2d')!;
    // Sabit tohumlu sahte rastgele yıldızlar (her açılışta aynı görünür)
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < 220; i++) this.stars.push([rnd(), rnd(), 0.2 + rnd() * 0.5]);
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  getMode(): ViewMode {
    return this.mode;
  }
  setMode(m: ViewMode) {
    this.mode = m;
    this.dirty = true;
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

  /** Yakınlaştırır; (ax, ay) noktası (varsayılan: görünüm merkezi) ekranda yerinde kalır. */
  zoomBy(f: number, ax = this.w / 2, ay = this.h / 2) {
    const next = Math.min(Math.max(this.zoom * f, MIN_ZOOM), 40);
    const ratio = next / this.zoom;
    const cx = this.w / 2, cy = this.h / 2;
    this.panX = ax - cx - (ax - cx - this.panX) * ratio;
    this.panY = ay - cy - (ay - cy - this.panY) * ratio;
    this.zoom = next;
    this.dirty = true;
  }
  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.yaw3d = DEFAULT_YAW;
    this.tilt3d = DEFAULT_TILT;
    this.dirty = true;
  }

  /** Kamera hedefine doğru yumuşakça ilerler (2B <-> 3B geçişi). */
  private stepCamera() {
    const ty = this.mode === '3d' ? this.yaw3d : 0;
    const tt = this.mode === '3d' ? this.tilt3d : 0;
    this.yaw += (ty - this.yaw) * 0.18;
    this.tilt += (tt - this.tilt) * 0.18;
    if (Math.abs(ty - this.yaw) > 0.001 || Math.abs(tt - this.tilt) > 0.001) this.dirty = true;
    else {
      this.yaw = ty;
      this.tilt = tt;
    }
  }

  /** Sahneyi görünümün dışına kaçıramayız: kaydırma sahne yarıçapıyla sınırlı. */
  private clampPan() {
    const R = this.unit * Math.sqrt(30.5);
    const lim = R * PAN_LIMIT;
    this.panX = Math.min(Math.max(this.panX, -lim), lim);
    this.panY = Math.min(Math.max(this.panY, -lim), lim);
  }

  private get unit() {
    // 3B'de yörüngeler elips olarak yatık göründüğü için biraz büyütülür
    const boost = 1 + 0.55 * Math.min(1, this.tilt / 0.3);
    return ((Math.min(this.w, this.h) / 2 - 24) / Math.sqrt(30.5)) * this.zoom * boost;
  }

  /** Sahne birimine (karekök-AU) sıkıştırır ve kameraya göre döndürür. */
  private rotate(p: Vec3, zScale: number, compress: boolean): [number, number, number] {
    let X = p[0] / AU_KM, Y = p[1] / AU_KM, Z = (p[2] / AU_KM) * zScale;
    if (compress) {
      const r = Math.hypot(X, Y, Z);
      const s = r === 0 ? 0 : Math.sqrt(r) / r;
      X *= s; Y *= s; Z *= s;
    }
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const x1 = X * cy - Y * sy;
    const y1 = X * sy + Y * cy;
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    return [x1, y1 * ct + Z * st, -y1 * st + Z * ct]; // [sağ, yukarı, kameraya doğru]
  }

  private project(p: Vec3, zScale = Z_EXAGGERATION): Item & { id: BodyId } {
    const [rx, ry, dep] = this.rotate(p, zScale, true);
    const q = Math.min(1, this.tilt / 0.3); // 2B'de perspektif yok
    const k = 1 / (1 - (dep * q) / 24);
    const u = this.unit;
    return {
      id: 'sun',
      x: this.w / 2 + this.panX + rx * u * k,
      y: this.h / 2 + this.panY - ry * u * k,
      depth: dep,
      k,
    };
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
      if (!drag.moved) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (this.mode === '3d' && !e.shiftKey) {
        this.yaw3d += dx * 0.006;
        this.tilt3d = Math.min(Math.max(this.tilt3d - dy * 0.006, 0.1), 1.45);
        this.yaw = this.yaw3d;
        this.tilt = this.tilt3d;
      } else {
        this.panX += dx;
        this.panY += dy;
      }
      this.dirty = true;
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.pick(e);
      drag = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
  }

  private pick(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best: BodyId | null = null, bestD = Infinity;
    for (const [id, [px, py, tol]] of this.positions) {
      const d = Math.hypot(px - x, py - y);
      if (d < tol && d < bestD) { bestD = d; best = id; }
    }
    if (best) {
      this.selected = best;
      this.dirty = true;
      this.onSelect(best);
    }
  }

  render(jd: number) {
    const { ctx } = this;
    this.stepCamera();
    this.clampPan();
    ctx.clearRect(0, 0, this.w, this.h);
    this.positions.clear();
    this.radii.clear();
    this.drawStars();

    // 3B'de ekliptik düzlemde başvuru halkaları (2B'ye geçerken solar)
    const ringAlpha = Math.min(1, this.tilt * 3);
    if (ringAlpha > 0.02) {
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = `rgba(120,150,220,${0.16 * ringAlpha})`;
      ctx.lineWidth = 1;
      for (const a of RINGS_AU) {
        ctx.beginPath();
        for (let i = 0; i <= 120; i++) {
          const t = (i / 120) * Math.PI * 2;
          const p = this.project([Math.cos(t) * a * AU_KM, Math.sin(t) * a * AU_KM, 0]);
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Yörünge izi: veri aralığının başından itibaren bir dönem (veri sınırında biter).
    // Yavaş gezegenlerde (Satürn ve ötesi) iz tam daire değil, 2020-2040 yayıdır.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    for (const b of BODIES) {
      if (!b.periodDays || !this.tracks[b.id]) continue;
      const t = this.tracks[b.id];
      const span = Math.min(b.periodDays, (t.count - 1) * t.stepDays);
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const p = this.project(sample(t, t.startJD + (i / 160) * span));
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Cisimleri topla, uzaktan yakına sırala (ressam algoritması)
    const items: Item[] = [{ ...this.project([0, 0, 0]), id: 'sun' }];
    for (const b of BODIES) {
      if (b.id === 'sun' || b.id === 'moon') continue;
      items.push({ ...this.project(sample(this.tracks[b.id], jd)), id: b.id });
    }
    const earth = items.find((i) => i.id === 'earth')!;
    const sunItem = items[0];

    // Ay: Dünya çevresinde, gerçek yönde ama sabit/abartılı uzaklıkta
    const m = sample(this.tracks.moon, jd);
    const mr = Math.hypot(m[0], m[1], m[2]) || 1;
    const [mx, my, mdep] = this.rotate([m[0] / mr, m[1] / mr, m[2] / mr].map((v) => v * AU_KM) as Vec3, 1, false);
    const moonItem: Item = {
      id: 'moon',
      x: earth.x + mx * MOON_DRAW_PX * detailOf(this.zoom) * earth.k,
      y: earth.y - my * MOON_DRAW_PX * detailOf(this.zoom) * earth.k,
      depth: earth.depth + mdep * 0.02,
      k: earth.k,
    };
    items.push(moonItem);
    this.drawMoonOrbit(earth);

    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) this.drawBody(it, sunItem);
    this.overlay?.(ctx, this.positions, this.radii, this.zoom);
  }

  private drawStars() {
    const { ctx } = this;
    const shift = (this.yaw / (Math.PI * 2)) * this.w * 2;
    for (const [sx, sy, a] of this.stars) {
      const x = (((sx * this.w + shift) % this.w) + this.w) % this.w;
      ctx.fillStyle = `rgba(255,255,255,${a * (0.35 + Math.min(1, this.tilt * 2) * 0.65)})`;
      ctx.fillRect(x, sy * this.h, 1.3, 1.3);
    }
  }

  private drawMoonOrbit(earth: Item) {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      const [x, y] = this.rotate([Math.cos(t) * AU_KM, Math.sin(t) * AU_KM, 0], 1, false);
      const px = earth.x + x * MOON_DRAW_PX * detailOf(this.zoom) * earth.k;
      const py = earth.y - y * MOON_DRAW_PX * detailOf(this.zoom) * earth.k;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  private drawBody(it: Item, sun: Item) {
    const { ctx } = this;
    const b = BODIES.find((q) => q.id === it.id)!;
    const r = b.radiusPx * localBodyScale(it.id, this.zoom) * (this.tilt > 0.05 ? it.k : 1);
    this.radii.set(it.id, r);
    this.positions.set(it.id, [it.x, it.y, Math.max(16, r + 8)]);

    if (it.id === 'sun') {
      const g = ctx.createRadialGradient(it.x, it.y, 0, it.x, it.y, r * 4);
      g.addColorStop(0, 'rgba(255,220,100,0.55)');
      g.addColorStop(0.35, 'rgba(255,170,50,0.18)');
      g.addColorStop(1, 'rgba(255,170,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(it.x, it.y, r * 4, 0, Math.PI * 2); ctx.fill();
    }

    const ringA = Math.min(1, this.tilt * 3);
    const drawRing = (front: boolean) => {
      if (it.id !== 'saturn' || ringA < 0.05) return;
      ctx.strokeStyle = `rgba(227,207,154,${0.7 * ringA})`;
      ctx.lineWidth = Math.max(1.5, r * 0.3);
      ctx.beginPath();
      ctx.ellipse(it.x, it.y, r * 2.1, Math.max(0.8, r * 2.1 * Math.cos(this.tilt)), 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      ctx.stroke();
    };
    drawRing(false);

    // Işığı Güneş'ten alan küre gölgesi
    if (it.id === 'sun') {
      ctx.fillStyle = b.color;
    } else {
      const dx = sun.x - it.x, dy = sun.y - it.y;
      const len = Math.hypot(dx, dy) || 1;
      const g = ctx.createRadialGradient(it.x + (dx / len) * r * 0.45, it.y + (dy / len) * r * 0.45, r * 0.1, it.x, it.y, r * 1.05);
      g.addColorStop(0, mix(b.color, 0.35));
      g.addColorStop(0.6, b.color);
      g.addColorStop(1, mix(b.color, -0.6));
      ctx.fillStyle = g;
    }
    ctx.beginPath(); ctx.arc(it.x, it.y, r, 0, Math.PI * 2); ctx.fill();
    drawRing(true);

    if (it.id === this.selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(it.x, it.y, r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(b.name, it.x + r + 6, it.y + 4);
  }
}
