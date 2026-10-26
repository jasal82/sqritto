//! Übersetzung eines Dokuments: Markdoc → (Engine) → Typst → PDF/SVG/PNG,
//! HTML-Vorschau und Exporte. Pro Dokument bleibt die Typst-Welt im Speicher,
//! damit inkrementelle Übersetzungen schnell sind.

use std::collections::HashMap;
use std::io::Write;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use anyhow::{Context, Result, anyhow, bail};
use ecow::EcoString;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{Value as Json, json};
use typst::{World, WorldExt};
use typst::diag::{Severity, SourceDiagnostic, Warned};
use typst::foundations::{Datetime, Smart};
use typst::layout::{Abs, Point};
use typst::syntax::{FileId, Source, VirtualRoot};
use typst::utils::hash128;
use typst_layout::PagedDocument;

use crate::components::{self, ComponentDef, ComponentSource};
use crate::engine::{BuildOutput, Engine, LineMapEntry};
use crate::manifest::{DocKind, Manifest, manifest_name};
use crate::world::{DocWorld, inputs_from};
use crate::{assets, highlight};

pub const GENERATED_MAIN: &str = "/__sqritto__/main.typ";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub path: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub end_line: Option<usize>,
    pub end_column: Option<usize>,
    pub severity: &'static str,
    pub message: String,
    pub hints: Vec<String>,
    pub source: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub width: f64,
    pub height: f64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    pub path: String,
    pub slug: String,
    pub title: String,
    pub headings: Vec<crate::engine::Heading>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub ok: bool,
    pub kind: DocKind,
    pub version: u64,
    pub duration_ms: u64,
    pub diagnostics: Vec<Diagnostic>,
    pub pages: Vec<PageMeta>,
    pub outline: Vec<OutlineEntry>,
    pub html: bool,
}

/// Für die HTML-Vorschau gebaute Seiten.
#[derive(Default)]
pub struct SiteBuild {
    pub pages: HashMap<String, String>,
    pub order: Vec<String>,
    pub search_index: String,
    pub components_css: String,
    pub components_js: String,
}

#[derive(Default)]
struct State {
    world: Option<DocWorld>,
    inputs_hash: u128,
    paged: Option<Arc<PagedDocument>>,
    page_hashes: Vec<u128>,
    svg_cache: HashMap<u128, Arc<String>>,
    /// Gerenderte Seiten als PNG je (Seiten-Hash, Maßstab in Tausendsteln).
    png_cache: HashMap<(u128, u32), Arc<Vec<u8>>>,
    site: Option<Arc<SiteBuild>>,
    line_map: Vec<LineMapEntry>,
    header_lines: usize,
    last: Option<CompileResult>,
    version: u64,
    thumb_hash: Option<u128>,
    /// Markdoc-Seite → Slug (für die Seitenmarken `page:<slug>`).
    slug_by_path: HashMap<String, String>,
}

pub struct Document {
    pub id: String,
    pub root: PathBuf,
    state: Mutex<State>,
    /// Eigene Typst-Welt für die Vorschau einzelner Elemente (mit Hash der Eingaben).
    pub(crate) element_world: Mutex<Option<(DocWorld, u128)>>,
}

/// Kontext für die Zuordnung von Typst-Diagnosen zur Markdoc-Quelle.
pub(crate) struct MapCtx<'a> {
    pub line_map: &'a [LineMapEntry],
    pub header_lines: usize,
    /// Dateiname der Projektdatei (für Fehler im Kopf des erzeugten Dokuments).
    pub manifest: &'static str,
}

impl Document {
    pub fn new(id: String, root: PathBuf) -> Self {
        Self { id, root, state: Mutex::new(State::default()), element_world: Mutex::new(None) }
    }

    pub fn manifest(&self) -> Result<Manifest> {
        Manifest::load(&self.root)
    }

    pub fn last_result(&self) -> Option<CompileResult> {
        self.state.lock().last.clone()
    }

    pub fn site(&self) -> Option<Arc<SiteBuild>> {
        self.state.lock().site.clone()
    }

    /// Verwirft den Zustand (z. B. nach Wechsel des Git-Zweigs).
    pub fn invalidate(&self) {
        let mut st = self.state.lock();
        st.world = None;
    }

    // ------------------------------------------------------------------
    // Übersetzung
    // ------------------------------------------------------------------

    /// Übersetzt das Dokument für die Vorschau (blockierend).
    pub fn compile(&self) -> CompileResult {
        let started = Instant::now();
        let mut st = self.state.lock();
        st.version += 1;
        let version = st.version;
        let mut result = match self.compile_inner(&mut st) {
            Ok(r) => r,
            Err(e) => CompileResult {
                ok: false,
                kind: self.manifest().map(|m| m.document.kind).unwrap_or_default(),
                version,
                duration_ms: 0,
                diagnostics: vec![Diagnostic {
                    path: manifest_name(&self.root).into(),
                    line: None,
                    column: None,
                    end_line: None,
                    end_column: None,
                    severity: "error",
                    message: format!("{e:#}"),
                    hints: vec![],
                    source: "engine",
                }],
                pages: st
                    .paged
                    .as_ref()
                    .map(|d| page_metas(d, &st.page_hashes))
                    .unwrap_or_default(),
                outline: vec![],
                html: false,
            },
        };
        result.version = version;
        result.duration_ms = started.elapsed().as_millis() as u64;
        st.last = Some(result.clone());
        drop(st);
        self.update_thumbnail();
        comemo::evict(20);
        result
    }

