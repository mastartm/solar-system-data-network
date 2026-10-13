// Çizelgeleyici: saf fonksiyon, rastgelelik yok, DOM/Horizons bağımlılığı yok.
// Giriş: topoloji + bağlantı zaman çizelgesi (adım adım açık/kapalı + ışık gecikmesi) + ayarlar.
// İki atlama: araç → aktarma uydusu → Dünya. Her düğümde sınırlı bir tampon var.
// Tüm sayılar (hızlar, boyutlar, kapasiteler) çağıranın verdiği ayarlardan gelir; varsayılanı
// src/config/hypothetical.ts içindeki VARSAYIMSAL değerlerdir. Sonuçlar gerçek bir görev sonucu değildir.

export type Policy = 'fifo' | 'priority';

export interface SchedClass { id: string; priority: number; share: number; packetMb: number }

export interface SchedConfig {
  classes: SchedClass[];
  dutyCycle: number;
  surfaceLinkKbps: Record<string, number>; // cisme (body) göre
  relayDownlinkKbps: Record<string, number>; // aktarma uydusu id'sine göre
  assetBufferMb: Record<string, number>; // cisme göre
  relayBufferMb: Record<string, number>; // aktarma uydusu id'sine göre
  delayedAfterSec: number;
  stepSec: number;
  seriesEverySec: number;
}

export interface SchedAsset { id: string; body: string; relay: string; dataRateKbps: number }
export interface SchedTopology { assets: SchedAsset[]; relays: string[] }

/** Bir zaman adımındaki bağlantı durumu; diziler topology.assets / topology.relays sırasındadır. */
export interface LinkSample {
  surfaceUp: boolean[];
  surfaceDelaySec: number[];
  earthUp: boolean[];
  earthDelaySec: number[];
}

export interface ClassStats {
  generated: number;
  delivered: number;
  /** Tampon taşması nedeniyle düşen. */
  dropped: number;
  /** Teslim edilmiş ve en az bir adımdan uzun tamponda beklemiş. */
  stored: number;
  /** Teslim edilmiş ve kuyruk bekleme süresi delayedAfterSec'ten uzun. */
  delayed: number;
  /** Simülasyon sonunda hâlâ tamponda. */
  remaining: number;
  generatedMb: number;
  deliveredMb: number;
  droppedMb: number;
  /** Teslim süresi (sn) = kuyruk bekleme + ışık yolu. Teslim yoksa 0. */
  latencyMeanSec: number;
  latencyP95Sec: number;
  latencyMaxSec: number;
}

export interface SeriesPoint {
  tSec: number;
  /** Doluluk oranı (0–1), topology.relays / topology.assets sırasında. */
  relayFill: number[];
  assetFill: number[];
  /** O ana kadar düşen toplam paket. */
  droppedCum: number;
}

export interface SimResult {
  policy: Policy;
  perClass: Record<string, ClassStats>;
  total: ClassStats;
  series: SeriesPoint[];
  peakRelayFill: Record<string, number>;
  peakAssetFill: Record<string, number>;
}

interface Pkt { cls: number; sizeMb: number; createdSec: number; sentMb: number; seq: number; propSec: number }

class Fifo {
  private a: Pkt[] = [];
  private h = 0;
  get length() { return this.a.length - this.h; }
  peek(): Pkt | undefined { return this.a[this.h]; }
  push(p: Pkt) { this.a.push(p); }
  shift(): Pkt | undefined {
    const p = this.a[this.h++];
    if (this.h > 1024 && this.h * 2 > this.a.length) { this.a = this.a.slice(this.h); this.h = 0; }
    return p;
  }
  pop(): Pkt | undefined { return this.length > 0 ? this.a.pop() : undefined; }
}

class Buffer {
  q: Fifo[];
  usedMb = 0;
  usedByClass: number[];
  constructor(readonly capMb: number, nClasses: number) {
    this.q = Array.from({ length: nClasses }, () => new Fifo());
    this.usedByClass = new Array(nClasses).fill(0);
  }
  get freeMb() { return this.capMb - this.usedMb; }
  get count() { return this.q.reduce((n, f) => n + f.length, 0); }
}

