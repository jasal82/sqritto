//! Markdoc-Elemente (Komponenten): eingebaute und dokumentlokale.
//!
//! Eine Komponente ist ein Ordner mit
//! - `component.json` – Schema (Attribute, Inline/Block, Snippet …)
//! - `template.html`  – HTML-Vorlage (Mustache-Syntax)
//! - `template.typ`   – Typst-Funktion `ts-<name>` für das PDF
//! - `style.css`, `script.js` – optional für die HTML-Ausgabe

use std::path::Path;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use crate::assets;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ComponentDef {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub inline: Option<bool>,
    pub self_closing: Option<bool>,
    pub attributes: serde_json::Map<String, Json>,
    pub parents: Option<Vec<String>>,
    pub typst: Option<String>,
    pub pdf: Option<bool>,
    pub snippet: Option<String>,
    /// Beispiel (Markdoc) für die Vorschau in der Element-Ansicht.
    pub example: Option<String>,
    pub collect: Option<String>,
    /// HTML-Vorlage (aus `template.html`).
    pub html: String,
    /// Englische Texte: `"en": { title, description, category, snippet, example,
    /// attributes: { <name>: <Beschreibung> } }`. Wird bei englischer Oberfläche
    /// über die deutschen Angaben gelegt.
    #[serde(skip_serializing)]
    pub en: Option<Json>,
    // --- nicht Teil von component.json ---
    #[serde(skip_deserializing)]
    pub source: ComponentSource,
    #[serde(skip_serializing, skip_deserializing)]
    pub css: Option<String>,
    #[serde(skip_serializing, skip_deserializing)]
    pub js: Option<String>,
    /// Typst-Quelltext (nur eingebaute Komponenten).
    #[serde(skip_serializing, skip_deserializing)]
    pub typ: Option<String>,
    /// Pfad der Typst-Datei im Dokument (lokale Komponenten).
    #[serde(skip_deserializing)]
    pub typ_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ComponentSource {
    #[default]
    Builtin,
    Local,
}

static BUILTIN: LazyLock<Vec<ComponentDef>> = LazyLock::new(load_builtin);

fn load_builtin() -> Vec<ComponentDef> {
    let mut names: Vec<String> = assets::list("components/")
        .into_iter()
        .filter_map(|p| p.strip_prefix("components/").and_then(|r| r.split('/').next()).map(str::to_string))
        .collect();
    names.sort();
    names.dedup();
    let mut out = Vec::new();
    for name in names {
        let base = format!("components/{name}/");
        let Some(json) = assets::asset_string(&format!("{base}component.json")) else { continue };
        let mut def: ComponentDef = match serde_json::from_str(&json) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("Komponente {name}: {e}");
                continue;
            }
        };
        def.html = assets::asset_string(&format!("{base}template.html")).unwrap_or_default();
        def.css = assets::asset_string(&format!("{base}style.css"));
        def.js = assets::asset_string(&format!("{base}script.js"));
        def.typ = assets::asset_string(&format!("{base}template.typ"));
        def.source = ComponentSource::Builtin;
        out.push(def);
    }
    out
}

pub fn builtin() -> Vec<ComponentDef> {
    // Im Debug-Build immer frisch von der Platte lesen.
    let mut defs = if cfg!(debug_assertions) { load_builtin() } else { BUILTIN.clone() };
    defs.iter_mut().for_each(localize);
    defs
}

/// Legt bei englischer Oberfläche die englischen Texte (`en`) über die deutschen.
fn localize(def: &mut ComponentDef) {
    if !crate::i18n::is_en() {
        return;
    }
    let Some(Json::Object(en)) = def.en.take() else { return };
    let text = |key: &str| en.get(key).and_then(|v| v.as_str()).map(str::to_string);
    if let Some(v) = text("title") {
        def.title = Some(v);
    }
    if let Some(v) = text("description") {
        def.description = Some(v);
    }
    if let Some(v) = text("category") {
        def.category = Some(v);
    }
    if let Some(v) = text("snippet") {
        def.snippet = Some(v);
    }
    if let Some(v) = text("example") {
        def.example = Some(v);
    }
    if let Some(Json::Object(attrs)) = en.get("attributes") {
        for (name, desc) in attrs {
            if let (Some(Json::Object(attr)), Some(desc)) = (def.attributes.get_mut(name), desc.as_str()) {
                attr.insert("description".into(), Json::String(desc.to_string()));
            }
        }
    }
}

/// Wie [`localize`], aber für das JSON einer neu angelegten lokalen Kopie:
/// Die Kopie enthält danach nur noch die Texte in der Sprache der Oberfläche.
fn localize_json(v: &mut Json) {
    let Some(Json::Object(en)) = v.as_object_mut().and_then(|o| o.remove("en")) else { return };
    if !crate::i18n::is_en() {
        return;
    }
    for key in ["title", "description", "category", "snippet", "example"] {
        if let Some(text) = en.get(key).filter(|t| t.is_string()) {
            v[key] = text.clone();
        }
    }
    if let Some(Json::Object(attrs)) = en.get("attributes") {
        for (name, desc) in attrs {
            if desc.is_string() && v["attributes"][name].is_object() {
                v["attributes"][name]["description"] = desc.clone();
            }
        }
    }
}