    fn compile_inner(&self, st: &mut State) -> Result<CompileResult> {
        let manifest = self.manifest()?;
        let inputs = inputs_from(&manifest.variables);
        let ih = hash128(&inputs);
        let main = match manifest.document.kind {
            DocKind::Markdoc => GENERATED_MAIN.to_string(),
            DocKind::Typst => format!("/{}", manifest.typst.entry.trim_start_matches('/')),
        };
        if st.world.is_none() {
            st.world = Some(DocWorld::new(&self.root, &main, inputs));
            st.inputs_hash = ih;
        } else if st.inputs_hash != ih {
            st.world.as_mut().unwrap().set_inputs(inputs);
            st.inputs_hash = ih;
        }
        let world = st.world.as_mut().unwrap();
        world.set_main(&main);
        world.reset();

        let mut diagnostics = Vec::new();
        let mut outline = Vec::new();
        let mut html = false;

        if manifest.document.kind == DocKind::Markdoc {
            let prepared = prepare_markdoc(&self.root, &manifest, world, MarkdocMode::Preview)?;
            diagnostics.extend(prepared.diagnostics);
            // Erzeugte Seiten (Startseite) haben keine Quelle und erscheinen nicht in der Gliederung.
            outline = prepared
                .output
                .pages
                .iter()
                .filter(|p| !p.path.is_empty())
                .map(|p| OutlineEntry {
                    path: p.path.clone(),
                    slug: p.slug.clone(),
                    title: p.title.clone(),
                    headings: p.headings.clone(),
                })
                .collect();
            st.line_map = prepared.output.line_map.clone();
            st.header_lines = prepared.header_lines;
            st.slug_by_path = prepared
                .output
                .pages
                .iter()
                .filter(|p| !p.path.is_empty())
                .map(|p| (p.path.clone(), p.slug.clone()))
                .collect();
            if manifest.html_enabled() {
                html = true;
                let mut site = SiteBuild {
                    search_index: prepared.output.search_index.clone().unwrap_or_else(|| "{}".into()),
                    components_css: components::combined_css(&prepared.components),
                    components_js: components::combined_js(&prepared.components),
                    ..Default::default()
                };
                for p in &prepared.output.pages {
                    site.order.push(p.slug.clone());
                    if let Some(doc) = &p.document {
                        site.pages.insert(p.slug.clone(), doc.clone());
                    }
                }
                st.site = Some(Arc::new(site));
            } else {
                st.site = None;
            }
        } else {
            st.line_map.clear();
            st.header_lines = 0;
            st.site = None;
        }

        let world = st.world.as_ref().unwrap();
        let has_markdoc_errors = diagnostics.iter().any(|d: &Diagnostic| d.severity == "error" && d.source == "markdoc");
        let mut ok = false;
        if manifest.pdf.enabled || manifest.document.kind == DocKind::Typst {
            let Warned { output, warnings } = typst::compile::<PagedDocument>(world);
            let ctx = MapCtx { line_map: &st.line_map, header_lines: st.header_lines, manifest: manifest_name(&self.root) };
            match output {
                Ok(doc) => {
                    ok = true;
                    let hashes: Vec<u128> = doc.pages().iter().map(hash128).collect();
                    st.svg_cache.retain(|h, _| hashes.contains(h));
                    st.png_cache.retain(|(h, _), _| hashes.contains(h));
                    st.page_hashes = hashes;
                    st.paged = Some(Arc::new(doc));
                }
                Err(errors) => {
                    for e in errors.iter() {
                        diagnostics.push(convert_diagnostic(world, e, &ctx));
                    }
                }
            }
            for w in warnings.iter() {
                diagnostics.push(convert_diagnostic(world, w, &ctx));
            }
        } else {
            ok = true;
        }
        dedup_diagnostics(&mut diagnostics);

        Ok(CompileResult {
            ok: ok && !has_markdoc_errors,
            kind: manifest.document.kind,
            version: 0,
            duration_ms: 0,
            diagnostics,
            pages: st.paged.as_ref().map(|d| page_metas(d, &st.page_hashes)).unwrap_or_default(),
            outline,
            html,
        })
    }

    // ------------------------------------------------------------------
    // Vorschau-Ausgaben
    // ------------------------------------------------------------------

    pub fn page_svg(&self, index: usize) -> Option<Arc<String>> {
        let mut st = self.state.lock();
        let doc = st.paged.clone()?;
        let page = doc.pages().get(index)?;
        let hash = *st.page_hashes.get(index)?;
        if let Some(svg) = st.svg_cache.get(&hash) {
            return Some(svg.clone());
        }
        let svg = Arc::new(typst_svg::svg(page, &typst_svg::SvgOptions::default()));
        st.svg_cache.insert(hash, svg.clone());
        Some(svg)
    }

    /// Seite als PNG (für die Vorschau in Bildschirmauflösung), zwischengespeichert.
    pub fn page_png(&self, index: usize, scale: f32) -> Option<Vec<u8>> {
        let (doc, hash) = {
            let st = self.state.lock();
            (st.paged.clone()?, *st.page_hashes.get(index)?)
        };
        let key = (hash, (scale * 1000.0).round() as u32);
        if let Some(png) = self.state.lock().png_cache.get(&key) {
            return Some(png.as_ref().clone());
        }
        let page = doc.pages().get(index)?;
        let png = Arc::new(render_png(page, scale)?);
        let mut st = self.state.lock();
        if st.png_cache.len() >= 64 {
            st.png_cache.clear();
        }
        st.png_cache.insert(key, png.clone());
        Some(png.as_ref().clone())
    }

    fn update_thumbnail(&self) {
        let (doc, hash) = {
            let st = self.state.lock();
            let Some(doc) = st.paged.clone() else { return };
            let Some(h) = st.page_hashes.first().copied() else { return };
            if st.thumb_hash == Some(h) {
                return;
            }
            (doc, h)
        };
        let path = self.thumbnail_path();
        if let Some(page) = doc.pages().first()
            && let Some(png) = render_png(page, 0.75)
        {
            let _ = std::fs::create_dir_all(path.parent().unwrap());
            if std::fs::write(&path, png).is_ok() {
                self.state.lock().thumb_hash = Some(hash);
            }
        }
    }

