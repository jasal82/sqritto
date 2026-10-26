//! Sqritto – Docs-as-Code-Dokumentenwerkstatt.
//!
//! Ein einziges Programm: lokale App (natives Fenster), Server für mehrere
//! Nutzer (`sqritto serve`) und Kommandozeilen-Build für CI-Pipelines
//! (`sqritto build`).

// Unter Windows als GUI-Programm bauen: kein Konsolenfenster beim Start.
// Aus einem Terminal aufgerufen, hängt sich das Programm an dessen Konsole.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[macro_use]
mod i18n;
mod assets;
mod components;
#[cfg(any(windows, target_os = "macos"))]
mod desktop;
mod elements;
mod engine;
mod fonts;
mod git;
mod highlight;
mod instance;
mod library;
mod manifest;
mod proc;
mod project;
mod server;
mod templates;
mod update;
mod world;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};

// Die Hilfetexte stehen auf Deutsch in den Doc-Kommentaren; die englische
// Fassung legt `english_help` darüber (siehe `parse_cli`).
#[derive(Parser)]
#[command(name = "sqritto", version, about = "Docs-as-Code: Markdoc und Typst zu PDF und HTML5")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    #[command(flatten)]
    common: Common,
    /// Port für die lokale App (Standard: 4517, belegt → freier Port).
    #[arg(long, default_value_t = 4517)]
    port: u16,
    /// Kein Fenster/Browser öffnen.
    // Aus der Umgebung auch `1`/`yes` (sonst verlangt clap `true`/`false`).
    #[arg(long, env = "SQRITTO_NO_OPEN", value_parser = clap::builder::FalseyValueParser::new())]
    no_open: bool,
    /// Im normalen Browser-Tab statt im App-Fenster öffnen.
    #[arg(long)]
    browser: bool,
    /// Festes Zugangstoken für die lokale App (Standard: zufällig).
    #[arg(long, hide = true)]
    token: Option<String>,
}

#[derive(Args, Clone)]
struct Common {
    /// Arbeitsbereich mit den Dokumenten (Standard: Dokumente/Sqritto).
    #[arg(long, global = true, env = "SQRITTO_WORKSPACE")]
    workspace: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Command {
    /// Als Server starten, erreichbar per Browser.
    Serve {
        /// Adresse, an die der Server gebunden wird.
        #[arg(long, default_value = "0.0.0.0", env = "SQRITTO_HOST")]
        host: String,
        #[arg(long, default_value_t = 8080, env = "SQRITTO_PORT")]
        port: u16,
        /// Zugangstoken (Standard: zufällig erzeugt).
        #[arg(long, env = "SQRITTO_TOKEN")]
        token: Option<String>,
        /// Ohne Zugangsschutz betreiben (nur hinter einem Reverse-Proxy mit Anmeldung!).
        #[arg(long)]
        no_auth: bool,
    },
    /// Dokument bauen (für CI/CD), z. B. `sqritto build ./handbuch --pdf out.pdf --html site.zip`.
    Build {
        /// Ordner des Dokuments (mit sqritto.toml).
        dir: PathBuf,
        /// Ziel für das PDF.
        #[arg(long)]
        pdf: Option<PathBuf>,
        /// Ziel für das HTML5-Paket (ZIP).
        #[arg(long)]
        html: Option<PathBuf>,
        /// Erzeugte Typst-Quelle (nur Markdoc-Dokumente) ausgeben.
        #[arg(long)]
        typst: Option<PathBuf>,
    },
}

/// Englische Hilfetexte für `--help` (Gegenstück zu den Doc-Kommentaren oben).
fn english_help(cmd: clap::Command) -> clap::Command {
    cmd.about("Docs-as-Code: Markdoc and Typst to PDF and HTML5")
        .mut_arg("port", |a| a.help("Port for the local app (default: 4517; if taken → a free port)"))
        .mut_arg("no_open", |a| a.help("Don't open a window or browser"))
        .mut_arg("browser", |a| a.help("Open in a regular browser tab instead of the app window"))
        .mut_arg("token", |a| a.help("Fixed access token for the local app (default: random)"))
        .mut_arg("workspace", |a| a.help("Workspace containing the documents (default: Documents/Sqritto)"))
        .mut_subcommand("serve", |s| {
            s.about("Run as a server, accessible via browser")
                .mut_arg("host", |a| a.help("Address the server binds to"))
                .mut_arg("token", |a| a.help("Access token (default: randomly generated)"))
                .mut_arg("no_auth", |a| a.help("Run without access protection (only behind a reverse proxy with authentication!)"))
        })
        .mut_subcommand("build", |s| {
            s.about("Build a document (for CI/CD), e.g. `sqritto build ./manual --pdf out.pdf --html site.zip`")
                .mut_arg("dir", |a| a.help("Document folder (containing sqritto.toml)"))
                .mut_arg("pdf", |a| a.help("Output path for the PDF"))
                .mut_arg("html", |a| a.help("Output path for the HTML5 package (ZIP)"))
                .mut_arg("typst", |a| a.help("Write the generated Typst source (Markdoc documents only)"))
        })
}

/// Liest die Befehlszeile; `--help` erscheint in der Sprache der Oberfläche.
fn parse_cli() -> Cli {
    let mut cmd = Cli::command();
    if i18n::is_en() {
        cmd = english_help(cmd);
    }
    let matches = cmd.get_matches();
    Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit())
}

