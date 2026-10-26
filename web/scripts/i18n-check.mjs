// Prüft die Übersetzungen der Oberfläche:
//  - jeder Text in t('…') hat einen englischen Eintrag in src/i18n/en/*.ts
//  - t() bekommt nur feste Zeichenketten (keine zusammengesetzten Texte)
//  - Einträge ohne Verwendung werden gemeldet (Hinweis, kein Fehler)
//
// Aufruf: node web/scripts/i18n-check.mjs [--unused]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(root);

// Zeichenkette in JS-Quelltext auswerten ('…', "…" oder `…` ohne ${}).
function unquote(raw) {
  const q = raw[0];
  const body = raw.slice(1, -1);
  if (q === '`') return body.replace(/\\`/g, '`').replace(/\\\\/g, '\\');
  return JSON.parse('"' + body.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"') + '"');
}

const dictDir = path.join(root, 'i18n', 'en');
const dict = new Map();
for (const f of fs.readdirSync(dictDir).filter((f) => f.endsWith('.ts'))) {
  const text = fs.readFileSync(path.join(dictDir, f), 'utf8');
  // Schlüssel: 'Text': oder "Text": oder Bezeichner:
  for (const m of text.matchAll(/^\s*(?:(['"])((?:\\.|(?!\1).)*)\1|([\p{L}_$][\p{L}\p{N}_$]*))\s*:/gmu)) {
    const key = m[3] ?? unquote(m[1] + m[2] + m[1]);
    dict.set(key, f);
  }
}

const used = new Set();
const missing = [];
const dynamic = [];
const call = /\bt\(\s*(?:(['"`])((?:\\.|(?!\1)[\s\S])*?)\1|([^)'"`\s][^,)]*))/g;
for (const file of files) {
  if (file.includes(`${path.sep}i18n${path.sep}`) || file.endsWith(`${path.sep}i18n.ts`)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(call)) {
    const line = text.slice(0, m.index).split('\n').length;
    const where = `${path.relative(root, file)}:${line}`;
    if (m[3] !== undefined || (m[1] === '`' && m[2].includes('${'))) {
      dynamic.push(`${where}  t(${(m[3] ?? '`' + m[2] + '`').slice(0, 60)})`);
      continue;
    }
    const key = unquote(m[1] + m[2] + m[1]);
    used.add(key);
    if (!dict.has(key)) missing.push(`${where}  ${JSON.stringify(key)}`);
  }
}

if (dynamic.length) console.log(`Zusammengesetzte Texte in t() (bitte {platzhalter} verwenden):\n  ${dynamic.join('\n  ')}\n`);
if (missing.length) console.log(`Fehlende englische Texte (${missing.length}):\n  ${missing.join('\n  ')}\n`);
if (process.argv.includes('--unused')) {
  const unused = [...dict.keys()].filter((k) => !used.has(k));
  if (unused.length) console.log(`Nicht verwendete Einträge (${unused.length}):\n  ${unused.map((k) => `${dict.get(k)}: ${JSON.stringify(k)}`).join('\n  ')}\n`);
}
console.log(`${used.size} Texte verwendet, ${dict.size} englische Einträge, ${missing.length} fehlen, ${dynamic.length} zusammengesetzt.`);
process.exit(missing.length || dynamic.length ? 1 : 0);
