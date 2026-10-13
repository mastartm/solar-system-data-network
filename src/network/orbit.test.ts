import { describe, expect, it } from 'vitest';
import { HYPOTHETICAL } from '../config/hypothetical';
import { syntheticTracks } from '../data/synthetic';
import type { Track } from '../data/types';
import { AU_KM } from '../map/ephemeris';
import { coverageRow } from './coverage';
import { computeNetwork, effectiveAssets, effectiveRelays, inCylinderShadow, keplerPosition, type NetOptions } from './network';
import { buildLinkTimeline, restrictToRelays, schedTopology } from './timeline';

// BU TESTLER SENTETİKTİR: sentetik dairesel yörüngeli konum izleri (gerçek Horizons verisi değil) ve uydurma yörünge elemanları (HYPOTHETICAL).
// Aşama 9: Kepler yörüngesi, ikinci Ay uydusu, kutup aracı, Mars gölgesi.
const MU_MOON = 4902.8, R_MOON = 1737.4, R_MARS = 3389.5;
const tracks = syntheticTracks();
const jd0 = 2458849.5 + 400;
const ell = HYPOTHETICAL.moonOrbits.elliptical;

describe('Kepler yörüngesi (sentetik elemanlar)', () => {
  it('dairesel ekvatoral eleman (e=0, i=0): yarıçap sabit, düzlem içinde; periyot sonunda konum tekrarlanır', () => {
    const o = { semiMajorKm: 5000, ecc: 0, incDeg: 0, raanDeg: 0, argPeriDeg: 0, meanAnomalyDeg: 30 };
    const T = (2 * Math.PI * Math.sqrt(5000 ** 3 / MU_MOON)) / 86400;
    for (const dt of [0, 0.01, 0.1]) {
      const p = keplerPosition(o, MU_MOON, 2460000 + dt).pos;
      expect(Math.hypot(...p)).toBeCloseTo(5000, 6);
      expect(p[2]).toBeCloseTo(0, 9);
    }
    const a = keplerPosition(o, MU_MOON, 2460000).pos, b = keplerPosition(o, MU_MOON, 2460000 + T).pos;
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 4);
  });

  it('eliptik: yarıçap [a(1−e), a(1+e)] aralığında; periapsis M=0, apoapsis M=π; enerji (vis-viva) korunur', () => {
    const o = { ...ell, meanAnomalyDeg: 0 };
    const peri = keplerPosition(o, MU_MOON, 2451545).pos;
    expect(Math.hypot(...peri)).toBeCloseTo(o.semiMajorKm * (1 - o.ecc), 6);
    const apo = keplerPosition({ ...o, meanAnomalyDeg: 180 }, MU_MOON, 2451545).pos;
    expect(Math.hypot(...apo)).toBeCloseTo(o.semiMajorKm * (1 + o.ecc), 6);
    for (let h = 0; h < 40; h++) {
      const r = Math.hypot(...keplerPosition(o, MU_MOON, 2460000 + h / 48).pos);
      expect(r).toBeGreaterThanOrEqual(o.semiMajorKm * (1 - o.ecc) - 1e-6);
      expect(r).toBeLessThanOrEqual(o.semiMajorKm * (1 + o.ecc) + 1e-6);
    }
    // sayısal hız ile vis-viva: v² = μ (2/r − 1/a)
    const h = 1e-4, jd = 2460000.37;
    const p0 = keplerPosition(o, MU_MOON, jd - h).pos, p1 = keplerPosition(o, MU_MOON, jd + h).pos, pm = keplerPosition(o, MU_MOON, jd).pos;
    const v = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / (2 * h * 86400);
    expect(v * v).toBeCloseTo(MU_MOON * (2 / Math.hypot(...pm) - 1 / o.semiMajorKm), 3);
  });

  it('kutupsal eleman: apoapsis güneyde (argPeri 90°) ya da kuzeyde (270°); yörünge düzlemi kutuplardan geçer', () => {
    const south = keplerPosition({ ...ell, argPeriDeg: 90, meanAnomalyDeg: 180 }, MU_MOON, 2451545).pos;
    const north = keplerPosition({ ...ell, argPeriDeg: 270, meanAnomalyDeg: 180 }, MU_MOON, 2451545).pos;
    expect(south[2]).toBeLessThan(-0.99 * ell.semiMajorKm * (1 + ell.ecc));
    expect(north[2]).toBeGreaterThan(0.99 * ell.semiMajorKm * (1 + ell.ecc));
    let zmax = 0;
    for (let h = 0; h < 60; h++) zmax = Math.max(zmax, Math.abs(keplerPosition({ ...ell, meanAnomalyDeg: 0 }, MU_MOON, 2460000 + h / 48).pos[2]));
    expect(zmax).toBeGreaterThan(0.95 * ell.semiMajorKm * (1 - ell.ecc)); // periapsis civarında da kutba yakın
  });

  it('yörünge Ay yüzeyine inmez (periapsis yarıçapı > Ay yarıçapı)', () => {
    expect(ell.semiMajorKm * (1 - ell.ecc)).toBeGreaterThan(R_MOON + 500);
    expect(HYPOTHETICAL.moonRelay2.orbit.semiMajorKm * (1 - HYPOTHETICAL.moonRelay2.orbit.ecc)).toBeGreaterThan(R_MOON + 500);
  });
});

