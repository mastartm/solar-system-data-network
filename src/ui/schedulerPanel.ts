import type { Chart, ChartConfiguration, Plugin } from 'chart.js';
import { HYPOTHETICAL, HYPOTHETICAL_LABEL } from '../config/hypothetical';
import type { Track } from '../data/types';
import { jdToDate, trackEndJD } from '../map/ephemeris';
import type { BlackoutWindow } from '../network/network';
import { simulate, type LinkSample, type Policy, type SchedTopology, type SimResult } from '../network/scheduler';
import { POLICIES, metricsOf, runPolicy, sweepValues, type PolicyMetrics, type SweepKey } from '../network/sweep';
import { computeNetwork } from '../network/network';
import { LINK_MODE_LABEL, buildLinkTimeline, defaultParams, lightDelaySeries, restrictToRelay, schedConfig, schedTopology, withParams, type LinkMode, type SweepParams } from '../network/timeline';

const fmt = (n: number, d = 0) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (jd: number) => jdToDate(jd).toISOString().slice(0, 10);
const year = (jd: number) => 1970 + (jd - 2440587.5) / 365.2425;
const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // tarayıcıya nefes aldır: uzun hesap parçalara bölünür

// Seriler: FIFO = mavi, öncelikli = turuncu, strateji = yeşil (koyu yüzeyde ayırt edilen kategorik renkler). Metin rengi seri rengi değildir.
const C = { fifo: '#3987e5', prio: '#d95926', strat: '#3fb68b', stratLoss: '#9be3c6', moon: '#cfcfcf', mars: '#d9593a', text: '#8a96b2', grid: '#1e2740', ink: '#e6ebf5' };
const NAME: Record<Policy, string> = { fifo: 'FIFO', priority: 'Öncelikli', strategy: 'Strateji' };
const COLOR: Record<Policy, string> = { fifo: C.fifo, priority: C.prio, strategy: C.strat };
const MARS_RELAY = 'mars-aktarma';

const baseOpts = (xTitle: string, yTitle: string, extra: Record<string, unknown> = {}) => ({
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
  plugins: { legend: { labels: { color: C.ink, boxWidth: 12 } } },
  scales: {
    x: { title: { display: true, text: xTitle, color: C.text }, ticks: { color: C.text }, grid: { color: C.grid } },
    y: { title: { display: true, text: yTitle, color: C.text }, ticks: { color: C.text }, grid: { color: C.grid }, beginAtZero: true },
  },
  ...extra,
});

/** Kaydırıcı tanımları: aralıklar config'ten, başlangıç değerleri çizelgeleyici config'inden gelir. */
interface SliderDef { key: SweepKey; label: string; unit: string; scale: number; digits: number; min: number; max: number; step: number }
function sliderDefs(def: SweepParams): SliderDef[] {
  const s = HYPOTHETICAL.sensitivity;
  const widen = (r: { min: number; max: number; step: number }, v: number) => ({ min: Math.min(r.min, v), max: Math.max(r.max, v), step: r.step });
  return [
    { key: 'marsRelayBufferMb', label: 'Mars uydu tamponu', unit: 'Gbit', scale: 1000, digits: 0, ...widen(s.marsRelayBufferMb, def.marsRelayBufferMb) },
    { key: 'marsRelayDownlinkKbps', label: 'Mars uydu → Dünya hat hızı', unit: 'kbit/sn', scale: 1, digits: 0, ...widen(s.marsRelayDownlinkKbps, def.marsRelayDownlinkKbps) },
    { key: 'dutyCycle', label: 'Görev döngüsü (üretim oranı)', unit: '%', scale: 0.01, digits: 1, ...widen(s.dutyCycle, def.dutyCycle) },
    { key: 'earthLossPct', label: 'Uydu → Dünya hat kaybı', unit: '%', scale: 1, digits: 0, ...widen(HYPOTHETICAL.arq.earthLossRangePct, def.earthLossPct) },
  ];
}

export interface SchedulerPanel { show(): void }

