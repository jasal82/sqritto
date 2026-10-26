# Sqritto

**Docs-as-Code-Dokumentenwerkstatt in einem einzigen Programm.** Dokumente entstehen ausschließlich aus Quelltext – Markdoc oder Typst – und werden live zu einem druckfertigen PDF und einer durchsuchbaren HTML5-Website.

- **Ein natives Binary** (Rust): Typst-Compiler, Markdoc-Engine, Weboberfläche, Vorlagen und Schriften sind eingebettet. Keine Laufzeitabhängigkeiten.
- **Lokale App oder Server**: `sqritto` öffnet ein natives App-Fenster (WebView2 unter Windows, WKWebView unter macOS) mit eigener Titelleiste und ohne Konsolenfenster, `sqritto serve` stellt dieselbe Oberfläche für den Browser im Netzwerk bereit, `sqritto build` baut Dokumente in CI-Pipelines.
- **Zwei Werkzeugketten**
  - *Markdoc → Typst → PDF* und *Markdoc → HTML5* – für technische Dokumentation, Architekturbeschreibungen (arc42), Berichte, Protokolle.
  - *Typst → PDF* – für Korrespondenz (Brief nach DIN 5008), Rechnungen und alles mit voller Layoutkontrolle; vorhandene Typst-Vorlagen aus Typst Universe lassen sich direkt einbinden.
- **Editor** mit Syntaxhervorhebung, Autovervollständigung (Markdoc-Elemente, Attribute, Werte, Variablen, Seitenlinks, Bilder; Typst über den eingebetteten Compiler), Formatierungsleiste, Bild-Upload per Drag & Drop, Fehleranzeige direkt im Text, Befehlspalette.
- **Echtzeitvorschau** von PDF (seitengenau, Klick springt zur Quelle, Cursor springt in die Vorschau) und HTML5 (inkl. Navigation und Suche, scrollt mit).
- **Erweiterbares Markdoc**: Hinweisboxen, Aufklappbereiche, Tabs, Schritte, Karten, Abbildungen, Badges, Tastenkürzel, Formeln, Fußnoten, ADRs, API-Endpunkte – jedes Element mit HTML- *und* Typst-Vorlage. Eigene Elemente legt man pro Dokument an.
- **HTML5-Export** als eigenständiges Paket: Startseite mit Titelbereich und Kapitelübersicht (Kurzbeschreibung, Direktlinks zu Unterkapiteln, Lesezeit), Seitenleiste, „Auf dieser Seite“ mit Scroll-Spy und Lesefortschritt, Volltextsuche mit eingebautem Index (funktioniert auch per `file://`), Direktlinks an Überschriften, Bildlupe, Fokusmodus, Tastenkürzel (`/`, `[` `]`, `F`, `?`), Hell/Dunkel, Druckansicht, optional mit PDF-Download.
- **Integrierter Git-Client**: Versionen speichern, Änderungen vergleichen, Verlauf mit Wiederherstellen, Zweige, Synchronisation mit GitHub & Co.

---

## Schnellstart

```bash
sqritto
```

Startet die lokale App in einem eigenen Fenster. Ein zweiter Start holt das bereits offene Fenster nach vorne; mit dem Schließen des Fensters endet das Programm. Ist keine WebView verfügbar (z. B. unter Linux), öffnet Sqritto ein App-Fenster in Edge/Chrome und beendet sich, sobald es geschlossen wird. Dokumente liegen standardmäßig unter `Dokumente/Sqritto`, das Protokoll unter `%LOCALAPPDATA%\sqritto\sqritto.log`.

| Befehl | Zweck |
| --- | --- |
| `sqritto` | Lokale App starten (`--workspace <ordner>`, `--port`, `--no-open`, `--browser` für den Browser statt des eigenen Fensters) |
| `sqritto serve --host 0.0.0.0 --port 8080` | Als Server betreiben. Ohne `--token` wird ein Zugangstoken erzeugt und angezeigt; `--no-auth` nur hinter einem Reverse-Proxy mit Anmeldung verwenden. Im Server-Modus sind nur Dokumente im Arbeitsbereich zugänglich. |
| `sqritto build ./handbuch` | PDF (und HTML-ZIP) nach `./handbuch/dist/` bauen |
| `sqritto build ./handbuch --pdf out.pdf --html site.zip --typst out.typ` | Ausgaben gezielt erzeugen; bricht mit Fehlercode ab, wenn das Dokument Fehler enthält |

Umgebungsvariablen: `SQRITTO_WORKSPACE`, `SQRITTO_HOST`, `SQRITTO_PORT`, `SQRITTO_TOKEN`.

