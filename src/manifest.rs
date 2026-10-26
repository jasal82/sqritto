//! Die Projektdatei `sqritto.toml` eines Dokuments.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

pub const MANIFEST: &str = "sqritto.toml";
/// Name der Projektdatei aus der Zeit vor der Umbenennung (Typeset); wird weiter gelesen.
pub const LEGACY_MANIFEST: &str = "typeset.toml";

/// Dateiname der Projektdatei eines Dokuments: `sqritto.toml`, bei älteren
/// Dokumenten `typeset.toml`.
pub fn manifest_name(root: &Path) -> &'static str {
    if !root.join(MANIFEST).is_file() && root.join(LEGACY_MANIFEST).is_file() { LEGACY_MANIFEST } else { MANIFEST }
}

pub fn manifest_path(root: &Path) -> PathBuf {
    root.join(manifest_name(root))
}

/// Interner Ordner in Dokumenten und im Arbeitsbereich (Vorschaubilder, eigene Vorlagen).
pub const DATA_DIR: &str = ".sqritto";
/// Derselbe Ordner aus der Zeit vor der Umbenennung (Typeset).
pub const LEGACY_DATA_DIR: &str = ".typeset";

/// Ob ein Datei- oder Ordnername ein interner Ordner ist (wird beim Durchsuchen,
/// Beobachten und Kompilieren übergangen).
pub fn is_data_dir(name: &str) -> bool {
    name == DATA_DIR || name == LEGACY_DATA_DIR
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DocKind {
    #[default]
    Markdoc,
    Typst,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Manifest {
    pub document: DocumentMeta,
    pub markdoc: MarkdocConfig,
    pub typst: TypstConfig,
    pub variables: BTreeMap<String, Json>,
    pub pdf: PdfConfig,
    pub html: HtmlConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DocumentMeta {
    pub title: String,
    pub subtitle: Option<String>,
    pub kind: DocKind,
    pub template: Option<String>,
    pub authors: Vec<String>,
    pub lang: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub date: Option<String>,
    pub created: Option<String>,
}

impl Default for DocumentMeta {
    fn default() -> Self {
        Self {
            title: tr!("Unbenanntes Dokument", "Untitled document"),
            subtitle: None,
            kind: DocKind::Markdoc,
            template: None,
            authors: vec![],
            lang: "de".into(),
            version: None,
            description: None,
            date: None,
            created: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MarkdocConfig {
    /// Ordner mit den Markdoc-Seiten.
    pub content: String,
    /// Navigation (Kapitel/Abschnitte) in Reihenfolge.
    pub nav: Vec<NavSection>,
}

impl Default for MarkdocConfig {
    fn default() -> Self {
        Self { content: "content".into(), nav: vec![] }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct NavSection {
    pub title: Option<String>,
    pub pages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TypstConfig {
    pub entry: String,
}

impl Default for TypstConfig {
    fn default() -> Self {
        Self { entry: "main.typ".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PdfConfig {
    pub enabled: bool,
    /// Layout-Vorlage für Markdoc-Dokumente, z. B. `@sqritto/techdoc:0.1.0`
    /// oder eine Datei im Dokument wie `theme/template.typ`.
    pub template: String,
    /// Optionen, die an `ts-document` übergeben werden.
    pub options: BTreeMap<String, Json>,
    /// PDF-Standard, z. B. `a-2b` oder `ua-1`.
    pub standard: Option<String>,
    pub filename: Option<String>,
}

impl Default for PdfConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            template: "@sqritto/techdoc:0.1.0".into(),
            options: BTreeMap::new(),
            standard: None,
            filename: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HtmlConfig {
    pub enabled: bool,
    pub accent: Option<String>,
    pub logo: Option<String>,
    pub footer: Option<String>,
    pub repo: Option<String>,
    /// PDF zusätzlich in das HTML-Paket legen und verlinken.
    pub include_pdf: bool,
    pub filename: Option<String>,
    /// Startseite mit Titelbereich und Kapitelübersicht.
    pub landing: bool,
}

impl Default for HtmlConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            accent: None,
            logo: None,
            footer: None,
            repo: None,
            include_pdf: true,
            filename: None,
            landing: true,
        }
    }
}

impl Manifest {
    pub fn load(root: &Path) -> Result<Self> {
        let path = manifest_path(root);
        let text = std::fs::read_to_string(&path)
            .with_context(|| tr!("{} konnte nicht gelesen werden", "Could not read {}", path.display()))?;
        Self::parse(&text)
    }

    pub fn parse(text: &str) -> Result<Self> {
        let text = text.trim_start_matches('\u{feff}');
        toml::from_str(text).with_context(|| tr!("Die Projektdatei sqritto.toml ist ungültig", "The project file sqritto.toml is invalid"))
    }

    pub fn exists(root: &Path) -> bool {
        root.join(MANIFEST).is_file() || root.join(LEGACY_MANIFEST).is_file()
    }

    pub fn html_enabled(&self) -> bool {
        self.document.kind == DocKind::Markdoc && self.html.enabled
    }
}

/// Aktualisiert `sqritto.toml` gezielt (Kommentare und Formatierung bleiben
/// erhalten). `patch` ist ein JSON-Objekt, dessen Schlüsselpfade gesetzt
/// werden; `null` entfernt einen Schlüssel.
pub fn patch_manifest(root: &Path, patch: &Json) -> Result<Manifest> {
    let path = manifest_path(root);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml_edit::DocumentMut =
        text.parse().with_context(|| tr!("Die Projektdatei sqritto.toml ist ungültig", "The project file sqritto.toml is invalid"))?;
    if let Json::Object(map) = patch {
        apply(doc.as_table_mut(), map);
    }
    let out = doc.to_string();
    // Erst prüfen, dann schreiben.
    let manifest = Manifest::parse(&out)?;
    std::fs::write(&path, out)?;
    Ok(manifest)
}

fn apply(table: &mut toml_edit::Table, patch: &serde_json::Map<String, Json>) {
    for (key, value) in patch {
        match value {
            Json::Null => {
                table.remove(key);
            }
            Json::Object(obj) if !is_inline_value(key) => {
                if !table.contains_key(key) || !table[key].is_table() {
                    let mut t = toml_edit::Table::new();
                    t.set_implicit(false);
                    table.insert(key, toml_edit::Item::Table(t));
                }
                if let Some(t) = table[key].as_table_mut() {
                    apply(t, obj);
                }
            }
            Json::Array(items) if key == "nav" => {
                let mut arr = toml_edit::ArrayOfTables::new();
                for item in items {
                    let mut t = toml_edit::Table::new();
                    if let Json::Object(o) = item {
                        for (k, v) in o {
                            if let Some(val) = to_toml(v) {
                                t.insert(k, toml_edit::Item::Value(val));
                            }
                        }
                    }
                    arr.push(t);
                }
                table.insert(key, toml_edit::Item::ArrayOfTables(arr));
            }
            other => {
                if let Some(v) = to_toml(other) {
                    table.insert(key, toml_edit::Item::Value(v));
                }
            }
        }
    }
}

fn is_inline_value(key: &str) -> bool {
    // Diese Objekte werden als Inline-Tabelle geschrieben.
    matches!(key, "__inline")
}

fn to_toml(v: &Json) -> Option<toml_edit::Value> {
    Some(match v {
        Json::Null => return None,
        Json::Bool(b) => (*b).into(),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.into()
            } else {
                n.as_f64()?.into()
            }
        }
        Json::String(s) => s.as_str().into(),
        Json::Array(a) => {
            let mut arr = toml_edit::Array::new();
            for x in a {
                if let Some(v) = to_toml(x) {
                    arr.push(v);
                }
            }
            toml_edit::Value::Array(arr)
        }
        Json::Object(o) => {
            let mut t = toml_edit::InlineTable::new();
            for (k, x) in o {
                if let Some(v) = to_toml(x) {
                    t.insert(k, v);
                }
            }
            toml_edit::Value::InlineTable(t)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_manifest() {
        let m = Manifest::parse("[document]\ntitle = \"X\"\nkind = \"typst\"\n").unwrap();
        assert_eq!(m.document.title, "X");
        assert_eq!(m.document.kind, DocKind::Typst);
        assert_eq!(m.typst.entry, "main.typ");
        assert!(m.pdf.enabled);
    }
}
