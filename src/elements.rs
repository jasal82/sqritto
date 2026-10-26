//! Vorschau einzelner Markdoc-Elemente für die Element-Ansicht.
//!
//! Ein Beispiel (Markdoc) wird mit den Vorlagen des Elements – auf Wunsch
//! einschließlich ungespeicherter Änderungen – übersetzt:
//! - HTML: Ausschnitt in einem schlanken Seitenrahmen mit den Site-Stilen,
//! - PDF: mit der Vorlage des Dokuments gesetzt und auf den Bereich des
//!   Beispiels zugeschnitten (SVG je Seite).

use std::time::Instant;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use typst::diag::Warned;
use typst::foundations::Label;
use typst::introspection::Introspector;
use typst::utils::{PicoStr, hash128};
use typst_layout::PagedDocument;

use crate::components::{self, ComponentDef, ComponentSource};
use crate::engine::Engine;
use crate::manifest::Manifest;
use crate::project::{
    Diagnostic, Document, GENERATED_MAIN, MapCtx, collect_pages, convert_diagnostic, dedup_diagnostics, markdoc_variables,
    typst_header,
};
use crate::world::{DocWorld, inputs_from};

const START: &str = "ts-element-start";
const END: &str = "ts-element-end";

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PreviewRequest {
    /// Beispiel in Markdoc.
    pub source: String,
    /// Inhalt von `component.json` (ungespeichert).
    pub definition: Option<Json>,
    pub html: Option<String>,
    pub typ: Option<String>,
    pub css: Option<String>,
    pub js: Option<String>,
    /// `html` und/oder `pdf`; ohne Angabe beide.
    pub targets: Option<Vec<String>>,
    /// Bildpunkte je pt: PDF-Ausschnitte als PNG in Bildschirmauflösung
    /// statt als SVG (gleichmäßige Kantenglättung unabhängig vom Browser).
    pub pdf_scale: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct PreviewPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub svg: Option<String>,
    /// PNG als Data-URL (bei `pdf_scale`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub png: Option<String>,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub html: Option<String>,
    pub pdf: Option<Vec<PreviewPage>>,
    pub diagnostics: Vec<Diagnostic>,
    pub duration_ms: u64,
}

fn diag(path: impl Into<String>, line: Option<usize>, column: Option<usize>, severity: &'static str, message: String, source: &'static str) -> Diagnostic {
    Diagnostic { path: path.into(), line, column, end_line: None, end_column: None, severity, message, hints: vec![], source }
}

