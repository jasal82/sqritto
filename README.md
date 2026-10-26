# Sqritto

**A docs-as-code workshop in a single program.** Documents are written entirely as source text – Markdoc or Typst – and turn live into a print-ready PDF and a searchable HTML5 website.

- **One native binary** (Rust): the Typst compiler, the Markdoc engine, the web interface, templates and fonts are all embedded. No runtime dependencies.
- **Local app or server**: `sqritto` opens a native app window (WebView2 on Windows, WKWebView on macOS) with its own title bar and no console window, `sqritto serve` offers the same interface to browsers on the network, and `sqritto build` builds documents in CI pipelines.
- **Two toolchains**
  - *Markdoc → Typst → PDF* and *Markdoc → HTML5* – for technical documentation, architecture documentation (arc42), reports and meeting minutes.
  - *Typst → PDF* – for correspondence (German business letters per DIN 5008), invoices and anything that needs full control over the layout; existing templates from Typst Universe can be used directly.
- **Editor** with syntax highlighting, completion (Markdoc elements, attributes, values, variables, page links, images; Typst via the embedded compiler), a formatting toolbar, image upload by drag and drop, errors shown right in the text, and a command palette.
- **Live preview** of the PDF (page-accurate; clicking jumps to the source, the cursor scrolls the preview) and of the HTML5 output (including navigation and search, scrolls along).
- **Extensible Markdoc**: callouts, collapsible sections, tabs, steps, cards, figures, badges, keyboard shortcuts, formulas, footnotes, ADRs and API endpoints – every element has an HTML *and* a Typst template. Custom elements can be added per document.
- **HTML5 export** as a self-contained package: landing page with title area and chapter overview (summary, deep links to sections, reading time), sidebar, “On this page” with scroll spy and reading progress, full-text search with a built-in index (works from `file://` too), heading anchors, image zoom, focus mode, keyboard shortcuts (`/`, `[` `]`, `F`, `?`), light and dark mode, print view and an optional PDF download.
- **Built-in Git client**: save versions, compare changes, browse and restore history, branches, sync with GitHub and others.
- **English and German**: the interface follows the system language; everything inside a document follows the document's language.

---

## Quick start

```bash
sqritto
```

Starts the local app in its own window. Starting it a second time brings the open window to the front; closing the window ends the program. If no WebView is available (e.g. on Linux), Sqritto opens an app window in Edge or Chrome and exits once it is closed. Documents live in `Documents/Sqritto` by default, the log in `%LOCALAPPDATA%\sqritto\sqritto.log`.

| Command | Purpose |
| --- | --- |
| `sqritto` | Start the local app (`--workspace <folder>`, `--port`, `--no-open`, `--browser` to use the browser instead of the app window) |
| `sqritto serve --host 0.0.0.0 --port 8080` | Run as a server. Without `--token`, an access token is generated and printed; use `--no-auth` only behind a reverse proxy with authentication. In server mode only documents inside the workspace are accessible. |
| `sqritto build ./handbook` | Build the PDF (and the HTML ZIP) into `./handbook/dist/` |
| `sqritto build ./handbook --pdf out.pdf --html site.zip --typst out.typ` | Produce specific outputs; exits with an error code if the document contains errors |