/// Ordner der Einstellungen (unabhängig von der Befehlszeile, damit die
/// Sprache schon vor dem Auswerten der Argumente feststeht). Aus der Zeit vor
/// der Umbenennung (Typeset) werden die Einstellungen einmalig übernommen.
fn config_dir() -> PathBuf {
    // Eigener Einstellungsordner, z. B. für Tests und Screenshots.
    if let Some(dir) = std::env::var_os("SQRITTO_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    let config_base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let config = config_base.join("sqritto");
    let legacy_config = config_base.join("typeset");
    if !config.exists() && legacy_config.is_dir() && std::fs::rename(&legacy_config, &config).is_err() {
        // Läuft noch eine alte Version, bleibt der bisherige Ordner in Gebrauch.
        return legacy_config;
    }
    config
}

/// Arbeitsbereich und Zwischenspeicher. Ein bestehender Arbeitsbereich
/// „Typeset“ bleibt in Gebrauch, solange es keinen Ordner „Sqritto“ gibt –
/// Dokumente werden nie verschoben.
fn dirs_for(common: &Common) -> (PathBuf, PathBuf) {
    let workspace = common.workspace.clone().unwrap_or_else(|| {
        let base = dirs::document_dir().or_else(dirs::home_dir).unwrap_or_else(|| PathBuf::from("."));
        let (current, legacy) = (base.join("Sqritto"), base.join("Typeset"));
        if !current.exists() && legacy.is_dir() { legacy } else { current }
    });
    let cache = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("sqritto");
    (workspace, cache)
}

fn random_token() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    (0..32).map(|_| format!("{:x}", rng.random_range(0..16u8))).collect()
}

/// Hängt sich unter Windows an die Konsole des aufrufenden Terminals an.
/// Liefert `true`, wenn eine Konsole (oder umgeleitete Ausgabe) vorhanden ist.
fn attach_console() -> bool {
    #[cfg(all(windows, not(debug_assertions)))]
    {
        use windows_sys::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole};
        // Bei umgeleiteter Ausgabe (CI, Pipe) sind die Handles bereits gültig.
        if std::io::IsTerminal::is_terminal(&std::io::stdout()) || std::env::var_os("CI").is_some() {
            return true;
        }
        // SAFETY: Einfacher Win32-Aufruf ohne Zeiger.
        unsafe { AttachConsole(ATTACH_PARENT_PROCESS) != 0 }
    }
    #[cfg(not(all(windows, not(debug_assertions))))]
    {
        true
    }
}

fn init_logging(log_file: Option<PathBuf>) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "sqritto=info,warn".into());
    let builder = tracing_subscriber::fmt().with_env_filter(filter).with_target(false);
    match log_file.and_then(|p| {
        let _ = std::fs::create_dir_all(p.parent()?);
        std::fs::File::create(&p).ok()
    }) {
        Some(file) => builder.with_ansi(false).with_writer(std::sync::Mutex::new(file)).init(),
        None => builder.init(),
    }
}

