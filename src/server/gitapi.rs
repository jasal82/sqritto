//! Git-Endpunkte für den integrierten Versionsverwaltungs-Client.

use axum::Json;
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::{Value as Json_, json};

use super::api::doc;
use super::{ApiError, ApiResult, AppState};
use crate::git;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/documents/{id}/git/status", get(status))
        .route("/documents/{id}/git/init", post(init))
        .route("/documents/{id}/git/commit", post(commit))
        .route("/documents/{id}/git/log", get(log))
        .route("/documents/{id}/git/commits/{sha}", get(commit_files))
        .route("/documents/{id}/git/diff", get(diff))
        .route("/documents/{id}/git/discard", post(discard))
        .route("/documents/{id}/git/restore", post(restore))
        .route("/documents/{id}/git/branches", get(branches).post(create_branch))
        .route("/documents/{id}/git/checkout", post(checkout))
        .route("/documents/{id}/git/remote", post(remote))
        .route("/documents/{id}/git/push", post(push))
        .route("/documents/{id}/git/pull", post(pull))
        .route("/documents/{id}/git/fetch", post(fetch))
        .route("/documents/{id}/git/identity", post(identity))
}

async fn run<T: Send + 'static>(f: impl FnOnce() -> anyhow::Result<T> + Send + 'static) -> ApiResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ApiError(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(ApiError::from)
}

async fn status(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let st = run(move || git::status(&d.root)).await?;
    Ok(Json(json!(st)))
}

#[derive(Deserialize, Default)]
struct InitReq {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    email: Option<String>,
}

async fn init(State(s): State<AppState>, Path(id): Path<String>, body: Option<Json<InitReq>>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let req = body.map(|b| b.0).unwrap_or_default();
    run(move || {
        let ident = match (req.name, req.email) {
            (Some(n), Some(e)) if !n.trim().is_empty() && !e.trim().is_empty() => (n, e),
            _ => crate::library::author_identity(&crate::library::default_author()),
        };
        git::init(&d.root, &ident)
    })
    .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct CommitReq {
    message: String,
    #[serde(default)]
    paths: Option<Vec<String>>,
}

async fn commit(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<CommitReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let info = run(move || git::commit(&d.root, &req.message, req.paths.as_deref(), None)).await?;
    Ok(Json(json!(info)))
}

#[derive(Deserialize)]
struct LogQuery {
    #[serde(default = "default_limit")]
    limit: usize,
    #[serde(default)]
    path: Option<String>,
}

fn default_limit() -> usize {
    100
}

async fn log(State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<LogQuery>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let list = run(move || git::log(&d.root, q.limit.min(1000), q.path.as_deref())).await?;
    Ok(Json(json!(list)))
}

async fn commit_files(State(s): State<AppState>, Path((id, sha)): Path<(String, String)>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let (info, files) = run(move || git::commit_files(&d.root, &sha)).await?;
    Ok(Json(json!({ "commit": info, "files": files })))
}

#[derive(Deserialize)]
struct DiffQuery {
    path: String,
    #[serde(default)]
    commit: Option<String>,
}

async fn diff(State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<DiffQuery>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let (old, new) = run(move || git::diff_file(&d.root, &q.path, q.commit.as_deref())).await?;
    Ok(Json(json!({ "old": old, "new": new })))
}

#[derive(Deserialize)]
struct PathReq {
    path: String,
}

async fn discard(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<PathReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    s.watcher.note_write(&d.root.join(&req.path));
    run(move || git::discard(&d.root, &req.path)).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct RestoreReq {
    commit: String,
    #[serde(default)]
    path: Option<String>,
}

async fn restore(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<RestoreReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let d2 = d.clone();
    run(move || git::restore(&d.root, &req.commit, req.path.as_deref())).await?;
    d2.invalidate();
    Ok(Json(json!({ "ok": true })))
}

async fn branches(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let list = run(move || git::branches(&d.root)).await?;
    Ok(Json(json!(list)))
}

#[derive(Deserialize)]
struct BranchReq {
    name: String,
    #[serde(default)]
    checkout: bool,
}

async fn create_branch(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<BranchReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    run(move || git::create_branch(&d.root, &req.name, req.checkout)).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct CheckoutReq {
    name: String,
}

async fn checkout(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<CheckoutReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let d2 = d.clone();
    run(move || git::checkout(&d.root, &req.name)).await?;
    d2.invalidate();
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct RemoteReq {
    url: String,
}

async fn remote(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<RemoteReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    run(move || git::set_remote(&d.root, &req.url)).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn push(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let out = run(move || git::push(&d.root)).await?;
    Ok(Json(json!({ "output": out })))
}

async fn pull(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let d2 = d.clone();
    let out = run(move || git::pull(&d.root)).await?;
    d2.invalidate();
    Ok(Json(json!({ "output": out })))
}

async fn fetch(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    let out = run(move || git::fetch(&d.root)).await?;
    Ok(Json(json!({ "output": out })))
}

#[derive(Deserialize)]
struct IdentityReq {
    name: String,
    email: String,
}

async fn identity(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<IdentityReq>) -> ApiResult<Json<Json_>> {
    let d = doc(&s, &id)?;
    run(move || {
        let repo = git2::Repository::open(&d.root)?;
        let mut cfg = repo.config()?;
        cfg.set_str("user.name", req.name.trim())?;
        cfg.set_str("user.email", req.email.trim())?;
        Ok(())
    })
    .await?;
    Ok(Json(json!({ "ok": true })))
}