    pub fn thumbnail_path(&self) -> PathBuf {
        self.root.join(crate::manifest::DATA_DIR).join("thumbnail.png")
    }

    /// Klick in der PDF-Vorschau → Quelltextstelle.
    pub fn jump_from_click(&self, page: usize, x: f64, y: f64) -> Option<Json> {
        let st = self.state.lock();
        let doc = st.paged.clone()?;
        let world = st.world.as_ref()?;
        let pos = typst::introspection::PagedPosition {
            page: NonZeroUsize::new(page + 1)?,
            point: Point::new(Abs::pt(x), Abs::pt(y)),
        };
        match typst_ide::jump_from_click(world, &*doc, &pos)? {
            typst_ide::Jump::File(id, offset) => {
                let source = world.source(id).ok()?;
                let (line, col) = source.lines().byte_to_line_column(offset)?;
                let path = path_of(id);
                if path == GENERATED_MAIN.trim_start_matches('/') {
                    let (p, l) = map_generated_line(line + 1, &MapCtx { line_map: &st.line_map, header_lines: st.header_lines, manifest: manifest_name(&self.root) })?;
                    return Some(json!({ "kind": "file", "path": p, "line": l, "column": 1 }));
                }
                // Nur Projektdateien anspringen (keine Vorlagenpakete).
                if world.is_virtual(id) || !matches!(id.root(), VirtualRoot::Project) {
                    return None;
                }
                Some(json!({ "kind": "file", "path": path, "line": line + 1, "column": col + 1 }))
            }
            typst_ide::Jump::Url(url) => Some(json!({ "kind": "url", "url": url.as_str() })),
            typst_ide::Jump::Position(p) => Some(json!({
                "kind": "position",
                "page": p.page.get() - 1,
                "x": p.point.x.to_pt(),
                "y": p.point.y.to_pt(),
            })),
        }
    }

    /// Cursorposition im Editor → Positionen in der PDF-Vorschau.
    pub fn jump_from_cursor(&self, path: &str, line: usize, column: usize) -> Vec<Json> {
        use typst::introspection::Introspector;
        let st = self.state.lock();
        let (Some(doc), Some(world)) = (st.paged.clone(), st.world.as_ref()) else { return vec![] };
        let is_markdoc = path.ends_with(".mdoc") || path.ends_with(".md");
        let (id, gen_line) = if is_markdoc {
            // Markdoc-Zeile → nächstgelegene generierte Typst-Zeile.
            let entries = st.line_map.iter().filter(|e| e.path == path);
            let before = entries.clone().filter(|e| e.line <= line).max_by_key(|e| e.line);
            let entry = before.or_else(|| entries.filter(|e| e.line > line).min_by_key(|e| e.line));
            let Some(e) = entry else { return vec![] };
            (crate::world::file_id(GENERATED_MAIN), e.generated + st.header_lines)
        } else {
            (crate::world::file_id(&format!("/{}", path.trim_start_matches('/'))), line.saturating_sub(1))
        };
        let Ok(source) = world.source(id) else { return vec![] };
        let col = if is_markdoc { 0 } else { column.saturating_sub(1) };
        let Some(start) = source.lines().line_column_to_byte(gen_line, col) else { return vec![] };

        // Erste Seite des Kapitels (Seitenmarke), damit Treffer im
        // Inhaltsverzeichnis oder in Kopfzeilen nicht bevorzugt werden.
        let min_page = if is_markdoc {
            st.slug_by_path
                .get(path)
                .and_then(|slug| typst::foundations::Label::new(typst::utils::PicoStr::intern(&format!("page:{slug}"))))
                .and_then(|label| {
                    let intro = doc.introspector();
                    let loc = intro.query_label(label).ok()?.location()?;
                    intro.page(loc).map(|p| p.get())
                })
                .unwrap_or(1)
        } else {
            1
        };

        let text = source.text();
        let mut offset = start;
        let limit = (start + 1500).min(text.len());
        for _ in 0..60 {
            let positions: Vec<_> = typst_ide::jump_from_cursor(&*doc, &source, offset)
                .into_iter()
                .filter(|p| p.page.get() >= min_page)
                .collect();
            if !positions.is_empty() {
                return positions
                    .into_iter()
                    .map(|p| json!({ "page": p.page.get() - 1, "x": p.point.x.to_pt(), "y": p.point.y.to_pt() }))
                    .collect();
            }
            if !is_markdoc && offset != start {
                break;
            }
            // Zum nächsten Wortanfang springen (Code wie `#list(` überspringen).
            let rest = &text[offset..limit];
            let skip = rest.find(|c: char| !c.is_alphanumeric()).unwrap_or(rest.len());
            let after = &rest[skip..];
            match after.find(|c: char| c.is_alphabetic()) {
                Some(i) => offset += skip + i,
                None => break,
            }
            if offset >= limit {
                break;
            }
        }
        vec![]
    }

    /// Autovervollständigung für Typst-Dateien.
    pub fn complete(&self, path: &str, text: &str, offset: usize, explicit: bool) -> Option<Json> {
        let st = self.state.lock();
        let world = st.world.as_ref()?;
        let id = crate::world::file_id(&format!("/{}", path.trim_start_matches('/')));
        let source = Source::new(id, text.to_string());
        let doc = st.paged.clone();
        let (from, items) = typst_ide::autocomplete(world, doc.as_deref(), &source, offset, explicit)?;
        let items: Vec<Json> = items
            .into_iter()
            .take(300)
            .map(|c| {
                json!({
                    "label": c.label.as_str(),
                    "apply": c.apply.as_ref().map(EcoString::as_str),
                    "detail": c.detail.as_ref().map(EcoString::as_str),
                    "kind": format!("{:?}", c.kind).to_lowercase(),
                })
            })
            .collect();
        Some(json!({ "from": from, "items": items }))
    }

