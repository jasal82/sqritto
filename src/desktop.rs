//! Natives App-Fenster: WebView2 (Windows) bzw. WKWebView (macOS) in einem
//! rahmenlosen Fenster. Die Titelleiste zeichnet die Oberfläche selbst; über
//! `window.ipc.postMessage` steuert sie Verschieben, Minimieren, Maximieren
//! und Schließen.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Result, anyhow};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopBuilder};
use tao::window::{Icon, Window, WindowBuilder};
use wry::{NewWindowResponse, WebContext, WebView, WebViewBuilder};

pub enum UserEvent {
    Ipc(String),
    Focus,
    Title(String),
}

pub struct Desktop {
    event_loop: EventLoop<UserEvent>,
}

pub struct RunOptions {
    pub base_url: String,
    pub token: String,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub dark: bool,
    /// Wird beim Schließen aufgerufen (z. B. Instanzdatei entfernen).
    pub on_exit: Box<dyn Fn()>,
}

#[derive(Serialize, Deserialize, Default)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

const ICON_RGBA: &[u8] = include_bytes!("../assets/icon/icon-128.rgba");

fn icon() -> Option<Icon> {
    Icon::from_rgba(ICON_RGBA.to_vec(), 128, 128).ok()
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") { "macos" } else { "windows" }
}

impl Desktop {
    pub fn new() -> Self {
        Self { event_loop: EventLoopBuilder::<UserEvent>::with_user_event().build() }
    }

    /// Rückruf, mit dem andere Threads das Fenster nach vorne holen können.
    pub fn focus_handle(&self) -> Arc<dyn Fn() + Send + Sync> {
        let proxy = Mutex::new(self.event_loop.create_proxy());
        Arc::new(move || {
            let _ = proxy.lock().send_event(UserEvent::Focus);
        })
    }

    /// Öffnet das Fenster. Kehrt nur bei einem Fehler zurück (dann kann auf
    /// den Browser ausgewichen werden); sonst endet der Prozess mit dem Fenster.
    pub fn run(self, opts: RunOptions) -> Result<()> {
        let event_loop = self.event_loop;
        let state_file = opts.config_dir.join("window.json");
        let saved: Option<WindowState> =
            std::fs::read_to_string(&state_file).ok().and_then(|t| serde_json::from_str(&t).ok());

        let mut builder = WindowBuilder::new()
            .with_title("Sqritto")
            .with_inner_size(LogicalSize::new(1440.0, 920.0))
            .with_min_inner_size(LogicalSize::new(940.0, 600.0))
            .with_window_icon(icon())
            .with_visible(false);
        #[cfg(windows)]
        {
            use tao::platform::windows::WindowBuilderExtWindows;
            builder = builder.with_decorations(false).with_undecorated_shadow(true).with_taskbar_icon(icon());
        }
        #[cfg(target_os = "macos")]
        {
            use tao::platform::macos::WindowBuilderExtMacOS;
            builder = builder
                .with_titlebar_transparent(true)
                .with_title_hidden(true)
                .with_fullsize_content_view(true)
                .with_traffic_light_inset(tao::dpi::LogicalPosition::new(18.0, 22.0));
        }
        if let Some(s) = &saved
            && s.width >= 600
            && s.height >= 400
            && position_visible(&event_loop, s)
        {
            builder = builder
                .with_inner_size(PhysicalSize::new(s.width, s.height))
                .with_position(PhysicalPosition::new(s.x, s.y));
        }
        let window = builder.build(&event_loop).map_err(|e| anyhow!(tr!("Fenster: {e}", "Window: {e}")))?;
        if saved.as_ref().is_some_and(|s| s.maximized) {
            window.set_maximized(true);
        }

        let mut context = WebContext::new(Some(opts.data_dir.clone()));
        let webview = build_webview(&window, &mut context, &event_loop, &opts)?;
        window.set_visible(true);
        window.set_focus();

        let on_exit = opts.on_exit;
        // Letzte Position/Größe im normalen (nicht maximierten) Zustand.
        let mut normal: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> = if window.is_maximized() {
            saved.as_ref().map(|s| (PhysicalPosition::new(s.x, s.y), PhysicalSize::new(s.width, s.height)))
        } else {
            window.outer_position().ok().map(|p| (p, window.inner_size()))
        };
        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;
            // WebContext muss so lange leben wie die WebView.
            let _ = &context;
            match event {
                Event::WindowEvent { event: WindowEvent::Moved(_) | WindowEvent::Resized(_), .. }
                    if !window.is_maximized() && !window.is_minimized() =>
                {
                    if let Ok(p) = window.outer_position() {
                        normal = Some((p, window.inner_size()));
                    }
                    notify_state(&window, &webview);
                }
                Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                    save_state(&window, normal, &state_file);
                    on_exit();
                    *control_flow = ControlFlow::Exit;
                }
                Event::WindowEvent { event: WindowEvent::Resized(_), .. } => notify_state(&window, &webview),
                Event::UserEvent(UserEvent::Ipc(msg)) => match msg.as_str() {
                    "drag" => {
                        let _ = window.drag_window();
                    }
                    "minimize" => window.set_minimized(true),
                    "maximize" => {
                        window.set_maximized(!window.is_maximized());
                        notify_state(&window, &webview);
                    }
                    "close" => {
                        save_state(&window, normal, &state_file);
                        on_exit();
                        *control_flow = ControlFlow::Exit;
                    }
                    "ready" => notify_state(&window, &webview),
                    _ => {}
                },
                Event::UserEvent(UserEvent::Focus) => {
                    window.set_minimized(false);
                    window.set_visible(true);
                    window.set_focus();
                }
                Event::UserEvent(UserEvent::Title(t)) => window.set_title(&t),
                _ => {}
            }
        })
    }
}

