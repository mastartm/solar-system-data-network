// Hesap havuzu (istemci tarafı): işleri bir Web Worker havuzuna dağıtır, iptal belirteci (nesil) ile bekleyen ve sürmekte olan işleri geçersiz kılar.
// Aktarım (Transport) soyutlanmıştır: tarayıcıda gerçek Worker'lar, testte/Worker yokken ana iş parçacığında satır içi işleyici (aynı kod).
import type { Track } from '../data/types';
import { createHandler, type Req } from './compute';

export interface Transport {
  post(msg: { id: number; req: Req }): void;
  onMessage(cb: (msg: { id: number; ok: boolean; res?: unknown; error?: string }) => void): void;
  terminate(): void;
}

/** Ana iş parçacığında çalışan aktarım (test ve Worker olmayan ortam): her iş ayrı bir `setTimeout` parçasıdır. */
export function inlineTransport(): Transport {
  const handle = createHandler();
  let cb: (m: { id: number; ok: boolean; res?: unknown; error?: string }) => void = () => {};
  return {
    post: ({ id, req }) => { setTimeout(() => { try { cb({ id, ok: true, res: handle(req) }); } catch (e) { cb({ id, ok: false, error: (e as Error).message }); } }, 0); },
    onMessage: (f) => { cb = f; },
    terminate: () => {},
  };
}

interface Job { req: Req; resolve: (v: never) => void; reject: (e: Error) => void; gen: number }
interface Slot { t: Transport; busy: { id: number; job: Job } | null }

export class ComputePool {
  private slots: Slot[];
  private queue: Job[] = [];
  private gen = 0;
  private nextId = 1;
  /** Her çalıştırılan iş için sayaç (testte: iptal edilen işlerin hiç çalışmadığını doğrulamak için). */
  started = 0;
  /** İptal nedeniyle atılan iş sayısı (bekleyen + sürmekte olan). */
  dropped = 0;

  constructor(factory: () => Transport, readonly size: number) {
    this.slots = [];
    for (let i = 0; i < Math.max(1, size); i++) {
      const slot: Slot = { t: factory(), busy: null };
      slot.t.onMessage((m) => this.onReply(slot, m));
      this.slots.push(slot);
    }
  }

  private onReply(slot: Slot, m: { id: number; ok: boolean; res?: unknown; error?: string }) {
    const cur = slot.busy;
    if (!cur || (m.id !== cur.id && m.id !== -1)) return; // id −1: işçi betiği çöktü (başlatma hatası); sürmekte olan iş hata ile biter
    slot.busy = null;
    const job = cur.job;
    if (job.gen !== -1 && job.gen !== this.gen) this.dropped++; // iptal edilmiş iş: sonuç atılır, söz hiç sonuçlanmaz
    else if (m.ok) job.resolve(m.res as never);
    else job.reject(new Error(m.error ?? 'Hesap hatası'));
    this.pump();
  }

  /** Tüm işçilere izleri gönderir (her biri kendi kopyasını tutar); işçi hazır olmadan sıradaki işler başlamaz. */
  init(tracks: Record<string, Track>): Promise<void> {
    return Promise.all(this.slots.map((s) => new Promise<void>((resolve, reject) => this.run(s, { req: { op: 'init', tracks }, resolve: () => resolve(), reject, gen: -1 })))).then(() => undefined);
  }

  private run(slot: Slot, job: Job) {
    const id = this.nextId++;
    slot.busy = { id, job };
    this.started++;
    try { slot.t.post({ id, req: job.req }); }
    catch (e) { slot.busy = null; job.reject(e as Error); this.pump(); } // ör. aktarılamayan veri: iş hata ile biter, işçi serbest kalır
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.busy) continue;
      const job = this.queue.shift();
      if (!job) return;
      this.run(slot, job);
    }
  }

  call<T>(req: Req): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ req, resolve: resolve as (v: never) => void, reject, gen: this.gen });
      this.pump();
    });
  }

  /**
   * İptal belirteci: bekleyen işler hiç başlamaz, sürmekte olanların sonucu atılır. Atılan işlerin sözleri HİÇ sonuçlanmaz (ne çözülür ne reddedilir):
   * çağıran zaten yeni bir hesap başlattığı için bekleyen kodun devam etmesi istenmez, bu da "yakalanmamış söz reddi" gürültüsünü önler;
   * kimse bu sözlere tutunmadığı için çöp toplayıcı bunları temizler.
   */
  cancel() {
    this.gen++;
    this.dropped += this.queue.length;
    this.queue.length = 0;
  }

  dispose() { for (const s of this.slots) s.t.terminate(); this.queue.length = 0; }
}

/** Tarayıcıda Worker havuzu; Worker oluşturulamazsa satır içi işleyiciye döner. */
export function createPool(): ComputePool {
  const n = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2) - 1));
  if (typeof Worker !== 'undefined') {
    try {
      return new ComputePool(() => {
        const w = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
        let cb: Parameters<Transport['onMessage']>[0] = () => {};
        w.onmessage = (e) => cb(e.data);
        w.onerror = (e) => cb({ id: -1, ok: false, error: e.message });
        return { post: (m) => w.postMessage(m), onMessage: (f) => { cb = f; }, terminate: () => w.terminate() };
      }, n);
    } catch (e) { console.warn('Web Worker başlatılamadı, ana iş parçacığında çalışılacak:', e); }
  }
  return new ComputePool(inlineTransport, 1);
}
