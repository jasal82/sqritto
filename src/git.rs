//! Integrierter Git-Client. Lokale Operationen laufen über libgit2,
//! Netzwerk-Operationen (Push/Pull/Fetch) über die installierte `git`-CLI,
//! damit vorhandene Anmeldedaten (Credential Manager, SSH-Agent) greifen.

use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};
use git2::{BranchType, DiffOptions, IndexAddOption, ObjectType, Oid, Repository, Signature, Status, StatusOptions};
use serde::Serialize;

use crate::proc::NoWindow;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short: String,
    pub summary: String,
    pub body: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub status: &'static str,
    pub staged: bool,
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub initialized: bool,
    pub branch: Option<String>,
    pub head: Option<CommitInfo>,
    pub changes: Vec<FileChange>,
    pub remote: Option<String>,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub cli_available: bool,
    pub identity: Option<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub last_commit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub status: &'static str,
    pub additions: usize,
    pub deletions: usize,
}

pub fn cli_available() -> bool {
    static AVAIL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *AVAIL.get_or_init(|| Command::new("git").arg("--version").no_window().output().map(|o| o.status.success()).unwrap_or(false))
}

pub fn global_identity() -> Option<(String, String)> {
    let cfg = git2::Config::open_default().ok()?;
    let name = cfg.get_string("user.name").ok()?;
    let email = cfg.get_string("user.email").unwrap_or_default();
    Some((name, email))
}

fn identity_of(repo: &Repository) -> Option<(String, String)> {
    let cfg = repo.config().ok()?;
    let name = cfg.get_string("user.name").ok()?;
    let email = cfg.get_string("user.email").unwrap_or_default();
    Some((name, email))
}

fn signature(repo: &Repository, fallback: Option<&(String, String)>) -> Result<Signature<'static>> {
    if let Ok(sig) = repo.signature() {
        return Ok(sig.to_owned());
    }
    let (n, e) = fallback
        .cloned()
        .or_else(|| identity_of(repo))
        .ok_or_else(|| anyhow!(tr!(
            "Bitte in den Einstellungen Name und E-Mail für Versionen hinterlegen.",
            "Please enter a name and email for versions in the settings."
        )))?;
    Ok(Signature::now(&n, &e)?)
}

fn commit_info(c: &git2::Commit) -> CommitInfo {
    let id = c.id().to_string();
    CommitInfo {
        short: id[..8.min(id.len())].to_string(),
        id,
        summary: c.summary().ok().flatten().unwrap_or("").to_string(),
        body: c.body().ok().flatten().unwrap_or("").to_string(),
        author: c.author().name().unwrap_or("").to_string(),
        email: c.author().email().unwrap_or("").to_string(),
        time: c.time().seconds(),
        parents: c.parent_ids().map(|p| p.to_string()).collect(),
    }
}

fn open(root: &Path) -> Result<Repository> {
    let repo = Repository::open(root).map_err(|_| anyhow!(tr!(
        "Für dieses Dokument ist keine Versionsverwaltung eingerichtet.",
        "Version control is not set up for this document."
    )))?;
    // Interne Ordner (Vorschaubilder) nie versionieren – auch in älteren
    // Dokumenten, deren .gitignore nur den früheren Namen kennt.
    repo.add_ignore_rule(&format!("{}/\n{}/\n", crate::manifest::DATA_DIR, crate::manifest::LEGACY_DATA_DIR))?;
    Ok(repo)
}

pub fn is_repo(root: &Path) -> bool {
    root.join(".git").exists()
}

/// Legt ein Repository an und erstellt die erste Version.
pub fn init(root: &Path, identity: &(String, String)) -> Result<()> {
    let repo = Repository::init(root).with_context(|| tr!("Git-Repository konnte nicht angelegt werden", "Could not create the Git repository"))?;
    {
        let mut cfg = repo.config()?;
        if repo.signature().is_err() {
            cfg.set_str("user.name", &identity.0)?;
            cfg.set_str("user.email", &identity.1)?;
        }
    }
    let gi = root.join(".gitignore");
    let mut content = std::fs::read_to_string(&gi).unwrap_or_default();
    let dir = crate::manifest::DATA_DIR;
    if !content.lines().any(|l| l.trim().trim_end_matches('/') == dir) {
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&format!("{dir}/\n"));
        std::fs::write(&gi, content)?;
    }
    commit(root, &tr!("Dokument angelegt", "Document created"), None, Some(identity))?;
    // Standardzweig „main“
    if let Ok(head) = repo.head()
        && head.shorthand().ok() != Some("main")
        && let Ok(commit) = head.peel_to_commit()
    {
        repo.branch("main", &commit, true)?;
        repo.set_head("refs/heads/main")?;
        if let Ok(mut old) = repo.find_branch("master", BranchType::Local) {
            let _ = old.delete();
        }
    }
    Ok(())
}

