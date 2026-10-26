//! Einzelinstanz für die lokale App: Läuft Sqritto bereits, holt ein erneuter
//! Start das vorhandene Fenster nach vorne, statt einen zweiten Server zu öffnen.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Instance {
    port: u16,
    token: String,
    pid: u32,
}

fn file(config: &Path) -> PathBuf {
    config.join("instance.json")
}

pub fn register(config: &Path, port: u16, token: &str) {
    let data = Instance { port, token: token.to_string(), pid: std::process::id() };
    if let Ok(json) = serde_json::to_string(&data) {
        let _ = std::fs::write(file(config), json);
    }
}

pub fn unregister(config: &Path) {
    let path = file(config);
    // Nur die eigene Instanzdatei entfernen.
    if let Ok(text) = std::fs::read_to_string(&path)
        && let Ok(i) = serde_json::from_str::<Instance>(&text)
        && i.pid == std::process::id()
    {
        let _ = std::fs::remove_file(path);
    }
}

/// Bittet eine laufende Instanz, ihr Fenster zu zeigen. `true`, wenn das klappte.
pub fn activate_existing(config: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(file(config)) else { return false };
    let Ok(i) = serde_json::from_str::<Instance>(&text) else { return false };
    let addr = SocketAddr::from(([127, 0, 0, 1], i.port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "POST /api/system/focus HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        i.port, i.token
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    let n = stream.read(&mut buf).unwrap_or(0);
    String::from_utf8_lossy(&buf[..n]).starts_with("HTTP/1.1 200")
}
