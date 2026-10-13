// Duyarlılık analizi: saf fonksiyonlar (DOM yok, rastgelelik yok). Tarayıcıyı dondurmamak için
// çağıran (arayüz) noktaları tek tek hesaplar ve aralarda tarayıcıya nefes aldırır.
// Tüm değerler varsayımsaldır; sonuçlar gerçek bir görev sonucu değildir.
import { simulate, type LinkSample, type Policy, type SchedConfig, type SchedTopology, type SimResult } from './scheduler';
import { withParams, type SweepParams } from './timeline';

export const POLICIES: Policy[] = ['fifo', 'priority', 'strategy'];
export type SweepKey = keyof SweepParams;

/** Bir çizelgeleyici çalıştırmasının karşılaştırma ölçütleri. Talep = üretilen + üretilmeyen (Mb). */
export interface Metrics {
  demandMb: number;
  deliveredMb: number;
  droppedMb: number;
  suppressedMb: number;
  /** Düşen / talep (%). Kısılan (üretilmeyen) veri BURADA kayıp sayılmaz. */
  dropPct: number;
  /** (Düşen + üretilmeyen) / talep (%). Stratejiyi haksız avantajdan koruyan, kısmayı da "kaybedilen" sayan ölçüt. */
  lossPct: number;
  /** En önemli sınıfın (telemetri) düşen Mb / kendi talebi (%). Bu sınıf kısılmaz. */
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
    dropPct: pct(t.droppedMb), lossPct: pct(t.droppedMb + t.suppressedMb), deliveredPct: pct(t.deliveredMb), topDropPct: topDemand > 0 ? (100 * top.droppedMb) / topDemand : 0,
    topP95Sec: top.latencyP95Sec, topMeanSec: top.latencyMeanSec, lowP95Sec: low.latencyP95Sec, lowMeanSec: low.latencyMeanSec,
  };
}

export type PolicyMetrics = Record<Policy, Metrics>;

/** Tek bir çizelgeleyiciyi parametrelerle çalıştırır (arayüz, uzun hesabı politika politika bölmek için kullanır). */
export function runPolicy(topo: SchedTopology, samples: LinkSample[], cfg: SchedConfig, params: SweepParams, policy: Policy, override: Partial<SweepParams> = {}): Metrics {
  const c = withParams(cfg, { ...params, ...override });
  return metricsOf(simulate(topo, samples, policy, c), c);
}

/** Verilen parametrelerle üç çizelgeleyiciyi aynı bağlantı çizelgesi üzerinde çalıştırır. */
export function runPolicies(topo: SchedTopology, samples: LinkSample[], cfg: SchedConfig, params: SweepParams, override: Partial<SweepParams> = {}): { results: Record<Policy, SimResult>; metrics: PolicyMetrics } {
  const c = withParams(cfg, { ...params, ...override });
  const results = {} as Record<Policy, SimResult>;
  const metrics = {} as PolicyMetrics;
  for (const p of POLICIES) { results[p] = simulate(topo, samples, p, c); metrics[p] = metricsOf(results[p], c); }
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
export const sweepPoint = (topo: SchedTopology, samples: LinkSample[], cfg: SchedConfig, params: SweepParams, key: SweepKey, value: number) =>
  runPolicies(topo, samples, cfg, params, { [key]: value } as Partial<SweepParams>).metrics;
