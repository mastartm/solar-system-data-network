import type { Chart, ChartConfiguration, Plugin } from 'chart.js';
import { HYPOTHETICAL, HYPOTHETICAL_LABEL } from '../config/hypothetical';
import type { Track } from '../data/types';
import { jdToDate, trackEndJD } from '../map/ephemeris';
import type { BlackoutWindow } from '../network/network';
import { simulate, type SimResult } from '../network/scheduler';
import { buildLinkTimeline, lightDelaySeries, schedConfig, schedTopology } from '../network/timeline';

const fmt = (n: number, d = 0) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (jd: number) => jdToDate(jd).toISOString().slice(0, 10);
const year = (jd: number) => 1970 + (jd - 2440587.5) / 365.2425;

// Seriler: FIFO = mavi, öncelikli = turuncu (koyu yüzeyde doğrulanmış kategorik slot 1-2). Metin rengi seri rengi değildir.
const C = { fifo: '#3987e5', prio: '#d95926', moon: '#cfcfcf', mars: '#d9593a', text: '#8a96b2', grid: '#1e2740', ink: '#e6ebf5' };

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

export interface SchedulerPanel { show(): void }

export function mountScheduler(root: HTMLElement, tracks: Record<string, Track>, windows: BlackoutWindow[], synthetic: boolean): SchedulerPanel {
  const sc = HYPOTHETICAL.scheduler;
  const cls = sc.classes;
  const scenarioCharts: Chart[] = [];
  let scenarioMode = false;
  let ChartCtor: typeof import('chart.js').Chart | null = null;
  let built = false;

  const pad = sc.scenarioPadDays;
  const usable = windows.filter((w) => w.startJD - pad.before >= tracks.earth.startJD && w.endJD + pad.after <= Math.min(trackEndJD(tracks.earth), trackEndJD(tracks.mars)));
  const opts = usable.map((w, i) => `<option value="${i}">${day(w.startJD)} – ${day(w.endJD)} (en küçük açı ${fmt(w.minSepDeg, 2)}°)</option>`).join('');

  root.innerHTML = `
    <div class="sched-wrap">
      <h2>Çizelgeleyici analizi <span class="badge-hyp">${HYPOTHETICAL_LABEL}</span></h2>
      <p class="warn">Bu sonuçlar <b>gerçek bir görev sonucu değildir</b>. Araçlar, veri hızları, paket boyutları, öncelik sınıfları ve tampon kapasiteleri uydurmadır (<code>src/config/hypothetical.ts</code>). Gerçek olan tek şey Horizons konumlarından gelen ışık gecikmeleri ve bağlantı geometrisidir.</p>
      ${synthetic ? '<p class="warn syn"><b>SENTETİK VERİ:</b> sayfa <code>?sentetik=1</code> ile açıldı; yörüngeler Horizons değil, uydurma dairesel yörüngelerdir. Gecikme ve kavuşum tarihleri gerçeği yansıtmaz.</p>' : ''}

      <section>
        <h3>(a) Tek yön ışık gecikmesi <small>(Dünya merkezi – cisim merkezi, Horizons konumları)</small></h3>
        <div class="charts two"><div class="chart"><canvas id="ch-moon" aria-label="Ay ışık gecikmesi"></canvas></div><div class="chart"><canvas id="ch-mars" aria-label="Mars ışık gecikmesi"></canvas></div></div>
        <p class="hint" id="delay-stats"></p>
      </section>

      <section>
        <h3>Senaryo <small>(Mars kavuşumu çevresi)</small></h3>
        <div class="row"><label>Kavuşum penceresi <select id="sc-window">${opts || '<option>Uygun pencere yok</option>'}</select></label><span class="legend" id="sc-status"></span></div>
        <p class="hint">Aynı bağlantı çizelgesi (ufuk, Dünya görüşü, kavuşum) iki çizelgeleyiciyle çalıştırılır: <b>FIFO</b> (geliş sırası) ve <b>öncelikli</b> (${cls.map((c) => c.name).join(' > ')}). Taşan tamponda FIFO yeni geleni atar; öncelikli, daha düşük sınıfın en yeni paketini atarak yer açar.</p>
      </section>

      <section>
        <h3>(b) FIFO ve öncelikli çizelgeleyici</h3>
        <div class="charts three">
          <div class="chart"><canvas id="ch-lat" aria-label="Teslim süresi"></canvas></div>
          <div class="chart"><canvas id="ch-fill" aria-label="Tampon doluluğu"></canvas></div>
          <div class="chart"><canvas id="ch-loss" aria-label="Kayıp"></canvas></div>
        </div>
        <p class="hint">Teslim süresi yalnızca <i>teslim edilenler</i> üzerinden hesaplanır: bir çizelgeleyici paketi düşürürse onun beklemesi ortalamaya girmez (hayatta kalma yanlılığı). Bu yüzden süreyi kayıp ve teslim sayısıyla birlikte okuyun.</p>
        <div id="stats-table"></div>
      </section>

      <section>
        <h3>(c) Kavuşum penceresinde Mars aktarma uydusu tamponu</h3>
        <div class="charts one"><div class="chart tall"><canvas id="ch-buf" aria-label="Tampon dolup boşalması"></canvas></div></div>
        <p class="hint">Gölgeli alan: Güneş–Mars açısı ${HYPOTHETICAL.conjunctionBlackoutAngleDeg}° eşiğinin altında (kesinti). Kesintide araç → uydu hattı açık kalır, uydu → Dünya hattı kapalıdır; uydu tamponu dolar, kesinti bitince boşalır. İki çizelgeleyici toplam doluluğu hemen hemen aynı doldurup boşalttığı için eğriler çoğunlukla üst üste biner (FIFO eğrisi öndedir); fark, tamponda <i>hangi</i> verinin kaldığında ve kayıp tablosundadır.</p>
      </section>

      <section>
        <h3>Varsayımsal değerler</h3>
        <div id="assumptions"></div>
        <p class="hint">Basitleştirmeler: iki atlama (araç → uydu → Dünya), her atlamada tek bağlantı hızı; yer istasyonu, kodlama, yeniden iletim ve hata yok; paketler "toplu veri parçası"dır; uydu tamponu doluyken araç göndermez (geri basınç) ve verisini kendi tamponunda tutar; simülasyon adımı ${sc.stepSec} sn, bu yüzden teslim süreleri en fazla bir adım kadar kaba.</p>
      </section>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

  const addChart = (id: string, cfg: ChartConfiguration | Record<string, unknown>) => {
    const ch = new ChartCtor!($<HTMLCanvasElement>(id), cfg as ChartConfiguration);
    if (scenarioMode) scenarioCharts.push(ch);
    return ch;
  };

  function renderAssumptions() {
    const row = (a: string, b: string) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    $('#assumptions').innerHTML = `<table class="stats"><tbody>
      ${cls.map((c) => row(`Sınıf: ${c.name}`, `öncelik ${c.priority} · pay %${fmt(c.share * 100)} · paket ${fmt(c.packetMb, 1)} Mb`)).join('')}
      ${row('Ortalama üretim', `veri hızının %${fmt(sc.dutyCycle * 100)}'i (${HYPOTHETICAL.assets.map((a) => `${a.name}: ${fmt(a.dataRateKbps * sc.dutyCycle, 1)} kbit/sn`).join(' · ')})`)}
      ${row('Araç → uydu hızı', `Ay ${fmt(sc.surfaceLinkKbps.moon)} · Mars ${fmt(sc.surfaceLinkKbps.mars)} kbit/sn (araç başına)`)}
      ${row('Uydu → Dünya hızı', HYPOTHETICAL.relays.map((r) => `${r.name}: ${fmt(sc.relayDownlinkKbps[r.id])} kbit/sn`).join(' · '))}
      ${row('Araç tamponu', `Ay ${fmt(sc.assetBufferMb.moon)} Mb · Mars ${fmt(sc.assetBufferMb.mars)} Mb`)}
      ${row('Uydu tamponu', HYPOTHETICAL.relays.map((r) => `${r.name}: ${fmt(sc.relayBufferMb[r.id])} Mb`).join(' · '))}
      ${row('"Gecikmeli" eşiği', `kuyrukta ${fmt(sc.delayedAfterSec / 60)} dk'dan uzun bekleme`)}
      ${row('Senaryo aralığı', `kavuşumdan ${sc.scenarioPadDays.before} gün önce – ${sc.scenarioPadDays.after} gün sonra`)}
    </tbody></table>`;
  }

  function renderDelay() {
    const moon = lightDelaySeries(tracks, 'moon', 1);
    const mars = lightDelaySeries(tracks, 'mars', 5);
    const mk = (id: string, pts: { jd: number; sec: number }[], scale: number, label: string, ytitle: string, color: string) =>
      addChart(id, {
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

  function tableHtml(fifo: SimResult, prio: SimResult) {
    const h = (s: number) => (s < 7200 ? `${fmt(s / 60, 1)} dk` : `${fmt(s / 3600, 1)} sa`);
    const rows = (r: SimResult, name: string) =>
      [...cls.map((c) => [c.name, r.perClass[c.id]] as const), ['Toplam', r.total] as const]
        .map(([n, s]) => `<tr><td>${name}</td><td>${n}</td><td>${fmt(s.generated)}</td><td>${fmt(s.delivered)}</td><td>${fmt(s.stored)}</td><td>${fmt(s.delayed)}</td><td class="${s.dropped ? 'bad' : ''}">${fmt(s.dropped)}</td><td>${fmt(s.remaining)}</td><td>${s.delivered ? h(s.latencyMeanSec) : '—'}</td><td>${s.delivered ? h(s.latencyP95Sec) : '—'}</td></tr>`)
        .join('');
    return `<table class="stats"><thead><tr><th>Çizelgeleyici</th><th>Sınıf</th><th>Üretilen</th><th>Teslim</th><th>Tamponlanan</th><th>Gecikmeli</th><th>Düşen</th><th>Tamponda kalan</th><th>Ort. süre</th><th>%95 süre</th></tr></thead><tbody>${rows(fifo, 'FIFO')}${rows(prio, 'Öncelikli')}</tbody></table>
      <p class="hint">Paket sayıları. <b>Tamponlanan</b>: teslim edilmeden önce bir adımdan uzun tamponda bekleyen. <b>Gecikmeli</b>: kuyrukta ${fmt(sc.delayedAfterSec / 60)} dk'dan uzun bekleyip teslim edilen. <b>Düşen</b>: tampon taşması. Üretilen = teslim + düşen + tamponda kalan.</p>`;
  }

  function compute() {
    const status = $('#sc-status');
    const sel = $<HTMLSelectElement>('#sc-window');
    const w = usable[Number(sel.value)];
    if (!w) { status.textContent = 'Veri aralığında uygun kavuşum penceresi yok.'; return; }
    status.textContent = 'Hesaplanıyor…';
    setTimeout(() => {
      const t0 = performance.now();
      const startJD = w.startJD - pad.before;
      const endJD = w.endJD + pad.after;
      const topo = schedTopology();
      const cfg = schedConfig();
      const samples = buildLinkTimeline(tracks, startJD, endJD, cfg.stepSec, topo);
      const fifo = simulate(topo, samples, 'fifo', cfg);
      const prio = simulate(topo, samples, 'priority', cfg);
      draw(w, startJD, fifo, prio);
      status.textContent = `${fmt(samples.length)} adım × 2 çizelgeleyici, ${fmt(performance.now() - t0)} ms`;
    }, 20);
  }

  function draw(w: BlackoutWindow, startJD: number, fifo: SimResult, prio: SimResult) {
    for (const c of scenarioCharts.splice(0)) c.destroy();
    scenarioMode = true;

    const pair = (a: number[], b: number[]) => [
      { label: 'FIFO', data: a, backgroundColor: C.fifo, borderRadius: 4 },
      { label: 'Öncelikli', data: b, backgroundColor: C.prio, borderRadius: 4 },
    ];
    const barOpts = (y: string) => baseOpts('', y, { plugins: { legend: { labels: { color: C.ink, boxWidth: 12 } } } });
    const names = cls.map((c) => c.name);

    addChart('#ch-lat', {
      type: 'bar',
      data: { labels: names, datasets: pair(cls.map((c) => fifo.perClass[c.id].latencyP95Sec / 3600), cls.map((c) => prio.perClass[c.id].latencyP95Sec / 3600)) },
      options: { ...barOpts('Teslim süresi, %95 (saat)'), plugins: { title: { display: true, text: 'Teslim süresi (teslim edilenler)', color: C.ink }, legend: { labels: { color: C.ink, boxWidth: 12 } } } },
    });

    const nodes = [...HYPOTHETICAL.relays.map((r) => ({ n: r.name.replace(' Uydusu', ''), f: fifo.peakRelayFill[r.id], p: prio.peakRelayFill[r.id] })),
      ...HYPOTHETICAL.assets.map((a) => ({ n: a.name, f: fifo.peakAssetFill[a.id], p: prio.peakAssetFill[a.id] }))];
    addChart('#ch-fill', {
      type: 'bar',
      data: { labels: nodes.map((x) => x.n), datasets: pair(nodes.map((x) => x.f * 100), nodes.map((x) => x.p * 100)) },
      options: { ...barOpts('En yüksek doluluk (%)'), scales: { ...barOpts('').scales, y: { ...barOpts('').scales.y, max: 100, title: { display: true, text: 'En yüksek doluluk (%)', color: C.text } } }, plugins: { title: { display: true, text: 'Tampon doluluğu (tepe)', color: C.ink }, legend: { labels: { color: C.ink, boxWidth: 12 } } } },
    });

    addChart('#ch-loss', {
      type: 'bar',
      data: { labels: names, datasets: pair(cls.map((c) => fifo.perClass[c.id].dropped), cls.map((c) => prio.perClass[c.id].dropped)) },
      options: { ...barOpts('Düşen paket'), plugins: { title: { display: true, text: 'Kayıp (taşan tampon)', color: C.ink }, legend: { labels: { color: C.ink, boxWidth: 12 } } } },
    });

    $('#stats-table').innerHTML = tableHtml(fifo, prio);

    // (c) Mars aktarma uydusu tampon doluluğu
    const ri = schedTopology().relays.indexOf('mars-aktarma');
    const toPts = (r: SimResult) => r.series.map((s) => ({ x: s.tSec / 86400, y: s.relayFill[ri] * 100 }));
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
    addChart('#ch-buf', {
      type: 'line',
      data: { datasets: [
        { label: 'FIFO', data: toPts(fifo), borderColor: C.fifo, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Öncelikli', data: toPts(prio), borderColor: C.prio, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, borderDash: [6, 3] },
      ] },
      options: baseOpts(`Gün (${day(startJD)} başlangıç)`, 'Uydu tamponu doluluğu (%)', {
        parsing: false,
        scales: { x: { type: 'linear', title: { display: true, text: `Gün (0 = ${day(startJD)})`, color: C.text }, ticks: { color: C.text }, grid: { color: C.grid } },
          y: { title: { display: true, text: 'Uydu tamponu doluluğu (%)', color: C.text }, ticks: { color: C.text }, grid: { color: C.grid }, min: 0, max: 100 } },
      }),
      plugins: [shade],
    });
  }

  $('#sc-window').addEventListener('change', compute);

  return {
    async show() {
      if (built) return;
      built = true;
      if (!ChartCtor) ChartCtor = (await import('chart.js/auto')).Chart;
      renderAssumptions();
      renderDelay();
      if (usable.length === 0) { $('#sc-status').textContent = 'Veri aralığında uygun kavuşum penceresi yok.'; return; }
      compute();
    },
  };
}
