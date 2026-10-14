import { FACTS } from '../data/bodyFacts';
import { BODIES, type BodyId } from '../data/types';
import { TEX_H, TEX_W, generateTextureRows } from '../map/planetTextures';
import { prepareScene, renderFrame, sphereOptionsFor, type SphereScene } from '../map/sphereRender';

const TEX_ROWS = 16; // doku üretim parçası (satır); earth için parça başına ≈ 8 ms
const FRAME_MS = 1000 / 30; // kart en çok 30 kare/sn çizer (ana harita döngüsünden bağımsız ve hafif)

/** Seçili cisim için dönen, ışıklandırılmış küre kartı (küçük canvas). Doku ve geometri cisim başına bir kez hazırlanır. */
export class PlanetCard {
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private id: BodyId | null = null;
  private scene: SphereScene | null = null;
  private tex: Uint8ClampedArray | null = null;
  private img: ImageData;
  private spin = 0; // tur
  private raf = 0;
  private last = 0;
  private active = true;
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private texCache = new Map<BodyId, Uint8ClampedArray>();
  private sceneCache = new Map<BodyId, SphereScene>();
  private building = new Set<BodyId>();
  /** Çizilen kare sayısı (performans ölçümü için). */
  frames = 0;

  constructor(private canvas: HTMLCanvasElement, cssSize: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = Math.round(cssSize * dpr);
    canvas.width = canvas.height = this.size;
    canvas.style.width = canvas.style.height = `${cssSize}px`;
    this.ctx = canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(this.size, this.size);
    document.addEventListener('visibilitychange', () => this.kick());
  }

  setBody(id: BodyId) {
    if (this.id === id) return;
    this.id = id;
    if (!this.sceneCache.has(id)) this.sceneCache.set(id, prepareScene(this.size, sphereOptionsFor(id, FACTS[id].axialTiltDeg)));
    this.scene = this.sceneCache.get(id)!;
    const cached = this.texCache.get(id);
    if (cached) this.tex = cached;
    else {
      // Doku (earth ≈ 60 ms) ana iş parçacığını uzun tutmasın: önce düz renkli bir yer tutucu çizilir, doku satır parçalarıyla ayrı görevlerde üretilir ve bitince yerine geçer.
      this.tex = this.placeholder(id);
      void this.buildTexture(id);
    }
    this.draw();
    this.kick();
  }

  private placeholder(id: BodyId): Uint8ClampedArray {
    const hex = BODIES.find((b) => b.id === id)!.color.replace('#', '');
    const t = new Uint8ClampedArray(TEX_W * TEX_H * 3);
    const rgb = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16) || 128);
    for (let i = 0; i < t.length; i += 3) { t[i] = rgb[0]; t[i + 1] = rgb[1]; t[i + 2] = rgb[2]; }
    return t;
  }

  /** TEX_ROWS satırlık parçalarla, her parça ayrı makro görevde (setTimeout) üretilir. */
  private async buildTexture(id: BodyId) {
    if (this.building.has(id)) return;
    this.building.add(id);
    const out = new Uint8ClampedArray(TEX_W * TEX_H * 3);
    for (let j = 0; j < TEX_H; j += TEX_ROWS) {
      generateTextureRows(id, TEX_W, TEX_H, j, Math.min(TEX_H, j + TEX_ROWS), out);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    this.building.delete(id);
    this.texCache.set(id, out);
    if (this.id === id) { this.tex = out; this.draw(); }
  }

  /** Harita sekmesi dışında (çizelgeleyici) kart durur. */
  setActive(a: boolean) {
    this.active = a;
    this.kick();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw() {
    if (!this.scene || !this.tex) return;
    renderFrame(this.scene, this.tex, this.spin, this.img.data);
    this.ctx.putImageData(this.img, 0, 0);
    this.frames++;
  }

  private kick() {
    if (this.raf || !this.active || document.hidden || this.reduced || !this.canvas.isConnected) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.active || document.hidden || !this.canvas.isConnected) return; // durur; kick() yeniden başlatır
    if (now - this.last >= FRAME_MS - 3) {
      // Dönme hızı üsluptur: gerçek dönme periyodunun kareköküyle ölçeklenir, ~20–80 sn/tur.
      const hours = Math.abs(FACTS[this.id!].rotationDays) * 24;
      const rate = 0.025 * Math.min(Math.max(Math.sqrt(24 / hours), 0.5), 2);
      this.spin += ((now - this.last) / 1000) * rate;
      this.last = now;
      this.draw();
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