fn main() -> Result<()> {
    // Vor allem anderen: entfernt die Angaben aus der Umgebung, solange kein weiterer Thread läuft.
    let restart = update::take_restart();
    let has_console = attach_console();
    let config = config_dir();
    i18n::init_from_settings(&config);
    let cli = parse_cli();
    let (workspace, cache) = dirs_for(&cli.common);
    // Ohne Konsole (Start per Doppelklick) landet das Protokoll in einer Datei.
    init_logging((!has_console).then(|| cache.join("sqritto.log")));

    match cli.command {
        Some(Command::Build { dir, pdf, html, typst }) => build(dir, pdf, html, typst),
        Some(Command::Serve { host, port, token, no_auth }) => {
            fonts::preload();
            let token = if no_auth { None } else { Some(token.unwrap_or_else(random_token)) };
            let library = Arc::new(library::Library::open(workspace.clone(), config, true)?);
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(async move {
                let cfg = server::ServerConfig {
                    library,
                    local: false,
                    host: host.clone(),
                    port,
                    token: token.clone(),
                    cache_dir: cache,
                    focus: None,
                    idle_exit: None,
                    wait_for_port: false,
                };
                let (listener, addr) = server::bind(&cfg).await?;
                let version = env!("CARGO_PKG_VERSION");
                let port = addr.port();
                println!();
                println!("{}", tr!("  Sqritto {version} läuft als Server", "  Sqritto {version} is running as a server"));
                println!("{}", tr!("  Arbeitsbereich: {}", "  Workspace:      {}", workspace.display()));
                let shown = if host == "0.0.0.0" {
                    tr!("http://<rechnername>:{port}", "http://<hostname>:{port}")
                } else {
                    format!("http://{addr}")
                };
                println!("{}", tr!("  Adresse:        {shown}", "  Address:        {shown}"));
                match &token {
                    Some(t) => println!(
                        "{}",
                        tr!(
                            "  Zugangstoken:   {t}\n  Direktlink:     {shown}/?token={t}",
                            "  Access token:   {t}\n  Direct link:    {shown}/?token={t}"
                        )
                    ),
                    None => println!("{}", tr!("  Achtung: ohne Zugangsschutz gestartet.", "  Warning: started without access protection.")),
                }
                println!();
                server::serve(cfg, listener).await
            })
        }
        None => run_local(cli, workspace, config, cache, restart),
    }
}

