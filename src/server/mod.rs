//! HTTP-Server: REST-API, HTML-Vorschau, eingebettete Web-Oberfläche.

mod api;
mod files;
mod gitapi;
mod preview;
mod watch;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Redirect, Response};
use serde::Serialize;
use tokio::sync::broadcast;

use crate::assets::Web;
use crate::library::Library;

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Inner>,
}

pub struct Inner {
    pub library: Arc<Library>,
    /// Lokaler Modus (Desktop): Systemdialoge, externe Ordner erlaubt.
    pub local: bool,
    pub token: Option<String>,
    pub cache_dir: PathBuf,
    pub events: broadcast::Sender<Event>,
    pub watcher: watch::Watchers,
    /// Holt das App-Fenster nach vorne (zweiter Programmstart).
    pub focus: Option<Callback>,
    /// Verbundene Oberflächen (offene Ereignisströme).
    pub clients: AtomicUsize,
}

pub type Callback = Arc<dyn Fn() + Send + Sync>;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Event {
    FilesChanged { id: String, paths: Vec<String> },
    LibraryChanged,
}

impl std::ops::Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.inner
    }
}

/// Fehler-Antworten als JSON `{ "error": "…" }`.
pub struct ApiError(pub StatusCode, pub String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, axum::Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        let e: anyhow::Error = e.into();
        ApiError(StatusCode::BAD_REQUEST, format!("{e:#}"))
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

pub fn not_found(what: &str) -> ApiError {
    ApiError(StatusCode::NOT_FOUND, tr!("{what} wurde nicht gefunden.", "{what} not found."))
}

pub struct ServerConfig {
    pub library: Arc<Library>,
    pub local: bool,
    pub host: String,
    pub port: u16,
    pub token: Option<String>,
    pub cache_dir: PathBuf,
    pub focus: Option<Callback>,
    /// Beenden, wenn keine Oberfläche mehr verbunden ist (Browser-Modus).
    pub idle_exit: Option<IdleExit>,
    /// Nach einem Update: warten, bis die vorige Version den Port freigibt.
    pub wait_for_port: bool,
}

pub struct IdleExit {
    /// Erst aktiv, wenn gesetzt (im nativen Fenster bleibt es aus).
    pub armed: Arc<std::sync::atomic::AtomicBool>,
    pub on_exit: Callback,
    /// Nach einem Update: Die offene Seite verbindet sich gleich neu – bleibt
    /// sie aus, endet die App wie nach dem Schließen des letzten Fensters.
    pub reconnect: bool,
}

pub async fn bind(cfg: &ServerConfig) -> anyhow::Result<(tokio::net::TcpListener, SocketAddr)> {
    let addr = format!("{}:{}", cfg.host, cfg.port);
    // Die vorige Version beendet sich gerade; ihr Port wird gleich frei (höchstens 30 s warten).
    let mut attempts = if cfg.wait_for_port { 120 } else { 0 };
    let bound = loop {
        match tokio::net::TcpListener::bind(&addr).await {
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse && attempts > 0 => {
                attempts -= 1;
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
            result => break result,
        }
    };
    let listener = match bound {
        Ok(l) => l,
        Err(e) if cfg.local => {
            tracing::warn!("Port {} belegt ({e}), wähle freien Port", cfg.port);
            tokio::net::TcpListener::bind(format!("{}:0", cfg.host)).await?
        }
        Err(e) => return Err(e.into()),
    };
    let local = listener.local_addr()?;
    Ok((listener, local))
}

pub async fn serve(cfg: ServerConfig, listener: tokio::net::TcpListener) -> anyhow::Result<()> {
    let (events, _) = broadcast::channel(256);
    let state = AppState {
        inner: Arc::new(Inner {
            watcher: watch::Watchers::new(events.clone()),
            library: cfg.library,
            local: cfg.local,
            token: cfg.token,
            cache_dir: cfg.cache_dir,
            events,
            focus: cfg.focus,
            clients: AtomicUsize::new(0),
        }),
    };
    if let Some(IdleExit { armed, on_exit: on_idle, reconnect }) = cfg.idle_exit {
        // Ohne eigenes Fenster endet die App, sobald kein Browserfenster mehr
        // verbunden ist (kurze Unterbrechungen wie Neuladen werden toleriert).
        let inner = state.inner.clone();
        tokio::spawn(async move {
            let mut seen = reconnect;
            let mut idle = 0u32;
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if !armed.load(Ordering::SeqCst) {
                    continue;
                }
                if inner.clients.load(Ordering::SeqCst) > 0 {
                    seen = true;
                    idle = 0;
                } else if seen {
                    idle += 2;
                    if idle >= 20 {
                        tracing::info!("Kein Fenster mehr verbunden – Sqritto wird beendet.");
                        on_idle();
                        std::process::exit(0);
                    }
                }
            }
        });
    }
    let app = Router::new()
        .nest("/api", api::router())
        .nest("/preview", preview::router())
        .fallback(static_handler)
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .layer(tower_http::compression::CompressionLayer::new())
        .with_state(state);
    axum::serve(listener, app).await?;
    Ok(())
}

const COOKIE: &str = "sqritto_token";

/// Zugriffsschutz: Token (Cookie/Header/Query) und Host-Prüfung im lokalen
/// Modus (gegen DNS-Rebinding).
async fn guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if state.local {
        let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
        let hostname = host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host);
        if !matches!(hostname, "127.0.0.1" | "localhost" | "[::1]") {
            return (StatusCode::FORBIDDEN, tr!("Zugriff nur lokal erlaubt", "Only local access is allowed")).into_response();
        }
    }
    let Some(token) = state.token.clone() else { return next.run(req).await };
    let uri = req.uri().clone();
    // Token in der URL → Cookie setzen und ohne Token weiterleiten.
    if let Some(q) = uri.query()
        && let Some(t) = q.split('&').find_map(|kv| kv.strip_prefix("token="))
    {
        if t == token {
            let rest: Vec<&str> = q.split('&').filter(|kv| !kv.starts_with("token=")).collect();
            let target = if rest.is_empty() { uri.path().to_string() } else { format!("{}?{}", uri.path(), rest.join("&")) };
            let mut resp = Redirect::to(&target).into_response();
            let cookie = format!("{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000");
            resp.headers_mut().insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
            return resp;
        }
    }
    if authorized(req.headers(), &token) {
        return next.run(req).await;
    }
    if uri.path().starts_with("/api") || uri.path().starts_with("/preview") {
        return ApiError(StatusCode::UNAUTHORIZED, tr!("Nicht angemeldet", "Not signed in")).into_response();
    }
    (StatusCode::UNAUTHORIZED, axum::response::Html(login_page())).into_response()
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    if let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok())
        && auth.strip_prefix("Bearer ").map(|t| t == token).unwrap_or(false)
    {
        return true;
    }
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .any(|c| c.trim() == format!("{COOKIE}={token}"))
}

