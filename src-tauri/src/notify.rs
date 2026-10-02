use crate::model::{Limit, Snapshot};
use crate::settings::NotifyLog;
use chrono::{DateTime, Utc};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// A notification decided under the state lock but shown after it is released.
pub struct Pending {
    title: &'static str,
    body: String,
}

pub fn show(app: &AppHandle, pending: Vec<Pending>) {
    for p in pending {
        let _ = app.notification().builder().title(p.title).body(p.body).show();
    }
}

const THRESHOLDS: [u32; 2] = [80, 95];

/// Stable id of a limit's current window. `resets_at` carries sub-second noise,
/// so it is rounded to 10 minutes before being used as a key.
fn window_key(l: &Limit) -> Option<(String, i64)> {
    let t = DateTime::parse_from_rfc3339(l.resets_at.as_deref()?).ok()?.timestamp();
    let rounded = (t + 300) / 600 * 600;
    Some((format!("{}@{}", l.kind, rounded), rounded))
}

/// Decides at most one notification per limit window and threshold. Returns
/// whether the log changed (and should be persisted) plus what to show.
pub fn check(snap: &Snapshot, log: &mut NotifyLog, enabled: bool) -> (bool, Vec<Pending>) {
    let mut out = Vec::new();
    let now = Utc::now().timestamp();
    let before = log.fired.len();
    // Forget windows that have already reset.
    log.fired.retain(|k| {
        k.rsplit('#').nth(1).and_then(|w| w.rsplit('@').next()).and_then(|t| t.parse::<i64>().ok()).map_or(false, |t| t > now)
    });
    let mut changed = log.fired.len() != before;

    for l in [snap.session(), snap.weekly()].into_iter().flatten() {
        let Some((key, _)) = window_key(l) else { continue };
        let crossed: Vec<u32> = THRESHOLDS.iter().copied().filter(|t| l.percent >= *t as f64).collect();
        let Some(&top) = crossed.last() else { continue };
        let fresh = crossed.iter().any(|t| !log.fired.contains(&format!("{key}#{t}")));
        if !fresh {
            continue;
        }
        let top_new = !log.fired.contains(&format!("{key}#{top}"));
        for t in &crossed {
            log.fired.insert(format!("{key}#{t}"));
        }
        changed = true;
        if enabled && top_new {
            let body = match countdown(l.resets_at.as_deref()) {
                Some(c) => format!("{}: {:.0} % · reset za {c}", l.label, l.percent),
                None => format!("{}: {:.0} %", l.label, l.percent),
            };
            let title = if top >= 95 { "Limit je téměř vyčerpán" } else { "Blížíš se limitu" };
            out.push(Pending { title, body });
        }
    }
    (changed, out)
}

/// "so 7:00 (za 2 d 14 h)" in local time, rounded to the nearest minute.
pub fn weekday_time(resets_at: Option<&str>) -> Option<String> {
    use chrono::{Datelike, Local, TimeZone, Timelike};
    const DAYS: [&str; 7] = ["po", "út", "st", "čt", "pá", "so", "ne"];
    let t = DateTime::parse_from_rfc3339(resets_at?).ok()?;
    let secs = (t.timestamp_millis() + 30_000).div_euclid(60_000) * 60;
    let local = Local.timestamp_opt(secs, 0).single()?;
    let day = DAYS[local.weekday().num_days_from_monday() as usize];
    let when = format!("{day} {}:{:02}", local.hour(), local.minute());
    Some(match countdown(resets_at) {
        Some(cd) => format!("{when} (za {cd})"),
        None => when,
    })
}

pub fn countdown(resets_at: Option<&str>) -> Option<String> {
    let t = DateTime::parse_from_rfc3339(resets_at?).ok()?;
    let mins = ((t.timestamp() - Utc::now().timestamp()).max(0) + 59) / 60;
    let (d, h, m) = (mins / 1440, (mins % 1440) / 60, mins % 60);
    Some(if d > 0 {
        format!("{d} d {h} h")
    } else if h > 0 {
        format!("{h} h {m} min")
    } else {
        format!("{m} min")
    })
}
