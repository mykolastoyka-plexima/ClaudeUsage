import type { HistorySample } from "./types";

export type Range = "today" | "24h" | "3d" | "week" | "month";
export type Metric = "weekly" | "session";

export interface Bucket {
  start: number;
  end: number;
  /**
   * weekly: percentage points of the weekly limit consumed in this bucket.
   * session: highest session utilisation seen in this bucket (0–100).
   */
  value: number;
  /** Starts after now. */
  future: boolean;
  /** The app was running (sampling) during this bucket. */
  covered: boolean;
}

export interface Series {
  range: Range;
  metric: Metric;
  buckets: Bucket[];
  /** weekly: consumption over the range. session: unused (0). */
  total: number;
  peak: Bucket | null;
  /**
   * weekly: average consumption per hour or day of sampled time.
   * session: average peak utilisation of the sessions in range.
   */
  average: number | null;
  averageUnit: "hour" | "day" | "session";
  sessions: number;
  /** First sample available, if it starts inside the range (shorter history). */
  historyFrom: number | null;
}

const H = 3_600_000;
/** Two samples further apart than this mean the app was not running in between. */
const MAX_GAP = 40 * 60_000;

export const RANGE_HOURS: Record<Range, number> = { today: 24, "24h": 24, "3d": 72, week: 24 * 7, month: 24 * 30 };

function startOfDay(t: number): Date {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Bucket boundaries in local time; day buckets follow calendar days (DST-safe). */
function boundaries(range: Range, now: number): number[] {
  const out: number[] = [];
  if (range === "today") {
    const d = startOfDay(now);
    for (let i = 0; i <= 24; i++) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), i).getTime());
  } else if (range === "24h" || range === "3d") {
    const step = range === "24h" ? 1 : 3;
    const n = new Date(now);
    // End at the next aligned local hour boundary.
    const endHour = Math.floor(n.getHours() / step) * step + step;
    const end = new Date(n.getFullYear(), n.getMonth(), n.getDate(), endHour).getTime();
    for (let i = 24; i >= 0; i--) out.push(end - i * step * H);
  } else {
    const days = range === "week" ? 7 : 30;
    const end = addDays(startOfDay(now), 1);
    for (let i = days; i >= 0; i--) out.push(addDays(end, -i).getTime());
  }
  return out;
}

/**
 * weekly: consumption between consecutive samples (the increase within one limit
 * window, or the whole new value when the window reset in between), attributed to
 * the bucket of the later sample.
 * session: the highest session utilisation observed in each bucket.
 */
export function buildSeries(samples: HistorySample[], range: Range, metric: Metric, now = Date.now()): Series {
  const edges = boundaries(range, now);
  const buckets: Bucket[] = edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1], value: 0, future: start > now, covered: false }));
  const find = (t: number) => {
    if (t < edges[0] || t >= edges[edges.length - 1]) return -1;
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (buckets[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const val = (s: HistorySample) => (metric === "weekly" ? s.w : s.s);
  const win = (s: HistorySample) => (metric === "weekly" ? s.wr : s.sr);

  for (let i = 0; i < samples.length; i++) {
    const b = samples[i];
    const bi = find(b.t);
    if (bi >= 0) buckets[bi].covered = true;
    if (i === 0) continue;
    const a = samples[i - 1];
    // Mark buckets spanned by a continuous sampling interval as covered too.
    if (b.t - a.t <= MAX_GAP) {
      for (let k = Math.max(0, find(a.t)); k >= 0 && k < buckets.length && buckets[k].start < b.t; k++) buckets[k].covered = true;
    }
    if (metric === "session") continue;
    const vb = val(b);
    const va = val(a);
    if (vb == null || va == null || bi < 0) continue;
    const delta = win(a) === win(b) ? Math.max(0, vb - va) : vb;
    buckets[bi].value += delta;
  }

  // Session: per-bucket peak, plus each session window's own peak for the average.
  const sessionPeaks = new Map<number, number>();
  if (metric === "session") {
    for (const s of samples) {
      const bi = find(s.t);
      if (bi < 0 || s.s == null) continue;
      buckets[bi].value = Math.max(buckets[bi].value, s.s);
      if (s.sr != null && s.s > 0) sessionPeaks.set(s.sr, Math.max(sessionPeaks.get(s.sr) ?? 0, s.s));
    }
  }

  const total = metric === "weekly" ? buckets.reduce((sum, b) => sum + b.value, 0) : 0;
  const peak = buckets.reduce<Bucket | null>((p, b) => (b.value > 0 && (!p || b.value > p.value) ? b : p), null);

  let average: number | null = null;
  let averageUnit: Series["averageUnit"] = "session";
  if (metric === "weekly") {
    // Average over the time the app was actually sampling, so gaps don't dilute it.
    const coveredMs = buckets.filter((b) => b.covered && !b.future).reduce((sum, b) => sum + (Math.min(b.end, now) - b.start), 0);
    averageUnit = range === "today" || range === "24h" || coveredMs < 24 * H ? "hour" : "day";
    const unitMs = averageUnit === "hour" ? H : 24 * H;
    average = coveredMs > 0 ? total / (coveredMs / unitMs) : null;
  } else if (sessionPeaks.size > 0) {
    average = [...sessionPeaks.values()].reduce((a, b) => a + b, 0) / sessionPeaks.size;
  }
  // `samples` includes the last one before the range when it exists, so a first
  // sample well inside the range means history simply starts later.
  const historyFrom = samples.length > 0 && samples[0].t > edges[0] + H ? samples[0].t : null;
  return { range, metric, buckets, total, peak, average, averageUnit, sessions: sessionPeaks.size, historyFrom };
}

/** Rounds an axis maximum up to 1/2/5 × 10^k, at least 5. */
export function niceMax(v: number): number {
  const x = Math.max(5, v);
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}
