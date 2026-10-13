import type { Chart, ChartConfiguration, Plugin } from 'chart.js';
import { HYPOTHETICAL, HYPOTHETICAL_LABEL } from '../config/hypothetical';
import type { Track } from '../data/types';
import { dateToJd, trackEndJD } from '../map/ephemeris';
import { effectiveAssets, effectiveRelays, type BlackoutWindow, type NetOptions } from '../network/network';
import { ComputePool, createPool } from '../network/computeClient';
import type { CoverageRow } from '../network/coverage';
import type { SimOut, TlInfo, TlSpec } from '../network/compute';
import type { ForecastError, Policy, ProjectionOptions, SchedConfig, SimResult } from '../network/scheduler';
import { ALL_POLICIES, POLICIES, sweepValues, valuePct, type Metrics, type PartialPolicyMetrics, type SweepKey } from '../network/sweep';
import { LINK_MODE_LABEL, MARS_RELAY, MOON_RELAY, defaultParams, lightDelaySeries, rollingConfig, schedConfig, withParams, type LinkMode, type SweepParams } from '../network/timeline';
import { mountExtras } from './schedulerExtras';
import { C, COLOR, DASH, NAME, NOBLACKOUT_POLICIES, baseOpts, day, fmt, valueOpts, year, type Scen, type ScenKind } from './schedShared';

const COMPARE_STATIONS = [1, 2, 3];

/** Ana iş parçacığını uzun görevlerden korumak için bir sonraki makro göreve geç (grafik çizimleri arasında). */
const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** Chart.js yalnızca kullanılan bileşenlerle yüklenir (chart.js/auto yerine; tüm denetleyicileri/eklentileri kaydetmez): daha az çözümleme/değerlendirme maliyeti. */
async function loadChart(): Promise<typeof import('chart.js').Chart> {
  const m = await import('chart.js');
  m.Chart.register(m.BarController, m.LineController, m.BarElement, m.LineElement, m.PointElement, m.CategoryScale, m.LinearScale, m.Legend, m.Title, m.Tooltip);
  return m.Chart;
}

/** Kaydırıcı tanımları: aralıklar config'ten, başlangıç değerleri çizelgeleyici config'inden gelir. */
interface SliderDef { key: SweepKey; label: string; unit: string; scale: number; digits: number; min: number; max: number; step: number }
function sliderDefs(def: SweepParams, kind: ScenKind): SliderDef[] {
  const s = HYPOTHETICAL.sensitivity;
  const widen = (r: { min: number; max: number; step: number }, v: number) => ({ min: Math.min(r.min, v), max: Math.max(r.max, v), step: r.step });
  const name = kind === 'mars' ? 'Mars' : 'Ay';
  const buf = kind === 'mars' ? s.marsRelayBufferMb : s.moonRelayBufferMb;
  const dl = kind === 'mars' ? s.marsRelayDownlinkKbps : s.moonRelayDownlinkKbps;
  return [
    { key: 'relayBufferMb', label: `${name} uydu tamponu`, unit: 'Gbit', scale: 1000, digits: kind === 'mars' ? 0 : 1, ...widen(buf, def.relayBufferMb) },
    { key: 'relayDownlinkKbps', label: `${name} uydu → Dünya hat hızı`, unit: 'kbit/sn', scale: 1, digits: 0, ...widen(dl, def.relayDownlinkKbps) },
    { key: 'dutyCycle', label: 'Görev döngüsü (üretim oranı)', unit: '%', scale: 0.01, digits: 1, ...widen(s.dutyCycle, def.dutyCycle) },
    { key: 'earthLossPct', label: 'Uydu → Dünya hat kaybı (ortalama)', unit: '%', scale: 1, digits: 0, ...widen(HYPOTHETICAL.arq.earthLossRangePct, def.earthLossPct) },
  ];
}
const SWEEP_KEYS: SweepKey[] = ['relayBufferMb', 'relayDownlinkKbps', 'dutyCycle', 'earthLossPct'];
function sweepMeta(key: SweepKey, relayName: string): { title: string; x: (v: number) => number; xTitle: string } {
  switch (key) {
    case 'relayBufferMb': return { title: 'Tampon boyutu', x: (v) => v / 1000, xTitle: `${relayName} uydu tamponu (Gbit)` };
    case 'relayDownlinkKbps': return { title: 'Hat hızı', x: (v) => v, xTitle: `${relayName} uydu → Dünya hızı (kbit/sn)` };
    case 'dutyCycle': return { title: 'Görev döngüsü', x: (v) => v * 100, xTitle: 'Görev döngüsü (%)' };
    case 'earthLossPct': return { title: 'Hat kaybı', x: (v) => v, xTitle: 'Uydu → Dünya hat kaybı (%)' };
  }
}

export interface SchedulerPanel { show(): void }

