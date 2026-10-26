//! Typst-`World` für ein Dokument: Projektdateien, virtuelle Dateien
//! (generierter Markdoc-Einstieg, eingebaute Komponenten), eingebettete
//! `@sqritto`-Pakete und Pakete aus Typst Universe.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use chrono::{Datelike, Local};
use parking_lot::RwLock;
use typst::diag::{FileError, FileResult, PackageError};
use typst::foundations::{Bytes, Datetime, Dict, Duration, IntoValue};
use typst::syntax::package::PackageSpec;
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_kit::downloader::SystemDownloader;
use typst_kit::files::{FileLoader, FileStore, FsRoot};
use typst_kit::packages::SystemPackages;

use crate::assets;
use crate::fonts::DocFonts;

/// Namensraum der eingebauten Pakete (`@sqritto/...`).
pub const NAMESPACE: &str = "sqritto";
/// Früherer Namensraum (`@typeset/...`); ältere Dokumente importieren ihn weiter.
pub const LEGACY_NAMESPACE: &str = "typeset";

pub fn packages() -> Arc<SystemPackages> {
    static PACKAGES: OnceLock<Arc<SystemPackages>> = OnceLock::new();
    PACKAGES
        .get_or_init(|| {
            Arc::new(SystemPackages::new(SystemDownloader::new(concat!(
                "sqritto/",
                env!("CARGO_PKG_VERSION")
            ))))
        })
        .clone()
}

pub fn file_id(path: &str) -> FileId {
    let vpath = VirtualPath::new(path).unwrap_or_else(|_| VirtualPath::new("/main.typ").unwrap());
    RootedPath::new(VirtualRoot::Project, vpath).intern()
}

/// Liefert Dateien für ein Dokument.
pub struct DocLoader {
    root: FsRoot,
    packages: Arc<SystemPackages>,
    virtual_files: Arc<RwLock<HashMap<String, Bytes>>>,
    overlay_files: Arc<RwLock<HashMap<String, Bytes>>>,
}

impl FileLoader for DocLoader {
    fn load(&self, id: FileId) -> FileResult<Bytes> {
        match id.root() {
            VirtualRoot::Project => {
                let key = id.vpath().get_with_slash().to_string();
                if let Some(b) = self.virtual_files.read().get(&key) {
                    return Ok(b.clone());
                }
                if let Some(b) = self.overlay_files.read().get(&key) {
                    return Ok(b.clone());
                }
                if key.starts_with("/.git/") || key.split('/').nth(1).is_some_and(crate::manifest::is_data_dir) {
                    return Err(FileError::AccessDenied);
                }
                self.root.load(id.vpath())
            }
            VirtualRoot::Package(spec) => load_package_file(&self.packages, spec, id.vpath()),
        }
    }
}

pub fn load_package_file(packages: &SystemPackages, spec: &PackageSpec, vpath: &VirtualPath) -> FileResult<Bytes> {
    if spec.namespace == NAMESPACE || spec.namespace == LEGACY_NAMESPACE {
        let path = format!(
            "typst/{}/{}/{}/{}",
            NAMESPACE,
            spec.name,
            spec.version,
            vpath.get_without_slash()
        );
        return match assets::asset(&path) {
            Some(data) => Ok(Bytes::new(data.into_owned())),
            None => {
                let exists = !assets::list(&format!("typst/{}/{}/{}/", NAMESPACE, spec.name, spec.version)).is_empty();
                if exists {
                    Err(FileError::NotFound(vpath.get_without_slash().into()))
                } else {
                    Err(FileError::Package(PackageError::NotFound(spec.clone())))
                }
            }
        };
    }
    let root = packages.obtain(spec).map_err(FileError::Package)?;
    root.load(vpath)
}

pub struct DocWorld {
    root: PathBuf,
    library: LazyHash<Library>,
    fonts: Arc<DocFonts>,
    main: FileId,
    files: FileStore<DocLoader>,
    virtual_files: Arc<RwLock<HashMap<String, Bytes>>>,
    overlay_files: Arc<RwLock<HashMap<String, Bytes>>>,
    now: chrono::DateTime<Local>,
}

impl DocWorld {
    pub fn new(root: &Path, main: &str, inputs: Dict) -> Self {
        let virtual_files = Arc::new(RwLock::new(HashMap::new()));
        let overlay_files = Arc::new(RwLock::new(HashMap::new()));
        let loader = DocLoader {
            root: FsRoot::new(root.to_path_buf()),
            packages: packages(),
            virtual_files: virtual_files.clone(),
            overlay_files: overlay_files.clone(),
        };
        Self {
            root: root.to_path_buf(),
            library: LazyHash::new(Library::builder().with_inputs(inputs).build()),
            fonts: Arc::new(DocFonts::new(root)),
            main: file_id(main),
            files: FileStore::new(loader),
            virtual_files,
            overlay_files,
            now: Local::now(),
        }
    }

