// Çizelgeleyici: saf fonksiyon, rastgelelik yok, DOM/Horizons bağımlılığı yok.
// Giriş: topoloji + bağlantı zaman çizelgesi (adım adım açık/kapalı + ışık gecikmesi) + ayarlar.
// İki atlama: araç → aktarma uydusu → Dünya. Her düğümde sınırlı bir tampon var.
// Tüm sayılar (hızlar, boyutlar, kapasiteler) çağıranın verdiği ayarlardan gelir; varsayılanı
// src/config/hypothetical.ts içindeki VARSAYIMSAL değerlerdir. Sonuçlar gerçek bir görev sonucu değildir.

/**
 * 'fifo' ve 'priority': yalnızca sıralama/atma kuralı. 'strategy': 'priority' + kavuşum stratejisi
 * (bilim verisi üretimini kısma). Strateji kapalı sınıf (en önemli sınıf) hiç kısılmaz.
 * 'coverage' (Aşama 7): 'strategy' ile aynı kısma kuralı, ama bütçeyi yalnızca boş tampondan değil, kavuşum SONRASI boşaltma
 * kapasitesinden de (yer istasyonu kapsaması + hat hızı; önceden bilinen takvim) hesaplar. 'strategy' olduğu gibi korunur.
 * 'rolling' (Aşama 8): kayan ufuklu akış kontrolü. 'coverage' ile aynı havuz projeksiyonu, ama kesinti işaretine bağlı değil: her refreshSec'te
 * önümüzdeki rollingSec boyunca (bağlantı takviminden öngörülebilen HER kapalı hat dönemi: kavuşum, yer istasyonu boşluğu, cisim arkası) tampon
 * projekte edilir; böylece Ay senaryosunda da çalışır. 'strategy' ve 'coverage' olduğu gibi korunur.
 * 'adaptive' (Aşama 9): 'rolling' ile aynı projeksiyon, ama ufuk sabit değil: takvimdeki yakın kapalı hat döneminin UZUNLUĞUNA göre seçilir (AdaptiveConfig).
 * Aşama 10 (hepsi seçenek; yapılandırma yoksa ilgili politika sırasıyla 'priority' / 'adaptive' ile BİREBİR aynıdır):
 * 'valueAware': 'priority' + değere duyarlı kuyruk kuralı (ValueAwareConfig: bilim verisinde eski paketleri yeniden sırala / at); üretimi KISMAZ.
 * 'valueAdaptive': 'adaptive' kısması + aynı kuyruk kuralı (kısma ile birlikte).
 * 'adaptiveRobust': 'adaptive' ile aynı, ama takvim hatasına dayanıklı ufuk seçimi (AdaptiveRobustConfig).
 */
export type Policy = 'fifo' | 'priority' | 'strategy' | 'coverage' | 'rolling' | 'adaptive' | 'valueAware' | 'valueAdaptive' | 'adaptiveRobust';

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
  /**
   * Yüzey hattında (araç → uydu) kaybolan denemenin yeniden deneneceği en erken gecikme (sn). 0 / yok: aynı adımda (Aşama 5-7 davranışı, RTT ≈ 0).
   * > 0: paket tamponda yer tutarak (kuyruk dışı) bu süre bekler, sonra başa konup yeniden denenir; bu sırada hat başka paketlere devam eder.
   */
  surfaceRetrySec?: number;
  /** Bir hatta bir paket için en çok deneme sayısı; aşılırsa paket "hatta kayıp" (abandoned) sayılır. */
  maxAttempts: number;
  /** Yoksa kayıp periyodiktir (biriktirici); varsa iki durumlu kümelenmiş model kullanılır. */
  burst?: BurstConfig;
}

/**
 * Kapsama bilen strateji (Aşama 7). Varsayım: bağlantı takvimi (yörünge, Dünya dönüşü, yer istasyonu görüşü, kavuşum) ve ARQ'nun
 * ortalama kaybı önceden bilinir. Kesintiye lookaheadSec kala, kesinti boyunca ve bittikten sonra recoverySec boyunca, her araç için
 * üretim çarpanı şöyle seçilir: tampon (araç + uydunun hız oranındaki payı) ileriye doğru izlenir; hat açıkken boşalır (hat hızı × ortalama
 * başarı oranı × pay), kapalıyken (kavuşum, istasyon görmüyor, cisim arkası) boşalmaz; tepe doluluk margin × kapasiteyi aşmayacak
 * en büyük çarpan (ikili aramayla) seçilir. Telemetri (en önemli sınıf) kısılmaz.
 */
export interface CoverageConfig {
  lookaheadSec: number;
  /** Kesinti bittikten sonra boşaltma kapasitesinin hesaba katıldığı süre (sn). Sonrası kısılmaz. */
  recoverySec: number;
  /** Tepe doluluğun kapasiteye oranının üst sınırı (0–1). */
  margin: number;
  minFactor: number;
  /** Araç tamponunun bütçeye katılan oranı (0–1). 1: araç + uydu payı (Aşama 4 ile aynı havuz); 0: yalnızca uydu tamponu payı. */
  assetBufferShare?: number;
  /** Üretim çarpanının yeniden hesaplanma aralığı (sn, varsayılan 1800); yalnızca hesap maliyetini düşürür. */
  refreshSec?: number;
}

/**
 * Kümelenmiş hata modeli (Gilbert–Elliott benzeri, iki durumlu; RASTGELELİK YOK, sabit tohumlu kendi üretecimiz). Her hat için
 * adım adım iyi/kötü durum zinciri üretilir; kötü durumun ortalama süresi meanBadSec, kötü durumda geçirilen uzun dönem oranı, hattın
 * ortalama kaybı (surfaceLossPct / earthLossPct) iyi ve kötü durum kayıplarının karışımı olacak şekilde seçilir, yani ORTALAMA KAYIP
 * periyodik modelle aynıdır, yalnızca dağılımı (kümelenme) farklıdır. Durum zinciri zamana bağlıdır (denemelere değil): bu yüzden
 * kaybolan bir paketin yeniden denemesi, RTT kısaysa büyük olasılıkla aynı kötü durumda kalır.
 */
export interface BurstConfig {
  goodLossPct: number;
  badLossPct: number;
  /** Kötü durumun ortalama süresi (sn). */
  meanBadSec: number;
  /** Üreteç tohumu (sabit). */
  seed: number;
}

/**
 * Kayan ufuklu akış kontrolü (Aşama 8). Her refreshSec'te, her araç için önümüzdeki rollingSec boyunca (takvimden öngörülen) tampon havuzu ileri izlenir:
 * Dünya hattı açıkken boşalır (hat hızı × payı × (1 − tahmin edilen ortalama kayıp)), kapalıyken boşalmaz; tepe doluluk margin × kapasiteyi
 * aşmayacak en büyük bilim verisi çarpanı ikili aramayla seçilir. Telemetri kısılmaz. Ufuk kapalı dönemden kısaysa strateji kapanma sırasında
 * "miyop" kalır (kesintinin kalanını görmez); bu bilerek bir parametredir.
 */
export interface RollingConfig {
  /** Kayan ufuk (sn). */
  rollingSec: number;
  margin: number;
  minFactor: number;
  /** Araç tamponunun havuza katılan oranı (0–1); 'coverage' ile aynı anlam. */
  assetBufferShare?: number;
  /** Çarpanın yeniden hesaplanma aralığı (sn, varsayılan 1800). */
  refreshSec?: number;
}

/**
 * Tahmin hatası (Aşama 8): stratejilerin BİLDİĞİ takvim ve ortalama kayıp gerçekten sapar. Gerçek simülasyon (bağlantılar, kayıplar) değişmez;
 * yalnızca stratejinin kararında kullandığı tahmin değişir. Belirleyicidir (rastgelelik yok). Hepsi 0 → kusursuz tahmin (Aşama 7 davranışı).
 */
export interface ForecastError {
  /**
   * Öngörülen her açık Dünya hattı penceresi, başta ve sonda bu kadar sn genişletilir (+, iyimser: erken açılır, geç kapanır) ya da daraltılır (−, kötümser).
   * Adıma yuvarlanır. Kavuşum (blackout) işareti için tersi uygulanır (iyimser = kesinti kısa öngörülür).
   */
  edgeShiftSec?: number;
  /** Her açık pencere olduğu gibi bu kadar sn ötelenir (+: geç, −: erken). Adıma yuvarlanır. */
  offsetSec?: number;
  /** Tahmin edilen ortalama Dünya hattı kaybı = gerçek × (1 + bu/100); (−100: kayıp yok sanılır; 0–100 aralığına kırpılır). */
  lossBiasPct?: number;
}

