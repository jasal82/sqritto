// Erzeugt eine Beispiel-Site zum Prüfen der Laufzeit und Gestaltung.
// Aufruf: node site/test/generate.mjs <ausgabeordner> [--preview]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = process.argv[2] ?? join(root, 'target', 'site-test');
const preview = process.argv.includes('--preview');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, '_static', 'fonts'), { recursive: true });
mkdirSync(join(out, 'assets'), { recursive: true });

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'engine/dist/engine.js'), 'utf8') + ';globalThis.E = SqrittoEngine;', ctx);

const compDir = join(root, 'assets/components');
const components = [];
let css = readFileSync(join(root, 'site/dist/site.css'), 'utf8');
let js = readFileSync(join(root, 'site/dist/site.js'), 'utf8');
for (const name of readdirSync(compDir)) {
  const dir = join(compDir, name);
  const def = JSON.parse(readFileSync(join(dir, 'component.json'), 'utf8'));
  def.html = readFileSync(join(dir, 'template.html'), 'utf8');
  components.push(def);
  if (existsSync(join(dir, 'style.css'))) css += `\n/* ${name} */\n` + readFileSync(join(dir, 'style.css'), 'utf8');
  if (existsSync(join(dir, 'script.js'))) js += `\n/* ${name} */\n;` + readFileSync(join(dir, 'script.js'), 'utf8');
}
// Einfache Hervorhebung als Ersatz für den Rust-Host.
css += `
.hl-keyword,.hl-storage{color:#cf222e}.hl-string{color:#0a3069}.hl-comment{color:#6e7781;font-style:italic}.hl-entity{color:#8250df}.hl-constant{color:#0550ae}
:root[data-theme="dark"] .hl-keyword,:root[data-theme="dark"] .hl-storage{color:#ff7b72}:root[data-theme="dark"] .hl-string{color:#a5d6ff}:root[data-theme="dark"] .hl-entity{color:#d2a8ff}`;
ctx.__host = {
  highlight(code, lang) {
    if (!['bash', 'rust', 'powershell', 'js', 'ts', 'json'].includes(lang)) return null;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(code)
      .split(/(\s+)/)
      .map((w) => (/^(fn|let|const|use|pub|struct|impl|return|if|else|echo|curl|winget|install|export)$/.test(w) ? `<span class="hl-keyword">${w}</span>` : w))
      .join('');
  },
};
vm.runInContext('globalThis.__host = __host', ctx);

