// Çizelgeleyici sekmesinin Aşama 9 bölümleri: (i) değer ağırlıklı fayda, (j) iyimser varsayımların etkisi, (k) yörünge / ikinci uydu / Mars gölgesi,
// (l) genelleme. Tüm sayılar VARSAYIMSALDIR (src/config/hypothetical.ts); sonuçlar gerçek bir görev sonucu değildir. Uzun hesaplar Web Worker havuzunda çalışır.
import type { Chart } from 'chart.js';
import { HYPOTHETICAL } from '../config/hypothetical';
import { dateToJd } from '../map/ephemeris';
import type { BlackoutWindow, NetOptions } from '../network/network';
import type { CoverageRow } from '../network/coverage';
import type { Req, SimOut, TlSpec } from '../network/compute';
import type { ForecastError, Policy, ProjectionOptions, SchedConfig } from '../network/scheduler';
import { valuePct, type Metrics } from '../network/sweep';
import type { LinkMode, SweepParams } from '../network/timeline';
import { NAME, day, fmt, signed, valueModel, valueModelLabel, valueOpts, type Scen } from './schedShared';

export interface Current { s: Scen | null; stations: number; mode: LinkMode; rollingDays: number; projection: ProjectionOptions }

export interface ExtrasCtx {
  $: <T extends HTMLElement = HTMLElement>(sel: string) => T;
  addChart: (list: Chart[], id: string, cfg: Record<string, unknown>) => Chart;
  call: <T>(req: Req) => Promise<T>;
  cur: () => Current;
  /** Seçili hat, ağ seçenekleri, ayarlar (kaydırıcılar, hat modu, kayan ufuk, projeksiyon) ile bir çizelgeleyici ayarı kurar. over: kaydırıcı değerlerini ya da projeksiyonu geçersiz kılar. */
  cfgFor: (relayId: string, net: NetOptions, over?: { params?: Partial<SweepParams>; projection?: ProjectionOptions; step?: number; forecast?: ForecastError; rollingDays?: number; mode?: LinkMode }) => SchedConfig;
  /** Kavuşum pencereleri (Mars genellemesi). */
  windows: BlackoutWindow[];
  /** Kayan ufuklu / uyarlamalı çalıştırma için pencere düzeni: öncesi/sonrası gün. */
  pad: { before: number; after: number };
  dataEnd: number;
}

