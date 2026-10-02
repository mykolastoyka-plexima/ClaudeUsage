import { ChartColumn, ChevronLeft, Circle, Clock, Hash, LogIn, LogOut, Monitor, Moon, PanelTop, Power, RefreshCw, Rows2, Settings as SettingsIcon, Sun, WifiOff } from "lucide";
import logoUrl from "./logo.png";
import { backend, isTauri, type Backend } from "./lib/ipc";
import { h, icon, tweenNumber } from "./lib/dom";
import { segmented } from "./lib/segmented";
import { buildHistoryPanel, type HistoryPanel } from "./history-panel";
import { countdown, money, resetDate, toneFor, updatedAgo, type Tone } from "./lib/format";
import type { AppState, Density, Limit, Settings, ThemePref, TrayStyle } from "./lib/types";


const root = document.documentElement;
const appEl = document.getElementById("app") as HTMLElement;
const mainEl = document.getElementById("panel-main") as HTMLElement;
const settingsEl = document.getElementById("panel-settings") as HTMLElement;
const historyEl = document.getElementById("panel-history") as HTMLElement;
const panels = { main: mainEl, settings: settingsEl, history: historyEl };
type PanelId = keyof typeof panels;

let be: Backend;
let state: AppState;
let mode = "";
let current: PanelId = "main";
let historyPanel: HistoryPanel;
let switching = false;
const shown = { session: 0, weekly: 0 };

// ------------------------------------------------------------------ theme

const sysDark = matchMedia("(prefers-color-scheme: dark)");
let themeTimer = 0;

function crossfade(): void {
  root.classList.add("theme-anim");
  clearTimeout(themeTimer);
  themeTimer = window.setTimeout(() => root.classList.remove("theme-anim"), 260);
}