export function mountScheduler(root: HTMLElement, tracks: Record<string, Track>, windows: BlackoutWindow[], synthetic: boolean): SchedulerPanel {
  const sc = HYPOTHETICAL.scheduler;
  const cls = sc.classes;
  const defs: Record<ScenKind, SweepParams> = { mars: defaultParams(MARS_RELAY), moon: defaultParams(MOON_RELAY) };
  const prms: Record<ScenKind, SweepParams> = { mars: { ...defs.mars }, moon: { ...defs.moon } };
  const scenarioCharts: Chart[] = [];
  const delayCharts: Chart[] = [];
  const cmpCharts: Chart[] = [];
  const sweepCharts: Record<string, Chart[]> = {};
  let ChartCtor: typeof import('chart.js').Chart | null = null;
  let built = false;
  let token = 0; // her yeni hesaplama bir öncekini geçersiz kılar (iptal)
  // Uzun hesaplar Web Worker havuzunda çalışır (ana iş parçacığı yalnızca çizer); havuz ilk kullanımda kurulur ve izleri alır.
  let pool: ComputePool | null = null;
  const getPool = () => { if (!pool) { pool = createPool(); void pool.init(tracks); } return pool; };
  /** Süren hesabı iptal eder: belirteç değişir, bekleyen işler başlamaz, sürenlerin sonucu atılır (atılan işlerin sözleri sonuçlanmaz). */
  const bump = () => { token++; pool?.cancel(); return token; };
  let stationCount = HYPOTHETICAL.groundStations.stations.length;
  let linkMode: LinkMode = 'arq';
  let kind: ScenKind = 'mars';
  let rollingDays = HYPOTHETICAL.rollingStrategy.rollingDays;
  // Aşama 9 seçenekleri (hepsi varsayılan = Aşama 3-8 davranışı)
  let projection: ProjectionOptions = { ...HYPOTHETICAL.projection };
  const netSel = { moonOrbit: 'equatorial' as 'equatorial' | 'elliptical', moonSecond: 'none' as 'none' | 'best' | 'order', moonPolarAsset: false, marsEclipse: 'none' as 'none' | 'earth' | 'both' };
  let marsFree = false; // Mars: kavuşumsuz serbest tarih aralığı
  let active: Scen | null = null;
  const params = () => prms[kind];
  const def = () => defs[kind];

  const pad = sc.scenarioPadDays;
  const dataEnd = Math.min(trackEndJD(tracks.earth), trackEndJD(tracks.mars), trackEndJD(tracks.moon));
  const dataStart = Math.max(tracks.earth.startJD, tracks.moon.startJD, tracks.mars.startJD);
  const usable = windows.filter((w) => w.startJD - pad.before >= tracks.earth.startJD && w.endJD + pad.after <= Math.min(trackEndJD(tracks.earth), trackEndJD(tracks.mars)));
  const opts = usable.map((w, i) => `<option value="${i}">${day(w.startJD)} – ${day(w.endJD)} (en küçük açı ${fmt(w.minSepDeg, 2)}°, ${fmt(w.endJD - w.startJD, 1)} gün)</option>`).join('');
  const ms = HYPOTHETICAL.moonScenario;
  const clampISO = (iso: string) => day(Math.min(Math.max(dateToJd(new Date(iso + 'T00:00:00Z')), dataStart + 1), dataEnd - 8));

  root.innerHTML = `
    <div class="sched-wrap">
      <h2>Çizelgeleyici analizi <span class="badge-hyp">${HYPOTHETICAL_LABEL}</span></h2>
      <p class="warn">Bu sonuçlar <b>gerçek bir görev sonucu değildir</b>. Araçlar, veri hızları, paket boyutları, öncelik sınıfları, tampon kapasiteleri, hata modeli ve strateji parametreleri uydurmadır (<code>src/config/hypothetical.ts</code>). Gerçek olan tek şey Horizons konumlarından gelen ışık gecikmeleri ve bağlantı geometrisidir.</p>
      ${synthetic ? '<p class="warn syn"><b>SENTETİK VERİ:</b> sayfa <code>?sentetik=1</code> ile açıldı; yörüngeler Horizons değil, uydurma dairesel yörüngelerdir. Gecikme ve kavuşum tarihleri gerçeği yansıtmaz.</p>' : ''}

      <section>
        <h3>(a) Tek yön ışık gecikmesi <small>(Dünya merkezi – cisim merkezi, Horizons konumları)</small></h3>
        <div class="charts two"><div class="chart"><canvas id="ch-moon" aria-label="Ay ışık gecikmesi"></canvas></div><div class="chart"><canvas id="ch-mars" aria-label="Mars ışık gecikmesi"></canvas></div></div>
        <p class="hint" id="delay-stats"></p>
      </section>

      <section>
        <h3>Senaryo ve ayarlar <small>(${HYPOTHETICAL_LABEL})</small></h3>
        <div class="row">
          <label>Hat <select id="sel-scen"><option value="mars">Mars aktarma hattı (kavuşum penceresi)</option><option value="marsfree">Mars aktarma hattı (tarih aralığı; kavuşumsuz önerilir)</option><option value="moon">Ay aktarma hattı (tarih aralığı, kavuşum yok)</option></select></label>
          <label id="lb-window">Kavuşum penceresi <select id="sc-window">${opts || '<option>Uygun pencere yok</option>'}</select></label>
          <span id="date-ctl" class="row" hidden>
            <label>Başlangıç <input type="date" id="moon-start" min="${day(dataStart + 1)}" max="${day(dataEnd - 8)}" value="${clampISO(ms.defaultStart)}"></label>
            <label>Süre <select id="moon-days">${ms.lengthOptions.map((n) => `<option value="${n}"${n === ms.defaultDays ? ' selected' : ''}>${n} gün</option>`).join('')}</select></label>
          </span>
          <span class="legend" id="sc-status" role="status"></span>
        </div>
        <div class="sliders" id="sliders"></div>
        <div class="row">
          <label>Yer istasyonu sayısı <select id="sel-stations">${[0, ...HYPOTHETICAL.groundStations.stations.map((_, i) => i + 1)].map((n) => `<option value="${n}"${n === stationCount ? ' selected' : ''}>${n === 0 ? 'Yok (ideal: Dünya merkezi)' : n}</option>`).join('')}</select></label>
          <label>Kayan ufuk <select id="sel-rolling">${HYPOTHETICAL.rollingStrategy.rollingDaysOptions.map((d) => `<option value="${d}"${d === rollingDays ? ' selected' : ''}>${fmt(d, d < 1 ? 1 : 0)} gün</option>`).join('')}</select></label>
          <label>Hat modu <select id="sel-mode">${(Object.keys(LINK_MODE_LABEL) as LinkMode[]).map((m) => `<option value="${m}"${m === linkMode ? ' selected' : ''}>${LINK_MODE_LABEL[m]}</option>`).join('')}</select></label>
        </div>
        <div class="row" id="a9-row">
          <span class="legend"><b>Havuz projeksiyonu</b> <span class="badge-hyp">Aşama 9</span></span>
          <label title="Araç tamponundaki veri yüzey hattı (araç → uydu) kapalıyken boşalmaz"><input type="checkbox" id="pj-surface"> yüzey hattı kapalılığı</label>
          <label title="Gönderici, onaylanmamış kopyayı RTT (2 × ışık gecikmesi) boyunca uydu tamponunda tutar"><input type="checkbox" id="pj-arq"> ARQ kopyaları RTT boyunca tamponda</label>
          <span id="moon-opts" class="row" hidden>
            <label>Ay yörüngesi <select id="sel-orbit"><option value="equatorial">ekvatoral dairesel (mevcut)</option><option value="elliptical">eğimli/eliptik (kutupsal)</option></select></label>
            <label>İkinci Ay uydusu <select id="sel-second"><option value="none">yok</option><option value="best">var: araç en iyi görüneni kullanır</option><option value="order">var: hat sırasıyla</option></select></label>
            <label><input type="checkbox" id="sel-polar"> kutup aracı ekle</label>
          </span>
          <span id="mars-opts" class="row" hidden>
            <label>Mars uydusu gölgesi <select id="sel-eclipse"><option value="none">yok (mevcut)</option><option value="earth">gölgede yalnız Dünya hattı kapalı</option><option value="both">gölgede yüzey + Dünya hattı kapalı</option></select></label>
          </span>
        </div>
        <p class="hint" id="a9-hint"></p>
        <p class="hint"><b>Yer istasyonu:</b> aktarma uydusunun Dünya bağlantısı, istasyonlardan en az biri uyduyu ${HYPOTHETICAL.groundStations.minElevationDeg}° üstünde görüyorsa açıktır. <b>Hat modu:</b> <i>kayıpsız</i> = Aşama 3-4 davranışı; <i>hatalı, yeniden iletimsiz</i> = kaybolan paket kalıcı kayıp (“hatta kayıp”); <i>hatalı + yeniden iletim</i> = periyodik kayıp (her ${fmt(100 / HYPOTHETICAL.arq.earthLossPct, 0)}. deneme, ortalama %${HYPOTHETICAL.arq.earthLossPct}), gönderici paketi ışık gidiş-dönüş süresi (RTT) boyunca tamponunda tutar, kaybolursa en çok ${HYPOTHETICAL.arq.maxAttempts} denemeye kadar yeniden gönderir; <i>kümelenmiş hata + yeniden iletim</i> = <b>aynı ortalama kayıp</b>, ama iki durumlu (iyi: %${fmt(HYPOTHETICAL.arq.burst.goodLossPct, 1)} / kötü: %${HYPOTHETICAL.arq.burst.badLossPct} kayıp, kötü durum ortalama ${fmt(HYPOTHETICAL.arq.burst.meanBadSec / 60)} dk) kümelenmiş dağılım; durum zinciri sabit tohumlu kendi üretecimizle üretilir (rastgelelik yok). Hat kaybı kaydırıcısı hatalı modlarda ortalama kaybı belirler; yüzey hattı kaybı sabit %${HYPOTHETICAL.arq.surfaceLossPct}.</p>
        <p class="hint" id="scen-hint"></p>
        <p class="hint">Aynı bağlantı çizelgesi altı (kavuşumsuz hatlarda dört) çizelgeleyiciyle çalıştırılır: <b>FIFO</b> (geliş sırası), <b>öncelikli</b> (${cls.map((c) => c.name).join(' > ')}), <b>strateji</b> (öncelikli + kavuşum öncesi/sırasında bilim verisi üretimini kısma; Aşama 4, olduğu gibi korundu) ve <b>kapsama bilen strateji</b> (Aşama 7: aynı kısma, ama bütçede kavuşum sonrası boşaltma kapasitesi — yer istasyonu kapsaması ve hat açık süresi — de hesaba katılır) ve <b>kayan ufuklu strateji</b> (Aşama 8: aynı havuz projeksiyonu, ama kavuşum işaretine bağlı değil; her adımda önümüzdeki “kayan ufuk” boyunca takvimden öngörülen <i>her</i> kapalı hat dönemi — yer istasyonu boşluğu, cisim arkası, kavuşum — için kısar; Ay'da da çalışır) ve <b>uyarlamalı ufuk</b> (Aşama 9: kayan ufuklu ile aynı projeksiyon, ama ufuk sabit değil, takvimdeki yakın kapalı dönemin <i>uzunluğuna</i> göre seçilir: dönemin bitişine kalan süre + dönem uzunluğunun bir katı). Taşan tamponda FIFO yeni geleni atar; diğerleri daha düşük sınıfın en yeni paketini atarak yer açar.</p>
      </section>

      <section>
        <h3>Yer istasyonu görüşü <small id="st-sub">(${HYPOTHETICAL_LABEL})</small></h3>
        <div id="st-table"></div>
        <p class="hint" id="st-hint"></p>
      </section>

      <section>
        <h3>Kayıp, üretilmeyen ve talep: tanımlar</h3>
        <div class="warn def">
          <b>Düşen (kayıp):</b> üretilmiş ama tampon taşması yüzünden atılan veri.<br>
          <b>Üretilmeyen:</b> strateji yüzünden hiç üretilmeyen (kısılan) veri. Tampona hiç girmediği için <i>düşen sayılmaz</i>; ayrı sütunda gösterilir.<br>
          <b>Talep</b> = üretilen + üretilmeyen: çizelgeleyiciden bağımsız, araçların kısma olmasaydı üreteceği veri. FIFO ve öncelikli çizelgeler üretimi kısmaz (üretilmeyen = 0), bu yüzden talepleri üretilene eşittir.<br>
          <b>Karşılaştırma ölçütleri:</b> “düşen %” = düşen / talep; “düşen + üretilmeyen %” = stratejiyi kısmakla kayıptan kurtulmuş saymayan, daha sert ölçüt. Stratejiler ikisini de gösterir. “Teslim %” = teslim / talep.<br>
          <b>Hatta kayıp:</b> hat hatası yüzünden maxAttempts denemede iletilemeyen paket (yeniden iletimsiz modda ilk kayıp kalıcıdır). Tampon taşması olan “düşen”den ayrıdır; kayıp ölçütlerine (düşen + hatta kayıp [+ üretilmeyen]) birlikte girer.<br>
          <b>Her zaman:</b> üretilen = teslim + düşen + hatta kayıp + tamponda kalan; talep = üretilen + üretilmeyen (testle doğrulanır). Yeniden iletimde gönderici, onaylanmamış kopyayı tamponunda tutar; bu tampon doluluğuna sayılır.
        </div>
      </section>

      <section>
        <h3>(b) Çizelgeleyici karşılaştırması</h3>
        <div class="charts three">
          <div class="chart"><canvas id="ch-lat" aria-label="Teslim süresi"></canvas></div>
          <div class="chart"><canvas id="ch-fill" aria-label="Tampon doluluğu"></canvas></div>
          <div class="chart"><canvas id="ch-loss" aria-label="Kayıp ve üretilmeyen"></canvas></div>
        </div>
        <p class="hint">Teslim süresi yalnızca <i>teslim edilenler</i> üzerinden hesaplanır: bir çizelgeleyici paketi düşürürse (veya strateji hiç üretmezse) onun beklemesi ortalamaya girmez (hayatta kalma yanlılığı). Bu yüzden süreyi kayıp ve teslim sayısıyla birlikte okuyun. Kavuşum sırasında üretilen telemetri her çizelgeleyicide kesintinin bitmesini beklemek zorundadır; bu yüzden telemetri süresi kesinti uzunluğuna yakındır.</p>
        <div id="stats-table"></div>
      </section>

      <section>
        <h3 id="buf-title">(c) Aktarma uydusu tamponu</h3>
        <div class="charts one"><div class="chart tall"><canvas id="ch-buf" aria-label="Tampon dolup boşalması"></canvas></div></div>
        <p class="hint" id="buf-hint"></p>
      </section>

      <section>
        <h3>(d) Yer istasyonu sayısına göre karşılaştırma <small>(1, 2, 3 istasyon · seçili senaryo, kaydırıcı değerleri ve hat modu · ${HYPOTHETICAL_LABEL})</small></h3>
        <div class="charts two">
          <div class="chart"><canvas id="ch-st-drop" aria-label="İstasyon sayısına göre düşen"></canvas></div>
          <div class="chart"><canvas id="ch-st-loss" aria-label="İstasyon sayısına göre düşen ve üretilmeyen"></canvas></div>
        </div>
        <div id="cmp-table"></div>
        <p class="hint" id="cmp-hint"></p>
      </section>

      <section>
        <h3>(e) Hata modeli: periyodik ve kümelenmiş <small>(öncelikli çizelge · <span id="err-sub"></span> · ${HYPOTHETICAL_LABEL})</small></h3>
        <div id="err-table"></div>
        <p class="hint" id="err-hint"></p>
      </section>

      <section>
        <h3>(f) Duyarlılık analizi <small>(her grafikte yalnızca o parametre değişir, diğerleri kaydırıcı değerinde)</small></h3>
        <div class="row">
          <label>Kayıp ölçütü <select id="sw-loss-metric"><option value="total">Toplam (hacim %)</option><option value="top">Telemetri (hacim %)</option><option value="deliv">Teslim edilen (talebin %'si)</option><option value="value">Değer (bölüm i ağırlıkları, sabit değer; teslim edilen değer %)</option><option value="abandoned">Hatta kayıp (hacim %)</option><option value="retx">Yeniden gönderilen (paket)</option></select></label>
          <label>Süre ölçütü <select id="sw-time-metric"><option value="topP95">Telemetri, %95</option><option value="lowP95">Bilim verisi, %95</option><option value="topMean">Telemetri, ortalama</option><option value="lowMean">Bilim verisi, ortalama</option></select></label>
          <span class="legend" id="sw-status" role="status"></span>
        </div>
        <div class="charts four" id="sw-loss-grid">${SWEEP_KEYS.map((k) => `<div class="chart"><canvas id="sw-loss-${k}" aria-label="${sweepMeta(k, '').title}: kayıp"></canvas></div>`).join('')}</div>
        <div class="charts four" id="sw-time-grid">${SWEEP_KEYS.map((k) => `<div class="chart"><canvas id="sw-time-${k}" aria-label="${sweepMeta(k, '').title}: teslim süresi"></canvas></div>`).join('')}</div>
        <p class="hint">Düşey kesikli çizgi kaydırıcının şu anki değeridir. FIFO ve öncelikli çizelgeler tüm hacmi aynı oranda kaybedebilir (ikisi de işi korur; kalın mavi çizgi altta kalır); fark “Telemetri” ölçütünde ve sınıf tablosunda görülür. Telemetri kısılmadığı için telemetri tek başına tamponu aşarsa (yüksek görev döngüsü, küçük tampon) stratejiler düşenleri engelleyemez. “(düşen + hatta kayıp)” çizgileri üretilmeyen veriyi saymaz, “(+ üretilmeyen)” çizgileri kısılan veriyi de kayıp sayar; stratejileri adil değerlendirmek için ikisine birlikte bakın. Tarama adımı ${HYPOTHETICAL.sensitivity.sweepStepSec} sn (ana senaryo ${sc.stepSec} sn); sayılar iki hesap arasında küçük farklar gösterebilir. Bu bir tek senaryo aralığı içindir; başka aralıkta (farklı mesafe/gecikme/kapsama) değerler değişir.</p>
      </section>

      <div class="row" id="auto-row"><label><input type="checkbox" id="auto-scan"> (g) ve (h) taramalarını ana bölümler bittikten sonra <b>otomatik</b> hesapla</label><span class="hint" style="margin:0">Varsayılan kapalı: Worker havuzuyla bile Mars'ta ≈ 3,5–4,5 sn ek hesap yapar (ana iş parçacığı etkilenmez, ama “her şey hazır” süresi ≈ 5,5 sn → ≈ 9,5 sn olur ve her değişiklikte yeniden çalışır).</span></div>

      <section>
        <h3>(g) Tahmin hatası <small>(stratejilerin bildiği takvim ve ortalama kayıp gerçekten sapınca · öncelikli çizelge ve Aşama 4 stratejisiyle karşılaştırma · ${HYPOTHETICAL_LABEL})</small></h3>
        <p class="hint">Stratejiler bağlantı takvimini (hangi anlarda Dünya hattı açık) ve ortalama hat kaybını <b>kusursuz</b> bilir. Burada simülasyon (gerçek bağlantılar, gerçek kayıp) aynı kalır; yalnızca stratejinin <i>karar verirken kullandığı</i> tahmin sapar: (1) her açık pencerenin başı ve sonu ±N dk kayar (+: pencere olduğundan uzun sanılır, iyimser; −: kısa sanılır, kötümser), (2) pencerelerin tümü ±N dk ötelenir, (3) ortalama kayıp tahmini ±% sapar. Sapmalar belirleyici ve sabittir (rastgelelik yok); tahmin ${HYPOTHETICAL.forecastScan.stepSec} sn adıma yuvarlanır. Kayan ufuk ve istasyon sayısı yukarıdaki seçimdir. Hesap uzun sürdüğü için <b>düğmeyle</b> başlar (seçimler değişince sonuç silinir).</p>
        <div class="row"><button type="button" id="fc-run">Tahmin hatası taramasını hesapla</button><span class="legend" id="fc-status" role="status"></span></div>
        <div id="fc-body"></div>
      </section>

      <section>
        <h3>(h) Hata modeli duyarlılığı <small>(kümelenmiş model, öncelikli çizelge · kötü durum kaybı, kötü durum süresi, yüzey hattı yeniden deneme aralığı · ${HYPOTHETICAL_LABEL})</small></h3>
        <p class="hint">Kümelenmiş hata modelinin (iyi/kötü durum) parametreleri taranır; <b>ortalama kayıp sabit kalır</b> (yüzey %${HYPOTHETICAL.arq.surfaceLossPct}, Dünya hattı kaydırıcıdaki değer), yalnızca dağılımı değişir. Çıktı: hatta kayıp paket sayısı (${HYPOTHETICAL.arq.maxAttempts} deneme aşıldı), <b>yüzey / Dünya hattı ayrımıyla</b>. Üçüncü grafik, Aşama 7'de baskın çıkan yüzey hattı kaybının yeniden deneme aralığıyla nasıl değiştiğini gösterir (varsayılan ${HYPOTHETICAL.arq.surfaceRetrySec} sn = aynı adımda; <code>HYPOTHETICAL.arq.surfaceRetrySec</code>). Kaybolan paket yeniden deneme beklerken tamponda yer tutar. Düğmeyle başlar.</p>
        <div class="row"><button type="button" id="em-run">Hata modeli taramalarını hesapla</button><span class="legend" id="em-status" role="status"></span></div>
        <div id="em-body"></div>
      </section>

      <section>
        <h3>(i) Değer ağırlıklı fayda <small>(teslim edilen değer / talep edilen değer · telemetri ve bilim verisi için varsayımsal birim değer · isteğe bağlı zamanla azalan değer · ${HYPOTHETICAL_LABEL})</small></h3>
        <p class="hint">Mevcut ölçütler (düşen %, düşen + üretilmeyen %, teslim %) aynen kalır; bu bölüm onlara <b>ek</b> bir ölçüt ekler. Birim değerler (<code>src/config/hypothetical.ts</code>: telemetri ${HYPOTHETICAL.scheduler.classes[0].valuePerMb}, bilim verisi ${HYPOTHETICAL.scheduler.classes[1].valuePerMb} birim/Mb) <b>uydurmadır</b>. Seçimler yalnızca bu bölümü, karşılaştırma tablosundaki “Değer %” sütununu ve duyarlılık grafiklerinin “Değer” ölçütünü etkiler; ek çizelgeleyici hesabı gerekmez.</p>
        <div class="row">
          <label>Telemetri birim değeri <select id="v-tw"></select></label>
          <label>Bilim verisi değeri <select id="v-hl"></select></label>
          <label>Duyarlılık ızgarası politikası <select id="v-pol"></select></label>
        </div>
        <p class="hint" id="v-def"></p>
        <div id="v-table"></div>
        <div id="v-st"></div>
        <div id="v-grid"></div>
        <p class="hint" id="v-verdict"></p>
      </section>

      <section>
        <h3>(j) İyimser varsayımların kaldırılması: etki <small>(havuz projeksiyonu: yüzey hattı kapalılığı, ARQ kopyalarının RTT boyunca tampon payı · 1/2/3 istasyon · ${HYPOTHETICAL_LABEL})</small></h3>
        <p class="hint">Kapsama bilen, kayan ufuklu ve uyarlamalı stratejilerin havuz projeksiyonu Aşama 8'e kadar iki şeyi iyimser varsayıyordu: (1) araç tamponundaki veri yüzey hattı (araç → uydu) kapalıyken de boşalır, (2) ARQ kopyaları uydu tamponunda yer tutmaz. İkisi de artık <b>seçenektir</b> (varsayılan kapalı, yukarıdaki işaret kutuları; Aşama 3–8 sayıları yeniden üretilir). Aşağıdaki tablo her iki seçeneği seçili senaryoda ve 1/2/3 istasyonda karşılaştırır. Düğmeyle başlar.</p>
        <div class="row"><button type="button" id="pj-run">Etkiyi hesapla</button><span class="legend" id="pj-status" role="status"></span></div>
        <div id="pj-body"></div>
      </section>

      <section>
        <h3 id="ob-title">(k) Ay aktarma uydusu yörüngesi ve ikinci uydu</h3>
        <p class="hint" id="ob-hint"></p>
        <div class="row"><button type="button" id="ob-run">Yörünge karşılaştırmasını hesapla</button><span class="legend" id="ob-status" role="status"></span></div>
        <div id="ob-body"></div>
      </section>

      <section>
        <h3>(l) Genelleme <small>(birden çok tarih aralığı / kavuşum penceresi · hata yokken ve tahmin hatasıyla · ${HYPOTHETICAL_LABEL})</small></h3>
        <p class="hint">Aşama 8 sonuçları tek senaryo aralığındandı (Ay 2028-03-03, Mars 2028 penceresi). Bu bölüm seçili hat, istasyon sayısı, hat modu ve kaydırıcı değerleriyle <b>Ay için ${HYPOTHETICAL.generalization.moonStarts.length} farklı ${HYPOTHETICAL.generalization.moonDays} günlük aralıkta</b> (${HYPOTHETICAL.generalization.moonStarts.join(', ')}) ya da <b>Mars'ın tüm kavuşum pencerelerinde</b> kayan ufuklu ve uyarlamalı stratejiyi öncelikliyle karşılaştırır ve pencere başı/sonu tahmin hatasını (−120/+120 dk) tekrarlar. Düğmeyle başlar.</p>
        <div class="row"><button type="button" id="gn-run">Genellemeyi hesapla</button><span class="legend" id="gn-status" role="status"></span></div>
        <div id="gn-body"></div>
      </section>

      <section>
        <h3>${HYPOTHETICAL_LABEL}</h3>
        <div id="assumptions"></div>
        <p class="hint">Basitleştirmeler: iki atlama (araç → uydu → Dünya), her atlamada tek bağlantı hızı; kodlama yok; paketler "toplu veri parçası"dır; uydu tamponu doluyken araç göndermez (geri basınç) ve verisini kendi tamponunda tutar; simülasyon adımı ${sc.stepSec} sn, bu yüzden teslim süreleri en fazla bir adım kadar kaba. Stratejiler bağlantı takvimini (kavuşum, yer istasyonu kapsaması) önceden bildiğini varsayar — yörünge ve Dünya dönüşü öngörülebilirdir; gerçek bir görevin bunu nasıl yaptığı bilinmiyor. Kapsama bilen strateji ayrıca ortalama hat kaybını önceden bilir.</p>
      </section>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

  const addChart = (list: Chart[], id: string, cfg: ChartConfiguration | Record<string, unknown>) => {
    const ch = new ChartCtor!($<HTMLCanvasElement>(id), cfg as ChartConfiguration);
    list.push(ch);
    return ch;
  };

  function renderAssumptions() {
    const st = HYPOTHETICAL.strategy, cs = HYPOTHETICAL.coverageStrategy, b = HYPOTHETICAL.arq.burst;
    const se = HYPOTHETICAL.sensitivity;
    const row = (a: string, b2: string) => `<tr><td>${a}</td><td>${b2}</td></tr>`;
    $('#assumptions').innerHTML = `<table class="stats"><tbody>
      ${cls.map((c) => row(`Sınıf: ${c.name}`, `öncelik ${c.priority} · pay %${fmt(c.share * 100)} · paket ${fmt(c.packetMb, 1)} Mb`)).join('')}
      ${row('Ortalama üretim', `veri hızının %${fmt(sc.dutyCycle * 100, 1)}'i (${HYPOTHETICAL.assets.map((a) => `${a.name}: ${fmt(a.dataRateKbps * sc.dutyCycle, 1)} kbit/sn`).join(' · ')})`)}
      ${row('Araç → uydu hızı', `Ay ${fmt(sc.surfaceLinkKbps.moon)} · Mars ${fmt(sc.surfaceLinkKbps.mars)} kbit/sn (araç başına)`)}
      ${row('Uydu → Dünya hızı', HYPOTHETICAL.relays.map((r) => `${r.name}: ${fmt(sc.relayDownlinkKbps[r.id])} kbit/sn`).join(' · '))}
      ${row('Araç tamponu', `Ay ${fmt(sc.assetBufferMb.moon)} Mb · Mars ${fmt(sc.assetBufferMb.mars)} Mb`)}
      ${row('Uydu tamponu', HYPOTHETICAL.relays.map((r) => `${r.name}: ${fmt(sc.relayBufferMb[r.id])} Mb`).join(' · '))}
      ${row('"Gecikmeli" eşiği', `kuyrukta ${fmt(sc.delayedAfterSec / 60)} dk'dan uzun bekleme`)}
      ${row('Mars senaryo aralığı', `kavuşumdan ${sc.scenarioPadDays.before} gün önce – ${sc.scenarioPadDays.after} gün sonra`)}
      ${row('Ay senaryo aralığı', `serbest başlangıç tarihi, ${ms.lengthOptions.join(' / ')} gün (varsayılan ${day(dateToJd(new Date(clampISO(ms.defaultStart) + 'T00:00:00Z')))}, ${ms.defaultDays} gün)`)}
      ${row('Strateji (bütçeli kısma, Aşama 4)', `kesintiye ${fmt(st.lookaheadDays, 1)} gün kala başlar · boş tamponun %${fmt(st.margin * 100)}'i bilim verisi bütçesi · çarpan alt sınırı ${fmt(st.minFactor, 2)} · telemetri kısılmaz`)}
      ${row('Kapsama bilen strateji (Aşama 7)', `kesintiye ${fmt(cs.lookaheadDays, 1)} gün kala başlar, kesinti boyunca ve bittikten sonra ${fmt(cs.recoveryDays)} gün sürer · tepe doluluk havuzun %${fmt(cs.margin * 100)}'ini geçmez (araç tamponunun %${fmt(cs.assetBufferShare * 100)}'i havuzda) · boşaltma kapasitesi = hat hızı × payı × (1 − ortalama kayıp) × hattın açık olduğu zamanlar (önceden bilinen takvim) · telemetri kısılmaz`)}
      ${row('Kayan ufuklu strateji (Aşama 8)', `her ${fmt(HYPOTHETICAL.rollingStrategy.refreshSec / 60)} dk'da önümüzdeki kayan ufuk (varsayılan ${fmt(HYPOTHETICAL.rollingStrategy.rollingDays, 1)} gün; seçenekler ${HYPOTHETICAL.rollingStrategy.rollingDaysOptions.join(' / ')}) boyunca takvimden öngörülen her kapalı hat dönemi için havuz ileri izlenir · tepe doluluk havuzun %${fmt(HYPOTHETICAL.rollingStrategy.margin * 100)}'ini geçmez (araç tamponunun %${fmt(HYPOTHETICAL.rollingStrategy.assetBufferShare * 100)}'i havuzda) · telemetri kısılmaz · takvim ve ortalama kayıp önceden bilinir (hata (g) bölümünde taranır)`)}
      ${row('Uyarlamalı ufuk (Aşama 9)', `her ${fmt(HYPOTHETICAL.adaptiveStrategy.refreshSec / 60)} dk'da: şimdi sürmekte olan ya da ${fmt(HYPOTHETICAL.adaptiveStrategy.leadDays, 1)} gün içinde başlayan ilk kapalı hat döneminin bitişine kalan süre + ${fmt(HYPOTHETICAL.adaptiveStrategy.tailFactor, 1)} × dönem uzunluğu kadar ileri izlenir, [${fmt(HYPOTHETICAL.adaptiveStrategy.minDays, 1)}, ${fmt(HYPOTHETICAL.adaptiveStrategy.maxDays)}] gün aralığına kırpılır (yakın kapalı dönem yoksa ${fmt(HYPOTHETICAL.adaptiveStrategy.minDays, 1)} gün) · tepe doluluk havuzun %${fmt(HYPOTHETICAL.adaptiveStrategy.margin * 100)}'ini geçmez · telemetri kısılmaz · takvim önceden bilinir`)}
      ${row('Değer ölçütü (Aşama 9)', `birim değer: ${cls.map((c) => `${c.name} ${c.valuePerMb}`).join(' · ')} (uydurma) · zamanla azalan değer yarı ömürleri (gün): ${HYPOTHETICAL.value.decayOptionsDays.join(', ')} (arayüzde varsayılan ${HYPOTHETICAL.value.decayHalfLifeDays}) · telemetri değeri taraması: ${HYPOTHETICAL.value.telemetryWeightScan.join(', ')}×`)}
      ${row('Projeksiyon seçenekleri (Aşama 9)', `yüzey hattı kapalılığı: ${HYPOTHETICAL.projection.surfaceClosure ? 'açık' : 'kapalı'} · ARQ kopyası RTT tamponu: ${HYPOTHETICAL.projection.arqHold ? 'açık' : 'kapalı'} (varsayılanlar; arayüzden değişir)`)}
      ${row('Ay yörüngeleri (Aşama 9)', `ekvatoral dairesel ${fmt(HYPOTHETICAL.relays[0].altitudeKm)} km (mevcut) · eğimli/eliptik: a ${fmt(HYPOTHETICAL.moonOrbits.elliptical.semiMajorKm)} km, e ${fmt(HYPOTHETICAL.moonOrbits.elliptical.ecc, 2)}, i ${HYPOTHETICAL.moonOrbits.elliptical.incDeg}°, ω ${HYPOTHETICAL.moonOrbits.elliptical.argPeriDeg}° (apolün güneyde) · ikinci uydu: ω ${HYPOTHETICAL.moonRelay2.orbit.argPeriDeg}° (apolün kuzeyde), ortalama anomali ${HYPOTHETICAL.moonRelay2.orbit.meanAnomalyDeg}°, hat hızı ${fmt(sc.relayDownlinkKbps[HYPOTHETICAL.moonRelay2.id])} kbit/sn, tampon ${fmt(sc.relayBufferMb[HYPOTHETICAL.moonRelay2.id])} Mb · kutup aracı ${HYPOTHETICAL.moonPolarAsset.latDeg}° / ${HYPOTHETICAL.moonPolarAsset.lonDeg}°, ${fmt(HYPOTHETICAL.moonPolarAsset.dataRateKbps)} kbit/sn · düzlem eylemsiz sabit (presesyon yok)`)}
      ${row('Mars uydusu gölgesi (Aşama 9)', `silindirik gölge (Güneş yönü Mars'ın Güneş'e göre konumundan; eksen ekliptiğe paralel varsayıldığından ekvatoral yörünge her turda gölgeden geçer) · güç modeli yok · gölgede yalnızca hat kapalı: ${HYPOTHETICAL.marsEclipse.modes.slice(1).join(' / ')} (earth: yalnız uydu → Dünya hattı, both: yüzey hattı da)`)}
      ${row('Genelleme (Aşama 9)', `Ay: ${HYPOTHETICAL.generalization.moonStarts.join(', ')} (${HYPOTHETICAL.generalization.moonDays} gün) · Mars: tüm kavuşum pencereleri`)}
      ${row('Tahmin hatası taraması (Aşama 8)', `adım ${fmt(HYPOTHETICAL.forecastScan.stepSec)} sn · pencere başı/sonu kayması (dk): ${HYPOTHETICAL.forecastScan.edgeShiftMin.join(', ')} · pencere ötelemesi (dk): ${HYPOTHETICAL.forecastScan.offsetMin.join(', ')} · ortalama kayıp sapması (%): ${HYPOTHETICAL.forecastScan.lossBiasPct.join(', ')}`)}
      ${row('Hata modeli taraması (Aşama 8)', `kötü durum kaybı (%): ${HYPOTHETICAL.errorScan.badLossPct.join(', ')} · kötü durum ortalama süresi (sn): ${HYPOTHETICAL.errorScan.meanBadSec.join(', ')} · yüzey hattı yeniden deneme aralığı (sn): ${HYPOTHETICAL.errorScan.surfaceRetrySec.join(', ')} (varsayılan ${HYPOTHETICAL.arq.surfaceRetrySec} = aynı adımda)`)}
      ${row('Yer istasyonları', `${HYPOTHETICAL.groundStations.stations.map((g) => `${g.name} (${fmt(g.latDeg, 1)}°, ${fmt(g.lonDeg, 1)}°)`).join(' · ')} · en düşük yükseklik ${HYPOTHETICAL.groundStations.minElevationDeg}° · anlık devir, tek hat`)}
      ${row('Hat hatası / yeniden iletim', `yüzey hattı %${fmt(HYPOTHETICAL.arq.surfaceLossPct, 1)}, Dünya hattı %${fmt(HYPOTHETICAL.arq.earthLossPct, 1)} ortalama (periyodik: belirleyici biriktirici) · en çok ${HYPOTHETICAL.arq.maxAttempts} deneme · Dünya hattında kopya RTT (2 × ışık gecikmesi) boyunca tamponda tutulur`)}
      ${row('Kümelenmiş hata (Aşama 7)', `iki durum: iyi %${fmt(b.goodLossPct, 1)} / kötü %${fmt(b.badLossPct)} kayıp · kötü durum ortalama ${fmt(b.meanBadSec / 60)} dk (zamana bağlı) · kötü durumda geçirilen oran, ortalama kaybı periyodik modelle eşitleyecek şekilde seçilir · durum zinciri ve kayıp çekilişleri sabit tohumlu (${b.seed}) kendi üretecimizle, Math.random yok`)}
      ${row('Kaydırıcı aralıkları', `Mars tampon ${fmt(se.marsRelayBufferMb.min / 1000)}–${fmt(se.marsRelayBufferMb.max / 1000)} Gbit · Mars hat ${fmt(se.marsRelayDownlinkKbps.min)}–${fmt(se.marsRelayDownlinkKbps.max)} kbit/sn · Ay tampon ${fmt(se.moonRelayBufferMb.min / 1000, 1)}–${fmt(se.moonRelayBufferMb.max / 1000)} Gbit · Ay hat ${fmt(se.moonRelayDownlinkKbps.min)}–${fmt(se.moonRelayDownlinkKbps.max)} kbit/sn · görev döngüsü %${fmt(se.dutyCycle.min * 100, 1)}–%${fmt(se.dutyCycle.max * 100, 1)} · hat kaybı %${fmt(HYPOTHETICAL.arq.earthLossRangePct.min)}–%${fmt(HYPOTHETICAL.arq.earthLossRangePct.max)} · tarama ${fmt(se.sweepPoints)} nokta + varsayılan`)}
    </tbody></table>`;
  }

  async function renderDelay() {
    const moon = lightDelaySeries(tracks, 'moon', 1);
    await nextTask();
    const mars = lightDelaySeries(tracks, 'mars', 5);
    if (!moon.length || !mars.length || [...moon, ...mars].some((p) => !Number.isFinite(p.sec))) throw new Error('Işık gecikmesi serisi hesaplanamadı: konum verisi eksik ya da bozuk.');
    const mk = (id: string, pts: { jd: number; sec: number }[], scale: number, label: string, ytitle: string, color: string) =>
      addChart(delayCharts, id, {
        type: 'line',
        data: { datasets: [{ label, data: pts.map((p) => ({ x: year(p.jd), y: p.sec / scale })), borderColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }] },
        options: baseOpts('Yıl', ytitle, {
          parsing: false, normalized: true,
          scales: { ...baseOpts('Yıl', ytitle).scales, x: { type: 'linear', title: { display: true, text: 'Yıl', color: C.text }, ticks: { color: C.text, stepSize: 2, callback: (v: number | string) => String(v) }, grid: { color: C.grid } } },
        }),
      });
    await nextTask();
    mk('#ch-moon', moon, 1, 'Ay (Dünya merkezi – Ay merkezi)', 'Tek yön gecikme (sn)', C.moon);
    await nextTask();
    mk('#ch-mars', mars, 60, 'Mars (Dünya merkezi – Mars merkezi)', 'Tek yön gecikme (dakika)', C.mars);
    const r = (p: { sec: number }[]) => [Math.min(...p.map((x) => x.sec)), Math.max(...p.map((x) => x.sec))];
    const [m0, m1] = r(moon), [a0, a1] = r(mars);
    $('#delay-stats').textContent = `Ay: ${fmt(m0, 2)}–${fmt(m1, 2)} sn · Mars: ${fmt(a0 / 60, 1)}–${fmt(a1 / 60, 1)} dk. Eksenler ayrı grafiklerdedir (ölçekler çok farklı). Uydu yüksekliği ve yüzey yolu (varsayımsal) bu eğriye dahil değildir.`;
  }

  // ---- Senaryo ----
  /** Seçili ağ seçenekleri (yalnızca varsayılandan farklı olanlar; boş = Aşama 2-8 ağı). */
  function netOptions(k: ScenKind): NetOptions {
    if (k === 'moon') {
      return { ...(netSel.moonOrbit !== 'equatorial' ? { moonOrbit: netSel.moonOrbit } : {}), ...(netSel.moonSecond !== 'none' ? { moonSecond: netSel.moonSecond } : {}), ...(netSel.moonPolarAsset ? { moonPolarAsset: true } : {}) };
    }
    return netSel.marsEclipse !== 'none' ? { marsEclipse: netSel.marsEclipse } : {};
  }
  const dateRange = (): { startJD: number; endJD: number } | null => {
    const iso = $<HTMLInputElement>('#moon-start').value;
    const startJD = iso ? dateToJd(new Date(iso + 'T00:00:00Z')) : NaN;
    const days = Number($<HTMLSelectElement>('#moon-days').value);
    if (!Number.isFinite(startJD) || startJD < dataStart || startJD + 1 > dataEnd) return null;
    return { startJD, endJD: Math.min(startJD + days, dataEnd) };
  };
  function scenario(): Scen | null {
    const net = netOptions(kind);
    const nk = JSON.stringify(net);
    if (kind === 'mars' && !marsFree) {
      const idx = Number($<HTMLSelectElement>('#sc-window').value);
      const w = usable[idx];
      if (!w) return null;
      return { kind, key: `mars|${idx}|${nk}`, relayId: MARS_RELAY, relayName: 'Mars', startJD: w.startJD - pad.before, endJD: w.endJD + pad.after, blackout: w, net, policies: ALL_POLICIES, sweepPolicies: POLICIES };
    }
    const r = dateRange();
    if (!r) return null;
    if (kind === 'mars') {
      // aralık bir kavuşum penceresiyle kesişiyorsa Aşama 4/7 stratejileri de anlamlıdır (aksi halde öncelikliyle aynı olur ve gösterilmez)
      const conj = windows.some((w) => w.startJD < r.endJD && w.endJD > r.startJD);
      return { kind, key: `marsfree|${r.startJD}|${r.endJD}|${nk}`, relayId: MARS_RELAY, relayName: 'Mars', ...r, free: true, net, policies: conj ? ALL_POLICIES : NOBLACKOUT_POLICIES, sweepPolicies: conj ? POLICIES : NOBLACKOUT_POLICIES };
    }
    return { kind, key: `moon|${r.startJD}|${r.endJD}|${nk}`, relayId: MOON_RELAY, relayName: 'Ay', ...r, net, policies: NOBLACKOUT_POLICIES, sweepPolicies: NOBLACKOUT_POLICIES };
  }

  // ---- Yer istasyonu kapsaması (senaryo başına bir kez; istasyon sayısından bağımsız tüm sayılar için) ----
  const coverageCache = new Map<string, { html: string; hint: string }>();
  async function renderCoverage(my: number, s: Scen) {
    const el = $('#st-table');
    const cached = coverageCache.get(s.key);
    if (cached) { el.innerHTML = cached.html; $('#st-hint').innerHTML = cached.hint; return; }
    el.textContent = 'Hesaplanıyor…';
    const counts = [0, ...HYPOTHETICAL.groundStations.stations.map((_, i) => i + 1)];
    const relays = effectiveRelays(s.net);
    const assets = effectiveAssets(s.net);
    const multiMoon = relays.filter((r) => r.body === 'moon').length > 1;
    const rows: string[] = [];
    let surface: Record<string, number> = {};
    const covRows = await Promise.all(counts.map((n) => getPool().call<CoverageRow>({ op: 'coverage', startJD: s.startJD, endJD: s.endJD, n, net: s.net })));
    if (my !== token) return;
    for (const { n, steps: t, see, up, surf, anyUp } of covRows) {
      if (n === 0) surface = Object.fromEntries(Object.entries(surf).map(([k, v]) => [k, (100 * v) / t]));
      rows.push(`<tr${n === stationCount ? ' class="cur"' : ''}><td>${n === 0 ? 'Yok (ideal)' : n}</td>${relays.map((r) => `<td>${n === 0 ? '—' : fmt((100 * see[r.id]) / t, 1)}</td><td>${fmt((100 * up[r.id]) / t, 1)}</td>`).join('')}${multiMoon ? `<td>${fmt((100 * anyUp) / t, 1)}</td>` : ''}</tr>`);
    }
    const html = `<table class="stats"><thead><tr><th>İstasyon sayısı</th>${relays.map((r) => `<th>${r.name.replace(' Aktarma Uydusu', '').replace('Ay Aktarma Uydusu 2', 'Ay 2')}: istasyon uyduyu görüyor %</th><th>${r.name.replace(' Aktarma Uydusu', '').replace('Ay Aktarma Uydusu 2', 'Ay 2')}: Dünya hattı açık %</th>`).join('')}${multiMoon ? '<th>Ay: en az bir uydunun Dünya hattı açık %</th>' : ''}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    const hint = `Aralık: ${day(s.startJD)} – ${day(s.endJD)} (30 dk adım). “Görüyor”: en az bir istasyon uyduyu ${HYPOTHETICAL.groundStations.minElevationDeg}° üstünde görüyor. “Dünya hattı açık”: ayrıca uydu cismin arkasında değil ve (Mars) kavuşum kesintisinde ya da (seçilirse) gölgede değil. Yüzey görüşü (araç → seçilen uydu, istasyon sayısından bağımsız): ${assets.map((a) => `${a.name} %${fmt(surface[a.id] ?? 0)}`).join(' · ')}.`;
    coverageCache.set(s.key, { html, hint });
    el.innerHTML = html;
    $('#st-hint').innerHTML = hint;
  }

  // ---- Bağlantı çizelgesi: Worker'larda üretilir ve önbelleklenir; ana iş parçacığı yalnızca tanımı ve özeti tutar ----
  const tlSpec = (s: Scen, stepSec: number, n: number = stationCount): TlSpec => ({ startJD: s.startJD, endJD: s.endJD, stepSec, stations: n, relayId: s.relayId, ...(Object.keys(s.net).length ? { net: s.net } : {}) });
  // Yalnızca tamamlanmış özetler önbelleklenir (iptal edilen işin sözü hiç sonuçlanmaz; bekleyen söz önbelleğe alınmaz).
  const infoCache = new Map<string, TlInfo>();
  async function tlInfo(s: Scen, stepSec: number, n: number = stationCount): Promise<TlInfo> {
    const key = `${s.key}|${stepSec}|${n}`;
    const hit = infoCache.get(key);
    if (hit) return hit;
    const info = await getPool().call<TlInfo>({ op: 'tlInfo', tl: tlSpec(s, stepSec, n) });
    infoCache.set(key, info);
    if (infoCache.size > 16) infoCache.delete(infoCache.keys().next().value as string);
    return info;
  }
  /** Bir çizelgeleyici çalıştırması (Worker); metrikler her zaman, tam sonuç (seriler, sayaçlar) yalnızca full ile döner. */
  const sim = (s: Scen, stepSec: number, n: number, policy: Policy, cfg: SchedConfig, full = false) =>
    getPool().call<SimOut>({ op: 'sim', tl: tlSpec(s, stepSec, n), policy, cfg, full });
  /** Bu senaryodaki ek uydular (ikinci Ay uydusu): kaydırıcı değerleri (tampon, hat hızı) onlara da uygulanır. */
  const extraRelays = (net: NetOptions) => (net.moonSecond && net.moonSecond !== 'none' ? [HYPOTHETICAL.moonRelay2.id] : []);
  const schedCfg = (s: Scen, mode: LinkMode = linkMode, over: Partial<SweepParams> = {}): SchedConfig => ({ ...withParams(schedConfig(mode), { ...params(), ...over }, s.relayId, extraRelays(s.net)), rolling: rollingConfig(rollingDays), projection: { ...projection } });
  // Aşama 9 bölümleri (değer ölçütü, projeksiyon etkisi, yörünge/gölge, genelleme): ayrı modül; ortak durum buradan verilir.
  let cmpDone = false;
  const extras = mountExtras({
    $, addChart: (list, id, cfg) => addChart(list, id, cfg),
    call: <T,>(req: Parameters<ComputePool['call']>[0]) => getPool().call<T>(req),
    cur: () => ({ s: active, stations: stationCount, mode: linkMode, rollingDays, projection: { ...projection } }),
    cfgFor: (relayId, net, over = {}) => {
      const k: ScenKind = relayId === MOON_RELAY ? 'moon' : 'mars';
      return {
        ...withParams(schedConfig(over.mode ?? linkMode), { ...prms[k], ...(over.params ?? {}) }, relayId, extraRelays(net)),
        rolling: rollingConfig(over.rollingDays ?? rollingDays), projection: over.projection ?? { ...projection }, stepSec: over.step ?? sc.stepSec,
      };
    },
    windows: usable, pad, dataEnd,
  });

  function tableHtml(res: Partial<Record<Policy, SimResult>>, policies: Policy[]) {
    const h = (s: number) => (s < 7200 ? `${fmt(s / 60, 1)} dk` : s < 172800 ? `${fmt(s / 3600, 1)} sa` : `${fmt(s / 86400, 1)} gün`);
    let ok = true;
    const supp = (p: Policy) => p === 'strategy' || p === 'coverage' || p === 'rolling' || p === 'adaptive';
    const rows = (p: Policy) => {
      const r = res[p]!;
      return [...cls.map((c) => [c.name, r.perClass[c.id]] as const), ['Toplam', r.total] as const]
        .map(([n, s]) => {
          if (s.generated !== s.delivered + s.dropped + s.abandoned + s.remaining) ok = false;
          const demand = s.generated + s.suppressed;
          return `<tr><td>${NAME[p]}</td><td>${n}</td><td>${fmt(demand)}</td><td>${fmt(s.generated)}</td><td>${supp(p) ? fmt(s.suppressed) : '—'}</td><td>${fmt(s.delivered)}</td><td>${fmt(s.stored)}</td><td>${fmt(s.delayed)}</td><td class="${s.dropped ? 'bad' : ''}">${fmt(s.dropped)}</td><td class="${s.abandoned ? 'bad' : ''}">${fmt(s.abandoned)}</td><td>${fmt(s.retransmissions)}</td><td>${fmt(s.remaining)}</td><td>${s.delivered ? h(s.latencyMeanSec) : '—'}</td><td>${s.delivered ? h(s.latencyP95Sec) : '—'}</td><td>${demand ? fmt((100 * s.deliveredMb) / (s.generatedMb + s.suppressedMb), 1) : '—'}</td></tr>`;
        })
        .join('');
    };
    return `<table class="stats"><thead><tr><th>Çizelgeleyici</th><th>Sınıf</th><th>Talep</th><th>Üretilen</th><th>Üretilmeyen</th><th>Teslim</th><th>Tamponlanan</th><th>Gecikmeli</th><th>Düşen</th><th>Hatta kayıp</th><th>Yeniden gönderilen</th><th>Tamponda kalan</th><th>Ort. süre</th><th>%95 süre</th><th>Teslim %</th></tr></thead><tbody>${policies.map(rows).join('')}</tbody></table>
      <p class="hint">Paket sayıları (Teslim % hacim üzerinden, talebe oranla). <b>Talep</b> = üretilen + üretilmeyen. <b>Üretilmeyen</b>: stratejilerin kıstığı, hiç üretilmeyen veri (kayıp değil). <b>Tamponlanan</b>: teslim edilmeden önce bir adımdan uzun tamponda bekleyen. <b>Gecikmeli</b>: kuyrukta ${fmt(sc.delayedAfterSec / 60)} dk'dan uzun bekleyip teslim edilen. <b>Düşen</b>: tampon taşması. <b>Hatta kayıp</b>: hat hatası yüzünden hakkı tükenen paket. <b>Yeniden gönderilen</b>: kaybolup yeniden iletilen paket sayısı. Üretilen = teslim + düşen + hatta kayıp + tamponda kalan. Korunum denetimi: <span class="${ok ? 'ok' : 'bad'}">${ok ? 'tüm satırlarda tamam' : 'BOZUK — bir satırda eşitlik tutmuyor'}</span>.</p>`;
  }

  /** Kapalı Dünya hattı aralıkları (gün, senaryo başından): Mars'ta kavuşum penceresi, Ay'da istasyon/cisim arkası boşlukları. */
  function shadeIntervals(s: Scen, info: TlInfo): [number, number][] {
    if (s.blackout) return [[s.blackout.startJD - s.startJD, s.blackout.endJD - s.startJD]];
    return info.closed;
  }

  /** Grafikler ayrı makro görevlerde çizilir (her grafik ~10-30 ms; tek uzun görev olmasın). Belirteç değişirse (yeni hesap) kalan çizim bırakılır; true = tamamlandı. */
  async function drawScenario(my: number, s: Scen, info: TlInfo, res: Partial<Record<Policy, SimResult>>): Promise<boolean> {
    const topo = info.topo;
    for (const c of scenarioCharts.splice(0)) c.destroy();
    const pols = s.policies;
    const R = (p: Policy) => res[p]!;
    const trio = (f: (p: Policy) => number[], extra: { label: string; data: number[]; backgroundColor: string }[] = []) => [
      ...pols.map((p) => ({ label: NAME[p], data: f(p), backgroundColor: COLOR[p], borderRadius: 4 })),
      ...extra.map((e) => ({ ...e, borderRadius: 4 })),
    ];
    const legend = { labels: { color: C.ink, boxWidth: 12 } };
    const barOpts = (y: string, title: string, extra: Record<string, unknown> = {}) => {
      const b = baseOpts('', y);
      return { ...b, scales: { ...b.scales, ...extra }, plugins: { title: { display: true, text: title, color: C.ink }, legend } };
    };
    const names = cls.map((c) => c.name);

    addChart(scenarioCharts, '#ch-lat', {
      type: 'bar',
      data: { labels: names, datasets: trio((p) => cls.map((c) => R(p).perClass[c.id].latencyP95Sec / 86400)) },
      options: barOpts('Teslim süresi, %95 (gün)', 'Teslim süresi (teslim edilenler)'),
    });
    await nextTask(); if (my !== token) return false;

    const nodes = [
      ...effectiveRelays(s.net).filter((r) => topo.relays.includes(r.id)).map((r) => ({ n: r.name.replace(' Uydusu', ''), get: (x: SimResult) => x.peakRelayFill[r.id] })),
      ...effectiveAssets(s.net).filter((a) => topo.assets.some((t) => t.id === a.id)).map((a) => ({ n: a.name, get: (x: SimResult) => x.peakAssetFill[a.id] })),
    ];
    const yb = baseOpts('', '').scales.y;
    addChart(scenarioCharts, '#ch-fill', {
      type: 'bar',
      data: { labels: nodes.map((x) => x.n), datasets: trio((p) => nodes.map((x) => x.get(R(p)) * 100)) },
      options: barOpts('En yüksek doluluk (%)', 'Tampon doluluğu (tepe)', { y: { ...yb, max: 100, title: { display: true, text: 'En yüksek doluluk (%)', color: C.text } } }),
    });
    await nextTask(); if (my !== token) return false;

    const extras = [
      ...(pols.includes('strategy') ? [{ label: 'Strateji: üretilmeyen', data: cls.map((c) => R('strategy').perClass[c.id].suppressed), backgroundColor: C.stratLoss }] : []),
      ...(pols.includes('coverage') ? [{ label: 'Kapsama bilen: üretilmeyen', data: cls.map((c) => R('coverage').perClass[c.id].suppressed), backgroundColor: C.covLoss }] : []),
      ...(pols.includes('rolling') ? [{ label: 'Kayan ufuklu: üretilmeyen', data: cls.map((c) => R('rolling').perClass[c.id].suppressed), backgroundColor: C.rollLoss }] : []),
      ...(pols.includes('adaptive') ? [{ label: 'Uyarlamalı: üretilmeyen', data: cls.map((c) => R('adaptive').perClass[c.id].suppressed), backgroundColor: C.adaptLoss }] : []),
    ];
    addChart(scenarioCharts, '#ch-loss', {
      type: 'bar',
      data: { labels: names, datasets: trio((p) => cls.map((c) => R(p).perClass[c.id].dropped), extras) },
      options: barOpts('Paket', 'Düşen (taşma) ve üretilmeyen'),
    });
    await nextTask(); if (my !== token) return false;
    $('#stats-table').innerHTML = tableHtml(res, pols);
    await nextTask(); if (my !== token) return false;

    // (c) aktarma uydusu tampon doluluğu
    // birden çok uydu (ikinci Ay uydusu): uydu tamponlarının ortalama doluluğu
    const toPts = (r: SimResult) => r.series.map((x) => ({ x: x.tSec / 86400, y: (100 * x.relayFill.reduce((a, b) => a + b, 0)) / x.relayFill.length }));
    const intervals = shadeIntervals(s, info);
    const shade: Plugin = {
      id: 'blackout',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        ctx.save();
        ctx.fillStyle = s.blackout ? 'rgba(255,200,61,0.12)' : 'rgba(255,200,61,0.10)';
        for (const [a, b] of intervals) {
          const x0 = Math.max(scales.x.getPixelForValue(a), chartArea.left), x1 = Math.min(scales.x.getPixelForValue(b), chartArea.right);
          if (x1 > x0) ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
        }
        ctx.restore();
      },
    };
    const ds = (p: Policy) => ({ label: NAME[p], data: toPts(R(p)), borderColor: COLOR[p], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, ...(DASH[p] ? { borderDash: DASH[p] } : {}) });
    addChart(scenarioCharts, '#ch-buf', {
      type: 'line',
      data: { datasets: pols.map(ds) },
      options: baseOpts(`Gün (0 = ${day(s.startJD)})`, `${s.relayName} uydu tamponu doluluğu (%)`, {
        parsing: false,
        scales: { x: { type: 'linear', title: { display: true, text: `Gün (0 = ${day(s.startJD)})`, color: C.text }, ticks: { color: C.text }, grid: { color: C.grid } },
          y: { title: { display: true, text: `${s.relayName} uydu tamponu doluluğu (%${info.topo.relays.length > 1 ? ', uyduların ortalaması' : ''})`, color: C.text }, ticks: { color: C.text }, grid: { color: C.grid }, min: 0, max: 100 } },
      }),
      plugins: [shade],
    });
    return true;
  }

  // ---- (d) İstasyon sayısına göre karşılaştırma ----
  const cmpCache = new Map<string, { n: number; open: number; m: Record<Policy, Metrics> }[]>();
  async function renderCompare(my: number, s: Scen) {
    const deps = JSON.stringify([s.key, params(), linkMode, rollingDays, projection]);
    let rows = cmpCache.get(deps);
    if (!rows) {
      $('#cmp-table').textContent = 'Hesaplanıyor…';
      rows = [];
      const cfg = schedCfg(s);
      // istasyon sayısı × çizelgeleyici işleri Worker havuzuna birlikte verilir
      rows = await Promise.all(COMPARE_STATIONS.map(async (n) => {
        const [info, outs] = await Promise.all([tlInfo(s, sc.stepSec, n), Promise.all(s.policies.map((p) => sim(s, sc.stepSec, n, p, cfg)))]);
        const m = {} as Record<Policy, Metrics>;
        s.policies.forEach((p, i) => { m[p] = outs[i].metrics; });
        return { n, open: info.openFracAny, m };
      }));
      if (my !== token) return;
      cmpCache.set(deps, rows);
      if (cmpCache.size > 12) cmpCache.delete(cmpCache.keys().next().value as string);
    }
    for (const c of cmpCharts.splice(0)) c.destroy();
    const pols = s.policies;
    const barOf = (id: string, title: string, f: (m: Metrics) => number) => addChart(cmpCharts, id, {
      type: 'bar',
      data: { labels: rows!.map((r) => `${r.n} istasyon`), datasets: pols.map((p) => ({ label: NAME[p], data: rows!.map((r) => f(r.m[p])), backgroundColor: COLOR[p], borderRadius: 4 })) },
      options: { ...baseOpts('', 'Talebin %\'si'), plugins: { title: { display: true, text: title, color: C.ink }, legend: { labels: { color: C.ink, boxWidth: 12 } } } },
    });
    barOf('#ch-st-drop', 'Düşen (taşma + hatta kayıp) %', (m) => m.dropPct + m.abandonedPct);
    barOf('#ch-st-loss', 'Düşen + hatta kayıp + üretilmeyen %', (m) => m.lossPct);
    const body = rows.flatMap((r) => pols.map((p, i) => {
      const m = r.m[p];
      return `<tr><td>${i === 0 ? r.n : ''}</td><td>${i === 0 ? fmt(r.open * 100, 1) : ''}</td><td>${NAME[p]}</td><td>${fmt(m.dropPct, 1)}</td><td>${fmt(m.abandonedPct, 2)}</td><td>${fmt((100 * m.suppressedMb) / (m.demandMb || 1), 1)}</td><td><b>${fmt(m.lossPct, 1)}</b></td><td>${fmt(m.deliveredPct, 1)}</td><td>${fmt(valuePct(m, valueOpts()), 1)}</td><td>${fmt(m.topP95Sec / 86400, 1)}</td></tr>`;
    })).join('');
    $('#cmp-table').innerHTML = `<table class="stats cmp"><thead><tr><th>İstasyon</th><th>Hat açık %</th><th>Çizelgeleyici</th><th>Düşen %</th><th>Hatta kayıp %</th><th>Üretilmeyen %</th><th>Düşen + hatta kayıp + üretilmeyen %</th><th>Teslim %</th><th>Değer % (bölüm i)</th><th>Telemetri %95 süre (gün)</th></tr></thead><tbody>${body}</tbody></table>`;
    extras.setValueStations(s, rows);
    cmpDone = true;
    $('#cmp-hint').innerHTML = s.kind === 'mars'
      ? `“Hat açık %”: ${s.relayName} aktarma uydusunun Dünya hattının açık olduğu zaman oranı (kavuşum, uydu cismin arkasında, istasyon görmüyor, [seçilirse] gölge kapalı sayılır). Hat modu: <b>${LINK_MODE_LABEL[linkMode]}</b>. <b>Strateji</b> bütçeyi yalnızca boş tampondan hesaplar: az istasyonda (hat çoğu zaman kapalı) kavuşum sonrası boşalma yavaştır, tampon yine taşar. <b>Kapsama bilen strateji</b> aynı bütçeye boşaltma kapasitesini katar ve daha çok kısar; “düşen” azalır ama “üretilmeyen” artar, <i>toplam kayıp</i> (kalın sütun) ve teslim edilen hacim çoğu durumda çok değişmez (hat kapasitesi sınırlayıcıdır). “Teslim %” tüm çizelgeleyicilerde aynı hat kapasitesine yaslanır.`
      : `“Hat açık %”: Ay aktarma uydusunun Dünya hattının açık olduğu zaman oranı (hiçbir istasyon uyduyu görmüyor ya da uydu Ay'ın arkasında olunca kapalı). Hat modu: <b>${LINK_MODE_LABEL[linkMode]}</b>. Ay'da kavuşum kesintisi yok, bu yüzden Aşama 4/7 stratejileri kısma yapmaz (öncelikliyle aynı) ve gösterilmez; <b>kayan ufuklu strateji</b> istasyon boşluklarını önceden görüp kısar: “düşen” azalır, “üretilmeyen” artar, <i>toplam kayıp</i> ve teslim edilen hacim çoğunlukla değişmez ya da biraz kötüleşir.`;
  }

  // ---- (e) Hata modeli karşılaştırması ----
  const errCache = new Map<string, { mode: LinkMode; m: Metrics }[]>();
  async function renderErrors(my: number, s: Scen) {
    const deps = JSON.stringify([s.key, params(), stationCount]);
    let rows = errCache.get(deps);
    $('#err-sub').textContent = `${s.relayName} hattı, ${stationCount === 0 ? 'istasyon modeli kapalı' : `${stationCount} istasyon`}`;
    if (!rows) {
      $('#err-table').textContent = 'Hesaplanıyor…';
      const modes = ['loss', 'arq', 'burst'] as LinkMode[];
      const outs = await Promise.all(modes.map((mode) => sim(s, sc.stepSec, stationCount, 'priority', schedCfg(s, mode))));
      if (my !== token) return;
      rows = modes.map((mode, i) => ({ mode, m: outs[i].metrics }));
      errCache.set(deps, rows);
      if (errCache.size > 12) errCache.delete(errCache.keys().next().value as string);
    }
    const per = rows.find((r) => r.mode === 'arq')!.m, bur = rows.find((r) => r.mode === 'burst')!.m;
    $('#err-table').innerHTML = `<table class="stats cmp"><thead><tr><th>Hat modu</th><th>İletim denemesi</th><th>Kaybolan deneme % (iki hat)</th><th>En uzun art arda kayıp</th><th>Yeniden gönderilen</th><th>Hatta kayıp paket (${HYPOTHETICAL.arq.maxAttempts} deneme aşıldı)</th><th>…yüzey / Dünya hattı</th><th>Hatta kayıp %</th><th>Düşen %</th><th>Teslim %</th><th>Telemetri %95 süre (gün)</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${LINK_MODE_LABEL[r.mode]}</td><td>${fmt(r.m.attempts)}</td><td>${fmt(r.m.txLostPct, 2)}</td><td>${fmt(r.m.maxLossRun)}</td><td>${fmt(r.m.retransmissions)}</td><td class="${r.m.abandoned ? 'bad' : ''}">${fmt(r.m.abandoned)}</td><td>${fmt(r.m.abandonedSurface)} / ${fmt(r.m.abandoned - r.m.abandonedSurface)}</td><td>${fmt(r.m.abandonedPct, 2)}</td><td>${fmt(r.m.dropPct, 1)}</td><td>${fmt(r.m.deliveredPct, 1)}</td><td>${fmt(r.m.topP95Sec / 86400, 2)}</td></tr>`).join('')}</tbody></table>`;
    $('#err-hint').innerHTML = `İkisi de aynı ortalama kayıp parametresiyle (Dünya hattı %${fmt(params().earthLossPct, 1)}, yüzey hattı %${HYPOTHETICAL.arq.surfaceLossPct}) kurulur; fark yalnızca kaybın dağılımıdır. <b>Maksimum deneme (${HYPOTHETICAL.arq.maxAttempts}) aşımı</b> (hatta kayıp): periyodik modelde <b>${fmt(per.abandoned)}</b> paket, kümelenmiş modelde <b>${fmt(bur.abandoned)}</b> paket. “Kaybolan deneme %” gerçekleşen orandır: kötü durumda kaybolan paketler yeniden denendiği için denemeler kötü durumda aşırı temsil edilir ve oran ortalama parametreden yüksek çıkabilir; “en uzun art arda kayıp” kümelenmeyi gösterir. Yeniden deneme, RTT kötü durumun ortalama süresinden (${fmt(HYPOTHETICAL.arq.burst.meanBadSec / 60)} dk) çok kısaysa (Ay Dünya hattı: ~3 sn; yüzey hattı: aynı adım) büyük olasılıkla aynı kötü durumda kalır ve hak tükenir; RTT daha uzunsa (Mars: ~40 dk) yeniden deneme çoğu zaman kötü durumdan sonra olur. Yeniden iletimsiz satır referanstır (ilk kayıp kalıcı).`;
  }

  // ---- (f) Tarama (duyarlılık) ----
  interface Sweep { deps: string; values: number[]; rows: PartialPolicyMetrics[] }
  const sweeps: Partial<Record<SweepKey, Sweep>> = {};

  const marker = (key: SweepKey, relayName: string): Plugin => ({
    id: 'current-value',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(sweepMeta(key, relayName).x(params()[key]));
      if (!Number.isFinite(x) || x < chartArea.left - 1 || x > chartArea.right + 1) return;
      ctx.save();
      ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.6; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.restore();
    },
  });

  function drawSweep(key: SweepKey, s: Scen) {
    const sw = sweeps[key];
    if (!sw || !ChartCtor) return;
    for (const c of sweepCharts[key] ?? []) c.destroy();
    sweepCharts[key] = [];
    const list = sweepCharts[key];
    const meta = sweepMeta(key, s.relayName);
    const xs = sw.values.map(meta.x);
    const pols = s.sweepPolicies;
    // Çakışan eğriler (ör. FIFO ve öncelikli toplam kaybı aynı hacimdir) birbirini gizlemesin: FIFO kalın ve en altta çizilir.
    const line = (label: string, color: string, ys: number[], dash?: number[]) => ({
      label, data: xs.map((x, i) => ({ x, y: ys[i] })), borderColor: color, backgroundColor: color, tension: 0, pointHoverRadius: 5,
      ...(label === 'FIFO' ? { borderWidth: 6, pointRadius: 5, order: 3 } : { borderWidth: 2, pointRadius: 3, order: label === 'Öncelikli' ? 1 : 0 }),
      ...(dash ? { borderDash: dash } : {}),
    });
    const col = (f: (m: PartialPolicyMetrics) => number) => sw.rows.map(f);
    const perPolicy = (f: (m: Metrics) => number) => pols.map((p) => line(NAME[p], COLOR[p], col((m) => f(m[p]!)), DASH[p]));
    const lossMode = $<HTMLSelectElement>('#sw-loss-metric').value;
    const timeMode = $<HTMLSelectElement>('#sw-time-metric').value;

    let lossSets: unknown[], lossY: string, lossTitle: string;
    if (lossMode === 'top') {
      lossSets = perPolicy((m) => m.topDropPct);
      lossY = 'Telemetri düşen (%)'; lossTitle = `${meta.title}: telemetri kaybı`;
    } else if (lossMode === 'abandoned') {
      lossSets = perPolicy((m) => m.abandonedPct);
      lossY = 'Hatta kayıp (talebin %\'si)'; lossTitle = `${meta.title}: hatta kayıp`;
    } else if (lossMode === 'retx') {
      lossSets = perPolicy((m) => m.retransmissions);
      lossY = 'Yeniden gönderilen paket'; lossTitle = `${meta.title}: yeniden iletim`;
    } else if (lossMode === 'value') {
      lossSets = perPolicy((m) => valuePct(m, { weightOf: valueOpts().weightOf })); // taramalar azalan değer toplamı içermez
      lossY = 'Teslim edilen değer / talep edilen değer (%)'; lossTitle = `${meta.title}: değer (sabit)`;
    } else if (lossMode === 'deliv') {
      lossSets = perPolicy((m) => m.deliveredPct);
      lossY = 'Teslim edilen / talep (%)'; lossTitle = `${meta.title}: teslim edilen`;
    } else {
      lossSets = [
        line('FIFO', C.fifo, col((m) => m.fifo!.dropPct + m.fifo!.abandonedPct)),
        line('Öncelikli', C.prio, col((m) => m.priority!.dropPct + m.priority!.abandonedPct), DASH.priority),
        ...(pols.includes('strategy') ? [
          line('Strateji (düşen + hatta kayıp)', C.strat, col((m) => m.strategy!.dropPct + m.strategy!.abandonedPct), DASH.strategy),
          line('Strateji (+ üretilmeyen)', C.stratLoss, col((m) => m.strategy!.lossPct)),
        ] : []),
        ...(pols.includes('coverage') ? [
          line('Kapsama bilen (düşen + hatta kayıp)', C.cov, col((m) => m.coverage!.dropPct + m.coverage!.abandonedPct), DASH.coverage),
          line('Kapsama bilen (+ üretilmeyen)', C.covLoss, col((m) => m.coverage!.lossPct)),
        ] : []),
        ...(pols.includes('rolling') ? [
          line('Kayan ufuklu (düşen + hatta kayıp)', C.roll, col((m) => m.rolling!.dropPct + m.rolling!.abandonedPct), DASH.rolling),
          line('Kayan ufuklu (+ üretilmeyen)', C.rollLoss, col((m) => m.rolling!.lossPct)),
        ] : []),
        ...(pols.includes('adaptive') ? [
          line('Uyarlamalı (düşen + hatta kayıp)', C.adapt, col((m) => m.adaptive!.dropPct + m.adaptive!.abandonedPct), DASH.adaptive),
          line('Uyarlamalı (+ üretilmeyen)', C.adaptLoss, col((m) => m.adaptive!.lossPct)),
        ] : []),
      ];
      lossY = 'Kayıp (talebin %\'si)'; lossTitle = `${meta.title}: kayıp`;
    }
    const tkey = timeMode as 'topP95' | 'lowP95' | 'topMean' | 'lowMean';
    const metric = (m: Metrics) => ({ topP95: m.topP95Sec, lowP95: m.lowP95Sec, topMean: m.topMeanSec, lowMean: m.lowMeanSec })[tkey] / 86400;
    const timeSets = perPolicy(metric);
    const timeLabel = $<HTMLSelectElement>('#sw-time-metric').selectedOptions[0].textContent;

    const mk = (id: string, sets: unknown[], y: string, title: string, max?: number) => {
      const b = baseOpts(meta.xTitle, y);
      addChart(list, id, {
        type: 'line',
        data: { datasets: sets },
        options: { ...b, parsing: false, scales: { x: { ...b.scales.x, type: 'linear' }, y: { ...b.scales.y, ...(max ? { max } : {}) } }, plugins: { title: { display: true, text: title, color: C.ink }, legend: { labels: { color: C.ink, boxWidth: 10, font: { size: 10 } } } } },
        plugins: [marker(key, s.relayName)],
      });
    };
    mk(`#sw-loss-${key}`, lossSets, lossY, lossTitle, lossMode === 'deliv' || lossMode === 'value' ? 100 : undefined);
    mk(`#sw-time-${key}`, timeSets, 'Teslim süresi (gün)', `${meta.title}: ${timeLabel}`);
  }

  const drawSweeps = () => { if (active) for (const k of SWEEP_KEYS) drawSweep(k, active); };
  function markCurrent() { for (const k of SWEEP_KEYS) for (const c of sweepCharts[k] ?? []) c.update('none'); }

  async function runSweeps(my: number, s: Scen) {
    const se = HYPOTHETICAL.sensitivity;
    const cfg = { ...schedConfig(linkMode), rolling: rollingConfig(rollingDays), projection: { ...projection }, valueHalfLivesSec: [], stepSec: se.sweepStepSec }; // taramalar azalan değer toplamı hesaplamaz (yalnızca sabit değer ölçütü)
    const tl = tlSpec(s, se.sweepStepSec);
    const status = $('#sw-status');
    const p0 = params(), d0 = def();
    // Tüm taramalar (parametre × nokta × çizelgeleyici) işçi havuzuna birlikte verilir; her grafik kendi noktaları bitince çizilir.
    const todo = sliderDefs(d0, kind).filter((d) => {
      const others = SWEEP_KEYS.filter((k) => k !== d.key).map((k) => p0[k]);
      const deps = JSON.stringify([s.key, d.key, others, stationCount, linkMode, rollingDays, projection]);
      if (sweeps[d.key]?.deps === deps) { drawSweep(d.key, s); return false; }
      return true;
    });
    const per = todo.map((d) => ({ d, values: sweepValues(d.min, d.max, se.sweepPoints, d0[d.key]) }));
    const total = per.reduce((n, x) => n + x.values.length * s.sweepPolicies.length, 0);
    let done = 0;
    const tick = () => { status.textContent = `Tarama: ${done}/${total}…`; };
    tick();
    await Promise.all(per.map(async ({ d, values }) => {
      const others = SWEEP_KEYS.filter((k) => k !== d.key).map((k) => p0[k]);
      const deps = JSON.stringify([s.key, d.key, others, stationCount, linkMode, rollingDays, projection]);
      const rows = await Promise.all(values.map(async (v) => {
        const row: PartialPolicyMetrics = {};
        await Promise.all(s.sweepPolicies.map(async (p) => {
          row[p] = await getPool().call<Metrics>({ op: 'policy', tl, cfg, params: p0, policy: p, override: { [d.key]: v } }); // Ay'da Aşama 4/7 stratejileri gösterilmez (kesinti yok)
          done++; tick();
        }));
        return row;
      }));
      if (my !== token) return;
      sweeps[d.key] = { deps, values, rows };
      drawSweep(d.key, s);
    }));
    if (my !== token) return;
    status.textContent = `Tarama tamam (${fmt(se.sweepStepSec)} sn adım).`;
  }

  // ---- (g) Tahmin hatası ve (h) hata modeli duyarlılığı: düğmeyle çalışır, iptal edilebilir ----
  // (g) ve (h) grafikleri ayrı listelerde: biri yeniden hesaplanırken diğerinin grafikleri yok edilmesin
  const fcCharts: Chart[] = [];
  const emCharts: Chart[] = [];
  let fcToken = 0, emToken = 0;
  const resetScans = () => {
    fcToken++; emToken++; extras.reset(); pool?.cancel(); // süren taramalar bırakılır
    for (const c of fcCharts.splice(0)) c.destroy();
    for (const c of emCharts.splice(0)) c.destroy();
    $('#fc-body').innerHTML = ''; $('#em-body').innerHTML = '';
    $('#fc-status').textContent = ''; $('#em-status').textContent = '';
  };
  const lineSet = (label: string, color: string, pts: { x: number; y: number }[], dash?: number[]) => ({ label, data: pts, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, tension: 0, ...(dash ? { borderDash: dash } : {}) });
  const lineChart = (list: Chart[], id: string, title: string, xTitle: string, yTitle: string, sets: unknown[]) => {
    const b = baseOpts(xTitle, yTitle);
    return addChart(list, id, {
      type: 'line', data: { datasets: sets },
      options: { ...b, parsing: false, scales: { x: { ...b.scales.x, type: 'linear' }, y: { ...b.scales.y } }, plugins: { title: { display: true, text: title, color: C.ink }, legend: { labels: { color: C.ink, boxWidth: 10, font: { size: 10 } } } } },
    });
  };
  const suppPct = (m: Metrics) => (100 * m.suppressedMb) / (m.demandMb || 1);

  interface FcKind { id: string; title: string; xTitle: string; values: number[]; make: (v: number) => ForecastError }
  const FC_KINDS = (): FcKind[] => [
    { id: 'edge', title: 'Pencere başı/sonu kayması', xTitle: 'Her pencerenin başı ve sonu (dk): + uzun sanılır (iyimser), − kısa sanılır', values: HYPOTHETICAL.forecastScan.edgeShiftMin, make: (v) => ({ edgeShiftSec: v * 60 }) },
    { id: 'off', title: 'Pencere ötelemesi', xTitle: 'Tüm pencereler ötelenir (dk): + geç, − erken', values: HYPOTHETICAL.forecastScan.offsetMin, make: (v) => ({ offsetSec: v * 60 }) },
    { id: 'loss', title: 'Ortalama kayıp tahmini', xTitle: 'Tahmin edilen ortalama kayıp, gerçeğe göre sapma (%)', values: HYPOTHETICAL.forecastScan.lossBiasPct, make: (v) => ({ lossBiasPct: v }) },
  ];

  /** Sıfırdan başlayıp dışa doğru, `worse` koşulunu sağlayan ilk düzey (yoksa null). neg: sıfırdan küçük değerler (yakından uzağa), pos: büyük. */
  function firstWorse(values: number[], bad: boolean[]): { neg: number | null; pos: number | null } {
    const idx = values.map((v, i) => ({ v, i }));
    const side = (sign: number) => idx.filter((x) => Math.sign(x.v) === sign).sort((a, b) => Math.abs(a.v) - Math.abs(b.v)).find((x) => bad[x.i])?.v ?? null;
    return { neg: side(-1), pos: side(1) };
  }

  async function runForecastScan() {
    const s = active;
    if (!s || !ChartCtor) return;
    const my = ++fcToken;
    const st = $('#fc-status'), body = $('#fc-body');
    for (const c of fcCharts.splice(0)) c.destroy();
    body.innerHTML = '';
    const step = HYPOTHETICAL.forecastScan.stepSec;
    const info = await tlInfo(s, step);
    const cfg0: SchedConfig = { ...schedCfg(s), valueHalfLivesSec: [], stepSec: step };
    const blackout = info.blackout;
    // Kesinti yoksa (Ay) Aşama 4/7 stratejileri hiç kısmaz: sonuç öncelikliyle aynı, hesaplanmaz.
    const pols: Policy[] = blackout ? ['strategy', 'coverage', 'rolling', 'adaptive'] : ['rolling', 'adaptive'];
    const kinds = FC_KINDS();
    const total = kinds.reduce((n, k) => n + k.values.length * pols.length, 1);
    let done = 0;
    const prog = () => { st.textContent = `Hesaplanıyor… ${done}/${total}`; };
    prog();
    const run = async (cfg: SchedConfig, p: Policy) => { const o = await sim(s, step, stationCount, p, cfg); done++; prog(); return o.metrics; };
    const prioP = run(cfg0, 'priority');
    const resP: Record<string, Promise<Partial<Record<Policy, Metrics>>>[]> = {};
    for (const k of kinds) {
      const arr: Promise<Partial<Record<Policy, Metrics>>>[] = [];
      resP[k.id] = arr;
      k.values.forEach((v, vi) => arr.push((async () => {
        const row: Partial<Record<Policy, Metrics>> = {};
        await Promise.all(pols.map(async (p) => {
          // Aşama 4 stratejisi ortalama kaybı kullanmaz: kayıp sapması onu değiştirmez (ilk noktanın sonucu kullanılır)
          if (k.id === 'loss' && p === 'strategy' && vi > 0) { row[p] = (await arr[0]).strategy!; done++; return; }
          row[p] = await run({ ...cfg0, forecast: k.make(v) }, p);
        }));
        return row;
      })()));
    }
    const prio = await prioP;
    const res: Record<string, Partial<Record<Policy, Metrics>>[]> = {};
    for (const k of kinds) res[k.id] = await Promise.all(resP[k.id]);
    if (my !== fcToken) return;
    st.textContent = `Tamam (${fmt(step)} sn adım, ${s.relayName} hattı, ${stationCount === 0 ? 'istasyon modeli kapalı' : `${stationCount} istasyon`}, kayan ufuk ${fmt(rollingDays, rollingDays < 1 ? 1 : 0)} gün).`;

    const baseLine = (label: string, color: string, vals: number[], y: number) => lineSet(label, color, vals.map((x) => ({ x, y })), [6, 3]);
    const label = (p: Policy) => (p === 'strategy' ? 'Strateji (Aşama 4)' : NAME[p]);
    const dropOf = (m: Metrics) => m.dropPct + m.abandonedPct;
    const parts: string[] = [];
    for (const k of kinds) {
      parts.push(`<h4>${k.title}</h4><div class="charts two"><div class="chart"><canvas id="fc-${k.id}-d" aria-label="${k.title}: düşen"></canvas></div><div class="chart"><canvas id="fc-${k.id}-s" aria-label="${k.title}: üretilmeyen"></canvas></div></div><div id="fc-${k.id}-t"></div>`);
    }
    body.innerHTML = parts.join('');
    for (const k of kinds) {
      const rows = res[k.id];
      const series = (f: (m: Metrics) => number, y: string, title: string, id: string) => {
        const sets = [
          baseLine(blackout ? 'Öncelikli' : 'Öncelikli (Ay: Aşama 4/7 stratejileriyle aynı)', C.prio, k.values, f(prio)),
          ...pols.map((p) => lineSet(label(p), COLOR[p], k.values.map((v, i) => ({ x: v, y: f(rows[i][p]!) })), DASH[p])),
        ];
        lineChart(fcCharts, id, title, k.xTitle, y, sets);
      };
      series(dropOf, 'Düşen + hatta kayıp (talebin %\'si)', `${k.title}: düşen`, `#fc-${k.id}-d`);
      series(suppPct, 'Üretilmeyen (talebin %\'si)', `${k.title}: üretilmeyen`, `#fc-${k.id}-s`);

      // Kayan ufuklu ve uyarlamalı stratejinin "altına düştüğü" ilk hata düzeyi: kötüleşme > 0,1 puan (düşen+hatta kayıp için karşılaştırılan çizelgeden fazla; teslim için az)
      const eps = 0.1;
      const lvl = (x: number | null, unit: string) => (x === null ? 'taranan aralıkta yok' : `${x > 0 ? '+' : ''}${fmt(x)}${unit}`);
      const unit = k.id === 'loss' ? '%' : ' dk';
      const summaryOf = (target: 'rolling' | 'adaptive') => {
        const roll = rows.map((r) => r[target]!);
        const cmp: { name: string; vs: string; zero: number; bad: boolean[] }[] = [];
        const add = (name: string, vs: string, f: (m: Metrics) => number, base: number, higherWorse: boolean) => {
          const d = roll.map((m) => (higherWorse ? f(m) - base : base - f(m)));
          cmp.push({ name, vs, zero: d[k.values.indexOf(0)] ?? 0, bad: d.map((x) => x > eps) });
        };
        add('Düşen + hatta kayıp', 'öncelikli', dropOf, dropOf(prio), true);
        if (blackout) add('Düşen + hatta kayıp', 'Strateji (Aşama 4)', dropOf, dropOf(rows[k.values.indexOf(0)].strategy!), true);
        add('Toplam kayıp (+ üretilmeyen)', 'öncelikli', (m) => m.lossPct, prio.lossPct, true);
        add('Teslim %', 'öncelikli', (m) => m.deliveredPct, prio.deliveredPct, false);
        const sumRows = cmp.map((c) => {
          const w = firstWorse(k.values, c.bad);
          return `<tr><td>${c.name} · ${c.vs}ya göre</td><td>${fmt(c.zero, 2)}</td><td>${c.zero > eps ? 'hata yokken de' : lvl(w.neg, unit)}</td><td>${c.zero > eps ? 'hata yokken de' : lvl(w.pos, unit)}</td></tr>`;
        }).join('');
        return `<table class="stats"><thead><tr><th>${NAME[target]} kötüleşir mi?</th><th>Hata yokken fark (puan)</th><th>İlk kötüleşme, − yönde</th><th>İlk kötüleşme, + yönde</th></tr></thead><tbody>${sumRows}</tbody></table>`;
      };
      const detail = `<table class="stats cmp"><thead><tr><th>${k.id === 'loss' ? 'Sapma %' : 'Dakika'}</th>${['priority', ...pols].map((p) => `<th>${p === 'strategy' ? 'Strateji (A4)' : NAME[p as Policy]}: düşen / toplam / teslim [üretilmeyen]</th>`).join('')}</tr></thead><tbody>${k.values.map((v, i) => `<tr><td>${v > 0 ? '+' : ''}${fmt(v)}</td>${['priority', ...pols].map((p) => { const m = p === 'priority' ? prio : rows[i][p as Policy]!; return `<td>${fmt(dropOf(m), 1)} / ${fmt(m.lossPct, 1)} / ${fmt(m.deliveredPct, 1)} [${fmt(suppPct(m), 1)}]</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
      $(`#fc-${k.id}-t`).innerHTML = `${summaryOf('rolling')}${summaryOf('adaptive')}<details><summary>Tüm tarama noktaları</summary>${detail}</details><p class="hint">“Kötüleşme”: kayan ufuklu ya da uyarlamalı strateji, karşılaştırılan çizelgeden 0,1 puandan fazla kötü (düşen/toplam kayıp daha yüksek, teslim daha düşük). Fark pozitifse strateji o ölçütte daha kötüdür. Düzeyler yalnızca taranan noktalardır (${k.values.map((v) => (v > 0 ? '+' : '') + v).join(', ')}).</p>`;
      await nextTask(); if (my !== fcToken) return;
    }
  }

  interface EmKind { id: string; title: string; xTitle: string; values: number[]; x: (v: number) => number; cfg: (c: SchedConfig, v: number) => SchedConfig }
  const EM_KINDS = (): EmKind[] => [
    { id: 'bad', title: 'Kötü durum kaybı', xTitle: 'Kötü durumda kayıp (%)', values: HYPOTHETICAL.errorScan.badLossPct, x: (v) => v, cfg: (c, v) => ({ ...c, arq: { ...c.arq!, burst: { ...c.arq!.burst!, badLossPct: v } } }) },
    { id: 'dur', title: 'Kötü durumun ortalama süresi', xTitle: 'Kötü durumun ortalama süresi (dk)', values: HYPOTHETICAL.errorScan.meanBadSec, x: (v) => v / 60, cfg: (c, v) => ({ ...c, arq: { ...c.arq!, burst: { ...c.arq!.burst!, meanBadSec: v } } }) },
    { id: 'retry', title: 'Yüzey hattı yeniden deneme aralığı', xTitle: 'Yüzey hattı yeniden deneme aralığı (dk; 0 = aynı adımda)', values: HYPOTHETICAL.errorScan.surfaceRetrySec, x: (v) => v / 60, cfg: (c, v) => ({ ...c, arq: { ...c.arq!, surfaceRetrySec: v } }) },
  ];

  async function runErrorScan() {
    const s = active;
    if (!s || !ChartCtor) return;
    const my = ++emToken;
    const st = $('#em-status'), body = $('#em-body');
    for (const c of emCharts.splice(0)) c.destroy();
    body.innerHTML = '';
    const step = HYPOTHETICAL.forecastScan.stepSec;
    const base: SchedConfig = { ...schedCfg(s, 'burst'), valueHalfLivesSec: [], stepSec: step };
    const kinds = EM_KINDS();
    const total = kinds.reduce((n, k) => n + k.values.length, 1);
    let done = 0;
    st.textContent = `Hesaplanıyor… 0/${total}`;
    const run = async (cfg: SchedConfig) => { const o = await sim(s, step, stationCount, 'priority', cfg); st.textContent = `Hesaplanıyor… ${++done}/${total}`; return o.metrics; };
    const perCfg = { ...base, arq: { ...base.arq!, burst: undefined } } as SchedConfig; // periyodik referans (aynı ortalama kayıp)
    const periodicP = run(perCfg);
    const resP = kinds.map((k) => Promise.all(k.values.map((v) => run(k.cfg(base, v)))));
    const periodic = await periodicP;
    const res: Record<string, Metrics[]> = {};
    for (let i = 0; i < kinds.length; i++) res[kinds[i].id] = await resP[i];
    if (my !== emToken) return;
    st.textContent = `Tamam (${fmt(step)} sn adım, ${s.relayName} hattı, ${stationCount === 0 ? 'istasyon modeli kapalı' : `${stationCount} istasyon`}).`;
    body.innerHTML = kinds.map((k) => `<h4>${k.title}</h4><div class="charts two"><div class="chart"><canvas id="em-${k.id}-n" aria-label="${k.title}: hatta kayıp paket"></canvas></div><div class="chart"><canvas id="em-${k.id}-t" aria-label="${k.title}: düşen ve teslim"></canvas></div></div><div id="em-${k.id}-tab"></div>`).join('')
      + `<p class="hint">Referans (kesikli çizgi): <b>periyodik</b> model, aynı ortalama kayıp (yüzey %${HYPOTHETICAL.arq.surfaceLossPct}, Dünya hattı %${fmt(params().earthLossPct, 1)}): hatta kayıp ${fmt(periodic.abandoned)} paket (yüzey ${fmt(periodic.abandonedSurface)} / Dünya ${fmt(periodic.abandoned - periodic.abandonedSurface)}). Varsayılan kümelenmiş model: kötü durum kaybı %${HYPOTHETICAL.arq.burst.badLossPct}, ortalama ${fmt(HYPOTHETICAL.arq.burst.meanBadSec / 60)} dk, yeniden deneme aralığı ${HYPOTHETICAL.arq.surfaceRetrySec} sn. Kötü durum kaybı ortalama kayıptan küçükse ortalama kırpılır (kötü durum her zaman) ve ortalama kayıp o değerde kalır. Zincir ${fmt(step)} sn adımlıdır; ortalama kötü süre adımdan kısa seçilmedi.</p>`;
    for (const k of kinds) {
      const rows = res[k.id];
      const xs = k.values.map(k.x);
      const flat = (label: string, color: string, y: number) => lineSet(label, color, xs.map((x) => ({ x, y })), [6, 3]);
      lineChart(emCharts, `#em-${k.id}-n`, `${k.title}: hatta kayıp paket`, k.xTitle, 'Hatta kayıp paket', [
        lineSet('Toplam', C.ink, xs.map((x, i) => ({ x, y: rows[i].abandoned }))),
        lineSet('Yüzey hattı', C.prio, xs.map((x, i) => ({ x, y: rows[i].abandonedSurface }))),
        lineSet('Dünya hattı', C.fifo, xs.map((x, i) => ({ x, y: rows[i].abandoned - rows[i].abandonedSurface }))),
        flat('Periyodik (toplam)', '#8a96b2', periodic.abandoned),
      ]);
      lineChart(emCharts, `#em-${k.id}-t`, `${k.title}: düşen ve teslim`, k.xTitle, 'Talebin %\'si', [
        lineSet('Teslim %', C.strat, xs.map((x, i) => ({ x, y: rows[i].deliveredPct }))),
        lineSet('Düşen (taşma) %', C.cov, xs.map((x, i) => ({ x, y: rows[i].dropPct }))),
        lineSet('Hatta kayıp %', C.roll, xs.map((x, i) => ({ x, y: rows[i].abandonedPct }))),
      ]);
      await nextTask(); if (my !== emToken) return;
      $(`#em-${k.id}-tab`).innerHTML = `<table class="stats cmp"><thead><tr><th>${k.xTitle.split(' (')[0]}</th><th>İletim denemesi</th><th>Kaybolan deneme %</th><th>En uzun art arda kayıp</th><th>Yeniden gönderilen</th><th>Hatta kayıp paket</th><th>…yüzey / Dünya</th><th>Hatta kayıp %</th><th>Düşen %</th><th>Teslim %</th><th>Telemetri %95 süre (gün)</th></tr></thead><tbody>${rows.map((m, i) => `<tr><td>${fmt(xs[i])}</td><td>${fmt(m.attempts)}</td><td>${fmt(m.txLostPct, 2)}</td><td>${fmt(m.maxLossRun)}</td><td>${fmt(m.retransmissions)}</td><td class="${m.abandoned ? 'bad' : ''}">${fmt(m.abandoned)}</td><td>${fmt(m.abandonedSurface)} / ${fmt(m.abandoned - m.abandonedSurface)}</td><td>${fmt(m.abandonedPct, 2)}</td><td>${fmt(m.dropPct, 1)}</td><td>${fmt(m.deliveredPct, 1)}</td><td>${fmt(m.topP95Sec / 86400, 2)}</td></tr>`).join('')}</tbody></table>`;
    }
  }
  let autoScan = false;
  $<HTMLInputElement>('#auto-scan').addEventListener('change', (e) => { autoScan = (e.target as HTMLInputElement).checked; if (autoScan && active && root.dataset.perf) { void runForecastScan(); void runErrorScan(); } });
  $('#fc-run').addEventListener('click', () => void runForecastScan());
  $('#em-run').addEventListener('click', () => void runErrorScan());

  /** Senaryoya göre değişen başlık ve açıklama metinleri. */
  function applyTexts(s: Scen) {
    const win = s.kind === 'mars' && !s.free;
    $('#buf-title').textContent = win ? '(c) Kavuşum penceresinde Mars aktarma uydusu tamponu' : `(c) ${s.relayName} aktarma uydusu tamponu`;
    $('#buf-hint').innerHTML = win
      ? `Gölgeli alan: Güneş–Mars açısı ${HYPOTHETICAL.conjunctionBlackoutAngleDeg}° eşiğinin altında (kesinti). Kesintide araç → uydu hattı açık kalır, uydu → Dünya hattı kapalıdır; uydu tamponu dolar, kesinti bitince boşalır. FIFO ve öncelikli toplam doluluğu hemen hemen aynı doldurup boşalttığı için eğriler çoğunlukla üst üste biner; fark tamponda <i>hangi</i> verinin kaldığında ve kayıp tablosundadır. Stratejiler kesintiye ${fmt(HYPOTHETICAL.strategy.lookaheadDays, 1)} gün kala üretimi kıstığı için tamponu yavaş doldurur. Az yer istasyonunda (hat çoğu zaman kapalı) kesinti sonrası tampon yavaş boşalır; <b>kapsama bilen strateji</b> bunu önceden hesaba katıp kesinti öncesinden daha çok kısar, <b>strateji</b> (Aşama 4) ise bilmediği için kavuşum sonrası yeniden taşabilir; <b>uyarlamalı ufuk</b> ufku kapalı dönemin uzunluğuna göre seçer.`
      : `Gölgeli alanlar: Dünya hattının kapalı olduğu zamanlar (hiçbir yer istasyonu uyduyu ${HYPOTHETICAL.groundStations.minElevationDeg}° üstünde görmüyor, uydu cismin arkasında ya da [Mars, seçilirse] gölgede; birden çok uydu varsa hiçbirinin hattı açık değil). Hat kapalıyken uydu tamponu dolar, açılınca boşalır; az istasyonda boşluklar uzun, tampon sık dolar ve taşabilir. Kavuşum yok: Aşama 4 ve Aşama 7 stratejileri kısma yapmaz (öncelikliyle birebir aynı, gösterilmez); yalnızca <b>kayan ufuklu</b> ve <b>uyarlamalı</b> strateji kapalı hat dönemlerini önceden görüp kısar (FIFO, öncelikli, kayan ufuklu ve uyarlamalı gösterilir).${s.net.moonSecond && s.net.moonSecond !== 'none' ? ' Çizgi: iki uydu tamponunun ortalaması.' : ''}`;
    $('#scen-hint').innerHTML = s.kind === 'mars'
      ? `Kapsam: karşılaştırma bölümleri <b>Mars aktarma hattını</b> (uydu + ona bağlı 2 araç) simüle eder; ${win ? 'kavuşum ve stratejiler yalnızca Mars\'ı ilgilendirir' : '<b>kavuşumsuz serbest tarih aralığı</b>: kavuşum kesintisi yok (Aşama 4/7 stratejileri öncelikliyle aynı), yalnızca yer istasyonu kapsaması ve [seçilirse] Mars gölgesi hattı kapatır'}. Kaydırıcıların başlangıç değerleri <code>src/config/hypothetical.ts</code> değerleridir; yalnızca Mars hattını değiştirirler. Bırakınca (kısa bir bekleme sonrası) senaryo ve diğer bölümler yeniden hesaplanır.`
      : `Kapsam: <b>Ay aktarma hattı</b> (uydu + 2 araç${s.net.moonPolarAsset ? ' + kutup aracı' : ''}; Ay Aracı A enlemi −40°${s.net.moonOrbit === 'elliptical' ? '; <b>eğimli/eliptik yörünge</b>' : ''}${s.net.moonSecond && s.net.moonSecond !== 'none' ? `; <b>ikinci Ay uydusu</b> (araçlar ${s.net.moonSecond === 'best' ? 'en iyi görüneni' : 'hat sırasını'} kullanır; kaydırıcı tampon ve hat hızı iki uyduya da uygulanır)` : ''}). Ay'da kavuşum kesintisi yok; seçilen tarih aralığında etkili olan şey <b>yer istasyonu kapsaması</b> (uydunun Dünya'dan görülme süresi) ve <b>hat hatası/yeniden iletim</b>dir. Aralık veri aralığı (2020–2040) içinde seçilir; sonuçlar aralığa göre değişir (bkz. bölüm l). Kaydırıcılar yalnızca Ay hattını değiştirir.`;
    const a9 = [
      projection.surfaceClosure ? 'projeksiyon: yüzey hattı kapalılığı' : '', projection.arqHold ? 'projeksiyon: ARQ kopyaları RTT boyunca tamponda' : '',
      s.net.moonOrbit === 'elliptical' ? 'Ay yörüngesi: eğimli/eliptik (varsayımsal elemanlar)' : '', s.net.moonSecond && s.net.moonSecond !== 'none' ? 'ikinci Ay uydusu' : '', s.net.moonPolarAsset ? 'Ay kutup aracı' : '',
      s.net.marsEclipse && s.net.marsEclipse !== 'none' ? `Mars uydusu gölgesi (${s.net.marsEclipse === 'earth' ? 'yalnız Dünya hattı' : 'yüzey + Dünya hattı'}; güç modeli yok)` : '',
    ].filter(Boolean);
    $('#a9-hint').innerHTML = a9.length ? `<b>Etkin Aşama 9 seçenekleri:</b> ${a9.join(' · ')}. Bu seçenekler Aşama 3–8 sayılarını değiştirir; hepsi kapalıyken eski sayılar birebir yeniden üretilir. Hepsi varsayımdır (${HYPOTHETICAL_LABEL}).` : 'Aşama 9 seçenekleri kapalı: sayılar Aşama 3–8 ile birebir aynıdır. Yörünge elemanları, ikinci uydunun kapasitesi, gölge modeli ve değer ağırlıkları varsayımdır.';
    $('#st-sub').textContent = `(${day(s.startJD)} – ${day(s.endJD)}, 30 dk adım · ${HYPOTHETICAL_LABEL})`;
  }

  async function compute() {
    const status = $('#sc-status');
    const s = scenario();
    if (!s) { status.textContent = kind === 'mars' ? 'Veri aralığında uygun kavuşum penceresi yok.' : 'Geçerli bir başlangıç tarihi seçin (veri aralığı içinde).'; return; }
    active = s;
    const my = bump();
    resetScans();
    cmpDone = false;
    status.textContent = 'Hesaplanıyor…';
    $('#sw-status').textContent = '';
    applyTexts(s);
    extras.applyKind(s);
    const perf: Record<string, number> = {};
    try {
      const t0 = performance.now();
      const cfg = schedCfg(s);
      // Senaryo: tüm çizelgeleyiciler işçi havuzunda birlikte çalışır; ana iş parçacığı yalnızca sonucu çizer.
      const [info, outs] = await Promise.all([tlInfo(s, sc.stepSec), Promise.all(s.policies.map((p) => sim(s, sc.stepSec, stationCount, p, cfg, true)))]);
      if (my !== token) return;
      const res: Partial<Record<Policy, SimResult>> = {};
      const met: Partial<Record<Policy, Metrics>> = {};
      s.policies.forEach((p, i) => { res[p] = outs[i].result!; met[p] = outs[i].metrics; });
      if (!(await drawScenario(my, s, info, res))) return;
      extras.setValueInputs(s, met, stationCount);
      perf.senaryoMs = Math.round(performance.now() - t0);
      const spp = (m: Metrics) => (100 * m.suppressedMb) / (m.demandMb || 1);
      const rm = met.rolling!, am = met.adaptive!;
      status.textContent = `${fmt(info.n)} adım × ${s.policies.length} çizelgeleyici, ${fmt(perf.senaryoMs)} ms (${s.relayName} hattı${info.topo.relays.length > 1 ? ', 2 Ay uydusu' : ''}, Web Worker) · öncelikli: teslim %${fmt(met.priority!.deliveredPct, 1)}, düşen %${fmt(met.priority!.dropPct, 1)} · kayan ufuklu: düşen %${fmt(rm.dropPct, 1)}, üretilmeyen %${fmt(spp(rm), 1)}, teslim %${fmt(rm.deliveredPct, 1)} · uyarlamalı: düşen %${fmt(am.dropPct, 1)}, üretilmeyen %${fmt(spp(am), 1)}, teslim %${fmt(am.deliveredPct, 1)}`;
      // Kalan bölümler birbirinden bağımsızdır: işçi havuzunda birlikte hesaplanır, her biri bitince çizilir (süreler tamamlanma zamanıdır, toplamı vermez).
      const timed = async (key: string, f: Promise<void>) => { await f; perf[key] = Math.round(performance.now() - t0); };
      await Promise.all([
        timed('kapsamaMs', renderCoverage(my, s)),
        timed('istasyonKarsilastirmaMs', renderCompare(my, s)),
        timed('hataModeliMs', renderErrors(my, s)),
        timed('taramaMs', runSweeps(my, s)),
      ]);
      if (my !== token) return;
      perf.toplamMs = Math.round(performance.now() - t0);
      root.dataset.perf = JSON.stringify({ senaryo: s.key, ...perf });
      // (g)/(h): isteğe bağlı otomatik çalıştırma (ana bölümler bittikten sonra; ilk açılış ana bölümlerin süresini uzatmaz)
      if (autoScan) { void runForecastScan(); void runErrorScan(); }
    } catch (e) {
      // Veri bozuk/eksikse sayfa çökmesin: hatayı göster, dur.
      console.error(e);
      status.innerHTML = `<span class="bad">Hesaplama durdu: ${(e as Error).message}</span> Veriyi kontrol edin (<code>npm run fetch-data -- --force</code>).`;
    }
  }

  // ---- Kaydırıcılar ----
  const fmtSlider = (d: SliderDef, v: number) => `${fmt(v / d.scale, d.digits)} ${d.unit}`;
  let debounce = 0;
  const schedule = (ms: number) => { window.clearTimeout(debounce); debounce = window.setTimeout(() => void compute(), ms); };
  const syncLossEnabled = () => { const el = root.querySelector<HTMLInputElement>('#sl-earthLossPct'); if (el) el.disabled = linkMode === 'ideal'; };
  function renderSliders() {
    const box = $('#sliders');
    const defsNow = sliderDefs(def(), kind);
    const p = params();
    box.innerHTML = `${defsNow.map((d) => `<label class="slider"><span class="sl-name">${d.label}</span>
        <input type="range" id="sl-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${p[d.key]}" aria-label="${d.label}">
        <output id="out-${d.key}"></output><small id="def-${d.key}"></small></label>`).join('')}
      <button type="button" id="sl-reset">Varsayılana dön</button>`;
    for (const d of defsNow) {
      const input = $<HTMLInputElement>(`#sl-${d.key}`);
      const out = $<HTMLOutputElement>(`#out-${d.key}`);
      $(`#def-${d.key}`).textContent = `varsayılan: ${fmtSlider(d, def()[d.key])}`;
      out.textContent = fmtSlider(d, p[d.key]);
      input.addEventListener('input', () => {
        p[d.key] = Number(input.value);
        out.textContent = fmtSlider(d, p[d.key]);
        bump(); // süren hesabı iptal et (bekleyen işler başlamaz)
        markCurrent();
        $('#sc-status').textContent = 'Değişiklik bekleniyor…';
        schedule(450);
      });
    }
    $('#sl-reset').addEventListener('click', () => {
      Object.assign(p, def());
      for (const d of defsNow) {
        $<HTMLInputElement>(`#sl-${d.key}`).value = String(def()[d.key]);
        $(`#out-${d.key}`).textContent = fmtSlider(d, def()[d.key]);
      }
      markCurrent();
      schedule(0);
    });
    syncLossEnabled();
  }
  renderSliders();

  function setKind(k: ScenKind) {
    kind = k;
    $('#lb-window').hidden = !(k === 'mars' && !marsFree);
    $('#date-ctl').hidden = !(k === 'moon' || marsFree);
    $('#moon-opts').hidden = k !== 'moon';
    $('#mars-opts').hidden = k !== 'mars';
    for (const c of Object.values(sweepCharts)) for (const ch of c) ch.destroy();
    for (const key of Object.keys(sweepCharts)) delete sweepCharts[key];
    for (const key of SWEEP_KEYS) delete sweeps[key];
    renderSliders();
  }
  $<HTMLSelectElement>('#sel-scen').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    marsFree = v === 'marsfree';
    // tarih aralığı varsayılanı seçilen hatta göre (Ay: Aşama 5-8 aralığı; Mars kavuşumsuz: kavuşum içermeyen aralık)
    if (v === 'moon' || v === 'marsfree') {
      const d = v === 'moon' ? { start: ms.defaultStart, days: ms.defaultDays } : { start: HYPOTHETICAL.marsFreeScenario.defaultStart, days: HYPOTHETICAL.marsFreeScenario.defaultDays };
      $<HTMLInputElement>('#moon-start').value = clampISO(d.start);
      $<HTMLSelectElement>('#moon-days').value = String(d.days);
    }
    setKind(v === 'moon' ? 'moon' : 'mars');
    bump(); schedule(0);
  });
  const onToggle = (id: string, f: (el: HTMLInputElement) => void) => $<HTMLInputElement>(id).addEventListener('change', (e) => { f(e.target as HTMLInputElement); bump(); schedule(0); });
  onToggle('#pj-surface', (el) => { projection = { ...projection, surfaceClosure: el.checked }; });
  onToggle('#pj-arq', (el) => { projection = { ...projection, arqHold: el.checked }; });
  onToggle('#sel-polar', (el) => { netSel.moonPolarAsset = el.checked; });
  $<HTMLSelectElement>('#sel-orbit').addEventListener('change', (e) => { netSel.moonOrbit = (e.target as HTMLSelectElement).value as typeof netSel.moonOrbit; bump(); schedule(0); });
  $<HTMLSelectElement>('#sel-second').addEventListener('change', (e) => { netSel.moonSecond = (e.target as HTMLSelectElement).value as typeof netSel.moonSecond; bump(); schedule(0); });
  $<HTMLSelectElement>('#sel-eclipse').addEventListener('change', (e) => { netSel.marsEclipse = (e.target as HTMLSelectElement).value as typeof netSel.marsEclipse; bump(); schedule(0); });
  // değer modeli değişince (bölüm i): karşılaştırma tablosundaki değer sütunu ve “değer” ölçütlü duyarlılık grafikleri yenilenir (ek hesap yok)
  $('#v-tw').addEventListener('value-model', () => { if (active && cmpDone) void renderCompare(token, active); if ($<HTMLSelectElement>('#sw-loss-metric').value === 'value') drawSweeps(); });
  $('#sc-window').addEventListener('change', () => schedule(0));
  $('#moon-start').addEventListener('change', () => schedule(0));
  $('#moon-days').addEventListener('change', () => schedule(0));
  $<HTMLSelectElement>('#sel-stations').addEventListener('change', (e) => { stationCount = Number((e.target as HTMLSelectElement).value); bump(); schedule(0); });
  $<HTMLSelectElement>('#sel-rolling').addEventListener('change', (e) => { rollingDays = Number((e.target as HTMLSelectElement).value); bump(); schedule(0); });
  $<HTMLSelectElement>('#sel-mode').addEventListener('change', (e) => { linkMode = (e.target as HTMLSelectElement).value as LinkMode; syncLossEnabled(); bump(); schedule(0); });
  for (const id of ['#sw-loss-metric', '#sw-time-metric']) $(id).addEventListener('change', drawSweeps);
  $('#lb-window').hidden = false;
  $('#moon-opts').hidden = true; $('#mars-opts').hidden = false;

  return {
    async show() {
      if (built) return;
      built = true;
      try {
        if (!ChartCtor) ChartCtor = await loadChart();
        renderAssumptions();
        const first = compute(); // sim işleri Worker havuzuna hemen verilir; (a) gecikme grafikleri bu sırada parçalı çizilir
        await renderDelay();
        await first;
      } catch (e) {
        console.error(e);
        $('#sc-status').innerHTML = `<span class="bad">Çizelgeleyici paneli başlatılamadı: ${(e as Error).message}</span>`;
      }
    },
  };
}
