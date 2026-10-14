// Duyarlılık analizi: saf fonksiyonlar (DOM yok, rastgelelik yok). Tarayıcıyı dondurmamak için
// çağıran (arayüz) noktaları tek tek hesaplar ve aralarda tarayıcıya nefes aldırır.
// Tüm değerler varsayımsaldır; sonuçlar gerçek bir görev sonucu değildir.
import { simulate, type LinkSample, type Policy, type SchedConfig, type SchedTopology, type SimResult } from './scheduler';
import { MARS_RELAY, withParams, type SweepParams } from './timeline';

export const POLICIES: Policy[] = ['fifo', 'priority', 'strategy', 'coverage'];
/** Aşama 8-9: dört eski politika + kayan ufuklu strateji + uyarlamalı ufuk. `POLICIES` (Aşama 7 tarama/kısayol) değişmedi; 'rolling' ve 'adaptive' ayrı istenir. */
export const ALL_POLICIES: Policy[] = [...POLICIES, 'rolling', 'adaptive'];
/** Aşama 10: yeni politikalar (ayrı istenir; `ALL_POLICIES` değişmedi). */
export const STAGE10_POLICIES: Policy[] = ['valueAware', 'valueAdaptive', 'adaptiveRobust'];
/** Kavuşum kesintisi (earthBlackout) yoksa 'strategy' ve 'coverage' kısma yapmaz: sonuç öncelikliyle birebir aynıdır (testle doğrulanır). 'rolling' ve 'adaptive' kesinti işaretine bağlı değildir, bu kısayol onlara uygulanmaz. */
export const hasBlackout = (samples: LinkSample[]) => samples.some((s) => s.earthBlackout?.some(Boolean));
export type SweepKey = keyof SweepParams;

/** Aşama 9: bir sınıfın değer hesabı için ham toplamları (ağırlık ve yarı ömür sonradan uygulanır; ek çizelgeleyici hesabı gerekmez). */
export interface ValuePart {
  id: string;
  /** Sınıfın birim değeri (Mb başına; config'teki varsayımsal ağırlık). */
  weight: number;
  /** En önemli sınıf dışındaki sınıflar (bilim verisi) isteğe bağlı olarak zamanla azalan değerlidir. */
  decays: boolean;
  /** Talep = üretilen + üretilmeyen (Mb). */
  demandMb: number;
  deliveredMb: number;
  /** SchedConfig.valueHalfLivesSec sırasında, azalan değerli teslim hacmi (Mb eşdeğeri). */
  decayMb: number[];
}

/** Bir çizelgeleyici çalıştırmasının karşılaştırma ölçütleri. Talep = üretilen + üretilmeyen (Mb). */
export interface Metrics {
  demandMb: number;
  deliveredMb: number;
  droppedMb: number;
  suppressedMb: number;
  /** Aşama 10: değere duyarlı kuyruk kuralının attığı (değeri eşiğin altına inmiş) veri (Mb) ve talebe oranı (%). Diğer politikalarda 0. `lossPct`e dahildir. */
  expiredMb: number;
  expiredPct: number;
  /** Aşama 10: en önemli sınıfın (telemetri) kısılan (üretilmeyen) payı / kendi talebi (%). Yalnızca telemetryMinFactor < 1 iken > 0. */
  topSuppressedPct: number;
  /** Düşen / talep (%). Kısılan (üretilmeyen) veri BURADA kayıp sayılmaz. */
  dropPct: number;
  /** Hatta kayıp (maxAttempts denemede iletilemeyen) / talep (%). Tampon taşması (dropPct) ile karıştırılmaz. */
  abandonedPct: number;
  /** Kaybolan iletim denemesi ve yeniden gönderilen paket sayısı. */
  txLost: number;
  retransmissions: number;
  /** Tüm iletim denemeleri, kaybolan denemelerin oranı (%), hatta kalıcı kayıp paket sayısı (maxAttempts aşıldı), en uzun art arda kayıp. */
  attempts: number;
  txLostPct: number;
  abandoned: number;
  /** Hatta kayıp paketlerden yüzey hattında (araç → uydu) olanlar. */
  abandonedSurface: number;
  maxLossRun: number;
  /** (Düşen + hatta kayıp + üretilmeyen) / talep (%). Stratejiyi haksız avantajdan koruyan, kısmayı da "kaybedilen" sayan ölçüt. */
  lossPct: number;
  /** En önemli sınıfın (telemetri) düşen + hatta kayıp Mb / kendi talebi (%). Bu sınıf kısılmaz. */
  topDropPct: number;
  /** Teslim edilen / talep (%). */
  deliveredPct: number;
  /** Teslim süresi (sn), yalnızca teslim edilenlerden. En önemli sınıf = ilk sınıf (telemetri). */
  topP95Sec: number;
  topMeanSec: number;
  lowP95Sec: number;
  lowMeanSec: number;
  /** Aşama 9: değer ölçütü ham toplamları ve bunlara karşılık gelen yarı ömürler (sn). Değer % için `valuePct` işlevi. */
  valueParts: ValuePart[];
  valueHalfLivesSec: number[];
}

