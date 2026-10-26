// Sammelt die Lizenztexte aller Bestandteile Dritter, die im Programm landen
// (Rust-Crates, npm-Pakete der Oberfläche, der HTML5-Site und der Markdoc-Engine,
// eingebettete Syntaxdefinitionen und Farbschemata, mitgelieferte Schriften),
// in einer Datei für Binärpakete.
//
// Aufruf: node scripts/third-party-licenses.mjs [Ausgabedatei]   (Standard: dist/THIRD-PARTY-LICENSES.txt)

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const PRODUCT = 'Sqritto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.argv[2] ?? 'dist/THIRD-PARTY-LICENSES.txt');
const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._].*)?$/i;

/** Lizenztexte im Paketordner (nur oberste Ebene). */
function licenseTexts(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile());
  } catch {
    return [];
  }
  return names.sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim());
}

function rustPackages() {
  const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
  const meta = JSON.parse(
    execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', host], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    }),
  );
  // Alles, was von sqritto über normale Abhängigkeiten erreichbar ist (ohne Build-
  // und Dev-Abhängigkeiten, die nicht im Programm landen).
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const own = meta.packages.find((p) => p.name === 'sqritto');
  const reachable = new Set();
  const visit = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null)) visit(dep.pkg);
    }
  };
  visit(own.id);
  return meta.packages
    .filter((p) => reachable.has(p.id) && p.id !== own.id)
    .map((p) => ({
      name: `${p.name} ${p.version}`,
      crate: p.name,
      dir: path.dirname(p.manifest_path),
      license: p.license ?? 'siehe Lizenzdatei',
      url: p.repository ?? '',
      texts: licenseTexts(path.dirname(p.manifest_path)),
    }));
}

/**
 * Syntaxdefinitionen und Farbschemata, die two-face ins Programm einbettet. Ihre
 * Lizenzen liegen dem Crate nur als komprimierte Datenbank bei (zlib + bincode 1:
 * Vec-Längen als u64, Enum-Varianten als u32, Little Endian).
 */
function embeddedHighlighting(rust) {
  const twoFace = rust.find((p) => p.crate === 'two-face');
  if (!twoFace) return [];
  const data = zlib.inflateSync(fs.readFileSync(path.join(twoFace.dir, 'generated/acknowledgements_full.bin')));
  let pos = 0;
  const u64 = () => {
    const value = Number(data.readBigUInt64LE(pos));
    pos += 8;
    return value;
  };
  const str = () => {
    const length = u64();
    const value = data.toString('utf8', pos, pos + length);
    pos += length;
    return value;
  };
  const TYPES = ['Sublime', 'MIT', 'BSD-2-Clause', 'BSD-2-Clause-FreeBSD', 'Unlicense', 'BSD-3-Clause', 'Apache-2.0', 'WTFPL'];
  const list = () =>
    Array.from({ length: u64() }, () => {
      const type = TYPES[data.readUInt32LE((pos += 4) - 4)];
      const text = str().replace(/\r\n/g, '\n').trim();
      const file = str();
      if (!type) throw new Error('Unbekanntes Format der two-face-Lizenzdaten');
      return { name: `${twoFace.name}: ${file.replace(/\/[^/]*$/, '')}`, license: type, url: '', texts: [text] };
    });
  const out = [...list(), ...list()];
  if (pos !== data.length) throw new Error('Unbekanntes Format der two-face-Lizenzdaten');
  // InspiredGitHub stammt aus den Standarddaten von syntect und fehlt in der Liste.
  out.push({
    name: `${twoFace.name}: themes/InspiredGitHub`,
    license: 'MIT',
    url: 'https://github.com/sethlopezme/InspiredGitHub.tmtheme',
    texts: [fs.readFileSync(path.join(root, 'third-party/InspiredGitHub-LICENSE.txt'), 'utf8').replace(/\r\n/g, '\n').trim()],
  });
  return out;
}

