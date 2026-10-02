//! Local usage history for the chart.
//!
//! claude.ai only reports the current utilisation, so the app records its own
//! samples (one per successful fetch, deduplicated) in an append-only JSON-lines
//! file and keeps the last 35 days. The chart derives consumption from the
//! differences between consecutive samples.

use crate::model::Snapshot;
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const KEEP_MS: i64 = 35 * 24 * 3_600_000;
/// Unchanged values are still re-sampled this often, so gaps (app closed,
/// offline) are distinguishable from quiet periods.
const HEARTBEAT_MS: i64 = 15 * 60_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Sample {
    /// Unix time, ms.
    pub t: i64,
    /// Session utilisation in % and its reset time (unix s, rounded to 10 min).
    pub s: Option<f64>,
    pub sr: Option<i64>,
    /// Weekly (all models) utilisation in % and its reset time.
    pub w: Option<f64>,
    pub wr: Option<i64>,
}

fn reset_key(iso: Option<&str>) -> Option<i64> {
    let t = DateTime::parse_from_rfc3339(iso?).ok()?.timestamp();
    Some((t + 300) / 600 * 600)
}

impl Sample {
    pub fn from_snapshot(snap: &Snapshot) -> Self {
        let s = snap.session();
        let w = snap.weekly();
        Sample {
            t: chrono::Utc::now().timestamp_millis(),
            s: s.map(|l| l.percent),
            sr: s.and_then(|l| reset_key(l.resets_at.as_deref())),
            w: w.map(|l| l.percent),
            wr: w.and_then(|l| reset_key(l.resets_at.as_deref())),
        }
    }

    fn same_values(&self, o: &Sample) -> bool {
        self.s == o.s && self.sr == o.sr && self.w == o.w && self.wr == o.wr
    }
}

#[derive(Default)]
pub struct Store(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    samples: Vec<Sample>,
    path: Option<PathBuf>,
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&d).ok()?;
    Some(d.join("history.jsonl"))
}

fn rewrite(path: &PathBuf, samples: &[Sample]) {
    let mut out = String::new();
    for s in samples {
        if let Ok(line) = serde_json::to_string(s) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    let _ = std::fs::write(path, out);
}

pub fn load(app: &AppHandle) {
    let Some(p) = path(app) else { return };
    let cutoff = chrono::Utc::now().timestamp_millis() - KEEP_MS;
    let text = std::fs::read_to_string(&p).unwrap_or_default();
    let total = text.lines().count();
    let mut samples: Vec<Sample> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).filter(|s: &Sample| s.t >= cutoff).collect();
    samples.sort_by_key(|s| s.t);
    if samples.len() != total {
        rewrite(&p, &samples);
    }
    let store = app.state::<Store>();
    let mut inner = store.0.lock().unwrap();
    inner.samples = samples;
    inner.path = Some(p);
}

pub fn record(app: &AppHandle, sample: Sample) {
    let store = app.state::<Store>();
    let mut inner = store.0.lock().unwrap();
    if let Some(last) = inner.samples.last() {
        if last.same_values(&sample) && sample.t - last.t < HEARTBEAT_MS {
            return;
        }
    }
    if let Some(p) = &inner.path {
        if let (Ok(mut f), Ok(line)) = (std::fs::OpenOptions::new().create(true).append(true).open(p), serde_json::to_string(&sample)) {
            let _ = writeln!(f, "{line}");
        }
    }
    inner.samples.push(sample);

    // Trim once the oldest sample is a day past retention, so rewrites stay rare.
    let cutoff = chrono::Utc::now().timestamp_millis() - KEEP_MS;
    if inner.samples.first().is_some_and(|s| s.t < cutoff - 24 * 3_600_000) {
        inner.samples.retain(|s| s.t >= cutoff);
        if let Some(p) = inner.path.clone() {
            rewrite(&p, &inner.samples);
        }
    }
}

/// Samples from `from_ms` on, plus the one just before it so the first
/// interval in range has a starting point.
pub fn since(app: &AppHandle, from_ms: i64) -> Vec<Sample> {
    let store = app.state::<Store>();
    let inner = store.0.lock().unwrap();
    let start = inner.samples.partition_point(|s| s.t < from_ms);
    inner.samples[start.saturating_sub(1)..].to_vec()
}