impl Document {
    pub fn element_preview(&self, name: &str, req: PreviewRequest) -> Result<PreviewResult> {
        let started = Instant::now();
        let manifest = self.manifest()?;
        let want = |t: &str| req.targets.as_ref().is_none_or(|v| v.iter().any(|x| x == t));
        let (want_html, want_pdf) = (want("html"), want("pdf"));
        let mut diagnostics = Vec::new();

        // Elemente des Dokuments, das bearbeitete mit den übergebenen Inhalten.
        let (mut comps, _) = components::effective(&self.root);
        let existing = comps.iter().position(|c| c.name == name);
        let json_path = format!("components/{name}/component.json");
        let parsed = match &req.definition {
            Some(v) => match serde_json::from_value::<ComponentDef>(v.clone()) {
                Ok(d) => Some(d),
                Err(e) => {
                    diagnostics.push(diag(&json_path, None, None, "error", tr!("Die Definition ist ungültig: {e}", "The definition is invalid: {e}"), "engine"));
                    None
                }
            },
            None => None,
        };
        let mut def = parsed
            .or_else(|| existing.map(|i| comps[i].clone()))
            .ok_or_else(|| anyhow!(tr!("Das Element „{name}“ wurde nicht gefunden.", "The element “{name}” was not found.")))?;
        def.name = name.to_string();
        let folder = self.root.join("components").join(name);
        match existing {
            Some(i) => {
                let base = &comps[i];
                def.source = base.source;
                def.html = base.html.clone();
                def.css = base.css.clone();
                def.js = base.js.clone();
                def.typ = base.typ.clone();
                def.typ_path = base.typ_path.clone();
            }
            None => {
                def.source = ComponentSource::Local;
                def.html = std::fs::read_to_string(folder.join("template.html")).unwrap_or_default();
                def.css = std::fs::read_to_string(folder.join("style.css")).ok();
                def.js = std::fs::read_to_string(folder.join("script.js")).ok();
                def.typ_path = folder.join("template.typ").is_file().then(|| format!("/components/{name}/template.typ"));
            }
        }
        if let Some(h) = req.html {
            def.html = h;
        }
        if let Some(c) = req.css {
            def.css = Some(c);
        }
        if let Some(j) = req.js {
            def.js = Some(j);
        }
        let mut overlay = None;
        if let Some(t) = req.typ {
            if def.source == ComponentSource::Builtin {
                def.typ = Some(t);
            } else {
                let p = def.typ_path.clone().unwrap_or_else(|| format!("/components/{name}/template.typ"));
                def.typ_path = Some(p.clone());
                overlay = Some((p, t));
            }
        }
        match existing {
            Some(i) => comps[i] = def,
            None => comps.push(def),
        }

        // Markdoc übersetzen
        let content = manifest.markdoc.content.trim_matches('/');
        let page_path = format!("{content}/__element__.mdoc");
        let (_, partials) = collect_pages(&self.root, &manifest);
        let input = json!({
            "pages": [{ "path": page_path, "source": req.source }],
            "partials": partials.iter().map(|(p, s)| (p.clone(), Json::String(s.clone()))).collect::<serde_json::Map<_, _>>(),
            "components": comps,
            "variables": markdoc_variables(&manifest),
            "nav": [],
            "targets": { "typst": want_pdf, "html": want_html },
            "preview": false,
        });
        let output = Engine::global().build(&input, Some(self.root.clone()))?;
        for d in &output.diagnostics {
            let severity = match d.level.as_str() {
                "error" => "error",
                "warning" => "warning",
                _ => "info",
            };
            let source = if d.source == "markdoc" { "markdoc" } else { "engine" };
            diagnostics.push(diag(d.path.clone(), d.line, d.column, severity, d.message.clone(), source));
        }

        let html = want_html.then(|| {
            let fragment = output.pages.first().and_then(|p| p.html.clone()).unwrap_or_default();
            html_shell(&manifest, &self.id, &fragment, &components::combined_css(&comps), &components::combined_js(&comps))
        });

        let pdf = if want_pdf {
            let mut guard = self.element_world.lock();
            let inputs = inputs_from(&manifest.variables);
            let ih = hash128(&inputs);
            match guard.as_mut() {
                Some((w, h)) => {
                    if *h != ih {
                        w.set_inputs(inputs);
                        *h = ih;
                    }
                }
                None => *guard = Some((DocWorld::new(&self.root, GENERATED_MAIN, inputs), ih)),
            }
            let (world, _) = guard.as_mut().unwrap();
            world.reset();
            world.clear_virtual();
            world.clear_overlay();
            if let Some((p, t)) = &overlay {
                world.set_overlay(p, t.clone());
            }
            let header = typst_header(&manifest, &comps, world);
            // Marken als Blöcke ohne Höhe: ihre Position ist die linke obere
            // Ecke des Satzspiegels an dieser Stelle.
            // Die Startmarke folgt auf die Seitenmarke der Engine, weil Vorlagen
            // dort einen Seitenumbruch einfügen können.
            let mark = "#block(height: 0pt, above: 0pt, below: 0pt)[]";
            let body = output.typst.as_deref().unwrap_or("");
            let (first, rest) = match body.split_once("\n\n") {
                Some((a, b)) if a.starts_with("#metadata((kind: \"ts-page\"") => (format!("{a}\n\n"), b),
                _ => (String::new(), body),
            };
            let main = format!("{header}{first}{mark} <{START}>\n\n{rest}\n{mark} <{END}>\n");
            world.set_virtual(GENERATED_MAIN, main);
            let ctx = MapCtx {
                line_map: &output.line_map,
                header_lines: header.matches('\n').count() + 2,
                manifest: crate::manifest::manifest_name(&self.root),
            };
            let Warned { output: doc, warnings } = typst::compile::<PagedDocument>(&*world);
            for w in warnings.iter() {
                diagnostics.push(convert_diagnostic(world, w, &ctx));
            }
            match doc {
                Ok(doc) => Some(crop_pages(&doc, req.pdf_scale)),
                Err(errors) => {
                    for e in errors.iter() {
                        diagnostics.push(convert_diagnostic(world, e, &ctx));
                    }
                    None
                }
            }
        } else {
            None
        };

        // Fundstellen im Beispiel als „Beispiel“ ausweisen.
        for d in &mut diagnostics {
            if d.path == page_path {
                d.path = "@example".into();
            }
        }
        dedup_diagnostics(&mut diagnostics);
        Ok(PreviewResult { html, pdf, diagnostics, duration_ms: started.elapsed().as_millis() as u64 })
    }
}

