// VARSAYIMSAL DEĞERLER — Aşama 2, 3, 4, 5, 7, 8, 9 ve 10'un tüm uydurma sayıları yalnızca bu dosyadadır.
// Buradaki araç, uydu, yörünge, veri hızı ve eşik değerleri gerçek bir göreve ait DEĞİLDİR;
// sonuçlar gerçek bir görev sonucu sayılmamalıdır. Gerçek olan tek şey Horizons konumlarıdır.
// (Cisim yarıçapı ve dönme dönemi gibi fiziksel sabitler src/network/network.ts içinde, gerçek değerlerle.)

import { t } from '../i18n';

export const HYPOTHETICAL_LABEL = t('Varsayımsal değerler');

/** Aşama 11: alternatif değer modeli tanımı (gün cinsinden; timeline.ts `valueModelsConfig` saniyeye çevirir). */
export type ValueCurveSpec =
  | { kind: 'exp'; halfLifeDays: number }
  | { kind: 'step'; deadlineDays: number; after?: number }
  | { kind: 'floor'; halfLifeDays: number; floor: number }
  | { kind: 'linear'; zeroAtDays: number };
export interface ValueModelSpec { id: string; label: string; decay: ValueCurveSpec; top?: ValueCurveSpec }

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

/**
 * Aşama 9: Kepler yörünge elemanları (cisim merkezli, ekliptiğe paralel çerçeve; VARSAYIMSAL, gerçek bir görev yörüngesi değildir).
 * Düzlem eylemsiz sabit kabul edilir (J2 vb. presesyon yok).
 */
export interface OrbitElements {
  /** Yarı büyük eksen (km, cisim merkezinden). */
  semiMajorKm: number;
  ecc: number;
  incDeg: number;
  raanDeg: number;
  argPeriDeg: number;
  /** J2000'deki ortalama anomali (derece). */
  meanAnomalyDeg: number;
}

export interface RelayConfig {
  id: string;
  name: string;
  body: 'moon' | 'mars';
  /** Dairesel, ekvator düzleminde yörünge yüksekliği (km). `orbit` verilirse yok sayılır. */
  altitudeKm: number;
  /** Aşama 9: verilirse Kepler yörüngesi (eğimli/eliptik). Yoksa Aşama 2'nin dairesel ekvatoral yörüngesi. */
  orbit?: OrbitElements;
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
  /** Aşama 9: varsayımsal "bilimsel değer" ağırlığı (birim değer / Mb). Uydurma; bkz. HYPOTHETICAL.value. */
  valuePerMb: number;
}

type BodyKey = 'moon' | 'mars';

