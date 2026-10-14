// README.md (Türkçe) ve README.en.md (İngilizce) eşgüdüm denetimi: `npm run check-readme`.
// Denetler: rakam dizileri çokluğu, başlık / tablo satırı / görüntü sayıları, `](#...)` bağlantılarının çözülmesi, `docs/` görüntülerinin varlığı.
// Dil bağlantısı satırları ve ilk not iki dosyada farklı olduğundan karşılaştırma bunları dışarıda bırakır (Türkçe: ilk "> " notuna kadar; İngilizce: aynı).
import { existsSync, readFileSync } from 'node:fs';

const files = { tr: 'README.md', en: 'README.en.md' };
const text = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')]));
let failed = false;
const fail = (m) => { failed = true; console.error('HATA:', m); };

// Giriş: "# başlık", dil satırı ve ilk not ("> ...") farklıdır; ilk "## " başlığından itibaren karşılaştır.
const body = (t) => t.slice(t.indexOf('\n## '));
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
const count = (t, re) => (t.match(re) ?? []).length;

const digits = (t) => {
  const m = new Map();
  for (const d of body(t).replace(/\]\(#[^)]*\)/g, '](#)').replace(/\(docs\/[^)]*\)/g, '(docs/)').match(/\d+/g) ?? []) m.set(d, (m.get(d) ?? 0) + 1);
  return m;
};
const a = digits(text.tr), b = digits(text.en);
const diff = [];
for (const k of new Set([...a.keys(), ...b.keys()])) if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) diff.push(`${k}: TR ${a.get(k) ?? 0} / EN ${b.get(k) ?? 0}`);
if (diff.length) fail(`rakam dizileri farklı (ilk 20): ${diff.slice(0, 20).join('; ')}`);

for (const [name, re] of [['## / ### başlık', /^#{2,3} /gm], ['tablo satırı', /^\|/gm], ['görüntü', /!\[/g]]) {
  const x = count(body(text.tr), re), y = count(body(text.en), re);
  if (x !== y) fail(`${name} sayısı farklı: TR ${x} / EN ${y}`);
}

for (const [k, t] of Object.entries(text)) {
  const heads = new Set([...t.matchAll(/^#{1,6} (.*)$/gm)].map((m) => slug(m[1])));
  for (const m of t.matchAll(/\]\(#([^)]*)\)/g)) if (!heads.has(m[1])) fail(`${files[k]}: çözülmeyen bağlantı #${m[1]}`);
  for (const m of t.matchAll(/\((docs\/[^)]*)\)/g)) if (!existsSync(new URL(`../${m[1]}`, import.meta.url))) fail(`${files[k]}: eksik görüntü ${m[1]}`);
}

if (failed) process.exit(1);
console.log('README.md ve README.en.md tutarlı.');