export interface ValueOpts {
  /** Sınıfa göre ağırlık geçersiz kılma (yoksa config ağırlığı). */
  weightOf?: (p: ValuePart) => number;
  /** valueHalfLivesSec içindeki sıra; verilirse bilim verisi (decays) zamanla azalan değerle sayılır. Yoksa sabit değer. */
  halfLifeIdx?: number;
  /** Aşama 11: true ise en önemli sınıf (telemetri) da zamanla azalan değerle sayılır (yalnızca alternatif değer modelinin `top` eğrisi için anlamlı). */
  topDecays?: boolean;
}

/** Değer ağırlıklı fayda ölçütü (%) = teslim edilen değer / talep edilen değer. Sabit değerde yalnızca ağırlıklı hacim oranı; yarı ömürle bilim verisi 2^(−yaş/yarı ömür) çarpanını alır. */
export function valuePct(m: Pick<Metrics, 'valueParts'>, o: ValueOpts = {}): number {
  let num = 0, den = 0;
  for (const p of m.valueParts) {
    const w = o.weightOf ? o.weightOf(p) : p.weight;
    num += w * ((p.decays || o.topDecays) && o.halfLifeIdx !== undefined && o.halfLifeIdx >= 0 && o.halfLifeIdx < p.decayMb.length ? p.decayMb[o.halfLifeIdx] : p.deliveredMb);
    den += w * p.demandMb;
  }
  return den > 0 ? (100 * num) / den : 0;
}

/** Sınıf kimliklerinden "en önemli" ve "düşük öncelikli" olanı seçer (priority sayısı en küçük / en büyük). */
export function metricsOf(r: SimResult, cfg: SchedConfig): Metrics {
  const byPrio = [...cfg.classes].sort((a, b) => a.priority - b.priority);
  const top = r.perClass[byPrio[0].id];
  const low = r.perClass[byPrio[byPrio.length - 1].id];
  const t = r.total;
  const demandMb = t.generatedMb + t.suppressedMb;
  const topDemand = top.generatedMb + top.suppressedMb;
  const pct = (x: number) => (demandMb > 0 ? (100 * x) / demandMb : 0);
  return {
    demandMb, deliveredMb: t.deliveredMb, droppedMb: t.droppedMb, suppressedMb: t.suppressedMb,
    expiredMb: t.expiredMb, expiredPct: pct(t.expiredMb), topSuppressedPct: topDemand > 0 ? (100 * top.suppressedMb) / topDemand : 0,
    dropPct: pct(t.droppedMb), abandonedPct: pct(t.abandonedMb), txLost: t.txLost, retransmissions: t.retransmissions, attempts: t.attempts, txLostPct: t.attempts > 0 ? (100 * t.txLost) / t.attempts : 0, abandoned: t.abandoned, abandonedSurface: r.abandonedSurface, maxLossRun: r.maxLossRun, lossPct: pct(t.droppedMb + t.abandonedMb + t.suppressedMb + t.expiredMb), deliveredPct: pct(t.deliveredMb), topDropPct: topDemand > 0 ? (100 * (top.droppedMb + top.abandonedMb)) / topDemand : 0,
    topP95Sec: top.latencyP95Sec, topMeanSec: top.latencyMeanSec, lowP95Sec: low.latencyP95Sec, lowMeanSec: low.latencyMeanSec,
    valueParts: cfg.classes.map((c) => {
      const s = r.perClass[c.id];
      return { id: c.id, weight: c.valuePerMb ?? 1, decays: c.priority !== byPrio[0].priority, demandMb: s.generatedMb + s.suppressedMb, deliveredMb: s.deliveredMb, decayMb: s.decayMb };
    }),
    valueHalfLivesSec: cfg.valueHalfLivesSec ?? [],
  };
}