function npmPackages() {
  // Produktionsabhängigkeiten aller Workspaces (engine, site, web).
  const dirs = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
    .trim()
    .split(/\r?\n/)
    // Die eigenen Workspace-Pakete sind unter node_modules nur verlinkt.
    .filter((dir) => fs.realpathSync(dir).split(/[\\/]/).includes('node_modules'));
  const seen = new Map();
  for (const dir of dirs) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const name = `${pkg.name} ${pkg.version}`;
    if (seen.has(name)) continue;
    const license =
      typeof pkg.license === 'string' ? pkg.license : (pkg.licenses ?? []).map((l) => l.type ?? l).join(' OR ') || 'siehe Lizenzdatei';
    const repo = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
    seen.set(name, { name, license, url: repo, texts: licenseTexts(dir) });
  }
  return [...seen.values()];
}

/** Gruppiert Pakete mit identischem Lizenztext, damit jeder Text nur einmal erscheint. */
function render(title, packages) {
  const groups = new Map();
  const withoutText = [];
  for (const p of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    if (p.texts.length === 0) {
      withoutText.push(p);
      continue;
    }
    // Unterschiede in Zeilenumbrüchen und Einrückung zählen nicht.
    for (const text of p.texts) {
      const key = text.replace(/\s+/g, ' ');
      if (!groups.has(key)) groups.set(key, { text, list: [] });
      groups.get(key).list.push(p);
    }
  }
  const rule = '='.repeat(80);
  const line = (p) => `${p.name} – ${p.license}${p.url ? ` – ${p.url}` : ''}`;
  let out = `\n${rule}\n${title} (${packages.length})\n${rule}\n`;
  for (const { text, list } of groups.values()) {
    out += `\n${'-'.repeat(80)}\n${list.map(line).join('\n')}\n${'-'.repeat(80)}\n\n${text}\n`;
  }
  if (withoutText.length) {
    out += `\n${'-'.repeat(80)}\nOhne eigene Lizenzdatei im Paket (Lizenz laut Paketangabe; Standardtexte unter https://spdx.org/licenses/):\n${'-'.repeat(80)}\n`;
    out += withoutText.map(line).join('\n') + '\n';
  }
  return out;
}

/** Lizenzen der Schriften unter assets/fonts (PDF-Vorlagen und Oberfläche). */
function fonts() {
  const dir = path.join(root, 'assets/fonts');
  const rule = '-'.repeat(80);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('-LICENSE.txt'))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim();
      return `${rule}\n${f.replace(/-LICENSE\.txt$/, '')} (assets/fonts)\n${rule}\n\n${text}\n`;
    })
    .join('\n');
}

const rust = rustPackages();
const npm = npmPackages();
const highlighting = embeddedHighlighting(rust);

let text = `${PRODUCT} – Lizenzen von Drittanbieter-Komponenten
${'='.repeat(PRODUCT.length + 41)}

${PRODUCT} steht unter der Apache License 2.0 (siehe LICENSE.txt); Vorlagen, Elemente und
die Laufzeit der HTML5-Ausgabe stehen unter MIT-0. Das Programm enthält die folgenden
Komponenten Dritter, die jeweils unter ihren eigenen Lizenzen stehen. Die von Typst
mitgelieferten Schriften sind beim Paket typst-assets aufgeführt, die Icons der
Oberfläche und der HTML5-Ausgabe beim Paket lucide-react.
`;
text += render('Rust-Bibliotheken (Programm, Typst, Server)', rust);
text += render('JavaScript-Bibliotheken (Oberfläche, HTML5-Site, Markdoc-Engine)', npm);
text += render('Syntaxdefinitionen und Farbschemata der Code-Hervorhebung (über two-face)', highlighting);
text += `\n${'='.repeat(80)}\nSchriften\n${'='.repeat(80)}\n\n${fonts()}`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, text);
console.log(
  `${path.relative(root, output)}: ${rust.length} Rust-Pakete, ${npm.length} npm-Pakete, ` +
    `${highlighting.length} Syntaxdefinitionen/Farbschemata, ${(text.length / 1024).toFixed(0)} KB`,
);
