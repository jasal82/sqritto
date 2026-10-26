//! REST-API für Bibliothek, Vorlagen, Übersetzung und Exporte.

use std::convert::Infallible;
use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use futures_util::Stream;
use serde::Deserialize;
use serde_json::{Value as Json_, json};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

use super::{ApiError, ApiResult, AppState, Event, files, gitapi, not_found};
use crate::components;
use crate::i18n::pick;
use crate::library::CreateRequest;
use crate::manifest::{DocKind, patch_manifest};
use crate::project::{Document, safe_join};
use crate::templates;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/info", get(info))
        .route("/settings", get(get_settings).put(put_settings))
        .route("/events", get(events))
        .route("/fonts", get(fonts))
        .route("/components", get(builtin_components))
        .route("/format", post(format_markdoc))
        .route("/system/pick-folder", post(pick_folder))
        .route("/system/reveal", post(reveal))
        .route("/system/reveal-file", post(reveal_file))
        .route("/system/focus", post(focus))
        .route("/documents/{id}/export/{format}/save", post(export_save))
        .route("/documents/{id}/export/pdf/open", post(export_open_pdf))
        .route("/templates", get(list_templates).post(save_template))
        .route("/templates/{id}", delete(delete_template))
        .route("/templates/{id}/thumbnail", get(template_thumbnail))
        .route("/universe/templates", get(universe_templates))
        .route("/universe/thumbnail/{name}/{version}", get(universe_thumbnail))
        .route("/documents", get(list_documents).post(create_document))
        .route("/documents/import", post(import_document))
        .route("/documents/{id}", get(get_document).delete(delete_document))
        .route("/documents/{id}/duplicate", post(duplicate_document))
        .route("/documents/{id}/manifest", put(update_manifest))
        .route("/documents/{id}/components", get(doc_components).post(create_component))
        .route("/documents/{id}/components/{name}/preview", post(component_preview))
        .route("/documents/{id}/compile", post(compile))
        .route("/documents/{id}/pages/{n}", get(page))
        .route("/documents/{id}/thumbnail", get(thumbnail))
        .route("/documents/{id}/export/{format}", get(export))
        .route("/documents/{id}/jump", post(jump))
        .route("/documents/{id}/cursor", post(cursor))
        .route("/documents/{id}/complete", post(complete))
        .route("/documents/{id}/watch", post(watch).delete(unwatch))
        .merge(files::router())
        .merge(gitapi::router())
}

