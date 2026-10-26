// SPDX-License-Identifier: MIT-0
// Baut die Laufzeit der exportierten HTML5-Site:
//   dist/site.js       – Navigation, Suche, Inhaltsverzeichnis, Vorschau-Protokoll
//   dist/site.css      – Gestaltung (hell/dunkel, responsiv, Druck)
//   dist/fonts/        – Inter (variabel mit optischen Größen) und JetBrains Mono als WOFF2
//   dist/LICENSES.txt  – Lizenzhinweise, liegen jedem Export unter _static/ bei
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCT = 'Sqritto';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const dist = join(here, 'dist');

/** Paketordner auch für Pakete, die `package.json` nicht exportieren. */
function packageDir(name) {
  let dir = dirname(require.resolve(name));
  while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Paketordner von ${name} nicht gefunden`);
    dir = parent;
  }
  return dir;
}
const packageVersion = (name) => JSON.parse(readFileSync(join(packageDir(name), 'package.json'), 'utf8')).version;

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'fonts'), { recursive: true });

// Die Kopfkommentare bleiben trotz Minifizierung erhalten und verweisen auf die Lizenzhinweise.
await build({
  entryPoints: [join(here, 'src/site.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  banner: { js: `/*! ${PRODUCT} site runtime, MIT-0. Includes MiniSearch (MIT) and Lucide icons (ISC). License notices: LICENSES.txt */` },
  outfile: join(dist, 'site.js'),
  logLevel: 'info',
});

await build({
  entryPoints: [join(here, 'src/site.css')],
  bundle: true,
  minify: true,
  legalComments: 'none',
  target: ['chrome100', 'firefox100', 'safari15'],
  external: ['fonts/*'],
  banner: {
    css: `/*! ${PRODUCT} site styles, MIT-0. Includes Lucide icons (ISC), the fonts Inter and JetBrains Mono (OFL-1.1) and syntax colors after InspiredGitHub and One Half (MIT). License notices: LICENSES.txt */`,
  },
  outfile: join(dist, 'site.css'),
  logLevel: 'info',
});

const fonts = [
  ['@fontsource-variable/inter', 'inter-latin-standard-normal.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-ext-standard-normal.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-standard-italic.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-ext-standard-italic.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-ext-400-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-ext-700-normal.woff2'],
];
for (const [pkg, file] of fonts) {
  copyFileSync(join(packageDir(pkg), 'files', file), join(dist, 'fonts', file));
}
console.log(`  ${fonts.length} Schriftdateien kopiert`);

// ---------------------------------------------------------------------------
// Lizenzhinweise (_static/LICENSES.txt jeder exportierten Site)
//
// Alles, was aus dem Programm in eine Site gelangt (Gestaltung, Laufzeit,
// Seitenrahmen, Elemente), steht unter MIT-0 und braucht keinen Hinweis. Die
// Bestandteile Dritter dagegen schon: Wer hier etwas ergänzt (neue Bibliothek,
// Schrift, Icons), trägt es in diese Liste ein.
// ---------------------------------------------------------------------------
const thirdParty = [
  {
    name: `MiniSearch ${packageVersion('minisearch')}`,
    use: 'Volltextsuche / full-text search (site.js)',
    license: 'MIT',
    file: join(packageDir('minisearch'), 'LICENSE.txt'),
  },
  {
    name: 'Lucide',
    use: 'Icons (site.js, site.css, Seitenrahmen / page frame)',
    license: 'ISC, einzelne Icons / some icons: MIT (Feather)',
    file: join(root, 'third-party/Lucide-LICENSE.txt'),
  },
  {
    name: `Inter (@fontsource-variable/inter ${packageVersion('@fontsource-variable/inter')})`,
    use: 'Schrift / font (fonts/inter-*)',
    license: 'OFL-1.1',
    file: join(packageDir('@fontsource-variable/inter'), 'LICENSE'),
  },
  {
    name: `JetBrains Mono (@fontsource/jetbrains-mono ${packageVersion('@fontsource/jetbrains-mono')})`,
    use: 'Schrift für Code / code font (fonts/jetbrains-mono-*)',
    license: 'OFL-1.1',
    file: join(packageDir('@fontsource/jetbrains-mono'), 'LICENSE'),
  },
  {
    name: 'InspiredGitHub',
    use: 'Farben der Syntaxhervorhebung, hell / syntax colors, light (site.css)',
    license: 'MIT',
    file: join(root, 'third-party/InspiredGitHub-LICENSE.txt'),
  },
  {
    name: 'One Half Dark',
    use: 'Farben der Syntaxhervorhebung, dunkel / syntax colors, dark (site.css)',
    license: 'MIT',
    file: join(root, 'third-party/OneHalf-LICENSE.txt'),
  },
];

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
const rule = '-'.repeat(78);
let notices = `Lizenzhinweise / License notices
================================

Die Inhalte dieser Website gehören ihren Autorinnen und Autoren. Gestaltung,
Skripte und Seitenrahmen stammen aus ${PRODUCT} und stehen unter MIT-0: Sie dürfen
ohne Namensnennung verwendet, verändert und weitergegeben werden. Für die
folgenden Bestandteile Dritter gelten deren Lizenzen.

The content of this website belongs to its authors. Layout, scripts and page
frame come from ${PRODUCT} and are licensed under MIT-0 (no attribution
required). The third-party components listed below are subject to their own
licenses.

`;
for (const p of thirdParty) notices += `  - ${p.name}: ${p.use} – ${p.license}\n`;
for (const p of thirdParty) notices += `\n${rule}\n${p.name} – ${p.license}\n${rule}\n\n${read(p.file)}\n`;
notices += `\n${rule}\n${PRODUCT} – MIT-0\n${rule}\n\n${read(join(root, 'LICENSE-MIT-0'))}\n`;
writeFileSync(join(dist, 'LICENSES.txt'), notices);
console.log(`  LICENSES.txt mit ${thirdParty.length} Bestandteilen Dritter`);
