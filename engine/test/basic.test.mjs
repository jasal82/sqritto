import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../dist/engine.js', import.meta.url), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code + ';globalThis.SqrittoEngine = SqrittoEngine;', ctx);
const E = ctx.SqrittoEngine;

const callout = {
  name: 'callout',
  attributes: { type: { type: 'String', default: 'note' }, title: { type: 'String' } },
  html: '<div class="ts-callout ts-callout--{{type}}">{{#title}}<p class="ts-callout__title">{{title}}</p>{{/title}}{{{children}}}</div>',
};

function build(pages, extra = {}) {
  return JSON.parse(E.buildJson(JSON.stringify({ pages, components: [callout], targets: { typst: true, html: true }, ...extra })));
}

const has = (hay, needle) => assert.ok(hay.includes(needle), `erwartet:\n${needle}\n\nin:\n${hay}`);

test('überschriften, absätze, escaping', () => {
  const out = build([{ path: 'content/index.mdoc', source: '# Hallo *Welt*\n\nPreis: 5 $ #tag @ref <x> [a] a_b // c\n\n- eins\n- zwei\n' }]);
  assert.equal(out.diagnostics.length, 0, JSON.stringify(out.diagnostics));
  has(out.typst, '= Hallo #emph[Welt]; <index:hallo-welt>');
  has(out.typst, String.raw`Preis: 5 \$ \#tag \@ref \<x\> \[a\] a\_b \/\/ c`);
  has(out.typst, '#list(tight: true,');
  has(out.pages[0].html, '<h1 id="hallo-welt">Hallo <em>Welt</em>');
});

test('komponenten und github-hinweise', () => {
  const out = build([{ path: 'content/a.mdoc', source: '{% callout type="warning" title="Achtung" %}\nText **fett**\n{% /callout %}\n\n> [!TIP]\n> Ein Tipp\n' }]);
  assert.equal(out.diagnostics.length, 0, JSON.stringify(out.diagnostics));
  has(out.typst, '#ts-callout(type: "warning", title: "Achtung")[');
  has(out.typst, '#ts-callout(type: "tip")[');
  has(out.pages[0].html, 'ts-callout--warning');
  has(out.pages[0].html, 'ts-callout--tip');
});

test('links zwischen seiten und code', () => {
  const out = build([
    { path: 'content/index.mdoc', source: '# Start\n\nSiehe [Installation](install.mdoc#voraussetzungen) und [kaputt](nope.mdoc).\n\n```rust {% title="main.rs" %}\nfn main() {}\n```\n' },
    { path: 'content/install.mdoc', source: '# Installation\n\n## Voraussetzungen\n\nText' },
  ]);
  has(out.typst, '#link(<install:voraussetzungen>)[Installation];');
  has(out.typst, '#ts-broken-link[kaputt];');
  has(out.typst, '#ts-code(lang: "rust", title: "main.rs", "fn main() {}")');
  has(out.pages[0].html, 'href="install.html#voraussetzungen"');
  assert.ok(out.diagnostics.some((d) => d.message.includes('nope.mdoc')));
});

test('tabellen, bilder, variablen, fehler', () => {
  const out = build(
    [{ path: 'content/index.mdoc', source: '| A | B |\n|:--|--:|\n| 1 | 2 |\n\n![Logo](../assets/logo.png "Unser Logo")\n\n{% $product %} {% $missing %}\n\n{% unbekannt %}x{% /unbekannt %}\n' }],
    { variables: { product: 'Sqritto' } },
  );
  has(out.typst, '#ts-table(\n  columns: 2,\n  align: (left, right),');
  has(out.typst, '#ts-figure(path("/assets/logo.png"), alt: "Logo", caption: [Unser Logo])');
  has(out.typst, 'Sqritto');
  assert.deepEqual(out.assets, ['assets/logo.png']);
  assert.ok(out.diagnostics.some((d) => d.level === 'error' && /missing/.test(d.message)), JSON.stringify(out.diagnostics));
  assert.ok(out.diagnostics.some((d) => /unbekannt/.test(d.message)));
});