    // ------------------------------------------------------------------
    // Exporte
    // ------------------------------------------------------------------

    /// Übersetzt neu und erzeugt das PDF.
    pub fn export_pdf(&self) -> Result<(Vec<u8>, String)> {
        let manifest = self.manifest()?;
        let mut st = self.state.lock();
        let inputs = inputs_from(&manifest.variables);
        let main = match manifest.document.kind {
            DocKind::Markdoc => GENERATED_MAIN.to_string(),
            DocKind::Typst => format!("/{}", manifest.typst.entry.trim_start_matches('/')),
        };
        let mut world = DocWorld::new(&self.root, &main, inputs);
        let mut line_map = vec![];
        let mut header_lines = 0;
        if manifest.document.kind == DocKind::Markdoc {
            let prepared = prepare_markdoc(&self.root, &manifest, &mut world, MarkdocMode::Pdf)?;
            line_map = prepared.output.line_map;
            header_lines = prepared.header_lines;
        }
        let Warned { output, .. } = typst::compile::<PagedDocument>(&world);
        let doc = output.map_err(|errors| {
            let ctx = MapCtx { line_map: &line_map, header_lines, manifest: manifest_name(&self.root) };
            let msgs: Vec<String> = errors
                .iter()
                .take(5)
                .map(|e| {
                    let d = convert_diagnostic(&world, e, &ctx);
                    format!("{}:{}: {}", d.path, d.line.unwrap_or(0), d.message)
                })
                .collect();
            let msgs = msgs.join("\n");
            anyhow!(tr!("Das Dokument enthält Fehler:\n{msgs}", "The document contains errors:\n{msgs}"))
        })?;
        let standards = match manifest.pdf.standard.as_deref().filter(|s| !s.is_empty()) {
            Some(s) => {
                let std: typst_pdf::PdfStandard = serde_json::from_value(Json::String(s.to_string()))
                    .map_err(|_| anyhow!(tr!("Unbekannter PDF-Standard „{s}“", "Unknown PDF standard “{s}”")))?;
                typst_pdf::PdfStandards::new(&[std]).map_err(|e| anyhow!("{}", e.message()))?
            }
            None => typst_pdf::PdfStandards::default(),
        };
        let now = chrono::Local::now();
        let timestamp = Datetime::from_ymd_hms(
            chrono::Datelike::year(&now),
            chrono::Datelike::month(&now) as u8,
            chrono::Datelike::day(&now) as u8,
            chrono::Timelike::hour(&now) as u8,
            chrono::Timelike::minute(&now) as u8,
            chrono::Timelike::second(&now) as u8,
        )
        .and_then(|dt| typst_pdf::Timestamp::new_local(dt, now.offset().local_minus_utc() / 60));
        let options = typst_pdf::PdfOptions {
            ident: Smart::Custom(format!("sqritto-{}", self.id)),
            creator: Smart::Custom(Some(format!("Sqritto {}", env!("CARGO_PKG_VERSION")))),
            timestamp,
            standards,
            ..Default::default()
        };
        let pdf = typst_pdf::pdf(&doc, &options).map_err(|errors| {
            let msgs = errors.iter().map(|e| e.message.to_string()).collect::<Vec<_>>().join("; ");
            anyhow!(tr!("PDF-Export fehlgeschlagen: {msgs}", "PDF export failed: {msgs}"))
        })?;
        st.paged.get_or_insert_with(|| Arc::new(doc));
        let name = manifest
            .pdf
            .filename
            .clone()
            .unwrap_or_else(|| format!("{}.pdf", file_stem(&manifest.document.title)));
        Ok((pdf, name))
    }

