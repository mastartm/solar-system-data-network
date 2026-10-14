// Çizelgeleyici sekmesinin Aşama 10 bölümleri (m1–m5): değere duyarlı kuyruk, takvim hatasına dayanıklı ufuk, çok uydulu yönlendirme, yörünge/güç seçenekleri, telemetri.
// Tüm sayılar VARSAYIMSALDIR (src/config/hypothetical.ts); sonuçlar gerçek bir görev sonucu değildir. Tüm hesaplar Web Worker havuzunda çalışır (ana iş parçacığı yalnızca tabloyu çizer).
// Her deney düğmeyle başlar; seçili hat, istasyon sayısı, hat modu ve kaydırıcılar kullanılır. Betikteki (scripts/asama10-sonuclar.ts) deneylerin küçültülmüş hâlidir.
import { HYPOTHETICAL, HYPOTHETICAL_LABEL } from '../config/hypothetical';
import type { CoverageRow } from '../network/coverage';
import type { Req, SimOut, TlSpec } from '../network/compute';
import type { NetOptions } from '../network/network';
import type { Policy, ProjectionOptions, SchedConfig } from '../network/scheduler';
import { valuePct, type Metrics } from '../network/sweep';
import { adaptiveRobustConfig, correctConfig, routingConfig, valueAwareConfig, valueHalfLivesSec, valueModelsConfig } from '../network/timeline';
import type { ExtrasCtx } from './schedulerExtras';
import { NAME, fmt, signed, valueModel, type Scen } from './schedShared';

export type Stage10Ctx = Pick<ExtrasCtx, '$' | 'call' | 'cur' | 'cfgFor'>;

const IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] as const;
type Id = (typeof IDS)[number];