const cell = (m: Metrics) => `${fmt(m.dropPct + m.abandonedPct, 1)} / ${fmt(m.lossPct, 1)} / ${fmt(m.deliveredPct, 1)} [${fmt((100 * m.suppressedMb) / (m.demandMb || 1), 1)}]`;
const dropOf = (m: Metrics) => m.dropPct + m.abandonedPct;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mmm = (v: number[], d = 1) => `${fmt(Math.min(...v), d)} / ${fmt(median(v), d)} / ${fmt(Math.max(...v), d)}`;
const table = (head: string[], rows: string[][], cls = 'stats cmp') =>
  `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const gainCell = (g: number) => `<span class="${g > 0.05 ? 'ok' : g < -0.05 ? 'bad' : ''}">${signed(g, 2)}</span>`;

export function mountExtras(ctx: ExtrasCtx) {
  const { $ } = ctx;
  const charts: Chart[] = [];
  let tok = 0;
  const reset = () => { tok++; for (const c of charts.splice(0)) c.destroy(); for (const id of ['#pj-body', '#ob-body', '#gn-body']) $(id).innerHTML = ''; for (const id of ['#pj-status', '#ob-status', '#gn-status']) $(id).textContent = ''; };

  const sim = (tl: TlSpec, policy: Policy, cfg: SchedConfig) => ctx.call<SimOut>({ op: 'sim', tl, policy, cfg }).then((o) => o.metrics);
  const spec = (s: Pick<Scen, 'startJD' | 'endJD' | 'relayId'>, step: number, n: number, net: NetOptions): TlSpec => ({ startJD: s.startJD, endJD: s.endJD, stepSec: step, stations: n, relayId: s.relayId, ...(Object.keys(net).length ? { net } : {}) });
  const stationLabel = (n: number) => (n === 0 ? 'istasyon modeli kapalı' : `${n} istasyon`);

  // ------------------------------------------------------------------------------------------------------------------ (i) Değer
  let lastValue: { s: Scen; met: Partial<Record<Policy, Metrics>>; rows: { n: number; open: number; m: Record<Policy, Metrics> }[] | null } | null = null;
  const hls = HYPOTHETICAL.value.decayOptionsDays;

  function fillValueControls() {
    $<HTMLSelectElement>('#v-tw').innerHTML = HYPOTHETICAL.value.telemetryWeightScan.map((w) => `<option value="${w}"${w === valueModel.telemetryWeight ? ' selected' : ''}>${fmt(w)}× bilim verisi</option>`).join('');
    $<HTMLSelectElement>('#v-hl').innerHTML = `<option value="">sabit değer</option>${hls.map((d, i) => `<option value="${i}"${i === valueModel.halfLifeIdx ? ' selected' : ''}>yarı ömür ${fmt(d)} gün</option>`).join('')}`;
  }

  function renderValue() {
    if (!lastValue) return;
    const { s, met, rows } = lastValue;
    const pols = s.policies.filter((p) => met[p]);
    const vo = valueOpts();
    const flat = { weightOf: vo.weightOf };
    const pr = met.priority!;
    const gridPol = $<HTMLSelectElement>('#v-pol').value as Policy;
    $('#v-def').innerHTML = `<b>Seçili model:</b> ${valueModelLabel()}. Değer % = teslim edilen değer / talep edilen değer (talep = üretilen + üretilmeyen, yaşı 0). Zamanla azalan değerde teslim edilen paketin değeri 2<sup>−yaş/yarı ömür</sup> ile çarpılır (yaş = teslim anı − üretim anı); telemetri azalmaz. <b>Ağırlıklar uydurmadır</b>, gerçek bir bilimsel değeri temsil etmez; sonucun onlara duyarlılığı aşağıda taranır.`;
    $('#v-table').innerHTML = table(
      ['Çizelgeleyici', 'Teslim % (hacim)', 'Değer % (sabit)', 'Değer % (seçili model)', 'Kazanç: sabit (puan, öncelikliye göre)', 'Kazanç: seçili model (puan)', 'Düşen + hatta kayıp %', 'Üretilmeyen %'],
      pols.map((p) => {
        const m = met[p]!;
        return [NAME[p], fmt(m.deliveredPct, 1), fmt(valuePct(m, flat), 1), `<b>${fmt(valuePct(m, vo), 1)}</b>`, p === 'priority' ? '—' : gainCell(valuePct(m, flat) - valuePct(pr, flat)), p === 'priority' ? '—' : gainCell(valuePct(m, vo) - valuePct(pr, vo)), fmt(dropOf(m), 1), fmt((100 * m.suppressedMb) / (m.demandMb || 1), 1)];
      }),
    );
    // İstasyon sayısına göre (d) bölümündeki hesaplardan; ek hesap yok
    $('#v-st').innerHTML = rows
      ? `<h4>İstasyon sayısına göre (seçili model)</h4>` + table(
        ['İstasyon', 'Hat açık %', 'Çizelgeleyici', 'Teslim %', 'Değer %', 'Kazanç (puan, öncelikliye göre)'],
        rows.flatMap((r) => pols.filter((p) => r.m[p]).map((p, i) => [i === 0 ? String(r.n) : '', i === 0 ? fmt(r.open * 100, 1) : '', NAME[p], fmt(r.m[p].deliveredPct, 1), fmt(valuePct(r.m[p], vo), 1), p === 'priority' ? '—' : gainCell(valuePct(r.m[p], vo) - valuePct(r.m.priority, vo))])),
      )
      : '';
    // Duyarlılık ızgarası: telemetri ağırlığı × yarı ömür, seçili politika (öncelikliye göre kazanç); ek hesap yok (ham toplamlar her çalıştırmada var)
    const m = met[gridPol];
    if (m && gridPol !== 'priority') {
      const tws = HYPOTHETICAL.value.telemetryWeightScan;
      const gain = (tw: number, hi: number | undefined) => { const o = { weightOf: (p: { decays: boolean; weight: number }) => (p.decays ? p.weight : tw), halfLifeIdx: hi }; return valuePct(m, o) - valuePct(pr, o); };
      const body = [undefined, ...hls.map((_, i) => i)].map((hi) => [hi === undefined ? 'sabit değer' : `yarı ömür ${fmt(hls[hi])} gün`, ...tws.map((tw) => { return gainCell(gain(tw, hi)); })]);
      $('#v-grid').innerHTML = `<h4>Değer yapısına duyarlılık: ${NAME[gridPol]} − öncelikli (puan)</h4>` + table(['Bilim verisi değeri', ...tws.map((w) => `telemetri ${fmt(w)}×`)], body)
        + `<p class="hint">Hücre = ${NAME[gridPol]} değer % − öncelikli değer %. Yeşil: kısma değerce <b>kazandırıyor</b>; kırmızı: <b>kaybettiriyor</b>. Seçili senaryo: ${s.relayName} hattı, ${stationLabel(lastStations())}.</p>`;
      const flatG = tws.map((tw) => gain(tw, undefined)), decG = hls.flatMap((_, hi) => tws.map((tw) => gain(tw, hi)));
      const best = Math.max(...decG), worst = Math.min(...decG);
      $('#v-verdict').innerHTML = `<b>Okuma (${NAME[gridPol]}, seçili senaryo):</b> sabit değerde kazanç ${fmt(Math.min(...flatG), 2)} … ${fmt(Math.max(...flatG), 2)} puan (${Math.max(...flatG) > 0.05 ? 'kayda değer bir kazanç var' : 'telemetri ağırlığı ne olursa olsun fayda yok: hat kapasitesi sınırlayıcı, kısma hacmi artırmaz, yalnızca neyin kaybolduğunu değiştirir'}). Zamanla azalan değerde kazanç ${fmt(worst, 2)} … ${fmt(best, 2)} puan: ${best > 0.05 ? `kısma, birikmiş eski veriyi azaltıp yeni veriyi öne aldığı için ${worst < -0.05 ? 'yarı ömür kısa/orta iken kazandırır, yeterince uzun yarı ömürde (değer neredeyse hiç azalmazken) tekrar kaybettirir' : 'tüm taranan yapılarda kazandırır'}; kazanç küçüktür (en çok ${fmt(best, 1)} puan).` : 'bu senaryoda da fayda yok.'}`;
    } else { $('#v-grid').innerHTML = ''; $('#v-verdict').innerHTML = '<span class="hint">Izgara için “öncelikli” dışında bir politika seçin.</span>'; }
  }
  let stationsNow = 3;
  const lastStations = () => stationsNow;

  function setValueInputs(s: Scen, met: Partial<Record<Policy, Metrics>>, stations: number) {
    stationsNow = stations;
    const rows = lastValue && lastValue.s.key === s.key ? lastValue.rows : null;
    lastValue = { s, met, rows };
    const sel = $<HTMLSelectElement>('#v-pol');
    const keep = sel.value;
    sel.innerHTML = s.policies.filter((p) => p !== 'priority').map((p) => `<option value="${p}">${NAME[p]}</option>`).join('');
    sel.value = s.policies.includes(keep as Policy) && keep !== 'priority' ? keep : s.policies.includes('adaptive') ? 'adaptive' : s.policies[s.policies.length - 1];
    renderValue();
  }
  function setValueStations(s: Scen, rows: { n: number; open: number; m: Record<Policy, Metrics> }[]) {
    if (lastValue && lastValue.s.key === s.key) { lastValue.rows = rows; renderValue(); }
  }
  fillValueControls();
  $('#v-tw').addEventListener('change', (e) => { valueModel.telemetryWeight = Number((e.target as HTMLSelectElement).value); ctx.$('#v-tw').dispatchEvent(new Event('value-model')); renderValue(); });
  $('#v-hl').addEventListener('change', (e) => { const v = (e.target as HTMLSelectElement).value; valueModel.halfLifeIdx = v === '' ? undefined : Number(v); ctx.$('#v-tw').dispatchEvent(new Event('value-model')); renderValue(); });
  $('#v-pol').addEventListener('change', renderValue);

  // ------------------------------------------------------------------------------------------------------------------ (j) İyimser varsayımların etkisi
  const PJ_OPTS: [string, ProjectionOptions][] = [['varsayılan (Aşama 8)', {}], ['yüzey hattı kapalılığı', { surfaceClosure: true }], ['ARQ kopyası RTT tamponda', { arqHold: true }], ['ikisi birden', { surfaceClosure: true, arqHold: true }]];
  async function runProjection() {
    const c = ctx.cur(), s = c.s;
    if (!s) return;
    const my = ++tok;
    const st = $('#pj-status'), body = $('#pj-body');
    body.innerHTML = '';
    const pols: Policy[] = s.blackout ? ['coverage', 'rolling', 'adaptive'] : ['rolling', 'adaptive'];
    const stationsList = [1, 2, 3];
    const total = stationsList.length * (1 + pols.length * PJ_OPTS.length);
    let done = 0;
    const prog = () => { st.textContent = `Hesaplanıyor… ${done}/${total}`; };
    prog();
    const step = HYPOTHETICAL.scheduler.stepSec;
    const run = async (n: number, p: Policy, projection: ProjectionOptions) => { const m = await sim(spec(s, step, n, s.net), p, { ...ctx.cfgFor(s.relayId, s.net, { projection, step }), valueHalfLivesSec: [] }); done++; prog(); return m; };
    const res = await Promise.all(stationsList.map(async (n) => ({
      n,
      prio: await run(n, 'priority', {}),
      by: Object.fromEntries(await Promise.all(pols.map(async (p) => [p, await Promise.all(PJ_OPTS.map(([, o]) => run(n, p, o)))]))) as Record<string, Metrics[]>,
    })));
    if (my !== tok) return;
    st.textContent = `Tamam (${fmt(step)} sn adım, ${s.relayName} hattı, ${LINK_LABEL(c.mode)}).`;
    let maxD = 0;
    const parts = pols.map((p) => {
      const rows = res.map((r) => [String(r.n), ...r.by[p].map((m, j) => {
        const b = r.by[p][0];
        const d = Math.max(Math.abs(dropOf(m) - dropOf(b)), Math.abs(m.lossPct - b.lossPct), Math.abs(m.deliveredPct - b.deliveredPct), Math.abs((m.suppressedMb - b.suppressedMb) / (m.demandMb || 1)) * 100);
        if (j > 0) maxD = Math.max(maxD, d);
        return cell(m);
      }), cell(r.prio)]);
      return `<h4>${NAME[p]}</h4>` + table(['İstasyon', ...PJ_OPTS.map(([n]) => n), 'öncelikli (referans)'], rows);
    });
    body.innerHTML = parts.join('') + `<p class="hint"><b>Okuma:</b> hücre = düşen + hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]. Varsayılana göre en büyük mutlak fark (düşen, toplam kayıp, teslim, üretilmeyen; tüm hücreler): <b>${fmt(maxD, 3)} puan</b> — ${maxD < 0.1 ? '<b>etki yok</b> (0,1 puanın altında; Aşama 7–8 sonuçları bu iki iyimser varsayımdan etkilenmiyor)' : 'etki <b>var</b> (0,1 puan üzerinde)'}. Neden: tepe doluluk, kapalı dönemin sonunda (veri birikmişken) belirlenir; yüzey hattı (araç → uydu) hızı üretimden çok yüksektir ve sık açılır, ARQ kopyaları ise kapalı dönem sonunda çoktan bırakılmıştır (RTT ≪ kapalı dönem).</p>`;
  }
  const LINK_LABEL = (m: LinkMode) => ({ ideal: 'kayıpsız hat', loss: 'hatalı hat, yeniden iletimsiz', arq: 'hatalı hat + yeniden iletim', burst: 'kümelenmiş hata + yeniden iletim' })[m];

  // ------------------------------------------------------------------------------------------------------------------ (k) Yörünge / ikinci uydu / Mars gölgesi
  interface OrbCfg { name: string; net: NetOptions; control?: boolean }
  const moonCfgs = (polar: boolean): OrbCfg[] => {
    const p = polar ? { moonPolarAsset: true } : {};
    return [
      { name: 'ekvatoral dairesel (mevcut)', net: { ...p } },
      { name: 'eğimli/eliptik (kutupsal, apolün güneyde)', net: { ...p, moonOrbit: 'elliptical' } },
      { name: 'ekvatoral + 2. uydu (en iyi görünen)', net: { ...p, moonSecond: 'best' } },
      { name: 'ekvatoral + 2. uydu (hat sırası)', net: { ...p, moonSecond: 'order' } },
      { name: 'eliptik + 2. uydu (en iyi görünen)', net: { ...p, moonOrbit: 'elliptical', moonSecond: 'best' } },
      { name: 'eliptik + 2. uydu (hat sırası)', net: { ...p, moonOrbit: 'elliptical', moonSecond: 'order' } },
      { name: '(kontrol) tek ekvatoral uydu, hat hızı ve tampon 2×', net: { ...p }, control: true },
    ];
  };
  const marsCfgs: OrbCfg[] = [
    { name: 'gölge yok (mevcut)', net: {} },
    { name: 'gölgede yalnız Dünya hattı kapalı', net: { marsEclipse: 'earth' } },
    { name: 'gölgede yüzey + Dünya hattı kapalı', net: { marsEclipse: 'both' } },
  ];
  async function runOrbit() {
    const c = ctx.cur(), s = c.s;
    if (!s) return;
    const my = ++tok;
    const st = $('#ob-status'), body = $('#ob-body');
    body.innerHTML = '';
    const moon = s.kind === 'moon';
    const cfgs = moon ? moonCfgs(!!s.net.moonPolarAsset) : marsCfgs.map((x) => ({ ...x, net: { ...x.net } }));
    const pols: Policy[] = moon ? ['priority', 'rolling', 'adaptive'] : s.blackout ? ['priority', 'coverage', 'rolling', 'adaptive'] : ['priority', 'rolling', 'adaptive'];
    const stationsList = [1, 2, 3];
    const step = HYPOTHETICAL.scheduler.stepSec;
    const total = stationsList.length * cfgs.length * (pols.length + 1);
    let done = 0;
    const prog = () => { st.textContent = `Hesaplanıyor… ${done}/${total}`; };
    prog();
    const p0 = ctx.cfgFor(s.relayId, {}).relayBufferMb[s.relayId];
    const dl0 = ctx.cfgFor(s.relayId, {}).relayDownlinkKbps[s.relayId];
    const out = await Promise.all(stationsList.map(async (n) => Promise.all(cfgs.map(async (oc) => {
      const net = oc.net;
      const cov = oc.control ? null : await ctx.call<CoverageRow>({ op: 'coverage', startJD: s.startJD, endJD: s.endJD, n, net }); done++; prog();
      const cfg = { ...ctx.cfgFor(s.relayId, net, { step, ...(oc.control ? { params: { relayBufferMb: 2 * p0, relayDownlinkKbps: 2 * dl0 } } : {}) }), valueHalfLivesSec: [] };
      const ms = await Promise.all(pols.map(async (p) => { const m = await sim(spec(s, step, n, net), p, cfg); done++; prog(); return m; }));
      return { oc, cov, ms };
    }))));
    if (my !== tok) return;
    st.textContent = `Tamam (${fmt(step)} sn adım, ${s.relayName} hattı, ${LINK_LABEL(c.mode)}).`;
    const assetsOf = (cov: CoverageRow) => Object.keys(cov.surf).filter((a) => (moon ? a.startsWith('ay-') : a.startsWith('mars-')));
    const relOf = (cov: CoverageRow) => Object.keys(cov.up).filter((r) => (moon ? r.startsWith('ay-') : r.startsWith('mars-')));
    body.innerHTML = out.map((rowsN, ni) => {
      const n = stationsList[ni];
      const rows = rowsN.map(({ oc, cov, ms }) => {
        const pc = (v: number) => (cov ? fmt((100 * v) / cov.steps, 1) : '—');
        const rel = cov ? relOf(cov) : [];
        return [oc.name,
          cov ? rel.map((r) => pc(cov.see[r])).join(' / ') : '—',
          cov ? `${rel.map((r) => pc(cov.up[r])).join(' / ')}${rel.length > 1 ? ' / ' + pc(cov.anyUp) : ''}` : '—',
          cov ? assetsOf(cov).map((a) => pc(cov.surf[a])).join(' / ') : '—',
          cov ? assetsOf(cov).map((a) => pc(cov.pathUp[a])).join(' / ') : '—',
          ...ms.map(cell)];
      });
      return `<h4>${n} istasyon</h4>` + table(['Yapılandırma', 'uyduyu gören ist. %', rowsN[0].cov && relOf(rowsN[0].cov).length > 0 ? 'Dünya hattı açık % (uydu başına' + (moon ? ' / herhangi' : '') + ')' : 'Dünya hattı açık %', 'yüzey görüşü % (araç başına)', 'araç → Dünya yolu açık %', ...pols.map((p) => NAME[p])], rows);
    }).join('') + (moon
      ? `<p class="hint"><b>Okuma:</b> hücre = düşen + hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]. Uydu sırası: birinci / ikinci uydu; araçlar: ${HYPOTHETICAL.assets.filter((a) => a.body === 'moon').map((a) => a.name).join(', ')}${s.net.moonPolarAsset ? `, ${HYPOTHETICAL.moonPolarAsset.name}` : ''}. “Kontrol” satırı, ikinci uydunun faydasının <i>kapsamadan mı kapasiteden mi</i> geldiğini ayırır: tek uydunun hat hızı ve tamponu iki katı. Yörünge elemanları ve ikinci uydunun kapasitesi uydurmadır; düzlem eylemsiz sabit (presesyon yok).</p>`
      : `<p class="hint"><b>Okuma:</b> hücre = düşen + hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]. Silindirik gölge, güç modeli yok. Kavuşum penceresinde Dünya ile Güneş Mars'tan neredeyse aynı yönde göründüğü için gölgenin büyük bölümü zaten “Mars'ın arkasında” kapanmasıyla örtüşür: etki küçüktür. Kavuşumdan uzak bir aralık için “Hat” seçicisinden <i>Mars aktarma hattı (tarih aralığı, kavuşumsuz)</i> seçin.</p>`);
  }

  // ------------------------------------------------------------------------------------------------------------------ (l) Genelleme
  async function runGeneral() {
    const c = ctx.cur(), s = c.s;
    if (!s) return;
    const my = ++tok;
    const st = $('#gn-status'), body = $('#gn-body');
    body.innerHTML = '';
    const moonLike = s.kind === 'moon';
    const cases: { label: string; startJD: number; endJD: number }[] = moonLike
      ? HYPOTHETICAL.generalization.moonStarts.map((iso) => { const j = dateToJd(new Date(iso + 'T00:00:00Z')); return { label: iso, startJD: j, endJD: Math.min(j + HYPOTHETICAL.generalization.moonDays, ctx.dataEnd) }; })
      : ctx.windows.filter((w) => w.startJD - ctx.pad.before >= 0).map((w) => ({ label: day(w.startJD), startJD: w.startJD - ctx.pad.before, endJD: w.endJD + ctx.pad.after }));
    // Aşama 8 ile aynı ölçek: Ay 300 sn / kayan ufuk 3 gün; Mars 1800 sn / kayan ufuk 30 gün
    const step = moonLike ? HYPOTHETICAL.scheduler.stepSec : HYPOTHETICAL.sensitivity.sweepStepSec;
    const errStep = HYPOTHETICAL.forecastScan.stepSec;
    const rd = moonLike ? c.rollingDays : 30;
    const pols: Policy[] = moonLike ? ['fifo', 'priority', 'rolling', 'adaptive'] : ['priority', 'strategy', 'coverage', 'rolling', 'adaptive'];
    const errPols: Policy[] = moonLike ? ['rolling', 'adaptive'] : ['coverage', 'rolling', 'adaptive'];
    const errs = [-240, -120, 120, 240];
    const n = c.stations;
    const total = cases.length * (pols.length + 1 + 1 + errPols.length * (1 + errs.length));
    let done = 0;
    const prog = () => { st.textContent = `Hesaplanıyor… ${done}/${total}`; };
    prog();
    const mk = (cs: { startJD: number; endJD: number }, stepSec: number, p: Policy, forecast?: ForecastError) => {
      const sc = { ...cs, relayId: s.relayId };
      const cfg = { ...ctx.cfgFor(s.relayId, s.net, { step: stepSec, rollingDays: rd }), ...(forecast ? { forecast } : {}) };
      return sim(spec(sc, stepSec, n, s.net), p, cfg).then((m) => { done++; prog(); return m; });
    };
    const res = await Promise.all(cases.map(async (cs) => {
      const [mArr, info, e0, errArr] = await Promise.all([
        Promise.all(pols.map((p) => mk(cs, step, p))),
        ctx.call<import('../network/compute').TlInfo>({ op: 'tlInfo', tl: spec({ ...cs, relayId: s.relayId }, step, n, s.net) }).then((i) => { done++; prog(); return i; }),
        mk(cs, errStep, 'priority'), // öncelikli referans, tarama adımında
        Promise.all(errPols.map((p) => Promise.all([mk(cs, errStep, p), ...errs.map((v) => mk(cs, errStep, p, { edgeShiftSec: v * 60 }))]))),
      ]);
      const m = Object.fromEntries(pols.map((p, i) => [p, mArr[i]])) as Record<Policy, Metrics>;
      const err = Object.fromEntries(errPols.map((p, i) => [p, errArr[i]])) as Record<string, Metrics[]>;
      return { cs, m, open: info.openFracAny, e0, err };
    }));
    if (my !== tok) return;
    st.textContent = `Tamam (${cases.length} ${moonLike ? 'tarih aralığı' : 'kavuşum penceresi'}, ${s.relayName} hattı, ${stationLabel(n)}, ${LINK_LABEL(c.mode)}).`;
    const hl = hls.indexOf(HYPOTHETICAL.value.decayHalfLifeDays);
    const vo = valueOpts();
    const rows = res.map((r) => [r.cs.label, fmt(r.open * 100, 1), ...pols.map((p) => cell(r.m[p])), `${fmt(valuePct(r.m.priority, vo), 1)} → ${fmt(valuePct(r.m.adaptive, vo), 1)} / ${fmt(valuePct(r.m.priority, { ...vo, halfLifeIdx: hl }), 1)} → ${fmt(valuePct(r.m.adaptive, { ...vo, halfLifeIdx: hl }), 1)}`]);
    const diff = (p: Policy, f: (m: Metrics) => number) => res.map((r) => f(r.m[p]) - f(r.m.priority));
    const dm = (p: Policy, f: (m: Metrics) => number, d = 2) => mmm(diff(p, f), d);
    const summary = pols.filter((p) => p !== 'priority' && p !== 'fifo').map((p) => `<tr><td>${NAME[p]}</td><td>${dm(p, dropOf)}</td><td>${dm(p, (m) => m.lossPct)}</td><td>${dm(p, (m) => m.deliveredPct)}</td><td>${dm(p, (m) => valuePct(m, { weightOf: valueOpts().weightOf }))}</td><td>${dm(p, (m) => valuePct(m, { ...vo, halfLifeIdx: hl }))}</td></tr>`).join('');
    const errRows = res.flatMap((r) => errPols.map((p, i) => {
      const e = r.err[p];
      return [i === 0 ? r.cs.label : '', i === 0 ? cell(r.e0) : '', NAME[p], cell(e[0]), cell(e[1]), cell(e[2]), cell(e[3]), cell(e[4])];
    }));
    // en kötü toplam kayıp farkı (öncelikliye göre), |hata| ≤ 120 dk
    // err[p] = [hata yok, −240, −120, +120, +240]; |hata| ≤ 120 dk içindeki en kötü toplam kayıp farkı ve ayrıca −240 dk
    const worst = errPols.map((p) => `${NAME[p]}: ${mmm(res.map((r) => Math.max(...[r.err[p][0], r.err[p][2], r.err[p][3]].map((m) => m.lossPct - r.e0.lossPct))), 2)} (−240 dk: ${mmm(res.map((r) => r.err[p][1].lossPct - r.e0.lossPct), 2)})`);
    const dropWorse = errPols.map((p) => `${NAME[p]}: ${res.filter((r) => r.err[p].some((m) => dropOf(m) - dropOf(r.e0) > 0.1)).length}/${res.length}`);
    body.innerHTML = `<h4>Hata yokken karşılaştırma (${moonLike ? 'her tarih aralığı' : 'her kavuşum penceresi'})</h4>`
      + table([moonLike ? 'Başlangıç' : 'Pencere', 'Hat açık %', ...pols.map((p) => NAME[p]), 'Değer %: öncelikli → uyarlamalı (seçili model / 14 gün yarı ömür)'], rows)
      + `<h4>Öncelikliye göre fark: ${res.length} senaryo üzerinde en küçük / medyan / en büyük (puan)</h4>`
      + `<table class="stats"><thead><tr><th>Çizelgeleyici</th><th>Düşen + hatta kayıp</th><th>Toplam kayıp</th><th>Teslim</th><th>Değer % (seçili model, sabit)</th><th>Değer % (bilim verisi 14 gün yarı ömür)</th></tr></thead><tbody>${summary}</tbody></table>`
      + `<h4>Tahmin hatası (pencere başı/sonu kayması −240 … +240 dk; ${fmt(errStep)} sn adım; + iyimser, − kötümser)</h4>`
      + table([moonLike ? 'Başlangıç' : 'Pencere', 'öncelikli (referans)', 'Çizelgeleyici', 'hata yok', '−240 dk', '−120 dk', '+120 dk', '+240 dk'], errRows)
      + `<p class="hint"><b>Okuma:</b> hücre = düşen + hatta kayıp % / toplam kayıp % / teslim % [üretilmeyen %]. Tahmin hatasında toplam kayıp farkı, |hata| ≤ 120 dk içindeki en kötü değerin öncelikliye göre farkıdır (min / medyan / maks, puan; parantezde −240 dk): ${worst.join(' · ')}. Düşen + hatta kayıp öncelikliden (0,1 puandan fazla) <i>kötüleşen</i> senaryo sayısı: ${dropWorse.join(' · ')}. Tek bir senaryodan genelleme yapılmaz: sonuçların aralığa göre değişimi yukarıdaki en küçük / en büyük değerlerdedir.</p>`;
  }

  $('#pj-run').addEventListener('click', () => void runProjection());
  $('#ob-run').addEventListener('click', () => void runOrbit());
  $('#gn-run').addEventListener('click', () => void runGeneral());

  /** Senaryo türüne göre bölüm başlıklarını ve düğme metinlerini ayarlar. */
  function applyKind(s: Scen) {
    const moon = s.kind === 'moon';
    $('#ob-title').textContent = moon ? '(k) Ay aktarma uydusu yörüngesi ve ikinci uydu' : '(k) Mars aktarma uydusu gölgesi';
    $('#ob-run').textContent = moon ? 'Yörünge karşılaştırmasını hesapla' : 'Gölge karşılaştırmasını hesapla';
    $('#ob-hint').innerHTML = moon
      ? `Ay aktarma uydusunun yörüngesi seçilebilir: <b>ekvatoral dairesel</b> (3000 km, mevcut) ya da <b>eğimli/eliptik</b> (kutupsal, yarı büyük eksen ${fmt(HYPOTHETICAL.moonOrbits.elliptical.semiMajorKm)} km, dışmerkezlik ${fmt(HYPOTHETICAL.moonOrbits.elliptical.ecc, 1)}, apolün güney kutbu üzerinde; <b>uydurma elemanlar</b>), ayrıca isteğe bağlı <b>ikinci Ay uydusu</b> (apolünü kuzey kutbu üzerinde; araçlar <i>en iyi görüneni</i> ya da <i>hat sırasını</i> kullanır) ve <b>kutup aracı</b> (${fmt(HYPOTHETICAL.moonPolarAsset.latDeg)}° enlem). Kapsama: uyduyu gören yer istasyonu, Dünya hattı açık %, yüzey görüşü; ve teslim/kayıp, 1/2/3 istasyonda. Ayarlar yukarıdaki “Ay yörüngesi / İkinci Ay uydusu / Kutup aracı” seçicilerinden de ana senaryoya uygulanır. Düğmeyle başlar.`
      : `Mars aktarma uydusunun Mars gölgesinde (tutulma) geçirdiği zamanda hat kapanır (<b>güç modeli yok</b>): yalnız uydu → Dünya hattı ya da yüzey hattı da. Ayarlar yukarıdaki “Mars uydusu gölgesi” seçicisinden de ana senaryoya uygulanır. Düğmeyle başlar.`;
    $('#gn-run').textContent = moon ? 'Genellemeyi hesapla (5 tarih aralığı)' : 'Genellemeyi hesapla (9 kavuşum penceresi)';
  }

  return { reset, setValueInputs, setValueStations, applyKind, renderValue, fillValueControls };
}