export const HYPOTHETICAL = {
  assets: [
    { id: 'ay-1', name: t('Ay Aracı A'), body: 'moon', latDeg: -40, lonDeg: 20, relay: 'ay-aktarma', dataRateKbps: 256, color: '#7ee0a8' },
    { id: 'ay-2', name: t('Ay İniş Aracı B'), body: 'moon', latDeg: 10, lonDeg: -60, relay: 'ay-aktarma', dataRateKbps: 128, color: '#a8d8ff' },
    { id: 'mars-1', name: t('Mars Aracı A'), body: 'mars', latDeg: 18, lonDeg: 77, relay: 'mars-aktarma', dataRateKbps: 2000, color: '#ffb36b' },
    { id: 'mars-2', name: t('Mars Aracı B'), body: 'mars', latDeg: -4, lonDeg: 137, relay: 'mars-aktarma', dataRateKbps: 500, color: '#ff8fa3' },
  ] as AssetConfig[],

  relays: [
    { id: 'ay-aktarma', name: t('Ay Aktarma Uydusu'), body: 'moon', altitudeKm: 3000 },
    { id: 'mars-aktarma', name: t('Mars Aktarma Uydusu'), body: 'mars', altitudeKm: 4500 },
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
      { id: 'telemetri', name: t('Telemetri'), priority: 0, share: 0.15, packetMb: 0.8, color: '#e6ebf5', valuePerMb: 4 },
      { id: 'bilim', name: t('Bilim verisi'), priority: 1, share: 0.85, packetMb: 24, color: '#8a96b2', valuePerMb: 1 },
    ] as TrafficClass[],
    /** Araçların ürettiği veri, "veri hızı" alanının bu kadarıdır (ortalama görev döngüsü). */
    dutyCycle: 0.05,
    /** Araç → aktarma uydusu bağlantı hızı (her araç için ayrı). */
    surfaceLinkKbps: { moon: 1000, mars: 600 } as Record<BodyKey, number>,
    /** Aktarma uydusu → Dünya hızı (uydudaki tüm araçlar paylaşır). */
    relayDownlinkKbps: { 'ay-aktarma': 40, 'ay-aktarma-2': 40, 'mars-aktarma': 250 } as Record<string, number>,
    /** Tampon (depolama) kapasiteleri. */
    assetBufferMb: { moon: 1000, mars: 8000 } as Record<BodyKey, number>,
    relayBufferMb: { 'ay-aktarma': 2000, 'ay-aktarma-2': 2000, 'mars-aktarma': 64000 } as Record<string, number>,
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
      { id: 'yi-a', name: t('Yer İstasyonu A (Kaliforniya benzeri)'), latDeg: 35.4, lonDeg: -116.9 },
      { id: 'yi-b', name: t('Yer İstasyonu B (İspanya benzeri)'), latDeg: 40.4, lonDeg: -4.2 },
      { id: 'yi-c', name: t('Yer İstasyonu C (Avustralya benzeri)'), latDeg: -35.4, lonDeg: 149.0 },
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

  /**
   * Aşama 9, madde 1: havuz projeksiyonunun İYİMSER varsayımlarını kaldıran seçenekler ('coverage', 'rolling', 'adaptive' politikaları kullanır).
   * Varsayılan ikisi de KAPALI: Aşama 3–8 sayıları birebir yeniden üretilir.
   * surfaceClosure: araç tamponundaki veri yüzey hattı (araç → uydu) kapalıyken boşalmaz (iki aşamalı havuz: araç tamponu → uydu payı → Dünya).
   * arqHold: ARQ kopyaları RTT (= 2 × ışık gecikmesi) boyunca uydu tamponunda yer tutar, yani havuzun boşalması RTT kadar gecikir.
   */
  projection: { surfaceClosure: false, arqHold: false },

  /**
   * Aşama 9, madde 2: değer ağırlıklı fayda ölçütü. Sınıfların birim değeri `scheduler.classes[].valuePerMb`'dadır (telemetri 4, bilim verisi 1; UYDURMA).
   * Ölçüt = teslim edilen değer / talep edilen değer. Talep edilen değer = (üretilen + üretilmeyen Mb) × birim değer (yaşı 0).
   * Zamanla azalma (isteğe bağlı, yalnızca bilim verisinde): teslim edilen paketin değeri 2^(−yaş / yarı ömür) ile çarpılır; yaş = teslim anı − üretim anı.
   * Değer ağırlıkları ve yarı ömürler gerçek bir bilimsel değeri temsil ETMEZ; sonucun onlara duyarlılığı taranır.
   */
  value: {
    /** Arayüzde "azalan değer" seçilince varsayılan yarı ömür (gün). */
    decayHalfLifeDays: 14,
    /** Her çalıştırmada eşzamanlı hesaplanan yarı ömürler (gün); tarama bunlar üzerindendir. */
    decayOptionsDays: [3, 7, 14, 30, 90],
    /** Telemetri değerinin bilim verisi değerine oranı taraması (bilim verisi = 1). */
    telemetryWeightScan: [1, 2, 4, 8, 16, 32],
    /**
     * Aşama 11, madde 2: alternatif değer modelleri (hepsi UYDURMA; gerçek bir bilimsel değer ölçüsü değildir). Teslim yaşına (gün) göre değer çarpanı, bilim verisi için:
     * 'exp' = 2^(−yaş/yarı ömür); 'step' = son tarihe kadar 1, sonra `after`; 'floor' = taban + (1 − taban) × üstel (eski veri de değerli kalır); 'linear' = 1'den `zeroAt` günde 0'a.
     * `top`: telemetri de azalır (yoksa sabit değer, Aşama 9-10). Çizelgeleme kararlarını etkilemez, yalnızca ölçüttür.
     */
    models: [
      { id: 'exp14', label: t('üstel, yarı ömür 14 g (kontrol: Aşama 9-10)'), decay: { kind: 'exp', halfLifeDays: 14 } },
      { id: 'step3', label: t('son tarih 3 g (sonra 0)'), decay: { kind: 'step', deadlineDays: 3, after: 0 } },
      { id: 'step14', label: t('son tarih 14 g (sonra 0)'), decay: { kind: 'step', deadlineDays: 14, after: 0 } },
      { id: 'step30', label: t('son tarih 30 g (sonra 0)'), decay: { kind: 'step', deadlineDays: 30, after: 0 } },
      { id: 'step14half', label: t('son tarih 14 g (sonra yarı değer)'), decay: { kind: 'step', deadlineDays: 14, after: 0.5 } },
      { id: 'floor14-30', label: t('üstel 14 g, taban %30 (eskiyince de değerli)'), decay: { kind: 'floor', halfLifeDays: 14, floor: 0.3 } },
      { id: 'floor14-60', label: t('üstel 14 g, taban %60'), decay: { kind: 'floor', halfLifeDays: 14, floor: 0.6 } },
      { id: 'linear30', label: t('doğrusal, 30 günde 0'), decay: { kind: 'linear', zeroAtDays: 30 } },
      { id: 'tel1', label: t('üstel 14 g + telemetri son tarih 1 g'), decay: { kind: 'exp', halfLifeDays: 14 }, top: { kind: 'step', deadlineDays: 1, after: 0 } },
      { id: 'tel3', label: t('üstel 14 g + telemetri son tarih 3 g'), decay: { kind: 'exp', halfLifeDays: 14 }, top: { kind: 'step', deadlineDays: 3, after: 0 } },
    ] as ValueModelSpec[],
  },

  /**
   * Aşama 9, madde 2: uyarlamalı kayan ufuk ('adaptive' politikası). 'rolling' ile aynı havuz projeksiyonu, ama ufuk sabit değil, TAKVİMDEN KAPALI DÖNEMİN UZUNLUĞUNA göre seçilir:
   * şimdi ya da leadDays içinde başlayan ilk kapalı Dünya hattı döneminin sonuna + tailFactor × (dönemin uzunluğu) kadar ileri bakılır, [minDays, maxDays] aralığına kırpılır;
   * yakın kapalı dönem yoksa minDays. Takvim önceden bilinir (tahmin hatası forecast ile taranır).
   */
  adaptiveStrategy: {
    minDays: 1,
    maxDays: 45,
    leadDays: 1,
    /** Kapalı dönem bittikten sonra boşalma (toparlanma) için eklenen süre, dönem uzunluğunun katı. */
    tailFactor: 1,
    margin: 0.9,
    minFactor: 0,
    assetBufferShare: 1,
    refreshSec: 1800,
  },

  /**
   * Aşama 9, madde 3: Ay aktarma uydusu yörünge seçenekleri. Varsayılan 'equatorial' = Aşama 2'nin 3000 km dairesel ekvatoral yörüngesi (eski sonuçlar birebir).
   * 'elliptical': eğimli/eliptik, kutup bölgesini gören (kutupsal, apolün güney kutbu üzerinde); elemanlar UYDURMADIR. Düzlem eylemsiz sabit, presesyon yok.
   * Periapsis yüksekliği ≈ 863 km, apoapsis yüksekliği ≈ 8663 km, dönem ≈ 13 sa.
   */
  moonOrbits: {
    elliptical: { semiMajorKm: 6500, ecc: 0.6, incDeg: 90, raanDeg: 0, argPeriDeg: 90, meanAnomalyDeg: 0 } as OrbitElements,
  },

  /**
   * Aşama 9, madde 3: İKİNCİ Ay aktarma uydusu (isteğe bağlı). Apolünü kuzey kutbu üzerinde olan, birinciyle aynı biçimde eliptik/kutupsal yörünge (faz farkı yarım dönem).
   * Kendi hat hızı ve tamponu vardır (`scheduler.relayDownlinkKbps` / `relayBufferMb` içinde 'ay-aktarma-2'): ikinci uydu kapasiteyi de İKİ KATINA çıkarır; kapsama
   * etkisini kapasite etkisinden ayırmak için aynı kapasiteli tek uydu karşılaştırması da yapılır.
   * Araçlar: 'best' = uyduyu gören(ler) arasında önce Dünya hattı açık olanı, ardından en yüksek yükseklikte olanı kullanır; 'order' = hat sırası (önce birinci uydu, görmüyorsa ikinci).
   */
  moonRelay2: {
    id: 'ay-aktarma-2',
    name: t('Ay Aktarma Uydusu 2'),
    orbit: { semiMajorKm: 6500, ecc: 0.6, incDeg: 90, raanDeg: 0, argPeriDeg: 270, meanAnomalyDeg: 180 } as OrbitElements,
  },

  /**
   * Aşama 9, madde 3: isteğe bağlı Ay kutup aracı (güney kutbuna yakın). Varsayılan KAPALI (topolojiye yalnızca seçilince eklenir; eski sayılar değişmez).
   * Ekvatoral dairesel yörünge bu aracı hiç göremez (Aşama 4 bulgusu); eliptik/kutupsal yörünge görür.
   */
  moonPolarAsset: { id: 'ay-3', name: t('Ay Kutup Aracı C'), body: 'moon', latDeg: -85, lonDeg: 30, relay: 'ay-aktarma', dataRateKbps: 128, color: '#e8a8ff' } as AssetConfig,

  /**
   * Aşama 9, madde 3: Mars aktarma uydusu gölgesi (tutulma). Silindirik gölge (Güneş yönü Mars'ın Güneş'e göre konumundan; Mars ekseni ekliptiğe paralel varsayıldığı için
   * ekvator yörüngeli uydu her turda gölgeden geçer; gerçekte eksen eğikliği (≈25°) mevsimsel olarak gölgeyi azaltır/kaldırır). GÜÇ MODELİ YOK: gölgede yalnızca
   * hat kapalı sayılır ('earth': yalnız uydu → Dünya hattı; 'both': yüzey hattı da). Tamponlar çalışmaya devam eder.
   */
  marsEclipse: { modes: ['none', 'earth', 'both'] as const },

  /**
   * Aşama 9: Mars aktarma hattının kavuşumsuz serbest tarih aralığı senaryosu (arayüzde "Mars aktarma hattı (tarih aralığı, kavuşumsuz)"). Varsayılan aralık hiçbir kavuşum
   * penceresiyle (2028-03, 2030-05) kesişmez; Mars gölgesinin (marsEclipse) cisim arkası kapanmasıyla örtüşmeden etkisini görmek için.
   */
  marsFreeScenario: { defaultStart: '2029-06-01', defaultDays: 60 },

  /**
   * Aşama 9, madde 4: genelleme taraması. Ay için ≥ 3 farklı tarih aralığı (60 gün; Ay'ın yer istasyonlarından görünürlüğü, Ay'ın bahar/kış durağanlık evresine
   * (≈18,6 yıllık düğüm döngüsü) göre değişir: 2025 civarı büyük durağanlık, 2034 civarı küçük) ve Mars'ın 9 penceresi.
   */
  generalization: {
    moonStarts: ['2021-03-01', '2025-09-01', '2028-03-03', '2034-05-01', '2038-01-15'],
    moonDays: 60,
  },
  /**
   * Aşama 10, madde 1: değere duyarlı kuyruk politikası ('valueAware', 'valueAdaptive'). YALNIZCA azalan değer modeli seçiliyken (yarı ömür seçili) devreye girer; yoksa 'priority' ile birebir aynıdır.
   * expireBelow: bilim paketinin değeri başlangıç değerinin bu oranının altına inince tamponda atılır (0,25 = iki yarı ömür sonra). newestFirst: bilim verisi en yeni önce gönderilir
   * (üstel azalmada, kapasite kısıtlıyken toplam değeri en çok artıran sıra). evictOldest: tampon dolunca en eski bilim paketi atılıp yeni veriye yer açılır.
   * Eşik ve kuralların kendisi UYDURMADIR; varsayılan "hepsi açık". Taranan değerler `scan`'dedir.
   */
  valueAware: {
    expireBelow: 0.25,
    newestFirst: true,
    evictOldest: true,
    scanSec: 3600,
    scan: { expireBelow: [0, 0.5, 0.25, 0.1, 0.03] },
  },

  /**
   * Aşama 10, madde 2: takvim hatasına dayanıklı uyarlamalı ufuk ('adaptiveRobust'). 'adaptive' ile aynı parametreler (adaptiveStrategy) + korumalar:
   * capSec (ufuk üst sınırı, kavuşum içermeyen kapalı dönemler için), histFactor (kapalı dönem uzunluğu, gözlenen en uzun kapalı dönemin bu katını aşamaz; geçmişte kapalı dönem
   * yoksa fallbackSec), trustMin/checkSec (son checkSec'te takvim gerçekte açık olan adımların bu oranından azını açık gösteriyorsa takvime güvenme, fallbackSec ufku).
   * Değerler UYDURMADIR (ayarlama: README bölüm 2).
   */
  adaptiveRobust: {
    /** Ufuk üst sınırı (gün; kavuşum içermeyen kapalı dönemler için); 0 = kapalı. Tek başına çöküşü gidermedi (README bölüm 2), bu yüzden varsayılan kapalı. */
    capDays: 0,
    histFactor: 2,
    histDays: 7,
    trustMin: 0.3,
    checkDays: 2,
    /** Geri çekilme ufku (gün); 0 = güvenilmeyen takvimde kısma yok (öncelikli kuralı). */
    fallbackDays: 0,
    /**
     * Aşama 11: takvim hatasını gözlemden düzeltme (varsayılan KAPALI; seçenek). Strateji geçmişte tamamlanmış gerçek pencereleri tahmin pencereleriyle karşılaştırıp kaymayı tahmin eder.
     * learnDays: öğrenme penceresi (gün); minWindows: en az gözlenen pencere sayısı; maxShiftHours: bundan büyük tahmin edilen kayma uydurma sayılır, düzeltilmez. Değerler UYDURMADIR.
     */
    correct: { learnDays: 7, minWindows: 3, maxShiftHours: 6 },
  },

  /**
   * Aşama 10, madde 3: gerçek çok uydulu yönlendirme. select: araç uydu seçimi ('timeline' = Aşama 9 çizelge seçimi; 'leastFilled' = görünen uydular arasında tamponu en az dolu; 'openFirst' =
   * önce Dünya hattı açık olanlar). isl: uydular arası bağlantı (yalnızca ikinci Ay uydusu varken; iki uydu arasında Ay'ın engellemediği görüş hattı ve en çok maxKm mesafe; hız kbps).
   * Menzil ve hız UYDURMADIR.
   */
  routing: { islMaxKm: 30000, islKbps: 100 },

  /**
   * Aşama 10, madde 4a: Ay yörüngesi için basit presesyon (SEÇENEK, varsayılan kapalı; yalnızca eliptik/eğimli yörüngede anlamlı). Düğüm (RAAN) ve periapsis argümanı, epochJD'den itibaren
   * sabit hızla kayar (derece/gün). Hızlar UYDURMADIR (gerçek ELFO/NRHO presesyonu bu basit modelle bulunmaz). scan: B aracı kaybının duyarlılığı için taranan RAAN hızları (gün başına derece);
   * −13,2 ≈ Ay'ın dönme hızı ters yönde (düzlem Ay yüzeyine göre yaklaşık sabit kalır).
   */
  moonPrecession: {
    epochJD: Date.UTC(2028, 2, 3) / 86400000 + 2440587.5,
    raanRateDegPerDay: -1,
    argPeriRateDegPerDay: 0,
    scan: [-13.2, -5, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 13.2],
  },

  /**
   * Aşama 10, madde 4b: Mars eksen eğikliği (SEÇENEK 'tilted', varsayılan 'parallel' = eksen ekliptiğe paralel). Eksen yönü (ICRS RA/Dec) bir VARSAYIMDIR (≈ gerçek değere yakın seçildi, doğrulanmadı;
   * yaklaşık 25° eğiklik). Seçilince Mars aktarma uydusunun yörünge düzlemi ve yüzey araçlarının kutup ekseni bu eksene göre döner (tutarlı çerçeve: gölge, cisim arkası kapanma ve görüş birlikte değişir).
   */
  marsAxis: { raDeg: 317.68, decDeg: 52.89, obliquityDeg: 23.4392911 },

  /**
   * Aşama 10, madde 4c: çok basit güç modeli (SEÇENEK, marsEclipse = 'power'; varsayılan kapalı = "gölgede hat kapalı" modları). Batarya gölgede boşalır, güneşte dolar; yük = taban yük + (hat
   * etkinse) hat yükü. Doluluk cutoffFrac'ın altına inince hat (yüzey + Dünya) kapanır, resumeFrac'ın üstüne çıkınca açılır. Tüm değerler UYDURMADIR (gerçek bir uydunun güç bütçesi değildir).
   */
  marsPower: {
    batteryWh: 700,
    solarW: 700,
    baseLoadW: 300,
    linkLoadW: 350,
    cutoffFrac: 0.2,
    resumeFrac: 0.5,
    initialFrac: 1,
    scanBatteryWh: [450, 550, 700, 900, 1500],
  },

  /**
   * Aşama 10, madde 5: telemetri denemesi. packetMb: daha küçük/sık telemetri paketi taraması (varsayılan 0,8). reservedShare: telemetri için ayrılmış Dünya hattı payı
   * (SchedConfig.telemetryShare; hız oranı; kullanılmayan pay bilim verisine geçer, yani işi bırakmaz): öncelikli kuyrukta telemetri zaten önce gittiği için etkisi yok beklenir, FIFO'da
   * anlamlıdır. minFactor: telemetri de kısılırsa çarpanın alt sınırı (SchedConfig.telemetryMinFactor; 1 = kısma yok). Değerler UYDURMADIR.
   */
  telemetry: { packetMb: [0.8, 0.4, 0.2, 0.1], reservedShare: [0, 0.1, 0.25, 0.5], minFactor: [1, 0.75, 0.5, 0.25, 0] },
};
