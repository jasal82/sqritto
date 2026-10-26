//! HTML-Vorschau eines Markdoc-Dokuments: liefert die zuletzt gebaute Site
//! unter `/preview/<id>/…` mit denselben relativen Pfaden wie der Export.

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header;
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;

use super::api::doc;
use super::{ApiResult, AppState, not_found};
use crate::i18n::pick;
use crate::project::{safe_join, site_css, site_css_with, site_js, site_js_with};
use crate::{assets, components};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{id}", get(root))
        .route("/{id}/", get(root))
        .route("/{id}/{*path}", get(file))
}

async fn root(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    let d = doc(&s, &id)?;
    let site = d.site().ok_or_else(|| not_found(pick("Die HTML-Vorschau", "HTML preview")))?;
    let first = if site.pages.contains_key("index") { "index".to_string() } else { site.order.first().cloned().unwrap_or_default() };
    Ok(Redirect::temporary(&format!("/preview/{id}/{first}.html")).into_response())
}

fn no_store(mime: &str, body: impl Into<Body>) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body.into())
        .unwrap()
}

async fn file(State(s): State<AppState>, Path((id, path)): Path<(String, String)>) -> ApiResult<Response> {
    let d = doc(&s, &id)?;
    let site = d.site();
    if let Some(slug) = path.strip_suffix(".html")
        && !slug.contains('/')
    {
        let site = site.ok_or_else(|| not_found(pick("Die HTML-Vorschau", "HTML preview")))?;
        if let Some(html) = site.pages.get(slug) {
            return Ok(no_store("text/html; charset=utf-8", html.clone()));
        }
        if slug == "index" && let Some(first) = site.order.first() {
            return Ok(Redirect::temporary(&format!("/preview/{id}/{first}.html")).into_response());
        }
        return Err(not_found(pick("Die Seite", "Page")));
    }
    match path.as_str() {
        "_static/site.css" => {
            let css = match &site {
                Some(s) => site_css_with(&s.components_css),
                None => site_css(&components::effective(&d.root).0),
            };
            return Ok(no_store("text/css; charset=utf-8", css));
        }
        "_static/site.js" => {
            let js = match &site {
                Some(s) => site_js_with(&s.components_js),
                None => site_js(&components::effective(&d.root).0),
            };
            return Ok(no_store("text/javascript; charset=utf-8", js));
        }
        // Ohne Elemente: für die Element-Vorschau, die diese selbst einbettet.
        "_static/site-base.css" => return Ok(no_store("text/css; charset=utf-8", site_css_with(""))),
        "_static/site-base.js" => return Ok(no_store("text/javascript; charset=utf-8", site_js_with(""))),
        "_static/search-index.js" => {
            let index = site.map(|s| s.search_index.clone()).unwrap_or_else(|| "{}".into());
            return Ok(no_store("text/javascript; charset=utf-8", format!("window.__TS_SEARCH__={index};")));
        }
        _ => {}
    }
    if let Some(rest) = path.strip_prefix("_static/") {
        let data = assets::site_file(rest).ok_or_else(|| not_found(pick("Die Datei", "File")))?;
        let mime = mime_guess::from_path(rest).first_or_octet_stream();
        return Ok(Response::builder()
            .header(header::CONTENT_TYPE, mime.as_ref())
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .body(Body::from(data.into_owned()))
            .unwrap());
    }
    // Dateien des Dokuments (Bilder, Anhänge)
    if path.split('/').any(|seg| seg.starts_with('.')) {
        return Err(not_found(pick("Die Datei", "File")));
    }
    let decoded = urlencoding::decode(&path).map(|c| c.into_owned()).unwrap_or(path.clone());
    let p = safe_join(&d.root, &decoded).ok_or_else(|| not_found(pick("Die Datei", "File")))?;
    let data = tokio::fs::read(&p).await.map_err(|_| not_found(pick("Die Datei", "File")))?;
    let mime = mime_guess::from_path(&p).first_or_octet_stream();
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from(data))
        .unwrap())
}