describe('ağ seçenekleri (sentetik izler)', () => {
  it('varsayılan seçenekler = seçeneksiz: Aşama 2-8 ağıyla birebir aynı (ekvatoral, ikinci uydu yok, gölge yok)', () => {
    const explicit: NetOptions = { moonOrbit: 'equatorial', moonSecond: 'none', marsEclipse: 'none', moonPolarAsset: false };
    for (const n of [0, 1, 3]) for (let h = 0; h < 48; h += 7) {
      const a = computeNetwork(tracks, jd0 + h / 24, n);
      const b = computeNetwork(tracks, jd0 + h / 24, n, explicit);
      expect({ ...b, statuses: b.statuses.map(({ candidates: _c, ...s }) => s) }).toEqual({ ...a, statuses: a.statuses.map(({ candidates: _c, ...s }) => s) });
    }
    expect(effectiveRelays()).toEqual(HYPOTHETICAL.relays);
    expect(effectiveAssets()).toEqual(HYPOTHETICAL.assets);
    expect(JSON.stringify(schedTopology())).toBe(JSON.stringify(schedTopology({})));
    expect(schedTopology().assets.every((a) => !a.alt)).toBe(true);
  });

  it('bağlantı çizelgesi: varsayılan seçenekler eski çizelgeyle aynı ve assetRelay yok', () => {
    const a = buildLinkTimeline(tracks, jd0, jd0 + 2, 1800, schedTopology(), 2);
    const b = buildLinkTimeline(tracks, jd0, jd0 + 2, 1800, schedTopology({}), 2, {});
    expect(b).toEqual(a);
    expect(a.every((x) => x.assetRelay === undefined)).toBe(true);
  });

  it('eliptik yörünge: uydu konumu Kepler yörüngesidir ve Dünya hattı/yüzey görüşü hesaplanır', () => {
    const net = computeNetwork(tracks, jd0, 0, { moonOrbit: 'elliptical' });
    expect(net.relayStates.find((r) => r.relay.id === 'ay-aktarma')!.relay.orbit).toEqual(ell);
    expect(net.statuses.filter((s) => s.asset.body === 'moon').every((s) => s.candidates.length === 1)).toBe(true);
  });

  it('ikinci Ay uydusu: üç uydu, ikinci uydu sona eklenir; Ay araçlarının iki adayı vardır; Mars araçlarının tek adayı', () => {
    const net = computeNetwork(tracks, jd0, 3, { moonSecond: 'best' });
    expect(net.relayStates.map((r) => r.relay.id)).toEqual(['ay-aktarma', 'mars-aktarma', HYPOTHETICAL.moonRelay2.id]);
    for (const s of net.statuses) expect(s.candidates.length).toBe(s.asset.body === 'moon' ? 2 : 1);
    const topo = schedTopology({ moonSecond: 'best' });
    expect(topo.relays).toEqual(['ay-aktarma', 'mars-aktarma', HYPOTHETICAL.moonRelay2.id]);
    expect(topo.assets.filter((a) => a.body === 'moon').every((a) => a.alt?.[0] === HYPOTHETICAL.moonRelay2.id)).toBe(true);
  });

  it("seçim kuralları: 'order' görünen ilk uyduyu, 'best' önce Dünya hattı açık olanı sonra en yüksek yükseklikte olanı seçer; hiçbiri görünmüyorsa ana uydu", () => {
    let sawSecond = 0, sawBestUp = 0, sawNone = 0;
    for (let h = 0; h < 24 * 20; h += 0.5) {
      const jd = jd0 + h / 24;
      for (const mode of ['order', 'best'] as const) {
        const net = computeNetwork(tracks, jd, 3, { moonSecond: mode });
        const byRelay = new Map(net.relayStates.map((r) => [r.relay.id, r]));
        for (const s of net.statuses.filter((x) => x.asset.body === 'moon')) {
          const vis = s.candidates.filter((c) => c.visible);
          if (!vis.length) { expect(s.relay.id).toBe('ay-aktarma'); expect(s.surfaceLink).toBe('horizon'); sawNone++; continue; }
          if (mode === 'order') expect(s.relay.id).toBe(vis[0].relayId);
          else {
            const anyUp = vis.some((c) => byRelay.get(c.relayId)!.earthLink === 'up');
            if (anyUp) { expect(byRelay.get(s.relay.id)!.earthLink).toBe('up'); sawBestUp++; }
            const pool = anyUp ? vis.filter((c) => byRelay.get(c.relayId)!.earthLink === 'up') : vis;
            expect(s.candidates.find((c) => c.relayId === s.relay.id)!.elevDeg).toBeCloseTo(Math.max(...pool.map((c) => c.elevDeg)), 9);
          }
          expect(s.surfaceLink).toBe('up');
          if (s.relay.id !== 'ay-aktarma') sawSecond++;
        }
      }
    }
    expect(sawSecond).toBeGreaterThan(0); expect(sawBestUp).toBeGreaterThan(0); expect(sawNone).toBeGreaterThan(0);
  });

  it('kutup aracı: eklenince topolojide ve durumda görünür; ekvatoral yörünge onu hiç görmez, kutupsal eliptik yörünge görür', () => {
    expect(schedTopology({ moonPolarAsset: true }).assets.map((a) => a.id)).toEqual([...HYPOTHETICAL.assets.map((a) => a.id), 'ay-3']);
    const vis = (net: NetOptions) => {
      let n = 0, t = 0;
      for (let h = 0; h < 24 * 30; h += 0.5) { t++; if (computeNetwork(tracks, jd0 + h / 24, 0, net).statuses.find((s) => s.asset.id === 'ay-3')!.surfaceLink === 'up') n++; }
      return n / t;
    };
    expect(vis({ moonPolarAsset: true })).toBe(0);
    expect(vis({ moonPolarAsset: true, moonOrbit: 'elliptical' })).toBeGreaterThan(0.3);
  });

  it('restrictToRelays: iki Ay uydusu birlikte kalır, assetRelay yeni sıraya göre; tek uyduya indirgeme aynı topolojiyi korur', () => {
    const net: NetOptions = { moonSecond: 'best' };
    const topo = schedTopology(net);
    const full = buildLinkTimeline(tracks, jd0, jd0 + 2, 1800, topo, 3, net);
    expect(full.every((x) => x.assetRelay?.length === topo.assets.length)).toBe(true);
    const r = restrictToRelays(topo, full, ['ay-aktarma', HYPOTHETICAL.moonRelay2.id]);
    expect(r.topo.relays).toEqual(['ay-aktarma', HYPOTHETICAL.moonRelay2.id]);
    expect(r.topo.assets.map((a) => a.id)).toEqual(['ay-1', 'ay-2']);
    expect(r.samples.every((x) => x.assetRelay!.every((i) => i === 0 || i === 1) && x.earthUp.length === 2 && x.surfaceUp.length === 2)).toBe(true);
    expect(r.samples.some((x) => x.assetRelay!.includes(1))).toBe(true); // ikinci uydu gerçekten kullanılıyor
    const one = restrictToRelays(topo, full, ['ay-aktarma']);
    expect(one.topo.assets.every((a) => !a.alt)).toBe(true);
    expect(one.samples.every((x) => x.assetRelay === undefined)).toBe(true);
    expect(() => restrictToRelays(topo, full, ['yok'])).toThrow();
  });
});

