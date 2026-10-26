//! Eingebettete Ressourcen: Komponenten, Vorlagen, Typst-Pakete, Schriften,
//! die Web-Oberfläche, die Laufzeit der HTML-Site und die Markdoc-Engine.
//!
//! In Debug-Builds liest `rust-embed` direkt vom Dateisystem, sodass
//! Vorlagen und Komponenten ohne Neukompilierung angepasst werden können.

use std::borrow::Cow;

use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "assets/"]
pub struct Assets;

#[derive(RustEmbed)]
#[folder = "web/dist/"]
#[exclude = ".keep"]
pub struct Web;

#[derive(RustEmbed)]
#[folder = "site/dist/"]
#[exclude = ".keep"]
pub struct Site;

/// Gebündelte Markdoc-Engine (siehe `engine/`).
pub const ENGINE_JS: &str = include_str!("../engine/dist/engine.js");

pub fn asset(path: &str) -> Option<Cow<'static, [u8]>> {
    Assets::get(path).map(|f| f.data)
}

pub fn asset_string(path: &str) -> Option<String> {
    asset(path).map(|d| String::from_utf8_lossy(&d).into_owned())
}

/// Alle eingebetteten Pfade unterhalb eines Präfixes (mit abschließendem `/`).
pub fn list(prefix: &str) -> Vec<String> {
    let mut v: Vec<String> = Assets::iter()
        .filter(|p| p.starts_with(prefix))
        .map(|p| p.into_owned())
        .collect();
    v.sort();
    v
}

pub fn site_file(path: &str) -> Option<Cow<'static, [u8]>> {
    Site::get(path).map(|f| f.data)
}

pub fn site_files() -> Vec<String> {
    Site::iter().map(|p| p.into_owned()).collect()
}