function applyTheme(pref: ThemePref, animate: boolean): void {
  const current = root.dataset.theme ?? "auto";
  if (current === pref) return;
  if (animate) crossfade();
  if (pref === "auto") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

sysDark.addEventListener("change", () => {
  if (!root.dataset.theme) crossfade();
  root.classList.toggle("sys-dark", sysDark.matches);
});
root.classList.toggle("sys-dark", sysDark.matches);
root.classList.toggle("preview", !isTauri);
const isMac = navigator.userAgent.includes("Mac");
root.classList.toggle("win", isTauri && navigator.userAgent.includes("Windows"));
root.classList.toggle("mac", isMac);

// ------------------------------------------------------------------ pieces

const brandMark = () => h("img", { class: "brand-mark", src: logoUrl, alt: "", draggable: "false" });

const STATUS_LABEL: Record<AppState["status"], string> = {
  online: "Online",
  offline: "Offline",
  logged_out: "Odhlášeno",
  loading: "Načítám",
};

function header(): HTMLElement {
  return h(
    "div",
    { class: "header" },
    h("div", { class: "brand" }, brandMark(), "ClaudeUsage"),
    h("div", { class: "status", id: "status", role: "status" }, h("span", { class: "dot" }), h("span", { id: "status-label" })),
  );
}

function footer(): HTMLElement {
  return h(
    "div",
    { class: "footer" },
    h("span", { class: "updated", id: "updated" }),
    h(
      "div",
      { class: "tools" },
      h("button", { class: "icon-btn", id: "btn-refresh", title: "Obnovit", "aria-label": "Obnovit", onclick: () => void be.refresh() }, icon(RefreshCw)),
      h("button", { class: "icon-btn", title: "Historie", "aria-label": "Historie spotřeby", onclick: () => setPanel("history") }, icon(ChartColumn)),
      h("button", { class: "icon-btn", title: "Nastavení", "aria-label": "Nastavení", onclick: () => setPanel("settings") }, icon(SettingsIcon)),
    ),
  );
}

/** Progress ring; `size` is the viewBox, `r` the radius. Dash lengths are set from `r` at render time. */
function ringSvg(size: number, r: number, glow: boolean): SVGSVGElement {
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", `0 0 ${size} ${size}`);
  s.setAttribute("class", "ring");
  s.setAttribute("aria-hidden", "true");
  const arc = (cls: string) => `<circle class="${cls}" cx="${c}" cy="${c}" r="${r}" stroke="url(#ring-grad)" stroke-dasharray="${C} ${C}" stroke-dashoffset="${C}"/>`;
  s.innerHTML = `
    <defs>
      <linearGradient id="ring-grad" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" style="stop-color: var(--tone-2)"/>
        <stop offset="1" style="stop-color: var(--tone)"/>
      </linearGradient>
    </defs>
    <circle class="track" cx="${c}" cy="${c}" r="${r}"/>
    ${glow ? arc("arc-glow") : ""}
    ${arc("arc")}`;
  return s;
}

function setTone(el: Element, tone: Tone): void {
  el.classList.remove("tone-ok", "tone-warn", "tone-danger", "tone-muted");
  el.classList.add(`tone-${tone}`);
}

// ------------------------------------------------------------------ main panel

function buildSkeleton(): Node[] {
  return [
    h(
      "div",
      { class: "card session" },
      h("div", { class: "eyebrow" }, "Aktuální session"),
      h("div", { class: "sk sk-ring" }),
      h("div", { class: "sk sk-line", style: "width: 120px; margin: 14px auto 0" }),
    ),
    h(
      "div",
      { class: "card weekly" },
      h("div", { class: "row" }, h("span", { class: "eyebrow" }, "Týdenní limit"), h("div", { class: "sk sk-line", style: "width: 34px" })),
      h("div", { class: "sk", style: "height: 8px; margin-top: 11px; border-radius: 999px" }),
      h("div", { class: "sk sk-line", style: "width: 110px; margin-top: 10px" }),
    ),
  ];
}

function buildData(): Node[] {
  return [
    h(
      "div",
      { class: "card session rise", id: "session" },
      h("div", { class: "eyebrow" }, h("span", {}, "Aktuální session")),
      h(
        "div",
        { class: "ring-wrap" },
        ringSvg(152, 64, true),
        h(
          "div",
          { class: "ring-center" },
          h("div", { class: "big" }, h("span", { id: "session-num" }, "0"), h("span", { class: "unit" }, "%")),
          h("div", { class: "ring-caption" }, "využito"),
        ),
      ),
      h("div", { class: "reset" }, icon(Clock, 13), h("span", { id: "session-reset" })),
    ),
    h(
      "div",
      { class: "card weekly rise rise-2", id: "weekly" },
      h(
        "div",
        { class: "row" },
        h("span", { class: "eyebrow", id: "weekly-label" }, "Týdenní limit"),
        h("span", { class: "pct" }, h("span", { id: "weekly-num" }, "0"), h("span", { class: "unit" }, "%")),
      ),
      h("div", { class: "bar" }, h("div", { class: "fill", id: "weekly-fill" })),
      h("div", { class: "meta", id: "weekly-reset" }),
      h("div", { class: "extras", id: "extras", hidden: true }),
    ),
  ];
}

function buildCompact(): Node[] {
  return [
    h(
      "div",
      { class: "card compact rise" },
      h(
        "div",
        { class: "c-row c-session", id: "session" },
        h("div", { class: "ring-sm" }, ringSvg(44, 18, false)),
        h("div", { class: "c-txt" }, h("div", { class: "c-title" }, "Aktuální session"), h("div", { class: "c-sub", id: "session-reset" })),
        h("div", { class: "c-pct" }, h("span", { id: "session-num" }, "0"), h("span", { class: "unit" }, "%")),
      ),
      h(
        "div",
        { class: "c-row c-weekly", id: "weekly" },
        h(
          "div",
          { class: "row" },
          h("span", { class: "c-title", id: "weekly-label" }, "Týdenní limit"),
          h("span", { class: "pct" }, h("span", { id: "weekly-num" }, "0"), h("span", { class: "unit" }, "%")),
        ),
        h("div", { class: "bar" }, h("div", { class: "fill", id: "weekly-fill" })),
        h("div", { class: "c-sub", id: "weekly-reset" }),
        h("div", { class: "extras", id: "extras", hidden: true }),
      ),
    ),
  ];
}

function buildLoggedOut(): Node[] {
  return [
    h(
      "div",
      { class: "card empty rise" },
      h("div", { class: "empty-icon" }, icon(LogIn, 20)),
      h("h2", {}, "Odhlášeno"),
      h("p", {}, "Přihlas se ke svému účtu Claude a ClaudeUsage začne zobrazovat spotřebu."),
      h("button", { class: "btn btn-primary", onclick: () => void be.openLogin() }, icon(LogIn, 14), "Přihlásit znovu"),
    ),
  ];
}

function buildNoData(): Node[] {
  return [
    h(
      "div",
      { class: "card empty rise" },
      h("div", { class: "empty-icon warn" }, icon(WifiOff, 20)),
      h("h2", {}, "Nelze načíst data"),
      h("p", { id: "nodata-msg" }),
      h("button", { class: "btn btn-secondary", onclick: () => void be.refresh() }, icon(RefreshCw, 14), "Zkusit znovu"),
    ),
  ];
}

function modeFor(s: AppState): string {
  if (s.status === "logged_out") return "logged_out";
  if (s.snapshot) return s.settings.density === "compact" ? "data-compact" : "data";
  if (s.status === "loading" || s.refreshing) return mode === "nodata" ? "nodata" : "skeleton";
  return "nodata";
}

function renderMain(): void {
  const m = modeFor(state);
  root.dataset.density = state.settings.density;
  if (m !== mode) {
    mode = m;
    const body = m === "data" ? buildData() : m === "data-compact" ? buildCompact() : m === "logged_out" ? buildLoggedOut() : m === "nodata" ? buildNoData() : buildSkeleton();
    mainEl.replaceChildren(header(), ...body, footer());
    shown.session = 0;
    shown.weekly = 0;
  }

  const status = mainEl.querySelector("#status") as HTMLElement;
  status.dataset.s = state.status === "loading" && state.snapshot ? "online" : state.status;
  (mainEl.querySelector("#status-label") as HTMLElement).textContent = STATUS_LABEL[state.status];

  const refreshBtn = mainEl.querySelector("#btn-refresh") as HTMLElement;
  if (state.refreshing) refreshBtn.classList.add("spinning");
  else if (refreshBtn.classList.contains("spinning")) {
    // Let the current turn finish instead of snapping back.
    refreshBtn.addEventListener("animationiteration", () => refreshBtn.classList.remove("spinning"), { once: true });
  }

  if (m.startsWith("data")) renderData();
  if (m === "nodata") (mainEl.querySelector("#nodata-msg") as HTMLElement).textContent = `${state.error ?? "Bez připojení"}. Zkusím to znovu při další obnově.`;
  renderTimes();
}

function renderData(): void {
  const snap = state.snapshot!;
  const session = snap.limits.find((l) => l.group === "session");
  const weekly = snap.limits.find((l) => l.kind === "weekly_all") ?? snap.limits.find((l) => l.group === "weekly");
  const others = snap.limits.filter((l) => l !== session && l !== weekly);

  // Session ring
  const sessionCard = mainEl.querySelector("#session") as HTMLElement;
  const sp = session?.percent ?? 0;
  setTone(sessionCard, session ? toneFor(sp) : "muted");
  sessionCard.querySelectorAll<SVGCircleElement>(".arc, .arc-glow").forEach((c) => {
    const C = 2 * Math.PI * c.r.baseVal.value;
    const offset = C * (1 - Math.min(100, Math.max(0, sp)) / 100);
    // Next frame so a freshly built ring animates from empty.
    requestAnimationFrame(() => {
      c.style.strokeDashoffset = String(offset);
      c.style.opacity = sp > 0 ? "" : "0";
    });
  });
  const sNum = mainEl.querySelector("#session-num") as HTMLElement;
  if (session) {
    tweenNumber(sNum, shown.session, Math.round(sp));
    shown.session = Math.round(sp);
  } else sNum.textContent = "–";

  // Weekly bar
  const weeklyCard = mainEl.querySelector("#weekly") as HTMLElement;
  weeklyCard.hidden = !weekly;
  if (weekly) {
    setTone(weeklyCard, toneFor(weekly.percent));
    (mainEl.querySelector("#weekly-label") as HTMLElement).textContent = weekly.label;
    const fill = mainEl.querySelector("#weekly-fill") as HTMLElement;
    requestAnimationFrame(() => (fill.style.width = `${Math.min(100, Math.max(0, weekly.percent))}%`));
    tweenNumber(mainEl.querySelector("#weekly-num") as HTMLElement, shown.weekly, Math.round(weekly.percent));
    shown.weekly = Math.round(weekly.percent);
  }

  // Extra limits and credits — only what the response actually contains.
  const extras = mainEl.querySelector("#extras") as HTMLElement;
  const rows: HTMLElement[] = others.map((l) => extraRow(l.label, l.percent, `${Math.round(l.percent)} %`, toneFor(l.percent)));
  for (const e of snap.extras) {
    if (e.used != null && e.limit != null && e.limit > 0) {
      const p = (e.used / e.limit) * 100;
      rows.push(extraRow(e.label, p, `${money(e.used)} / ${money(e.limit)}`, toneFor(p)));
    } else if (e.percent != null) {
      rows.push(extraRow(e.label, e.percent, `${Math.round(e.percent)} %`, toneFor(e.percent)));
    }
  }
  extras.hidden = rows.length === 0;
  extras.replaceChildren(...rows);
}

function extraRow(label: string, percent: number, value: string, tone: Tone): HTMLElement {
  const fill = h("div", { class: "fill" });
  requestAnimationFrame(() => (fill.style.width = `${Math.min(100, Math.max(0, percent))}%`));
  return h(
    "div",
    { class: `extra tone-${tone}` },
    h("div", { class: "row" }, h("span", { class: "name", title: label }, label), h("span", { class: "v" }, value)),
    h("div", { class: "bar slim" }, fill),
  );
}

function sessionLimit(): Limit | undefined {
  return state.snapshot?.limits.find((l) => l.group === "session");
}

/** Time-dependent strings; re-run every tick so countdowns stay current. */
function renderTimes(): void {
  const updated = mainEl.querySelector("#updated") as HTMLElement | null;
  if (updated) updated.textContent = mode === "logged_out" ? "" : updatedAgo(state.updated_at);

  if (!mode.startsWith("data")) return;
  const s = sessionLimit();
  const cd = countdown(s?.resets_at ?? null);
  (mainEl.querySelector("#session-reset") as HTMLElement).textContent = cd ? `Reset za ${cd}` : "Session zatím nezačala";

  const snap = state.snapshot!;
  const weekly = snap.limits.find((l) => l.kind === "weekly_all") ?? snap.limits.find((l) => l.group === "weekly");
  const wr = resetDate(weekly?.resets_at ?? null);
  const wc = countdown(weekly?.resets_at ?? null);
  (mainEl.querySelector("#weekly-reset") as HTMLElement).textContent = wr ? `Reset ${wr}${wc ? ` · za ${wc}` : ""}` : "";
}

// ------------------------------------------------------------------ settings panel

function toggleRow(title: string, sub: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const sw = h("button", { class: "switch", role: "switch", "aria-label": title, onclick: () => set(!get()) });
  const row = h("div", { class: "list-row" }, h("div", { class: "txt" }, h("div", { class: "t" }, title), h("div", { class: "s" }, sub)), sw);
  (row as HTMLElement & { sync?: () => void }).sync = () => sw.setAttribute("aria-checked", String(get()));
  return row;
}

const syncers: (() => void)[] = [];

function updateSettings(patch: Partial<Settings>): void {
  const next = { ...state.settings, ...patch };
  if (patch.theme) applyTheme(patch.theme, true);
  state = { ...state, settings: next };
  syncers.forEach((s) => s());
  if (patch.density) {
    renderMain();
    syncHeight();
  }
  void be.setSettings(next).then((s) => {
    state = s;
    syncers.forEach((f) => f());
  });
}

function buildSettings(): void {
  const theme = segmented<ThemePref>(
    [
      { value: "auto", label: "Auto", icon: Monitor },
      { value: "light", label: "Světlý", icon: Sun },
      { value: "dark", label: "Tmavý", icon: Moon },
    ],
    () => state.settings.theme,
    (v) => updateSettings({ theme: v }),
  );
  const density = segmented<Density>(
    [
      { value: "normal", label: "Normální", icon: PanelTop },
      { value: "compact", label: "Kompaktní", icon: Rows2 },
    ],
    () => state.settings.density,
    (v) => updateSettings({ density: v }),
  );
  const trayStyle = segmented<TrayStyle>(
    [
      { value: "number", label: "Číslo", icon: Hash },
      { value: "ring", label: "Kroužek", icon: Circle },
    ],
    () => state.settings.tray_style,
    (v) => updateSettings({ tray_style: v }),
  );
  const interval = segmented<number>(
    [1, 3, 5, 10, 15].map((v) => ({ value: v, label: `${v} min` })),
    () => state.settings.interval_min,
    (v) => updateSettings({ interval_min: v }),
  );
  const notif = toggleRow("Upozornění při 80 % a 95 %", "Jednou za každé resetovací okno", () => state.settings.notifications, (v) => updateSettings({ notifications: v }));
  const auto = toggleRow("Spouštět po přihlášení", "Po přihlášení do systému", () => state.settings.autostart, (v) => updateSettings({ autostart: v }));

  for (const el of [theme, density, trayStyle, interval, notif, auto]) syncers.push((el as HTMLElement & { sync: () => void }).sync);

  settingsEl.replaceChildren(
    h(
      "div",
      { class: "settings-head" },
      h("button", { class: "icon-btn", "aria-label": "Zpět", title: "Zpět", onclick: () => setPanel("main") }, icon(ChevronLeft)),
      h("h1", {}, "Nastavení"),
    ),
    h("div", { class: "group-label" }, "Vzhled"),
    theme,
    h("div", { class: "group-label" }, "Rozložení"),
    density,
    // macOS draws the menu bar icon as a ring plus title text; no style choice there.
    ...(isMac ? [] : [h("div", { class: "group-label" }, "Ikona v liště"), trayStyle]),
    h("div", { class: "group-label" }, "Obnova dat"),
    interval,
    h("div", { class: "group-label" }, "Chování"),
    h("div", { class: "card list" }, notif, auto),
    h("div", { class: "group-label" }, "Účet"),
    h(
      "div",
      { class: "card list" },
      h(
        "button",
        { class: "list-row danger", id: "btn-logout", onclick: () => void be.logout().then(() => setPanel("main")) },
        icon(LogOut, 15),
        h("div", { class: "txt" }, h("div", { class: "t" }, "Odhlásit se")),
      ),
      h("button", { class: "list-row", onclick: () => be.quit() }, icon(Power, 15), h("div", { class: "txt" }, h("div", { class: "t" }, "Ukončit ClaudeUsage"))),
    ),
    h("div", { class: "about", id: "about" }, "ClaudeUsage · běží lokálně, bez telemetrie"),
  );
  syncers.push(() => {
    (settingsEl.querySelector("#btn-logout") as HTMLElement).hidden = state.status === "logged_out";
  });
}

// ------------------------------------------------------------------ panels + sizing

function activePanel(): HTMLElement {
  return panels[current];
}

function syncHeight(): void {
  if (!switching) be.resize(Math.ceil(activePanel().offsetHeight));
}

function setPanel(id: PanelId): void {
  if (id === current) return;
  current = id;
  if (id === "history") historyPanel.open();
  switching = true;
  const target = Math.ceil(activePanel().offsetHeight);
  const growing = target >= appEl.offsetHeight;
  if (growing) be.resize(target);
  for (const [k, p] of Object.entries(panels)) {
    p.classList.toggle("is-active", k === id);
    p.inert = k !== id;
  }
  window.setTimeout(() => {
    switching = false;
    syncHeight();
  }, growing ? 20 : 290);
}

// ------------------------------------------------------------------ boot

async function main(): Promise<void> {
  be = await backend();
  state = await be.getState();
  applyTheme(state.settings.theme, false);
  root.classList.toggle("vibrant", state.vibrancy);

  for (const p of Object.values(panels)) p.classList.add("is-absolute");
  mainEl.classList.add("is-active");
  if (!isTauri) document.body.append(h("div", { class: "preview-badge" }, "Náhled designu · ukázková data"));
  settingsEl.inert = true;
  historyEl.inert = true;
  buildSettings();
  void be.version().then((v) => {
    (settingsEl.querySelector("#about") as HTMLElement).textContent = `ClaudeUsage ${v} · běží lokálně, bez telemetrie`;
  });
  historyPanel = buildHistoryPanel(historyEl, be, () => setPanel("main"), () => syncHeight());
  renderMain();
  syncers.forEach((s) => s());

  be.onState((s) => {
    state = s;
    applyTheme(s.settings.theme, true);
    renderMain();
    syncers.forEach((f) => f());
    // Neither ResizeObserver nor rAF run while the window is hidden; size explicitly.
    syncHeight();
  });
  be.onShown(() => {
    renderTimes();
    syncHeight();
    const stale = !state.updated_at || Date.now() - state.updated_at > 60_000;
    if (stale && state.status !== "logged_out") void be.refresh();
  });

  new ResizeObserver(syncHeight).observe(mainEl);
  new ResizeObserver(syncHeight).observe(settingsEl);
  new ResizeObserver(syncHeight).observe(historyEl);
  syncHeight();

  // Countdowns and "updated ago" tick over at every minute boundary.
  const tick = () => {
    renderTimes();
    window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  };
  tick();

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") be.hide();
  });
  window.addEventListener("contextmenu", (e) => e.preventDefault());
}

void main();