test('site-shell und suchindex', () => {
  const out = build(
    [
      { path: 'content/index.mdoc', source: '---\ntitle: Überblick\n---\n# Willkommen\n\n## Erste Schritte\n\nInstallieren Sie das Paket.' },
      { path: 'content/guide.mdoc', source: '# Anleitung\n\nMehr Text.' },
    ],
    {
      site: { title: 'Handbuch', lang: 'de', staticBase: '_static/', extraCss: [], extraJs: [], preview: false },
      nav: [
        { title: 'Start', pages: ['content/index.mdoc'] },
        { title: 'Leitfaden', pages: ['content/guide.mdoc'] },
      ],
    },
  );
  // Erzeugte Startseite mit Titelbereich und Kapitelübersicht
  const home = out.pages.find((p) => p.slug === 'index').document;
  has(home, '<title>Handbuch</title>');
  has(home, 'class="ts-hero"');
  has(home, 'class="ts-chapters"');
  has(home, '<a class="ts-chapter__link" href="ueberblick.html">');
  has(home, '<a class="ts-chapter__link" href="guide.html">');
  has(home, 'href="ueberblick.html" rel="next"');
  // index.mdoc wird zur ersten Kapitelseite (Name nach dem Titel)
  const intro = out.pages.find((p) => p.path === 'content/index.mdoc');
  assert.equal(intro.slug, 'ueberblick');
  has(intro.document, '<title>Überblick · Handbuch</title>');
  has(intro.document, 'Lesezeit');
  has(intro.document, 'href="index.html" rel="prev"');
  const idx = JSON.parse(out.searchIndex);
  assert.equal(idx.version, 1);
  assert.ok(idx.index.documentCount >= 3);
});

test('site-shell ohne startseite', () => {
  const out = build(
    [
      { path: 'content/index.mdoc', source: '---\ntitle: Überblick\n---\n# Willkommen\n\n## Erste Schritte\n\nInstallieren Sie das Paket.' },
      { path: 'content/guide.mdoc', source: '# Anleitung\n\nMehr Text.' },
    ],
    { site: { title: 'Handbuch', lang: 'de', staticBase: '_static/', extraCss: [], extraJs: [], preview: false, landing: false } },
  );
  const doc = out.pages[0].document;
  has(doc, '<title>Überblick · Handbuch</title>');
  has(doc, 'Auf dieser Seite');
  assert.ok(!doc.includes('class="ts-hero"'));
});

test('startseite wird erzeugt, wenn index fehlt', () => {
  const out = build(
    [
      { path: 'content/a.mdoc', source: '# Erstes Kapitel\n\nEinleitung des ersten Kapitels.' },
      { path: 'content/b.mdoc', source: '# Zweites Kapitel\n\nText.' },
    ],
    { site: { title: 'Handbuch', lang: 'de', staticBase: '_static/', extraCss: [], extraJs: [], preview: false } },
  );
  const home = out.pages.find((p) => p.slug === 'index');
  assert.ok(home, 'Startseite fehlt');
  has(home.document, 'Lesen beginnen');
  has(home.document, 'Einleitung des ersten Kapitels.');
});

