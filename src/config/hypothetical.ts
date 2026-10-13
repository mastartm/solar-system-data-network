// VARSAYIMSAL DEĞERLER — Aşama 2 ve 3'ün tüm uydurma sayıları yalnızca bu dosyadadır.
// Buradaki araç, uydu, yörünge, veri hızı ve eşik değerleri gerçek bir göreve ait DEĞİLDİR;
// sonuçlar gerçek bir görev sonucu sayılmamalıdır. Gerçek olan tek şey Horizons konumlarıdır.
// (Cisim yarıçapı ve dönme dönemi gibi fiziksel sabitler src/network/network.ts içinde, gerçek değerlerle.)

export const HYPOTHETICAL_LABEL = 'Varsayımsal değerler';

export interface AssetConfig {
  id: string;
  name: string;
  body: 'moon' | 'mars';
  /** Yüzey konumu (derece). */
  latDeg: number;
  lonDeg: number;
  /** Bağlandığı aktarma uydusu. */
  relay: string;
  /** Üretilen veri hızı (kbit/sn) — panelde gösterilir, animasyon sıklığını belirler. */
  dataRateKbps: number;
  color: string;
}

export interface RelayConfig {
  id: string;
  name: string;
  body: 'moon' | 'mars';
  /** Dairesel, ekvator düzleminde yörünge yüksekliği (km). */
  altitudeKm: number;
}

export interface TrafficClass {
  id: string;
  name: string;
  /** Küçük sayı = yüksek öncelik. */
  priority: number;
  /** Üretilen verinin bu sınıfa düşen payı (toplam 1'e normalleştirilir). */
  share: number;
  /** Paket boyutu (megabit). Paket "toplu" veri parçasıdır; gerçek bir protokol paketi değildir. */
  packetMb: number;
  color: string;
}

type BodyKey = 'moon' | 'mars';

export const HYPOTHETICAL = {
  assets: [
    { id: 'ay-1', name: 'Ay Aracı A', body: 'moon', latDeg: -85, lonDeg: 20, relay: 'ay-aktarma', dataRateKbps: 256, color: '#7ee0a8' },
    { id: 'ay-2', name: 'Ay İniş Aracı B', body: 'moon', latDeg: 10, lonDeg: -60, relay: 'ay-aktarma', dataRateKbps: 128, color: '#a8d8ff' },
    { id: 'mars-1', name: 'Mars Aracı A', body: 'mars', latDeg: 18, lonDeg: 77, relay: 'mars-aktarma', dataRateKbps: 2000, color: '#ffb36b' },
    { id: 'mars-2', name: 'Mars Aracı B', body: 'mars', latDeg: -4, lonDeg: 137, relay: 'mars-aktarma', dataRateKbps: 500, color: '#ff8fa3' },
  ] as AssetConfig[],

  relays: [
    { id: 'ay-aktarma', name: 'Ay Aktarma Uydusu', body: 'moon', altitudeKm: 3000 },
    { id: 'mars-aktarma', name: 'Mars Aktarma Uydusu', body: 'mars', altitudeKm: 4500 },
  ] as RelayConfig[],

  /** Mars kavuşumunda iletişim kesintisi: Dünya'dan bakınca Güneş–Mars açısı bu eşiğin altına inerse bağlantı kesilir. */
  conjunctionBlackoutAngleDeg: 3,

  /** Animasyon (üslup gereği; ölçekli değildir, gerçek gecikme panelde sayıyla verilir). */
  animation: {
    spawnSecondsAt100Kbps: 3,       // paket aralığı = bu × √(100 / veri hızı); hız arttıkça sıklaşır
    legSeconds: [1.4, 2.8] as [number, number], // araç→uydu, uydu→Dünya
    maxPacketsPerAsset: 8,
  },

  /** Aşama 3: çizelgeleyici. Birimler: megabit (Mb), kbit/sn. Hepsi uydurmadır. */
  scheduler: {
    classes: [
      { id: 'telemetri', name: 'Telemetri', priority: 0, share: 0.15, packetMb: 0.8, color: '#e6ebf5' },
      { id: 'bilim', name: 'Bilim verisi', priority: 1, share: 0.85, packetMb: 24, color: '#8a96b2' },
    ] as TrafficClass[],
    /** Araçların ürettiği veri, "veri hızı" alanının bu kadarıdır (ortalama görev döngüsü). */
    dutyCycle: 0.05,
    /** Araç → aktarma uydusu bağlantı hızı (her araç için ayrı). */
    surfaceLinkKbps: { moon: 1000, mars: 600 } as Record<BodyKey, number>,
    /** Aktarma uydusu → Dünya hızı (uydudaki tüm araçlar paylaşır). */
    relayDownlinkKbps: { 'ay-aktarma': 40, 'mars-aktarma': 250 } as Record<string, number>,
    /** Tampon (depolama) kapasiteleri. */
    assetBufferMb: { moon: 1000, mars: 8000 } as Record<BodyKey, number>,
    relayBufferMb: { 'ay-aktarma': 2000, 'mars-aktarma': 64000 } as Record<string, number>,
    /** Kuyrukta bu süreden uzun bekleyen teslimler "gecikmeli" sayılır. */
    delayedAfterSec: 3600,
    /** Simülasyon adımı ve grafik örnekleme aralığı. */
    stepSec: 300,
    seriesEverySec: 3600,
    /** Karşılaştırma senaryosu: Mars kavuşum penceresinden önce/sonra simüle edilen gün sayısı. */
    scenarioPadDays: { before: 5, after: 30 },
  },
};
