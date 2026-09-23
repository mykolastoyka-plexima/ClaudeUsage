mod fetcher;
mod model;
mod notify;
mod popover;
mod settings;
mod tray_icon;

use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Theme, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tokio::sync::Notify;

use model::Snapshot;
use settings::{NotifyLog, Settings, ThemePref, TrayStyle};
use tray_icon::Tone;

const TRAY_ID: &str = "main";
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
/// Menu bar icon bitmap size (18 pt @2x).
#[cfg(target_os = "macos")]
const MAC_ICON: u32 = 36;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Status {
    Loading,
    Online,
    Offline,
    LoggedOut,
}

struct Core {
    status: Status,
    snapshot: Option<Snapshot>,
    updated_at: Option<i64>,
    error: Option<String>,
    settings: Settings,
    vibrancy: bool,
    next_id: u64,
    pending: Option<u64>,
    notify_log: NotifyLog,
    /// The first result after launch decides whether to open the sign-in window.
    first_result: bool,
}

struct Scheduler(Arc<Notify>);

#[derive(Serialize, Clone)]
struct StateDto {
    status: Status,
    snapshot: Option<Snapshot>,
    updated_at: Option<i64>,
    error: Option<String>,
    settings: Settings,
    vibrancy: bool,
    refreshing: bool,
}

fn core(app: &AppHandle) -> std::sync::MutexGuard<'_, Core> {
    app.state::<Mutex<Core>>().inner().lock().unwrap()
}

fn dto(c: &Core) -> StateDto {
    StateDto {
        status: c.status,
        snapshot: c.snapshot.clone(),
        updated_at: c.updated_at,
        error: c.error.clone(),
        settings: c.settings.clone(),
        vibrancy: c.vibrancy,
        refreshing: c.pending.is_some(),
    }
}

fn publish(app: &AppHandle) {
    let state = dto(&core(app));
    let _ = app.emit_to(popover::LABEL, "state", state);
    update_tray(app);
}

pub(crate) fn pending_request(app: &AppHandle) -> Option<u64> {
    core(app).pending
}

/// Starts a fetch unless one is already in flight.
pub(crate) fn refresh(app: &AppHandle) {
    let id = {
        let mut c = core(app);
        if c.pending.is_some() {
            return;
        }
        c.next_id += 1;
        c.pending = Some(c.next_id);
        c.next_id
    };
    publish(app);

    // Webviews must not be created from inside a WebView2 callback (sync IPC
    // commands, page-load handlers) or creation stalls, so hop to a worker thread.
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = fetcher::start(&h) {
            finish(&h, fetcher::Report::Network { id, error: e.to_string() });
        }
    });

    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FETCH_TIMEOUT).await;
        finish(&h, fetcher::Report::Network { id, error: "timeout".into() });
    });
}

fn finish(app: &AppHandle, report: fetcher::Report) {
    let mut open_login = false;
    let mut signed_in = false;
    {
        let mut guard = core(app);
        let c = &mut *guard;
        if c.pending != Some(report.id()) {
            return;
        }
        c.pending = None;
        let first = std::mem::replace(&mut c.first_result, false);
        match report {
            fetcher::Report::Ok { body, .. } => {
                match serde_json::from_str(&body).ok().and_then(|v| model::parse(&v)) {
                    Some(snap) => {
                        if notify::check(app, &snap, &mut c.notify_log, c.settings.notifications) {
                            settings::save_notify_log(app, &c.notify_log);
                        }
                        c.snapshot = Some(snap);
                        c.status = Status::Online;
                        c.updated_at = Some(chrono::Utc::now().timestamp_millis());
                        c.error = None;
                        signed_in = true;
                    }
                    None => {
                        c.status = Status::Offline;
                        c.error = Some("Neočekávaný formát dat".into());
                    }
                }
            }
            fetcher::Report::Unauthorized { .. } => {
                c.status = Status::LoggedOut;
                c.snapshot = None;
                c.error = None;
                open_login = first;
            }
            fetcher::Report::Http { status, .. } => {
                c.status = Status::Offline;
                c.error = Some(format!("Server vrátil {status}"));
            }
            fetcher::Report::Network { error, .. } => {
                c.status = Status::Offline;
                c.error = Some(if error == "timeout" { "Vypršel časový limit".into() } else { "Bez připojení".into() });
            }
        }
    }
    publish(app);
    if signed_in {
        if let Some(w) = app.get_webview_window(fetcher::LOGIN) {
            let _ = w.close();
        }
    }
    if open_login {
        spawn_login(app);
    }
}

