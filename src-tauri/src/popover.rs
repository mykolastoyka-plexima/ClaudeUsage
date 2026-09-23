//! The popover window: positioning next to the tray icon, show/hide, backdrop.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewWindow};

pub const LABEL: &str = "popover";
pub const WIDTH: f64 = 340.0;
const GAP: f64 = 10.0;

#[derive(Default)]
pub struct PopoverState {
    /// Tray icon rectangle in physical pixels (x, y, w, h).
    anchor: Option<(f64, f64, f64, f64)>,
    hidden_at: Option<Instant>,
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

pub fn set_anchor(app: &AppHandle, rect: &Rect) {
    let scale = window(app).and_then(|w| w.scale_factor().ok()).unwrap_or(1.0);
    let p = rect.position.to_physical::<f64>(scale);
    let s = rect.size.to_physical::<f64>(scale);
    app.state::<Mutex<PopoverState>>().lock().unwrap().anchor = Some((p.x, p.y, s.width, s.height));
}

pub fn toggle(app: &AppHandle) {
    let Some(w) = window(app) else { return };
    if w.is_visible().unwrap_or(false) {
        hide(app);
        return;
    }
    // A tray click first blurs (and hides) an open popover; don't reopen it on the same click.
    let recently_hidden = app
        .state::<Mutex<PopoverState>>()
        .lock()
        .unwrap()
        .hidden_at
        .is_some_and(|t| t.elapsed() < Duration::from_millis(300));
    if !recently_hidden {
        show(app);
    }
}

pub fn show(app: &AppHandle) {
    let Some(w) = window(app) else { return };
    position(app, &w);
    let _ = w.show();
    let _ = w.set_focus();
    let _ = tauri::Emitter::emit_to(&w, LABEL, "popover-shown", ());
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = window(app) {
        let _ = w.hide();
    }
    app.state::<Mutex<PopoverState>>().lock().unwrap().hidden_at = Some(Instant::now());
}

pub fn resize(app: &AppHandle, height: f64) {
    let Some(w) = window(app) else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let size = PhysicalSize::new((WIDTH * scale).round() as u32, (height.clamp(120.0, 720.0) * scale).round() as u32);
    if w.inner_size().ok() != Some(size) {
        let _ = w.set_size(size);
        if w.is_visible().unwrap_or(false) {
            position(app, &w);
        }
    }
}

/// Centres the popover on the tray icon and places it on the taskbar's side,
/// clamped to the monitor work area. Falls back to bottom-right.
fn position(app: &AppHandle, w: &WebviewWindow) {
    let Ok(size) = w.outer_size() else { return };
    let (ww, wh) = (size.width as f64, size.height as f64);
    let scale = w.scale_factor().unwrap_or(1.0);
    let gap = GAP * scale;
    let anchor = app.state::<Mutex<PopoverState>>().lock().unwrap().anchor;

    let monitor = match anchor {
        Some((x, y, _, _)) => app.monitor_from_point(x, y).ok().flatten(),
        None => None,
    }
    .or_else(|| w.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let work = monitor.work_area();
    let (left, top) = (work.position.x as f64, work.position.y as f64);
    let (right, bottom) = (left + work.size.width as f64, top + work.size.height as f64);

    let (x, y) = match anchor {
        Some((ax, ay, aw, ah)) => {
            let cx = ax + aw / 2.0;
            let mon = monitor.position();
            let mon_h = monitor.size().height as f64;
            let x = cx - ww / 2.0;
            let y = if ay > mon.y as f64 + mon_h / 2.0 { ay.min(bottom) - wh - gap } else { (ay + ah).max(top) + gap };
            (x, y)
        }
        None => (right - ww - gap, bottom - wh - gap),
    };
    let x = x.clamp(left + gap, right - ww - gap);
    let y = y.clamp(top + gap, bottom - wh - gap);
    let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

/// Acrylic backdrop plus Windows 11 rounded corners. Returns whether the
/// translucent backdrop is active (the UI falls back to an opaque surface).
pub fn apply_backdrop(w: &WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        let ok = window_vibrancy::apply_acrylic(w, Some((0, 0, 0, 0))).is_ok();
        if let Ok(hwnd) = w.hwnd() {
            use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND};
            let pref = DWMWCP_ROUND;
            unsafe {
                DwmSetWindowAttribute(hwnd.0 as _, DWMWA_WINDOW_CORNER_PREFERENCE as u32, &pref as *const _ as *const _, std::mem::size_of_val(&pref) as u32);
            }
        }
        ok
    }
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        apply_vibrancy(w, NSVisualEffectMaterial::Popover, Some(NSVisualEffectState::Active), Some(14.0)).is_ok()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = w;
        false
    }
}
