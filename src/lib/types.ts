export type Status = "loading" | "online" | "offline" | "logged_out";
export type ThemePref = "auto" | "light" | "dark";
export type Density = "normal" | "compact";
export type TrayStyle = "number" | "ring";

export interface Limit {
  kind: string;
  group: string;
  label: string;
  percent: number;
  resets_at: string | null;
  severity: string | null;
}

export interface Extra {
  label: string;
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
}

export interface HistorySample {
  t: number;
  s: number | null;
  sr: number | null;
  w: number | null;
  wr: number | null;
}
