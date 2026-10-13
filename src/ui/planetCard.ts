import { FACTS } from '../data/bodyFacts';
import type { BodyId } from '../data/types';
import { generateTexture } from '../map/planetTextures';
import { prepareScene, renderFrame, sphereOptionsFor, type SphereScene } from '../map/sphereRender';

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
    if (!this.texCache.has(id)) this.texCache.set(id, generateTexture(id));
    if (!this.sceneCache.has(id)) this.sceneCache.set(id, prepareScene(this.size, sphereOptionsFor(id, FACTS[id].axialTiltDeg)));
    this.tex = this.texCache.get(id)!;
    this.scene = this.sceneCache.get(id)!;
    this.draw();
    this.kick();
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