fn status_label(s: Status) -> (&'static str, bool) {
    if s.is_conflicted() {
        return ("conflicted", false);
    }
    if s.is_index_new() {
        return ("added", true);
    }
    if s.is_index_deleted() {
        return ("deleted", true);
    }
    if s.is_index_renamed() {
        return ("renamed", true);
    }
    if s.is_index_modified() || s.is_index_typechange() {
        return ("modified", true);
    }
    if s.is_wt_new() {
        return ("added", false);
    }
    if s.is_wt_deleted() {
        return ("deleted", false);
    }
    if s.is_wt_renamed() {
        return ("renamed", false);
    }
    ("modified", false)
}

pub fn status(root: &Path) -> Result<RepoStatus> {
    if !is_repo(root) {
        return Ok(RepoStatus {
            initialized: false,
            branch: None,
            head: None,
            changes: vec![],
            remote: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            cli_available: cli_available(),
            identity: global_identity(),
        });
    }
    let repo = open(root)?;
    let head = repo.head().ok();
    let branch = head.as_ref().and_then(|h| h.shorthand().ok().map(str::to_string));
    let head_commit = head.as_ref().and_then(|h| h.peel_to_commit().ok()).map(|c| commit_info(&c));
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true).renames_head_to_index(true).include_ignored(false);
    let mut changes = Vec::new();
    for e in repo.statuses(Some(&mut opts))?.iter() {
        let s = e.status();
        if s.is_ignored() || s == Status::CURRENT {
            continue;
        }
        let (label, staged) = status_label(s);
        let old_path = e.head_to_index().and_then(|d| d.old_file().path().map(|p| p.to_string_lossy().replace('\\', "/")));
        changes.push(FileChange {
            path: e.path().unwrap_or("").to_string(),
            status: label,
            staged,
            old_path: if label == "renamed" { old_path } else { None },
        });
    }
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    let remote = repo.find_remote("origin").ok().and_then(|r| r.url().ok().map(str::to_string));
    let (mut ahead, mut behind, mut upstream) = (0, 0, None);
    if let Some(b) = &branch
        && let Ok(local) = repo.find_branch(b, BranchType::Local)
        && let Ok(up) = local.upstream()
    {
        upstream = up.name().ok().flatten().map(str::to_string);
        if let (Some(l), Some(u)) = (local.get().target(), up.get().target())
            && let Ok((a, bh)) = repo.graph_ahead_behind(l, u)
        {
            ahead = a;
            behind = bh;
        }
    }
    Ok(RepoStatus {
        initialized: true,
        branch,
        head: head_commit,
        changes,
        remote,
        upstream,
        ahead,
        behind,
        cli_available: cli_available(),
        identity: identity_of(&repo),
    })
}

/// Speichert eine Version (alle oder ausgewählte Dateien).
pub fn commit(root: &Path, message: &str, paths: Option<&[String]>, identity: Option<&(String, String)>) -> Result<CommitInfo> {
    let message = message.trim();
    if message.is_empty() {
        bail!("{}", tr!("Bitte eine kurze Beschreibung der Änderungen angeben.", "Please enter a short description of the changes."));
    }
    let repo = open(root)?;
    let mut index = repo.index()?;
    match paths {
        Some(list) if !list.is_empty() => {
            for p in list {
                let full = root.join(p);
                if full.exists() {
                    index.add_path(Path::new(p))?;
                } else {
                    let _ = index.remove_path(Path::new(p));
                }
            }
        }
        _ => {
            index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
            index.update_all(["*"].iter(), None)?;
        }
    }
    index.write()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = signature(&repo, identity)?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if let Some(p) = &parent
        && p.tree_id() == tree_id
    {
        bail!("{}", tr!("Es gibt keine Änderungen, die gespeichert werden könnten.", "There are no changes to save."));
    }
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
    Ok(commit_info(&repo.find_commit(oid)?))
}

