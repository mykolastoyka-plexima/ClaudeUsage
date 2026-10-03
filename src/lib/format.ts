import { locale, t } from "./i18n";

const MIN = 60_000;

export type Tone = "ok" | "warn" | "danger" | "muted";

export function toneFor(p: number): Tone {
  if (p > 95) return "danger";
  if (p >= 80) return "warn";
  return "ok";
}

// Intl formatters are rebuilt when the locale changes (they are cheap but not free).
let cachedFor = "";
let unitFmt: Record<"day" | "hour" | "minute", Intl.NumberFormat>;
let timeFmt: Intl.DateTimeFormat;
let dateTimeFmt: Intl.DateTimeFormat;
let relFmt: Intl.RelativeTimeFormat;
let pctFmt: Intl.NumberFormat;
let pct1Fmt: Intl.NumberFormat;

function fmts() {
  const loc = locale();
  if (cachedFor !== loc) {
    cachedFor = loc;
    const unit = (u: "day" | "hour" | "minute") => new Intl.NumberFormat(loc, { style: "unit", unit: u, unitDisplay: "narrow" });
    unitFmt = { day: unit("day"), hour: unit("hour"), minute: unit("minute") };
    timeFmt = new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit" });
    dateTimeFmt = new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit" });
    relFmt = new Intl.RelativeTimeFormat(loc, { numeric: "always", style: "long" });
    pctFmt = new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 0 });
    pct1Fmt = new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 1 });
  }
  return { unitFmt, timeFmt, dateTimeFmt, relFmt, pctFmt, pct1Fmt };
}

/** Whole percent in the locale's style ("62 %", "62%"); "<1 %" for tiny non-zero values. */
export function pct(v: number): string {
  const { pctFmt } = fmts();
  if (v > 0 && v < 1) return `<${pctFmt.format(0.01)}`;
  return pctFmt.format(Math.round(v) / 100);
}

/** One decimal below 10 so small averages don't all read as 0. */
export function avgPct(v: number): string {
  const { pct1Fmt, pctFmt } = fmts();
  return v < 10 ? pct1Fmt.format(v / 100) : pctFmt.format(Math.round(v) / 100);
}

/** "2 h 14 min", "38 min", "3 d 4 h" — unit names from Intl in the UI language. */
export function countdown(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const { unitFmt: u } = fmts();
  const mins = Math.max(0, Math.ceil((at - now) / MIN));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${u.day.format(d)} ${u.hour.format(h)}`;
  if (h > 0) return `${u.hour.format(h)} ${u.minute.format(m)}`;
  return u.minute.format(m);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "today at 15:49", "tomorrow at 7:00", or a short weekday + date + time. */
export function resetDate(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // The API reports e.g. 04:59:59.53 or 05:00:00.4; round to the nearest minute.
  const r = new Date(Math.round(d.getTime() / MIN) * MIN);
  const days = Math.round((startOfDay(r) - startOfDay(now)) / 86_400_000);
  const { timeFmt, dateTimeFmt } = fmts();
  if (days === 0) return t("todayAt", { t: timeFmt.format(r) });
  if (days === 1) return t("tomorrowAt", { t: timeFmt.format(r) });
  return dateTimeFmt.format(r);
}

export function updatedAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return t("updatedNever");
  const mins = Math.floor((now - ms) / MIN);
  if (mins < 1) return t("updatedJustNow");
  const { relFmt } = fmts();
  const ago = mins < 60 ? relFmt.format(-mins, "minute") : relFmt.format(-Math.floor(mins / 60), "hour");
  return t("updatedAgo", { ago });
}

export function money(v: number): string {
  return new Intl.NumberFormat(locale(), { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
}