pub fn doc(state: &AppState, id: &str) -> ApiResult<Arc<Document>> {
    state.library.get(id).ok_or_else(|| not_found(pick("Das Dokument", "Document")))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> anyhow::Result<T> + Send + 'static) -> ApiResult<T> {
    match tokio::task::spawn_blocking(f).await {
        Ok(r) => r.map_err(ApiError::from),
        Err(e) => Err(ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

async fn info(State(s): State<AppState>) -> Json<Json_> {
    Json(json!({
        "name": "Sqritto",
        "version": env!("CARGO_PKG_VERSION"),
        "typst": "0.15.1",
        "mode": if s.local { "local" } else { "server" },
        "workspace": s.library.workspace.to_string_lossy(),
        "gitCli": crate::git::cli_available(),
        "gitIdentity": crate::git::global_identity(),
        "author": crate::library::default_author(),
        "platform": std::env::consts::OS,
        "language": crate::i18n::ui_language(),
    }))
}

fn settings_path(s: &AppState) -> std::path::PathBuf {
    s.library.config_dir().join("settings.json")
}

async fn get_settings(State(s): State<AppState>) -> Json<Json_> {
    let v = std::fs::read_to_string(settings_path(&s))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));
    Json(v)
}

async fn put_settings(State(s): State<AppState>, Json(body): Json<Json_>) -> ApiResult<Json<Json_>> {
    if !body.is_object() {
        return Err(ApiError(StatusCode::BAD_REQUEST, tr!("Ungültige Einstellungen", "Invalid settings")));
    }
    std::fs::write(settings_path(&s), serde_json::to_string_pretty(&body)?)?;
    crate::i18n::set_ui_language(body.get("language").and_then(|l| l.as_str()).unwrap_or("system"));
    Ok(Json(body))
}

async fn events(State(s): State<AppState>) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let rx = s.events.subscribe();
    let guard = super::ClientGuard::new(s.inner.clone());
    let stream = BroadcastStream::new(rx).filter_map(move |ev| {
        let _connected = &guard;
        let ev: Event = ev.ok()?;
        Some(Ok(SseEvent::default().data(serde_json::to_string(&ev).unwrap_or_default())))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn fonts() -> ApiResult<Json<Vec<String>>> {
    let names = blocking(|| Ok(crate::fonts::DocFonts::new(std::path::Path::new("")).family_names())).await?;
    Ok(Json(names))
}

async fn builtin_components() -> Json<Vec<components::ComponentDef>> {
    Json(components::builtin())
}

#[derive(Deserialize)]
struct FormatReq {
    source: String,
}

async fn format_markdoc(Json(req): Json<FormatReq>) -> ApiResult<Json<Json_>> {
    let text = blocking(move || crate::engine::Engine::global().format(&req.source)).await?;
    Ok(Json(json!({ "text": text })))
}

async fn pick_folder(State(s): State<AppState>) -> ApiResult<Json<Json_>> {
    if !s.local {
        return Err(ApiError(StatusCode::FORBIDDEN, tr!("Nur im lokalen Modus verfügbar.", "Only available in local mode.")));
    }
    let path = rfd::AsyncFileDialog::new().set_title(tr!("Speicherort wählen", "Choose location")).pick_folder().await;
    Ok(Json(json!({ "path": path.map(|p| p.path().to_string_lossy().to_string()) })))
}

async fn focus(State(s): State<AppState>) -> ApiResult<Json<Json_>> {
    if !s.local {
        return Err(ApiError(StatusCode::FORBIDDEN, tr!("Nur im lokalen Modus verfügbar.", "Only available in local mode.")));
    }
    if let Some(f) = &s.focus {
        f();
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct RevealFileReq {
    path: String,
}

/// Zeigt eine gespeicherte Datei im Explorer/Finder an.
async fn reveal_file(State(s): State<AppState>, Json(req): Json<RevealFileReq>) -> ApiResult<Json<Json_>> {
    if !s.local {
        return Err(ApiError(StatusCode::FORBIDDEN, tr!("Nur im lokalen Modus verfügbar.", "Only available in local mode.")));
    }
    let p = std::path::PathBuf::from(&req.path);
    if !p.exists() {
        return Err(not_found(pick("Die Datei", "File")));
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg("-R").arg(&p).spawn();
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = open::that_detached(p.parent().unwrap_or(&p));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct RevealReq {
    id: String,
    #[serde(default)]
    path: Option<String>,
}

async fn reveal(State(s): State<AppState>, Json(req): Json<RevealReq>) -> ApiResult<Json<Json_>> {
    if !s.local {
        return Err(ApiError(StatusCode::FORBIDDEN, tr!("Nur im lokalen Modus verfügbar.", "Only available in local mode.")));
    }
    let d = doc(&s, &req.id)?;
    let target = match req.path.as_deref() {
        Some(p) if !p.is_empty() => safe_join(&d.root, p).unwrap_or(d.root.clone()),
        _ => d.root.clone(),
    };
    open::that_detached(&target)?;
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------

async fn list_templates(State(s): State<AppState>) -> Json<Vec<templates::TemplateInfo>> {
    Json(templates::all(&s.library.workspace))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTemplateReq {
    doc_id: String,
    name: String,
    #[serde(default)]
    description: String,
}

async fn save_template(State(s): State<AppState>, Json(req): Json<SaveTemplateReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &req.doc_id)?;
    let m = d.manifest()?;
    let mut outputs = vec!["pdf".to_string()];
    if m.html_enabled() {
        outputs.push("html".into());
    }
    let id = templates::save_as_template(&s.library.workspace, &d.root, &req.name, &req.description, m.document.kind, &outputs)?;
    let _ = std::fs::remove_file(s.cache_dir.join("template-previews").join(format!("{}.png", id.replace(':', "_"))));
    Ok(Json(json!({ "id": id })))
}

async fn delete_template(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    templates::delete_user_template(&s.library.workspace, &id)?;
    Ok(Json(json!({ "ok": true })))
}

/// Vorschaubild einer Vorlage: Vorlage in einen Cache-Ordner instanziieren,
/// übersetzen und die erste Seite rendern.
async fn template_thumbnail(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    let cache = s.cache_dir.clone();
    let workspace = s.library.workspace.clone();
    let png = blocking(move || {
        let safe_id = id.replace(':', "_");
        if safe_id.contains('/') || safe_id.contains('\\') || safe_id.contains("..") {
            anyhow::bail!("{}", tr!("Ungültige Vorlage", "Invalid template"));
        }
        let lang = crate::i18n::ui_language();
        let file = cache.join("template-previews").join(format!("{safe_id}-{lang}-{}.png", env!("CARGO_PKG_VERSION")));
        if !cfg!(debug_assertions)
            && let Ok(d) = std::fs::read(&file)
        {
            return Ok(d);
        }
        let dir = cache.join("template-previews").join(format!("{safe_id}-{lang}"));
        let _ = std::fs::remove_dir_all(&dir);
        templates::instantiate(
            &workspace,
            &id,
            &dir,
            &templates::Vars { title: tr!("Beispieldokument", "Sample document"), author: tr!("Erika Mustermann", "Jane Doe"), lang: lang.into() },
        )?;
        let d = Document::new(format!("tpl-{safe_id}"), dir.clone());
        let result = d.compile();
        let png = d.page_png(0, 0.9).ok_or_else(|| {
            let first = result.diagnostics.first().map(|x| x.message.clone()).unwrap_or_default();
            anyhow::anyhow!(tr!("Vorschau nicht verfügbar: {first}", "Preview not available: {first}"))
        })?;
        let _ = std::fs::write(&file, &png);
        let _ = std::fs::remove_dir_all(&dir);
        Ok(png)
    })
    .await?;
    Ok(([(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, "max-age=3600")], png).into_response())
}

#[derive(Deserialize)]
struct UniverseQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    category: String,
}

async fn universe_templates(State(s): State<AppState>, Query(q): Query<UniverseQuery>) -> ApiResult<Json<Json_>> {
    let cache = s.cache_dir.clone();
    let list = blocking(move || templates::universe_templates(&cache)).await?;
    let needle = q.q.to_lowercase();
    let filtered: Vec<_> = list
        .into_iter()
        .filter(|t| {
            (needle.is_empty()
                || t.name.to_lowercase().contains(&needle)
                || t.description.to_lowercase().contains(&needle)
                || t.keywords.iter().any(|k| k.to_lowercase().contains(&needle)))
                && (q.category.is_empty() || t.categories.iter().any(|c| *c == q.category))
        })
        .take(120)
        .collect();
    Ok(Json(json!(filtered)))
}

async fn universe_thumbnail(State(s): State<AppState>, Path((name, version)): Path<(String, String)>) -> ApiResult<Response> {
    let cache = s.cache_dir.clone();
    let data = blocking(move || templates::universe_thumbnail(&cache, &name, &version)).await?;
    Ok(([(header::CONTENT_TYPE, "image/webp"), (header::CACHE_CONTROL, "max-age=86400")], data).into_response())
}

// ---------------------------------------------------------------------------
// Dokumente
// ---------------------------------------------------------------------------

async fn list_documents(State(s): State<AppState>) -> ApiResult<Json<Json_>> {
    let lib = s.library.clone();
    let list = blocking(move || Ok(lib.list())).await?;
    Ok(Json(json!(list)))
}

async fn create_document(State(s): State<AppState>, Json(req): Json<CreateRequest>) -> ApiResult<Json<Json_>> {
    let lib = s.library.clone();
    let summary = blocking(move || lib.create(req)).await?;
    let _ = s.events.send(Event::LibraryChanged);
    Ok(Json(json!(summary)))
}

#[derive(Deserialize)]
struct ImportReq {
    path: String,
}

async fn import_document(State(s): State<AppState>, Json(req): Json<ImportReq>) -> ApiResult<Json<Json_>> {
    let lib = s.library.clone();
    let summary = blocking(move || lib.register(&req.path)).await?;
    let _ = s.events.send(Event::LibraryChanged);
    Ok(Json(json!(summary)))
}

async fn get_document(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let summary = s.library.summary_of(&id).ok_or_else(|| not_found(pick("Das Dokument", "Document")))?;
    let manifest = d.manifest().ok();
    Ok(Json(json!({
        "summary": summary,
        "manifest": manifest,
        "last": d.last_result(),
    })))
}

#[derive(Deserialize)]
struct DeleteQuery {
    #[serde(default)]
    files: bool,
}

async fn delete_document(State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<DeleteQuery>) -> ApiResult<Json<Json_>> {
    s.watcher.unwatch(&id);
    let lib = s.library.clone();
    blocking(move || lib.remove(&id, q.files)).await?;
    let _ = s.events.send(Event::LibraryChanged);
    Ok(Json(json!({ "ok": true })))
}

async fn duplicate_document(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let lib = s.library.clone();
    let summary = blocking(move || lib.duplicate(&id)).await?;
    let _ = s.events.send(Event::LibraryChanged);
    Ok(Json(json!(summary)))
}

async fn update_manifest(State(s): State<AppState>, Path(id): Path<String>, Json(patch): Json<Json_>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    s.watcher.note_write(&crate::manifest::manifest_path(&d.root));
    let m = patch_manifest(&d.root, &patch)?;
    Ok(Json(json!(m)))
}

async fn doc_components(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let (list, errors) = components::effective(&d.root);
    Ok(Json(json!({ "components": list, "errors": errors })))
}

#[derive(Deserialize)]
struct NewComponent {
    name: String,
    #[serde(default)]
    from: Option<String>,
}

async fn create_component(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<NewComponent>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let name = req.name.trim().to_lowercase();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') || !name.chars().next().unwrap().is_ascii_alphabetic() {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            tr!(
                "Der Name darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten und muss mit einem Buchstaben beginnen.",
                "The name may only contain lowercase letters, digits and hyphens and must start with a letter."
            ),
        ));
    }
    components::scaffold(&d.root, &name, req.from.as_deref())?;
    Ok(Json(json!({ "ok": true, "path": format!("components/{name}") })))
}

async fn component_preview(
    State(s): State<AppState>,
    Path((id, name)): Path<(String, String)>,
    Json(req): Json<crate::elements::PreviewRequest>,
) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let result = blocking(move || d.element_preview(&name, req)).await?;
    Ok(Json(json!(result)))
}

// ---------------------------------------------------------------------------
// Übersetzung und Vorschau
// ---------------------------------------------------------------------------

async fn compile(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let result = blocking(move || Ok(d.compile())).await?;
    Ok(Json(json!(result)))
}

#[derive(Deserialize)]
struct PageQuery {
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    scale: Option<f32>,
}

async fn page(State(s): State<AppState>, Path((id, n)): Path<(String, String)>, Query(q): Query<PageQuery>) -> ApiResult<Response> {
    let d = doc(&s, &id)?;
    let (num, ext) = match n.split_once('.') {
        Some((a, b)) => (a.to_string(), Some(b.to_string())),
        None => (n.clone(), None),
    };
    let index: usize = num.parse().map_err(|_| not_found(pick("Die Seite", "Page")))?;
    let format = q.format.or(ext).unwrap_or_else(|| "svg".into());
    if format == "png" {
        let scale = q.scale.unwrap_or(2.0).clamp(0.1, 6.0);
        let png = blocking(move || d.page_png(index, scale).ok_or_else(|| anyhow::anyhow!(tr!("Seite nicht verfügbar", "Page not available")))).await?;
        return Ok(([(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, "private, max-age=600")], png).into_response());
    }
    let svg = blocking(move || d.page_svg(index).ok_or_else(|| anyhow::anyhow!(tr!("Seite nicht verfügbar", "Page not available")))).await?;
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "image/svg+xml")
        .header(header::CACHE_CONTROL, "private, max-age=600")
        .body(Body::from(svg.as_str().to_owned()))
        .unwrap())
}

