// Prüft, ob der generierte Typst-Code mit allen eingebauten Komponenten
// kompiliert. Aufruf: node engine/test/typst-compile.mjs <ausgabeordner>
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const out = process.argv[2] ?? join(root, 'target', 'typst-test');
mkdirSync(join(out, '__sqritto__', 'components'), { recursive: true });
mkdirSync(join(out, 'assets'), { recursive: true });

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'engine/dist/engine.js'), 'utf8') + ';globalThis.E = SqrittoEngine;', ctx);

const compDir = join(root, 'assets/components');
const components = [];
const imports = [];
for (const name of readdirSync(compDir)) {
  const dir = join(compDir, name);
  const def = JSON.parse(readFileSync(join(dir, 'component.json'), 'utf8'));
  def.html = readFileSync(join(dir, 'template.html'), 'utf8');
  components.push(def);
  if (existsSync(join(dir, 'template.typ'))) {
    copyFileSync(join(dir, 'template.typ'), join(out, '__sqritto__', 'components', `${name}.typ`));
    imports.push(`#import "/__sqritto__/components/${name}.typ": *`);
  }
}

// kleines PNG für Bildtests
writeFileSync(
  join(out, 'assets', 'pixel.png'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
);

const sample = readFileSync(new URL('./sample.mdoc', import.meta.url), 'utf8');
const res = JSON.parse(
  ctx.E.buildJson(
    JSON.stringify({
      pages: [
        { path: 'content/index.mdoc', source: sample },
        { path: 'content/zweite.mdoc', source: '# Zweite Seite\n\n## Unterabschnitt\n\nZurück zum [Anfang](index.mdoc).' },
      ],
      components,
      variables: { produkt: 'Sqritto', version: '1.0' },
      targets: { typst: true, html: true },
    }),
  ),
);
for (const d of res.diagnostics) console.log(`[${d.level}] ${d.path}:${d.line ?? '?'} ${d.message}`);

const main = [
  '#import "@sqritto/markdoc:0.1.0": *',
  ...imports,
  '#show: ts-document.with(title: "Testdokument", authors: ("Sqritto",))',
  '',
  res.typst,
].join('\n');
writeFileSync(join(out, 'main.typ'), main);
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset=utf-8><body>${res.pages.map((p) => p.html).join('<hr>')}`);
try {
  execFileSync('typst', ['compile', '--root', out, '--package-path', join(root, 'assets/typst'), '--font-path', join(root, 'assets/fonts'), join(out, 'main.typ'), join(out, 'main.pdf')], { stdio: 'inherit' });
  console.log('OK: ' + join(out, 'main.pdf'));
} catch {
  process.exitCode = 1;
}
