//! Vorlagen für neue Dokumente: eingebaute (eingebettet), eigene (im
//! Arbeitsbereich unter `.sqritto/templates`) und Typst-Universe-Vorlagen.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{Context, Result, anyhow, bail};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use typst::syntax::package::PackageSpec;
use typst_kit::downloader::{Downloader, SystemDownloader};

use crate::assets;
use crate::manifest::DocKind;
use crate::world;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub kind: DocKind,
    #[serde(default)]
    pub outputs: Vec<String>,
    #[serde(default = "default_order")]
    pub order: i32,
    #[serde(default)]
    pub source: TemplateSource,
}

fn default_category() -> String {
    tr!("Sonstige", "Other")
}
fn default_order() -> i32 {
    100
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TemplateSource {
    #[default]
    Builtin,
    User,
}

#[derive(Deserialize)]
struct TemplateFile {
    template: TemplateInfoRaw,
}

/// Englische Angaben einer Vorlage (`[template.en]` in `template.toml`).
#[derive(Deserialize, Default)]
struct TemplateTexts {
    name: Option<String>,
    description: Option<String>,
    category: Option<String>,
}

#[derive(Deserialize)]
struct TemplateInfoRaw {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_category")]
    category: String,
    #[serde(default)]
    kind: DocKind,
    #[serde(default)]
    outputs: Vec<String>,
    #[serde(default = "default_order")]
    order: i32,
    #[serde(default)]
    en: Option<TemplateTexts>,
}

fn parse_info(id: &str, text: &str, source: TemplateSource) -> Option<TemplateInfo> {
    let f: TemplateFile = toml::from_str(text).ok()?;
    let r = f.template;
    let en = if crate::i18n::is_en() { r.en.unwrap_or_default() } else { TemplateTexts::default() };
    Some(TemplateInfo {
        id: id.to_string(),
        name: en.name.unwrap_or(r.name),
        description: en.description.unwrap_or(r.description),
        category: en.category.unwrap_or(r.category),
        kind: r.kind,
        outputs: r.outputs,
        order: r.order,
        source,
    })
}

pub fn builtin() -> Vec<TemplateInfo> {
    let mut ids: Vec<String> = assets::list("templates/")
        .iter()
        .filter_map(|p| p.strip_prefix("templates/").and_then(|r| r.split('/').next()).map(str::to_string))
        .collect();
    ids.sort();
    ids.dedup();
    let mut out: Vec<TemplateInfo> = ids
        .iter()
        .filter_map(|id| {
            let text = assets::asset_string(&format!("templates/{id}/template.toml"))?;
            parse_info(id, &text, TemplateSource::Builtin)
        })
        .collect();
    out.sort_by_key(|t| (t.order, t.name.clone()));
    out
}

pub fn user_dir(workspace: &Path) -> PathBuf {
    workspace.join(crate::manifest::DATA_DIR).join("templates")
}

pub fn user(workspace: &Path) -> Vec<TemplateInfo> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(user_dir(workspace)) else { return out };
    for e in rd.flatten() {
        let id = e.file_name().to_string_lossy().to_string();
        if let Ok(text) = std::fs::read_to_string(e.path().join("template.toml"))
            && let Some(mut info) = parse_info(&format!("user:{id}"), &text, TemplateSource::User)
        {
            // Eigene Vorlagen ohne (oder mit der früher fest eingetragenen)
            // Kategorie erscheinen unter „Eigene Vorlagen“ in der Sprache der Oberfläche.
            if info.category == default_category() || USER_CATEGORIES.contains(&info.category.as_str()) {
                info.category = tr!("Eigene Vorlagen", "My templates");
            }
            out.push(info);
        }
    }
    out.sort_by_key(|t| (t.order, t.name.clone()));
    out
}

/// Bezeichnungen der Kategorie eigener Vorlagen (beide Sprachen).
const USER_CATEGORIES: [&str; 2] = ["Eigene Vorlagen", "My templates"];

