//! Beobachtet geöffnete Dokumente auf Änderungen von außen (z. B. durch
//! einen anderen Editor oder `git pull`) und meldet sie per Server-Sent Events.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use tokio::sync::broadcast;

use super::Event;

pub struct Watchers {
    events: broadcast::Sender<Event>,
    active: Mutex<HashMap<String, RecommendedWatcher>>,
    /// Zuletzt von uns selbst geschriebene Dateien (werden ignoriert).
    own_writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl Watchers {
    pub fn new(events: broadcast::Sender<Event>) -> Self {
        Self { events, active: Mutex::new(HashMap::new()), own_writes: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn note_write(&self, path: &Path) {
        let mut w = self.own_writes.lock();
        w.insert(path.to_path_buf(), Instant::now());
        w.retain(|_, t| t.elapsed() < Duration::from_secs(10));
    }

    pub fn watch(&self, id: &str, root: &Path) {
        let mut active = self.active.lock();
        if active.contains_key(id) {
            return;
        }
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let Ok(mut watcher) = notify::recommended_watcher(tx) else { return };
        if watcher.watch(root, RecursiveMode::Recursive).is_err() {
            return;
        }
        active.insert(id.to_string(), watcher);
        let events = self.events.clone();
        let own = self.own_writes.clone();
        let root = root.to_path_buf();
        let id = id.to_string();
        std::thread::spawn(move || {
            let mut pending: HashSet<String> = HashSet::new();
            loop {
                let timeout = if pending.is_empty() { Duration::from_secs(3600) } else { Duration::from_millis(250) };
                match rx.recv_timeout(timeout) {
                    Ok(Ok(ev)) => {
                        if matches!(ev.kind, notify::EventKind::Access(_)) {
                            continue;
                        }
                        for p in ev.paths {
                            let Ok(rel) = p.strip_prefix(&root) else { continue };
                            let rel = rel.to_string_lossy().replace('\\', "/");
                            if rel.is_empty() || rel.starts_with(".git") || crate::manifest::is_data_dir(rel.split('/').next().unwrap_or_default()) {
                                continue;
                            }
                            let recent = own.lock().get(&p).map(|t| t.elapsed() < Duration::from_millis(1500)).unwrap_or(false);
                            if !recent {
                                pending.insert(rel);
                            }
                        }
                    }
                    Ok(Err(_)) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if !pending.is_empty() {
                            let paths: Vec<String> = pending.drain().collect();
                            let _ = events.send(Event::FilesChanged { id: id.clone(), paths });
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
    }

    pub fn unwatch(&self, id: &str) {
        self.active.lock().remove(id);
    }
}