pub fn log(root: &Path, limit: usize, path: Option<&str>) -> Result<Vec<CommitInfo>> {
    let repo = open(root)?;
    let mut walk = repo.revwalk()?;
    if walk.push_head().is_err() {
        return Ok(vec![]);
    }
    walk.set_sorting(git2::Sort::TIME)?;
    let mut out = Vec::new();
    for oid in walk.flatten() {
        let c = repo.find_commit(oid)?;
        if let Some(p) = path {
            if !touches(&repo, &c, p) {
                continue;
            }
        }
        out.push(commit_info(&c));
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

fn touches(repo: &Repository, c: &git2::Commit, path: &str) -> bool {
    let tree = c.tree().ok();
    let ptree = c.parent(0).ok().and_then(|p| p.tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(path);
    repo.diff_tree_to_tree(ptree.as_ref(), tree.as_ref(), Some(&mut opts))
        .map(|d| d.deltas().len() > 0)
        .unwrap_or(false)
}

pub fn commit_files(root: &Path, id: &str) -> Result<(CommitInfo, Vec<CommitFile>)> {
    let repo = open(root)?;
    let c = repo.find_commit(Oid::from_str(id)?)?;
    let tree = c.tree()?;
    let ptree = c.parent(0).ok().and_then(|p| p.tree().ok());
    let mut diff = repo.diff_tree_to_tree(ptree.as_ref(), Some(&tree), None)?;
    diff.find_similar(None)?;
    let mut files = Vec::new();
    let stats_per_file = per_file_stats(&diff);
    for (i, d) in diff.deltas().enumerate() {
        let path = d.new_file().path().or(d.old_file().path()).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let status = match d.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Renamed => "renamed",
            _ => "modified",
        };
        let (a, del) = stats_per_file.get(i).copied().unwrap_or((0, 0));
        files.push(CommitFile { path, status, additions: a, deletions: del });
    }
    Ok((commit_info(&c), files))
}

fn per_file_stats(diff: &git2::Diff) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for i in 0..diff.deltas().len() {
        if let Ok(Some(patch)) = git2::Patch::from_diff(diff, i) {
            let (_, a, d) = patch.line_stats().unwrap_or((0, 0, 0));
            out.push((a, d));
        } else {
            out.push((0, 0));
        }
    }
    out
}

fn blob_text(repo: &Repository, tree: &git2::Tree, path: &str) -> Option<String> {
    let entry = tree.get_path(Path::new(path)).ok()?;
    let obj = entry.to_object(repo).ok()?;
    let blob = obj.as_blob()?;
    if blob.is_binary() {
        return Some(tr!("(Binärdatei)", "(binary file)"));
    }
    Some(String::from_utf8_lossy(blob.content()).into_owned())
}

/// Inhalt vorher/nachher für die Vergleichsansicht.
/// Ohne `commit`: HEAD ↔ Arbeitskopie. Mit `commit`: Elternversion ↔ Commit.
pub fn diff_file(root: &Path, path: &str, commit: Option<&str>) -> Result<(String, String)> {
    let repo = open(root)?;
    match commit {
        None => {
            let old = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_tree().ok())
                .and_then(|t| blob_text(&repo, &t, path))
                .unwrap_or_default();
            let new = std::fs::read(root.join(path)).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
            Ok((old, new))
        }
        Some(id) => {
            let c = repo.find_commit(Oid::from_str(id)?)?;
            let new = blob_text(&repo, &c.tree()?, path).unwrap_or_default();
            let old = c.parent(0).ok().and_then(|p| p.tree().ok()).and_then(|t| blob_text(&repo, &t, path)).unwrap_or_default();
            Ok((old, new))
        }
    }
}

/// Verwirft Änderungen an einer Datei (Zustand der letzten Version).
pub fn discard(root: &Path, path: &str) -> Result<()> {
    let repo = open(root)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let in_head = head_tree.as_ref().and_then(|t| t.get_path(Path::new(path)).ok()).is_some();
    if in_head {
        let mut cb = git2::build::CheckoutBuilder::new();
        cb.force().path(path);
        repo.checkout_head(Some(&mut cb))?;
        let mut index = repo.index()?;
        index.add_path(Path::new(path)).ok();
        index.write()?;
    } else {
        let mut index = repo.index()?;
        let _ = index.remove_path(Path::new(path));
        index.write()?;
        let full = root.join(path);
        if full.is_file() {
            std::fs::remove_file(full)?;
        }
    }
    Ok(())
}

/// Stellt Dateien aus einer früheren Version wieder her (in die Arbeitskopie).
pub fn restore(root: &Path, commit: &str, path: Option<&str>) -> Result<()> {
    let repo = open(root)?;
    let c = repo.find_commit(Oid::from_str(commit)?)?;
    let tree = c.tree()?;
    let mut cb = git2::build::CheckoutBuilder::new();
    cb.force().update_index(false);
    if let Some(p) = path {
        cb.path(p);
    } else {
        // Dateien, die es in der alten Version nicht gab, entfernen.
        cb.remove_untracked(false);
    }
    repo.checkout_tree(tree.as_object(), Some(&mut cb))?;
    Ok(())
}