    /// Erzeugt das HTML5-Paket als ZIP.
    pub fn export_html(&self) -> Result<(Vec<u8>, String)> {
        let manifest = self.manifest()?;
        if manifest.document.kind != DocKind::Markdoc {
            bail!("{}", tr!("HTML-Export ist nur für Markdoc-Dokumente verfügbar.", "HTML export is only available for Markdoc documents."));
        }
        let pdf = if manifest.html.include_pdf && manifest.pdf.enabled {
            self.export_pdf().ok()
        } else {
            None
        };
        let mut world = DocWorld::new(&self.root, GENERATED_MAIN, inputs_from(&manifest.variables));
        let prepared = prepare_markdoc(
            &self.root,
            &manifest,
            &mut world,
            MarkdocMode::Html { pdf_name: pdf.as_ref().map(|(_, n)| n.clone()) },
        )?;
        let errors: Vec<_> = prepared.diagnostics.iter().filter(|d| d.severity == "error").collect();
        if !errors.is_empty() {
            let msgs = errors.iter().take(5).map(|d| format!("{}:{}: {}", d.path, d.line.unwrap_or(0), d.message)).collect::<Vec<_>>().join("\n");
            bail!("{}", tr!("Das Dokument enthält Fehler:\n{msgs}", "The document contains errors:\n{msgs}"));
        }
        let out = &prepared.output;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let base = file_stem(&manifest.document.title);
        let prefix = format!("{base}/");
        let add = |zip: &mut zip::ZipWriter<std::io::Cursor<Vec<u8>>>, path: &str, data: &[u8]| -> Result<()> {
            zip.start_file(format!("{prefix}{path}"), opts)?;
            zip.write_all(data)?;
            Ok(())
        };
        let mut has_index = false;
        for p in &out.pages {
            if let Some(doc) = &p.document {
                add(&mut zip, &format!("{}.html", p.slug), doc.as_bytes())?;
                has_index |= p.slug == "index";
            }
        }
        if !has_index && let Some(first) = out.pages.first() {
            let redirect = format!(
                "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" content=\"0; url={0}.html\"><title>{1}</title><a href=\"{0}.html\">{1}</a>",
                first.slug,
                html_escape(&manifest.document.title)
            );
            add(&mut zip, "index.html", redirect.as_bytes())?;
        }
        // Statische Dateien
        add(&mut zip, "_static/site.css", site_css(&prepared.components).as_bytes())?;
        add(&mut zip, "_static/site.js", site_js(&prepared.components).as_bytes())?;
        let search = format!("window.__TS_SEARCH__={};", out.search_index.as_deref().unwrap_or("{}"));
        add(&mut zip, "_static/search-index.js", search.as_bytes())?;
        // Schriften und die Lizenzhinweise für alle Bestandteile Dritter.
        for f in assets::site_files() {
            if (f.starts_with("fonts/") || f == "LICENSES.txt")
                && let Some(data) = assets::site_file(&f)
            {
                add(&mut zip, &format!("_static/{f}"), &data)?;
            }
        }
        // Dokument-Dateien (Bilder, Anhänge, Logo)
        let mut files: Vec<String> = out.assets.clone();
        if let Some(logo) = &manifest.html.logo {
            files.push(logo.trim_start_matches('/').to_string());
        }
        files.sort();
        files.dedup();
        for rel in files {
            let Some(path) = safe_join(&self.root, &rel) else { continue };
            if let Ok(data) = std::fs::read(&path) {
                add(&mut zip, &rel, &data)?;
            }
        }
        if let Some((data, name)) = &pdf {
            add(&mut zip, name, data)?;
        }
        let bytes = zip.finish()?.into_inner();
        let name = manifest.html.filename.clone().unwrap_or_else(|| format!("{base}-html.zip"));
        Ok((bytes, name))
    }

    /// Exportiert die erzeugten Typst-Quellen eines Markdoc-Dokuments.
    pub fn export_typst_source(&self) -> Result<String> {
        let manifest = self.manifest()?;
        if manifest.document.kind != DocKind::Markdoc {
            bail!("{}", tr!("Nur für Markdoc-Dokumente verfügbar.", "Only available for Markdoc documents."));
        }
        let mut world = DocWorld::new(&self.root, GENERATED_MAIN, inputs_from(&manifest.variables));
        let prepared = prepare_markdoc(&self.root, &manifest, &mut world, MarkdocMode::Pdf)?;
        Ok(prepared.main_source)
    }
}

// ----------------------------------------------------------------------
// Markdoc-Vorbereitung
// ----------------------------------------------------------------------

#[derive(Clone)]
pub enum MarkdocMode {
    Preview,
    Pdf,
    Html { pdf_name: Option<String> },
}

pub struct Prepared {
    pub output: BuildOutput,
    pub diagnostics: Vec<Diagnostic>,
    pub header_lines: usize,
    pub components: Vec<ComponentDef>,
    pub main_source: String,
}

/// Sammelt Seiten (in Navigationsreihenfolge) und Partials.
pub fn collect_pages(root: &Path, manifest: &Manifest) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let content = manifest.markdoc.content.trim_matches('/');
    let dir = root.join(content);
    let mut found: Vec<String> = Vec::new();
    let mut partials = Vec::new();
    for entry in walkdir::WalkDir::new(&dir).max_depth(6).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "mdoc" | "md" | "markdoc") {
            continue;
        }
        let Ok(rel) = p.strip_prefix(root) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let in_content = rel.strip_prefix(&format!("{content}/")).unwrap_or(&rel).to_string();
        if in_content.starts_with("partials/") || in_content.starts_with('_') {
            if let Ok(src) = std::fs::read_to_string(p) {
                partials.push((rel, src));
            }
            continue;
        }
        found.push(rel);
    }
    found.sort_by(|a, b| natural_cmp(a, b));
    let mut ordered = Vec::new();
    for sec in &manifest.markdoc.nav {
        for page in &sec.pages {
            let rel = format!("{content}/{}", page.trim_start_matches('/'));
            if let Some(i) = found.iter().position(|f| *f == rel) {
                ordered.push(found.remove(i));
            }
        }
    }
    ordered.extend(found);
    let pages = ordered
        .into_iter()
        .filter_map(|rel| std::fs::read_to_string(root.join(&rel)).ok().map(|s| (rel, s)))
        .collect();
    (pages, partials)
}

fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    // index.* zuerst, dann natürliche Sortierung (2 vor 10).
    let ia = a.rsplit('/').next().unwrap_or(a).starts_with("index.");
    let ib = b.rsplit('/').next().unwrap_or(b).starts_with("index.");
    if ia != ib {
        return ib.cmp(&ia);
    }
    let key = |s: &str| -> Vec<(u64, String)> {
        let mut out = Vec::new();
        let mut num = String::new();
        let mut txt = String::new();
        for c in s.chars() {
            if c.is_ascii_digit() {
                if !txt.is_empty() {
                    out.push((u64::MAX, std::mem::take(&mut txt)));
                }
                num.push(c);
            } else {
                if !num.is_empty() {
                    out.push((num.parse().unwrap_or(0), String::new()));
                    num.clear();
                }
                txt.push(c.to_ascii_lowercase());
            }
        }
        if !num.is_empty() {
            out.push((num.parse().unwrap_or(0), String::new()));
        }
        if !txt.is_empty() {
            out.push((u64::MAX, txt));
        }
        out
    };
    key(a).cmp(&key(b))
}

