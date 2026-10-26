//! Die Dokumentbibliothek: Dokumente im Arbeitsbereich und zusätzlich
//! registrierte Ordner. Jedes Dokument ist ein Ordner mit `sqritto.toml`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use anyhow::{Context, Result, anyhow, bail};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::manifest::{DocKind, MANIFEST, Manifest, patch_manifest};
use crate::project::Document;
use crate::templates::{self, Vars};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub kind: DocKind,
    pub template: Option<String>,
    pub authors: Vec<String>,
    pub path: String,
    pub folder: String,
    pub modified: i64,
    pub created: Option<String>,
    pub git: bool,
    pub outputs: Vec<String>,
    pub thumbnail: Option<String>,
    pub external: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub title: String,
    pub template: String,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub git: bool,
    #[serde(default)]
    pub author: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Registry {
    #[serde(default)]
    external: Vec<PathBuf>,
}

pub struct Library {
    pub workspace: PathBuf,
    config_dir: PathBuf,
    /// Server-Modus: nur Dokumente im Arbeitsbereich zulassen.
    restricted: bool,
    registry: RwLock<Registry>,
    docs: RwLock<HashMap<String, Arc<Document>>>,
}

pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    for c in s.trim().chars() {
        let mapped = match c {
            'ä' | 'Ä' => "ae".to_string(),
            'ö' | 'Ö' => "oe".to_string(),
            'ü' | 'Ü' => "ue".to_string(),
            'ß' => "ss".to_string(),
            c if c.is_ascii_alphanumeric() => c.to_ascii_lowercase().to_string(),
            _ => "-".to_string(),
        };
        out.push_str(&mapped);
    }
    let mut collapsed = String::new();
    for c in out.chars() {
        if c == '-' && collapsed.ends_with('-') {
            continue;
        }
        collapsed.push(c);
    }
    let s = collapsed.trim_matches('-').to_string();
    if s.is_empty() { tr!("dokument", "document") } else { s.chars().take(60).collect() }
}

pub fn doc_id(path: &Path) -> String {
    let canon = dunce(path);
    let key = canon.to_string_lossy().replace('\\', "/");
    let key = if cfg!(windows) { key.to_lowercase() } else { key };
    blake3::hash(key.as_bytes()).to_hex()[..12].to_string()
}

/// Kanonischer Pfad ohne `\\?\`-Präfix unter Windows.
pub fn dunce(path: &Path) -> PathBuf {
    let p = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if !rest.starts_with("UNC\\") {
            return PathBuf::from(rest);
        }
    }
    p
}