pub fn all(workspace: &Path) -> Vec<TemplateInfo> {
    let mut v = builtin();
    v.extend(user(workspace));
    v
}

/// Werte für Platzhalter in Vorlagendateien.
pub struct Vars {
    pub title: String,
    pub author: String,
    pub lang: String,
}

impl Vars {
    /// Ersetzt Platzhalter. In `.toml`/`.typ` stehen sie in Zeichenketten,
    /// daher werden `\` und `"` dort maskiert. `{{date}}` folgt der Sprache
    /// des Dokuments (deutsch: 26.10.2026, englisch: October 26, 2026).
    fn apply(&self, text: &str, path: &str) -> String {
        let now = chrono::Local::now();
        let lang = self.lang.to_lowercase();
        let date_format = if lang.starts_with("de") {
            "%d.%m.%Y"
        } else if lang.starts_with("en") {
            "%B %-d, %Y"
        } else {
            "%Y-%m-%d"
        };
        let quoted = path.ends_with(".toml") || path.ends_with(".typ");
        let esc = |s: &str| if quoted { s.replace('\\', "\\\\").replace('"', "\\\"") } else { s.to_string() };
        text.replace("{{title}}", &esc(&self.title))
            .replace("{{author}}", &esc(&self.author))
            .replace("{{date}}", &now.format(date_format).to_string())
            .replace("{{isodate}}", &now.format("%Y-%m-%d").to_string())
            .replace("{{year}}", &now.format("%Y").to_string())
            .replace("{{lang}}", &esc(&self.lang))
    }
}

fn is_text(path: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "toml" | "mdoc" | "md" | "markdoc" | "typ" | "json" | "css" | "html" | "txt" | "yml" | "yaml" | "gitignore" | "js" | "svg"
    ) || path.ends_with(".gitignore")
}

/// Kopiert die Dateien einer Vorlage in `target` (muss leer sein/fehlen).
pub fn instantiate(workspace: &Path, id: &str, target: &Path, vars: &Vars) -> Result<()> {
    std::fs::create_dir_all(target)?;
    if let Some(user_id) = id.strip_prefix("user:") {
        let src = user_dir(workspace).join(user_id).join("files");
        if !src.is_dir() {
            bail!("{}", tr!("Vorlage „{user_id}“ wurde nicht gefunden.", "Template “{user_id}” not found."));
        }
        for entry in walkdir::WalkDir::new(&src).into_iter().flatten() {
            let rel = entry.path().strip_prefix(&src)?.to_path_buf();
            let dest = target.join(&rel);
            if entry.file_type().is_dir() {
                std::fs::create_dir_all(&dest)?;
                continue;
            }
            let rel_s = rel.to_string_lossy().replace('\\', "/");
            if is_text(&rel_s) {
                let text = std::fs::read_to_string(entry.path())?;
                std::fs::write(&dest, vars.apply(&text, &rel_s))?;
            } else {
                std::fs::copy(entry.path(), &dest)?;
            }
        }
        return Ok(());
    }
    // Englische Fassung (`files.en/`), sofern vorhanden und die Oberfläche Englisch ist.
    let english = format!("templates/{id}/files.en/");
    let prefix = if crate::i18n::is_en() && !assets::list(&english).is_empty() { english } else { format!("templates/{id}/files/") };
    let files = assets::list(&prefix);
    if files.is_empty() {
        bail!("{}", tr!("Vorlage „{id}“ wurde nicht gefunden.", "Template “{id}” not found."));
    }
    for path in files {
        let rel = &path[prefix.len()..];
        let dest = target.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = assets::asset(&path).ok_or_else(|| anyhow!(tr!("Datei fehlt: {path}", "File missing: {path}")))?;
        if is_text(rel) {
            std::fs::write(&dest, vars.apply(&String::from_utf8_lossy(&data), rel))?;
        } else {
            std::fs::write(&dest, &data)?;
        }
    }
    Ok(())
}

