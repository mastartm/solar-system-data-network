// Çizelgeleyici: saf fonksiyon, rastgelelik yok, DOM/Horizons bağımlılığı yok.
// Giriş: topoloji + bağlantı zaman çizelgesi (adım adım açık/kapalı + ışık gecikmesi) + ayarlar.
// İki atlama: araç → aktarma uydusu → Dünya. Her düğümde sınırlı bir tampon var.
// Tüm sayılar (hızlar, boyutlar, kapasiteler) çağıranın verdiği ayarlardan gelir; varsayılanı
// src/config/hypothetical.ts içindeki VARSAYIMSAL değerlerdir. Sonuçlar gerçek bir görev sonucu değildir.

/**
 * 'fifo' ve 'priority': yalnızca sıralama/atma kuralı. 'strategy': 'priority' + kavuşum stratejisi
 * (bilim verisi üretimini kısma). Strateji kapalı sınıf (en önemli sınıf) hiç kısılmaz.
 */
export type Policy = 'fifo' | 'priority' | 'strategy';

/**
 * Kavuşum stratejisi ("bütçeli kısma"; varsayılanı src/config/hypothetical.ts). Kesinti takvimi öngörülebilir varsayılır
 * (Güneş–Mars geometrisi önceden bilinir): kesintiye lookaheadSec kala ve kesinti boyunca, aktarma uydusu hattındaki
 * (uydu + ona bağlı araçlar) boş tampon, kesintinin kalan süresine yayılacak şekilde kısılabilir sınıfların (en önemli
 * sınıf dışındakiler) üretimi kısılır. Böylece tampon taşmadan kesinti bitişine kadar yetecek kadar veri üretilir.
 * Kısılan veri "düşen" (kayıp) DEĞİL "üretilmeyen" (suppressed) sayılır: hiç üretilmedi, tampona girmedi.
 * Adil karşılaştırma için talep = üretilen + üretilmeyen esas alınır.
 */
export interface StrategyConfig {
  /** Kesintiye bu süreden az kaldığında kısma başlar (sn). */
  lookaheadSec: number;
  /** Boş tamponun kısma bütçesine ayrılan oranı (0–1); kalanı telemetriye ve yuvarlama payına bırakılır. */
  margin: number;
  /** Kısılabilir sınıfların üretim çarpanının alt sınırı (0–1). */
  minFactor: number;
}

/**
 * Hat hatası ve yeniden iletim (ARQ), varsayılanı src/config/hypothetical.ts. Rastgelelik yok: kayıp oranı belirleyici bir
 * biriktiriciyle uygulanır (her deneme için oran birikir, 1'i geçince o deneme kaybolur). Yüzey hattında RTT adımdan çok kısa
 * varsayılır (yeniden deneme aynı adımda, bant genişliği harcar); Dünya hattında gönderici paketi RTT (= 2 × ışık gecikmesi)
 * boyunca tamponunda tutar, ACK sonrası bırakır ya da NAK sonrası yeniden gönderir. maxAttempts = 1 → yeniden iletim yok.
 */
export interface ArqConfig {
  surfaceLossPct: number;
  earthLossPct: number;
  /** Bir hatta bir paket için en çok deneme sayısı; aşılırsa paket "hatta kayıp" (abandoned) sayılır. */
  maxAttempts: number;
}

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
  /** 'strategy' politikası için gerekli; yoksa strateji kısma yapmaz (öncelikli ile aynı). */
  strategy?: StrategyConfig;
  /** Yoksa hatlar kayıpsızdır ve gönderici paketi gönderir göndermez bırakır (Aşama 3-4 davranışı). */
  arq?: ArqConfig;
}

export interface SchedAsset { id: string; body: string; relay: string; dataRateKbps: number }
export interface SchedTopology { assets: SchedAsset[]; relays: string[] }

/** Bir zaman adımındaki bağlantı durumu; diziler topology.assets / topology.relays sırasındadır. */
export interface LinkSample {
  surfaceUp: boolean[];
  surfaceDelaySec: number[];
  earthUp: boolean[];
  earthDelaySec: number[];
  /** İsteğe bağlı: uydu→Dünya hattı Mars kavuşumu nedeniyle kapalı mı (cisim arkası kapanması değil). Strateji bunu öngörmek için kullanır. */
  earthBlackout?: boolean[];
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
  /** Hatta kayıp: maxAttempts denemede iletilemeyen paket (tampon taşması `dropped` ile karıştırılmaz). */
  abandoned: number;
  abandonedMb: number;
  /** Kaybolan iletim denemesi sayısı ve bunlardan yeniden gönderilenler (retransmissions = txLost − abandoned). */
  txLost: number;
  retransmissions: number;
  /** Strateji yüzünden hiç üretilmeyen (kısılan) veri; kayıp (dropped) DEĞİLDİR. Talep = generated + suppressed. */
  suppressed: number;
  suppressedMb: number;
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

interface Pkt { cls: number; sizeMb: number; createdSec: number; sentMb: number; seq: number; propSec: number; attempts: number }
interface Held { p: Pkt; k: number; at: number; ok: boolean }

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
  /** Başa geri koy (yeniden iletim). */
  unshift(p: Pkt) { if (this.h > 0) this.a[--this.h] = p; else this.a.unshift(p); }
}