export function mountScheduler(root: HTMLElement, tracks: Record<string, Track>, windows: BlackoutWindow[], synthetic: boolean): SchedulerPanel {
  const sc = HYPOTHETICAL.scheduler;
  const cls = sc.classes;
  const def = defaultParams();
  const sliders = sliderDefs(def);
  const params: SweepParams = { ...def };
  const scenarioCharts: Chart[] = [];
  const sweepCharts: Record<string, Chart[]> = {};
  let ChartCtor: typeof import('chart.js').Chart | null = null;
  let built = false;
  let token = 0; // her yeni hesaplama bir öncekini geçersiz kılar (iptal)
  let stationCount = HYPOTHETICAL.groundStations.stations.length;
  let linkMode: LinkMode = 'arq';

  const pad = sc.scenarioPadDays;
  const usable = windows.filter((w) => w.startJD - pad.before >= tracks.earth.startJD && w.endJD + pad.after <= Math.min(trackEndJD(tracks.earth), trackEndJD(tracks.mars)));
  const opts = usable.map((w, i) => `<option value="${i}">${day(w.startJD)} – ${day(w.endJD)} (en küçük açı ${fmt(w.minSepDeg, 2)}°, ${fmt(w.endJD - w.startJD, 1)} gün)</option>`).join('');
  const SWEEP_TITLE: Record<SweepKey, { title: string; x: (v: number) => number; xTitle: string }> = {
    marsRelayBufferMb: { title: 'Tampon boyutu', x: (v) => v / 1000, xTitle: 'Mars uydu tamponu (Gbit)' },
    marsRelayDownlinkKbps: { title: 'Hat hızı', x: (v) => v, xTitle: 'Mars uydu → Dünya hızı (kbit/sn)' },
    dutyCycle: { title: 'Görev döngüsü', x: (v) => v * 100, xTitle: 'Görev döngüsü (%)' },
    earthLossPct: { title: 'Hat kaybı', x: (v) => v, xTitle: 'Uydu → Dünya hat kaybı (%)' },
  };
  const KEYS = sliders.map((s) => s.key);

  root.innerHTML = `
    <div class="sched-wrap">
      <h2>Çizelgeleyici analizi <span class="badge-hyp">${HYPOTHETICAL_LABEL}</span></h2>
      <p class="warn">Bu sonuçlar <b>gerçek bir görev sonucu değildir</b>. Araçlar, veri hızları, paket boyutları, öncelik sınıfları, tampon kapasiteleri ve strateji parametreleri uydurmadır (<code>src/config/hypothetical.ts</code>). Gerçek olan tek şey Horizons konumlarından gelen ışık gecikmeleri ve bağlantı geometrisidir.</p>
      ${synthetic ? '<p class="warn syn"><b>SENTETİK VERİ:</b> sayfa <code>?sentetik=1</code> ile açıldı; yörüngeler Horizons değil, uydurma dairesel yörüngelerdir. Gecikme ve kavuşum tarihleri gerçeği yansıtmaz.</p>' : ''}

      <section>
        <h3>(a) Tek yön ışık gecikmesi <small>(Dünya merkezi – cisim merkezi, Horizons konumları)</small></h3>
        <div class="charts two"><div class="chart"><canvas id="ch-moon" aria-label="Ay ışık gecikmesi"></canvas></div><div class="chart"><canvas id="ch-mars" aria-label="Mars ışık gecikmesi"></canvas></div></div>
        <p class="hint" id="delay-stats"></p>
      </section>

      <section>
        <h3>Yer istasyonu görüşü <small>(seçili kavuşum penceresi, 30 dk adım · ${HYPOTHETICAL_LABEL})</small></h3>
        <div id="st-table"></div>
        <p class="hint" id="st-hint"></p>
      </section>

      <section>
        <h3>Senaryo ve ayarlar <small>(Mars kavuşumu çevresi · ${HYPOTHETICAL_LABEL})</small></h3>
        <div class="row"><label>Kavuşum penceresi <select id="sc-window">${opts || '<option>Uygun pencere yok</option>'}</select></label><span class="legend" id="sc-status" role="status"></span></div>
        <div class="sliders" id="sliders">
          ${sliders.map((d) => `<label class="slider"><span class="sl-name">${d.label}</span>
            <input type="range" id="sl-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${params[d.key]}" aria-label="${d.label}">
            <output id="out-${d.key}"></output><small id="def-${d.key}"></small></label>`).join('')}
          <button type="button" id="sl-reset">Varsayılana dön</button>
        </div>
        <div class="row">
          <label>Yer istasyonu sayısı <select id="sel-stations">${[0, ...HYPOTHETICAL.groundStations.stations.map((_, i) => i + 1)].map((n) => `<option value="${n}"${n === stationCount ? ' selected' : ''}>${n === 0 ? 'Yok (ideal: Dünya merkezi)' : n}</option>`).join('')}</select></label>
          <label>Hat modu <select id="sel-mode">${(Object.keys(LINK_MODE_LABEL) as LinkMode[]).map((m) => `<option value="${m}"${m === linkMode ? ' selected' : ''}>${LINK_MODE_LABEL[m]}</option>`).join('')}</select></label>
        </div>
        <p class="hint"><b>Yer istasyonu:</b> Mars hattının Dünya bağlantısı, istasyonlardan en az biri uyduyu ${HYPOTHETICAL.groundStations.minElevationDeg}° üstünde görüyorsa açıktır. <b>Hat modu:</b> <i>kayıpsız</i> = Aşama 3-4 davranışı; <i>hatalı, yeniden iletimsiz</i> = kaybolan paket kalıcı kayıp (“hatta kayıp”); <i>hatalı + yeniden iletim</i> = gönderici paketi ışık gidiş-dönüş süresi (RTT) boyunca tamponunda tutar, kaybolursa en çok ${HYPOTHETICAL.arq.maxAttempts} denemeye kadar yeniden gönderir. Hat kaybı kaydırıcısı yalnızca hatalı modlarda etkilidir; yüzey hattı kaybı sabit %${HYPOTHETICAL.arq.surfaceLossPct}.</p>
        <p class="hint">Kaydırıcıların başlangıç değerleri <code>src/config/hypothetical.ts</code> değerleridir; yalnızca <b>Mars</b> hattını değiştirirler (Ay hattı sabit). Bırakınca (kısa bir bekleme sonrası) senaryo ve diğer parametrelerin taramaları yeniden hesaplanır.</p>
        <p class="hint">Aynı bağlantı çizelgesi (ufuk, Dünya görüşü, kavuşum) üç çizelgeleyiciyle çalıştırılır: <b>FIFO</b> (geliş sırası), <b>öncelikli</b> (${cls.map((c) => c.name).join(' > ')}) ve <b>strateji</b> (öncelikli + kavuşum öncesi/sırasında bilim verisi üretimini kısma). Taşan tamponda FIFO yeni geleni atar; öncelikli ve strateji, daha düşük sınıfın en yeni paketini atarak yer açar.</p>
        <p class="hint">Kapsam: bu bölümün tamamı <b>Mars aktarma hattını</b> (uydu + ona bağlı 2 araç) simüle eder; kavuşum ve strateji yalnızca Mars'ı ilgilendirir. Ay hattı (Ay Aracı A enlemi −85°'den −40°'ye alınarak uyduyu görebilir hale getirildi) yer istasyonu tablosunda ve haritada yer alır; sonuçları README'de.</p>
      </section>

      <section>
        <h3>Kayıp, üretilmeyen ve talep: tanımlar</h3>
        <div class="warn def">
          <b>Düşen (kayıp):</b> üretilmiş ama tampon taşması yüzünden atılan veri.<br>
          <b>Üretilmeyen:</b> strateji yüzünden hiç üretilmeyen (kısılan) veri. Tampona hiç girmediği için <i>düşen sayılmaz</i>; ayrı sütunda gösterilir.<br>
          <b>Talep</b> = üretilen + üretilmeyen: çizelgeleyiciden bağımsız, araçların kısma olmasaydı üreteceği veri. FIFO ve öncelikli çizelgeler üretimi kısmaz (üretilmeyen = 0), bu yüzden talepleri üretilene eşittir.<br>
          <b>Karşılaştırma ölçütleri:</b> “düşen %” = düşen / talep; “düşen + üretilmeyen %” = stratejiyi kısmakla kayıptan kurtulmuş saymayan, daha sert ölçüt. Strateji ikisini de gösterir. “Teslim %” = teslim / talep.<br>
          <b>Hatta kayıp:</b> hat hatası yüzünden maxAttempts denemede iletilemeyen paket (yeniden iletimsiz modda ilk kayıp kalıcıdır). Tampon taşması olan “düşen”den ayrıdır; kayıp ölçütlerine (düşen + hatta kayıp [+ üretilmeyen]) birlikte girer.<br>
          <b>Her zaman:</b> üretilen = teslim + düşen + hatta kayıp + tamponda kalan; talep = üretilen + üretilmeyen (testle doğrulanır). Yeniden iletimde gönderici, onaylanmamış kopyayı tamponunda tutar; bu tampon doluluğuna sayılır.
        </div>
      </section>

      <section>
        <h3>(b) FIFO, öncelikli ve strateji</h3>
        <div class="charts three">
          <div class="chart"><canvas id="ch-lat" aria-label="Teslim süresi"></canvas></div>
          <div class="chart"><canvas id="ch-fill" aria-label="Tampon doluluğu"></canvas></div>
          <div class="chart"><canvas id="ch-loss" aria-label="Kayıp ve üretilmeyen"></canvas></div>
        </div>
        <p class="hint">Teslim süresi yalnızca <i>teslim edilenler</i> üzerinden hesaplanır: bir çizelgeleyici paketi düşürürse (veya strateji hiç üretmezse) onun beklemesi ortalamaya girmez (hayatta kalma yanlılığı). Bu yüzden süreyi kayıp ve teslim sayısıyla birlikte okuyun. Kavuşum sırasında üretilen telemetri her çizelgeleyicide kesintinin bitmesini beklemek zorundadır; bu yüzden telemetri süresi kesinti uzunluğuna yakındır.</p>
        <div id="stats-table"></div>
      </section>

      <section>
        <h3>(c) Kavuşum penceresinde Mars aktarma uydusu tamponu</h3>
        <div class="charts one"><div class="chart tall"><canvas id="ch-buf" aria-label="Tampon dolup boşalması"></canvas></div></div>
        <p class="hint">Gölgeli alan: Güneş–Mars açısı ${HYPOTHETICAL.conjunctionBlackoutAngleDeg}° eşiğinin altında (kesinti). Kesintide araç → uydu hattı açık kalır, uydu → Dünya hattı kapalıdır; uydu tamponu dolar, kesinti bitince boşalır. FIFO ve öncelikli toplam doluluğu hemen hemen aynı doldurup boşalttığı için eğriler çoğunlukla üst üste biner (öncelikli eğri FIFO'nun altında/üstünde kalabilir); fark tamponda <i>hangi</i> verinin kaldığında ve kayıp tablosundadır. Strateji kesintiye ${fmt(HYPOTHETICAL.strategy.lookaheadDays, 1)} gün kala üretimi kıstığı için tamponu yavaş doldurur. Strateji, uydu + araç tamponlarının toplam boşluğuna göre bütçelediği için grafikte yalnızca <i>uydu</i> tamponu kesinti bitmeden dolabilir (araç tamponları daha geç dolar).</p>
      </section>

      <section>
        <h3>(d) Duyarlılık analizi <small>(her grafikte yalnızca o parametre değişir, diğerleri kaydırıcı değerinde)</small></h3>
        <div class="row">
          <label>Kayıp ölçütü <select id="sw-loss-metric"><option value="total">Toplam (hacim %)</option><option value="top">Telemetri (hacim %)</option><option value="deliv">Teslim edilen (talebin %'si)</option><option value="abandoned">Hatta kayıp (hacim %)</option><option value="retx">Yeniden gönderilen (paket)</option></select></label>
          <label>Süre ölçütü <select id="sw-time-metric"><option value="topP95">Telemetri, %95</option><option value="lowP95">Bilim verisi, %95</option><option value="topMean">Telemetri, ortalama</option><option value="lowMean">Bilim verisi, ortalama</option></select></label>
          <span class="legend" id="sw-status" role="status"></span>
        </div>
        <div class="charts four" id="sw-loss-grid">${KEYS.map((k) => `<div class="chart"><canvas id="sw-loss-${k}" aria-label="${SWEEP_TITLE[k].title}: kayıp"></canvas></div>`).join('')}</div>
        <div class="charts four" id="sw-time-grid">${KEYS.map((k) => `<div class="chart"><canvas id="sw-time-${k}" aria-label="${SWEEP_TITLE[k].title}: teslim süresi"></canvas></div>`).join('')}</div>
        <p class="hint">Düşey kesikli çizgi kaydırıcının şu anki değeridir. FIFO ve öncelikli çizelgeler tüm hacmi aynı oranda kaybedebilir (ikisi de işi korur; kalın mavi çizgi altta kalır); fark “Telemetri” ölçütünde ve sınıf tablosunda görülür. Telemetri kısılmadığı için telemetri tek başına tamponu aşarsa (yüksek görev döngüsü, küçük tampon) strateji düşenleri engelleyemez. “Strateji (düşen + hatta kayıp)” üretilmeyen veriyi saymaz, “Strateji (+ üretilmeyen)” kısılan veriyi de kayıp sayar; stratejiyi adil değerlendirmek için ikisine birlikte bakın. Tarama adımı ${HYPOTHETICAL.sensitivity.sweepStepSec} sn (ana senaryo ${sc.stepSec} sn); sayılar iki hesap arasında küçük farklar gösterebilir. Bu bir tek kavuşum penceresi içindir; başka pencerede (farklı mesafe/gecikme) değerler değişir.</p>
      </section>

      <section>
        <h3>${HYPOTHETICAL_LABEL}</h3>
        <div id="assumptions"></div>
        <p class="hint">Basitleştirmeler: iki atlama (araç → uydu → Dünya), her atlamada tek bağlantı hızı; yer istasyonu, kodlama, yeniden iletim ve hata yok; paketler "toplu veri parçası"dır; uydu tamponu doluyken araç göndermez (geri basınç) ve verisini kendi tamponunda tutar; simülasyon adımı ${sc.stepSec} sn, bu yüzden teslim süreleri en fazla bir adım kadar kaba. Strateji kesintinin başlangıcını ve bitişini önceden bildiğini varsayar (Güneş–Mars geometrisi öngörülebilirdir); gerçek bir görevin bunu nasıl yaptığı bilinmiyor.</p>
      </section>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

  const addChart = (list: Chart[], id: string, cfg: ChartConfiguration | Record<string, unknown>) => {
    const ch = new ChartCtor!($<HTMLCanvasElement>(id), cfg as ChartConfiguration);
    list.push(ch);
    return ch;
  };

  function renderAssumptions() {
    const st = HYPOTHETICAL.strategy;
    const se = HYPOTHETICAL.sensitivity;
    const row = (a: string, b: string) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    $('#assumptions').innerHTML = `<table class="stats"><tbody>
      ${cls.map((c) => row(`Sınıf: ${c.name}`, `öncelik ${c.priority} · pay %${fmt(c.share * 100)} · paket ${fmt(c.packetMb, 1)} Mb`)).join('')}
      ${row('Ortalama üretim', `veri hızının %${fmt(sc.dutyCycle * 100, 1)}'i (${HYPOTHETICAL.assets.map((a) => `${a.name}: ${fmt(a.dataRateKbps * sc.dutyCycle, 1)} kbit/sn`).join(' · ')})`)}
      ${row('Araç → uydu hızı', `Ay ${fmt(sc.surfaceLinkKbps.moon)} · Mars ${fmt(sc.surfaceLinkKbps.mars)} kbit/sn (araç başına)`)}
      ${row('Uydu → Dünya hızı', HYPOTHETICAL.relays.map((r) => `${r.name}: ${fmt(sc.relayDownlinkKbps[r.id])} kbit/sn`).join(' · '))}
      ${row('Araç tamponu', `Ay ${fmt(sc.assetBufferMb.moon)} Mb · Mars ${fmt(sc.assetBufferMb.mars)} Mb`)}
      ${row('Uydu tamponu', HYPOTHETICAL.relays.map((r) => `${r.name}: ${fmt(sc.relayBufferMb[r.id])} Mb`).join(' · '))}
      ${row('"Gecikmeli" eşiği', `kuyrukta ${fmt(sc.delayedAfterSec / 60)} dk'dan uzun bekleme`)}
      ${row('Senaryo aralığı', `kavuşumdan ${sc.scenarioPadDays.before} gün önce – ${sc.scenarioPadDays.after} gün sonra`)}
      ${row('Strateji (bütçeli kısma)', `kesintiye ${fmt(st.lookaheadDays, 1)} gün kala başlar · boş tamponun %${fmt(st.margin * 100)}'i bilim verisi bütçesi · çarpan alt sınırı ${fmt(st.minFactor, 2)} · telemetri kısılmaz`)}
      ${row('Yer istasyonları', `${HYPOTHETICAL.groundStations.stations.map((g) => `${g.name} (${fmt(g.latDeg, 1)}°, ${fmt(g.lonDeg, 1)}°)`).join(' · ')} · en düşük yükseklik ${HYPOTHETICAL.groundStations.minElevationDeg}° · anlık devir, tek hat`)}
      ${row('Hat hatası / yeniden iletim', `yüzey hattı %${fmt(HYPOTHETICAL.arq.surfaceLossPct, 1)}, Dünya hattı %${fmt(HYPOTHETICAL.arq.earthLossPct, 1)} (belirleyici biriktirici, rastgelelik yok) · en çok ${HYPOTHETICAL.arq.maxAttempts} deneme · Dünya hattında kopya RTT (2 × ışık gecikmesi) boyunca tamponda tutulur`)}
      ${row('Kaydırıcı aralıkları', `tampon ${fmt(se.marsRelayBufferMb.min / 1000)}–${fmt(se.marsRelayBufferMb.max / 1000)} Gbit · hat ${fmt(se.marsRelayDownlinkKbps.min)}–${fmt(se.marsRelayDownlinkKbps.max)} kbit/sn · görev döngüsü %${fmt(se.dutyCycle.min * 100, 1)}–%${fmt(se.dutyCycle.max * 100, 1)} · hat kaybı %${fmt(HYPOTHETICAL.arq.earthLossRangePct.min)}–%${fmt(HYPOTHETICAL.arq.earthLossRangePct.max)} · tarama ${fmt(se.sweepPoints)} nokta + varsayılan`)}
    </tbody></table>`;
  }

  function renderDelay() {
    const moon = lightDelaySeries(tracks, 'moon', 1);
    const mars = lightDelaySeries(tracks, 'mars', 5);
    if (!moon.length || !mars.length || [...moon, ...mars].some((p) => !Number.isFinite(p.sec))) throw new Error('Işık gecikmesi serisi hesaplanamadı: konum verisi eksik ya da bozuk.');
    const mk = (id: string, pts: { jd: number; sec: number }[], scale: number, label: string, ytitle: string, color: string) =>
      addChart(scenarioCharts, id, {
        type: 'line',
        data: { datasets: [{ label, data: pts.map((p) => ({ x: year(p.jd), y: p.sec / scale })), borderColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }] },
        options: baseOpts('Yıl', ytitle, {
          parsing: false, normalized: true,
          scales: { ...baseOpts('Yıl', ytitle).scales, x: { type: 'linear', title: { display: true, text: 'Yıl', color: C.text }, ticks: { color: C.text, stepSize: 2, callback: (v: number | string) => String(v) }, grid: { color: C.grid } } },
        }),
      });
    mk('#ch-moon', moon, 1, 'Ay (Dünya merkezi – Ay merkezi)', 'Tek yön gecikme (sn)', C.moon);
    mk('#ch-mars', mars, 60, 'Mars (Dünya merkezi – Mars merkezi)', 'Tek yön gecikme (dakika)', C.mars);
    const r = (p: { sec: number }[]) => [Math.min(...p.map((x) => x.sec)), Math.max(...p.map((x) => x.sec))];
    const [m0, m1] = r(moon), [a0, a1] = r(mars);
    $('#delay-stats').textContent = `Ay: ${fmt(m0, 2)}–${fmt(m1, 2)} sn · Mars: ${fmt(a0 / 60, 1)}–${fmt(a1 / 60, 1)} dk. Eksenler ayrı grafiklerdedir (ölçekler çok farklı). Uydu yüksekliği ve yüzey yolu (varsayımsal) bu eğriye dahil değildir.`;
  }

  // ---- Yer istasyonu kapsaması (pencere başına bir kez; istasyon sayısından bağımsız tüm sayılar için) ----
  const coverageCache = new Map<number, string>();
  async function renderCoverage(my: number, w: BlackoutWindow, idx: number) {
    const el = $('#st-table');
    const cached = coverageCache.get(idx);
    if (cached) { el.innerHTML = cached; return; }
    el.textContent = 'Hesaplanıyor…';
    const counts = [0, ...HYPOTHETICAL.groundStations.stations.map((_, i) => i + 1)];
    const relays = HYPOTHETICAL.relays;
    const rows: string[] = [];
    let surface: Record<string, number> = {};
    for (const n of counts) {
      await tick();
      if (my !== token) return;
      const see: Record<string, number> = {}, up: Record<string, number> = {}, surf: Record<string, number> = {};
      let t = 0;
      for (let jd = w.startJD - pad.before; jd < w.endJD + pad.after; jd += 1 / 48) {
        t++;
        for (const st of computeNetwork(tracks, jd, n).statuses) {
          see[st.relay.id] = (see[st.relay.id] ?? 0) + (n === 0 || st.station ? 1 : 0);
          up[st.relay.id] = (up[st.relay.id] ?? 0) + (st.earthLink === 'up' ? 1 : 0);
          surf[st.asset.id] = (surf[st.asset.id] ?? 0) + (st.surfaceLink === 'up' ? 1 : 0);
        }
      }
      const perRelay = (r: string) => HYPOTHETICAL.assets.filter((a) => a.relay === r).length;
      if (n === 0) surface = Object.fromEntries(Object.entries(surf).map(([k, v]) => [k, (100 * v) / t]));
      rows.push(`<tr><td>${n === 0 ? 'Yok (ideal)' : n}</td>${relays.map((r) => `<td>${n === 0 ? '—' : fmt((100 * see[r.id]) / t / perRelay(r.id), 1)}</td><td>${fmt((100 * up[r.id]) / t / perRelay(r.id), 1)}</td>`).join('')}</tr>`);
    }
    const html = `<table class="stats"><thead><tr><th>İstasyon sayısı</th>${relays.map((r) => `<th>${r.name.replace(' Aktarma Uydusu', '')}: istasyon uyduyu görüyor %</th><th>${r.name.replace(' Aktarma Uydusu', '')}: Dünya hattı açık %</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    coverageCache.set(idx, html);
    el.innerHTML = html;
    $('#st-hint').innerHTML = `“Görüyor”: en az bir istasyon uyduyu ${HYPOTHETICAL.groundStations.minElevationDeg}° üstünde görüyor. “Dünya hattı açık”: ayrıca uydu cismin arkasında değil ve (Mars) kavuşum kesintisinde değil. Yüzey görüşü (araç → uydu, istasyon sayısından bağımsız): ${HYPOTHETICAL.assets.map((a) => `${a.name} %${fmt(surface[a.id] ?? 0)}`).join(' · ')}.`;
  }

  // ---- Zaman çizelgesi önbelleği (yalnızca Mars hattı); kaydırıcılar bağlantıları değiştirmez, bu yüzden yeniden kullanılır ----
  const tlCache = new Map<string, { topo: SchedTopology; samples: LinkSample[] }>();
  function timeline(w: BlackoutWindow, idx: number, stepSec: number) {
    const key = `${idx}|${stepSec}|${stationCount}`;
    let t = tlCache.get(key);
    if (!t) {
      const full = buildLinkTimeline(tracks, w.startJD - pad.before, w.endJD + pad.after, stepSec, schedTopology(), stationCount);
      if (!full.length) throw new Error('Bağlantı çizelgesi boş: tarih aralığı veri dışında.');
      if (full.some((x) => [...x.surfaceDelaySec, ...x.earthDelaySec].some((v) => !Number.isFinite(v)))) throw new Error('Işık gecikmesi sayısal değil: konum verisi bozuk görünüyor.');
      t = restrictToRelay(schedTopology(), full, MARS_RELAY);
      tlCache.set(key, t);
    }
    return t;
  }

  function tableHtml(res: Record<Policy, SimResult>) {
    const h = (s: number) => (s < 7200 ? `${fmt(s / 60, 1)} dk` : s < 172800 ? `${fmt(s / 3600, 1)} sa` : `${fmt(s / 86400, 1)} gün`);
    let ok = true;
    const rows = (p: Policy) => {
      const r = res[p];
      return [...cls.map((c) => [c.name, r.perClass[c.id]] as const), ['Toplam', r.total] as const]
        .map(([n, s]) => {
          if (s.generated !== s.delivered + s.dropped + s.abandoned + s.remaining) ok = false;
          const demand = s.generated + s.suppressed;
          return `<tr><td>${NAME[p]}</td><td>${n}</td><td>${fmt(demand)}</td><td>${fmt(s.generated)}</td><td>${p === 'strategy' ? fmt(s.suppressed) : '—'}</td><td>${fmt(s.delivered)}</td><td>${fmt(s.stored)}</td><td>${fmt(s.delayed)}</td><td class="${s.dropped ? 'bad' : ''}">${fmt(s.dropped)}</td><td class="${s.abandoned ? 'bad' : ''}">${fmt(s.abandoned)}</td><td>${fmt(s.retransmissions)}</td><td>${fmt(s.remaining)}</td><td>${s.delivered ? h(s.latencyMeanSec) : '—'}</td><td>${s.delivered ? h(s.latencyP95Sec) : '—'}</td><td>${demand ? fmt((100 * s.deliveredMb) / (s.generatedMb + s.suppressedMb), 1) : '—'}</td></tr>`;
        })
        .join('');
    };
    return `<table class="stats"><thead><tr><th>Çizelgeleyici</th><th>Sınıf</th><th>Talep</th><th>Üretilen</th><th>Üretilmeyen</th><th>Teslim</th><th>Tamponlanan</th><th>Gecikmeli</th><th>Düşen</th><th>Hatta kayıp</th><th>Yeniden gönderilen</th><th>Tamponda kalan</th><th>Ort. süre</th><th>%95 süre</th><th>Teslim %</th></tr></thead><tbody>${POLICIES.map(rows).join('')}</tbody></table>
      <p class="hint">Paket sayıları (Teslim % hacim üzerinden, talebe oranla). <b>Talep</b> = üretilen + üretilmeyen. <b>Üretilmeyen</b>: stratejinin kıstığı, hiç üretilmeyen veri (kayıp değil). <b>Tamponlanan</b>: teslim edilmeden önce bir adımdan uzun tamponda bekleyen. <b>Gecikmeli</b>: kuyrukta ${fmt(sc.delayedAfterSec / 60)} dk'dan uzun bekleyip teslim edilen. <b>Düşen</b>: tampon taşması. <b>Hatta kayıp</b>: hat hatası yüzünden hakkı tükenen paket. <b>Yeniden gönderilen</b>: kaybolup yeniden iletilen paket sayısı. Üretilen = teslim + düşen + hatta kayıp + tamponda kalan. Korunum denetimi: <span class="${ok ? 'ok' : 'bad'}">${ok ? 'tüm satırlarda tamam' : 'BOZUK — bir satırda eşitlik tutmuyor'}</span>.</p>`;
  }

  function drawScenario(w: BlackoutWindow, startJD: number, topo: SchedTopology, res: Record<Policy, SimResult>) {
    for (const c of scenarioCharts.splice(2)) c.destroy(); // ilk ikisi (a) grafikleridir, kalsın
    const trio = (f: (p: Policy) => number[], extra: { label: string; data: number[]; backgroundColor: string }[] = []) => [
      ...POLICIES.map((p) => ({ label: NAME[p], data: f(p), backgroundColor: COLOR[p], borderRadius: 4 })),
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
      data: { labels: names, datasets: trio((p) => cls.map((c) => res[p].perClass[c.id].latencyP95Sec / 86400)) },
      options: barOpts('Teslim süresi, %95 (gün)', 'Teslim süresi (teslim edilenler)'),
    });

    const nodes = [
      ...HYPOTHETICAL.relays.filter((r) => topo.relays.includes(r.id)).map((r) => ({ n: r.name.replace(' Uydusu', ''), get: (x: SimResult) => x.peakRelayFill[r.id] })),
      ...HYPOTHETICAL.assets.filter((a) => topo.assets.some((t) => t.id === a.id)).map((a) => ({ n: a.name, get: (x: SimResult) => x.peakAssetFill[a.id] })),
    ];
    const yb = baseOpts('', '').scales.y;
    addChart(scenarioCharts, '#ch-fill', {
      type: 'bar',
      data: { labels: nodes.map((x) => x.n), datasets: trio((p) => nodes.map((x) => x.get(res[p]) * 100)) },
      options: barOpts('En yüksek doluluk (%)', 'Tampon doluluğu (tepe)', { y: { ...yb, max: 100, title: { display: true, text: 'En yüksek doluluk (%)', color: C.text } } }),
    });

    addChart(scenarioCharts, '#ch-loss', {
      type: 'bar',
      data: { labels: names, datasets: trio((p) => cls.map((c) => res[p].perClass[c.id].dropped), [{ label: 'Strateji: üretilmeyen', data: cls.map((c) => res.strategy.perClass[c.id].suppressed), backgroundColor: C.stratLoss }]) },
      options: barOpts('Paket', 'Düşen (taşma) ve üretilmeyen'),
    });

    $('#stats-table').innerHTML = tableHtml(res);

    // (c) Mars aktarma uydusu tampon doluluğu
    const toPts = (r: SimResult) => r.series.map((s) => ({ x: s.tSec / 86400, y: s.relayFill[0] * 100 }));
    const shade: Plugin = {
      id: 'blackout',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const x0 = scales.x.getPixelForValue(w.startJD - startJD), x1 = scales.x.getPixelForValue(w.endJD - startJD);
        ctx.save();
        ctx.fillStyle = 'rgba(255,200,61,0.12)';
        ctx.fillRect(Math.max(x0, chartArea.left), chartArea.top, Math.min(x1, chartArea.right) - Math.max(x0, chartArea.left), chartArea.bottom - chartArea.top);
        ctx.restore();
      },
    };
    const ds = (p: Policy, dash?: number[]) => ({ label: NAME[p], data: toPts(res[p]), borderColor: COLOR[p], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, ...(dash ? { borderDash: dash } : {}) });
    addChart(scenarioCharts, '#ch-buf', {
      type: 'line',
      data: { datasets: [ds('fifo'), ds('priority', [6, 3]), ds('strategy', [2, 2])] },
      options: baseOpts(`Gün (0 = ${day(startJD)})`, 'Uydu tamponu doluluğu (%)', {
        parsing: false,
        scales: { x: { type: 'linear', title: { display: true, text: `Gün (0 = ${day(startJD)})`, color: C.text }, ticks: { color: C.text }, grid: { color: C.grid } },
          y: { title: { display: true, text: 'Uydu tamponu doluluğu (%)', color: C.text }, ticks: { color: C.text }, grid: { color: C.grid }, min: 0, max: 100 } },
      }),
      plugins: [shade],
    });
  }

  // ---- Tarama (duyarlılık) ----
  interface Sweep { deps: string; values: number[]; rows: PolicyMetrics[] }
  const sweeps: Partial<Record<SweepKey, Sweep>> = {};

  const marker = (key: SweepKey): Plugin => ({
    id: 'current-value',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(SWEEP_TITLE[key].x(params[key]));
      if (!Number.isFinite(x) || x < chartArea.left - 1 || x > chartArea.right + 1) return;
      ctx.save();
      ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.6; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.restore();
    },
  });

  function drawSweep(key: SweepKey) {
    const sw = sweeps[key];
    if (!sw || !ChartCtor) return;
    for (const c of sweepCharts[key] ?? []) c.destroy();
    sweepCharts[key] = [];
    const list = sweepCharts[key];
    const meta = SWEEP_TITLE[key];
    const xs = sw.values.map(meta.x);
    // Çakışan eğriler (ör. FIFO ve öncelikli toplam kaybı aynı hacimdir) birbirini gizlemesin: FIFO kalın ve en altta çizilir.
    const line = (label: string, color: string, ys: number[], dash?: number[]) => ({
      label, data: xs.map((x, i) => ({ x, y: ys[i] })), borderColor: color, backgroundColor: color, tension: 0, pointHoverRadius: 5,
      ...(label === 'FIFO' ? { borderWidth: 6, pointRadius: 5, order: 3 } : { borderWidth: 2, pointRadius: 3, order: label === 'Öncelikli' ? 1 : 0 }),
      ...(dash ? { borderDash: dash } : {}),
    });
    const col = (f: (m: PolicyMetrics) => number) => sw.rows.map(f);
    const lossMode = $<HTMLSelectElement>('#sw-loss-metric').value;
    const timeMode = $<HTMLSelectElement>('#sw-time-metric').value;

    let lossSets, lossY: string, lossTitle: string;
    if (lossMode === 'top') {
      lossSets = POLICIES.map((p) => line(NAME[p], COLOR[p], col((m) => m[p].topDropPct), p === 'priority' ? [6, 3] : p === 'strategy' ? [2, 2] : undefined));
      lossY = 'Telemetri düşen (%)'; lossTitle = `${meta.title}: telemetri kaybı`;
    } else if (lossMode === 'abandoned') {
      lossSets = POLICIES.map((p) => line(NAME[p], COLOR[p], col((m) => m[p].abandonedPct), p === 'priority' ? [6, 3] : p === 'strategy' ? [2, 2] : undefined));
      lossY = 'Hatta kayıp (talebin %\'si)'; lossTitle = `${meta.title}: hatta kayıp`;
    } else if (lossMode === 'retx') {
      lossSets = POLICIES.map((p) => line(NAME[p], COLOR[p], col((m) => m[p].retransmissions), p === 'priority' ? [6, 3] : p === 'strategy' ? [2, 2] : undefined));
      lossY = 'Yeniden gönderilen paket'; lossTitle = `${meta.title}: yeniden iletim`;
    } else if (lossMode === 'deliv') {
      lossSets = POLICIES.map((p) => line(NAME[p], COLOR[p], col((m) => m[p].deliveredPct), p === 'priority' ? [6, 3] : p === 'strategy' ? [2, 2] : undefined));
      lossY = 'Teslim edilen / talep (%)'; lossTitle = `${meta.title}: teslim edilen`;
    } else {
      lossSets = [
        line('FIFO', C.fifo, col((m) => m.fifo.dropPct + m.fifo.abandonedPct)),
        line('Öncelikli', C.prio, col((m) => m.priority.dropPct + m.priority.abandonedPct), [6, 3]),
        line('Strateji (düşen + hatta kayıp)', C.strat, col((m) => m.strategy.dropPct + m.strategy.abandonedPct), [2, 2]),
        line('Strateji (+ üretilmeyen)', C.stratLoss, col((m) => m.strategy.lossPct)),
      ];
      lossY = 'Kayıp (talebin %\'si)'; lossTitle = `${meta.title}: kayıp`;
    }
    const tkey = timeMode as 'topP95' | 'lowP95' | 'topMean' | 'lowMean';
    const metric = (m: PolicyMetrics, p: Policy) => ({ topP95: m[p].topP95Sec, lowP95: m[p].lowP95Sec, topMean: m[p].topMeanSec, lowMean: m[p].lowMeanSec })[tkey] / 86400;
    const timeSets = POLICIES.map((p) => line(NAME[p], COLOR[p], col((m) => metric(m, p)), p === 'priority' ? [6, 3] : p === 'strategy' ? [2, 2] : undefined));
    const timeLabel = $<HTMLSelectElement>('#sw-time-metric').selectedOptions[0].textContent;

    const mk = (id: string, sets: unknown[], y: string, title: string, max?: number) => {
      const b = baseOpts(meta.xTitle, y);
      addChart(list, id, {
        type: 'line',
        data: { datasets: sets },
        options: { ...b, parsing: false, scales: { x: { ...b.scales.x, type: 'linear' }, y: { ...b.scales.y, ...(max ? { max } : {}) } }, plugins: { title: { display: true, text: title, color: C.ink }, legend: { labels: { color: C.ink, boxWidth: 12 } } } },
        plugins: [marker(key)],
      });
    };
    mk(`#sw-loss-${key}`, lossSets, lossY, lossTitle, lossMode === 'deliv' ? 100 : undefined);
    mk(`#sw-time-${key}`, timeSets, 'Teslim süresi (gün)', `${meta.title}: ${timeLabel}`);
  }

  function markCurrent() { for (const k of KEYS) for (const c of sweepCharts[k] ?? []) c.update('none'); }

  async function runSweeps(my: number, w: BlackoutWindow, idx: number) {
    const se = HYPOTHETICAL.sensitivity;
    const cfg = { ...schedConfig(linkMode), stepSec: se.sweepStepSec };
    const { topo, samples } = timeline(w, idx, se.sweepStepSec);
    const status = $('#sw-status');
    for (const d of sliders) {
      const others = KEYS.filter((k) => k !== d.key).map((k) => params[k]);
      const deps = JSON.stringify([idx, d.key, others, stationCount, linkMode]);
      if (sweeps[d.key]?.deps === deps) { drawSweep(d.key); continue; }
      const values = sweepValues(d.min, d.max, se.sweepPoints, def[d.key]);
      const rows: PolicyMetrics[] = [];
      for (let i = 0; i < values.length; i++) {
        status.textContent = `Tarama: ${SWEEP_TITLE[d.key].title} ${i + 1}/${values.length}…`;
        const row = {} as PolicyMetrics;
        for (const p of POLICIES) {
          await tick(); // her çizelgeleyici ayrı parça: tarayıcı arada çizim/girdi işleyebilir
          if (my !== token) return;
          row[p] = runPolicy(topo, samples, cfg, params, p, { [d.key]: values[i] });
        }
        rows.push(row);
      }
      sweeps[d.key] = { deps, values, rows };
      drawSweep(d.key);
    }
    status.textContent = `Tarama tamam (${fmt(se.sweepStepSec)} sn adım).`;
  }

  async function compute() {
    const status = $('#sc-status');
    const idx = Number($<HTMLSelectElement>('#sc-window').value);
    const w = usable[idx];
    if (!w) { status.textContent = 'Veri aralığında uygun kavuşum penceresi yok.'; return; }
    const my = ++token;
    status.textContent = 'Hesaplanıyor…';
    $('#sw-status').textContent = '';
    await tick();
    try {
      const t0 = performance.now();
      const startJD = w.startJD - pad.before;
      const { topo, samples } = timeline(w, idx, sc.stepSec);
      const cfg = withParams(schedConfig(linkMode), params);
      const res = {} as Record<Policy, SimResult>;
      for (const p of POLICIES) {
        res[p] = simulate(topo, samples, p, cfg);
        await tick();
        if (my !== token) return;
      }
      drawScenario(w, startJD, topo, res);
      const m = metricsOf(res.strategy, cfg);
      status.textContent = `${fmt(samples.length)} adım × 3 çizelgeleyici, ${fmt(performance.now() - t0)} ms (Mars hattı) · strateji: düşen %${fmt(m.dropPct, 1)}, üretilmeyen %${fmt((100 * m.suppressedMb) / (m.demandMb || 1), 1)}`;
      await renderCoverage(my, w, idx);
      if (my !== token) return;
      await runSweeps(my, w, idx);
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
  for (const d of sliders) {
    const input = $<HTMLInputElement>(`#sl-${d.key}`);
    const out = $<HTMLOutputElement>(`#out-${d.key}`);
    $(`#def-${d.key}`).textContent = `varsayılan: ${fmtSlider(d, def[d.key])}`;
    out.textContent = fmtSlider(d, params[d.key]);
    input.addEventListener('input', () => {
      params[d.key] = Number(input.value);
      out.textContent = fmtSlider(d, params[d.key]);
      token++; // süren hesabı iptal et
      markCurrent();
      $('#sc-status').textContent = 'Değişiklik bekleniyor…';
      schedule(450);
    });
  }
  $('#sl-reset').addEventListener('click', () => {
    Object.assign(params, def);
    for (const d of sliders) {
      $<HTMLInputElement>(`#sl-${d.key}`).value = String(def[d.key]);
      $(`#out-${d.key}`).textContent = fmtSlider(d, def[d.key]);
    }
    markCurrent();
    schedule(0);
  });
  $('#sc-window').addEventListener('change', () => schedule(0));
  const lossInput = () => $<HTMLInputElement>('#sl-earthLossPct');
  const syncLossEnabled = () => { lossInput().disabled = linkMode === 'ideal'; };
  $<HTMLSelectElement>('#sel-stations').addEventListener('change', (e) => { stationCount = Number((e.target as HTMLSelectElement).value); token++; schedule(0); });
  $<HTMLSelectElement>('#sel-mode').addEventListener('change', (e) => { linkMode = (e.target as HTMLSelectElement).value as LinkMode; syncLossEnabled(); token++; schedule(0); });
  syncLossEnabled();
  for (const id of ['#sw-loss-metric', '#sw-time-metric']) $(id).addEventListener('change', () => KEYS.forEach(drawSweep));

  return {
    async show() {
      if (built) return;
      built = true;
      try {
        if (!ChartCtor) ChartCtor = (await import('chart.js/auto')).Chart;
        renderAssumptions();
        renderDelay();
        if (usable.length === 0) { $('#sc-status').textContent = 'Veri aralığında uygun kavuşum penceresi yok.'; return; }
        await compute();
      } catch (e) {
        console.error(e);
        $('#sc-status').innerHTML = `<span class="bad">Çizelgeleyici paneli başlatılamadı: ${(e as Error).message}</span>`;
      }
    },
  };
}
