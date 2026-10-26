//! Schriftverwaltung: eingebettete Schriften (Inter, JetBrains Mono, Typst-
//! Standardschriften), Systemschriften und dokumentlokale Schriften.

use std::path::Path;
use std::sync::{Arc, OnceLock};

use typst::foundations::Bytes;
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst_kit::fonts::FontStore;

use crate::assets;

static BASE: OnceLock<Arc<FontStore>> = OnceLock::new();

/// Startet das Einlesen der Systemschriften im Hintergrund.
pub fn preload() {
    std::thread::spawn(|| {
        let _ = base();
    });
}

/// Gemeinsamer Schriftbestand aller Dokumente.
pub fn base() -> Arc<FontStore> {
    BASE.get_or_init(|| {
        let started = std::time::Instant::now();
        let mut store = FontStore::new();
        // Eingebettete Schriften zuerst, damit sie Vorrang haben.
        for path in assets::list("fonts/") {
            if !(path.ends_with(".ttf") || path.ends_with(".otf")) {
                continue;
            }
            if let Some(data) = assets::asset(&path) {
                let bytes = Bytes::new(data.into_owned());
                store.extend(Font::iter(bytes).map(|f| {
                    let info = f.info().clone();
                    (f, info)
                }));
            }
        }
        store.extend(typst_kit::fonts::embedded());
        store.extend(typst_kit::fonts::system());
        tracing::info!(
            "Schriften geladen: {} Schnitte in {:?}",
            store.book().families().count(),
            started.elapsed()
        );
        Arc::new(store)
    })
    .clone()
}

/// Schriften eines Dokuments: gemeinsamer Bestand plus Ordner `fonts/`.
pub struct DocFonts {
    base: Arc<FontStore>,
    base_len: usize,
    extra: Vec<Font>,
    book: LazyHash<FontBook>,
}

impl DocFonts {
    pub fn new(root: &Path) -> Self {
        let base = base();
        let mut book: FontBook = (**base.book()).clone();
        let base_len = count(&book);
        let mut extra = Vec::new();
        let dir = root.join("fonts");
        if dir.is_dir() {
            for entry in walkdir::WalkDir::new(&dir).max_depth(3).into_iter().flatten() {
                let p = entry.path();
                let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
                if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc") {
                    continue;
                }
                if let Ok(data) = std::fs::read(p) {
                    for font in Font::iter(Bytes::new(data)) {
                        book.push(font.info().clone());
                        extra.push(font);
                    }
                }
            }
        }
        Self { base, base_len, extra, book: LazyHash::new(book) }
    }

    pub fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    pub fn font(&self, index: usize) -> Option<Font> {
        if index < self.base_len {
            self.base.font(index)
        } else {
            self.extra.get(index - self.base_len).cloned()
        }
    }

    pub fn family_names(&self) -> Vec<String> {
        let mut v: Vec<String> = self.book.families().map(|(name, _)| name.to_string()).collect();
        v.sort_by_key(|a| a.to_lowercase());
        v.dedup();
        v
    }
}

fn count(book: &FontBook) -> usize {
    let mut n = 0;
    while book.info(n).is_some() {
        n += 1;
    }
    n
}
