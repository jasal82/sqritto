// Prüft ein fertig gebautes Sqritto-Programm von außen:
//   1. `sqritto build` erzeugt aus der Vorlage „techdoc“ ein PDF und ein HTML5-Paket
//      (Markdoc-Engine, Typst, eingebettete Schriften und Vorlagen).
//   2. `sqritto serve` liefert Oberfläche und API aus, verlangt das Zugangstoken,
//      findet das Dokument im Arbeitsbereich und kompiliert es.
//
// Aufruf: node scripts/smoke-test.mjs <Pfad zum Programm>

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(binary)) {
  console.error('Aufruf: node scripts/smoke-test.mjs <Pfad zum Programm>');
  process.exit(2);
}
const version = spawnSync(process.execPath, [path.join(root, 'scripts/version.mjs')], { encoding: 'utf8' }).stdout.trim();

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sqritto-smoke-'));
const workspace = path.join(work, 'workspace');
const doc = path.join(workspace, 'handbuch');
// CI=1: unter Windows schreibt das GUI-Programm dann in die umgeleitete Ausgabe.
const env = { ...process.env, CI: '1', SQRITTO_WORKSPACE: workspace, SQRITTO_CONFIG_DIR: path.join(work, 'config'), RUST_LOG: 'warn' };

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

// Dokument aus der mitgelieferten Vorlage anlegen (Platzhalter wie beim Anlegen in der App).
fs.cpSync(path.join(root, 'assets/templates/techdoc/files'), doc, { recursive: true });
const manifest = path.join(doc, 'sqritto.toml');
fs.writeFileSync(
  manifest,
  fs
    .readFileSync(manifest, 'utf8')
    .replaceAll('{{title}}', 'Rauchtest-Handbuch')
    .replaceAll('{{author}}', 'Sqritto CI')
    .replaceAll('{{lang}}', 'de'),
);

async function testBuild() {
  console.log(`sqritto build (${path.basename(binary)} ${version})`);
  const pdf = path.join(work, 'handbuch.pdf');
  const zip = path.join(work, 'handbuch-html.zip');
  const run = spawnSync(binary, ['build', doc, '--pdf', pdf, '--html', zip], { env, encoding: 'utf8', timeout: 180_000 });
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr, run.error ?? '');
    throw new Error(`sqritto build endete mit ${run.status ?? run.signal}`);
  }
  check(fs.readFileSync(pdf).subarray(0, 5).toString() === '%PDF-', 'PDF erzeugt');
  check(fs.statSync(pdf).size > 20_000, `PDF hat Inhalt (${(fs.statSync(pdf).size / 1024).toFixed(0)} KB)`);
  const site = fs.readFileSync(zip);
  check(site.subarray(0, 2).toString() === 'PK', 'HTML5-Paket ist ein ZIP-Archiv');
  // Dateinamen stehen unkomprimiert im Inhaltsverzeichnis des Archivs.
  for (const name of ['index.html', '_static/site.js', '_static/site.css', '_static/search-index.js', '_static/LICENSES.txt']) {
    check(site.includes(Buffer.from(name)), `HTML5-Paket enthält ${name}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function testServer() {
  console.log('sqritto serve');
  const port = await freePort();
  const token = randomBytes(16).toString('hex');
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${token}` };
  let output = '';
  const server = spawn(binary, ['serve', '--host', '127.0.0.1', '--port', String(port), '--token', token], { env });
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  try {
    let info;
    for (let attempt = 0; attempt < 60 && !info; attempt++) {
      if (server.exitCode !== null) throw new Error(`Server beendet (${server.exitCode}):\n${output}`);
      info = await fetch(`${base}/api/info`, { headers: auth })
        .then((r) => (r.ok ? r.json() : undefined))
        .catch(() => undefined);
      if (!info) await new Promise((r) => setTimeout(r, 500));
    }
    if (!info) throw new Error(`Server antwortet nicht:\n${output}`);
    check(info.version === version, `API meldet Version ${info.version}`);
    check((await fetch(`${base}/api/info`)).status === 401, 'API ohne Token abgewiesen');
    const page = await fetch(`${base}/`, { headers: auth }).then((r) => r.text());
    check(/<div id="root">/.test(page) && /\/assets\/.+\.js/.test(page), 'Oberfläche eingebettet');
    const script = page.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    check(script && (await fetch(base + script, { headers: auth })).ok, 'Skripte der Oberfläche ausgeliefert');
    const docs = await fetch(`${base}/api/documents`, { headers: auth }).then((r) => r.json());
    const entry = docs.find((d) => d.title === 'Rauchtest-Handbuch');
    check(entry, 'Dokument im Arbeitsbereich gefunden');
    const result = await fetch(`${base}/api/documents/${encodeURIComponent(entry.id)}/compile`, { method: 'POST', headers: auth }).then((r) => r.json());
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    check(result.ok && errors.length === 0, `Dokument kompiliert (${result.pages.length} Seiten)`);
  } finally {
    server.kill();
  }
}

try {
  await testBuild();
  await testServer();
  console.log('Rauchtest bestanden.');
  fs.rmSync(work, { recursive: true, force: true });
} catch (error) {
  console.error(`Rauchtest fehlgeschlagen: ${error.message}\nArbeitsordner: ${work}`);
  process.exit(1);
}