writeFileSync(
  join(out, 'assets', 'pixel.png'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==', 'base64'),
);

const lorem =
  'Sqritto verbindet Docs-as-Code mit hochwertiger Typografie. Inhalte werden in Markdoc geschrieben, versioniert und automatisch als PDF sowie als durchsuchbare HTML5-Site veröffentlicht. Jede Änderung ist nachvollziehbar, jedes Ergebnis reproduzierbar.';
const longPage = [
  '---\ntitle: Installation\ndescription: Sqritto auf Windows, macOS und Linux installieren.\n---',
  '# Installation',
  'Diese Anleitung führt Sie durch die Installation und Erstkonfiguration von Sqritto.',
  ...['Voraussetzungen', 'Herunterladen', 'Einrichtung', 'Erster Start', 'Aktualisierung', 'Deinstallation'].flatMap((h, i) => [
    `## ${h}`,
    lorem,
    i % 2 ? `### Details zu ${h}\n\n${lorem}\n\n- Punkt eins\n- Punkt zwei mit \`code\`\n- Punkt drei` : `${lorem}\n\n${lorem}`,
    i === 1 ? '```bash {% title="install.sh" lines=true %}\ncurl -fsSL https://example.com/install.sh | sh\n# Pfad setzen\nexport PATH="$HOME/.sqritto/bin:$PATH"\nsqritto --version\n```' : '',
    i === 2 ? '| Option | Standard | Beschreibung |\n|:--|:--:|:--|\n| `--port` | `7878` | TCP-Port des eingebauten Servers, über den die Oberfläche erreichbar ist |\n| `--workspace` | `~/Dokumente/Sqritto` | Arbeitsbereich mit allen Dokumenten |\n| `--host` | `127.0.0.1` | Netzwerkschnittstelle |' : '',
  ]),
].join('\n\n');

const pages = [
  {
    path: 'content/index.mdoc',
    source: `---\ntitle: Überblick\n---\n# Sqritto Handbuch\n\nWillkommen! Dieses Handbuch zeigt, wie Sie mit Sqritto Dokumentation schreiben, prüfen und veröffentlichen.\n\n{% cards columns=2 %}\n{% card title="Installation" href="installation.mdoc" %}\nIn wenigen Minuten startklar.\n{% /card %}\n{% card title="Komponenten" href="komponenten.mdoc" %}\nAlle eingebauten Elemente im Überblick.\n{% /card %}\n{% card title="API" href="api.mdoc" %}\nDie REST-Schnittstelle.\n{% /card %}\n{% card title="Externe Hilfe" href="https://typst.app/docs" %}\nTypst-Dokumentation.\n{% /card %}\n{% /cards %}\n\n## Warum Sqritto?\n\n${lorem}\n\n> [!NOTE]\n> Alle Inhalte liegen als Textdateien vor und lassen sich mit Git versionieren.\n\n## Nächste Schritte\n\n1. [Installation](installation.mdoc) durchführen\n2. Erstes Dokument anlegen\n3. Als PDF und HTML exportieren\n`,
  },
  { path: 'content/installation.mdoc', source: longPage },
  { path: 'content/komponenten.mdoc', source: readFileSync(join(root, 'engine/test/sample.mdoc'), 'utf8').replace('# Willkommen bei {% $produkt %}', '# Komponenten') },
  {
    path: 'content/api.mdoc',
    source: `# REST-API\n\nDie API ist unter \`/api\` erreichbar.\n\n## Dokumente\n\n{% endpoint method="GET" path="/api/documents" %}\nListet alle Dokumente.\n{% /endpoint %}\n\n{% endpoint method="DELETE" path="/api/documents/{id}" /%}\n\n## Authentifizierung\n\n${lorem}\n\n\`\`\`json\n{ "token": "abc", "expires": 3600 }\n\`\`\`\n`,
  },
  { path: 'content/zweite.mdoc', source: `# Zweite Seite\n\n## Unterabschnitt\n\n${lorem}\n\nZurück zum [Anfang](index.mdoc).` },
];

const res = JSON.parse(
  ctx.E.buildJson(
    JSON.stringify({
      pages,
      components,
      variables: { produkt: 'Sqritto', version: '1.0' },
      nav: [
        { title: 'Einführung', pages: ['content/index.mdoc', 'content/installation.mdoc'] },
        { title: 'Referenz', pages: ['content/komponenten.mdoc', 'content/api.mdoc', 'content/zweite.mdoc'] },
      ],
      targets: { html: true },
      preview,
      site: {
        title: 'Sqritto Handbuch',
        lang: 'de',
        staticBase: '_static/',
        extraCss: [],
        extraJs: [],
        preview,
        version: '1.0',
        pdfDownload: 'doc.pdf',
        repoUrl: 'https://example.com/repo',
      },
    }),
  ),
);
for (const d of res.diagnostics) console.log(`[${d.level}] ${d.path}:${d.line ?? '?'} ${d.message}`);
for (const p of res.pages) writeFileSync(join(out, `${p.slug}.html`), p.document);
writeFileSync(join(out, '_static', 'site.css'), css);
writeFileSync(join(out, '_static', 'site.js'), js);
writeFileSync(join(out, '_static', 'search-index.js'), `window.__TS_SEARCH__=${res.searchIndex};`);
for (const f of readdirSync(join(root, 'site/dist/fonts'))) copyFileSync(join(root, 'site/dist/fonts', f), join(out, '_static', 'fonts', f));
console.log(`OK: ${res.pages.length} Seiten in ${out}`);
