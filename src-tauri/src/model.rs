//! Usage data model.
//!
//! Source (verified against claude.ai/settings/usage network traffic, 2026-09-23):
//!   GET https://claude.ai/api/organizations/{org_uuid}/usage?cedar_ember=1&skip_spend=1
//!
//! Relevant parts of the response:
//!   "five_hour":  { "utilization": 10.0, "resets_at": "2026-09-23T15:49:59.53+00:00", ... }
//!   "seven_day":  { "utilization": 19.0, "resets_at": "...", ... }
//!   "seven_day_opus" / "seven_day_sonnet" / ...: same shape or null
//!   "extra_usage": null (shape unknown for this account, handled defensively)
//!   "limits": [
//!     { "kind": "session",    "group": "session", "percent": 10, "severity": "normal",
//!       "resets_at": "...", "scope": null, "is_active": false },
//!     { "kind": "weekly_all", "group": "weekly",  "percent": 19, ... }
//!   ]
//!
//! `limits` is the list the official page renders, so it is the primary source;
//! the per-window objects are only a fallback if `limits` ever disappears.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
pub struct Limit {
    pub kind: String,
    pub group: String,
    pub label: String,
    pub percent: f64,
    pub resets_at: Option<String>,
    pub severity: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Extra {
    pub label: String,
    pub percent: Option<f64>,
    pub used: Option<f64>,
    pub limit: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub limits: Vec<Limit>,
    pub extras: Vec<Extra>,
}

impl Snapshot {
    pub fn session(&self) -> Option<&Limit> {
        self.limits.iter().find(|l| l.group == "session")
    }

    pub fn weekly(&self) -> Option<&Limit> {
        self.limits
            .iter()
            .find(|l| l.kind == "weekly_all")
            .or_else(|| self.limits.iter().find(|l| l.group == "weekly"))
    }
}

pub fn parse(v: &Value) -> Option<Snapshot> {
    let mut limits: Vec<Limit> = v
        .get("limits")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(parse_limit).collect())
        .unwrap_or_default();

    if limits.is_empty() {
        for (key, kind, group) in [
            ("five_hour", "session", "session"),
            ("seven_day", "weekly_all", "weekly"),
            ("seven_day_opus", "weekly_opus", "weekly"),
            ("seven_day_sonnet", "weekly_sonnet", "weekly"),
        ] {
            if let Some(w) = v.get(key).filter(|w| w.is_object()) {
                if let Some(p) = w.get("utilization").and_then(Value::as_f64) {
                    limits.push(Limit {
                        kind: kind.into(),
                        group: group.into(),
                        label: label_for(kind, None),
                        percent: p,
                        resets_at: w.get("resets_at").and_then(Value::as_str).map(Into::into),
                        severity: None,
                    });
                }
            }
        }
    }

    if limits.is_empty() {
        return None;
    }

    let mut extras = Vec::new();
    if let Some(e) = v.get("extra_usage").filter(|e| e.is_object()) {
        let enabled = e.get("is_enabled").and_then(Value::as_bool).unwrap_or(true);
        let percent = e.get("utilization").and_then(Value::as_f64);
        let used = e.get("used_dollars").and_then(Value::as_f64);
        let limit = e.get("limit_dollars").and_then(Value::as_f64);
        if enabled && (percent.is_some() || (used.is_some() && limit.is_some())) {
            extras.push(Extra { label: "Usage credits".into(), percent, used, limit });
        }
    }

    Some(Snapshot { limits, extras })
}

fn parse_limit(l: &Value) -> Option<Limit> {
    let kind = l.get("kind")?.as_str()?.to_string();
    let percent = l.get("percent")?.as_f64()?;
    let group = l.get("group").and_then(Value::as_str).unwrap_or("").to_string();
    let scope = match l.get("scope") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Object(o)) => o
            .get("display_name")
            .or_else(|| o.get("name"))
            .and_then(Value::as_str)
            .map(Into::into),
        _ => None,
    };
    Some(Limit {
        label: label_for(&kind, scope.as_deref()),
        kind,
        group,
        percent,
        resets_at: l.get("resets_at").and_then(Value::as_str).map(Into::into),
        severity: l.get("severity").and_then(Value::as_str).map(Into::into),
    })
}

fn label_for(kind: &str, scope: Option<&str>) -> String {
    match kind {
        "session" => "Aktuální session".into(),
        "weekly_all" => "Týdenní limit".into(),
        _ => {
            let name = scope.map(str::to_string).unwrap_or_else(|| {
                let rest = kind.strip_prefix("weekly_").unwrap_or(kind);
                rest.split('_').map(capitalize).collect::<Vec<_>>().join(" ")
            });
            if kind.starts_with("weekly") {
                format!("Týdenní · {name}")
            } else {
                name
            }
        }
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed copy of the real response captured during development.
    const SAMPLE: &str = r#"{"five_hour":{"utilization":10.0,"resets_at":"2026-09-23T15:49:59.533999+00:00"},
      "seven_day":{"utilization":19.0,"resets_at":"2026-09-26T04:59:59.534019+00:00"},
      "seven_day_opus":null,"extra_usage":null,
      "limits":[{"kind":"session","group":"session","percent":10,"severity":"normal","resets_at":"2026-09-23T15:49:59.533999+00:00","scope":null,"is_active":false},
                {"kind":"weekly_all","group":"weekly","percent":19,"severity":"normal","resets_at":"2026-09-26T04:59:59.534019+00:00","scope":null,"is_active":true}]}"#;

    #[test]
    fn parses_real_sample() {
        let s = parse(&serde_json::from_str(SAMPLE).unwrap()).unwrap();
        assert_eq!(s.limits.len(), 2);
        assert_eq!(s.session().unwrap().percent, 10.0);
        assert_eq!(s.weekly().unwrap().percent, 19.0);
        assert!(s.extras.is_empty());
    }

    #[test]
    fn falls_back_to_windows() {
        let mut v: Value = serde_json::from_str(SAMPLE).unwrap();
        v.as_object_mut().unwrap().remove("limits");
        let s = parse(&v).unwrap();
        assert_eq!(s.session().unwrap().percent, 10.0);
        assert_eq!(s.weekly().unwrap().label, "Týdenní limit");
    }

    #[test]
    fn labels_model_limits() {
        assert_eq!(label_for("weekly_opus", None), "Týdenní · Opus");
        assert_eq!(label_for("weekly_x", Some("Sonnet 5")), "Týdenní · Sonnet 5");
    }
}
