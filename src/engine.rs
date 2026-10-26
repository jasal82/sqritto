//! Die Markdoc-Engine (TypeScript, gebündelt) läuft in einer eingebetteten
//! QuickJS-Laufzeit auf einem eigenen Thread. Rust stellt ihr Hilfsfunktionen
//! bereit: Syntaxhervorhebung und Typst-Rendering von Formeln als SVG.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::sync::{Arc, OnceLock};

use anyhow::{Result, anyhow};
use parking_lot::Mutex;
use rquickjs::{CatchResultExt, Context, Function, Object, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use typst_layout::PagedDocument;

use crate::assets::ENGINE_JS;
use crate::fonts::DocFonts;
use crate::highlight;
use crate::world::SnippetWorld;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LineMapEntry {
    #[serde(rename = "gen")]
    pub generated: usize,
    pub path: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineDiagnostic {
    pub path: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub level: String,
    pub message: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Heading {
    pub level: u8,
    pub id: String,
    pub text: String,
    pub line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PageOut {
    pub path: String,
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub headings: Vec<Heading>,
    pub html: Option<String>,
    pub document: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BuildOutput {
    pub typst: Option<String>,
    pub line_map: Vec<LineMapEntry>,
    pub pages: Vec<PageOut>,
    pub search_index: Option<String>,
    pub diagnostics: Vec<EngineDiagnostic>,
    pub assets: Vec<String>,
    pub used_components: Vec<String>,
}

enum Kind {
    Build,
    Format,
}

struct Request {
    kind: Kind,
    input: String,
    root: Option<PathBuf>,
    reply: SyncSender<Result<String, String>>,
}

pub struct Engine {
    tx: Mutex<Sender<Request>>,
}

thread_local! {
    static CURRENT_ROOT: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

impl Engine {
    pub fn global() -> &'static Engine {
        static ENGINE: OnceLock<Engine> = OnceLock::new();
        ENGINE.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<Request>();
            std::thread::Builder::new()
                .name("markdoc-engine".into())
                .stack_size(32 * 1024 * 1024)
                .spawn(move || run(rx))
                .expect("Engine-Thread konnte nicht gestartet werden");
            Engine { tx: Mutex::new(tx) }
        })
    }

    fn call(&self, kind: Kind, input: String, root: Option<PathBuf>) -> Result<String> {
        let (reply, rx) = mpsc::sync_channel(1);
        self.tx
            .lock()
            .send(Request { kind, input, root, reply })
            .map_err(|_| anyhow!(tr!("Markdoc-Engine ist nicht verfügbar", "The Markdoc engine is not available")))?;
        rx.recv()
            .map_err(|_| anyhow!(tr!("Markdoc-Engine hat nicht geantwortet", "The Markdoc engine did not respond")))?
            .map_err(|e| anyhow!(tr!("Markdoc-Engine: {e}", "Markdoc engine: {e}")))
    }

    /// Übersetzt ein Markdoc-Projekt (blockierend).
    pub fn build(&self, input: &Json, root: Option<PathBuf>) -> Result<BuildOutput> {
        let out = self.call(Kind::Build, input.to_string(), root)?;
        Ok(serde_json::from_str(&out)?)
    }

    /// Formatiert Markdoc-Quelltext.
    pub fn format(&self, source: &str) -> Result<String> {
        let out = self.call(Kind::Format, source.to_string(), None)?;
        let v: Json = serde_json::from_str(&out)?;
        if v["ok"].as_bool() == Some(true) {
            Ok(v["text"].as_str().unwrap_or_default().to_string())
        } else {
            Err(anyhow!("{}", v["error"].as_str().map(str::to_string).unwrap_or_else(|| tr!("Formatierung fehlgeschlagen", "Formatting failed"))))
        }
    }
}

fn run(rx: Receiver<Request>) {
    let rt = Runtime::new().expect("QuickJS-Laufzeit");
    rt.set_memory_limit(1024 * 1024 * 1024);
    rt.set_max_stack_size(16 * 1024 * 1024);
    let ctx = Context::full(&rt).expect("QuickJS-Kontext");
    let setup = ctx.with(|ctx| -> rquickjs::Result<()> {
        let host = Object::new(ctx.clone())?;
        host.set(
            "highlight",
            Function::new(ctx.clone(), |code: String, lang: String| -> Option<String> {
                highlight::highlight_html(&code, &lang)
            })?,
        )?;
        host.set(
            "typstSvg",
            Function::new(ctx.clone(), |code: String, mode: String| -> Option<String> {
                let root = CURRENT_ROOT.with(|r| r.borrow().clone());
                typst_svg_cached(&code, &mode, root)
            })?,
        )?;
        // Sprache der Oberfläche für Meldungen der Engine (`de`/`en`).
        host.set("uiLang", Function::new(ctx.clone(), || -> String { crate::i18n::ui_language().to_string() })?)?;
        ctx.globals().set("__host", host)?;
        ctx.eval::<(), _>(ENGINE_JS)?;
        Ok(())
    });
    if let Err(e) = setup {
        tracing::error!("Markdoc-Engine konnte nicht initialisiert werden: {e}");
    }
    for req in rx {
        CURRENT_ROOT.with(|r| *r.borrow_mut() = req.root.clone());
        let result = ctx.with(|ctx| -> Result<String, String> {
            let engine: Object = ctx.globals().get("SqrittoEngine").map_err(|e| e.to_string())?;
            let name = match req.kind {
                Kind::Build => "buildJson",
                Kind::Format => "formatJson",
            };
            let f: Function = engine.get(name).map_err(|e| e.to_string())?;
            f.call::<_, String>((req.input,)).catch(&ctx).map_err(|e| e.to_string())
        });
        let _ = req.reply.send(result);
    }
}

fn snippet_fonts() -> Arc<DocFonts> {
    static F: OnceLock<Arc<DocFonts>> = OnceLock::new();
    F.get_or_init(|| Arc::new(DocFonts::new(std::path::Path::new("")))).clone()
}

fn typst_svg_cached(code: &str, mode: &str, root: Option<PathBuf>) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<(String, String), Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let key = (mode.to_string(), code.to_string());
    if let Some(v) = cache.lock().get(&key) {
        return v.clone();
    }
    let result = render_snippet_svg(code, mode, root);
    let mut c = cache.lock();
    if c.len() > 1000 {
        c.clear();
    }
    c.insert(key, result.clone());
    result
}

/// Rendert einen Typst-Schnipsel als SVG (Farben folgen `currentColor`).
pub fn render_snippet_svg(code: &str, mode: &str, root: Option<PathBuf>) -> Option<String> {
    let preamble = "#set page(width: auto, height: auto, margin: 0pt, fill: none)\n#set text(font: (\"Inter\", \"New Computer Modern Math\"), size: 11pt)\n#show math.equation: set text(font: \"New Computer Modern Math\")\n";
    let body = match mode {
        "math-inline" => format!("${}$", code.trim()),
        "math-block" => format!("#set text(size: 12pt)\n$ {} $", code.trim()),
        _ => format!("#set page(margin: 2pt)\n{code}"),
    };
    let world = SnippetWorld::new(format!("{preamble}{body}"), snippet_fonts(), root);
    let doc: PagedDocument = typst::compile(&world).output.ok()?;
    let page = doc.pages().first()?;
    let svg = typst_svg::svg(page, &typst_svg::SvgOptions::default());
    let svg = svg
        .replace("fill=\"#000000\"", "fill=\"currentColor\"")
        .replace("stroke=\"#000000\"", "stroke=\"currentColor\"");
    Some(svg)
}