/// Anmeldeseite für den Server-Modus in der Sprache der Oberfläche.
fn login_page() -> String {
    let lang = crate::i18n::ui_language();
    let title = tr!("Sqritto – Anmeldung", "Sqritto – Sign in");
    let intro = tr!(
        "Bitte das Zugangstoken eingeben, das beim Start des Servers angezeigt wurde.",
        "Please enter the access token that was shown when the server started."
    );
    let placeholder = tr!("Zugangstoken", "Access token");
    let button = tr!("Anmelden", "Sign in");
    format!(
        r#"<!doctype html><html lang="{lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
{LOGIN_STYLE}
<form method="get" action="/"><h1>Sqritto</h1><p>{intro}</p><input name="token" type="password" autofocus placeholder="{placeholder}" autocomplete="current-password"><button>{button}</button></form></html>"#
    )
}

const LOGIN_STYLE: &str = r#"<style>body{font:14px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f4f2;color:#1c1917}form{background:#fff;padding:2rem;border:1px solid #e6e4e0;border-radius:12px;box-shadow:0 12px 28px -10px rgba(28,25,23,.2);width:min(360px,90vw)}h1{font-size:1.15rem;font-weight:600;margin:0 0 .25rem}p{color:#6b665f;margin:0 0 1.25rem}input{width:100%;box-sizing:border-box;padding:.6rem .75rem;border:1px solid #d3d0ca;border-radius:7px;background:#fff;font:inherit}input:focus{outline:none;border-color:#2c5fd4;box-shadow:0 0 0 3px rgba(44,95,212,.28)}button{margin-top:1rem;width:100%;padding:.6rem;border:0;border-radius:7px;background:#1c1917;color:#fff;font:inherit;font-weight:500;cursor:pointer}button:hover{background:#36322e}@media(prefers-color-scheme:dark){body{background:#111;color:#ecebe8}form{background:#181818;border-color:#2a2a2a}p{color:#94918b}input{background:#111;border-color:#3a3a3a;color:inherit}button{background:#ecebe8;color:#181818}button:hover{background:#fff}}</style>"#;

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if let Some(file) = Web::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
        return Response::builder()
            .header(header::CONTENT_TYPE, mime.as_ref())
            .header(header::CACHE_CONTROL, cache)
            .body(Body::from(file.data.into_owned()))
            .unwrap();
    }
    // SPA-Fallback
    match Web::get("index.html") {
        Some(file) => Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(file.data.into_owned()))
            .unwrap(),
        None => (
            StatusCode::NOT_FOUND,
            tr!(
                "Die Weboberfläche ist nicht eingebettet. Bitte `npm run build` ausführen und neu kompilieren.",
                "The web interface is not embedded. Please run `npm run build` and recompile."
            ),
        )
            .into_response(),
    }
}

/// Zählt verbundene Oberflächen; wird mit dem Ereignisstrom freigegeben.
pub struct ClientGuard(Arc<Inner>);

impl ClientGuard {
    pub fn new(inner: Arc<Inner>) -> Self {
        inner.clients.fetch_add(1, Ordering::SeqCst);
        Self(inner)
    }
}

impl Drop for ClientGuard {
    fn drop(&mut self) {
        self.0.clients.fetch_sub(1, Ordering::SeqCst);
    }
}