/**
 * Aşama 9: havuz projeksiyonunun iyimser varsayımlarını kaldıran seçenekler (yalnızca 'coverage', 'rolling', 'adaptive' kullanır; varsayılan ikisi de kapalı).
 * surfaceClosure: araç tamponundaki veri yüzey hattı kapalıyken boşalmaz — havuz iki aşamalı izlenir (araç tamponu → uydu payı → Dünya); yüzey hattı takvimi de
 * (tahmin hatası dahil) stratejinin bildiği takvimdir. arqHold: ARQ kopyaları RTT boyunca uydu tamponunda kalır; havuzun boşalması RTT (= 2 × ışık gecikmesi) gecikir.
 */
export interface ProjectionOptions {
  surfaceClosure?: boolean;
  arqHold?: boolean;
  /**
   * Aşama 10: çok uydulu araçlarda uydu tamponları birbirinin yerine kullanılamaz: araç tamponu → planlanan uydunun payı (her uydunun payı kendi hattıyla boşalır); sınır her kapta ayrı
   * (araç tamponu payı ve her uydunun payı). Tek rotalı araçlarda etkisizdir (Aşama 7-9 aritmetiği).
   */
  separateRelays?: boolean;
}

/**
 * Uyarlamalı kayan ufuk (Aşama 9). Her refreshSec'te, her araç için takvimden (stratejinin bildiği Dünya hattı takvimi) şimdi sürmekte olan ya da leadSec içinde
 * başlayan ilk KAPALI hat döneminin uzunluğu L bulunur; ufuk = (dönemin bitişine kalan süre) + tailFactor × L, [minSec, maxSec] aralığına kırpılır. Yakın bir kapalı dönem
 * yoksa ufuk minSec'tir. Sonrası 'rolling' ile aynıdır (aynı havuz projeksiyonu).
 */
export interface AdaptiveConfig {
  minSec: number;
  maxSec: number;
  leadSec: number;
  tailFactor: number;
  margin: number;
  minFactor: number;
  assetBufferShare?: number;
  refreshSec?: number;
}

/**
 * Aşama 10: değere duyarlı kuyruk kuralı ('valueAware' ve 'valueAdaptive' politikaları). Yalnızca bilim verisi (en önemli sınıf dışındakiler) zamanla azalan değerli sayılır:
 * paketin değeri 2^(−yaş / halfLifeSec). Kural YALNIZCA bu yapılandırma verildiğinde (yani "azalan değer" modeli seçiliyken) devreye girer; yoksa politika 'priority' ile birebir aynıdır.
 * Kuyruk kuralı üretimi kısmaz.
 */
export interface ValueAwareConfig {
  /** Azalan değerin yarı ömrü (sn). */
  halfLifeSec: number;
  /** 0–1: değeri başlangıç değerinin bu oranının altına inen bilim paketi tamponda atılır (atılan = `expired`; düşen değildir). 0 / yok: atma yok. */
  expireBelow?: number;
  /** Bilim verisini en yeni önce gönder (üstel azalmada, kapasite kısıtlıyken toplam değeri en çok artıran sıra); gönderimi süren paket bitirilir. */
  newestFirst?: boolean;
  /** Tampon doluyken yeni veriye yer açmak için en ESKİ bilim paketini at (bu bir `dropped` sayılır); yoksa eski kural (yeni paket ya da en yeni düşük sınıf atılır). */
  evictOldest?: boolean;
  /** Atma taramasının aralığı (sn, varsayılan 3600): yalnızca hesap maliyetini düşürür. */
  scanSec?: number;
}

/**
 * Aşama 10: takvim hatasına dayanıklı uyarlamalı ufuk ('adaptiveRobust'). 'adaptive' ile aynıdır, ama kavuşum kesintisi İÇERMEYEN kapalı dönemler için (yer istasyonu boşluğu,
 * cisim arkası) şu korumalardan açık olanlar uygulanır (hepsi yoksa 'adaptive' ile birebir aynı):
 * - capSec: ufuk bu süreyi aşamaz (ufku kırpma).
 * - histFactor: güven aralığı. Tahmin edilen kapalı dönem uzunluğu, stratejinin GERÇEKTE gözlediği (geçmiş, hata yok) histSec içindeki en uzun kapalı dönemin histFactor katını aşamaz.
 *   Geçmişte kapalı dönem hiç gözlenmediyse (başlangıç) takvimin kapalı dönem uzunluğuna güvenilmez (geri çekilme, aşağıya bakın).
 * - trustMin: geri çekilme. Son checkSec'te takvim, gerçekte açık olan adımların trustMin oranından azını açık gösteriyorsa (pesimist ya da silinmiş takvim: "hiç açık değil" görünen takvim)
 *   takvime güvenilmez. Güvenilmeyen takvimde: fallbackSec > 0 ise ufuk sabit fallbackSec olur (yine aynı takvimle projeksiyon); fallbackSec yok ya da 0 ise KISMA YAPILMAZ (öncelikli kuralına geri çekilme).
 * Kavuşum kesintisi içeren kapalı dönemlerde (astronomik, öngörülebilir) 'adaptive' kuralı aynen uygulanır.
 */
export interface AdaptiveRobustConfig extends AdaptiveConfig {
  capSec?: number;
  histFactor?: number;
  histSec?: number;
  trustMin?: number;
  checkSec?: number;
  fallbackSec?: number;
}

/**
 * Aşama 10: gerçek çok uydulu yönlendirme (varsayılan yok = Aşama 9 davranışı: uydu seçimi bağlantı çizelgesinden, `assetRelay`).
 * select: 'timeline' = çizelgedeki seçim (Aşama 9); 'leastFilled' = aracın görebildiği (yüzey hattı açık) uydular arasında tamponu EN AZ DOLU olan;
 * 'openFirst' = önce Dünya hattı açık olanlar, onlar arasında en az dolu. Veri girdiği uydunun tamponunda kalır (uydu tamponları ayrı; Aşama 3-9'da da böyleydi, yalnızca
 * strateji projeksiyonu bunu birbirinin yerine kullanılabilir sayıyordu: ProjectionOptions.separateRelays).
 * isl: uydular arası bağlantı (topology.isl çiftleri, LinkSample.islUp): kendi Dünya hattı kapalı, eşininki açıkken tampondaki veri kbps hızıyla eşine aktarılır.
 */
export interface RoutingConfig {
  select: 'timeline' | 'leastFilled' | 'openFirst';
  isl?: { kbps: number };
}

export interface SchedClass {
  id: string; priority: number; share: number; packetMb: number;
  /** Aşama 9: varsayımsal bilimsel değer (birim değer / Mb); yoksa 1. Zamanla azalma yalnızca ölçüt hesabındadır (SchedConfig.valueHalfLivesSec), çizelgeleme kararını etkilemez. */
  valuePerMb?: number;
}

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
  /** 'coverage' politikası için gerekli; yoksa kısma yapmaz (öncelikli ile aynı). */
  coverage?: CoverageConfig;
  /** 'rolling' politikası için gerekli; yoksa kısma yapmaz (öncelikliyle aynı). */
  rolling?: RollingConfig;
  /** 'adaptive' politikası için gerekli; yoksa kısma yapmaz (öncelikliyle aynı). */
  adaptive?: AdaptiveConfig;
  /** Havuz projeksiyonu seçenekleri (Aşama 9); yoksa Aşama 3-8 davranışı. */
  projection?: ProjectionOptions;
  /** Stratejilerin (strategy, coverage, rolling, adaptive) bildiği takvim/kayıp tahminindeki sapma. Yoksa kusursuz. */
  forecast?: ForecastError;
  /**
   * Aşama 9: değer ölçütü için zamanla azalan değer yarı ömürleri (sn). Verilirse her sınıfın sonucunda decayMb[j] = Σ paket boyutu × 2^(−teslim yaşı / yarı ömür[j]) olur
   * (ölçüt hesabı; çizelgeleme kararını ETKİLEMEZ). Yoksa decayMb boştur.
   */
  valueHalfLivesSec?: number[];
  /** Yoksa hatlar kayıpsızdır ve gönderici paketi gönderir göndermez bırakır (Aşama 3-4 davranışı). */
  arq?: ArqConfig;
  /** Aşama 10: 'valueAware' / 'valueAdaptive' için kuyruk kuralı; yoksa bu politikalar 'priority' / 'adaptive' ile birebir aynıdır. */
  valueAware?: ValueAwareConfig;
  /** Aşama 10: 'adaptiveRobust' için gerekli; yoksa kısma yapmaz (öncelikliyle aynı). */
  adaptiveRobust?: AdaptiveRobustConfig;
  /** Aşama 10: çok uydulu yönlendirme; yoksa Aşama 9 (çizelgedeki seçim, uydular arası bağlantı yok). */
  routing?: RoutingConfig;
  /**
   * Aşama 10: telemetri de kısılır. Kısma çarpanı t (bilim verisi için) iken telemetri çarpanı = m + (1 − m) × t (m = bu değer, 0–1); m yoksa ya da 1 ise telemetri hiç kısılmaz (Aşama 4-9).
   * Kısılan telemetri "üretilmeyen"dir. Yalnızca kısma yapan politikalara (strategy, coverage, rolling, adaptive, valueAdaptive, adaptiveRobust) etkir.
   */
  telemetryMinFactor?: number;
  /**
   * Aşama 10: telemetri (en önemli sınıf) için ayrılmış Dünya hattı payı (0–1): hat hızının bu oranı önce telemetriye ayrılır, kullanılmayan pay bilim verisine geçer (işi bırakmaz).
   * Yok ya da 0: Aşama 3-9 davranışı.
   */
  telemetryShare?: number;
}

