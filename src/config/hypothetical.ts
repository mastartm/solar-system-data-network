// VARSAYIMSAL DEĞERLER — Aşama 2, 3, 4, 5, 7 ve 8'in tüm uydurma sayıları yalnızca bu dosyadadır.
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

export interface GroundStationConfig {
  id: string;
  name: string;
  /** Jeodezik değil, küresel Dünya varsayımı (derece). */
  latDeg: number;
  lonDeg: number;
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
    { id: 'ay-1', name: 'Ay Aracı A', body: 'moon', latDeg: -40, lonDeg: 20, relay: 'ay-aktarma', dataRateKbps: 256, color: '#7ee0a8' },
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

  /**
   * Aşama 4: kavuşum stratejisi ("bütçeli kısma"). Telemetri (en önemli sınıf) hiç kısılmaz; diğer sınıfların (bilim verisi) ÜRETİMİ,
   * uydu hattındaki boş tampon kesintinin kalan süresine yetecek kadar kısılır. Kısılan veri "kayıp" değil "üretilmeyen" sayılır
   * (hiç üretilmedi, tampona girmedi); karşılaştırma talep (= üretilen + üretilmeyen) üzerinden yapılır.
   * Varsayım: kesintinin başlangıç ve bitişi önceden bilinir (Güneş–Mars geometrisi öngörülebilir).
   */
  strategy: {
    /** Kesintiye bu kadar gün kala kısma başlar (kesinti boyunca sürer). */
    lookaheadDays: 1,
    /** Boş tamponun bu oranı bilim verisi bütçesidir; kalanı telemetri ve yuvarlama payıdır. */
    margin: 0.9,
    /** Kısılabilir sınıfların üretim çarpanının alt sınırı (0 = tamamen durdurulabilir). */
    minFactor: 0,
  },

  /** Aşama 4: duyarlılık analizi. Kaydırıcı başlangıçları yukarıdaki değerlerdir; buradaki min/max yalnızca kaydırıcı ve tarama aralığıdır. Mars değerleri değişir; Ay değerleri sabit kalır. */
  sensitivity: {
    /** Tarama (ve kaydırıcıyla yeniden hesap) için daha kaba adım; ana senaryo scheduler.stepSec ile çalışır. */
    sweepStepSec: 1800,
    /** Tarama grafiğindeki nokta sayısı. */
    sweepPoints: 5,
    marsRelayBufferMb: { min: 8000, max: 160000, step: 2000 },
    marsRelayDownlinkKbps: { min: 100, max: 600, step: 10 },
    dutyCycle: { min: 0.02, max: 0.15, step: 0.005 },
    /** Aşama 7: Ay hattı senaryosunda kaydırıcıların aralığı (başlangıçlar scheduler.* değerleridir). */
    moonRelayBufferMb: { min: 500, max: 16000, step: 250 },
    moonRelayDownlinkKbps: { min: 10, max: 100, step: 5 },
  },

  /**
   * Aşama 5: yer istasyonları. Konumlar derin uzay istasyonlarına benzer SEÇİLMİŞTİR ama gerçek tesis verisi DEĞİLDİR (varsayımsal).
   * Bir aktarma uydusunun Dünya hattı, en az bir istasyon uyduyu minElevationDeg üstünde görüyorsa açıktır (anlık devir, tek hat).
   * Dünya küresel ve dönüşü GMST ile (TDB ≈ UT1 farkı ~1 dk önemsenmedi) modellenir.
   */
  groundStations: {
    minElevationDeg: 10,
    stations: [
      { id: 'yi-a', name: 'Yer İstasyonu A (Kaliforniya benzeri)', latDeg: 35.4, lonDeg: -116.9 },
      { id: 'yi-b', name: 'Yer İstasyonu B (İspanya benzeri)', latDeg: 40.4, lonDeg: -4.2 },
      { id: 'yi-c', name: 'Yer İstasyonu C (Avustralya benzeri)', latDeg: -35.4, lonDeg: 149.0 },
    ] as GroundStationConfig[],
  },

  /**
   * Aşama 5: hat hatası ve yeniden iletim (ARQ). Rastgelelik YOK: kayıp oranı belirleyici bir biriktiriciyle uygulanır
   * (her hatta her paket denemesi için oran birikir, 1'i geçince o deneme kaybolur). Yüzey hattında RTT adımdan çok kısa
   * (yeniden deneme aynı adımda); Dünya hattında gönderici paketi RTT (= 2 × ışık gecikmesi) boyunca tamponunda tutar,
   * ACK/NAK sonrası bırakır ya da yeniden gönderir. maxAttempts denemede iletilemeyen paket "hatta kayıp" sayılır.
   */
  arq: {
    surfaceLossPct: 1,
    earthLossPct: 5,
    maxAttempts: 4,
    /**
     * Aşama 8: yüzey hattında (araç → uydu) kaybolan denemenin yeniden deneneceği en erken gecikme (sn). 0 = aynı adımda (Aşama 5-7: RTT ≈ 0 varsayımı,
     * sayılar buna göre). > 0: paket tamponda yer tutarak bekler, sonra yeniden denenir. Gerçek bir yüzey hattının yeniden deneme aralığını bilmiyorum.
     */
    surfaceRetrySec: 0,
    /** Hata/ARQ kaydırıcısının aralığı (Dünya hattı kaybı, %). */
    earthLossRangePct: { min: 0, max: 40, step: 1 },
    /**
     * Aşama 7: kümelenmiş hata modeli (Gilbert–Elliott benzeri iki durum, "Kümelenmiş hata + yeniden iletim" hat modu). Rastgelelik YOK:
     * durum zinciri sabit tohumlu kendi üretecimizle üretilir. Ortalama kayıp yukarıdaki yüzey/Dünya kaybıdır (periyodik modelle aynı),
     * burada yalnızca iyi/kötü durum kayıpları ve kötü durumun süresi vardır. Değerler uydurmadır, gerçek bir hat ölçümü değildir.
     */
    burst: {
      goodLossPct: 0.5,
      badLossPct: 80,
      /** Kötü durumun ortalama süresi (sn): 30 dk. */
      meanBadSec: 1800,
      seed: 20281031,
    },
  },