/// Lokale App: Server im Hintergrund, Oberfläche im nativen Fenster (oder,
/// falls nicht verfügbar, als App-Fenster im Browser). `restart`: gestartet
/// von der vorigen Version nach einem Update.
fn run_local(cli: Cli, workspace: PathBuf, config: PathBuf, cache: PathBuf, restart: Option<update::Restart>) -> Result<()> {
    std::fs::create_dir_all(&config)?;
    // Läuft Sqritto schon? Dann nur dessen Fenster nach vorne holen. Nach einem
    // Update ist die laufende Instanz die alte Version, die sich gerade beendet.
    if restart.is_none() && !cli.no_open && instance::activate_existing(&config) {
        return Ok(());
    }
    fonts::preload();
    // Nach einem Update dieselbe Adresse und dasselbe Token wie zuvor: Offene
    // Browser-Tabs bleiben angemeldet, gespeicherte Ansichten (localStorage)
    // gehören zur Adresse. Für Entwicklung/Tests kann das Token fest vorgegeben werden.
    let token = match &restart {
        Some(r) => r.token.clone(),
        None => cli.token.clone().filter(|t| !t.is_empty()).unwrap_or_else(random_token),
    };
    let library = Arc::new(library::Library::open(workspace, config.clone(), false)?);
    let rt = tokio::runtime::Runtime::new()?;

    #[cfg(any(windows, target_os = "macos"))]
    let desktop = (!cli.no_open && !cli.browser).then(desktop::Desktop::new);
    #[cfg(any(windows, target_os = "macos"))]
    let focus = desktop.as_ref().map(|d| d.focus_handle());
    #[cfg(not(any(windows, target_os = "macos")))]
    let focus: Option<server::Callback> = None;

    // Ohne natives Fenster beendet sich die App, sobald kein Browserfenster
    // mehr verbunden ist; mit Fenster endet sie mit dem Fenster.
    let idle_armed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let config_exit = config.clone();
    let mut cfg = server::ServerConfig {
        library,
        local: true,
        host: "127.0.0.1".into(),
        port: restart.as_ref().map_or(cli.port, |r| r.port),
        token: Some(token.clone()),
        cache_dir: cache.clone(),
        focus,
        idle_exit: Some(server::IdleExit {
            armed: idle_armed.clone(),
            on_exit: Arc::new(move || instance::unregister(&config_exit)),
            // Nach einem Update verbindet sich die offene Seite neu; bleibt sie aus, endet die App.
            reconnect: restart.is_some(),
        }),
        wait_for_port: restart.is_some(),
    };
    let (listener, addr) = rt.block_on(server::bind(&cfg))?;
    let base = format!("http://127.0.0.1:{}", addr.port());
    tracing::info!("Sqritto läuft unter {base}");
    update::enable(addr.port(), &token, &cache, &config);
    update::spawn_checks(&rt);

    // Reiner Server ohne Fenster (Entwicklung): nicht als App-Instanz
    // anmelden, sonst würde ein normaler Start nur diesen Server „aktivieren“.
    if cli.no_open {
        println!(
            "{}",
            tr!(
                "Sqritto läuft unter {base}/?token={token} – Strg+C zum Beenden.",
                "Sqritto is running at {base}/?token={token} – press Ctrl+C to quit."
            )
        );
        return rt.block_on(server::serve(cfg, listener));
    }
    instance::register(&config, addr.port(), &token);

    #[cfg(any(windows, target_os = "macos"))]
    if let Some(desktop) = desktop {
        let quit = desktop.quit_handle();
        update::set_quit_handler(move || quit());
        rt.spawn(server::serve(cfg, listener));
        let dark = prefers_dark(&config);
        let config_for_exit = config.clone();
        let result = desktop.run(desktop::RunOptions {
            base_url: base.clone(),
            token: token.clone(),
            config_dir: config.clone(),
            data_dir: cache.join("webview"),
            dark,
            on_exit: Box::new(move || instance::unregister(&config_for_exit)),
        });
        // Nur bei einem Fehler (z. B. fehlende WebView2-Laufzeit) geht es hier weiter.
        if let Err(e) = result {
            tracing::warn!("Natives Fenster nicht verfügbar ({e:#}) – öffne im Browser.");
            idle_armed.store(true, std::sync::atomic::Ordering::SeqCst);
            open_app_window(&format!("{base}/?token={token}"), false);
            rt.block_on(std::future::pending::<()>());
        }
        return Ok(());
    }

    // Browser-Modus: App beendet sich, wenn das letzte Fenster geschlossen ist.
    let url = format!("{base}/?token={token}");
    let reopen = url.clone();
    cfg.focus = Some(Arc::new(move || open_app_window(&reopen, false)));
    let config_quit = config.clone();
    update::set_quit_handler(move || {
        instance::unregister(&config_quit);
        std::process::exit(0);
    });
    idle_armed.store(true, std::sync::atomic::Ordering::SeqCst);
    // Nach einem Update lädt sich die offene Seite selbst neu – kein zweites Fenster.
    if restart.is_none() {
        open_app_window(&url, cli.browser);
    }
    let result = rt.block_on(server::serve(cfg, listener));
    instance::unregister(&config);
    result
}

/// Dunkles Farbschema? (für die Hintergrundfarbe vor dem ersten Zeichnen)
#[cfg(any(windows, target_os = "macos"))]
fn prefers_dark(config: &std::path::Path) -> bool {
    let theme = std::fs::read_to_string(config.join("settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["theme"].as_str().map(str::to_string))
        .unwrap_or_else(|| "system".into());
    match theme.as_str() {
        "dark" => true,
        "light" => false,
        _ => system_dark(),
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn system_dark() -> bool {
    #[cfg(windows)]
    {
        use proc::NoWindow;
        // AppsUseLightTheme = 0 bedeutet dunkles Farbschema.
        std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "/v", "AppsUseLightTheme"])
            .no_window()
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("0x0"))
            .unwrap_or(false)
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("Dark"))
            .unwrap_or(false)
    }
}