pub fn prepare_markdoc(root: &Path, manifest: &Manifest, world: &mut DocWorld, mode: MarkdocMode) -> Result<Prepared> {
    let (pages, partials) = collect_pages(root, manifest);
    let (components, comp_errors) = components::effective(root);
    let content = manifest.markdoc.content.trim_matches('/');
    let mut diagnostics: Vec<Diagnostic> = comp_errors
        .into_iter()
        .map(|m| Diagnostic {
            path: "components".into(),
            line: None,
            column: None,
            end_line: None,
            end_column: None,
            severity: "error",
            message: m,
            hints: vec![],
            source: "engine",
        })
        .collect();
    if pages.is_empty() {
        diagnostics.push(Diagnostic {
            path: content.to_string(),
            line: None,
            column: None,
            end_line: None,
            end_column: None,
            severity: "warning",
            message: tr!(
                "Im Ordner „{content}“ wurden keine Markdoc-Seiten (.mdoc) gefunden.",
                "No Markdoc pages (.mdoc) were found in the folder “{content}”."
            ),
            hints: vec![],
            source: "engine",
        });
    }

    let meta = &manifest.document;
    let variables = markdoc_variables(manifest);

    let (preview, html_target, pdf_name) = match &mode {
        MarkdocMode::Preview => (true, manifest.html_enabled(), None),
        MarkdocMode::Pdf => (false, false, None),
        MarkdocMode::Html { pdf_name } => (false, true, pdf_name.clone()),
    };
    let typst_target = !matches!(mode, MarkdocMode::Html { .. }) && manifest.pdf.enabled;
    let nav: Vec<Json> = manifest
        .markdoc
        .nav
        .iter()
        .map(|s| {
            json!({
                "title": s.title,
                "pages": s.pages.iter().map(|p| format!("{content}/{}", p.trim_start_matches('/'))).collect::<Vec<_>>(),
            })
        })
        .collect();
    let logo = manifest.html.logo.as_ref().map(|l| l.trim_start_matches('/').to_string());
    let input = json!({
        "pages": pages.iter().map(|(p, s)| json!({ "path": p, "source": s })).collect::<Vec<_>>(),
        "partials": partials.iter().map(|(p, s)| (p.clone(), Json::String(s.clone()))).collect::<serde_json::Map<_, _>>(),
        "components": components,
        "variables": variables,
        "nav": nav,
        "targets": { "typst": typst_target, "html": html_target },
        "preview": preview,
        "site": {
            "title": meta.title,
            "subtitle": meta.subtitle,
            "lang": meta.lang,
            "logo": logo,
            "accent": manifest.html.accent,
            "staticBase": "_static/",
            "extraCss": [],
            "extraJs": [],
            "preview": preview,
            "footer": manifest.html.footer,
            "repoUrl": manifest.html.repo,
            "version": meta.version,
            "pdfDownload": pdf_name,
            "generator": format!("Sqritto {}", env!("CARGO_PKG_VERSION")),
            "landing": manifest.html.landing,
            "description": meta.description,
            "authors": meta.authors,
            "date": display_date(meta.date.as_deref(), &meta.lang),
        },
    });
    let output = Engine::global().build(&input, Some(root.to_path_buf()))?;
    for d in &output.diagnostics {
        diagnostics.push(Diagnostic {
            path: d.path.clone(),
            line: d.line,
            column: d.column,
            end_line: None,
            end_column: None,
            severity: match d.level.as_str() {
                "error" => "error",
                "warning" => "warning",
                _ => "info",
            },
            message: d.message.clone(),
            hints: vec![],
            source: if d.source == "markdoc" { "markdoc" } else { "engine" },
        });
    }

    // Generierte Typst-Hauptdatei
    world.clear_virtual();
    let header = typst_header(manifest, &components, world);
    let header_lines = header.matches('\n').count();
    let main_source = format!("{header}{}", output.typst.as_deref().unwrap_or(""));
    world.set_virtual(GENERATED_MAIN, main_source.clone());

    Ok(Prepared { output, diagnostics, header_lines, components, main_source })
}

/// Variablen für Markdoc: eigene aus `sqritto.toml` und `document.*`.
pub(crate) fn markdoc_variables(manifest: &Manifest) -> serde_json::Map<String, Json> {
    let meta = &manifest.document;
    let mut variables = serde_json::Map::new();
    for (k, v) in &manifest.variables {
        variables.insert(k.clone(), v.clone());
    }
    variables.insert(
        "document".into(),
        json!({
            "title": meta.title,
            "subtitle": meta.subtitle,
            "authors": meta.authors,
            "version": meta.version,
            "lang": meta.lang,
            "date": meta.date,
        }),
    );
    variables
}

/// Kopf der generierten Typst-Hauptdatei: Bibliothek, Elemente, Vorlage und
/// `ts-document`. Eingebaute Elemente werden als virtuelle Dateien abgelegt.
pub(crate) fn typst_header(manifest: &Manifest, components: &[ComponentDef], world: &DocWorld) -> String {
    let mut header = String::new();
    header.push_str(&tr!(
        "// Automatisch erzeugt von Sqritto – Änderungen bitte in den Markdoc-Quellen vornehmen.\n",
        "// Generated by Sqritto – please make changes in the Markdoc sources.\n"
    ));
    header.push_str("#import \"@sqritto/markdoc:0.1.0\": *\n");
    for c in components {
        if c.source == ComponentSource::Builtin
            && let Some(typ) = &c.typ
        {
            let path = format!("/__sqritto__/components/{}.typ", c.name);
            world.set_virtual(&path, typ.clone());
            header.push_str(&format!("#import \"{path}\": *\n"));
        }
    }
    let template = manifest.pdf.template.trim();
    if !template.is_empty() {
        let spec = if template.starts_with('@') {
            template.to_string()
        } else {
            format!("/{}", template.trim_start_matches('/'))
        };
        header.push_str(&format!("#import \"{spec}\": *\n"));
    }
    for c in components {
        if c.source == ComponentSource::Local
            && let Some(p) = &c.typ_path
        {
            header.push_str(&format!("#import \"{p}\": *\n"));
        }
    }
    header.push_str(&format!("#show: ts-document.with({})\n\n", document_args(manifest)));
    header
}