/** relay: ana (home) aktarma uydusu. alt (Aşama 9): aracın kullanabileceği DİĞER uydular; varsa bağlantı çizelgesi her adımda hangisinin kullanıldığını söyler (LinkSample.assetRelay). */
export interface SchedAsset { id: string; body: string; relay: string; dataRateKbps: number; alt?: string[] }
export interface SchedTopology {
  assets: SchedAsset[];
  relays: string[];
  /** Aşama 10: uydular arası bağlantı çiftleri (relays sırasında); LinkSample.islUp bu sırada. */
  isl?: [number, number][];
}

/** Bir zaman adımındaki bağlantı durumu; diziler topology.assets / topology.relays sırasındadır. */
export interface LinkSample {
  surfaceUp: boolean[];
  surfaceDelaySec: number[];
  earthUp: boolean[];
  earthDelaySec: number[];
  /** İsteğe bağlı: uydu→Dünya hattı Mars kavuşumu nedeniyle kapalı mı (cisim arkası kapanması değil). Strateji bunu öngörmek için kullanır. */
  earthBlackout?: boolean[];
  /** Aşama 9: araç başına bu adımda kullanılan aktarma uydusunun topology.relays içindeki sırası (yoksa aracın ana uydusu). surfaceUp / surfaceDelaySec bu uyduya aittir. */
  assetRelay?: number[];
  /**
   * Aşama 10: çok uydulu araçlarda her aday uydu için (araç sırasında; aday listesi araçta ana uydu önce) bu adımdaki yüzey hattı durumu: relay = topology.relays sırası,
   * up = yüzey hattı açık, delaySec = yüzey gecikmesi. `routing.select` 'timeline' dışındaysa çizelgeleyici uyduyu bunlardan seçer.
   */
  cand?: { relay: number; up: boolean; delaySec: number }[][];
  /** Aşama 10: topology.isl çiftlerinin bu adımdaki durumu ve tek yön gecikmesi (sn). */
  islUp?: boolean[];
  islDelaySec?: number[];
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
  /** Tüm iletim denemeleri (başarılı + kaybolan; her iki hat). Yalnızca ARQ/hat hatası açıkken sayılır. */
  attempts: number;
  /** Aşama 10: değere duyarlı kuyruk kuralı tamponda attı (değeri eşiğin altına inmiş bilim paketi); `dropped` ve `abandoned` değildir. Diğer politikalarda 0. */
  expired: number;
  expiredMb: number;
  /** Strateji yüzünden hiç üretilmeyen (kısılan) veri; kayıp (dropped) DEĞİLDİR. Talep = generated + suppressed. */
  suppressed: number;
  suppressedMb: number;
  /** Aşama 9: SchedConfig.valueHalfLivesSec ile aynı sırada, zamanla azalan değerli teslim edilen hacim (Mb eşdeğeri). Yarı ömür verilmediyse boş. */
  decayMb: number[];
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
  /** En uzun art arda kaybolan deneme sayısı (herhangi bir hatta). Kümelenmeyi gösterir. */
  maxLossRun: number;
  /** Hatta kayıp paketlerden (total.abandoned) yüzey hattında (araç → uydu) hakkı tükenenler; kalanı uydu → Dünya hattındadır. */
  abandonedSurface: number;
}

/** Küçük, sabit tohumlu üreteç (mulberry32): aynı tohum aynı diziyi verir, Math.random yok. [0,1) döner. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bir hat için n adımlık iyi(0)/kötü(1) durum zinciri. Kötü durumun uzun dönem oranı, ortalama kaybın (avgPct) iyi/kötü kayıp
 * karışımı olması için seçilir (sınırlara kırpılır). Adım başına geçiş olasılıkları: kötü→iyi = dt / meanBadSec (en çok 1),
 * iyi→kötü buna göre. Başlangıç: iyi. Belirleyici (tohum sabit).
 */
export function genLinkStates(n: number, dt: number, avgPct: number, b: BurstConfig, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  const span = b.badLossPct - b.goodLossPct;
  const pi = span > 0 ? Math.min(1, Math.max(0, (avgPct - b.goodLossPct) / span)) : 0;
  if (pi <= 0 || n === 0) return out;
  const rng = mulberry32(seed);
  const pBG = Math.min(1, dt / Math.max(dt, b.meanBadSec));
  const pGB = pi >= 1 ? 1 : Math.min(1, (pi / (1 - pi)) * pBG);
  for (let i = 1; i < n; i++) {
    const u = rng();
    out[i] = out[i - 1] ? (u < pBG ? 0 : 1) : (u < pGB ? 1 : 0);
  }
  return out;
}

/**
 * Stratejinin BİLDİĞİ (tahmin) takvim: 1 = ilgili durum (açık hat ya da kesinti) sürüyor. Sapma yoksa gerçek takvimin kopyasıdır.
 * Açık pencereler (invert=false) başta/sonda edge adım genişler (negatifse daralır), sonra off adım öteler. invert=true (kesinti): genişleme tersine işler.
 * Veri aralığının kenarına değen uçlar kaydırılmaz (gerçek başı/sonu bilinmiyor). Belirleyici.
 */
export function forecastFlags(truth: ArrayLike<boolean | number>, edge: number, off: number, invert: boolean): Uint8Array {
  const n = truth.length;
  const out = new Uint8Array(n);
  if (edge === 0 && off === 0) { for (let i = 0; i < n; i++) out[i] = truth[i] ? 1 : 0; return out; }
  const e = invert ? -edge : edge;
  let i = 0;
  while (i < n) {
    if (!truth[i]) { i++; continue; }
    let j = i;
    while (j < n && truth[j]) j++;
    const a = (i === 0 ? 0 : i - e) + off, b = (j === n ? n : j + e) + off;
    for (let t = Math.max(0, a); t < Math.min(n, b); t++) out[t] = 1;
    i = j;
  }
  return out;
}

interface Pkt { cls: number; sizeMb: number; createdSec: number; sentMb: number; seq: number; propSec: number; attempts: number }
interface Held { p: Pkt; k: number; at: number; ok: boolean }

class Fifo {
  private a: Pkt[] = [];
  private h = 0;
  /** Aşama 10 (en yeni önce): arkadaki paket gönderimdeyse (sentMb > 0) yeni paket onun önüne girer, gönderimdeki paket bitirilir. */
  pinBack = false;
  get length() { return this.a.length - this.h; }
  peek(): Pkt | undefined { return this.a[this.h]; }
  peekBack(): Pkt | undefined { return this.length > 0 ? this.a[this.a.length - 1] : undefined; }
  push(p: Pkt) {
    if (this.pinBack && this.length > 0 && this.a[this.a.length - 1].sentMb > 0) this.a.splice(this.a.length - 1, 0, p);
    else this.a.push(p);
  }
  /** Koşulu sağlayanları çıkarıp döner (sıra korunur). */
  removeIf(pred: (p: Pkt) => boolean): Pkt[] {
    let any = false;
    for (let j = this.h; j < this.a.length; j++) if (pred(this.a[j])) { any = true; break; }
    if (!any) return [];
    const out: Pkt[] = [], keep: Pkt[] = [];
    for (let j = this.h; j < this.a.length; j++) (pred(this.a[j]) ? out : keep).push(this.a[j]);
    this.a = keep; this.h = 0;
    return out;
  }
  shift(): Pkt | undefined {
    const p = this.a[this.h++];
    if (this.h > 1024 && this.h * 2 > this.a.length) { this.a = this.a.slice(this.h); this.h = 0; }
    return p;
  }
  pop(): Pkt | undefined { return this.length > 0 ? this.a.pop() : undefined; }
  /** Başa geri koy (yeniden iletim). */
  unshift(p: Pkt) { if (this.h > 0) this.a[--this.h] = p; else this.a.unshift(p); }
}

