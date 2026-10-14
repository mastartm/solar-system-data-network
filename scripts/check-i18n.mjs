// Arayüz çevirisi denetimi: `npm run check-i18n`.
// - Kaynak koddaki her t('…') / tr('…') çağrısının ilk argümanı (dizgi) src/i18n/en.json içinde bir anahtar olmalı; `${…}` içeren şablon dizgisi anahtar olamaz ({ad} yer tutucusu kullanın).
// - en.json'daki her anahtar kaynak kodda (test ve src/i18n dışında) bir dizgi olarak geçmeli (kullanılmayan girdi hata).
// - Çeviri anahtarla aynı {yer tutucu} kümesini ve aynı HTML etiket dizisini taşımalı; boş olamaz.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const en = JSON.parse(readFileSync(join(root, 'i18n/en.json'), 'utf8'));
let failed = false;
const fail = (m) => { failed = true; console.error('HATA:', m); };

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'i18n' ? [] : walk(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}
const files = walk(root);
const sources = files.map((f) => [f, readFileSync(f, 'utf8')]);

const used = new Set();
const callRe = /(?<![\w.$])(?:t|tr)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
for (const [f, src] of sources) {
  for (const m of src.matchAll(callRe)) {
    const raw = m[2];
    if (m[1] === '`' && raw.includes('${')) { fail(`${f.replace(root, 'src/')}: şablon dizgisi anahtar olamaz ("\${" içeriyor): ${raw.slice(0, 70)}`); continue; }
    let key;
    try { key = new Function(`return ${m[1]}${raw}${m[1]}`)(); } catch { fail(`${f.replace(root, 'src/')}: çözümlenemeyen dizgi ${raw.slice(0, 70)}`); continue; }
    used.add(key);
    if (!(key in en)) fail(`${f.replace(root, 'src/')}: en.json'da yok: ${JSON.stringify(key).slice(0, 110)}`);
  }
}

// index.html: data-i18n öğelerinin metni ve data-i18n-aria öğelerinin aria-label'ı da anahtardır.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
for (const m of html.matchAll(/<[^>]*\bdata-i18n(?!-aria)\b[^>]*>([^<]*)</g)) { used.add(m[1]); if (!(m[1] in en)) fail(`index.html: en.json'da yok: ${JSON.stringify(m[1])}`); }
for (const m of html.matchAll(/<[^>]*\bdata-i18n-aria\b[^>]*>/g)) {
  const a = /aria-label="([^"]*)"/.exec(m[0]);
  if (!a) { fail(`index.html: data-i18n-aria var ama aria-label yok: ${m[0].slice(0, 80)}`); continue; }
  used.add(a[1]);
  if (!(a[1] in en)) fail(`index.html: en.json'da yok: ${JSON.stringify(a[1])}`);
}

// Kullanılmayan girdiler: anahtar kaynakta herhangi bir dizgi içinde (kaçışlar kaldırılmış) geçmiyorsa.
const norm = [...sources.map(([, s]) => s), html].map((s) => s.replace(/\\(['"`])/g, '$1')).join('\n');
const holders = (k) => k.replace(/\{(\w+)\}/g, '{$1}');
for (const k of Object.keys(en)) {
  if (!used.has(k) && !norm.includes(holders(k))) fail(`en.json'da kullanılmayan girdi: ${JSON.stringify(k).slice(0, 110)}`);
}

const phs = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => (s.match(/<[^>]+>/g) ?? []).join('');
for (const [k, v] of Object.entries(en)) {
  if (typeof v !== 'string' || !v.trim()) { fail(`boş/geçersiz çeviri: ${JSON.stringify(k).slice(0, 90)}`); continue; }
  if (phs(k) !== phs(v)) fail(`yer tutucular farklı: ${JSON.stringify(k).slice(0, 90)} → ${JSON.stringify(v).slice(0, 90)}`);
  if (tags(k) !== tags(v)) fail(`HTML etiketleri farklı: ${JSON.stringify(k).slice(0, 90)} → ${JSON.stringify(v).slice(0, 90)}`);
}

if (failed) process.exit(1);
console.log(`Çeviri denetimi geçti: ${Object.keys(en).length} girdi, ${used.size} farklı t() anahtarı.`);