/// Lokale Komponenten aus `<dokument>/components/<name>/`.
pub fn local(root: &Path) -> (Vec<ComponentDef>, Vec<String>) {
    let mut out = Vec::new();
    let mut errors = Vec::new();
    let dir = root.join("components");
    let Ok(entries) = std::fs::read_dir(&dir) else { return (out, errors) };
    let mut entries: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let p = entry.path();
        let folder = entry.file_name().to_string_lossy().to_string();
        let json_path = p.join("component.json");
        let Ok(json) = std::fs::read_to_string(&json_path) else { continue };
        let mut def: ComponentDef = match serde_json::from_str(&json) {
            Ok(d) => d,
            Err(e) => {
                errors.push(format!("components/{folder}/component.json: {e}"));
                continue;
            }
        };
        if def.name.is_empty() {
            def.name = folder.clone();
        }
        def.html = std::fs::read_to_string(p.join("template.html")).unwrap_or_default();
        def.css = std::fs::read_to_string(p.join("style.css")).ok();
        def.js = std::fs::read_to_string(p.join("script.js")).ok();
        if p.join("template.typ").is_file() {
            def.typ_path = Some(format!("/components/{folder}/template.typ"));
        }
        def.source = ComponentSource::Local;
        localize(&mut def);
        out.push(def);
    }
    (out, errors)
}

/// Wirksame Komponenten eines Dokuments (lokale überschreiben eingebaute).
pub fn effective(root: &Path) -> (Vec<ComponentDef>, Vec<String>) {
    let (local, errors) = local(root);
    let mut all: Vec<ComponentDef> = builtin()
        .into_iter()
        .filter(|b| !local.iter().any(|l| l.name == b.name))
        .collect();
    all.extend(local);
    (all, errors)
}

pub fn combined_css(defs: &[ComponentDef]) -> String {
    let mut s = String::new();
    for d in defs {
        if let Some(css) = &d.css {
            s.push_str(&format!("/* {} */\n{}\n", d.name, css));
        }
    }
    s
}

pub fn combined_js(defs: &[ComponentDef]) -> String {
    let mut s = String::new();
    for d in defs {
        if let Some(js) = &d.js {
            s.push_str(&format!("/* {} */\n;{}\n", d.name, js));
        }
    }
    s
}

/// Legt eine neue lokale Komponente als Ausgangspunkt an.
pub fn scaffold(root: &Path, name: &str, from_builtin: Option<&str>) -> anyhow::Result<()> {
    let dir = root.join("components").join(name);
    if dir.exists() {
        anyhow::bail!("{}", tr!("Die Komponente „{name}“ existiert bereits.", "The component “{name}” already exists."));
    }
    std::fs::create_dir_all(&dir)?;
    if let Some(src) = from_builtin {
        let base = format!("components/{src}/");
        for path in assets::list(&base) {
            let rel = path.strip_prefix(&base).unwrap_or(&path);
            if let Some(data) = assets::asset(&path) {
                let mut text = String::from_utf8_lossy(&data).into_owned();
                if rel == "component.json"
                    && let Ok(mut v) = serde_json::from_str::<Json>(&text)
                {
                    if src != name {
                        v["name"] = Json::String(name.to_string());
                        v["typst"] = Json::String(format!("ts-{name}"));
                    }
                    localize_json(&mut v);
                    text = serde_json::to_string_pretty(&v)?;
                }
                if rel == "template.typ" && src != name {
                    text = text.replace(&format!("ts-{src}("), &format!("ts-{name}("));
                }
                std::fs::write(dir.join(rel), text)?;
            }
        }
        return Ok(());
    }
    // Platzhalter im Snippet (`${Titel}`) erscheinen beim Einfügen im Editor.
    let (title_ph, body_ph) = if crate::i18n::is_en() { ("Title", "Content") } else { ("Titel", "Inhalt") };
    let json = serde_json::json!({
        "name": name,
        "title": name,
        "description": tr!("Eigenes Element", "Custom element"),
        "category": tr!("Eigene", "Custom"),
        "attributes": {
            "title": { "type": "String", "description": tr!("Überschrift", "Heading") }
        },
        "snippet": format!("{{% {name} title=\"${{{title_ph}}}\" %}}\n${{{body_ph}}}\n{{% /{name} %}}")
    });
    std::fs::write(dir.join("component.json"), serde_json::to_string_pretty(&json)?)?;
    std::fs::write(
        dir.join("template.html"),
        format!(
            "<div class=\"{name}\">\n  {{{{#title}}}}<p class=\"{name}__title\">{{{{title}}}}</p>{{{{/title}}}}\n  <div class=\"{name}__body\">{{{{{{children}}}}}}</div>\n</div>\n"
        ),
    )?;
    std::fs::write(
        dir.join("template.typ"),
        format!(
            "#import \"@sqritto/markdoc:0.1.0\": ts-theme\n\n#let ts-{name}(title: none, body) = context {{\n  let t = ts-theme.get()\n  block(width: 100%, inset: 10pt, radius: t.radius, stroke: 0.6pt + t.border, {{\n    if title != none {{ block(below: 0.6em, text(weight: \"semibold\", title)) }}\n    body\n  }})\n}}\n"
        ),
    )?;
    std::fs::write(
        dir.join("style.css"),
        format!(
            ".{name} {{\n  margin: 1.5rem 0;\n  padding: 1rem 1.1rem;\n  border: 1px solid var(--ts-border);\n  border-radius: var(--ts-radius);\n}}\n.{name}__title {{ margin: 0 0 .4rem; font-weight: 600; }}\n"
        ),
    )?;
    Ok(())
}