/// Schneidet die Seiten auf den Bereich zwischen Start- und Endmarke zu.
fn crop_pages(doc: &PagedDocument, scale: Option<f32>) -> Vec<PreviewPage> {
    let intro = doc.introspector();
    let pos = |name: &str| {
        let label = Label::new(PicoStr::intern(name))?;
        let loc = intro.query_label(label).ok()?.location()?;
        intro.position(loc)
    };
    let (Some(start), Some(end)) = (pos(START), pos(END)) else { return vec![] };
    let pad = 6.0;
    let mut out = Vec::new();
    for p in start.page.get()..=end.page.get().max(start.page.get()) {
        let Some(page) = doc.pages().get(p - 1) else { continue };
        let size = page.frame.size();
        let (w, h) = (size.x.to_pt(), size.y.to_pt());
        // Satzspiegel: linker Rand aus der Startmarke, rechts symmetrisch.
        let left = start.point.x.to_pt();
        let x0 = (left - pad).max(0.0);
        let x1 = (w - left + pad).min(w).max(x0 + 40.0);
        let y0 = if p == start.page.get() { (start.point.y.to_pt() - pad).max(0.0) } else { 0.0 };
        let y1 = if p == end.page.get() { (end.point.y.to_pt() + pad).min(h) } else { h };
        let y1 = y1.max((y0 + 24.0).min(h));
        let (w, h) = (x1 - x0, y1 - y0);
        match scale {
            Some(s) => {
                let png = crop_png(page, s.clamp(0.5, 4.0), x0, y0, w, h);
                out.push(PreviewPage { svg: None, png, width: w, height: h });
            }
            None => {
                let svg = typst_svg::svg(page, &typst_svg::SvgOptions::default());
                out.push(PreviewPage { svg: Some(crop_svg(&svg, x0, y0, w, h)), png: None, width: w, height: h });
            }
        }
    }
    out
}

/// Rendert die Seite und schneidet den Bereich als PNG (Data-URL) aus.
fn crop_png(page: &typst_layout::Page, scale: f32, x: f64, y: f64, w: f64, h: f64) -> Option<String> {
    use base64::Engine as _;
    let opts = typst_render::RenderOptions { pixel_per_pt: (scale as f64).into(), ..Default::default() };
    let pixmap = typst_render::render(page, &opts);
    let s = scale as f64;
    let px = ((x * s).floor() as i32).max(0);
    let py = ((y * s).floor() as i32).max(0);
    let pw = ((w * s).round() as u32).min(pixmap.width().saturating_sub(px as u32)).max(1);
    let ph = ((h * s).round() as u32).min(pixmap.height().saturating_sub(py as u32)).max(1);
    let rect = tiny_skia::IntRect::from_xywh(px, py, pw, ph)?;
    let png = pixmap.clone_rect(rect)?.encode_png().ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

fn crop_svg(svg: &str, x: f64, y: f64, w: f64, h: f64) -> String {
    let Some(start) = svg.find("<svg") else { return svg.to_string() };
    let Some(len) = svg[start..].find('>') else { return svg.to_string() };
    let end = start + len;
    let mut head = svg[start..end].to_string();
    head = replace_attr(&head, "viewBox", &format!("{x:.2} {y:.2} {w:.2} {h:.2}"));
    head = replace_attr(&head, "width", &format!("{w:.2}pt"));
    head = replace_attr(&head, "height", &format!("{h:.2}pt"));
    format!("{}{head}{}", &svg[..start], &svg[end..])
}

fn replace_attr(tag: &str, name: &str, value: &str) -> String {
    let key = format!(" {name}=\"");
    if let Some(i) = tag.find(&key) {
        let from = i + key.len();
        if let Some(j) = tag[from..].find('"') {
            return format!("{}{value}{}", &tag[..from], &tag[from + j..]);
        }
    }
    tag.to_string()
}

fn attr_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;")
}

/// Schlanker Seitenrahmen für den HTML-Ausschnitt. Die Basis-Stile kommen aus
/// `_static/site-base.css`, die Stile und Skripte der Elemente werden direkt
/// eingebettet (einschließlich ungespeicherter Änderungen).
fn html_shell(manifest: &Manifest, id: &str, fragment: &str, css: &str, js: &str) -> String {
    let lang = attr_escape(&manifest.document.lang);
    let base = format!("/preview/{}/", urlencoding::encode(id));
    let accent = manifest
        .html
        .accent
        .as_deref()
        .filter(|a| a.starts_with('#') && a.len() <= 9 && a[1..].chars().all(|c| c.is_ascii_hexdigit()))
        .map(|a| format!("<style>:root{{--ts-accent:{a}}}</style>\n"))
        .unwrap_or_default();
    let css = css.replace("</style", "<\\/style");
    let js = js.replace("</script", "<\\/script");
    format!(
        r#"<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<base href="{base}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="_static/site-base.css">
{accent}<style>{css}</style>
<style>.ts-main{{padding:1.5rem clamp(1rem,4vw,2rem) 2rem}}</style>
</head>
<body>
<main class="ts-main"><article class="ts-article ts-prose">
{fragment}
</article></main>
<script src="_static/site-base.js"></script>
<script>{js}</script>
</body>
</html>
"#
    )
}