  /**
   * Aşama 7: kapsama bilen strateji. Aşama 4'ün stratejisinin (strategy) yanında yeni politika; bütçeye kavuşum sonrası boşaltma
   * kapasitesini (yer istasyonu kapsaması + hat hızı) katar. Varsayım: bağlantı takvimi önceden bilinir (yörünge ve Dünya dönüşü öngörülebilir);
   * ortalama hat kaybı bilinir. Kesintiye lookaheadDays kala başlar, kesinti boyunca ve bittikten sonra recoveryDays boyunca sürer.
   */
  coverageStrategy: {
    lookaheadDays: 1,
    recoveryDays: 30,
    /** Tepe doluluk, bütçe havuzunun bu oranını geçmeyecek şekilde kısılır (Aşama 4 stratejisiyle aynı pay). */
    margin: 0.9,
    /**
     * Bütçe havuzuna katılan araç tamponu oranı (0–1). 1 = araç tamponu + uydu tamponunun hız payı (Aşama 4 ile aynı havuz; karşılaştırma
     * yalnızca boşaltma kapasitesi terimini ölçer). 0 = yalnızca uydu tamponu: uydu tamponu dolunca telemetri düşük sınıfı atarak girdiği
     * için "düşen" daha da azalır ama daha çok kısılır (README'de duyarlılık).
     */
    assetBufferShare: 1,
    minFactor: 0,
  },

  /**
   * Aşama 8: kayan ufuklu akış kontrolü ('rolling' politikası). 'coverage' ile aynı havuz projeksiyonu, ama kesinti işaretine değil bağlantı takvimindeki
   * HER kapalı hat dönemine (kavuşum, yer istasyonu boşluğu, cisim arkası) uygulanır: her refreshSec'te önümüzdeki rollingDays boyunca ileri izlenir.
   * Varsayım: bağlantı takvimi ve ortalama hat kaybı önceden bilinir (tahmin hatası ayrıca taranır: forecastScan).
   */
  rollingStrategy: {
    /** Kayan ufuk (gün). Mars kavuşumunun (≈ 17–27 gün) tamamını görmek için ≳ 30 gün gerekir; Ay'da yer istasyonu boşlukları saatlerdir. */
    rollingDays: 3,
    /** Seçilebilir ufuklar (gün; arayüz ve ufuk taraması). */
    rollingDaysOptions: [0.5, 1, 3, 10, 30, 45],
    margin: 0.9,
    minFactor: 0,
    assetBufferShare: 1,
    /** Çarpanın yeniden hesaplanma aralığı (sn); yalnızca hesap maliyetini düşürür. */
    refreshSec: 1800,
  },

  /**
   * Aşama 8: tahmin hatası taraması. Hatalar belirleyici, sabit sapmalardır (rastgelelik yok). Tarama adımı (sn) ana senaryodan daha kabadır (hesap süresi);
   * pencere kayması adıma yuvarlanır, bu yüzden değerler adımın katı seçildi.
   */
  forecastScan: {
    stepSec: 600,
    /** Pencere başı/sonu genişletme (+: iyimser) ya da daraltma (−) ve pencere öteleme, dakika. */
    edgeShiftMin: [-120, -60, -30, 0, 30, 60, 120],
    offsetMin: [-120, -60, -30, 0, 30, 60, 120],
    /** Ortalama kayıp tahmininin gerçeğe göre bağıl sapması (%); −100: kayıp yok sanılır. */
    lossBiasPct: [-100, -50, 0, 50, 100, 200],
  },

  /**
   * Aşama 8: hata modeli duyarlılığı (kümelenmiş model, öncelikli çizelge). Taranan değerler: kötü durum kaybı (%), kötü durumun ortalama süresi (sn),
   * yüzey hattı yeniden deneme aralığı (sn). Tarama adımı forecastScan.stepSec ile aynıdır (zincir adımı kötü durum süresinden küçük kalsın diye
   * meanBadSec ≥ adım).
   */
  errorScan: {
    badLossPct: [20, 40, 60, 80, 100],
    meanBadSec: [600, 1200, 1800, 3600, 7200],
    surfaceRetrySec: [0, 600, 1800, 3600, 7200],
  },

  /**
   * Aşama 7: Ay hattı senaryosu (arayüz). Ay'da kavuşum yok; pencere serbest bir tarih aralığıdır. Varsayılan, Aşama 5 README tablosundaki
   * pencereye (2028-03-03 – ~2028-05-03) yakındır.
   */
  moonScenario: {
    defaultStart: '2028-03-03',
    defaultDays: 60,
    lengthOptions: [7, 14, 30, 60],
  },
};