/// Stand des Dokuments für die Startseite: angegebenes Datum (ISO wird bei
/// deutschsprachigen Dokumenten in deutsche Schreibweise gebracht, sonst
/// bleibt es ISO) oder das heutige Datum.
fn display_date(date: Option<&str>, lang: &str) -> String {
    let format = if lang.to_lowercase().starts_with("de") { "%d.%m.%Y" } else { "%Y-%m-%d" };
    let d = date.map(str::trim).filter(|d| !d.is_empty());
    match d {
        Some(d) => match chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d") {
            Ok(n) => n.format(format).to_string(),
            Err(_) => d.to_string(),
        },
        None => chrono::Local::now().format(format).to_string(),
    }
}

fn document_args(m: &Manifest) -> String {
    let d = &m.document;
    let mut args: Vec<String> = vec![format!("title: {}", typ_str(&d.title))];
    args.push(format!("subtitle: {}", d.subtitle.as_deref().filter(|s| !s.is_empty()).map(typ_str).unwrap_or("none".into())));
    args.push(format!(
        "authors: ({}{})",
        d.authors.iter().map(|a| typ_str(a)).collect::<Vec<_>>().join(", "),
        if d.authors.len() == 1 { "," } else { "" }
    ));
    args.push(format!("version: {}", d.version.as_deref().filter(|s| !s.is_empty()).map(typ_str).unwrap_or("none".into())));
    args.push(format!("date: {}", d.date.as_deref().filter(|s| !s.is_empty()).map(typ_str).unwrap_or("none".into())));
    args.push(format!("lang: {}", typ_str(&d.lang)));
    for (k, v) in &m.pdf.options {
        if !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') || k.is_empty() {
            continue;
        }
        if matches!(k.as_str(), "title" | "subtitle" | "authors" | "version" | "date" | "lang") {
            continue;
        }
        let value = match (k.as_str(), v) {
            ("logo" | "cover-image" | "background", Json::String(s)) if !s.is_empty() && !s.contains("://") => {
                format!("path({})", typ_str(&format!("/{}", s.trim_start_matches('/'))))
            }
            _ => json_to_typst(v),
        };
        args.push(format!("{k}: {value}"));
    }
    args.join(", ")
}

pub fn typ_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn json_to_typst(v: &Json) -> String {
    match v {
        Json::Null => "none".into(),
        Json::Bool(b) => b.to_string(),
        Json::Number(n) => n.to_string(),
        Json::String(s) => {
            // Farben als rgb() übergeben.
            if s.starts_with('#') && (s.len() == 4 || s.len() == 7 || s.len() == 9) && s[1..].chars().all(|c| c.is_ascii_hexdigit()) {
                format!("rgb({})", typ_str(s))
            } else {
                typ_str(s)
            }
        }
        Json::Array(a) => format!(
            "({}{})",
            a.iter().map(json_to_typst).collect::<Vec<_>>().join(", "),
            if a.len() == 1 { "," } else { "" }
        ),
        Json::Object(o) => {
            if o.is_empty() {
                return "(:)".into();
            }
            format!("({})", o.iter().map(|(k, x)| format!("{}: {}", typ_str(k), json_to_typst(x))).collect::<Vec<_>>().join(", "))
        }
    }
}

// ----------------------------------------------------------------------
// Diagnosen
// ----------------------------------------------------------------------

fn path_of(id: FileId) -> String {
    match id.root() {
        VirtualRoot::Project => id.vpath().get_without_slash().to_string(),
        VirtualRoot::Package(spec) => format!("{spec}/{}", id.vpath().get_without_slash()),
    }
}

fn map_generated_line(line1: usize, ctx: &MapCtx) -> Option<(String, usize)> {
    if line1 <= ctx.header_lines {
        return None;
    }
    let generated = line1 - 1 - ctx.header_lines;
    let e = ctx.line_map.iter().filter(|e| e.generated <= generated).max_by_key(|e| e.generated)?;
    Some((e.path.clone(), e.line))
}

fn locate(world: &DocWorld, span: typst::syntax::DiagSpan) -> Option<(FileId, usize, usize, usize, usize)> {
    let id = span.id()?;
    let range = world.range(span)?;
    let source = world.source(id).ok();
    match source {
        Some(src) => {
            let (l1, c1) = src.lines().byte_to_line_column(range.start)?;
            let (l2, c2) = src.lines().byte_to_line_column(range.end).unwrap_or((l1, c1));
            Some((id, l1 + 1, c1 + 1, l2 + 1, c2 + 1))
        }
        None => Some((id, 0, 0, 0, 0)),
    }
}