async fn thumbnail(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    let d = doc(&s, &id)?;
    let path = d.thumbnail_path();
    let data = tokio::fs::read(&path).await.map_err(|_| not_found(pick("Das Vorschaubild", "Thumbnail")))?;
    Ok(([(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, "private, max-age=31536000")], data).into_response())
}

fn attachment(data: Vec<u8>, name: &str, mime: &str) -> Response {
    let ascii: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c } else { '_' }).collect();
    let disposition = format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{}", urlencoding::encode(name));
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(data))
        .unwrap()
}

#[derive(Deserialize)]
struct ExportQuery {
    #[serde(default)]
    inline: bool,
}

async fn export(State(s): State<AppState>, Path((id, format)): Path<(String, String)>, Query(q): Query<ExportQuery>) -> ApiResult<Response> {
    let d = doc(&s, &id)?;
    match format.as_str() {
        "pdf" => {
            let (data, name) = blocking(move || d.export_pdf()).await?;
            if q.inline {
                return Ok(([(header::CONTENT_TYPE, "application/pdf"), (header::CACHE_CONTROL, "no-store")], data).into_response());
            }
            Ok(attachment(data, &name, "application/pdf"))
        }
        "html" => {
            let (data, name) = blocking(move || d.export_html()).await?;
            Ok(attachment(data, &name, "application/zip"))
        }
        "typst" => {
            let text = blocking(move || d.export_typst_source()).await?;
            Ok(attachment(text.into_bytes(), "main.typ", "text/plain; charset=utf-8"))
        }
        _ => Err(not_found(pick("Das Exportformat", "Export format"))),
    }
}