Unter Windows ist `sqritto.exe` ein Fensterprogramm. Aus einem Terminal aufgerufen, schreibt es seine Ausgaben trotzdem in dieses Terminal; da das Terminal aber nicht auf das Programmende wartet, empfiehlt sich in Skripten `sqritto build … | Out-Default` (PowerShell) bzw. `start /wait sqritto build …` (cmd). In CI-Pipelines mit umgeleiteter Ausgabe ist nichts weiter nötig.

## Aufbau eines Dokuments

Jedes Dokument ist ein Ordner – ideal für Git:

```
handbuch/
├── sqritto.toml          Projektdatei (Titel, Navigation, Ausgaben, Variablen)
├── content/              Markdoc-Seiten (*.mdoc); content/partials/ für Bausteine
├── assets/               Bilder, Logos, Anhänge
├── components/           eigene Markdoc-Elemente (optional)
├── fonts/                zusätzliche Schriften (optional)
└── .sqritto/             Zwischenspeicher (Vorschaubild) – wird nicht versioniert
```

Typst-Dokumente bestehen aus `sqritto.toml` und beliebigen `.typ`-Dateien (Einstieg: `[typst] entry`).

### sqritto.toml

```toml
[document]
title = "Systemhandbuch"
subtitle = "Installation und Betrieb"
kind = "markdoc"            # oder "typst"
authors = ["Erika Mustermann"]
version = "2.4"
lang = "de"

[[markdoc.nav]]             # Kapitel/Abschnitte der Navigation
title = "Einführung"
pages = ["index.mdoc", "ueberblick.mdoc"]

[variables]                 # in Markdoc: {% $produkt %}, in Typst: sys.inputs.produkt
produkt = "Nimbus Sync"

[pdf]
enabled = true
template = "@sqritto/techdoc:0.1.0"   # Layout für Markdoc; eigene Vorlage z. B. "theme/template.typ"
standard = "a-2b"                     # optional: a-2b, a-3b, ua-1 …
options = { toc = true, numbering = true, accent = "#2563eb", logo = "assets/logo.svg" }

[html]
enabled = true
accent = "#2c5fd4"
include_pdf = true
landing = true                        # Startseite mit Kapitelübersicht (index.html)
```

Mit `landing = true` (Standard) wird `index.html` zur Startseite mit Titel, Untertitel, Beschreibung, Version und Stand aus `[document]` sowie einer Übersicht aller Kapitel. Die Seite `index.mdoc` erscheint dann als erstes Kapitel unter einem Namen nach ihrem Titel.

Sqritto hieß während der Entwicklung „Typeset“. Dokumente aus dieser Zeit funktionieren unverändert weiter: `typeset.toml` wird als Projektdatei gelesen, Importe aus `@typeset/…` landen bei den gleichnamigen `@sqritto/…`-Paketen. Einstellungen und eigene Vorlagen werden beim ersten Start übernommen; ein vorhandener Arbeitsbereich `Dokumente/Typeset` bleibt in Gebrauch, solange es keinen Ordner `Dokumente/Sqritto` gibt.

## Markdoc