Environment variables: `SQRITTO_WORKSPACE`, `SQRITTO_HOST`, `SQRITTO_PORT`, `SQRITTO_TOKEN`, `SQRITTO_LANGUAGE` (`de`, `en` or `system`), `SQRITTO_CONFIG_DIR` (a separate settings folder, e.g. for tests), `SQRITTO_NO_OPEN` (same as `--no-open`) and `SQRITTO_UPDATE_URL` (a different address for the update check, see [Updates](#updates)).

On Windows, `sqritto.exe` is a GUI program. When started from a terminal it still writes its output to that terminal, but the terminal does not wait for it to finish – in scripts use `sqritto build … | Out-Default` (PowerShell) or `start /wait sqritto build …` (cmd). In CI pipelines with redirected output nothing else is needed.

## Structure of a document

Every document is a folder – a perfect fit for Git:

```
handbook/
├── sqritto.toml          project file (title, navigation, outputs, variables)
├── content/              Markdoc pages (*.mdoc); content/partials/ for reusable snippets
├── assets/               images, logos, attachments
├── components/           custom Markdoc elements (optional)
├── fonts/                additional fonts (optional)
└── .sqritto/             cache (thumbnail) – not versioned
```

Typst documents consist of `sqritto.toml` and any number of `.typ` files (entry point: `[typst] entry`).

### sqritto.toml

```toml
[document]
title = "System handbook"
subtitle = "Installation and operation"
kind = "markdoc"            # or "typst"
authors = ["Jane Doe"]
version = "2.4"
lang = "en"

[[markdoc.nav]]             # chapters/sections of the navigation
title = "Introduction"
pages = ["index.mdoc", "overview.mdoc"]

[variables]                 # in Markdoc: {% $product %}, in Typst: sys.inputs.product
product = "Nimbus Sync"

[pdf]
enabled = true
template = "@sqritto/techdoc:0.1.0"   # layout for Markdoc; a custom template e.g. "theme/template.typ"
standard = "a-2b"                     # optional: a-2b, a-3b, ua-1 …
options = { toc = true, numbering = true, accent = "#2563eb", logo = "assets/logo.svg" }

[html]
enabled = true
accent = "#2c5fd4"
include_pdf = true
landing = true                        # landing page with chapter overview (index.html)
```

With `landing = true` (the default), `index.html` becomes a landing page with title, subtitle, description, version and date from `[document]` plus an overview of all chapters. The page `index.mdoc` then appears as the first chapter, named after its title.

During development Sqritto was called “Typeset”. Documents from that time keep working unchanged: `typeset.toml` is read as the project file, and imports from `@typeset/…` resolve to the `@sqritto/…` packages of the same name. Settings and custom templates are taken over on first start; an existing workspace `Documents/Typeset` stays in use as long as there is no `Documents/Sqritto` folder.

## Markdoc

Markdoc is Markdown with tags. Besides regular Markdown (headings, lists, tables, code with a title ```` ```rust {% title="main.rs" %} ````, images with captions `![Alt](image.png "Caption")`, task lists `- [ ]`, GitHub alerts `> [!NOTE]`) these elements are available:

| Element | Example |
| --- | --- |
| Callout | `{% callout type="warning" title="Caution" %}…{% /callout %}` |
| Collapsible section | `{% details title="More" %}…{% /details %}` |
| Tabs | `{% tabs %}{% tab label="Windows" %}…{% /tab %}{% /tabs %}` |
| Steps | `{% steps %}{% step title="Install" %}…{% /step %}{% /steps %}` |
| Cards | `{% cards columns=2 %}{% card title="Start" href="index.mdoc" %}…{% /card %}{% /cards %}` |
| Figure | `{% figure src="/assets/x.svg" caption="…" width="60%" /%}` |
| Badge, keyboard shortcut | `{% badge color="green" %}Stable{% /badge %}`, `{% kbd keys="Ctrl+S" /%}` |
| Formula | `{% math formula="a^2 + b^2 = c^2" /%}` or ```` ```math ```` (Typst math, rendered as SVG in HTML) |
| Footnote | `{% footnote %}…{% /footnote %}` |
| Architecture decision | `{% decision id="ADR-001" title="…" status="accepted" %}…{% /decision %}` |
| API endpoint | `{% endpoint method="GET" path="/api/v1/customers" %}…{% /endpoint %}` |
| Page break | `{% pagebreak /%}` |
| Raw Typst | ```` ```typst {% render=true %} ```` – embedded in the PDF, rendered as SVG in HTML |

Links between pages (`[Installation](installation.mdoc#requirements)`) work in both outputs; in the PDF they become internal links.

### Custom elements

In the editor, use **Elements → Custom element** or **Customize** (which copies a built-in element into the document). An element is a folder `components/<name>/`:

- `component.json` – name, description, attributes (`type`, `default`, `required`, `matches`, `asset`, `link`), `inline`, `selfClosing`, snippet, and an example (`example`) for the preview
- `template.html` – HTML template in Mustache syntax: `{{title}}`, `{{{children}}}`, `{{#open}}…{{/open}}`, `{{^title}}…{{/title}}`
- `template.typ` – Typst function `ts-<name>(attribute: default, body)`; the theme is available via `#import "@sqritto/markdoc:0.1.0": ts-theme`
- `style.css`, `script.js` – optional, for the HTML output

Elements are edited in the **element view** (Elements → *Edit*, or open any file of the element in the file tree): the settings from `component.json` appear as a form (title, kind, attributes, insertion snippet), the HTML and Typst templates, style and script in the code editor. Next to it, a live preview renders an example of the element as HTML and as a cropped PDF excerpt in the document's template – including unsaved changes, with errors and line numbers.

## Typst

Typst documents can use everything Typst offers. Built in and available offline:

| Package | Purpose |
| --- | --- |
| `@sqritto/brief:0.1.0` | German business letter per DIN 5008 (form A/B, information block, fold and punch marks, footer) |
| `@sqritto/rechnung:0.1.0` | Invoice with line items, VAT calculation and bank details (German or English labels via `sprache`) |
| `@sqritto/techdoc`, `@sqritto/arc42`, `@sqritto/report` | Layouts for Markdoc documents (can also be used directly) |

Packages from [Typst Universe](https://typst.app/universe) (`@preview/…`) are downloaded on first use and cached. When creating a document, any Universe template can be used just like with `typst init`.

## Versions (Git)

Each document can have its own Git repository. Local features (saving, comparing and restoring versions, branches) work without Git installed. To push and pull, Sqritto uses the installed Git command line and therefore its credentials.

## Updates

The local app looks for a new version at start and then once a day. It only asks the GitHub API for the latest release of `jasal82/sqritto`; no document data is sent. A new version is announced in the library and can be installed under Settings → Updates; the automatic check can be switched off there, and a version can be skipped.

An update downloads the package for the current platform, verifies its SHA-256 checksum (published by GitHub for every release file, otherwise from `SHA256SUMS.txt`) and then

- on Windows installations made with the setup, runs the new setup silently, which updates the installation and starts Sqritto again (`/RELAUNCH=1`),
- for the portable Windows ZIP and the macOS and Linux archives, replaces the program file and the license files next to the running program (the old files are renamed to `*.old` first and removed on the next start) and starts the new version.

The new version takes over port and access token of the old one, so an open browser tab stays signed in and simply reloads; the app window closes and the new version opens its own. Development builds, programs not started from a Sqritto package (no `LICENSE.txt` next to them) and read-only program folders are not updated automatically – Sqritto then links to the release on GitHub. In server mode (`sqritto serve`) there are no automatic updates. For tests, `SQRITTO_UPDATE_URL` points the check at a local copy of the GitHub API response.

## Languages

Sqritto is available in English and German. The interface follows the system language and can be changed under Settings → Language; the environment variable `SQRITTO_LANGUAGE` (`de`, `en`, `system`) takes precedence, e.g. for CI or screenshots. Everything that ends up in a document (labels in the PDF and the HTML5 site, elements, dates) follows the document language `lang` in `sqritto.toml` instead; languages other than German get English labels.

## Architecture

```
┌──────────────── sqritto (one binary) ────────────────┐
│ axum server ─ REST API, preview, embedded UI         │
│ ├─ Markdoc engine (TypeScript) in QuickJS            │
│ │    Markdoc → Typst code + HTML pages + search index│
│ ├─ Typst 0.15 as a library (PDF, SVG, PNG, IDE)      │
│ ├─ libgit2 (versions) + git CLI (sync)               │
│ └─ embedded: templates, elements, Typst packages,    │
│    fonts (Inter, JetBrains Mono), UI, site runtime   │
└──────────────────────────────────────────────────────┘
```

| Folder | Contents |
| --- | --- |
| `src/` | Rust backend (server, Typst world, translation, exports, Git, library) |
| `engine/` | Markdoc engine (TypeScript): Markdoc → Typst/HTML, page shell, search index |
| `site/` | Runtime of the exported HTML5 site (navigation, search, scroll spy, live preview) |
| `web/` | Web interface (React, CodeMirror 6) |
| `assets/` | Templates, Markdoc elements, Typst packages, fonts |

## Development

Requirements: Rust ≥ 1.92, Node.js ≥ 20 and a C compiler (for QuickJS and libgit2).

```bash
npm install
npm run build            # engine, site, web
cargo build --release    # target/release/sqritto
```

Development with hot reload: start the backend with `cargo run -- --no-open --token dev` and open http://localhost:4517/?token=dev once (this sets the login cookie for `localhost`). Then run `npm run dev` – Vite on http://localhost:5173 forwards `/api` and `/preview` to the backend. In debug builds the backend reads templates, elements and the UI straight from disk.

Tests: `npm test` (engine), `npm run typecheck` (site and interface), `npm run i18n` (interface translations), `cargo test` (backend).

### Translations

- **Interface:** strings are written in German in the source and pass through `t('…')` (`web/src/lib/i18n.ts`), with placeholders as `{name}`. The English strings live in `web/src/i18n/en/*.ts`, one file per area, keyed by the German text. `npm run i18n` reports missing translations and composed strings; the pipeline checks this on every run.
- **Server and command line:** `tr!("Deutsch", "English")` or `i18n::pick` (`src/i18n.rs`).
- **Markdoc engine:** messages via `ui('Deutsch', 'English')`, site labels by document language (`engine/src/i18n.ts`).
- **Elements and templates:** English texts in `component.json` under `"en"`; templates get `[template.en]` in `template.toml` and their own `files.en/` folder. Typst templates of elements pick their labels with `ts-i18n((de: …, en: …))` based on `text.lang`, HTML templates with `{{#docLang=en}}…{{/docLang=en}}`.

### Building packages

`build.cmd` (Windows) and `build.sh` (Linux, macOS) build everything in one step and put the result into `dist/`:

| Platform | Result |
| --- | --- |
| Windows | `dist/Sqritto.exe`, installer `dist/packages/Sqritto-X.Y.Z-windows-x64-setup.exe` (requires [Inno Setup 6](https://jrsoftware.org/isdl.php); without installer: `build.cmd --no-installer`) |
| Linux, macOS | `dist/sqritto`, archive `dist/packages/Sqritto-X.Y.Z-<platform>-<arch>.tar.gz` |

Included are `LICENSE.txt` (Apache-2.0), `LICENSE-MIT-0.txt` and `THIRD-PARTY-LICENSES.txt` with the license texts of all embedded Rust crates, npm packages, syntax definitions and fonts (`node scripts/third-party-licenses.mjs`). `node scripts/smoke-test.mjs <program>` checks a finished program from the outside: `sqritto build` creates a PDF and an HTML5 package from the “techdoc” template, and `sqritto serve` must serve the interface and the API with access protection and compile the document.

Apart from Rust and Node.js, the Linux build only needs a C compiler, `make` and `perl` (OpenSSL for Typst package downloads is linked statically). On Linux Sqritto opens its interface in the browser, on Windows and macOS in its own window.

### GitHub Actions and releases

`.github/workflows/build.yml` runs on pushes, pull requests and manually. On Windows x64, Linux x64 (Ubuntu 24.04) and macOS ARM64 it runs the type check, the translation check, the frontend build, the engine tests, the Rust tests of all targets and the release build. The Rust tests run with `--release` so that they share their compiled dependencies (above all Typst) with the package build that follows; a Rust cache per platform keeps them between runs. In CI the build scripts reuse the already built frontend via `SQRITTO_FRONTEND_READY=1`.

Afterwards the finished program is checked with the smoke test on every platform. On Windows this happens with the installed program: the test installs silently into a temporary folder, checks version and files, runs the smoke test, installs an update on top, checks that the setup restarts Sqritto after a self-update (`/RELAUNCH`, with port and token taken over) and uninstalls again. The packages (Windows installer, Windows ZIP, Linux and macOS archives) can be downloaded as workflow artifacts from every successful run.

To release:

1. Set the new version: `node scripts/version.mjs set X.Y.Z` (updates `Cargo.toml`, the `package.json` files of engine, site and web and both lock files), then commit.
2. Create and push a tag, e.g. `git tag vX.Y.Z` and `git push origin main vX.Y.Z`.
3. Once all platforms have built successfully, the pipeline publishes a GitHub release with all packages, SHA-256 checksums (`SHA256SUMS.txt`) and automatically generated release notes. The tag must match the package version exactly (`node scripts/version.mjs` checks this). To retry a failed release, re-run the workflow of the tag; branch runs never publish a release.

The workflow needs no secrets of its own: only the release job gets write access, through the built-in `GITHUB_TOKEN`. The programs are not code-signed, so Windows SmartScreen and macOS Gatekeeper warn on first start (macOS: right-click → Open, or `xattr -d com.apple.quarantine sqritto`).

## Licenses

Copyright © 2026 Johannes Asal.

The program is licensed under the [Apache License 2.0](LICENSE). Everything that ends up in users' documents is licensed under [MIT-0](LICENSE-MIT-0) and may be used, changed and shared without attribution:

| Area | License |
| --- | --- |
| Program: `src/`, `web/`, `engine/` (except `engine/src/shell.ts`), scripts | Apache-2.0 |
| Document templates `assets/templates/`, Markdoc elements `assets/components/`, Typst packages `assets/typst/` | MIT-0 |
| Runtime and styling of the HTML5 output `site/` and its page shell `engine/src/shell.ts` | MIT-0 |
| Fonts `assets/fonts/` (Inter, JetBrains Mono) | SIL Open Font License 1.1 |

Documents created with the program (PDFs, HTML5 sites, generated Typst sources) belong to their authors; where they contain parts of templates, elements or the site runtime, MIT-0 applies to those parts. Third-party components are excluded: the [Lucide](https://lucide.dev) icons (ISC, some from Feather under MIT), the syntax highlighting color schemes (InspiredGitHub and One Half, MIT), the MiniSearch search library (MIT) and the fonts (OFL-1.1). Their license texts ship with every exported site as `_static/LICENSES.txt`; those copied directly into the source tree are in [`third-party/`](third-party/README.md).

Typst, Markdoc, CodeMirror and all other libraries are licensed under their own terms; the build generates a complete overview for the program packages as `dist/THIRD-PARTY-LICENSES.txt` (`node scripts/third-party-licenses.mjs`), including the embedded syntax definitions.
