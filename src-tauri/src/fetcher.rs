//! Loads usage data through a hidden webview that lives on the claude.ai origin.
//!
//! Running `fetch` inside the webview means requests carry the session cookies of
//! the persistent webview profile (including HttpOnly ones) and look exactly like
//! the official page's own requests. Nothing is copied out of the profile.

use serde::Deserialize;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const FETCHER: &str = "fetcher";
pub const LOGIN: &str = "login";

/// A tiny same-origin document, so the full claude.ai app never has to boot in
/// the background just to issue one request.
const HOST_URL: &str = "https://claude.ai/robots.txt";

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Report {
    Ok { id: u64, body: String },
    Unauthorized { id: u64 },
    Http { id: u64, status: u16 },
    Network { id: u64, error: String },
}

impl Report {
    pub fn id(&self) -> u64 {
        match self {
            Report::Ok { id, .. } | Report::Unauthorized { id, .. } | Report::Http { id, .. } | Report::Network { id, .. } => *id,
        }
    }
}

fn script(id: u64) -> String {
    format!(
        r#"(async () => {{
  const id = {id};
  const send = (r) => window.__TAURI_INTERNALS__.invoke('usage_report', {{ report: Object.assign({{ id }}, r) }});
  // A 401, or a JSON 403, means the session is gone. An HTML 403 is a bot
  // challenge or similar and is treated as a transient error instead.
  const denied = (r) => r.status === 401 || (r.status === 403 && (r.headers.get('content-type') || '').includes('json'));
  const get = (path) => fetch(path, {{ credentials: 'include', headers: {{ accept: 'application/json' }}, cache: 'no-store' }});
  try {{
    let org = (document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/) || [])[1];
    if (!org) {{
      const r = await get('/api/organizations');
      if (denied(r)) return send({{ kind: 'unauthorized', status: r.status }});
      if (!r.ok) return send({{ kind: 'http', status: r.status }});
      const orgs = await r.json();
      const o = (orgs || []).find((o) => (o.capabilities || []).includes('chat')) || (orgs || [])[0];
      if (!o) return send({{ kind: 'unauthorized', status: 0 }});
      org = o.uuid;
    }}
    const r = await get('/api/organizations/' + encodeURIComponent(org) + '/usage?cedar_ember=1&skip_spend=1');
    if (denied(r)) return send({{ kind: 'unauthorized', status: r.status }});
    if (!r.ok) return send({{ kind: 'http', status: r.status }});
    send({{ kind: 'ok', body: await r.text() }});
  }} catch (e) {{
    send({{ kind: 'network', error: String(e) }});
  }}
}})();"#
    )
}

fn is_claude(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("claude.ai")
}

/// Navigates (or creates) the hidden fetcher; the request runs once the page has loaded.
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let url: Url = HOST_URL.parse().expect("static url");
    if let Some(w) = app.get_webview_window(FETCHER) {
        return w.navigate(url);
    }
    WebviewWindowBuilder::new(app, FETCHER, WebviewUrl::External(url))
        .title("ClaudeUsage fetcher")
        .visible(false)
        .skip_taskbar(true)
        .focused(false)
        .inner_size(400.0, 300.0)
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished || !is_claude(payload.url()) {
                return;
            }
            let app = webview.app_handle();
            if let Some(id) = crate::pending_request(app) {
                let _ = webview.eval(script(id));
            }
        })
        .build()?;
    Ok(())
}

/// Opens the visible sign-in window. It closes itself once claude.ai lands
/// anywhere outside the login flow.
pub fn open_login(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(LOGIN) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(w);
    }
    let url: Url = "https://claude.ai/login".parse().expect("static url");
    let w = WebviewWindowBuilder::new(app, LOGIN, WebviewUrl::External(url))
        .title("ClaudeUsage – přihlášení")
        .inner_size(480.0, 760.0)
        .min_inner_size(400.0, 560.0)
        .center()
        .focused(true)
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let url = payload.url();
            let in_login_flow = ["/login", "/magic-link", "/oauth", "/sso", "/verify", "/auth"]
                .iter()
                .any(|p| url.path().starts_with(p));
            if is_claude(url) && !in_login_flow {
                let app = webview.app_handle().clone();
                let _ = webview.close();
                crate::refresh(&app);
            }
        })
        .build()?;
    // claude.ai may finish signing in with client-side routing only, so also
    // poll the API while the window is open; a successful fetch closes it.
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(4)).await;
            if h.get_webview_window(LOGIN).is_none() {
                break;
            }
            crate::refresh(&h);
        }
    });
    Ok(w)
}

/// Wipes the shared webview profile (cookies, storage, cache).
pub fn clear_profile(app: &AppHandle) {
    let target = app
        .get_webview_window(FETCHER)
        .or_else(|| app.get_webview_window(crate::popover::LABEL));
    if let Some(w) = target {
        let _ = w.clear_all_browsing_data();
    }
    if let Some(w) = app.get_webview_window(LOGIN) {
        let _ = w.close();
    }
}