export type PolicyMetrics = Record<Policy, Metrics>;

/** Hesaplanan politikalar için (bazıları yoksa) kısmi sonuç. Aşama 8: 'rolling' yalnızca istenirse bulunur. */
export type PartialPolicyMetrics = Partial<Record<Policy, Metrics>>;

/** Tek bir çizelgeleyiciyi parametrelerle çalıştırır (arayüz, uzun hesabı politika politika bölmek için kullanır). */
export function runPolicy(topo: SchedTopology, samples: LinkSample[], cfg: SchedConfig, params: SweepParams, policy: Policy, override: Partial<SweepParams> = {}, relayId: string = MARS_RELAY, extraRelayIds: string[] = []): Metrics {
  const c = withParams(cfg, { ...params, ...override }, relayId, extraRelayIds);
  return metricsOf(simulate(topo, samples, policy, c), c);
}

/** Verilen parametrelerle üç çizelgeleyiciyi aynı bağlantı çizelgesi üzerinde çalıştırır. */
export function runPolicies(topo: SchedTopology, samples: LinkSample[], cfg: SchedConfig, params: SweepParams, override: Partial<SweepParams> = {}, relayId: string = MARS_RELAY, policies: Policy[] = POLICIES): { results: Record<Policy, SimResult>; metrics: PolicyMetrics } {
  const c = withParams(cfg, { ...params, ...override }, relayId);
  const results = {} as Record<Policy, SimResult>;
  const metrics = {} as PolicyMetrics;
  const blackout = hasBlackout(samples);
  for (const p of policies) {
    // kesinti yoksa strateji politikaları öncelikliyle aynıdır: yeniden hesaplamaya gerek yok
    results[p] = !blackout && (p === 'strategy' || p === 'coverage') && results.priority ? { ...results.priority, policy: p } : simulate(topo, samples, p, c);
    metrics[p] = metricsOf(results[p], c);
  }
  return { results, metrics };
}

/** [min, max] aralığında eşit aralıklı n nokta; `include` (ör. kaydırıcının şu anki değeri) varsa sıraya eklenir. */
export function sweepValues(min: number, max: number, n: number, include?: number): number[] {
  const k = Math.max(2, Math.floor(n));
  const v = Array.from({ length: k }, (_, i) => min + ((max - min) * i) / (k - 1));
  if (include !== undefined && Number.isFinite(include) && !v.some((x) => Math.abs(x - include) < 1e-9 * Math.max(1, Math.abs(include)))) v.push(include);
  return v.sort((a, b) => a - b);
}

/** Tek tarama noktası: key parametresi value olur, diğerleri params'taki gibi kalır. */
export const sweepPoint = (topo: SchedTopology, samples: LinkSample[], cfg: SchedConfig, params: SweepParams, key: SweepKey, value: number, relayId: string = MARS_RELAY) =>
  runPolicies(topo, samples, cfg, params, { [key]: value } as Partial<SweepParams>, relayId).metrics;
