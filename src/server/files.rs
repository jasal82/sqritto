//! Dateizugriff innerhalb eines Dokuments.

use std::path::Path as FsPath;

use axum::Json;
use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json_, json};

use super::api::doc;
use super::{ApiError, ApiResult, AppState, not_found};
use crate::i18n::pick;
use crate::project::safe_join;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/documents/{id}/tree", get(tree))
        .route("/documents/{id}/file", get(read_file).put(write_file))
        .route("/documents/{id}/raw/{*path}", get(raw))
        .route("/documents/{id}/files", post(file_op))
        .route("/documents/{id}/upload", post(upload))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    name: String,
    path: String,
    kind: &'static str,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<Node>>,
}

fn hidden(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "target"
}

fn build_tree(root: &FsPath, dir: &FsPath, depth: usize) -> Vec<Node> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by(|a, b| {
        let ad = a.path().is_dir();
        let bd = b.path().is_dir();
        bd.cmp(&ad).then_with(|| a.file_name().to_string_lossy().to_lowercase().cmp(&b.file_name().to_string_lossy().to_lowercase()))
    });
    for e in entries {
        let name = e.file_name().to_string_lossy().to_string();
        if hidden(&name) && name != ".gitignore" {
            continue;
        }
        let p = e.path();
        let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
        if p.is_dir() {
            let children = if depth < 8 { build_tree(root, &p, depth + 1) } else { vec![] };
            out.push(Node { name, path: rel, kind: "dir", size: 0, children: Some(children) });
        } else {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(Node { name, path: rel, kind: "file", size, children: None });
        }
    }
    out
}

async fn tree(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let root = d.root.clone();
    let nodes = tokio::task::spawn_blocking(move || build_tree(&root, &root, 0)).await.unwrap_or_default();
    Ok(Json(json!(nodes)))
}

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

fn resolve(s: &AppState, id: &str, rel: &str) -> ApiResult<(std::sync::Arc<crate::project::Document>, std::path::PathBuf)> {
    let d = doc(s, id)?;
    let rel_norm = rel.replace('\\', "/");
    if rel_norm.split('/').any(|seg| seg == ".git") {
        return Err(ApiError(StatusCode::FORBIDDEN, tr!("Zugriff verweigert", "Access denied")));
    }
    let p = safe_join(&d.root, &rel_norm).ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, tr!("Ungültiger Pfad", "Invalid path")))?;
    Ok((d, p))
}

async fn read_file(State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<PathQuery>) -> ApiResult<Response> {
    let (_, p) = resolve(&s, &id, &q.path)?;
    let data = tokio::fs::read(&p).await.map_err(|_| not_found(pick("Die Datei", "File")))?;
    match String::from_utf8(data) {
        Ok(text) => Ok(([(header::CONTENT_TYPE, "text/plain; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], text).into_response()),
        Err(_) => Err(ApiError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            tr!("Binärdatei kann nicht als Text geöffnet werden.", "Binary files cannot be opened as text."),
        )),
    }
}

async fn write_file(State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<PathQuery>, body: Bytes) -> ApiResult<Json<Json_>> {
    let (_, p) = resolve(&s, &id, &q.path)?;
    if let Some(parent) = p.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    s.watcher.note_write(&p);
    tokio::fs::write(&p, &body).await?;
    Ok(Json(json!({ "ok": true, "size": body.len() })))
}

async fn raw(State(s): State<AppState>, Path((id, path)): Path<(String, String)>) -> ApiResult<Response> {
    let (_, p) = resolve(&s, &id, &path)?;
    let data = tokio::fs::read(&p).await.map_err(|_| not_found(pick("Die Datei", "File")))?;
    let mime = mime_guess::from_path(&p).first_or_octet_stream();
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, "no-cache")
        .header("Content-Security-Policy", "sandbox")
        .body(Body::from(data))
        .unwrap())
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
enum FileOp {
    Create {
        path: String,
        #[serde(default)]
        content: String,
    },
    Mkdir {
        path: String,
    },
    Rename {
        path: String,
        to: String,
    },
    Delete {
        path: String,
    },
}

async fn file_op(State(s): State<AppState>, Path(id): Path<String>, Json(op): Json<FileOp>) -> ApiResult<Json<Json_>> {
    match op {
        FileOp::Create { path, content } => {
            let (_, p) = resolve(&s, &id, &path)?;
            if p.exists() {
                return Err(ApiError(StatusCode::CONFLICT, tr!("Eine Datei mit diesem Namen existiert bereits.", "A file with this name already exists.")));
            }
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent)?;
            }
            s.watcher.note_write(&p);
            std::fs::write(&p, content)?;
        }
        FileOp::Mkdir { path } => {
            let (_, p) = resolve(&s, &id, &path)?;
            std::fs::create_dir_all(&p)?;
        }
        FileOp::Rename { path, to } => {
            let (_, from) = resolve(&s, &id, &path)?;
            let (_, dest) = resolve(&s, &id, &to)?;
            if dest.exists() {
                return Err(ApiError(StatusCode::CONFLICT, tr!("Das Ziel existiert bereits.", "The target already exists.")));
            }
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            s.watcher.note_write(&from);
            s.watcher.note_write(&dest);
            std::fs::rename(&from, &dest)?;
        }
        FileOp::Delete { path } => {
            let (d, p) = resolve(&s, &id, &path)?;
            if p == crate::manifest::manifest_path(&d.root) {
                return Err(ApiError(
                    StatusCode::BAD_REQUEST,
                    tr!("Die Projektdatei sqritto.toml kann nicht gelöscht werden.", "The project file sqritto.toml cannot be deleted."),
                ));
            }
            s.watcher.note_write(&p);
            if p.is_dir() {
                trash::delete(&p).or_else(|_| std::fs::remove_dir_all(&p).map_err(|e| trash::Error::Unknown { description: e.to_string() }))
                    .map_err(|e| anyhow::anyhow!("{e}"))?;
            } else {
                trash::delete(&p).or_else(|_| std::fs::remove_file(&p).map_err(|e| trash::Error::Unknown { description: e.to_string() }))
                    .map_err(|e| anyhow::anyhow!("{e}"))?;
            }
        }
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct UploadQuery {
    #[serde(default = "default_dir")]
    dir: String,
}

fn default_dir() -> String {
    "assets".into()
}

async fn upload(State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<UploadQuery>, mut mp: Multipart) -> ApiResult<Json<Json_>> {
    let mut saved = Vec::new();
    while let Some(field) = mp.next_field().await.map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.to_string()))? {
        let name = field.file_name().map(sanitize).unwrap_or_else(|| pick("datei", "file").into());
        let data = field.bytes().await.map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.to_string()))?;
        let dir = q.dir.trim_matches('/');
        let (d, mut p) = resolve(&s, &id, &format!("{dir}/{name}"))?;
        // Bei Namenskonflikt nummerieren.
        let stem = p.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
        let ext = p.extension().map(|x| format!(".{}", x.to_string_lossy())).unwrap_or_default();
        let mut n = 2;
        while p.exists() {
            p.set_file_name(format!("{stem}-{n}{ext}"));
            n += 1;
        }
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        s.watcher.note_write(&p);
        std::fs::write(&p, &data)?;
        saved.push(p.strip_prefix(&d.root).unwrap_or(&p).to_string_lossy().replace('\\', "/"));
    }
    Ok(Json(json!({ "files": saved })))
}

fn sanitize(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let s: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || ".-_".contains(c) { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() || s.starts_with('.') { format!("{}{s}", pick("datei", "file")) } else { s }
}