pub(crate) fn convert_diagnostic(world: &DocWorld, d: &SourceDiagnostic, ctx: &MapCtx) -> Diagnostic {
    let severity = match d.severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
    };
    let mut message = d.message.to_string();
    let mut hints: Vec<String> = d.hints.iter().map(|h| h.v.to_string()).collect();
    let mut out = Diagnostic {
        path: String::new(),
        line: None,
        column: None,
        end_line: None,
        end_column: None,
        severity,
        message: String::new(),
        hints: vec![],
        source: "typst",
    };
    let generated = crate::world::file_id(GENERATED_MAIN);
    let primary = locate(world, d.span);

    // Fundstelle im Projekt finden: direkt oder über den Aufrufstapel.
    let mut chosen = None;
    if let Some(loc) = primary {
        let (id, ..) = loc;
        let in_project = matches!(id.root(), VirtualRoot::Project) && !world.is_virtual(id);
        if in_project || id == generated {
            chosen = Some(loc);
        } else {
            let place = path_of(id);
            let component = place
                .strip_prefix("__sqritto__/components/")
                .and_then(|s| s.strip_suffix(".typ"))
                .map(|s| tr!("Komponente „{s}“", "component “{s}”"))
                .unwrap_or_else(|| place.clone());
            hints.insert(0, tr!("Fehler tritt in {component} auf (Zeile {})", "Error occurs in {component} (line {})", loc.1));
            for tp in d.trace.iter() {
                if let Some(l) = locate(world, tp.span.into()) {
                    let tid = l.0;
                    if tid == generated || (matches!(tid.root(), VirtualRoot::Project) && !world.is_virtual(tid)) {
                        chosen = Some(l);
                        break;
                    }
                }
            }
        }
    }
    if let Some((id, l1, c1, l2, c2)) = chosen {
        if id == generated {
            if let Some((p, l)) = map_generated_line(l1, ctx) {
                out.path = p;
                out.line = Some(l);
                hints.push(tr!("Im erzeugten Typst-Code: Zeile {}", "In the generated Typst code: line {}", l1.saturating_sub(ctx.header_lines)));
            } else {
                out.path = ctx.manifest.into();
                message = tr!(
                    "{message} (Kopf des erzeugten Dokuments – Vorlage oder PDF-Optionen prüfen)",
                    "{message} (header of the generated document – check the template or PDF options)"
                );
            }
        } else {
            out.path = path_of(id);
            out.line = Some(l1);
            out.column = Some(c1);
            out.end_line = Some(l2);
            out.end_column = Some(c2);
        }
    } else if let Some((id, l1, ..)) = primary {
        out.path = path_of(id);
        out.line = Some(l1);
    }
    // Typsts englische Meldungen nur in der deutschen Oberfläche übersetzen.
    out.message = if crate::i18n::is_en() { message } else { translate_typst_message(&message) };
    out.hints = hints;
    out
}

fn translate_typst_message(m: &str) -> String {
    let rules: [(&str, &str); 8] = [
        ("file not found (searched at ", "Datei nicht gefunden (gesucht unter "),
        ("unknown variable: ", "Unbekannte Variable: "),
        ("unexpected argument: ", "Unerwartetes Argument: "),
        ("expected ", "erwartet: "),
        ("unknown font family: ", "Unbekannte Schriftart: "),
        ("failed to download package", "Paket konnte nicht heruntergeladen werden"),
        ("package not found", "Paket nicht gefunden"),
        ("unclosed delimiter", "Nicht geschlossene Klammer"),
    ];
    for (en, de) in rules {
        if let Some(rest) = m.strip_prefix(en) {
            return format!("{de}{rest}");
        }
    }
    m.to_string()
}

pub(crate) fn dedup_diagnostics(v: &mut Vec<Diagnostic>) {
    let mut seen = std::collections::HashSet::new();
    v.retain(|d| seen.insert((d.path.clone(), d.line, d.message.clone())));
    v.sort_by_key(|d| match d.severity {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    });
}

// ----------------------------------------------------------------------
// Hilfen
// ----------------------------------------------------------------------

fn page_metas(doc: &PagedDocument, hashes: &[u128]) -> Vec<PageMeta> {
    doc.pages()
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let size = p.frame.size();
            PageMeta {
                width: size.x.to_pt(),
                height: size.y.to_pt(),
                hash: format!("{:x}", hashes.get(i).copied().unwrap_or(0)),
            }
        })
        .collect()
}

pub fn render_png(page: &typst_layout::Page, scale: f32) -> Option<Vec<u8>> {
    let opts = typst_render::RenderOptions { pixel_per_pt: (scale as f64).into(), ..Default::default() };
    let pixmap = typst_render::render(page, &opts);
    pixmap.encode_png().ok()
}

pub fn site_css(components: &[ComponentDef]) -> String {
    site_css_with(&components::combined_css(components))
}

/// Reihenfolge: Site-Grundstil, Syntaxfarben, Komponenten (überschreiben).
pub fn site_css_with(components_css: &str) -> String {
    let base = assets::site_file("site.css").map(|d| String::from_utf8_lossy(&d).into_owned()).unwrap_or_default();
    format!("{base}\n{}\n{components_css}", highlight::theme_css())
}

pub fn site_js(components: &[ComponentDef]) -> String {
    site_js_with(&components::combined_js(components))
}

pub fn site_js_with(components_js: &str) -> String {
    let base = assets::site_file("site.js").map(|d| String::from_utf8_lossy(&d).into_owned()).unwrap_or_default();
    format!("{base}\n{components_js}")
}

pub fn file_stem(title: &str) -> String {
    let s: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else if c.is_whitespace() { '-' } else { '_' })
        .collect();
    let s = s.trim_matches(|c| c == '-' || c == '_').to_string();
    if s.is_empty() { tr!("dokument", "document") } else { s }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Verbindet einen relativen Pfad sicher mit dem Dokumentordner.
pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.replace('\\', "/");
    let mut out = root.to_path_buf();
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => return None,
            s if s.contains(':') => return None,
            s => out.push(s),
        }
    }
    if out == root { None } else { Some(out) }
}

#[allow(dead_code)]
pub fn ensure_dir(p: &Path) -> Result<()> {
    std::fs::create_dir_all(p).with_context(|| tr!("Ordner {} konnte nicht angelegt werden", "Could not create folder {}", p.display()))
}