Markdoc ist Markdown mit Tags. Neben normalem Markdown (Überschriften, Listen, Tabellen, Code mit Titel ```` ```rust {% title="main.rs" %} ````, Bilder mit Beschriftung `![Alt](bild.png "Beschriftung")`, Checklisten `- [ ]`, GitHub-Hinweise `> [!NOTE]`) stehen diese Elemente bereit:

| Element | Beispiel |
| --- | --- |
| Hinweisbox | `{% callout type="warning" title="Achtung" %}…{% /callout %}` |
| Aufklappbereich | `{% details title="Mehr" %}…{% /details %}` |
| Tabs | `{% tabs %}{% tab label="Windows" %}…{% /tab %}{% /tabs %}` |
| Schritte | `{% steps %}{% step title="Installieren" %}…{% /step %}{% /steps %}` |
| Karten | `{% cards columns=2 %}{% card title="Start" href="index.mdoc" %}…{% /card %}{% /cards %}` |
| Abbildung | `{% figure src="/assets/x.svg" caption="…" width="60%" /%}` |
| Badge, Tastenkürzel | `{% badge color="green" %}Stabil{% /badge %}`, `{% kbd keys="Strg+S" /%}` |
| Formel | `{% math formula="a^2 + b^2 = c^2" /%}` oder ```` ```math ```` (Typst-Mathematik, im HTML als SVG) |
| Fußnote | `{% footnote %}…{% /footnote %}` |
| Architekturentscheidung | `{% decision id="ADR-001" title="…" status="accepted" %}…{% /decision %}` |
| API-Endpunkt | `{% endpoint method="GET" path="/api/v1/kunden" %}…{% /endpoint %}` |
| Seitenumbruch | `{% pagebreak /%}` |
| Typst direkt | ```` ```typst {% render=true %} ```` – im PDF eingebettet, im HTML als SVG |

Verweise zwischen Seiten (`[Installation](installation.mdoc#voraussetzungen)`) funktionieren in beiden Ausgaben; im PDF werden sie zu internen Links.

### Eigene Elemente

Im Editor unter **Elemente → Eigenes Element** oder **Anpassen** (kopiert ein eingebautes Element ins Dokument). Ein Element ist ein Ordner `components/<name>/`:

- `component.json` – Name, Beschreibung, Attribute (`type`, `default`, `required`, `matches`, `asset`, `link`), `inline`, `selfClosing`, Snippet, Beispiel (`example`) für die Vorschau
- `template.html` – HTML-Vorlage in Mustache-Syntax: `{{titel}}`, `{{{children}}}`, `{{#open}}…{{/open}}`, `{{^titel}}…{{/titel}}`
- `template.typ` – Typst-Funktion `ts-<name>(attribut: standard, body)`; das Theme steht über `#import "@sqritto/markdoc:0.1.0": ts-theme` bereit
- `style.css`, `script.js` – optional für die HTML-Ausgabe

Bearbeitet wird ein Element in der **Element-Ansicht** (Elemente → *Bearbeiten*, oder eine Datei des Elements im Dateibaum öffnen): Die Einstellungen aus `component.json` stehen in einem Formular (Titel, Art, Attribute, Einfüge-Vorlage), HTML- und Typst-Vorlage, Stil und Skript im Code-Editor. Daneben zeigt eine Live-Vorschau ein Beispiel des Elements als HTML und als zugeschnittenen PDF-Ausschnitt in der Vorlage des Dokuments – einschließlich ungespeicherter Änderungen, mit Fehlermeldungen samt Zeilenangabe.

## Typst

Typst-Dokumente können alle Typst-Funktionen nutzen. Eingebaut und offline verfügbar sind:

| Paket | Zweck |
| --- | --- |
| `@sqritto/brief:0.1.0` | Geschäftsbrief nach DIN 5008 (Form A/B, Informationsblock, Falz- und Lochmarken, Fußzeile) |
| `@sqritto/rechnung:0.1.0` | Rechnung mit Positionen, USt.-Berechnung und Bankverbindung |
| `@sqritto/techdoc`, `@sqritto/arc42`, `@sqritto/report` | Layouts für Markdoc-Dokumente (auch direkt nutzbar) |

Pakete aus [Typst Universe](https://typst.app/universe) (`@preview/…`) werden beim ersten Gebrauch geladen und zwischengespeichert. Beim Anlegen eines Dokuments lässt sich jede Universe-Vorlage wie mit `typst init` übernehmen – z. B. `letter-pro` für DIN-5008-Briefe.

## Versionen (Git)

Für jedes Dokument kann ein Git-Repository angelegt werden. Lokale Funktionen (Versionen speichern, vergleichen, wiederherstellen, Zweige) funktionieren ohne installiertes Git. Für Hoch- und Herunterladen nutzt Sqritto die installierte Git-Kommandozeile und damit deren Anmeldedaten.

## Architektur

```
┌──────────────── sqritto (ein Binary) ────────────────┐
│ axum-Server ─ REST-API, Vorschau, eingebettete UI    │
│ ├─ Markdoc-Engine (TypeScript) in QuickJS            │
│ │    Markdoc → Typst-Code + HTML-Seiten + Suchindex  │
│ ├─ Typst 0.15 als Bibliothek (PDF, SVG, PNG, IDE)    │
│ ├─ libgit2 (Versionen) + git-CLI (Synchronisation)   │
│ └─ eingebettet: Vorlagen, Elemente, Typst-Pakete,     │
│    Schriften (Inter, JetBrains Mono), UI, Site-JS     │
└───────────────────────────────────────────────────────┘
```

| Ordner | Inhalt |
| --- | --- |
| `src/` | Rust-Backend (Server, Typst-World, Übersetzung, Exporte, Git, Bibliothek) |
| `engine/` | Markdoc-Engine (TypeScript): Markdoc → Typst/HTML, Seitenrahmen, Suchindex |
| `site/` | Laufzeit der exportierten HTML5-Site (Navigation, Suche, Scroll-Spy, Live-Vorschau) |
| `web/` | Weboberfläche (React, CodeMirror 6) |
| `assets/` | Vorlagen, Markdoc-Elemente, Typst-Pakete, Schriften |

## Entwicklung

Voraussetzungen: Rust ≥ 1.92, Node.js ≥ 20, ein C-Compiler (für QuickJS und libgit2).

```bash
npm install
npm run build            # engine, site, web
cargo build --release    # target/release/sqritto
```

Entwicklung mit Hot Reload: Backend mit `cargo run -- --no-open --token dev` starten und einmal http://localhost:4517/?token=dev öffnen (setzt das Anmelde-Cookie für `localhost`). Danach `npm run dev` – Vite unter http://localhost:5173 leitet `/api` und `/preview` an das Backend weiter. Im Debug-Build liest das Backend Vorlagen, Elemente und die UI direkt von der Platte.

Tests: `npm test` (Engine), `npm run typecheck` (Site und Oberfläche), `npm run i18n` (Übersetzungen der Oberfläche), `cargo test` (Backend).

### Sprachen

Sqritto gibt es auf Deutsch und Englisch. Die Sprache der Oberfläche folgt der Systemsprache und lässt sich unter „Einstellungen → Sprache“ umstellen; die Umgebungsvariable `SQRITTO_LANGUAGE` (`de`, `en`, `system`) hat Vorrang, z. B. für CI oder Screenshots. Alles, was in Dokumenten landet (Beschriftungen in PDF und HTML5-Site, Elemente, Datumsangaben), folgt dagegen der Dokumentsprache `lang` aus `sqritto.toml`; andere Sprachen als Deutsch erhalten englische Beschriftungen.

- **Oberfläche:** Texte stehen auf Deutsch im Code und laufen durch `t('…')` (`web/src/lib/i18n.ts`), Platzhalter als `{name}`. Die englischen Texte liegen je Bereich in `web/src/i18n/en/*.ts` (Schlüssel = deutscher Text). `npm run i18n` meldet fehlende Übersetzungen und zusammengesetzte Texte; die Pipeline prüft das bei jedem Lauf.
- **Server und Kommandozeile:** `tr!("Deutsch", "English")` bzw. `i18n::pick` (`src/i18n.rs`).
- **Markdoc-Engine:** Meldungen über `ui('Deutsch', 'English')`, Beschriftungen der Site nach Dokumentsprache (`engine/src/i18n.ts`).
- **Elemente und Vorlagen:** englische Texte in `component.json` unter `"en"`, Vorlagen mit `[template.en]` in `template.toml` und eigenem Ordner `files.en/`. In Typst-Vorlagen von Elementen wählt `ts-i18n((de: …, en: …))` nach `text.lang`, in HTML-Vorlagen `{{#docLang=en}}…{{/docLang=en}}`.

Mit `SQRITTO_CONFIG_DIR` läuft eine Instanz mit eigenem Einstellungsordner, getrennt von der installierten App (genutzt vom Rauchtest).

### Pakete bauen

`build.cmd` (Windows) und `build.sh` (Linux, macOS) bauen alles in einem Schritt und legen das Ergebnis unter `dist/` ab:

| Plattform | Ergebnis |
| --- | --- |
| Windows | `dist/Sqritto.exe`, Installer `dist/packages/Sqritto-X.Y.Z-windows-x64-setup.exe` (benötigt [Inno Setup 6](https://jrsoftware.org/isdl.php); ohne Installer: `build.cmd --no-installer`) |
| Linux, macOS | `dist/sqritto`, Archiv `dist/packages/Sqritto-X.Y.Z-<plattform>-<arch>.tar.gz` |

Beigelegt werden `LICENSE.txt` (Apache-2.0), `LICENSE-MIT-0.txt` und `THIRD-PARTY-LICENSES.txt` mit den Lizenztexten aller eingebetteten Rust-Crates, npm-Pakete, Syntaxdefinitionen und Schriften (`node scripts/third-party-licenses.mjs`). `node scripts/smoke-test.mjs <programm>` prüft ein fertiges Programm von außen: `sqritto build` erzeugt aus der Vorlage „techdoc“ PDF und HTML5-Paket, `sqritto serve` liefert Oberfläche und API mit Zugangsschutz aus und kompiliert das Dokument.

Der Linux-Build braucht außer Rust und Node.js nur einen C-Compiler, `make` und `perl` (OpenSSL für Typst-Paket-Downloads wird statisch eingebunden). Unter Linux öffnet Sqritto die Oberfläche im Browser, unter Windows und macOS in einem eigenen Fenster.

### GitHub Actions und Releases

`.github/workflows/build.yml` läuft bei Pushes, Pull Requests und manuell. Auf Windows x64, Linux x64 (Ubuntu 24.04) und macOS ARM64 werden Typprüfung, Frontend-Build, Engine-Tests, die Rust-Tests aller Targets und der Release-Build ausgeführt. Die Rust-Tests laufen mit `--release`, damit sie ihre kompilierten Abhängigkeiten (vor allem Typst) mit dem anschließenden Paket-Build teilen; ein Rust-Cache pro Plattform hält sie zwischen Läufen vor. Die Build-Skripte verwenden in CI mit `SQRITTO_FRONTEND_READY=1` das bereits gebaute Frontend.

Anschließend wird das fertige Programm auf jeder Plattform mit dem Rauchtest geprüft. Unter Windows geschieht das am installierten Programm: Der Test installiert still in einen temporären Ordner, prüft Version und Dateien, führt den Rauchtest aus, installiert ein Update darüber und deinstalliert wieder. Die Pakete (Windows-Installer, Windows-ZIP, Linux- und macOS-Archiv) können bei jedem erfolgreichen Lauf als Workflow-Artefakte heruntergeladen werden.

Für einen Release:

1. Neue Version setzen: `node scripts/version.mjs set X.Y.Z` (aktualisiert `Cargo.toml`, die `package.json` von engine, site und web sowie beide Lockdateien), dann committen.
2. Tag erstellen und pushen, z. B. `git tag vX.Y.Z` und `git push origin main vX.Y.Z`.
3. Nach erfolgreichen Builds aller Plattformen veröffentlicht die Pipeline automatisch einen GitHub-Release mit allen Paketen, SHA-256-Prüfsummen (`SHA256SUMS.txt`) und automatisch erzeugten Release Notes. Der Tag muss exakt zur Paketversion passen (`node scripts/version.mjs` prüft das). Zum Wiederholen eines fehlgeschlagenen Releases den Workflow des Tags erneut ausführen; Branch-Läufe veröffentlichen nie einen Release.

Der Workflow braucht keine eigenen Secrets: nur der Release-Job erhält Schreibrechte über den eingebauten `GITHUB_TOKEN`. Die Programme sind nicht signiert; Windows SmartScreen und macOS Gatekeeper warnen deshalb beim ersten Start (macOS: Rechtsklick → Öffnen bzw. `xattr -d com.apple.quarantine sqritto`).

## Lizenzen

Copyright © 2026 Johannes Asal.

Das Programm steht unter der [Apache License 2.0](LICENSE). Alles, was in die Dokumente der Nutzer wandert, steht unter [MIT-0](LICENSE-MIT-0) und darf ohne Namensnennung verwendet, verändert und weitergegeben werden:

| Bereich | Lizenz |
| --- | --- |
| Programm: `src/`, `web/`, `engine/` (außer `engine/src/shell.ts`), Skripte | Apache-2.0 |
| Dokumentvorlagen `assets/templates/`, Markdoc-Elemente `assets/components/`, Typst-Pakete `assets/typst/` | MIT-0 |
| Laufzeit und Gestaltung der HTML5-Ausgabe `site/` sowie ihr Seitenrahmen `engine/src/shell.ts` | MIT-0 |
| Schriften `assets/fonts/` (Inter, JetBrains Mono) | SIL Open Font License 1.1 |

Mit dem Programm erzeugte Dokumente (PDF, HTML5-Sites, erzeugte Typst-Quellen) gehören ihren Autorinnen und Autoren; soweit sie Bestandteile aus Vorlagen, Elementen oder der Site-Laufzeit enthalten, gilt dafür MIT-0. Ausgenommen sind die Bestandteile Dritter: die Icons von [Lucide](https://lucide.dev) (ISC, einzelne aus Feather unter MIT), die Farbschemata der Syntaxhervorhebung (InspiredGitHub und One Half, MIT), die Suchbibliothek MiniSearch (MIT) und die Schriften (OFL-1.1). Ihre Lizenztexte liegen jeder exportierten Site als `_static/LICENSES.txt` bei; die direkt in den Quelltext übernommenen stehen in [`third-party/`](third-party/README.md).

Typst, Markdoc, CodeMirror und alle weiteren Bibliotheken stehen unter ihren eigenen Lizenzen; die vollständige Übersicht für Programmpakete erzeugt der Build als `dist/THIRD-PARTY-LICENSES.txt` (`node scripts/third-party-licenses.mjs`), einschließlich der eingebetteten Syntaxdefinitionen.