/// Öffnet die Oberfläche als App-Fenster (Edge/Chrome `--app`), sonst im Browser.
fn open_app_window(url: &str, force_browser: bool) {
    if !force_browser {
        for exe in app_browsers() {
            if std::process::Command::new(&exe)
                .arg(format!("--app={url}"))
                .arg("--window-size=1480,940")
                .spawn()
                .is_ok()
            {
                return;
            }
        }
    }
    if let Err(e) = open::that_detached(url) {
        eprintln!(
            "{}",
            tr!(
                "Browser konnte nicht geöffnet werden ({e}). Bitte {url} manuell öffnen.",
                "Could not open the browser ({e}). Please open {url} manually."
            )
        );
    }
}

fn app_browsers() -> Vec<PathBuf> {
    let mut v = Vec::new();
    #[cfg(windows)]
    {
        for base in [std::env::var("ProgramFiles(x86)").ok(), std::env::var("ProgramFiles").ok(), std::env::var("LOCALAPPDATA").ok()]
            .into_iter()
            .flatten()
        {
            let b = PathBuf::from(base);
            v.push(b.join(r"Microsoft\Edge\Application\msedge.exe"));
            v.push(b.join(r"Google\Chrome\Application\chrome.exe"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        v.push(PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        v.push(PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for n in ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"] {
            for dir in ["/usr/bin", "/usr/local/bin", "/snap/bin"] {
                v.push(PathBuf::from(dir).join(n));
            }
        }
    }
    v.into_iter().filter(|p| p.is_file()).collect()
}

fn build(dir: PathBuf, pdf: Option<PathBuf>, html: Option<PathBuf>, typst: Option<PathBuf>) -> Result<()> {
    let root = library::dunce(&dir);
    if !manifest::Manifest::exists(&root) {
        bail!("{}", tr!("{} enthält keine sqritto.toml", "{} does not contain a sqritto.toml", root.display()));
    }
    let doc = project::Document::new(library::doc_id(&root), root.clone());
    let manifest = doc.manifest()?;
    let (pdf, html) = if pdf.is_none() && html.is_none() && typst.is_none() {
        let stem = project::file_stem(&manifest.document.title);
        let out = root.join("dist");
        std::fs::create_dir_all(&out)?;
        (
            Some(out.join(format!("{stem}.pdf"))),
            manifest.html_enabled().then(|| out.join(format!("{stem}-html.zip"))),
        )
    } else {
        (pdf, html)
    };
    // Erst prüfen und Diagnosen ausgeben.
    let result = doc.compile();
    for d in &result.diagnostics {
        let loc = match (d.line, d.column) {
            (Some(l), Some(c)) => format!("{}:{l}:{c}", d.path),
            (Some(l), None) => format!("{}:{l}", d.path),
            _ => d.path.clone(),
        };
        let label = if d.severity == "error" { tr!("Fehler", "error") } else { tr!("Warnung", "warning") };
        eprintln!("{label}: {loc}: {}", d.message);
        for h in &d.hints {
            eprintln!("{}", tr!("  Hinweis: {h}", "  hint: {h}"));
        }
    }
    if !result.ok {
        bail!("{}", tr!("Das Dokument enthält Fehler.", "The document contains errors."));
    }
    if let Some(p) = pdf {
        let (data, _) = doc.export_pdf()?;
        std::fs::write(&p, data).with_context(|| tr!("{} konnte nicht geschrieben werden", "Could not write {}", p.display()))?;
        println!("PDF:  {}", p.display());
    }
    if let Some(p) = html {
        let (data, _) = doc.export_html()?;
        std::fs::write(&p, data)?;
        println!("HTML: {}", p.display());
    }
    if let Some(p) = typst {
        std::fs::write(&p, doc.export_typst_source()?)?;
        println!("Typst: {}", p.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn english_help_matches_cli() {
        // `mut_arg`/`mut_subcommand` brechen bei unbekannten Namen ab.
        english_help(Cli::command()).debug_assert();
        Cli::command().debug_assert();
    }
}