const arq_surfaceRetry = (cfg: SchedConfig) => (cfg.arq?.surfaceRetrySec ?? 0);

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
  const cv = policy === 'coverage' ? cfg.coverage : undefined;
  const rl = policy === 'rolling' ? cfg.rolling : undefined;
  // Aşama 10: 'valueAdaptive' = 'adaptive' kısması + değere duyarlı kuyruk; 'adaptiveRobust' = takvim hatasına dayanıklı ufuk. Yapılandırma yoksa ilgili eski politikayla birebir aynıdır.
  const rob = policy === 'adaptiveRobust' ? cfg.adaptiveRobust : undefined;
  const ad: AdaptiveConfig | undefined = policy === 'adaptive' || policy === 'valueAdaptive' ? cfg.adaptive : rob;
  const va = policy === 'valueAware' || policy === 'valueAdaptive' ? cfg.valueAware : undefined;
  const newest = !!va?.newestFirst, evictOld = !!va?.evictOldest;
  const expireBelow = va && va.expireBelow !== undefined ? Math.min(0.999999, Math.max(0, va.expireBelow)) : 0;
  const expireAgeSec = va && expireBelow > 0 ? va.halfLifeSec * Math.log2(1 / expireBelow) : Infinity;
  const scanSteps = Math.max(1, Math.round((va?.scanSec ?? 3600) / dt));
  const tmin = cfg.telemetryMinFactor;
  const dyn = !!cfg.routing && cfg.routing.select !== 'timeline';
  const islKbps = cfg.routing?.isl?.kbps ?? 0;
  const tShare = Math.min(1, Math.max(0, cfg.telemetryShare ?? 0));
  if (newest) for (const b of [...assetBuf, ...relayBuf]) b.q.forEach((q, k) => { if (rank[k] !== topRank) q.pinBack = true; });
  /** Havuz projeksiyonu kullanan politikalar. */
  const proj = !!(cv || rl || ad);
  // Aşama 9 seçenekleri (varsayılan kapalı: Aşama 3-8 aritmetiği birebir). arqHold yalnızca ARQ varken anlamlıdır.
  const surfClose = proj && !!cfg.projection?.surfaceClosure;
  const arqHold = proj && !!cfg.projection?.arqHold && !!cfg.arq;
  const sepOpt = proj && !!cfg.projection?.separateRelays;
  // Stratejilerin bildiği takvim (tahmin): kusursuzsa gerçekle aynı; fc ile sapabilir. Gerçek bağlantılar (samples) hiç değişmez.
  const fc = cfg.forecast;
  const edgeSteps = Math.round((fc?.edgeShiftSec ?? 0) / dt), offSteps = Math.round((fc?.offsetSec ?? 0) / dt);
  const lossBias = fc?.lossBiasPct ?? 0;
  const fUp = topo.relays.map((_, ri) => (st || proj) ? forecastFlags(samples.map((x) => x.earthUp[ri]), edgeSteps, offSteps, false) : new Uint8Array(0));
  const fBlack = topo.relays.map((_, ri) => st || cv || rob ? forecastFlags(samples.map((x) => !!x.earthBlackout?.[ri]), edgeSteps, offSteps, true) : new Uint8Array(0));
  // arqHold: ARQ kopyası RTT boyunca tamponda yer tutar, yani havuz Dünya hattı AÇIKKEN değil, RTT sonra (ACK) boşalır. Simülasyonda kopya, gönderim adımından
  // 1 + ceil(RTT/adım) adım sonra bırakılır (adım başında işlenir): sürekli zamanlı projeksiyonda bu, açık/kapalı bayrağının ceil(RTT/adım) adım ötelenmesidir.
  // (Ay'da RTT ~3 sn < adım: öteleme 1 adımdır; adımın ayrıklaştırma sonucudur.) Başlangıçtan önce gönderim olmadığı için ilk adımlarda boşalma yoktur.
  const projUp = arqHold
    ? fUp.map((u, ri) => {
        const out = new Uint8Array(u.length);
        for (let t = 0; t < u.length; t++) { const lag = Math.max(1, Math.ceil((2 * samples[t].earthDelaySec[ri]) / dt)); out[t] = t - lag >= 0 ? u[t - lag] : 0; }
        return out;
      })
    : fUp;
  // surfaceClosure: yüzey hattı (araç → uydu) takvimi (tahmin hatası aynı kuralla uygulanır).
  // Aşama 10: separateRelays (çok rotalı araçlar) da yüzey hattı takvimine ve planlanan uydu rotasına ihtiyaç duyar.
  const sepAsset = topo.assets.map((a) => sepOpt && (a.alt?.length ?? 0) > 0);
  const fSurf = topo.assets.map((_, ai) => (surfClose || sepAsset[ai] ? forecastFlags(samples.map((x) => x.surfaceUp[ai]), edgeSteps, offSteps, false) : new Uint8Array(0)));
  // Kesinti öngörüsü (yalnızca strateji): relay başına, adım i için kesintiye kalan süre içinde mi, ve o kesintinin bitişine kalan adım.
  const ahead = topo.relays.map(() => new Array<boolean>(samples.length).fill(false));
  const endsIn = topo.relays.map(() => new Array<number>(samples.length).fill(0));
  if (st) {
    const L = Math.ceil(st.lookaheadSec / dt);
    topo.relays.forEach((_, ri) => {
      let start = Infinity, end = Infinity; // sonraki (veya süren) kesinti serisinin ilk adımı ve bitişi (ilk açık adım)
      for (let i = samples.length - 1; i >= 0; i--) {
        const b = !!fBlack[ri][i];
        if (b) { end = i + 1 < samples.length && fBlack[ri][i + 1] ? end : i + 1; start = i; }
        ahead[ri][i] = start - i <= L;
        endsIn[ri][i] = end - i;
      }
    });
  }
  // Kapsama bilen strateji: relay başına her adımın kısma ufku (kesinti öncesi/içi/sonrası; -1 = kapalı).
  // Projeksiyon pahalıdır: çarpan refreshSec'te bir yeniden hesaplanır, aradaki adımlarda önceki değer kullanılır.
  const refreshSteps = Math.max(1, Math.round((cfg.coverage?.refreshSec ?? 1800) / dt));
  const covThrottle = topo.assets.map(() => 1);
  const horizon = topo.relays.map(() => new Int32Array(samples.length).fill(-1));
  // Aşama 9: aracın kullanabileceği uydular (ana + alt; tek uydulu topolojide tek rota = Aşama 3-8 aritmetiği) ve projeksiyonun kullandığı takvim değişim adımları.
  const routes = topo.assets.map((a) => [relayIndex.get(a.relay)!, ...(a.alt ?? []).map((r) => relayIndex.get(r)).filter((x): x is number => x !== undefined)]);
  const routeTotal = topo.relays.map(() => 0);
  const flipsOf = (flags: ArrayLike<number>) => { const o: number[] = []; for (let i = 1; i < flags.length; i++) if (flags[i] !== flags[i - 1]) o.push(i); return o; };
  const aFlips: number[][] = topo.assets.map(() => []);
  const aPtr = topo.assets.map(() => 0);
  // Aşama 10 (separateRelays): çizelgedeki (planlanan) uydu rotası, araç başına adım adım (rotalar içindeki sıra).
  const planRoute = topo.assets.map((_, ai) => {
    if (!sepAsset[ai]) return new Int8Array(0);
    const o = new Int8Array(samples.length);
    for (let t = 0; t < o.length; t++) o[t] = Math.max(0, routes[ai].indexOf(samples[t].assetRelay ? samples[t].assetRelay![ai] : routes[ai][0]));
    return o;
  });
  if (proj) {
    const relFlips = projUp.map(flipsOf);
    topo.assets.forEach((_, ai) => {
      const set = new Set<number>();
      for (const r of routes[ai]) for (const f of relFlips[r]) set.add(f);
      if (surfClose || sepAsset[ai]) for (const f of flipsOf(fSurf[ai])) set.add(f);
      if (sepAsset[ai]) for (const f of flipsOf(planRoute[ai])) set.add(f);
      aFlips[ai] = [...set].sort((x, y) => x - y);
    });
  }
  if (cv) {
    const L = Math.ceil(cv.lookaheadSec / dt), R = Math.ceil(cv.recoverySec / dt);
    topo.relays.forEach((_, ri) => {
      let i = 0;
      while (i < samples.length) {
        if (!fBlack[ri][i]) { i++; continue; }
        let e = i;
        while (e < samples.length && fBlack[ri][e]) e++;
        const T = Math.min(samples.length, e + R);
        for (let j = Math.max(0, i - L); j < T; j++) horizon[ri][j] = Math.max(horizon[ri][j], T);
        i = e;
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
  // Projeksiyonda uydu tamponunun payı: uyduyu rota olarak kullanabilen araçların toplam hızına göre (tek uyduda relayTotal ile aynı).
  topo.relays.forEach((_, ri) => { routeTotal[ri] = topo.assets.reduce((s, _a, ai) => s + (routes[ai].includes(ri) ? assetRate[ai].total : 0), 0); });

  const rlSteps = Math.max(1, Math.ceil((cfg.rolling?.rollingSec ?? 0) / dt));
  const rlRefresh = Math.max(1, Math.round((cfg.rolling?.refreshSec ?? 1800) / dt));
  const adMin = ad ? Math.max(1, Math.ceil(ad.minSec / dt)) : 0;
  const adMax = ad ? Math.max(adMin, Math.ceil(ad.maxSec / dt)) : 0;
  const adLead = ad ? Math.ceil(ad.leadSec / dt) : 0;
  const adRefresh = Math.max(1, Math.round((ad?.refreshSec ?? 1800) / dt));
  // 'adaptive': araç için takvimde (tahmin) rotalardan HİÇBİRİ Dünya hattını açık tutmuyorsa kapalı dönem. Tek rotada fUp'un kendisi.
  const spellUp = ad ? topo.assets.map((_, ai) => {
    if (routes[ai].length === 1) return fUp[routes[ai][0]];
    const o = new Uint8Array(samples.length);
    for (let t = 0; t < o.length; t++) for (const r of routes[ai]) if (fUp[r][t]) { o[t] = 1; break; }
    return o;
  }) : [];
  /** i adımından itibaren şimdi sürmekte olan ya da leadSec içinde başlayan ilk kapalı hat döneminin [başı, sonu) adımları (başı geriye doğru bulunur: toplam uzunluk için); yoksa null. */
  const closedSpell = (ai: number, i: number): [number, number] | null => {
    const u = spellUp[ai], n = samples.length;
    let a = i;
    if (u[i]) {
      const lim = Math.min(n, i + adLead + 1);
      while (a < lim && u[a]) a++;
      if (a >= lim) return null;
    } else while (a > 0 && !u[a - 1]) a--;
    let b = a;
    while (b < n && !u[b]) b++;
    return [a, b];
  };
  /** Uyarlamalı ufuk (adım): kapalı dönemin bitişine kalan süre + tailFactor × dönem uzunluğu, [min, max]; yakın kapalı dönem yoksa min. */
  const adaptiveSteps = (ai: number, i: number): number => {
    const sp = closedSpell(ai, i);
    if (!sp) return adMin;
    const [a, b] = sp;
    return Math.min(adMax, Math.max(adMin, b - i + Math.ceil(ad!.tailFactor * (b - a))));
  };
  // ---- Aşama 10: takvim hatasına dayanıklı uyarlamalı ufuk ('adaptiveRobust'; ayrıntı: AdaptiveRobustConfig) ----
  const robCap = rob?.capSec !== undefined ? Math.max(1, Math.ceil(rob.capSec / dt)) : undefined;
  /** Geri çekilme ufku (adım); −1: kısma yok (öncelikli kuralı). */
  const robFb = rob?.fallbackSec !== undefined && rob.fallbackSec > 0 ? Math.max(1, Math.ceil(rob.fallbackSec / dt)) : -1;
  const robHist = Math.max(1, Math.ceil((rob?.histSec ?? 7 * 86400) / dt));
  const robCheck = Math.max(1, Math.ceil((rob?.checkSec ?? 2 * 86400) / dt));
  /** Her uydu için kavuşum işareti (tahmin takvimi) önek toplamı: [a, b) aralığında kavuşum var mı. */
  const blackPref = rob ? topo.relays.map((_, ri) => { const o = new Int32Array(samples.length + 1); for (let t = 0; t < samples.length; t++) o[t + 1] = o[t] + (fBlack[ri][t] ? 1 : 0); return o; }) : [];
  const spellHasBlackout = (ai: number, a: number, b: number) => routes[ai].some((r) => blackPref[r][b] - blackPref[r][a] > 0);
  const truthUp = (ai: number, t: number) => { for (const r of routes[ai]) if (samples[t].earthUp[r]) return true; return false; };
  /** Gözlenen (gerçek) geçmişte, [i − histSec, i) içindeki en uzun kapalı dönem (adım). */
  const observedLongestClosed = (ai: number, i: number): number => {
    let best = 0, run = 0;
    for (let t = Math.max(0, i - robHist); t < i; t++) { if (truthUp(ai, t)) run = 0; else if (++run > best) best = run; }
    return best;
  };
  /** Takvim güvenilir mi: son checkSec'te gerçekte açık olan adımların en az trustMin oranını açık gösteriyor mu. */
  const calendarTrusted = (ai: number, i: number): boolean => {
    let ut = 0, uf = 0;
    for (let t = Math.max(0, i - robCheck); t < i; t++) { if (truthUp(ai, t)) ut++; if (spellUp[ai][t]) uf++; }
    return ut === 0 || uf >= rob!.trustMin! * ut;
  };
  const clampH = (h: number) => Math.min(adMax, Math.max(adMin, h));
  const retreat = () => (robFb > 0 ? clampH(robFb) : -1);
  const robustSteps = (ai: number, i: number): number => {
    const r = rob!;
    const sp = closedSpell(ai, i);
    const black = !!sp && spellHasBlackout(ai, sp[0], sp[1]);
    if (!black && r.trustMin !== undefined && !calendarTrusted(ai, i)) return retreat();
    if (!sp) return adMin;
    let [a, b] = sp;
    if (!black && r.histFactor !== undefined) {
      const lobs = observedLongestClosed(ai, i);
      if (lobs === 0) return retreat(); // geçmişte kapalı dönem gözlenmedi: takvimin uzunluğuna güvenilmez
      b = Math.min(b, a + Math.ceil(r.histFactor * lobs));
    }
    let h = clampH(Math.max(b - i, 0) + Math.ceil(r.tailFactor * (b - a)));
    if (!black && robCap !== undefined) h = Math.min(h, Math.max(adMin, robCap));
    return h;
  };
  const horizonSteps = (ai: number, i: number): number => (rob ? robustSteps(ai, i) : adaptiveSteps(ai, i));
  /** Telemetri çarpanı (Aşama 10): telemetryMinFactor yoksa 1 (Aşama 4-9: telemetri kısılmaz). */
  const ftOf = (f: number): number => (tmin === undefined ? 1 : tmin + (1 - tmin) * f);
  /**
   * Havuz (araç tamponu payı + uydu tamponunun hız oranındaki payı) i adımından T adımına (T hariç) ileri izlenir; tepe doluluğu margin × kapasiteyi
   * aşmayan en büyük bilim verisi çarpanı döner (ikili arama). Dünya hattı AÇIK/KAPALI bilgisi tahmin takviminden (projUp), ortalama kayıp tahminden gelir.
   * 'coverage', 'rolling' ve 'adaptive' aynı fonksiyonu kullanır (varsayılan seçeneklerle aritmetik Aşama 7/8 ile aynı).
   * surfaceClosure: havuz iki aşamalı izlenir (araç tamponu a → uydu payı r → Dünya); a yalnızca yüzey hattı açıkken r'ye akar. Sınır yine toplam (a + r) üzerindedir.
   */
  const projectThrottle = (ai: number, i: number, T: number, margin: number, minFactor: number, assetShare: number): number => {
    const a = topo.assets[ai];
    const rts = routes[ai];
    const fr = rts.map((ri) => (routeTotal[ri] > 0 ? assetRate[ai].total / routeTotal[ri] : 0));
    let used = assetBuf[ai].usedMb;
    rts.forEach((ri, j) => { used += relayBuf[ri].usedMb * fr[j]; });
    used = Math.max(0, used);
    // Beklenen boşaltma hızı (rota başına): hat hızı × payı × ortalama başarı oranı (ARQ'da kayıp tekrar gönderilir)
    const lossFc = cfg.arq ? Math.min(100, Math.max(0, cfg.arq.earthLossPct * (1 + lossBias / 100))) : 0;
    const dr = rts.map((ri, j) => ((cfg.relayDownlinkKbps[topo.relays[ri]] ?? 0) / 1000) * fr[j] * (cfg.arq ? 1 - lossFc / 100 : 1));
    // Üst sınır uydu tamponunun payıdır (araç tamponu değil): uydu tamponu dolunca telemetri paketi daha düşük sınıfı atarak girer
    // (öncelikli kural), yani doygun uydu tamponu kayıp demektir. Araç tamponu yalnızca geçici (yüzey hattı kapalıyken) biriktirir.
    let relayCap = 0;
    rts.forEach((ri, j) => { relayCap += relayBuf[ri].capMb * fr[j]; });
    const limit = margin * (relayCap + assetShare * assetBuf[ai].capMb);
    const fl = aFlips[ai];
    while (aPtr[ai] < fl.length && fl[aPtr[ai]] <= i) aPtr[ai]++;
    const single = rts.length === 1, up0 = projUp[rts[0]], d0 = dr[0];
    const drainAt = (t: number) => { let d = 0; for (let j = 0; j < rts.length; j++) if (projUp[rts[j]][t]) d += dr[j]; return d; };
    const sigma = surfClose ? ((cfg.surfaceLinkKbps[a.body] ?? 0) / 1000) * (cfg.arq ? 1 - cfg.arq.surfaceLossPct / 100 : 1) : 0;
    const asset0 = assetBuf[ai].usedMb, relay0 = Math.max(0, used - asset0);
    // Tek havuz (varsayılan; Aşama 7-8 aritmetiği): havuz hattı açıkken boşalır, kapalıyken boşalmaz.
    const peakSingle = (f: number) => {
      const g = assetRate[ai].top * ftOf(f) + assetRate[ai].rest * f;
      let t = i, k = aPtr[ai], b = used, pk = used;
      while (t < T) {
        const nx = k < fl.length && fl[k] < T ? fl[k] : T;
        const len = (nx - t) * dt;
        b = up0[t] ? Math.max(0, b + (g - d0) * len) : b + g * len;
        if (b > pk) pk = b;
        if (nx === fl[k]) k++;
        t = nx;
      }
      return pk;
    };
    const peakMulti = (f: number) => {
      const g = assetRate[ai].top * ftOf(f) + assetRate[ai].rest * f;
      let t = i, k = aPtr[ai], b = used, pk = used;
      while (t < T) {
        const nx = k < fl.length && fl[k] < T ? fl[k] : T;
        const len = (nx - t) * dt;
        const dn = drainAt(t);
        b = dn > 0 ? Math.max(0, b + (g - dn) * len) : b + g * len;
        if (b > pk) pk = b;
        if (nx === fl[k]) k++;
        t = nx;
      }
      return pk;
    };
    const peakPool = single ? peakSingle : peakMulti;
    // İki aşamalı (surfaceClosure): aa = araç tamponu, rr = uydu payı. Aralık içinde akışlar sabit; aa ya da rr boşalınca rejim değişir.
    const peakTwo = (f: number) => {
      const g = assetRate[ai].top * ftOf(f) + assetRate[ai].rest * f;
      let t = i, k = aPtr[ai], pk = used, aa = asset0, rr = relay0;
      while (t < T) {
        const nx = k < fl.length && fl[k] < T ? fl[k] : T;
        let left = (nx - t) * dt;
        const sg = fSurf[ai][t] ? sigma : 0, dn = drainAt(t);
        while (left > 1e-9) {
          const flowIn = sg > 0 ? (aa > 1e-12 ? sg : Math.min(g, sg)) : 0;
          const da = g - flowIn;
          const dd = rr > 1e-12 ? dn : Math.min(dn, flowIn);
          const dR = flowIn - dd;
          let step = left;
          if (aa > 1e-12 && da < 0) step = Math.min(step, aa / -da);
          if (rr > 1e-12 && dR < 0) step = Math.min(step, rr / -dR);
          step = Math.max(step, 1e-9);
          aa = Math.max(0, aa + da * step); rr = Math.max(0, rr + dR * step);
          left -= step;
          if (aa + rr > pk) pk = aa + rr;
        }
        if (nx === fl[k]) k++;
        t = nx;
      }
      return pk;
    };
    // Aşama 10 (separateRelays, çok rotalı araç): uydu tamponları birbirinin yerine kullanılamaz. Kaplar: araç tamponu aa, her rotanın uydu payı bb[j].
    // aa, planlanan rotaya yüzey hattı açıkken (σ) akar; her bb[j] kendi hattıyla boşalır. Ölçüt, kapların kendi sınırlarına oranının tepesidir (≤ 1 olmalı; margin sınırlara dahildir).
    const peakSep = (f: number) => {
      const g = assetRate[ai].top * ftOf(f) + assetRate[ai].rest * f;
      const sigS = ((cfg.surfaceLinkKbps[a.body] ?? 0) / 1000) * (cfg.arq ? 1 - cfg.arq.surfaceLossPct / 100 : 1);
      const aLim = margin * assetShare * assetBuf[ai].capMb;
      const bLim = rts.map((ri, j) => margin * relayBuf[ri].capMb * fr[j]);
      let aa = asset0;
      const bb = rts.map((ri, j) => Math.max(0, relayBuf[ri].usedMb * fr[j]));
      const ratio = () => { let r = aLim > 0 ? aa / aLim : 0; for (let j = 0; j < bb.length; j++) { const x = bLim[j] > 0 ? bb[j] / bLim[j] : bb[j] > 0 ? Infinity : 0; if (x > r) r = x; } return r; };
      let t = i, k = aPtr[ai], pk = ratio();
      const db = new Array<number>(bb.length).fill(0);
      while (t < T) {
        const nx = k < fl.length && fl[k] < T ? fl[k] : T;
        let left = (nx - t) * dt;
        const rj = planRoute[ai][t], sg = fSurf[ai][t] ? sigS : 0;
        while (left > 1e-9) {
          const flowIn = sg > 0 ? (aa > 1e-12 ? sg : Math.min(g, sg)) : 0;
          const da = g - flowIn;
          for (let j = 0; j < bb.length; j++) {
            const dn = projUp[rts[j]][t] ? dr[j] : 0, inflow = j === rj ? flowIn : 0;
            db[j] = inflow - (bb[j] > 1e-12 ? dn : Math.min(dn, inflow));
          }
          let step = left;
          if (aa > 1e-12 && da < 0) step = Math.min(step, aa / -da);
          for (let j = 0; j < bb.length; j++) if (bb[j] > 1e-12 && db[j] < 0) step = Math.min(step, bb[j] / -db[j]);
          step = Math.max(step, 1e-9);
          aa = Math.max(0, aa + da * step);
          for (let j = 0; j < bb.length; j++) bb[j] = Math.max(0, bb[j] + db[j] * step);
          left -= step;
          const r = ratio(); if (r > pk) pk = r;
        }
        if (nx === fl[k]) k++;
        t = nx;
      }
      return pk;
    };
    const sepNow = sepAsset[ai] && rts.length > 1;
    const peak = sepNow ? peakSep : surfClose ? peakTwo : peakPool;
    const lim = sepNow ? 1 : limit;
    if (peak(1) <= lim) return 1;
    if (peak(minFactor) > lim) return minFactor;
    let lo = minFactor, hi = 1;
    for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (peak(mid) <= lim) lo = mid; else hi = mid; }
    return lo;
  };

  const gen = new Array(nC).fill(0), genMb = new Array(nC).fill(0);
  const drop = new Array(nC).fill(0), dropMb = new Array(nC).fill(0);
  const deliv = new Array(nC).fill(0), delivMb = new Array(nC).fill(0);
  const stored = new Array(nC).fill(0), delayed = new Array(nC).fill(0);
  const lat: number[][] = Array.from({ length: nC }, () => []);
  const arq = cfg.arq;
  const att = new Array(nC).fill(0);
  let maxLossRun = 0, abandSurface = 0;
  const surfRun = topo.assets.map(() => 0), earthRun = topo.relays.map(() => 0);
  const burst = arq?.burst;
  const surfBad = burst && arq ? topo.assets.map((_, ai) => genLinkStates(samples.length, dt, arq.surfaceLossPct, burst, burst.seed + 11 + ai)) : [];
  const earthBad = burst && arq ? topo.relays.map((_, ri) => genLinkStates(samples.length, dt, arq.earthLossPct, burst, burst.seed + 101 + ri)) : [];
  const surfRng = burst ? topo.assets.map((_, ai) => mulberry32(burst.seed + 211 + ai)) : [];
  const earthRng = burst ? topo.relays.map((_, ri) => mulberry32(burst.seed + 311 + ri)) : [];
  const expd = new Array(nC).fill(0), expdMb = new Array(nC).fill(0);
  const aband = new Array(nC).fill(0), abandMb = new Array(nC).fill(0), txLost = new Array(nC).fill(0), retx = new Array(nC).fill(0);
  const surfAcc = topo.assets.map(() => 0), earthAcc = topo.relays.map(() => 0);
  const inflight: Held[][] = topo.relays.map(() => []);
  // Yüzey hattında yeniden deneme aralığı (surfaceRetrySec > 0): kaybolan paket kuyruktan çıkar, tamponda yer tutarak bekler, sonra başa döner.
  const surfRetry = Math.max(0, arq_surfaceRetry(cfg));
  const surfPend: Held[][] = topo.assets.map(() => []);
  /** Belirleyici kayıp: oran birikir, 1'i geçince bu deneme kaybolur. */
  const draw = (acc: number[], i: number, pct: number) => {
    acc[i] += pct / 100;
    if (acc[i] >= 1 - 1e-12) { acc[i] -= 1; return true; }
    return false;
  };
  /** Bu deneme (adım i, hat idx) kaybolur mu? Periyodik: biriktirici. Kümelenmiş: o adımın iyi/kötü durumuna göre sabit tohumlu üreteç. */
  const attemptLost = (earth: boolean, idx: number, i: number): boolean => {
    const lost = burst
      ? (earth ? earthRng : surfRng)[idx]() < ((earth ? earthBad : surfBad)[idx][i] ? burst.badLossPct : burst.goodLossPct) / 100
      : draw(earth ? earthAcc : surfAcc, idx, earth ? arq!.earthLossPct : arq!.surfaceLossPct);
    const run = earth ? earthRun : surfRun;
    if (lost) { if (++run[idx] > maxLossRun) maxLossRun = run[idx]; } else run[idx] = 0;
    return lost;
  };
  const islCredit = new Array((topo.isl?.length ?? 0) * 2).fill(0);
  const maxPacketMb = Math.max(...classes.map((c) => c.packetMb));
  let seq = 0;
  let droppedCum = 0;
  const series: SeriesPoint[] = [];
  const peakRelay = topo.relays.map(() => 0);
  const peakAsset = topo.assets.map(() => 0);

  const lose = (p: Pkt) => { drop[p.cls]++; dropMb[p.cls] += p.sizeMb; droppedCum++; };

  /** Daha düşük öncelikli sınıflardan atılabilecek hacim (yalnızca 'priority'). */
  const evictable = (b: Buffer, cls: number, sameClass = false) => {
    if (policy === 'fifo') return 0;
    let s = 0;
    for (let k = 0; k < nC; k++) if (rank[k] > rank[cls]) s += b.usedByClass[k] - b.held[k];
    if (sameClass && evictOld && rank[cls] !== topRank) s += b.usedByClass[cls] - b.held[cls]; // Aşama 10: yeni (üretilen) veriye yer açmak için aynı sınıfın eski paketleri
    return s;
  };
  const canAccept = (b: Buffer, p: Pkt) => b.freeMb >= p.sizeMb - 1e-9 || b.freeMb + evictable(b, p.cls) >= p.sizeMb - 1e-9;

  /** fresh: araçta yeni üretilen paket (Aşama 10 evictOldest: tampon doluysa aynı sınıfın en eski paketi atılır; uydu/aktarma hopunda yalnızca daha düşük sınıflar atılır). */
  const put = (b: Buffer, p: Pkt, fresh = false) => {
    if (b.freeMb < p.sizeMb - 1e-9) {
      if (b.freeMb + evictable(b, p.cls, fresh) < p.sizeMb - 1e-9) { lose(p); return; }
      // en düşük öncelikli sınıfın en yeni paketlerinden başlayarak yer aç
      const order = [...Array(nC).keys()].filter((k) => rank[k] > rank[p.cls]).sort((x, y) => rank[y] - rank[x]);
      for (const k of order) {
        while (b.freeMb < p.sizeMb - 1e-9) {
          const v = evictOld ? b.q[k].shift() : b.q[k].pop();
          if (!v) break;
          b.usedMb -= v.sizeMb; b.usedByClass[k] -= v.sizeMb; lose(v);
        }
        if (b.freeMb >= p.sizeMb - 1e-9) break;
      }
      if (fresh && evictOld && rank[p.cls] !== topRank) {
        while (b.freeMb < p.sizeMb - 1e-9) {
          const v = b.q[p.cls].shift();
          if (!v) break;
          b.usedMb -= v.sizeMb; b.usedByClass[p.cls] -= v.sizeMb; lose(v);
        }
      }
    }
    p.seq = seq++;
    b.q[p.cls].push(p);
    b.usedMb += p.sizeMb; b.usedByClass[p.cls] += p.sizeMb;
  };

  /** Aşama 10 (en yeni önce): bilim sınıflarında sıradaki paket kuyruğun SONUNDAKİdir; diğer her durumda başı (Aşama 3-9). */
  const isNewest = (k: number) => newest && rank[k] !== topRank;
  const headOf = (b: Buffer, k: number): Pkt | undefined => (isNewest(k) ? b.q[k].peekBack() : b.q[k].peek());
  const popHead = (b: Buffer, k: number): Pkt | undefined => (isNewest(k) ? b.q[k].pop() : b.q[k].shift());
  /** Sıradaki paketin sınıfı: FIFO'da en eski, öncelikliyse en önemli sınıfın başı. */
  const pick = (b: Buffer): number => {
    let best = -1;
    for (let k = 0; k < nC; k++) {
      const h = headOf(b, k);
      if (!h) continue;
      if (best < 0) { best = k; continue; }
      const bh = headOf(b, best)!;
      const better = policy !== 'fifo'
        ? rank[k] < rank[best] || (rank[k] === rank[best] && h.seq < bh.seq)
        : h.seq < bh.seq;
      if (better) best = k;
    }
    return best;
  };
  /** Yalnızca en önemli sınıflar arasından sıradaki paketin sınıfı (ayrılmış telemetri payı). */
  const pickTop = (b: Buffer): number => {
    let best = -1;
    for (let k = 0; k < nC; k++) {
      if (rank[k] !== topRank) continue;
      const h = headOf(b, k);
      if (h && (best < 0 || h.seq < headOf(b, best)!.seq)) best = k;
    }
    return best;
  };
  const take = (b: Buffer, k: number): Pkt => {
    const p = popHead(b, k)!;
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

    // 0b) Yüzey hattı: yeniden deneme zamanı gelen paketleri kuyruğun başına geri koy
    if (surfRetry > 0) {
      surfPend.forEach((list, ai) => {
        if (!list.length) return;
        const keep: Held[] = [];
        for (const h of list) {
          if (h.at > now) { keep.push(h); continue; }
          assetBuf[ai].held[h.k] -= h.p.sizeMb;
          assetBuf[ai].q[h.k].unshift(h.p);
        }
        surfPend[ai] = keep;
      });
    }

    // 0c) Aşama 10: değere duyarlı kuyruk kuralı: değeri eşiğin altına inmiş bilim paketleri tamponda atılır (taranma aralığı scanSec; gönderimdeki ya da ARQ'da tutulan kopyalar kuyrukta değildir)
    if (va && expireAgeSec < Infinity && i % scanSteps === 0) {
      for (const b of [...assetBuf, ...relayBuf]) {
        for (let k = 0; k < nC; k++) {
          if (rank[k] === topRank) continue;
          const gone = b.q[k].removeIf((p) => now - p.createdSec > expireAgeSec);
          for (const p of gone) { b.usedMb -= p.sizeMb; b.usedByClass[k] -= p.sizeMb; expd[k]++; expdMb[k] += p.sizeMb; }
          if (gone.length && b.usedMb < 1e-9) b.usedMb = 0;
        }
      }
    }

    // 1) Üretim (deterministik birikim). Strateji: en önemli sınıf dışındakiler kısılır; kısılan hiç üretilmez.
    topo.assets.forEach((a, ai) => {
      const mbPerSec = (a.dataRateKbps / 1000) * cfg.dutyCycle;
      let throttle = 1;
      if (cv) {
        throttle = covThrottle[ai];
        const ri = relayIndex.get(a.relay)!;
        const T = horizon[ri][i];
        if (T >= 0 && assetRate[ai].rest > 0 && (i % refreshSteps === 0 || !(i - 1 >= 0 && horizon[ri][i - 1] >= 0))) {
          throttle = covThrottle[ai] = projectThrottle(ai, i, T, cv.margin, cv.minFactor, cv.assetBufferShare ?? 0);
        } else if (T < 0) { throttle = 1; covThrottle[ai] = 1; }
      }
      if (rl) {
        throttle = covThrottle[ai];
        if (assetRate[ai].rest > 0 && i % rlRefresh === 0) {
          throttle = covThrottle[ai] = projectThrottle(ai, i, Math.min(samples.length, i + rlSteps), rl.margin, rl.minFactor, rl.assetBufferShare ?? 0);
        }
      }
      if (ad) {
        throttle = covThrottle[ai];
        if (assetRate[ai].rest > 0 && i % adRefresh === 0) {
          const hs = horizonSteps(ai, i);
          throttle = covThrottle[ai] = hs < 0 ? 1 : projectThrottle(ai, i, Math.min(samples.length, i + hs), ad.margin, ad.minFactor, ad.assetBufferShare ?? 0);
        }
      }
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
      const fTop = ftOf(throttle); // telemetryMinFactor yoksa 1
      for (let k = 0; k < nC; k++) {
        const full = mbPerSec * (classes[k].share / shareSum) * dt;
        const f = rank[k] === topRank ? fTop : throttle;
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
          put(assetBuf[ai], p, true);
        }
      }
    });

    // 2) Araç → uydu
    topo.assets.forEach((a, ai) => {
      let surfUp = s.surfaceUp[ai], dstIdx = s.assetRelay ? s.assetRelay[ai] : relayIndex.get(a.relay)!, surfDelay = s.surfaceDelaySec[ai];
      // Aşama 10: dinamik uydu seçimi (yüzey hattı açık adaylar arasından tamponu en az dolu / önce Dünya hattı açık olan)
      const cands = dyn ? s.cand?.[ai] : undefined;
      if (cands && cands.length > 1) {
        let best = -1, bestKey = Infinity;
        for (let j = 0; j < cands.length; j++) {
          const c = cands[j];
          if (!c.up) continue;
          const buf = relayBuf[c.relay];
          const fill = buf.capMb > 0 ? buf.usedMb / buf.capMb : 1;
          const key = cfg.routing!.select === 'openFirst' ? (s.earthUp[c.relay] ? 0 : 2) + fill : fill;
          if (key < bestKey - 1e-12) { bestKey = key; best = j; }
        }
        surfUp = best >= 0;
        if (best >= 0) { dstIdx = cands[best].relay; surfDelay = cands[best].delaySec; }
      }
      if (!surfUp) return;
      const src = assetBuf[ai];
      const dst = relayBuf[dstIdx];
      let budget = ((cfg.surfaceLinkKbps[a.body] ?? 0) / 1000) * dt;
      while (budget > 1e-12) {
        const k = pick(src);
        if (k < 0) break;
        const p = headOf(src, k)!;
        const need = p.sizeMb - p.sentMb;
        if (budget < need) { p.sentMb += budget; break; }
        if (!canAccept(dst, p)) break; // uydu tamponu dolu: araç gönderemez, kendi tamponunda tutar
        budget -= need;
        if (arq) att[k]++;
        if (arq && attemptLost(false, ai, i)) {
          // kayıp deneme: bant genişliği harcandı; paket tamponda kalır ve yeniden denenir (ya da hak tükenir)
          txLost[k]++; p.attempts++; p.sentMb = 0;
          if (p.attempts >= arq.maxAttempts) { take(src, k); aband[k]++; abandMb[k] += p.sizeMb; abandSurface++; }
          else {
            retx[k]++;
            if (surfRetry > 0) { popHead(src, k); src.held[k] += p.sizeMb; surfPend[ai].push({ p, k, at: now + surfRetry, ok: false }); }
          }
          continue;
        }
        take(src, k);
        p.sentMb = 0; p.attempts = 0;
        p.propSec += surfDelay;
        put(dst, p);
      }
    });

    // 2b) Aşama 10: uydular arası bağlantı: Dünya hattı kapalı uydudaki veri, hattı açık eşine aktarılır (paketin tamamı; kesirli aktarma ilerlemesi sonraki hatta devredilmez)
    if (islKbps > 0 && topo.isl) {
      topo.isl.forEach(([x, y], pi) => {
        if (!s.islUp?.[pi]) return;
        for (const [from, to] of [[x, y], [y, x]] as [number, number][]) {
          const key = pi * 2 + (from === x ? 0 : 1);
          if (s.earthUp[from] || !s.earthUp[to]) { islCredit[key] = 0; continue; }
          const src = relayBuf[from], dst = relayBuf[to];
          islCredit[key] = Math.min(islCredit[key] + (islKbps / 1000) * dt, 2 * maxPacketMb);
          for (;;) {
            const k = pick(src);
            if (k < 0) { islCredit[key] = 0; break; }
            const p = headOf(src, k)!;
            const need = p.sizeMb - p.sentMb;
            if (islCredit[key] < need - 1e-12 || !canAccept(dst, p)) break;
            islCredit[key] -= need;
            take(src, k);
            p.sentMb = 0; p.attempts = 0;
            p.propSec += s.islDelaySec?.[pi] ?? 0;
            put(dst, p);
          }
        }
      });
    }

    // 3) Uydu → Dünya
    topo.relays.forEach((r, ri) => {
      if (!s.earthUp[ri]) return;
      const buf = relayBuf[ri];
      let budget = ((cfg.relayDownlinkKbps[r] ?? 0) / 1000) * dt;
      // Aşama 10: ayrılmış telemetri payı: önce yalnızca en önemli sınıf, bu pay kadar bütçeyle (kullanılmayan kısım aşağıdaki genel döngüye devredilir)
      let reserve = tShare > 0 ? budget * tShare : 0;
      while (budget > 1e-12) {
        const k = reserve > 1e-12 ? pickTop(buf) : pick(buf);
        if (reserve > 1e-12 && k < 0) { reserve = 0; continue; }
        if (k < 0) break;
        const p = headOf(buf, k)!;
        const need = p.sizeMb - p.sentMb;
        if (reserve > 1e-12) {
          if (reserve < need) { const part = Math.min(reserve, budget); p.sentMb += part; budget -= part; reserve = 0; continue; }
          reserve -= need;
        } else if (budget < need) { p.sentMb += budget; break; }
        budget -= need;
        if (arq) {
          // gönderici kopyayı RTT boyunca tamponunda tutar: kuyruktan çıkar ama yer tutmaya devam eder
          popHead(buf, k); p.sentMb = 0; p.attempts++; buf.held[k] += p.sizeMb;
          const rtt = 2 * s.earthDelaySec[ri];
          att[k]++;
          if (attemptLost(true, ri, i)) { txLost[k]++; inflight[ri].push({ p, k, at: end + rtt, ok: false }); continue; }
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
  for (const list of surfPend) for (const h of list) remaining[h.k]++; // yüzey hattı: yeniden deneme beklemede

  // Zamanla azalan değer: Σ paket boyutu × 2^(−yaş / yarı ömür) = Σ boyut × exp(−yaş × ln2 / yarı ömür) (döngü + exp, reduce + pow'dan ~7 kat hızlı)
  const decayCoef = (cfg.valueHalfLivesSec ?? []).map((h) => Math.LN2 / h);
  const decaySum = (ages: number[], packetMb: number): number[] => {
    const acc = new Array<number>(decayCoef.length).fill(0);
    if (!decayCoef.length) return acc;
    for (let i = 0; i < ages.length; i++) for (let j = 0; j < decayCoef.length; j++) acc[j] += Math.exp(-ages[i] * decayCoef[j]);
    return acc.map((x) => x * packetMb);
  };
  const mk = (k: number): ClassStats => {
    const l = Float64Array.from(lat[k]).sort(); // sayısal artan (Float64Array.sort karşılaştırıcısız ve çok daha hızlı; sonuç aynı)
    return {
      expired: expd[k], expiredMb: expdMb[k],
      abandoned: aband[k], abandonedMb: abandMb[k], txLost: txLost[k], retransmissions: retx[k], attempts: att[k],
      generated: gen[k], delivered: deliv[k], dropped: drop[k], stored: stored[k], delayed: delayed[k], remaining: remaining[k],
      suppressed: sup[k], suppressedMb: supMb[k],
      decayMb: decaySum(lat[k], classes[k].packetMb),
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
  const allLat = (() => { const a = new Float64Array(lat.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of lat) for (let i = 0; i < x.length; i++) a[o++] = x[i]; return a.sort(); })();
  const total: ClassStats = {
    expired: sum((c) => c.expired), expiredMb: sum((c) => c.expiredMb),
    abandoned: sum((c) => c.abandoned), abandonedMb: sum((c) => c.abandonedMb), txLost: sum((c) => c.txLost), retransmissions: sum((c) => c.retransmissions), attempts: sum((c) => c.attempts),
    generated: sum((c) => c.generated), delivered: sum((c) => c.delivered), dropped: sum((c) => c.dropped),
    stored: sum((c) => c.stored), delayed: sum((c) => c.delayed), remaining: sum((c) => c.remaining),
    suppressed: sum((c) => c.suppressed), suppressedMb: sum((c) => c.suppressedMb),
    decayMb: (cfg.valueHalfLivesSec ?? []).map((_, j) => sum((c) => c.decayMb[j])),
    generatedMb: sum((c) => c.generatedMb), deliveredMb: sum((c) => c.deliveredMb), droppedMb: sum((c) => c.droppedMb),
    latencyMeanSec: allLat.length ? allLat.reduce((x, y) => x + y, 0) / allLat.length : 0,
    latencyP95Sec: allLat.length ? allLat[Math.min(allLat.length - 1, Math.floor(0.95 * allLat.length))] : 0,
    latencyMaxSec: allLat.length ? allLat[allLat.length - 1] : 0,
  };

  return {
    policy, perClass, total, series,
    peakRelayFill: Object.fromEntries(topo.relays.map((r, i) => [r, peakRelay[i]])),
    peakAssetFill: Object.fromEntries(topo.assets.map((a, i) => [a.id, peakAsset[i]])),
    maxLossRun, abandonedSurface: abandSurface,
  };
}