/// Speichert ein vorhandenes Dokument als eigene Vorlage.
pub fn save_as_template(workspace: &Path, doc_root: &Path, name: &str, description: &str, kind: DocKind, outputs: &[String]) -> Result<String> {
    let id = crate::library::slugify(name);
    let dir = user_dir(workspace).join(&id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    let files = dir.join("files");
    std::fs::create_dir_all(&files)?;
    for entry in walkdir::WalkDir::new(doc_root)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            e.depth() == 0 || !(n == ".git" || crate::manifest::is_data_dir(&n))
        })
        .flatten()
    {
        let rel = entry.path().strip_prefix(doc_root)?;
        if rel.as_os_str().is_empty() {
            continue;
        }
        let dest = files.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else {
            std::fs::copy(entry.path(), &dest)?;
        }
    }
    // Ohne Kategorie: eigene Vorlagen erscheinen in jeder Sprache unter „Eigene Vorlagen“.
    let toml = format!(
        "[template]\nname = {}\ndescription = {}\nkind = \"{}\"\noutputs = [{}]\norder = 50\n",
        toml_str(name),
        toml_str(description),
        match kind {
            DocKind::Markdoc => "markdoc",
            DocKind::Typst => "typst",
        },
        outputs.iter().map(|o| toml_str(o)).collect::<Vec<_>>().join(", ")
    );
    std::fs::write(dir.join("template.toml"), toml)?;
    Ok(format!("user:{id}"))
}

pub fn delete_user_template(workspace: &Path, id: &str) -> Result<()> {
    let id = id.strip_prefix("user:").ok_or_else(|| anyhow!(tr!("Nur eigene Vorlagen können gelöscht werden.", "Only your own templates can be deleted.")))?;
    let dir = user_dir(workspace).join(crate::library::slugify(id));
    if dir.is_dir() {
        std::fs::remove_dir_all(dir)?;
    }
    Ok(())
}

fn toml_str(s: &str) -> String {
    toml::Value::String(s.to_string()).to_string()
}

// ----------------------------------------------------------------------
// Typst Universe
// ----------------------------------------------------------------------

const UNIVERSE: &str = "https://packages.typst.org/preview";

fn downloader() -> &'static SystemDownloader {
    static D: OnceLock<SystemDownloader> = OnceLock::new();
    D.get_or_init(|| SystemDownloader::new(concat!("sqritto/", env!("CARGO_PKG_VERSION"))))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UniverseTemplate {
    pub name: String,
    pub version: String,
    pub description: String,
    pub authors: Vec<String>,
    pub categories: Vec<String>,
    pub keywords: Vec<String>,
    pub updated: i64,
}