describe('Mars aktarma uydusu gölgesi (sentetik geometri)', () => {
  // Mars Güneş'e göre (1,5 AU, 0, 0); Dünya (0, 1 AU, 0): Dünya ile Güneş'in Mars'tan görünen yönleri ~34° ayrık (gölge, cisim arkası kapanmasıyla tam örtüşmez).
  const fixed = (p: [number, number, number]): Track => ({ startJD: 2450000, stepDays: 1000, count: 2, pos: Float64Array.from([...p, ...p]), vel: new Float64Array(6) });
  const tr = { earth: fixed([0, AU_KM, 0]), mars: fixed([1.5 * AU_KM, 0, 0]), moon: fixed([384400, 0, 0]) } as Record<string, Track>;
  const a = R_MARS + HYPOTHETICAL.relays.find((r) => r.id === 'mars-aktarma')!.altitudeKm;
  const T = (2 * Math.PI * Math.sqrt(a ** 3 / 42828.37)) / 86400;
  const JD = 2450100;
  const sweep = (opts: NetOptions) => Array.from({ length: 720 }, (_, i) => computeNetwork(tr, JD + (i / 720) * 3 * T, 0, opts));

  it('silindirik gölge geometrisi: Güneş yönünün tersinde ve eksene R\'den yakın', () => {
    expect(inCylinderShadow([-5000, 0, 0], [1, 0, 0], 3389.5)).toBe(true);
    expect(inCylinderShadow([-5000, 4000, 0], [1, 0, 0], 3389.5)).toBe(false);
    expect(inCylinderShadow([5000, 0, 0], [1, 0, 0], 3389.5)).toBe(false);
  });

  it('gölgede geçen süre oranı ≈ asin(R/a)/π (ekvatoral yörünge Güneş yönüyle aynı düzlemde); seçenek kapalıyken hiç gölge yok', () => {
    const on = sweep({ marsEclipse: 'earth' }).filter((n) => n.relayStates.find((r) => r.relay.id === 'mars-aktarma')!.eclipsed).length / 720;
    expect(on).toBeCloseTo(Math.asin(R_MARS / a) / Math.PI, 1);
    expect(sweep({}).every((n) => n.relayStates.every((r) => !r.eclipsed && r.earthLink !== 'eclipse'))).toBe(true);
  });

  it("'earth': gölgede yalnız Dünya hattı kapanır (yüzey hattı değişmez); 'both': yüzey hattı da kapanır; Ay etkilenmez", () => {
    const base = sweep({}), earth = sweep({ marsEclipse: 'earth' }), both = sweep({ marsEclipse: 'both' });
    let ecl = 0;
    for (let i = 0; i < 720; i++) {
      const r = (n: typeof base[number]) => n.relayStates.find((x) => x.relay.id === 'mars-aktarma')!;
      if (earth[i].relayStates.find((x) => x.relay.id === 'mars-aktarma')!.eclipsed) {
        if (r(earth[i]).earthLink === 'eclipse') {
          ecl++;
          expect(r(base[i]).earthLink === 'up' || r(base[i]).earthLink === 'nostation').toBe(true); // gölge olmasa hat açıktı (istasyon modeli kapalı → 'up')
          for (const s of earth[i].statuses.filter((x) => x.asset.body === 'mars')) { expect(s.connected).toBe(false); expect(s.surfaceLink).toBe(base[i].statuses.find((b) => b.asset.id === s.asset.id)!.surfaceLink); }
        }
        for (const s of both[i].statuses.filter((x) => x.asset.body === 'mars')) if (s.candidates[0].visible) expect(s.surfaceLink).toBe('eclipse');
      }
      for (const s of both[i].statuses.filter((x) => x.asset.body === 'moon')) expect(s).toEqual(base[i].statuses.find((b) => b.asset.id === s.asset.id));
    }
    expect(ecl).toBeGreaterThan(0);
  });

  it('gölge, açık Dünya hattı süresini azaltır (kapsama özeti)', () => {
    const none = coverageRow(tr, JD, JD + 3 * T, 0, {}).up['mars-aktarma'];
    const ecl = coverageRow(tr, JD, JD + 3 * T, 0, { marsEclipse: 'earth' }).up['mars-aktarma'];
    expect(ecl).toBeLessThan(none);
  });
});

describe('kapsama özeti (sentetik izler)', () => {
  it('sayaçlar: surf ≤ surfAny ≤ adım; pathUp ≤ min(surf, anyUp...); ikinci uydu varken en az bir uydunun hattı açık süresi birinciden az değil', () => {
    const net: NetOptions = { moonSecond: 'best' };
    const c = coverageRow(tracks, jd0, jd0 + 10, 2, net);
    expect(c.steps).toBe(480);
    for (const a of ['ay-1', 'ay-2']) { expect(c.surf[a]).toBeLessThanOrEqual(c.surfAny[a]); expect(c.surfAny[a]).toBeLessThanOrEqual(c.steps); expect(c.pathUp[a]).toBeLessThanOrEqual(c.surf[a]); }
    expect(c.anyUp).toBeGreaterThanOrEqual(Math.max(c.up['ay-aktarma'], c.up[HYPOTHETICAL.moonRelay2.id]));
    // varsayılan: eski sayımla aynı
    const d = coverageRow(tracks, jd0, jd0 + 10, 2);
    expect(Object.keys(d.see)).toEqual(['ay-aktarma', 'mars-aktarma']);
  });
});
