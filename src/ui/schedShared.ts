// Çizelgeleyici sekmesinin ortak yardımcıları (biçim, renk, grafik seçenekleri, senaryo tipi, değer modeli seçimi). Tüm sayılar VARSAYIMSALDIR.
import { HYPOTHETICAL } from '../config/hypothetical';
import { jdToDate } from '../map/ephemeris';
import type { BlackoutWindow, NetOptions } from '../network/network';
import type { Policy } from '../network/scheduler';
import type { ValueOpts } from '../network/sweep';

export const fmt = (n: number, d = 0) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const day = (jd: number) => jdToDate(jd).toISOString().slice(0, 10);
export const year = (jd: number) => 1970 + (jd - 2440587.5) / 365.2425;
export const signed = (n: number, d = 1) => { const r = Math.round(Math.abs(n) * 10 ** d) / 10 ** d; return r === 0 ? fmt(0, d) : `${n > 0 ? '+' : '−'}${fmt(r, d)}`; };

// Seriler: FIFO = mavi, öncelikli = turuncu, strateji = yeşil, kapsama bilen strateji = mor, kayan ufuklu = sarı, uyarlamalı = camgöbeği (koyu yüzeyde ayırt edilen kategorik renkler). Metin rengi seri rengi değildir.
export const C = { fifo: '#3987e5', prio: '#d95926', strat: '#3fb68b', stratLoss: '#9be3c6', cov: '#b88cf2', covLoss: '#dcc5fa', roll: '#e8c13d', rollLoss: '#f5e2a0', adapt: '#2fd4e0', adaptLoss: '#a8eef2', moon: '#cfcfcf', mars: '#d9593a', text: '#8a96b2', grid: '#1e2740', ink: '#e6ebf5' };
export const NAME: Record<Policy, string> = { fifo: 'FIFO', priority: 'Öncelikli', strategy: 'Strateji', coverage: 'Kapsama bilen strateji', rolling: 'Kayan ufuklu strateji', adaptive: 'Uyarlamalı ufuk' };
export const COLOR: Record<Policy, string> = { fifo: C.fifo, priority: C.prio, strategy: C.strat, coverage: C.cov, rolling: C.roll, adaptive: C.adapt };
export const DASH: Record<Policy, number[] | undefined> = { fifo: undefined, priority: [6, 3], strategy: [2, 2], coverage: [10, 3, 2, 3], rolling: [2, 4], adaptive: [8, 3, 1, 3] };
/** Kavuşum kesintisi olmayan hatlarda (Ay, kavuşumsuz Mars aralığı) Aşama 4/7 stratejileri kısma yapmaz (öncelikliyle aynı) ve gösterilmez. */
export const NOBLACKOUT_POLICIES: Policy[] = ['fifo', 'priority', 'rolling', 'adaptive'];

export const baseOpts = (xTitle: string, yTitle: string, extra: Record<string, unknown> = {}) => ({
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
  plugins: { legend: { labels: { color: C.ink, boxWidth: 12 } } },
  scales: {
    x: { title: { display: true, text: xTitle, color: C.text }, ticks: { color: C.text }, grid: { color: C.grid } },
    y: { title: { display: true, text: yTitle, color: C.text }, ticks: { color: C.text }, grid: { color: C.grid }, beginAtZero: true },
  },
  ...extra,
});

export type ScenKind = 'mars' | 'moon';
/**
 * Bir senaryo: hangi aktarma hattı, hangi tarih aralığı, hangi ağ seçenekleri (Aşama 9). Mars: kavuşum penceresi ± pay (blackout var) ya da serbest tarih aralığı (free, kavuşumsuz).
 * Ay: serbest tarih aralığı (kavuşum yok).
 */
export interface Scen { kind: ScenKind; key: string; relayId: string; relayName: string; startJD: number; endJD: number; blackout?: BlackoutWindow; free?: boolean; net: NetOptions; policies: Policy[]; sweepPolicies: Policy[] }

/** Değer ölçütü seçimi (sayfa genelinde paylaşılır): telemetri birim değeri (bilim verisi = config ağırlığı) ve bilim verisi için zamanla azalma yarı ömrü (HYPOTHETICAL.value.decayOptionsDays sırası; yoksa sabit değer). */
export const valueModel: { telemetryWeight: number; halfLifeIdx: number | undefined } = { telemetryWeight: HYPOTHETICAL.scheduler.classes[0].valuePerMb, halfLifeIdx: undefined };
export const valueOpts = (): ValueOpts => ({ weightOf: (p) => (p.decays ? p.weight : valueModel.telemetryWeight), halfLifeIdx: valueModel.halfLifeIdx });
export const valueModelLabel = () =>
  `telemetri ${fmt(valueModel.telemetryWeight)} · bilim verisi ${fmt(HYPOTHETICAL.scheduler.classes[1].valuePerMb)} birim/Mb${valueModel.halfLifeIdx === undefined ? ', sabit değer' : `, bilim verisi değeri zamanla azalır (yarı ömür ${fmt(HYPOTHETICAL.value.decayOptionsDays[valueModel.halfLifeIdx])} gün)`}`;