fn latest_mtime(root: &Path) -> i64 {
    let mut latest = SystemTime::UNIX_EPOCH;
    for e in walkdir::WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            e.depth() == 0 || !(n.starts_with('.') || n == "node_modules")
        })
        .flatten()
        .take(2000)
    {
        if e.file_type().is_file()
            && let Ok(m) = e.metadata().map_err(std::io::Error::other).and_then(|m| m.modified())
            && m > latest
        {
            latest = m;
        }
    }
    latest.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl Library {
    pub fn open(workspace: PathBuf, config_dir: PathBuf, restricted: bool) -> Result<Self> {
        std::fs::create_dir_all(&workspace)
            .with_context(|| tr!("Arbeitsbereich {} konnte nicht angelegt werden", "Could not create the workspace {}", workspace.display()))?;
        std::fs::create_dir_all(&config_dir)?;
        // Eigene Vorlagen aus der Zeit vor der Umbenennung (Typeset) übernehmen.
        let legacy = workspace.join(crate::manifest::LEGACY_DATA_DIR);
        let current = workspace.join(crate::manifest::DATA_DIR);
        if legacy.is_dir() && !current.exists() {
            let _ = std::fs::rename(&legacy, &current);
        }
        let registry: Registry = std::fs::read_to_string(config_dir.join("library.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Ok(Self {
            workspace: dunce(&workspace),
            config_dir,
            restricted,
            registry: RwLock::new(registry),
            docs: RwLock::new(HashMap::new()),
        })
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    fn save_registry(&self) -> Result<()> {
        let reg = self.registry.read();
        std::fs::write(self.config_dir.join("library.json"), serde_json::to_string_pretty(&*reg)?)?;
        Ok(())
    }

    fn roots(&self) -> Vec<(PathBuf, bool)> {
        let mut out = Vec::new();
        if let Ok(rd) = std::fs::read_dir(&self.workspace) {
            for e in rd.flatten() {
                let p = e.path();
                let name = e.file_name().to_string_lossy().to_string();
                if p.is_dir() && !name.starts_with('.') && Manifest::exists(&p) {
                    out.push((p, false));
                }
            }
        }
        if !self.restricted {
            for p in &self.registry.read().external {
                if Manifest::exists(p) && !out.iter().any(|(o, _)| o == p) {
                    out.push((p.clone(), true));
                }
            }
        }
        out
    }

    fn handle(&self, root: &Path) -> Arc<Document> {
        let id = doc_id(root);
        if let Some(d) = self.docs.read().get(&id) {
            return d.clone();
        }
        let doc = Arc::new(Document::new(id.clone(), dunce(root)));
        self.docs.write().insert(id, doc.clone());
        doc
    }

    pub fn list(&self) -> Vec<DocSummary> {
        let mut v: Vec<DocSummary> = self.roots().into_iter().map(|(p, ext)| self.summary(&p, ext)).collect();
        v.sort_by(|a, b| b.modified.cmp(&a.modified));
        v
    }

    pub fn summary(&self, root: &Path, external: bool) -> DocSummary {
        let doc = self.handle(root);
        let (manifest, error) = match Manifest::load(root) {
            Ok(m) => (m, None),
            Err(e) => (Manifest::default(), Some(format!("{e:#}"))),
        };
        let mut outputs = vec![];
        if manifest.pdf.enabled || manifest.document.kind == DocKind::Typst {
            outputs.push("pdf".to_string());
        }
        if manifest.html_enabled() {
            outputs.push("html".to_string());
        }
        let thumb = doc.thumbnail_path();
        DocSummary {
            id: doc.id.clone(),
            title: manifest.document.title.clone(),
            subtitle: manifest.document.subtitle.clone(),
            description: manifest.document.description.clone(),
            kind: manifest.document.kind,
            template: manifest.document.template.clone(),
            authors: manifest.document.authors.clone(),
            path: root.to_string_lossy().to_string(),
            folder: root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            modified: latest_mtime(root),
            created: manifest.document.created.clone(),
            git: root.join(".git").exists(),
            outputs,
            thumbnail: thumb.is_file().then(|| {
                let v = std::fs::metadata(&thumb)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                format!("/api/documents/{}/thumbnail?v={v}", doc.id)
            }),
            external,
            error,
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<Document>> {
        if let Some(d) = self.docs.read().get(id) {
            if Manifest::exists(&d.root) {
                return Some(d.clone());
            }
        }
        for (root, _) in self.roots() {
            if doc_id(&root) == id {
                return Some(self.handle(&root));
            }
        }
        None
    }

    pub fn summary_of(&self, id: &str) -> Option<DocSummary> {
        let doc = self.get(id)?;
        let external = !doc.root.starts_with(&self.workspace);
        Some(self.summary(&doc.root, external))
    }

    /// Prüft und normalisiert einen Speicherort.
    fn resolve_location(&self, location: Option<&str>) -> Result<PathBuf> {
        match location.map(str::trim).filter(|s| !s.is_empty()) {
            None => Ok(self.workspace.clone()),
            Some(loc) => {
                let p = PathBuf::from(loc);
                if self.restricted {
                    let full = if p.is_absolute() { p } else { self.workspace.join(p) };
                    let full = dunce(&full);
                    if !full.starts_with(&self.workspace) {
                        bail!(
                            "{}",
                            tr!(
                                "Im Server-Modus sind nur Speicherorte im Arbeitsbereich erlaubt.",
                                "In server mode, only locations inside the workspace are allowed."
                            )
                        );
                    }
                    Ok(full)
                } else {
                    if !p.is_absolute() {
                        bail!("{}", tr!("Bitte einen absoluten Pfad als Speicherort angeben.", "Please specify an absolute path as the location."));
                    }
                    Ok(p)
                }
            }
        }
    }

    pub fn create(&self, req: CreateRequest) -> Result<DocSummary> {
        let title = req.title.trim();
        if title.is_empty() {
            bail!("{}", tr!("Bitte einen Titel angeben.", "Please enter a title."));
        }
        let parent = self.resolve_location(req.location.as_deref())?;
        std::fs::create_dir_all(&parent)?;
        let base = slugify(req.folder.as_deref().filter(|f| !f.trim().is_empty()).unwrap_or(title));
        let mut target = parent.join(&base);
        let mut n = 2;
        while target.exists() {
            target = parent.join(format!("{base}-{n}"));
            n += 1;
        }
        let author = req.author.clone().filter(|a| !a.trim().is_empty()).unwrap_or_else(default_author);
        let lang = crate::i18n::ui_language();
        let vars = Vars { title: title.to_string(), author: author.clone(), lang: lang.into() };
        let result = (|| -> Result<()> {
            if let Some(spec) = req.template.strip_prefix("universe:") {
                let entry = templates::instantiate_universe(spec, &target)?;
                let manifest = format!(
                    "[document]\ntitle = {}\nkind = \"typst\"\ntemplate = {}\nauthors = [{}]\nlang = \"{lang}\"\n\n[typst]\nentry = {}\n\n[pdf]\nenabled = true\n",
                    toml::Value::String(title.into()),
                    toml::Value::String(spec.into()),
                    toml::Value::String(author.clone()),
                    toml::Value::String(entry),
                );
                std::fs::write(target.join(MANIFEST), manifest)?;
                if !target.join(".gitignore").exists() {
                    std::fs::write(target.join(".gitignore"), format!("{}/\n", crate::manifest::DATA_DIR))?;
                }
            } else {
                templates::instantiate(&self.workspace, &req.template, &target, &vars)?;
                if !Manifest::exists(&target) {
                    bail!("{}", tr!("Die Vorlage enthält keine sqritto.toml.", "The template does not contain a sqritto.toml."));
                }
            }
            // Titel, Vorlage und Erstellungsdatum festhalten.
            patch_manifest(
                &target,
                &json!({
                    "document": {
                        "title": title,
                        "template": req.template,
                        "created": chrono::Local::now().to_rfc3339(),
                    }
                }),
            )?;
            if req.git {
                crate::git::init(&target, &author_identity(&author))?;
            }
            Ok(())
        })();
        if let Err(e) = result {
            let _ = std::fs::remove_dir_all(&target);
            return Err(e);
        }
        let external = !dunce(&target).starts_with(&self.workspace);
        if external {
            self.registry.write().external.push(dunce(&target));
            self.save_registry()?;
        }
        Ok(self.summary(&dunce(&target), external))
    }

    /// Nimmt einen vorhandenen Ordner in die Bibliothek auf.
    pub fn register(&self, path: &str) -> Result<DocSummary> {
        if self.restricted {
            bail!("{}", tr!("Im Server-Modus können keine externen Ordner hinzugefügt werden.", "External folders cannot be added in server mode."));
        }
        let p = dunce(Path::new(path.trim()));
        if !p.is_dir() {
            bail!("{}", tr!("Der Ordner existiert nicht.", "The folder does not exist."));
        }
        if !Manifest::exists(&p) {
            // Vorhandenes Typst-Projekt übernehmen.
            let entry = ["main.typ", "index.typ", "document.typ"]
                .iter()
                .find(|f| p.join(f).is_file())
                .map(|s| s.to_string())
                .or_else(|| {
                    std::fs::read_dir(&p).ok()?.flatten().find_map(|e| {
                        let n = e.file_name().to_string_lossy().to_string();
                        n.ends_with(".typ").then_some(n)
                    })
                })
                .ok_or_else(|| {
                    anyhow!(tr!(
                        "Der Ordner enthält weder eine sqritto.toml noch eine Typst-Datei.",
                        "The folder contains neither a sqritto.toml nor a Typst file."
                    ))
                })?;
            let title = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| tr!("Dokument", "Document"));
            let lang = crate::i18n::ui_language();
            std::fs::write(
                p.join(MANIFEST),
                format!(
                    "[document]\ntitle = {}\nkind = \"typst\"\nlang = \"{lang}\"\n\n[typst]\nentry = {}\n",
                    toml::Value::String(title),
                    toml::Value::String(entry)
                ),
            )?;
        }
        if !p.starts_with(&self.workspace) {
            let mut reg = self.registry.write();
            if !reg.external.contains(&p) {
                reg.external.push(p.clone());
            }
            drop(reg);
            self.save_registry()?;
        }
        Ok(self.summary(&p, !p.starts_with(&self.workspace)))
    }

    /// Entfernt ein Dokument aus der Bibliothek, optional in den Papierkorb.
    pub fn remove(&self, id: &str, delete_files: bool) -> Result<()> {
        let doc = self.get(id).ok_or_else(|| anyhow!(tr!("Dokument nicht gefunden", "Document not found")))?;
        let root = doc.root.clone();
        self.docs.write().remove(id);
        {
            let mut reg = self.registry.write();
            reg.external.retain(|p| doc_id(p) != id);
        }
        self.save_registry()?;
        if delete_files {
            trash::delete(&root).map_err(|e| anyhow!(tr!("Konnte nicht in den Papierkorb verschieben: {e}", "Could not move to the trash: {e}")))?;
        } else if root.starts_with(&self.workspace) {
            bail!(
                "{}",
                tr!(
                    "Dokumente im Arbeitsbereich können nur in den Papierkorb verschoben werden.",
                    "Documents in the workspace can only be moved to the trash."
                )
            );
        }
        Ok(())
    }

    pub fn duplicate(&self, id: &str) -> Result<DocSummary> {
        let doc = self.get(id).ok_or_else(|| anyhow!(tr!("Dokument nicht gefunden", "Document not found")))?;
        let manifest = doc.manifest()?;
        let title = tr!("{} (Kopie)", "{} (copy)", manifest.document.title);
        let parent = doc.root.parent().map(Path::to_path_buf).unwrap_or_else(|| self.workspace.clone());
        let parent = if self.restricted { self.workspace.clone() } else { parent };
        let base = slugify(&title);
        let mut target = parent.join(&base);
        let mut n = 2;
        while target.exists() {
            target = parent.join(format!("{base}-{n}"));
            n += 1;
        }
        for e in walkdir::WalkDir::new(&doc.root)
            .into_iter()
            .filter_entry(|e| {
                let n = e.file_name().to_string_lossy();
                e.depth() == 0 || !(n == ".git" || crate::manifest::is_data_dir(&n))
            })
            .flatten()
        {
            let rel = e.path().strip_prefix(&doc.root)?;
            let dest = target.join(rel);
            if e.file_type().is_dir() {
                std::fs::create_dir_all(&dest)?;
            } else {
                std::fs::copy(e.path(), &dest)?;
            }
        }
        patch_manifest(&target, &json!({ "document": { "title": title, "created": chrono::Local::now().to_rfc3339() } }))?;
        let external = !dunce(&target).starts_with(&self.workspace);
        if external {
            self.registry.write().external.push(dunce(&target));
            self.save_registry()?;
        }
        Ok(self.summary(&dunce(&target), external))
    }
}

pub fn default_author() -> String {
    if let Some(name) = crate::git::global_identity().map(|(n, _)| n).filter(|n| !n.is_empty()) {
        return name;
    }
    std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_else(|_| tr!("Autor", "Author"))
}

pub fn author_identity(name: &str) -> (String, String) {
    match crate::git::global_identity() {
        Some((n, e)) if !n.is_empty() && !e.is_empty() => (n, e),
        _ => (name.to_string(), format!("{}@localhost", slugify(name))),
    }
}