class Buffer {
  q: Fifo[];
  usedMb = 0;
  usedByClass: number[];
  /** ARQ: gönderilmiş ama onaylanmamış kopyaların (kuyrukta değil, tamponda yer tutan) sınıf başına hacmi. */
  held: number[];
  constructor(readonly capMb: number, nClasses: number) {
    this.q = Array.from({ length: nClasses }, () => new Fifo());
    this.usedByClass = new Array(nClasses).fill(0);
    this.held = new Array(nClasses).fill(0);
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
  const supAcc = topo.assets.map(() => new Array(nC).fill(0));
  const sup = new Array(nC).fill(0), supMb = new Array(nC).fill(0);
  const topRank = Math.min(...rank);
  const st = policy === 'strategy' ? cfg.strategy : undefined;
  // Kesinti öngörüsü (yalnızca strateji): relay başına, adım i için kesintiye kalan süre içinde mi, ve o kesintinin bitişine kalan adım.
  const ahead = topo.relays.map(() => new Array<boolean>(samples.length).fill(false));
  const endsIn = topo.relays.map(() => new Array<number>(samples.length).fill(0));
  if (st) {
    const L = Math.ceil(st.lookaheadSec / dt);
    topo.relays.forEach((_, ri) => {
      let start = Infinity, end = Infinity; // sonraki (veya süren) kesinti serisinin ilk adımı ve bitişi (ilk açık adım)
      for (let i = samples.length - 1; i >= 0; i--) {
        const b = !!samples[i].earthBlackout?.[ri];
        if (b) { end = i + 1 < samples.length && samples[i + 1].earthBlackout?.[ri] ? end : i + 1; start = i; }
        ahead[ri][i] = start - i <= L;
        endsIn[ri][i] = end - i;
      }
    });
  }
  // Araç başına tam hızda üretim (Mb/sn): en önemli sınıf ve kısılabilir sınıflar; ve uydudaki araçların toplam hızı (uydu tamponunu hız oranında paylaştırmak için).
  const assetRate = topo.assets.map((a) => {
    let top = 0, rest = 0;
    const mb = (a.dataRateKbps / 1000) * cfg.dutyCycle;
    classes.forEach((c, k) => { if (rank[k] === topRank) top += mb * c.share / shareSum; else rest += mb * c.share / shareSum; });
    return { top, rest, total: top + rest };
  });
  const relayTotal = topo.relays.map((r) => topo.assets.reduce((s, a, ai) => s + (a.relay === r ? assetRate[ai].total : 0), 0));

  const gen = new Array(nC).fill(0), genMb = new Array(nC).fill(0);
  const drop = new Array(nC).fill(0), dropMb = new Array(nC).fill(0);
  const deliv = new Array(nC).fill(0), delivMb = new Array(nC).fill(0);
  const stored = new Array(nC).fill(0), delayed = new Array(nC).fill(0);
  const lat: number[][] = Array.from({ length: nC }, () => []);
  const arq = cfg.arq;
  const aband = new Array(nC).fill(0), abandMb = new Array(nC).fill(0), txLost = new Array(nC).fill(0), retx = new Array(nC).fill(0);
  const surfAcc = topo.assets.map(() => 0), earthAcc = topo.relays.map(() => 0);
  const inflight: Held[][] = topo.relays.map(() => []);
  /** Belirleyici kayıp: oran birikir, 1'i geçince bu deneme kaybolur. */
  const draw = (acc: number[], i: number, pct: number) => {
    acc[i] += pct / 100;
    if (acc[i] >= 1 - 1e-12) { acc[i] -= 1; return true; }
    return false;
  };
  let seq = 0;
  let droppedCum = 0;
  const series: SeriesPoint[] = [];
  const peakRelay = topo.relays.map(() => 0);
  const peakAsset = topo.assets.map(() => 0);

  const lose = (p: Pkt) => { drop[p.cls]++; dropMb[p.cls] += p.sizeMb; droppedCum++; };

  /** Daha düşük öncelikli sınıflardan atılabilecek hacim (yalnızca 'priority'). */
  const evictable = (b: Buffer, cls: number) => {
    if (policy === 'fifo') return 0;
    let s = 0;
    for (let k = 0; k < nC; k++) if (rank[k] > rank[cls]) s += b.usedByClass[k] - b.held[k];
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
      const better = policy !== 'fifo'
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

    // 0) ARQ: onay/ret zamanı gelen kopyaları bırak ya da yeniden kuyruğa al
    if (arq) {
      inflight.forEach((list, ri) => {
        if (!list.length) return;
        const b = relayBuf[ri];
        const keep: Held[] = [];
        for (const h of list) {
          if (h.at > now) { keep.push(h); continue; }
          b.held[h.k] -= h.p.sizeMb;
          if (h.ok) { b.usedMb -= h.p.sizeMb; b.usedByClass[h.k] -= h.p.sizeMb; }
          else if (h.p.attempts >= arq.maxAttempts) { b.usedMb -= h.p.sizeMb; b.usedByClass[h.k] -= h.p.sizeMb; aband[h.k]++; abandMb[h.k] += h.p.sizeMb; }
          else { retx[h.k]++; b.q[h.k].unshift(h.p); }
        }
        if (b.usedMb < 1e-9) b.usedMb = 0;
        inflight[ri] = keep;
      });
    }

    // 1) Üretim (deterministik birikim). Strateji: en önemli sınıf dışındakiler kısılır; kısılan hiç üretilmez.
    topo.assets.forEach((a, ai) => {
      const mbPerSec = (a.dataRateKbps / 1000) * cfg.dutyCycle;
      let throttle = 1;
      if (st) {
        const ri = relayIndex.get(a.relay)!;
        if (ahead[ri][i]) {
          // Bu aracın kullanabileceği boş yer: kendi tamponu + uydu tamponunun hız oranındaki payı.
          const free = assetBuf[ai].freeMb + relayBuf[ri].freeMb * (relayTotal[ri] > 0 ? assetRate[ai].total / relayTotal[ri] : 0);
          const D = Math.max(1, endsIn[ri][i]) * dt; // kesintinin kalan süresi (sn)
          const need = assetRate[ai].rest * D;
          const allowed = st.margin * free - assetRate[ai].top * D;
          throttle = need > 0 ? Math.min(1, Math.max(st.minFactor, allowed / need)) : 1;
        }
      }
      for (let k = 0; k < nC; k++) {
        const full = mbPerSec * (classes[k].share / shareSum) * dt;
        const f = rank[k] === topRank ? 1 : throttle;
        if (f < 1) {
          supAcc[ai][k] += full * (1 - f);
          supMb[k] += full * (1 - f);
          while (supAcc[ai][k] >= classes[k].packetMb) { supAcc[ai][k] -= classes[k].packetMb; sup[k]++; }
        }
        acc[ai][k] += full * f;
        while (acc[ai][k] >= classes[k].packetMb) {
          acc[ai][k] -= classes[k].packetMb;
          const p: Pkt = { cls: k, sizeMb: classes[k].packetMb, createdSec: now, sentMb: 0, seq: 0, propSec: 0, attempts: 0 };
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
        if (arq && draw(surfAcc, ai, arq.surfaceLossPct)) {
          // kayıp deneme: bant genişliği harcandı; paket tamponda kalır ve yeniden denenir (ya da hak tükenir)
          txLost[k]++; p.attempts++; p.sentMb = 0;
          if (p.attempts >= arq.maxAttempts) { take(src, k); aband[k]++; abandMb[k] += p.sizeMb; } else retx[k]++;
          continue;
        }
        take(src, k);
        p.sentMb = 0; p.attempts = 0;
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
        if (arq) {
          // gönderici kopyayı RTT boyunca tamponunda tutar: kuyruktan çıkar ama yer tutmaya devam eder
          buf.q[k].shift(); p.sentMb = 0; p.attempts++; buf.held[k] += p.sizeMb;
          const rtt = 2 * s.earthDelaySec[ri];
          if (draw(earthAcc, ri, arq.earthLossPct)) { txLost[k]++; inflight[ri].push({ p, k, at: end + rtt, ok: false }); continue; }
          inflight[ri].push({ p, k, at: end + rtt, ok: true });
        } else take(buf, k);
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
  for (const list of inflight) for (const h of list) if (!h.ok) remaining[h.k]++; // reddedilmiş, henüz yeniden kuyruğa alınmamış

  const mk = (k: number): ClassStats => {
    const l = [...lat[k]].sort((x, y) => x - y);
    return {
      abandoned: aband[k], abandonedMb: abandMb[k], txLost: txLost[k], retransmissions: retx[k],
      generated: gen[k], delivered: deliv[k], dropped: drop[k], stored: stored[k], delayed: delayed[k], remaining: remaining[k],
      suppressed: sup[k], suppressedMb: supMb[k],
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
    abandoned: sum((c) => c.abandoned), abandonedMb: sum((c) => c.abandonedMb), txLost: sum((c) => c.txLost), retransmissions: sum((c) => c.retransmissions),
    generated: sum((c) => c.generated), delivered: sum((c) => c.delivered), dropped: sum((c) => c.dropped),
    stored: sum((c) => c.stored), delayed: sum((c) => c.delayed), remaining: sum((c) => c.remaining),
    suppressed: sum((c) => c.suppressed), suppressedMb: sum((c) => c.suppressedMb),
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