    /// Ersetzt den Inhalt einer Projektdatei (z. B. ungespeicherte Änderungen).
    /// Anders als virtuelle Dateien gelten Überlagerungen als Projektdateien,
    /// sodass Fehlermeldungen auf sie zeigen.
    pub fn set_overlay(&self, path: &str, content: impl Into<String>) {
        self.overlay_files.write().insert(path.to_string(), Bytes::from_string(content.into()));
    }

    pub fn clear_overlay(&self) {
        self.overlay_files.write().clear();
    }

    pub fn set_main(&mut self, main: &str) {
        self.main = file_id(main);
    }

    pub fn set_inputs(&mut self, inputs: Dict) {
        self.library = LazyHash::new(Library::builder().with_inputs(inputs).build());
    }

    /// Setzt eine virtuelle Datei (Pfad mit führendem `/`).
    pub fn set_virtual(&self, path: &str, content: impl Into<String>) {
        self.virtual_files.write().insert(path.to_string(), Bytes::from_string(content.into()));
    }

    pub fn clear_virtual(&self) {
        self.virtual_files.write().clear();
    }

    pub fn is_virtual(&self, id: FileId) -> bool {
        matches!(id.root(), VirtualRoot::Project)
            && self.virtual_files.read().contains_key(id.vpath().get_with_slash())
    }

    /// Vor jeder Übersetzung aufrufen: Dateien neu laden, Zeit aktualisieren.
    pub fn reset(&mut self) {
        self.files.reset();
        self.now = Local::now();
    }

    /// Alle Projektdateien (für die Pfad-Vervollständigung).
    pub fn project_files(&self) -> Vec<FileId> {
        let mut out = Vec::new();
        for entry in walkdir::WalkDir::new(&self.root)
            .max_depth(6)
            .into_iter()
            .filter_entry(|e| {
                let n = e.file_name().to_string_lossy();
                !(n.starts_with('.') && e.depth() > 0) && n != "node_modules" && n != "target"
            })
            .flatten()
        {
            if entry.file_type().is_file()
                && let Ok(v) = VirtualPath::virtualize(&self.root, entry.path())
            {
                out.push(RootedPath::new(VirtualRoot::Project, v).intern());
            }
            if out.len() > 2000 {
                break;
            }
        }
        out
    }
}

impl World for DocWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.fonts.book()
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        self.files.source(id)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.files.file(id)
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.font(index)
    }

    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        let date = match offset {
            None => self.now.naive_local().date(),
            Some(o) => (self.now.naive_utc() + chrono::Duration::seconds(o.seconds() as i64)).date(),
        };
        Datetime::from_ymd(date.year(), date.month() as u8, date.day() as u8)
    }
}

impl typst_ide::IdeWorld for DocWorld {
    fn upcast(&self) -> &dyn World {
        self
    }

    fn files(&self) -> Vec<FileId> {
        self.project_files()
    }
}

/// Wandelt Manifest-Variablen in `sys.inputs` um (nur Zeichenketten).
pub fn inputs_from(vars: &std::collections::BTreeMap<String, serde_json::Value>) -> Dict {
    let mut dict = Dict::new();
    for (k, v) in vars {
        let s = match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        dict.insert(k.as_str().into(), s.into_value());
    }
    dict
}

/// Minimale Welt für einzelne Typst-Schnipsel (Formeln im HTML).
pub struct SnippetWorld {
    library: LazyHash<Library>,
    fonts: Arc<DocFonts>,
    main: Source,
    packages: Arc<SystemPackages>,
    root: Option<PathBuf>,
}

impl SnippetWorld {
    pub fn new(code: String, fonts: Arc<DocFonts>, root: Option<PathBuf>) -> Self {
        static LIB: OnceLock<LazyHash<Library>> = OnceLock::new();
        let library = LIB.get_or_init(|| LazyHash::new(Library::default())).clone();
        Self { library, fonts, main: Source::new(file_id("/__snippet__.typ"), code), packages: packages(), root }
    }
}

impl World for SnippetWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }
    fn book(&self) -> &LazyHash<FontBook> {
        self.fonts.book()
    }
    fn main(&self) -> FileId {
        self.main.id()
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            return Ok(self.main.clone());
        }
        let bytes = self.file(id)?;
        let text = String::from_utf8(bytes.to_vec()).map_err(|_| FileError::InvalidUtf8)?;
        Ok(Source::new(id, text))
    }
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        match id.root() {
            VirtualRoot::Package(spec) => load_package_file(&self.packages, spec, id.vpath()),
            VirtualRoot::Project => match &self.root {
                Some(r) => FsRoot::new(r.clone()).load(id.vpath()),
                None => Err(FileError::NotFound(id.vpath().get_without_slash().into())),
            },
        }
    }
    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.font(index)
    }
    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        let d = Local::now().date_naive();
        Datetime::from_ymd(d.year(), d.month() as u8, d.day() as u8)
    }
}