fn build_webview(window: &Window, context: &mut WebContext, event_loop: &EventLoop<UserEvent>, opts: &RunOptions) -> Result<WebView> {
    let ipc_proxy = event_loop.create_proxy();
    let title_proxy = event_loop.create_proxy();
    let base = opts.base_url.clone();
    let token = opts.token.clone();
    let init = format!(
        "window.__SQRITTO_DESKTOP__ = {{ platform: '{}' }}; document.documentElement.classList.add('is-desktop', 'is-desktop-{}');",
        platform(),
        platform()
    );
    let background = if opts.dark { (17, 17, 17, 255) } else { (244, 244, 242, 255) };
    let builder = WebViewBuilder::new_with_web_context(context)
        .with_url(format!("{}/?token={}", opts.base_url, opts.token))
        .with_initialization_script(init)
        .with_background_color(background)
        .with_devtools(cfg!(debug_assertions))
        .with_clipboard(true)
        .with_ipc_handler(move |req| {
            let _ = ipc_proxy.send_event(UserEvent::Ipc(req.body().clone()));
        })
        .with_document_title_changed_handler(move |title| {
            let _ = title_proxy.send_event(UserEvent::Title(title));
        })
        .with_new_window_req_handler(move |url, _features| {
            open_external(&url, &base, &token);
            NewWindowResponse::Deny
        });
    #[cfg(windows)]
    let builder = {
        use wry::WebViewBuilderExtWindows;
        builder.with_browser_accelerator_keys(false)
    };
    builder.build(window).map_err(|e| anyhow!("WebView: {e}"))
}

/// Links aus der Oberfläche im Standardbrowser bzw. -programm öffnen. Für
/// Adressen dieses Servers wird das Zugangstoken mitgegeben.
fn open_external(url: &str, base: &str, token: &str) {
    let target = if url.starts_with(base) {
        let sep = if url.contains('?') { '&' } else { '?' };
        format!("{url}{sep}token={token}")
    } else {
        url.to_string()
    };
    if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("mailto:") {
        let _ = open::that_detached(target);
    }
}

fn notify_state(window: &Window, webview: &WebView) {
    let js = format!(
        "window.__sqrittoWindow && window.__sqrittoWindow({{ maximized: {} }})",
        window.is_maximized()
    );
    let _ = webview.evaluate_script(&js);
}

fn save_state(window: &Window, normal: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>, file: &Path) {
    let maximized = window.is_maximized();
    let (pos, size) = normal.unwrap_or_else(|| (window.outer_position().unwrap_or(PhysicalPosition::new(0, 0)), window.inner_size()));
    let state = WindowState { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized };
    if let Ok(json) = serde_json::to_string(&state) {
        let _ = std::fs::write(file, json);
    }
}

fn position_visible(event_loop: &EventLoop<UserEvent>, s: &WindowState) -> bool {
    event_loop.available_monitors().any(|m| {
        let p = m.position();
        let sz = m.size();
        s.x + 80 >= p.x && s.y >= p.y - 10 && s.x + 80 < p.x + sz.width as i32 && s.y + 40 < p.y + sz.height as i32
    })
}
