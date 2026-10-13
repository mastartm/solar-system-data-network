// Duyarlılık analizi: saf fonksiyonlar (DOM yok, rastgelelik yok). Tarayıcıyı dondurmamak için
// çağıran (arayüz) noktaları tek tek hesaplar ve aralarda tarayıcıya nefes aldırır.
// Tüm değerler varsayımsaldır; sonuçlar gerçek bir görev sonucu değildir.
import { simulate, type LinkSample, type Policy, type SchedConfig, type SchedTopology, type SimResult } from './scheduler';
import { MARS_RELAY, withParams, type SweepParams } from './timeline';

export const POLICIES: Policy[] = ['fifo', 'priority', 'strategy', 'coverage'];
/** Kavuşum kesintisi (earthBlackout) yoksa 'strategy' ve 'coverage' kısma yapmaz: sonuç öncelikliyle birebir aynıdır (testle doğrulanır). */
export const hasBlackout = (samples: LinkSample[]) => samples.some((s) => s.earthBlackout?.some(Boolean));
export type SweepKey = keyof SweepParams;

/** Bir çizelgeleyici çalıştırmasının karşılaştırma ölçütleri. Talep = üretilen + üretilmeyen (Mb). */
export interface Metrics {
  demandMb: number;
  deliveredMb: number;
  droppedMb: number;
  suppressedMb: number;
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
    dropPct: pct(t.droppedMb), abandonedPct: pct(t.abandonedMb), txLost: t.txLost, retransmissions: t.retransmissions, attempts: t.attempts, txLostPct: t.attempts > 0 ? (100 * t.txLost) / t.attempts : 0, abandoned: t.abandoned, abandonedSurface: r.abandonedSurface, maxLossRun: r.maxLossRun, lossPct: pct(t.droppedMb + t.abandonedMb + t.suppressedMb), deliveredPct: pct(t.deliveredMb), topDropPct: topDemand > 0 ? (100 * (top.droppedMb + top.abandonedMb)) / topDemand : 0,
    topP95Sec: top.latencyP95Sec, topMeanSec: top.latencyMeanSec, lowP95Sec: low.latencyP95Sec, lowMeanSec: low.latencyMeanSec,
  };
}

export type PolicyMetrics = Record<Policy, Metrics>;

/** Tek bir çizelgeleyiciyi parametrelerle çalıştırır (arayüz, uzun hesabı politika politika bölmek için kullanır). */
export function runPolicy(topo: SchedTopology, samples: LinkSample[], cfg: SchedConfig, params: SweepParams, policy: Policy, override: Partial<SweepParams> = {}, relayId: string = MARS_RELAY): Metrics {
  const c = withParams(cfg, { ...params, ...override }, relayId);
  return metricsOf(simulate(topo, samples, policy, c), c);
}

/** Verilen parametrelerle üç çizelgeleyiciyi aynı bağlantı çizelgesi üzerinde çalıştırır. */
export function runPolicies(topo: SchedTopology, samples: LinkSample[], cfg: SchedConfig, params: SweepParams, override: Partial<SweepParams> = {}, relayId: string = MARS_RELAY): { results: Record<Policy, SimResult>; metrics: PolicyMetrics } {
  const c = withParams(cfg, { ...params, ...override }, relayId);
  const results = {} as Record<Policy, SimResult>;
  const metrics = {} as PolicyMetrics;
  const blackout = hasBlackout(samples);
  for (const p of POLICIES) {
    // kesinti yoksa strateji politikaları öncelikliyle aynıdır: yeniden hesaplamaya gerek yok
    results[p] = !blackout && (p === 'strategy' || p === 'coverage') ? { ...results.priority, policy: p } : simulate(topo, samples, p, c);
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