test('englische site-shell', () => {
  const site = { title: 'Handbook', lang: 'en', staticBase: '_static/', extraCss: [], extraJs: [], preview: false, version: '1.0', date: '26.10.2026', pdfDownload: 'doc.pdf' };
  const out = build(
    [
      { path: 'content/a.mdoc', source: '# First chapter\n\nIntro text.\n\n## Setup\n\nText.\n\n## Usage\n\n- [x] done\n- [ ] open\n' },
      { path: 'content/b.mdoc', source: '# Second chapter\n\nText.' },
    ],
    { site },
  );
  assert.equal(out.diagnostics.length, 0, JSON.stringify(out.diagnostics));
  const home = out.pages.find((p) => p.slug === 'index').document;
  has(home, '<html lang="en">');
  has(home, '<span>Start reading</span>');
  has(home, 'id="ts-chapters-title">Contents</h2>');
  has(home, '2 chapters');
  has(home, 'min read');
  has(home, 'Version 1.0 · Updated October 26, 2026');
  has(home, 'Built with Sqritto');
  const page = out.pages.find((p) => p.slug === 'a').document;
  has(page, '<span>On this page</span>');
  has(page, 'Skip to content');
  has(page, 'aria-label="Link to this section"');
  has(page, '<span class="ts-sr">Done: </span>');
  has(page, '<small>Previous</small>');
  has(page, '<small>Next</small>');
  has(page, '<span>Download PDF</span>');
  has(page, 'data-ts-shortcut>Ctrl K</kbd>');
  for (const de of ['Auf dieser Seite', 'Lesezeit', 'Übersicht', 'Erstellt mit', 'Zurück', 'Strg']) {
    assert.ok(!page.includes(de) && !home.includes(de), `deutscher Text „${de}“ in englischer Site`);
  }
});

test('andere dokumentsprachen erhalten englische beschriftungen', () => {
  const out = build([{ path: 'content/a.mdoc', source: '# Titre\n\n## Section\n\nTexte.\n\n## Autre\n\nTexte.' }], {
    site: { title: 'Manuel', lang: 'fr', staticBase: '_static/', extraCss: [], extraJs: [], preview: false },
  });
  const doc = out.pages[0].document;
  has(doc, '<html lang="fr">');
  has(doc, 'On this page');
});

test('elementvorlagen und today() folgen der dokumentsprache', () => {
  const label = { name: 'label', selfClosing: true, attributes: {}, html: '<span class="l">{{#docLang=de}}Hinweis{{/docLang=de}}{{#docLang=en}}Note{{/docLang=en}}</span>' };
  const run = (lang) =>
    JSON.parse(
      E.buildJson(
        JSON.stringify({
          pages: [{ path: 'content/a.mdoc', source: '{% label /%}\n\nStand: {% today() %}' }],
          components: [label],
          variables: { document: { lang } },
          targets: { html: true },
        }),
      ),
    ).pages[0].html;
  const en = run('en');
  has(en, '<span class="l">Note</span>');
  assert.match(en, /Stand: (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/);
  const de = run('de');
  has(de, '<span class="l">Hinweis</span>');
  assert.match(de, /Stand: \d{2}\.\d{2}\.\d{4}/);
});

test('meldungen in der sprache der oberfläche', () => {
  const source = '# Start\n\n[kaputt](nope.mdoc)\n\n{% unbekannt %}x{% /unbekannt %}\n';
  // Ohne Host: Deutsch
  const de = build([{ path: 'content/index.mdoc', source }]);
  assert.ok(de.diagnostics.some((d) => d.message === 'Unbekanntes Element: `unbekannt`'), JSON.stringify(de.diagnostics));
  assert.ok(de.diagnostics.some((d) => d.message === 'Verweisziel „nope.mdoc“ wurde nicht gefunden.'), JSON.stringify(de.diagnostics));
  ctx.__host = { uiLang: () => 'en' };
  try {
    const en = build([{ path: 'content/index.mdoc', source }]);
    assert.ok(en.diagnostics.some((d) => d.message === 'Unknown element: `unbekannt`'), JSON.stringify(en.diagnostics));
    assert.ok(en.diagnostics.some((d) => d.message === 'Link target “nope.mdoc” was not found.'), JSON.stringify(en.diagnostics));
    // Die Dokumentsprache bleibt davon unberührt.
    has(en.pages[0].html, 'aria-label="Direktlink zu diesem Abschnitt"');
  } finally {
    delete ctx.__host;
  }
});
