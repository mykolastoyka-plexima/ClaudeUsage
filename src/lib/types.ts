export type Status = "loading" | "online" | "offline" | "logged_out";
export type ThemePref = "auto" | "light" | "dark";
export type Density = "normal" | "compact";
export type TrayStyle = "number" | "ring";

export interface Limit {
  kind: string;
  group: string;
  /** Model name for limits other than session / weekly_all. */
  name: string | null;
  percent: number;
  resets_at: string | null;
  severity: string | null;
}

export interface Extra {
  kind: string;
  percent: number | null;
  used: number | null;
  limit: number | null;
}

export interface Snapshot {
  limits: Limit[];
  extras: Extra[];
}

export interface Settings {
  theme: ThemePref;
  density: Density;
  tray_style: TrayStyle;
  /** "auto" or a language code from i18n LANGS. */
  language: string;
  interval_min: number;
  notifications: boolean;
  autostart: boolean;
}

export interface AppState {
  status: Status;
  snapshot: Snapshot | null;
  updated_at: number | null;
  error: string | null;
  settings: Settings;
  vibrancy: boolean;
  refreshing: boolean;
  /** Resolved UI language and BCP 47 locale. */
  lang: string;
  locale: string;
}

export interface HistorySample {
  t: number;
  s: number | null;
  sr: number | null;
  w: number | null;
  wr: number | null;
}