export function simulate(topo: SchedTopology, samples: LinkSample[], policy: Policy, cfg: SchedConfig): SimResult {
  const dt = cfg.stepSec;
  const classes = cfg.classes;
  const nC = classes.length;
  const shareSum = classes.reduce((s, c) => s + c.share, 0) || 1;
  const rank = classes.map((c) => c.priority); // küçük = önemli

  const relayIndex = new Map(topo.relays.map((r, i) => [r, i]));
  const assetBuf = topo.assets.map((a) => new Buffer(cfg.assetBufferMb[a.body] ?? 0, nC));
  const relayBuf = topo.relays.map((r) => new Buffer(cfg.relayBufferMb[r] ?? 0, nC));
  const acc = topo.assets.map(() => new Array(nC).fill(0));

  const gen = new Array(nC).fill(0), genMb = new Array(nC).fill(0);
  const drop = new Array(nC).fill(0), dropMb = new Array(nC).fill(0);
  const deliv = new Array(nC).fill(0), delivMb = new Array(nC).fill(0);
  const stored = new Array(nC).fill(0), delayed = new Array(nC).fill(0);
  const lat: number[][] = Array.from({ length: nC }, () => []);
  let seq = 0;
  let droppedCum = 0;
  const series: SeriesPoint[] = [];
  const peakRelay = topo.relays.map(() => 0);
  const peakAsset = topo.assets.map(() => 0);

  const lose = (p: Pkt) => { drop[p.cls]++; dropMb[p.cls] += p.sizeMb; droppedCum++; };

  /** Daha düşük öncelikli sınıflardan atılabilecek hacim (yalnızca 'priority'). */
  const evictable = (b: Buffer, cls: number) => {
    if (policy !== 'priority') return 0;
    let s = 0;
    for (let k = 0; k < nC; k++) if (rank[k] > rank[cls]) s += b.usedByClass[k];
    return s;
  };
  const canAccept = (b: Buffer, p: Pkt) => b.freeMb >= p.sizeMb - 1e-9 || b.freeMb + evictable(b, p.cls) >= p.sizeMb - 1e-9;

  const put = (b: Buffer, p: Pkt) => {
    if (b.freeMb < p.sizeMb - 1e-9) {
      if (b.freeMb + evictable(b, p.cls) < p.sizeMb - 1e-9) { lose(p); return; }
      // en düşük öncelikli sınıfın en yeni paketlerinden başlayarak yer aç
      const order = [...Array(nC).keys()].filter((k) => rank[k] > rank[p.cls]).sort((x, y) => rank[y] - rank[x]);
      for (const k of order) {
        while (b.freeMb < p.sizeMb - 1e-9) {
          const v = b.q[k].pop();
          if (!v) break;
          b.usedMb -= v.sizeMb; b.usedByClass[k] -= v.sizeMb; lose(v);
        }
        if (b.freeMb >= p.sizeMb - 1e-9) break;
      }
    }
    p.seq = seq++;
    b.q[p.cls].push(p);
    b.usedMb += p.sizeMb; b.usedByClass[p.cls] += p.sizeMb;
  };

  /** Sıradaki paketin sınıfı: FIFO'da en eski, öncelikliyse en önemli sınıfın başı. */
  const pick = (b: Buffer): number => {
    let best = -1;
    for (let k = 0; k < nC; k++) {
      const h = b.q[k].peek();
      if (!h) continue;
      if (best < 0) { best = k; continue; }
      const bh = b.q[best].peek()!;
      const better = policy === 'priority'
        ? rank[k] < rank[best] || (rank[k] === rank[best] && h.seq < bh.seq)
        : h.seq < bh.seq;
      if (better) best = k;
    }
    return best;
  };
  const take = (b: Buffer, k: number): Pkt => {
    const p = b.q[k].shift()!;
    b.usedMb -= p.sizeMb; b.usedByClass[k] -= p.sizeMb;
    if (b.usedMb < 1e-9) b.usedMb = 0;
    return p;
  };

  for (let i = 0; i < samples.length; i++) {
    const now = i * dt;
    const end = now + dt;
    const s = samples[i];

    // 1) Üretim (deterministik birikim)
    topo.assets.forEach((a, ai) => {
      const mbPerSec = (a.dataRateKbps / 1000) * cfg.dutyCycle;
      for (let k = 0; k < nC; k++) {
        acc[ai][k] += mbPerSec * (classes[k].share / shareSum) * dt;
        while (acc[ai][k] >= classes[k].packetMb) {
          acc[ai][k] -= classes[k].packetMb;
          const p: Pkt = { cls: k, sizeMb: classes[k].packetMb, createdSec: now, sentMb: 0, seq: 0, propSec: 0 };
          gen[k]++; genMb[k] += p.sizeMb;
          put(assetBuf[ai], p);
        }
      }
    });

    // 2) Araç → uydu
    topo.assets.forEach((a, ai) => {
      if (!s.surfaceUp[ai]) return;
      const src = assetBuf[ai];
      const dst = relayBuf[relayIndex.get(a.relay)!];
      let budget = ((cfg.surfaceLinkKbps[a.body] ?? 0) / 1000) * dt;
      while (budget > 1e-12) {
        const k = pick(src);
        if (k < 0) break;
        const p = src.q[k].peek()!;
        const need = p.sizeMb - p.sentMb;
        if (budget < need) { p.sentMb += budget; break; }
        if (!canAccept(dst, p)) break; // uydu tamponu dolu: araç gönderemez, kendi tamponunda tutar
        budget -= need;
        take(src, k);
        p.sentMb = 0;
        p.propSec += s.surfaceDelaySec[ai];
        put(dst, p);
      }
    });

    // 3) Uydu → Dünya
    topo.relays.forEach((r, ri) => {
      if (!s.earthUp[ri]) return;
      const buf = relayBuf[ri];
      let budget = ((cfg.relayDownlinkKbps[r] ?? 0) / 1000) * dt;
      while (budget > 1e-12) {
        const k = pick(buf);
        if (k < 0) break;
        const p = buf.q[k].peek()!;
        const need = p.sizeMb - p.sentMb;
        if (budget < need) { p.sentMb += budget; break; }
        budget -= need;
        take(buf, k);
        const wait = end - p.createdSec;
        deliv[k]++; delivMb[k] += p.sizeMb;
        lat[k].push(wait + p.propSec + s.earthDelaySec[ri]);
        if (wait > dt + 1e-9) stored[k]++;
        if (wait > cfg.delayedAfterSec) delayed[k]++;
      }
    });

    // 4) Ölçüm
    relayBuf.forEach((b, ri) => { peakRelay[ri] = Math.max(peakRelay[ri], b.capMb ? b.usedMb / b.capMb : 0); });
    assetBuf.forEach((b, ai) => { peakAsset[ai] = Math.max(peakAsset[ai], b.capMb ? b.usedMb / b.capMb : 0); });
    if (now % cfg.seriesEverySec === 0) {
      series.push({
        tSec: now,
        relayFill: relayBuf.map((b) => (b.capMb ? b.usedMb / b.capMb : 0)),
        assetFill: assetBuf.map((b) => (b.capMb ? b.usedMb / b.capMb : 0)),
        droppedCum,
      });
    }
  }

  const remaining = new Array(nC).fill(0);
  for (const b of [...assetBuf, ...relayBuf]) for (let k = 0; k < nC; k++) remaining[k] += b.q[k].length;

  const mk = (k: number): ClassStats => {
    const l = [...lat[k]].sort((x, y) => x - y);
    return {
      generated: gen[k], delivered: deliv[k], dropped: drop[k], stored: stored[k], delayed: delayed[k], remaining: remaining[k],
      generatedMb: genMb[k], deliveredMb: delivMb[k], droppedMb: dropMb[k],
      latencyMeanSec: l.length ? l.reduce((x, y) => x + y, 0) / l.length : 0,
      latencyP95Sec: l.length ? l[Math.min(l.length - 1, Math.floor(0.95 * l.length))] : 0,
      latencyMaxSec: l.length ? l[l.length - 1] : 0,
    };
  };
  const perClass: Record<string, ClassStats> = {};
  classes.forEach((c, k) => { perClass[c.id] = mk(k); });

  const all = Object.values(perClass);
  const sum = (f: (c: ClassStats) => number) => all.reduce((x, c) => x + f(c), 0);
  const allLat = lat.flat().sort((x, y) => x - y);
  const total: ClassStats = {
    generated: sum((c) => c.generated), delivered: sum((c) => c.delivered), dropped: sum((c) => c.dropped),
    stored: sum((c) => c.stored), delayed: sum((c) => c.delayed), remaining: sum((c) => c.remaining),
    generatedMb: sum((c) => c.generatedMb), deliveredMb: sum((c) => c.deliveredMb), droppedMb: sum((c) => c.droppedMb),
    latencyMeanSec: allLat.length ? allLat.reduce((x, y) => x + y, 0) / allLat.length : 0,
    latencyP95Sec: allLat.length ? allLat[Math.min(allLat.length - 1, Math.floor(0.95 * allLat.length))] : 0,
    latencyMaxSec: allLat.length ? allLat[allLat.length - 1] : 0,
  };

  return {
    policy, perClass, total, series,
    peakRelayFill: Object.fromEntries(topo.relays.map((r, i) => [r, peakRelay[i]])),
    peakAssetFill: Object.fromEntries(topo.assets.map((a, i) => [a.id, peakAsset[i]])),
  };
}
