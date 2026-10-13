// JPL Horizons'tan gezegen/Ay vektörlerini çeker ve public/data/ altına JSON yazar.
// Kullanım:  node scripts/fetch-horizons.mjs [--force] [--soft]
//   --force : dosyalar varsa bile yeniden çek
//   --soft  : hata olursa uyar ama çıkış kodu 0 (npm run dev/build kancaları için)
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const START = '2020-01-01';
const STOP = '2040-01-01';
const force = process.argv.includes('--force');
const soft = process.argv.includes('--soft');

const PLANETS = [
  ['mercury', '199'], ['venus', '299'], ['earth', '399'], ['mars', '499'],
  ['jupiter', '599'], ['saturn', '699'], ['uranus', '799'], ['neptune', '899'],
];

const exists = (f) => access(f).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function horizons(command, center, step) {
  const q = new URLSearchParams({
    format: 'text', COMMAND: `'${command}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS', CENTER: `'${center}'`, START_TIME: `'${START}'`,
    STOP_TIME: `'${STOP}'`, STEP_SIZE: `'${step}'`, VEC_TABLE: "'2'",
    REF_PLANE: 'ECLIPTIC', REF_SYSTEM: 'ICRF', OUT_UNITS: "'KM-S'", CSV_FORMAT: 'YES',
  });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${API}?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const a = text.indexOf('$$SOE');
      const b = text.indexOf('$$EOE');
      if (a < 0 || b < 0) throw new Error(`Beklenmeyen yanıt: ${text.slice(0, 200)}`);
      const rows = text.slice(a + 5, b).trim().split('\n').map((l) => l.split(',').map((s) => s.trim()));
      // sütunlar: JDTDB, takvim, X, Y, Z, VX, VY, VZ
      return rows.map((r) => ({ jd: +r[0], v: r.slice(2, 8).map(Number) }));
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(2000 * 2 ** attempt); // 4s, 8s, 16s
    }
  }
}

function pack(rows, stepDays) {
  const pos = [], vel = [];
  for (const { v } of rows) {
    pos.push(Math.round(v[0]), Math.round(v[1]), Math.round(v[2])); // km
    vel.push(+v[3].toFixed(5), +v[4].toFixed(5), +v[5].toFixed(5)); // km/s
  }
  return { startJD: rows[0].jd, stepDays, count: rows.length, pos, vel };
}

const meta = {
  source: 'NASA/JPL Horizons System (ssd.jpl.nasa.gov/api/horizons.api)',
  fetchedAt: new Date().toISOString(),
  frame: 'ICRF, ekliptik düzlem',
  units: { pos: 'km', vel: 'km/s', time: 'JD (TDB)' },
};

async function main() {
  const planetsFile = path.join(OUT, 'planets.json');
  const moonFile = path.join(OUT, 'moon.json');
  if (!force && (await exists(planetsFile)) && (await exists(moonFile))) {
    console.log('public/data/ zaten dolu, atlandı (yeniden çekmek için --force).');
    return;
  }
  await mkdir(OUT, { recursive: true });
  const bodies = {};
  // Güneş merkezli gezegenler, 2 günde bir
  for (const [name, id] of PLANETS) {
    console.log(`Çekiliyor: ${name}`);
    bodies[name] = pack(await horizons(id, '500@10', '2 d'), 2);
    await sleep(500); // nazik ol
  }
  await writeFile(planetsFile, JSON.stringify({ ...meta, center: 'Güneş (500@10)', bodies }));
  // Ay, Dünya merkezli, günde bir
  console.log('Çekiliyor: moon');
  const moon = pack(await horizons('301', '500@399', '1 d'), 1);
  await writeFile(moonFile, JSON.stringify({ ...meta, center: 'Dünya (500@399)', bodies: { moon } }));
  console.log('Bitti: public/data/planets.json, moon.json');
}

main().catch((e) => {
  console.error(`\nHorizons verisi çekilemedi: ${e.message}`);
  console.error('İnternet/ağ erişimini kontrol edip "npm run fetch-data" çalıştırın.');
  process.exit(soft ? 0 : 1);
});