pub fn branches(root: &Path) -> Result<Vec<BranchInfo>> {
    let repo = open(root)?;
    let current = repo.head().ok().and_then(|h| h.shorthand().ok().map(str::to_string));
    let mut out = Vec::new();
    for b in repo.branches(Some(BranchType::Local))?.flatten() {
        let (branch, _) = b;
        let name = branch.name().ok().flatten().unwrap_or("").to_string();
        let upstream = branch.upstream().ok().and_then(|u| u.name().ok().flatten().map(str::to_string));
        let last = branch.get().peel_to_commit().ok().map(|c| c.time().seconds());
        out.push(BranchInfo { current: Some(&name) == current.as_ref(), name, upstream, last_commit: last });
    }
    out.sort_by(|a, b| b.current.cmp(&a.current).then(a.name.cmp(&b.name)));
    Ok(out)
}

fn ensure_clean(repo: &Repository) -> Result<()> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false);
    if !repo.statuses(Some(&mut opts))?.is_empty() {
        bail!(
            "{}",
            tr!(
                "Es gibt ungespeicherte Änderungen. Bitte zuerst eine Version speichern oder die Änderungen verwerfen.",
                "There are unsaved changes. Please save a version first or discard the changes."
            )
        );
    }
    Ok(())
}

pub fn create_branch(root: &Path, name: &str, checkout: bool) -> Result<()> {
    let repo = open(root)?;
    let name = name.trim();
    if name.is_empty() || name.contains(' ') || name.contains("..") {
        bail!("{}", tr!("Ungültiger Name für den Zweig.", "Invalid branch name."));
    }
    let head = repo.head()?.peel_to_commit()?;
    repo.branch(name, &head, false).map_err(|e| anyhow!(tr!("Zweig konnte nicht erstellt werden: {}", "Could not create the branch: {}", e.message())))?;
    if checkout {
        repo.set_head(&format!("refs/heads/{name}"))?;
    }
    Ok(())
}

pub fn checkout(root: &Path, name: &str) -> Result<()> {
    let repo = open(root)?;
    ensure_clean(&repo)?;
    let branch = repo.find_branch(name, BranchType::Local)?;
    let obj = branch.get().peel(ObjectType::Commit)?;
    let mut cb = git2::build::CheckoutBuilder::new();
    cb.safe();
    repo.checkout_tree(&obj, Some(&mut cb))?;
    repo.set_head(&format!("refs/heads/{name}"))?;
    Ok(())
}

pub fn set_remote(root: &Path, url: &str) -> Result<()> {
    let repo = open(root)?;
    let url = url.trim();
    if url.is_empty() {
        let _ = repo.remote_delete("origin");
        return Ok(());
    }
    if repo.find_remote("origin").is_ok() {
        repo.remote_set_url("origin", url)?;
    } else {
        repo.remote("origin", url)?;
    }
    Ok(())
}

fn run_git(root: &Path, args: &[&str]) -> Result<String> {
    if !cli_available() {
        bail!("{}", tr!("Für die Synchronisation wird Git benötigt (https://git-scm.com).", "Syncing requires Git (https://git-scm.com)."));
    }
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .no_window()
        .output()
        .with_context(|| tr!("git konnte nicht gestartet werden", "Could not start git"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if out.status.success() {
        Ok(text.trim().to_string())
    } else {
        bail!("{}", text.trim())
    }
}

pub fn push(root: &Path) -> Result<String> {
    let repo = open(root)?;
    let branch = repo.head()?.shorthand().unwrap_or("main").to_string();
    if repo.find_remote("origin").is_err() {
        bail!("{}", tr!("Es ist kein entferntes Repository (origin) eingerichtet.", "No remote repository (origin) is set up."));
    }
    run_git(root, &["push", "-u", "origin", &branch])
}

pub fn pull(root: &Path) -> Result<String> {
    let repo = open(root)?;
    ensure_clean(&repo)?;
    if repo.find_remote("origin").is_err() {
        bail!("{}", tr!("Es ist kein entferntes Repository (origin) eingerichtet.", "No remote repository (origin) is set up."));
    }
    run_git(root, &["pull", "--ff-only"])
}

pub fn fetch(root: &Path) -> Result<String> {
    run_git(root, &["fetch", "--prune"])
}