/// Lädt (und cached) die Liste der Vorlagen aus Typst Universe.
pub fn universe_templates(cache_dir: &Path) -> Result<Vec<UniverseTemplate>> {
    static CACHE: OnceLock<Mutex<Option<(std::time::Instant, Vec<UniverseTemplate>)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    if let Some((t, v)) = &*cache.lock()
        && t.elapsed().as_secs() < 3600
    {
        return Ok(v.clone());
    }
    let file = cache_dir.join("universe-index.json");
    let data = match downloader().download(&"package index", &format!("{UNIVERSE}/index.json")) {
        Ok(d) => {
            let _ = std::fs::create_dir_all(cache_dir);
            let _ = std::fs::write(&file, &d);
            d
        }
        Err(e) => std::fs::read(&file).map_err(|_| anyhow!(tr!("Typst Universe ist nicht erreichbar: {e}", "Typst Universe is not reachable: {e}")))?,
    };
    let entries: Vec<Json> = serde_json::from_slice(&data).with_context(|| tr!("Paketindex ist ungültig", "The package index is invalid"))?;
    let mut latest: std::collections::BTreeMap<String, UniverseTemplate> = Default::default();
    for e in entries {
        if e.get("template").is_none() {
            continue;
        }
        let name = e["name"].as_str().unwrap_or_default().to_string();
        let version = e["version"].as_str().unwrap_or_default().to_string();
        let newer = latest.get(&name).map(|t| version_key(&version) > version_key(&t.version)).unwrap_or(true);
        if !newer {
            continue;
        }
        let strs = |k: &str| -> Vec<String> {
            e[k].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
        };
        latest.insert(
            name.clone(),
            UniverseTemplate {
                name,
                version,
                description: e["description"].as_str().unwrap_or_default().to_string(),
                authors: strs("authors").into_iter().map(|a| a.split('<').next().unwrap_or("").trim().to_string()).collect(),
                categories: strs("categories"),
                keywords: strs("keywords"),
                updated: e["updatedAt"].as_i64().unwrap_or(0),
            },
        );
    }
    let mut list: Vec<UniverseTemplate> = latest.into_values().collect();
    list.sort_by(|a, b| b.updated.cmp(&a.updated));
    *cache.lock() = Some((std::time::Instant::now(), list.clone()));
    Ok(list)
}

fn version_key(v: &str) -> (u32, u32, u32) {
    let mut it = v.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

/// Vorschaubild einer Universe-Vorlage (mit Datei-Cache).
pub fn universe_thumbnail(cache_dir: &Path, name: &str, version: &str) -> Result<Vec<u8>> {
    let safe = |s: &str| s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_');
    if !safe(name) || !safe(version) {
        bail!("{}", tr!("Ungültiger Paketname", "Invalid package name"));
    }
    let file = cache_dir.join("thumbnails").join(format!("{name}-{version}.webp"));
    if let Ok(d) = std::fs::read(&file) {
        return Ok(d);
    }
    let data = downloader()
        .download(&"thumbnail", &format!("{UNIVERSE}/thumbnails/{name}-{version}-small.webp"))
        .map_err(|e| anyhow!(tr!("Vorschaubild nicht verfügbar: {e}", "Thumbnail not available: {e}")))?;
    let _ = std::fs::create_dir_all(file.parent().unwrap());
    let _ = std::fs::write(&file, &data);
    Ok(data)
}

/// Legt ein Dokument aus einer Universe-Vorlage an (wie `typst init`).
/// Gibt den Einstiegspunkt relativ zum Dokument zurück.
pub fn instantiate_universe(spec: &str, target: &Path) -> Result<String> {
    let spec: PackageSpec = spec.trim().parse().map_err(|e| anyhow!(tr!("Ungültige Paketangabe: {e}", "Invalid package specification: {e}")))?;
    let packages = world::packages();
    let root = packages.obtain(&spec).map_err(|e| anyhow!(tr!("Paket konnte nicht geladen werden: {e}", "Could not load the package: {e}")))?;
    let manifest_text = std::fs::read_to_string(root.path().join("typst.toml"))?;
    let manifest: toml::Table = toml::from_str(&manifest_text)?;
    let tpl = manifest
        .get("template")
        .and_then(|t| t.as_table())
        .ok_or_else(|| anyhow!(tr!("Das Paket {spec} enthält keine Vorlage.", "The package {spec} does not contain a template.")))?;
    let path = tpl.get("path").and_then(|p| p.as_str()).unwrap_or("template");
    let entry = tpl.get("entrypoint").and_then(|p| p.as_str()).unwrap_or("main.typ").to_string();
    let src = root.path().join(path);
    std::fs::create_dir_all(target)?;
    for e in walkdir::WalkDir::new(&src).into_iter().flatten() {
        let rel = e.path().strip_prefix(&src)?;
        if rel.as_os_str().is_empty() {
            continue;
        }
        let dest = target.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else {
            std::fs::copy(e.path(), &dest)?;
        }
    }
    Ok(entry)
}