fn update_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let c = core(app);
    let session = c.snapshot.as_ref().and_then(|s| s.session().cloned());
    let weekly = c.snapshot.as_ref().and_then(|s| s.weekly().cloned());
    let (percent, tone) = match (&c.status, &session) {
        (Status::LoggedOut, _) | (_, None) => (None, Tone::Muted),
        (Status::Offline, Some(s)) => (Some(s.percent), Tone::Muted),
        (_, Some(s)) => (Some(s.percent), tray_icon::tone_for(s.percent)),
    };
    #[cfg(target_os = "macos")]
    {
        let (rgba, template) = tray_icon::render_macos(MAC_ICON, percent, tone);
        let _ = tray.set_icon(Some(Image::new_owned(rgba, MAC_ICON, MAC_ICON)));
        let _ = tray.set_icon_as_template(template);
        let _ = tray.set_title(Some(match percent {
            Some(p) => format!("{p:.0} %"),
            None => "–".to_string(),
        }));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let size = tray_icon::system_icon_size();
        let light = tray_icon::taskbar_is_light();
        let rgba = match c.settings.tray_style {
            TrayStyle::Number => tray_icon::render_number(size, percent, tone, light),
            TrayStyle::Ring => tray_icon::render(size, percent, tone, light),
        };
        let _ = tray.set_icon(Some(Image::new_owned(rgba, size, size)));
    }

    let mut tip = String::from("ClaudeUsage");
    match c.status {
        Status::LoggedOut => tip.push_str("\nOdhlášeno"),
        Status::Loading if session.is_none() => tip.push_str("\nNačítám…"),
        _ => {
            if let Some(s) = &session {
                tip.push_str(&format!("\nSession {:.0} %", s.percent));
                if let Some(cd) = notify::countdown(s.resets_at.as_deref()) {
                    tip.push_str(&format!(" · reset za {cd}"));
                }
            }
            if let Some(w) = &weekly {
                tip.push_str(&format!("\nTýden {:.0} %", w.percent));
                if let Some(when) = notify::weekday_time(w.resets_at.as_deref()) {
                    tip.push_str(&format!(" · reset {when}"));
                }
            }
            if c.status == Status::Offline {
                tip.push_str("\nOffline");
            }
        }
    }
    let _ = tray.set_tooltip(Some(tip));
}

fn apply_theme(app: &AppHandle, pref: ThemePref) {
    if let Some(w) = popover::window(app) {
        let _ = w.set_theme(match pref {
            ThemePref::Auto => None,
            ThemePref::Light => Some(Theme::Light),
            ThemePref::Dark => Some(Theme::Dark),
        });
    }
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn usage_report(webview: tauri::Webview, app: AppHandle, report: fetcher::Report) -> Result<(), String> {
    if webview.label() != fetcher::FETCHER {
        return Err("not allowed".into());
    }
    finish(&app, report);
    Ok(())
}

#[tauri::command]
fn get_state(app: AppHandle) -> StateDto {
    dto(&core(&app))
}

#[tauri::command]
fn refresh_now(app: AppHandle) {
    refresh(&app);
}

#[tauri::command]
fn set_settings(app: AppHandle, settings: Settings) -> StateDto {
    let settings = settings.sanitize();
    let old = core(&app).settings.clone();

    if settings.autostart != old.autostart {
        let al = app.autolaunch();
        let _ = if settings.autostart { al.enable() } else { al.disable() };
    }
    let autostart = app.autolaunch().is_enabled().unwrap_or(settings.autostart);
    let settings = Settings { autostart, ..settings };

    if settings.theme != old.theme {
        apply_theme(&app, settings.theme);
    }
    settings::save_settings(&app, &settings);
    core(&app).settings = settings.clone();
    if settings.interval_min != old.interval_min {
        app.state::<Scheduler>().0.notify_one();
    }
    publish(&app);
    dto(&core(&app))
}

fn spawn_login(app: &AppHandle) {
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = fetcher::open_login(&h);
    });
}

