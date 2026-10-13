// Güneş ve Ay tutulmalarını astronomy-engine ile hesaplayıp public/data/eclipses.json'a yazar.
// İnternet gerekmez. Kullanım: npm run build-eclipses
import * as Astronomy from 'astronomy-engine';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data/eclipses.json');
const START = new Date(Date.UTC(2020, 0, 1));
const STOP = new Date(Date.UTC(2040, 0, 1));

const rows = [];

let s = Astronomy.SearchGlobalSolarEclipse(START);
while (s.peak.date < STOP) {
  rows.push({ type: 'solar', kind: s.kind.toLowerCase(), time: s.peak.date.toISOString() });
  s = Astronomy.NextGlobalSolarEclipse(s.peak);
}
let l = Astronomy.SearchLunarEclipse(START);
while (l.peak.date < STOP) {
  rows.push({ type: 'lunar', kind: l.kind.toLowerCase(), time: l.peak.date.toISOString() });
  l = Astronomy.NextLunarEclipse(l.peak);
}
rows.sort((a, b) => a.time.localeCompare(b.time));

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({
  source: 'astronomy-engine (hesaplanmış, NASA kataloğu değil)',
  note: 'time: tutulmanın en yüksek anı (UTC). solar: global güneş tutulması; lunar: Ay tutulması.',
  eclipses: rows,
}, null, 1));
console.log(`${rows.length} tutulma yazıldı: ${path.relative(process.cwd(), OUT)}`);
