use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemePref {
    Auto,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    Normal,
    Compact,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrayStyle {
    /// Large coloured number only; most legible at 16–24 px.
    Number,
    Ring,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: ThemePref,
    pub density: Density,
    pub tray_style: TrayStyle,
    /// "auto" (follow the OS) or one of `lang::LANGS`.
    pub language: String,
    pub interval_min: u64,
    pub notifications: bool,
    /// Mirrors the real autostart registration; refreshed from the OS at startup.
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { theme: ThemePref::Auto, density: Density::Normal, tray_style: TrayStyle::Number, language: "auto".into(), interval_min: 5, notifications: true, autostart: false }
    }
}

pub const INTERVALS: [u64; 5] = [1, 3, 5, 10, 15];

impl Settings {
    pub fn sanitize(mut self) -> Self {
        if !INTERVALS.contains(&self.interval_min) {
            self.interval_min = 5;
        }
        if self.language != "auto" && !crate::lang::LANGS.contains(&self.language.as_str()) {
            self.language = "auto".into();
        }
        self
    }
}

/// Thresholds already notified, keyed by limit kind + reset window.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct NotifyLog {
    pub fired: BTreeSet<String>,
}

fn dir(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&d).ok()?;
    Some(d)
}

fn load<T: for<'de> Deserialize<'de> + Default>(app: &AppHandle, name: &str) -> T {
    dir(app)
        .and_then(|d| std::fs::read(d.join(name)).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save<T: Serialize>(app: &AppHandle, name: &str, value: &T) {
    if let (Some(d), Ok(json)) = (dir(app), serde_json::to_vec_pretty(value)) {
        let _ = std::fs::write(d.join(name), json);
    }
}

pub fn load_settings(app: &AppHandle) -> Settings {
    load::<Settings>(app, "settings.json").sanitize()
}

pub fn save_settings(app: &AppHandle, s: &Settings) {
    save(app, "settings.json", s)
}

pub fn load_notify_log(app: &AppHandle) -> NotifyLog {
    load(app, "notified.json")
}

pub fn save_notify_log(app: &AppHandle, log: &NotifyLog) {
    save(app, "notified.json", log)
}
