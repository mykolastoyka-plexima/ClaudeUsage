import type { AppState, HistorySample, Limit, Settings, Snapshot } from "./types";

export const isTauri = "__TAURI_INTERNALS__" in window;

type Listener = (s: AppState) => void;

export interface Backend {
  getState(): Promise<AppState>;
  getHistory(hours: number): Promise<HistorySample[]>;
  version(): Promise<string>;
  onState(fn: Listener): void;
  onShown(fn: () => void): void;
  refresh(): Promise<void>;
  setSettings(s: Settings): Promise<AppState>;
  openLogin(): Promise<void>;
  logout(): Promise<void>;
  resize(height: number): void;
  hide(): void;
  quit(): void;
}

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return {
    getState: () => invoke<AppState>("get_state"),
    getHistory: (hours) => invoke<HistorySample[]>("get_history", { hours }),
    version: async () => (await import("@tauri-apps/api/app")).getVersion(),
    onState: (fn) => void listen<AppState>("state", (e) => fn(e.payload)),
    onShown: (fn) => void listen("popover-shown", () => fn()),
    refresh: () => invoke("refresh_now"),
    setSettings: (settings) => invoke<AppState>("set_settings", { settings }),
    openLogin: () => invoke("open_login"),
    logout: () => invoke("logout"),
    resize: (height) => void invoke("resize_popover", { height }).catch((e) => console.error("resize_popover", e)),
    hide: () => void invoke("hide_popover"),
    quit: () => void invoke("quit_app"),
  };
}

/**
 * Browser preview (`npm run dev` opened outside Tauri) with fake data, so the UI
 * can be designed and screenshotted in every state:
 *   ?s=online|offline|logged_out|loading|nodata  &p=62  &w=84  &x=1  &theme=dark  &d=compact  &lang=en
 */
function mockBackend(): Backend {
  const q = new URLSearchParams(location.search);
  const status = (q.get("s") ?? "online") as AppState["status"] | "nodata";
  const p = Number(q.get("p") ?? 62);
  const w = Number(q.get("w") ?? 84);
  const inH = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  let listeners: Listener[] = [];
  const snapshot: Snapshot = {
    limits: [
      { kind: "session", group: "session", name: null, percent: p, resets_at: inH(2.23), severity: "normal" },
      { kind: "weekly_all", group: "weekly", name: null, percent: w, resets_at: inH(62.4), severity: "normal" },
      ...(q.get("x") ? [{ kind: "weekly_opus", group: "weekly", name: "Opus", percent: 41, resets_at: inH(62.4), severity: "normal" }] : []),
    ],
    extras: q.get("x") ? [{ kind: "credits", percent: null, used: 12.4, limit: 50 }] : [],
  };
  let state: AppState = {
    status: status === "nodata" ? "offline" : status,
    snapshot: status === "online" || status === "offline" ? snapshot : null,
    updated_at: status === "offline" ? Date.now() - 14 * 60_000 : status === "online" ? Date.now() - 2 * 60_000 : null,
    error: status === "nodata" || status === "offline" ? "offline" : null,
    settings: { theme: (q.get("theme") as Settings["theme"]) ?? "auto", density: (q.get("d") as Settings["density"]) ?? "normal", tray_style: "number", language: q.get("lang") ?? "auto", interval_min: 5, notifications: true, autostart: false },
    vibrancy: false,
    refreshing: status === "loading",
    ...mockLang(q.get("lang")),
  };
  const emit = () => listeners.forEach((l) => l(state));
  const history = q.get("h") === "0" ? [] : mockHistory(Number(q.get("days") ?? 35));
  return {
    getState: async () => state,
    version: async () => "preview",
    getHistory: async (hours) => history.filter((s) => s.t >= Date.now() - hours * 3_600_000),
    onState: (fn) => void listeners.push(fn),
    onShown: () => {},
    refresh: async () => {
      state = { ...state, refreshing: true };
      emit();
      setTimeout(() => {
        const bump = (l: Limit): Limit => ({ ...l, percent: Math.min(100, l.percent + Math.round(Math.random() * 9)) });
        state = { ...state, refreshing: false, status: "online", updated_at: Date.now(), snapshot: { ...snapshot, limits: (state.snapshot ?? snapshot).limits.map(bump) } };
        emit();
      }, 900);
    },
    setSettings: async (s) => ((state = { ...state, settings: s, ...mockLang(s.language) }), emit(), state),
    openLogin: async () => {},
    logout: async () => ((state = { ...state, status: "logged_out", snapshot: null, updated_at: null }), emit()),
    resize: (h) => ((document.getElementById("app") as HTMLElement).style.height = `${h}px`),
    hide: () => {},
    quit: () => {},
  };
}

const MOCK_LOCALES: Record<string, string> = { cs: "cs-CZ", en: "en-US", uk: "uk-UA", de: "de-DE", fr: "fr-FR", es: "es-ES", it: "it-IT", pl: "pl-PL" };

/** Mirrors lang::resolve in the backend: "auto" follows the browser. */
function mockLang(pref: string | null): { lang: string; locale: string } {
  const sys = navigator.language || "en-US";
  const sysLang = sys.split("-")[0].toLowerCase();
  const lang = pref && pref in MOCK_LOCALES ? pref : sysLang in MOCK_LOCALES ? sysLang : "en";
  return { lang, locale: sysLang === lang ? sys : MOCK_LOCALES[lang] };
}

export async function backend(): Promise<Backend> {
  return isTauri ? tauriBackend() : mockBackend();
}

/** Plausible fake samples every 15 min: daytime work in 5 h sessions, weekly reset on Saturdays 7:00. */
function mockHistory(days: number): HistorySample[] {
  const out: HistorySample[] = [];
  const now = Date.now();
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  let w = 0;
  let wr = 0;
  let s = 0;
  let sr = 0;
  for (let t = now - days * 86_400_000; t <= now; t += 15 * 60_000) {
    const d = new Date(t);
    const sat7 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((6 - d.getDay() + 7) % 7), 7).getTime();
    const nextWeekly = sat7 > t ? sat7 : sat7 + 7 * 86_400_000;
    if (nextWeekly !== wr) ((wr = nextWeekly), (w = 0));
    const working = d.getDay() > 0 && d.getDay() < 6 && d.getHours() >= 8 && d.getHours() < 19;
    if (t >= sr) ((s = 0), (sr = working ? t + 5 * 3_600_000 : 0));
    if (working && sr && rand() < 0.45) {
      const inc = Math.round(rand() * 4);
      s = Math.min(100, s + inc * 3);
      w = Math.min(100, w + inc * 0.5);
    }
    out.push({ t, s: Math.round(s), sr: sr ? Math.floor(sr / 1000) : null, w: Math.round(w), wr: Math.floor(wr / 1000) });
  }
  return out;
}