const cellOf = (m: Metrics) => `${fmt(m.dropPct + m.abandonedPct, 1)} / ${fmt(m.lossPct, 1)} / ${fmt(m.deliveredPct, 1)} [${fmt((100 * m.suppressedMb) / (m.demandMb || 1), 1)}]`;
const table = (head: string[], rows: string[][]) =>
  `<table class="stats cmp"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const gain = (g: number) => `<span class="${g > 0.05 ? 'ok' : g < -0.05 ? 'bad' : ''}">${signed(g, 2)}</span>`;

export function mountStage10(ctx: Stage10Ctx) {
  const { $ } = ctx;
  let tok = 0;
  const reset = () => { tok++; for (const id of IDS) { $(`#${id}-body`).innerHTML = ''; $(`#${id}-status`).textContent = ''; } };

  /** Deney başına temiz ayar: panelde seçili Aşama 10 seçenekleri (yönlendirme, telemetri, ayrı tamponlar, kuyruk kuralı) deneyin kendi değişkenlerini bozmasın. */
  const clean = (cfg: SchedConfig, over: Partial<SchedConfig> = {}): SchedConfig => {
    const { routing: _r, telemetryMinFactor: _t, telemetryShare: _s, valueAware: _v, ...rest } = cfg;
    return { ...rest, projection: { ...(cfg.projection ?? {}), separateRelays: false }, ...over };
  };
  const spec = (s: Scen, step: number, n: number, net: NetOptions): TlSpec => ({ startJD: s.startJD, endJD: s.endJD, stepSec: step, stations: n, relayId: s.relayId, ...(Object.keys(net).length ? { net } : {}) });
  const sim = (s: Scen, net: NetOptions, n: number, step: number, policy: Policy, cfg: SchedConfig) =>
    ctx.call<SimOut>({ op: 'sim', tl: spec(s, step, n, net), policy, cfg } as Req).then((o) => o.metrics);
  const base = (s: Scen, net: NetOptions, over: { projection?: ProjectionOptions; step?: number; forecast?: { edgeShiftSec: number } } = {}) => ctx.cfgFor(s.relayId, net, over);

  /** Ortak düğme sarmalayıcı: durum yazar, çalışırken yeni hesap başlarsa (belirteç) sonucu atar, hata gösterir. */
  async function guarded(id: Id, work: (my: number, status: (t: string) => void) => Promise<string>) {
    const my = ++tok;
    const st = $(`#${id}-status`), body = $(`#${id}-body`);
    const c = ctx.cur();
    if (!c.s) { st.textContent = 'Önce bir senaryo seçin.'; return; }
    st.textContent = 'Hesaplanıyor…';
    body.innerHTML = '';
    const t0 = performance.now();
    try {
      const html = await work(my, (t) => { if (my === tok) st.textContent = t; });
      if (my !== tok) return;
      body.innerHTML = html;
      st.textContent = `Bitti (${fmt(performance.now() - t0)} ms, Web Worker havuzu)`;
    } catch (e) {
      if (my === tok) st.innerHTML = `<span class="bad">Hesaplama durdu: ${(e as Error).message}</span>`;
    }
  }
  const count = (st: (t: string) => void, total: number) => { let done = 0; return () => st(`Hesaplanıyor… ${++done}/${total}`); };

  // m1 ------------------------------------------------------------------------------------------------------------------------------------------
  const hls = HYPOTHETICAL.value.decayOptionsDays;
  const run1 = () => guarded('m1', async (_my, st) => {
    const c = ctx.cur(), s = c.s!, n = c.stations, net = s.net, step = HYPOTHETICAL.scheduler.stepSec;
    const b = base(s, net);
    const tick = count(st, 2 + 3 * hls.length);
    const t = <T,>(p: Promise<T>) => p.then((x) => { tick(); return x; });
    const [pr, ad] = await Promise.all([t(sim(s, net, n, step, 'priority', clean(b))), t(sim(s, net, n, step, 'adaptive', clean(b)))]);
    const rows = await Promise.all(hls.map(async (d) => {
      const vc = (over: object) => valueAwareConfig(d * 86400, over);
      const [newest, all, both] = await Promise.all([
        t(sim(s, net, n, step, 'valueAware', clean(b, { valueAware: vc({ expireBelow: 0, evictOldest: false }) }))),
        t(sim(s, net, n, step, 'valueAware', clean(b, { valueAware: vc({}) }))),
        t(sim(s, net, n, step, 'valueAdaptive', clean(b, { valueAware: vc({}) }))),
      ]);
      return { d, newest, all, both };
    }));
    const w = (p: { decays: boolean; weight: number }) => (p.decays ? p.weight : valueModel.telemetryWeight);
    const g = (m: Metrics, hi: number) => valuePct(m, { weightOf: w, halfLifeIdx: hi }) - valuePct(pr, { weightOf: w, halfLifeIdx: hi });
    const cellV = (m: Metrics, hi: number) => `${gain(g(m, hi))} <small>(kayıp ${signed(m.lossPct - pr.lossPct, 1)}, atılan %${fmt(m.expiredPct, 1)})</small>`;
    return `<p class="hint"><b>${s.relayName} hattı, ${n} istasyon, telemetri ${fmt(valueModel.telemetryWeight)}×.</b> Öncelikli: düşen+hatta / toplam kayıp / teslim [üretilmeyen] = ${cellOf(pr)}. Hücre = değer % kazancı (puan; politika − öncelikli, her satırın yarı ömründe zamanla azalan değerle; kayıp: toplam kayıp farkı).</p>`
      + table(['Yarı ömür', 'Kısma (uyarlamalı ufuk)', 'Kuyruk: yalnız en yeni önce', 'Kuyruk: en yeni önce + eşik altı atma + en eskiyi at', 'Kısma + kuyruk (valueAdaptive)'],
        rows.map((r, i) => [`${fmt(r.d)} gün`, cellV(ad, i), cellV(r.newest, i), cellV(r.all, i), cellV(r.both, i)]))
      + `<p class="hint">Kuyruk kuralı yalnızca azalan değer modeli seçiliyken devreye girer; kural yarı ömrü, gerçek değerin yarı ömrüyle aynı varsayıldı (tablo satırı). Sabit değerde kural yoktur ve “değere duyarlı kuyruk” öncelikliyle birebir aynıdır. Eşik: değeri başlangıcın %${fmt(HYPOTHETICAL.valueAware.expireBelow * 100)}'ine inen bilim paketi atılır (“atılan”, düşen değildir; toplam kayba dahildir). Üstel azalmada, kapasite kısıtlıyken toplam değeri en çok artıran sıra “en yeni önce”dir; eski veri geç (ya da hiç) gider, bilim verisi gecikme dağılımı uzar. Değer ağırlıkları ve yarı ömürler uydurmadır.</p>`;
  });

  // m2 ------------------------------------------------------------------------------------------------------------------------------------------
  const run2 = () => guarded('m2', async (_my, st) => {
    const c = ctx.cur(), s = c.s!, n = c.stations, net = s.net, step = HYPOTHETICAL.forecastScan.stepSec;
    const grid = [-240, -120, 0, 120, 240];
    const withCor = !!(document.querySelector('#m2-cor') as HTMLInputElement | null)?.checked;
    const pols: [Policy, string, boolean?][] = [['rolling', `${NAME.rolling} (${fmt(c.rollingDays, c.rollingDays < 1 ? 1 : 0)} g)`], ['adaptive', NAME.adaptive], ['adaptiveRobust', NAME.adaptiveRobust], ...(withCor ? [['adaptiveRobust', `${NAME.adaptiveRobust} + takvim düzeltmesi (Aşama 11)`, true] as [Policy, string, boolean]] : [])];
    const tick = count(st, 1 + grid.length * pols.length);
    const t = <T,>(p: Promise<T>) => p.then((x) => { tick(); return x; });
    const pr = await t(sim(s, net, n, step, 'priority', clean(base(s, net, { step }))));
    const cells = await Promise.all(grid.map((e) => Promise.all(pols.map(([p, , cor]) => {
      const b = base(s, net, { step, forecast: { edgeShiftSec: e * 60 } });
      return t(sim(s, net, n, step, p, clean(b, p === 'adaptiveRobust' ? { adaptiveRobust: adaptiveRobustConfig(cor ? { correct: correctConfig() } : {}) } : {})));
    }))));
    const ar = HYPOTHETICAL.adaptiveRobust;
    return `<p class="hint"><b>${s.relayName} hattı, ${n} istasyon, adım ${fmt(step)} sn.</b> Öncelikli: ${cellOf(pr)}. Hücre: düşen+hatta / toplam kayıp / teslim [üretilmeyen] ve toplam kayıp farkı (puan, öncelikliye göre). Hata: strateji bildiği takvimde her açık pencerenin başını/sonunu bu kadar dakika kaydırır (− kötümser: pencereler kısalır, + iyimser); gerçek bağlantılar değişmez.</p>`
      + table(['Takvim hatası', ...pols.map((p) => p[1])], grid.map((e, i) => [`${e > 0 ? '+' : e < 0 ? '−' : ''}${Math.abs(e)} dk`, ...cells[i].map((m) => `${cellOf(m)}<br><small>toplam kayıp farkı ${signed(m.lossPct - pr.lossPct, 2)}</small>`)]))
      + `<p class="hint">Dayanıklı ufuk: güven aralığı (kapalı dönem uzunluğu, gözlenen en uzun kapalı dönemin ×${fmt(ar.histFactor)}'ini aşamaz) ve geri çekilme (son ${fmt(ar.checkDays)} günde takvim, gerçekte açık adımların %${fmt(ar.trustMin * 100)}'inden azını açık gösteriyorsa kısma yapılmaz = öncelikli kuralı); ufuk kırpma ${ar.capDays > 0 ? `${fmt(ar.capDays)} gün` : 'kapalı'}. Ay (kavuşumsuz) hatlarında −240 dk'da uyarlamalı çöker; dayanıklı sürüm öncelikliye döner (kısmanın kazancını da bırakır).</p>`
      + (withCor ? `<p class="hint">Takvim düzeltmesi (Aşama 11): strateji gerçekleşen pencere başlarından/bitişlerinden kaymayı öğrenir (son ${fmt(ar.correct.learnDays)} gün, en az ${fmt(ar.correct.minWindows)} eşleşme, |kayma| ≤ ${fmt(ar.correct.maxShiftHours)} sa). Silinmiş pencereler (ör. −240 dk) düzeltilemez; orada sonuç değişmez. Değerler uydurmadır.</p>` : '');
  });

  // m3 ------------------------------------------------------------------------------------------------------------------------------------------
  const run3 = () => guarded('m3', async (_my, st) => {
    const c = ctx.cur(), s = c.s!, n = c.stations, step = HYPOTHETICAL.scheduler.stepSec;
    if (s.kind !== 'moon') return '<p class="hint">Çok uydulu yönlendirme Ay hattı içindir (ikinci Ay uydusu): “Ay aktarma hattı”nı seçin.</p>';
    const net: NetOptions = { moonOrbit: 'elliptical', moonSecond: 'best', moonIsl: true, ...(s.net.moonPolarAsset ? { moonPolarAsset: true } : {}), ...(s.net.moonPrecession ? { moonPrecession: s.net.moonPrecession } : {}) };
    const routes: [string, SchedConfig['routing']][] = [
      ['çizelge seçimi (Aşama 9)', undefined], ['en az dolu tamponlu görünen uydu', routingConfig('leastFilled')], ['önce Dünya hattı açık, sonra en az dolu', routingConfig('openFirst')],
      ['çizelge seçimi + uydular arası bağlantı', routingConfig('timeline', true)], ['en az dolu + uydular arası bağlantı', routingConfig('leastFilled', true)],
    ];
    const cols: [string, Policy, ProjectionOptions][] = [['öncelikli', 'priority', {}], ['kayan ufuklu (havuz)', 'rolling', {}], ['kayan ufuklu (ayrı tamponlar)', 'rolling', { separateRelays: true }], ['uyarlamalı (havuz)', 'adaptive', {}], ['uyarlamalı (ayrı tamponlar)', 'adaptive', { separateRelays: true }]];
    const tick = count(st, routes.length * cols.length);
    const rows = await Promise.all(routes.map(([, rc]) => Promise.all(cols.map(([, p, pj]) => {
      const b = base(s, net, { projection: pj });
      return sim(s, net, n, step, p, clean(b, { projection: pj, ...(rc ? { routing: rc } : {}) })).then((m) => { tick(); return m; });
    }))));
    return `<p class="hint"><b>Ay, eliptik + 2. uydu (en iyi)${net.moonPolarAsset ? ' + kutup aracı' : ''}, ${n} istasyon.</b> Veri girdiği uydunun tamponunda kalır (uydu tamponları ayrı). “Havuz” = Aşama 9 projeksiyonu (uydu tamponları birbirinin yerine kullanılabilir sayılır), “ayrı tamponlar” = separateRelays. Hücre: düşen+hatta / toplam kayıp / teslim [üretilmeyen].</p>`
      + table(['Uydu seçimi', ...cols.map((x) => x[0])], routes.map(([name], i) => [name, ...rows[i].map(cellOf)]))
      + `<p class="hint">Uydular arası bağlantı (menzil ${fmt(HYPOTHETICAL.routing.islMaxKm)} km, ${fmt(HYPOTHETICAL.routing.islKbps)} kbit/sn; hepsi uydurma) yalnızca Dünya hattı kapalı uydudaki veriyi hattı açık eşe aktarır. Kapasite kontrolü (tek ekvatoral uydu, 2× kapasite) için README ve betiğe bakın.</p>`;
  });

  // m4 ------------------------------------------------------------------------------------------------------------------------------------------
  const run4 = () => guarded('m4', async (_my, st) => {
    const c = ctx.cur(), s = c.s!, n = c.stations, step = HYPOTHETICAL.scheduler.stepSec;
    if (s.kind === 'moon') {
      const rates = [-13.2, -2, -1, 0, 1, 2, 13.2];
      const nets = rates.map((r): NetOptions => ({ ...s.net, moonOrbit: 'elliptical', ...(r === 0 ? {} : { moonPrecession: { raanRateDegPerDay: r } }) }));
      const tick = count(st, rates.length * 2);
      const rows = await Promise.all(nets.map(async (net) => {
        const [cov, m] = await Promise.all([
          ctx.call<CoverageRow>({ op: 'coverage', startJD: s.startJD, endJD: s.endJD, n, net } as Req).then((x) => { tick(); return x; }),
          sim(s, net, n, step, 'priority', clean(base(s, net))).then((x) => { tick(); return x; }),
        ]);
        return { cov, m };
      }));
      const ids = Object.keys(rows[0].cov.surf).filter((k) => k.startsWith('ay-'));
      return `<p class="hint"><b>Ay, eliptik/kutupsal yörünge${s.net.moonSecond && s.net.moonSecond !== 'none' ? ' + 2. uydu' : ''}, ${n} istasyon, öncelikli çizelge.</b> RAAN hızı gün başına derece; “0” = sabit düzlem. Hızlar UYDURMADIR; −13,2 ≈ Ay dönüşünün tersi. Yüzey görüşü %: ${ids.map((i) => (i === 'ay-1' ? 'A' : i === 'ay-2' ? 'B' : 'C')).join(' / ')}.</p>`
        + table(['RAAN hızı (°/gün)', 'Dünya hattı açık %', 'Yüzey görüşü %', 'Düşen+hatta %', 'Teslim %'], rows.map(({ cov, m }, i) => [rates[i] === 0 ? 'yok' : fmt(rates[i], 1), fmt((100 * cov.up['ay-aktarma']) / cov.steps, 1), ids.map((k) => fmt((100 * cov.surf[k]) / cov.steps, 1)).join(' / '), fmt(m.dropPct + m.abandonedPct, 1), fmt(m.deliveredPct, 1)]));
    }
    const modes: [string, NetOptions][] = [
      ['gölge yok, eksen paralel', {}], ['gölge yok, eksen eğik', { marsAxis: 'tilted' }], ["gölgede Dünya hattı kapalı, eksen paralel", { marsEclipse: 'earth' }], ["gölgede Dünya hattı kapalı, eksen eğik", { marsEclipse: 'earth', marsAxis: 'tilted' }],
      ["güç modeli, eksen paralel", { marsEclipse: 'power' }], ["güç modeli, eksen eğik", { marsEclipse: 'power', marsAxis: 'tilted' }],
    ];
    const tick = count(st, modes.length * 3);
    const rows = await Promise.all(modes.map(async ([, o]) => {
      const net = { ...o };
      const [cov, p, a] = await Promise.all([
        ctx.call<CoverageRow>({ op: 'coverage', startJD: s.startJD, endJD: s.endJD, n, net } as Req).then((x) => { tick(); return x; }),
        sim(s, net, n, step, 'priority', clean(base(s, net))).then((x) => { tick(); return x; }),
        sim(s, net, n, step, 'adaptive', clean(base(s, net))).then((x) => { tick(); return x; }),
      ]);
      return { cov, p, a };
    }));
    return `<p class="hint"><b>Mars, ${n} istasyon, ${s.free ? 'kavuşumsuz aralık' : 'kavuşum penceresi'}.</b> Eksen eğikliği tutarlı uygulanır (yörünge düzlemi ve yüzey araçları eksene göre döner): gölge mevsimsel değişir, cisim arkası kapanması da değişir. Eksen yönü (≈ ${fmt(HYPOTHETICAL.marsAxis.decDeg, 0)}° Dec) bir VARSAYIMDIR. Güç modeli: batarya ${fmt(HYPOTHETICAL.marsPower.batteryWh)} Wh, eşik %${fmt(HYPOTHETICAL.marsPower.cutoffFrac * 100)} / %${fmt(HYPOTHETICAL.marsPower.resumeFrac * 100)} (uydurma).</p>`
      + table(['Yapılandırma', 'Dünya hattı açık %', 'Öncelikli', 'Uyarlamalı'], modes.map(([name], i) => [name, fmt((100 * rows[i].cov.up[HYPOTHETICAL.relays[1].id]) / rows[i].cov.steps, 1), cellOf(rows[i].p), cellOf(rows[i].a)]));
  });

  // m5 ------------------------------------------------------------------------------------------------------------------------------------------
  const run5 = () => guarded('m5', async (_my, st) => {
    const c = ctx.cur(), s = c.s!, n = c.stations, net = s.net, step = HYPOTHETICAL.scheduler.stepSec;
    const tel = HYPOTHETICAL.telemetry;
    const cls = HYPOTHETICAL.scheduler.classes;
    const total = tel.packetMb.length * 2 + tel.reservedShare.length * 2 + tel.minFactor.length;
    const tick = count(st, total);
    const go = (p: Policy, over: Partial<SchedConfig>) => sim(s, net, n, step, p, clean(base(s, net), over)).then((m) => { tick(); return m; });
    const pkt = await Promise.all(tel.packetMb.map((pm) => Promise.all((['priority', 'adaptive'] as Policy[]).map((p) => go(p, { classes: cls.map((k, i) => (i === 0 ? { ...k, packetMb: pm } : k)) })))));
    const shr = await Promise.all(tel.reservedShare.map((sh) => Promise.all((['fifo', 'priority'] as Policy[]).map((p) => go(p, { telemetryShare: sh })))));
    const mf = await Promise.all(tel.minFactor.map((f) => go('adaptive', { telemetryMinFactor: f })));
    const tw = { weightOf: (p: { weight: number }) => p.weight };
    const val = (m: Metrics) => `${fmt(valuePct(m, tw), 1)} / ${fmt(valuePct(m, { ...tw, halfLifeIdx: 2 }), 1)}`;
    const d = (sec: number) => `${fmt(sec / 3600, 1)} sa`;
    return `<p class="hint"><b>${s.relayName} hattı, ${n} istasyon.</b> Hücre: düşen+hatta / toplam kayıp / teslim [üretilmeyen]; değer % (sabit / azalan 14 g). Telemetri değeri ${fmt(cls[0].valuePerMb)}, bilim verisi ${fmt(cls[1].valuePerMb)} (uydurma).</p>`
      + '<h4>Telemetri paketi boyutu</h4>' + table(['Paket (Mb)', 'Öncelikli', 'Uyarlamalı'], tel.packetMb.map((pm, i) => [fmt(pm, 1), `${cellOf(pkt[i][0])}`, `${cellOf(pkt[i][1])}`]))
      + '<h4>Ayrılmış telemetri hat payı</h4>' + table(['Pay', 'FIFO: telemetri düşen %', 'FIFO: telemetri p95', 'Öncelikli: telemetri düşen %', 'Öncelikli: telemetri p95'], tel.reservedShare.map((sh, i) => [fmt(sh, 2), fmt(shr[i][0].topDropPct, 1), d(shr[i][0].topP95Sec), fmt(shr[i][1].topDropPct, 1), d(shr[i][1].topP95Sec)]))
      + '<h4>Telemetri de kısılır (uyarlamalı kısma; çarpan alt sınırı)</h4>' + table(['Alt sınır', 'Sonuç', 'Telemetri üretilmeyen %', 'Değer %'], tel.minFactor.map((f, i) => [fmt(f, 2), cellOf(mf[i]), fmt(mf[i].topSuppressedPct, 1), val(mf[i])]))
      + '<p class="hint">Telemetri zaten en yüksek öncelikli olduğundan paket boyutu ve ayrılmış pay öncelikli kuyrukta etkisizdir; telemetriyi kısmak “düşen”i azaltır ama aynı miktar “üretilmeyen”e dönüşür ve (telemetri değeri yüksek olduğundan) değer ölçütünü düşürür.</p>';
  });

  // m6 (Aşama 11) -------------------------------------------------------------------------------------------------------------------------------
  const run6 = () => guarded('m6', async (_my, st) => {
    const c = ctx.cur(), s = c.s!, n = c.stations, net = s.net, step = HYPOTHETICAL.scheduler.stepSec;
    const specs = HYPOTHETICAL.value.models, models = valueModelsConfig(), H0 = valueHalfLivesSec().length;
    const deadlines = [...new Set(specs.map((m) => (m.decay.kind === 'step' ? m.decay.deadlineDays : 0)).filter((d) => d > 0))];
    const tick = count(st, 4 + deadlines.length);
    const go = (p: Policy, over: Partial<SchedConfig> = {}) => sim(s, net, n, step, p, clean(base(s, net), { valueModels: models, ...over })).then((m) => { tick(); return m; });
    const hl = 14 * 86400;
    const [pr, ad, A, B] = await Promise.all([go('priority'), go('adaptive'), go('valueAware', { valueAware: valueAwareConfig(hl) }), go('valueAware', { valueAware: valueAwareConfig(hl, { expireBelow: 0, evictOldest: false }) })]);
    const C = await Promise.all(deadlines.map((d) => go('valueAware', { valueAware: valueAwareConfig(hl, { expireBelow: 0, expireAfterSec: d * 86400 }) })));
    const tw = { weightOf: (p: { id: string; weight: number }) => p.weight };
    const rows = specs.map((sp, j) => {
      const o = { ...tw, halfLifeIdx: H0 + j, topDecays: !!sp.top };
      const g = (m: Metrics) => gain(valuePct(m, o) - valuePct(pr, o));
      const di = sp.decay.kind === 'step' ? deadlines.indexOf(sp.decay.deadlineDays) : -1;
      return [`${sp.label} <small>(öncelikli ${fmt(valuePct(pr, o), 1)}%)</small>`, g(ad), g(A), g(B), di >= 0 ? g(C[di]) : '—'];
    });
    return `<p class="hint"><b>${s.relayName} hattı, ${n} istasyon, adım ${fmt(step)} sn.</b> Öncelikli: ${cellOf(pr)}. Hücre: değer kazancı (puan; politika − öncelikli, satırın KENDİ gerçek değer modeliyle; telemetri ve bilim verisi config birim değerleri). Kural A: en yeni önce + eşik altı atma + en eskiyi at (üstel 14 g varsayar); B: yalnız en yeni önce; C: gerçek son tarihte atma + en yeni önce + en eskiyi at (yalnız basamak modelleri).</p>`
      + table(['Gerçek değer modeli', NAME.adaptive + ' (kısma)', 'Kural A', 'Kural B', 'Kural C (son tarihe uyan)'], rows)
      + `<p class="hint">Alternatif modeller uydurmadır (${HYPOTHETICAL_LABEL}) ve yalnızca ölçüttür; çizelgeleme kararlarını etkilemez. Atılan: A ${fmt(A.expiredPct, 1)}%; teslim farkı (puan): A ${signed(A.deliveredPct - pr.deliveredPct, 1)}, B ${signed(B.deliveredPct - pr.deliveredPct, 1)}. Kural kazancı kapasite kıtsa görünür (Ay 2+ istasyon: kayıp ≈ 0, “etki yok”).</p>`;
  });

  const runs: Record<Id, () => Promise<void>> = { m1: run1, m2: run2, m3: run3, m4: run4, m5: run5, m6: run6 };
  for (const id of IDS) $(`#${id}-run`).addEventListener('click', () => void runs[id]());
  void HYPOTHETICAL_LABEL;
  return { reset };
}
