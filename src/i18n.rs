//! Sprache der Oberfläche und der Meldungen: Deutsch oder Englisch.
//!
//! Die Einstellung `language` (`system`, `de`, `en`) aus `settings.json`
//! bestimmt die Sprache; `system` folgt der Sprache des Betriebssystems
//! (Deutsch bei deutscher Systemsprache, sonst Englisch). Texte im Code stehen
//! paarweise: `tr!("Deutsch {x}", "English {x}")`.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

/// Übernimmt die Einstellung (`system`, `de` oder `en`).
pub fn set_ui_language(setting: &str) {
    let english = match setting {
        "de" => false,
        "en" => true,
        _ => !system_is_german(),
    };
    ENGLISH.store(english, Ordering::Relaxed);
}

/// Liest die Einstellung aus `settings.json` im Konfigurationsordner. Die
/// Umgebungsvariable `SQRITTO_LANGUAGE` (`de`, `en`, `system`) hat Vorrang.
pub fn init_from_settings(config_dir: &Path) {
    if let Ok(lang) = std::env::var("SQRITTO_LANGUAGE")
        && !lang.is_empty()
    {
        set_ui_language(&lang);
        return;
    }
    let setting = std::fs::read_to_string(config_dir.join("settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("language").and_then(|l| l.as_str()).map(str::to_string))
        .unwrap_or_else(|| "system".into());
    set_ui_language(&setting);
}

pub fn is_en() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// Sprachkürzel der Oberfläche (`de` oder `en`).
pub fn ui_language() -> &'static str {
    if is_en() { "en" } else { "de" }
}

/// Wählt zwischen deutschem und englischem Text.
pub fn pick<'a>(de: &'a str, en: &'a str) -> &'a str {
    if is_en() { en } else { de }
}

fn system_is_german() -> bool {
    // Umgebungsvariablen haben Vorrang (z. B. LANG=de_DE.UTF-8 in einem Terminal).
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(v) = std::env::var(key)
            && !v.is_empty()
            && v != "C"
            && v != "POSIX"
            && !v.starts_with("C.")
        {
            return v.to_lowercase().starts_with("de");
        }
    }
    sys_locale::get_locale().is_some_and(|l| l.to_lowercase().starts_with("de"))
}

/// Text in der Sprache der Oberfläche; Platzhalter wie bei `format!`.
///
/// `tr!("Datei {name} fehlt", "File {name} is missing")`
#[macro_export]
macro_rules! tr {
    ($de:literal, $en:literal $(,)?) => {
        if $crate::i18n::is_en() { format!($en) } else { format!($de) }
    };
    ($de:literal, $en:literal, $($arg:tt)+) => {
        if $crate::i18n::is_en() { format!($en, $($arg)+) } else { format!($de, $($arg)+) }
    };
}