#[derive(Deserialize)]
struct JumpReq {
    page: usize,
    x: f64,
    y: f64,
}

async fn jump(State(s): State<AppState>, Path(id): Path<String>, Json(r): Json<JumpReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let res = blocking(move || Ok(d.jump_from_click(r.page, r.x, r.y))).await?;
    Ok(Json(res.unwrap_or(Json_::Null)))
}

#[derive(Deserialize)]
struct CursorReq {
    path: String,
    line: usize,
    column: usize,
}

async fn cursor(State(s): State<AppState>, Path(id): Path<String>, Json(r): Json<CursorReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let res = blocking(move || Ok(d.jump_from_cursor(&r.path, r.line, r.column))).await?;
    Ok(Json(json!(res)))
}

#[derive(Deserialize)]
struct CompleteReq {
    path: String,
    text: String,
    offset: usize,
    #[serde(default)]
    explicit: bool,
}

async fn complete(State(s): State<AppState>, Path(id): Path<String>, Json(r): Json<CompleteReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let res = blocking(move || {
        let offset = r.offset.min(r.text.len());
        // Byte-Offset auf Zeichengrenze bringen.
        let mut o = offset;
        while o > 0 && !r.text.is_char_boundary(o) {
            o -= 1;
        }
        Ok(d.complete(&r.path, &r.text, o, r.explicit))
    })
    .await?;
    Ok(Json(res.unwrap_or(Json_::Null)))
}