#[tauri::command]
fn open_login(app: AppHandle) {
    popover::hide(&app);
    spawn_login(&app);
}

#[tauri::command]
fn logout(app: AppHandle) {
    fetcher::clear_profile(&app);
    {
        let mut c = core(&app);
        c.status = Status::LoggedOut;
        c.snapshot = None;
        c.updated_at = None;
        c.error = None;
    }
    publish(&app);
}

#[tauri::command]
fn resize_popover(app: AppHandle, height: f64) {
    popover::resize(&app, height);
}

#[tauri::command]
fn hide_popover(app: AppHandle) {
    popover::hide(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------- setup

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "Otevřít ClaudeUsage").build(app)?;
    let refresh_item = MenuItemBuilder::with_id("refresh", "Obnovit").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Ukončit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&open)
        .item(&refresh_item)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit)
        .build()?;

    #[cfg(target_os = "macos")]
    let (rgba, size) = (tray_icon::render_macos(MAC_ICON, None, Tone::Muted).0, MAC_ICON);
    #[cfg(not(target_os = "macos"))]
    let (rgba, size) = {
        let size = tray_icon::system_icon_size();
        (tray_icon::render(size, None, Tone::Muted, tray_icon::taskbar_is_light()), size)
    };
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::new_owned(rgba, size, size))
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("ClaudeUsage")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => popover::show(app),
            "refresh" => refresh(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = e {
                let app = tray.app_handle();
                popover::set_anchor(app, &rect);
                popover::toggle(app);
            }
        })
        .build(app)?;
    Ok(())
}

fn spawn_scheduler(app: &AppHandle) {
    let notify = app.state::<Scheduler>().0.clone();
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let mins = core(&h).settings.interval_min;
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(mins * 60)) => refresh(&h),
                _ = notify.notified() => {}
            }
        }
    });
    // Keeps the tray tooltip countdown and the taskbar-theme colours current.
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            update_tray(&h);
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| popover::show(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .manage(Mutex::new(popover::PopoverState::default()))
        .manage(Scheduler(Arc::new(Notify::new())))
        .setup(|app| {
            // Menu bar app: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let mut settings = settings::load_settings(&handle);
            settings.autostart = handle.autolaunch().is_enabled().unwrap_or(false);

            let vibrancy = match popover::window(&handle) {
                Some(w) => popover::apply_backdrop(&w),
                None => false,
            };

            app.manage(Mutex::new(Core {
                status: Status::Loading,
                snapshot: None,
                updated_at: None,
                error: None,
                settings: settings.clone(),
                vibrancy,
                next_id: 0,
                pending: None,
                notify_log: settings::load_notify_log(&handle),
                first_result: true,
            }));
            apply_theme(&handle, settings.theme);

            if let Some(w) = popover::window(&handle) {
                let h = handle.clone();
                w.on_window_event(move |e| match e {
                    WindowEvent::Focused(false) => popover::hide(&h),
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        popover::hide(&h);
                    }
                    WindowEvent::ThemeChanged(_) => update_tray(&h),
                    _ => {}
                });
            }

            build_tray(&handle)?;
            spawn_scheduler(&handle);
            refresh(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            usage_report,
            get_state,
            refresh_now,
            set_settings,
            open_login,
            logout,
            resize_popover,
            hide_popover,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building ClaudeUsage")
        .run(|_, e| {
            // Tray app: closing the sign-in window must not quit.
            if let RunEvent::ExitRequested { code: None, api, .. } = e {
                api.prevent_exit();
            }
        });
}