async fn watch(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    s.watcher.watch(&id, &d.root);
    Ok(Json(json!({ "ok": true })))
}

async fn unwatch(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    s.watcher.unwatch(&id);
    Ok(Json(json!({ "ok": true })))
}

#[allow(dead_code)]
fn kind_label(k: DocKind) -> &'static str {
    match k {
        DocKind::Markdoc => "markdoc",
        DocKind::Typst => "typst",
    }
}

/// Desktop: Export mit nativem „Speichern unter“-Dialog.
async fn export_save(State(s): State<AppState>, Path((id, format)): Path<(String, String)>) -> ApiResult<Json<Json_>> {
    if !s.local {
        return Err(ApiError(StatusCode::FORBIDDEN, tr!("Nur im lokalen Modus verfügbar.", "Only available in local mode.")));
    }
    let d = doc(&s, &id)?;
    let (data, name) = match format.as_str() {
        "pdf" => blocking(move || d.export_pdf()).await?,
        "html" => blocking(move || d.export_html()).await?,
        "typst" => {
            let text = blocking(move || d.export_typst_source()).await?;
            (text.into_bytes(), "main.typ".to_string())
        }
        _ => return Err(not_found(pick("Das Exportformat", "Export format"))),
    };
    let (label, ext) = match format.as_str() {
        "pdf" => (tr!("PDF-Dokument", "PDF document"), "pdf"),
        "html" => (tr!("ZIP-Archiv", "ZIP archive"), "zip"),
        _ => (tr!("Typst-Quelle", "Typst source"), "typ"),
    };
    let mut dialog = rfd::AsyncFileDialog::new().set_title(tr!("Exportieren", "Export")).set_file_name(&name).add_filter(label, &[ext]);
    if let Some(dir) = dirs::download_dir().or_else(dirs::document_dir) {
        dialog = dialog.set_directory(dir);
    }
    let Some(target) = dialog.save_file().await else {
        return Ok(Json(json!({ "cancelled": true })));
    };
    let path = target.path().to_path_buf();
    tokio::fs::write(&path, data).await.map_err(|e| ApiError(StatusCode::BAD_REQUEST, tr!("Speichern fehlgeschlagen: {e}", "Saving failed: {e}")))?;
    Ok(Json(json!({ "path": path.to_string_lossy() })))
}

/// Desktop: PDF im Standardprogramm öffnen.
async fn export_open_pdf(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    if !s.local {
        return Err(ApiError(StatusCode::FORBIDDEN, tr!("Nur im lokalen Modus verfügbar.", "Only available in local mode.")));
    }
    let d = doc(&s, &id)?;
    let (data, name) = blocking(move || d.export_pdf()).await?;
    let dir = std::env::temp_dir().join("sqritto-pdf");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(name);
    tokio::fs::write(&path, data).await?;
    open::that_detached(&path)?;
    Ok(Json(json!({ "path": path.to_string_lossy() })))
}
