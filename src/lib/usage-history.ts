import type { HistorySample } from "./types";

export type Range = "today" | "24h" | "3d" | "week" | "month";
export type Metric = "weekly" | "session";

export interface Bucket {
  start: number;
  end: number;
  /** Percentage points of the limit consumed in this bucket. */
  value: number;
  /** Starts after now. */
  future: boolean;
  /** The app was running (sampling) during this bucket. */
  covered: boolean;
}

export interface Series {
  range: Range;
  buckets: Bucket[];
  total: number;
  peak: Bucket | null;
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
 * Consumption between consecutive samples: the increase within one limit window,
 * or the whole new value when the window has reset in between. Attributed to the
 * bucket of the later sample.
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
    const vb = val(b);
    const va = val(a);
    if (vb == null || va == null || bi < 0) continue;
    const delta = win(a) === win(b) ? Math.max(0, vb - va) : vb;
    buckets[bi].value += delta;
  }

  const total = buckets.reduce((sum, b) => sum + b.value, 0);
  const peak = buckets.reduce<Bucket | null>((p, b) => (b.value > 0 && (!p || b.value > p.value) ? b : p), null);
  // `samples` includes the last one before the range when it exists, so a first
  // sample well inside the range means history simply starts later.
  const historyFrom = samples.length > 0 && samples[0].t > edges[0] + H ? samples[0].t : null;
  return { range, buckets, total, peak, historyFrom };
}

/** Rounds an axis maximum up to 1/2/5 × 10^k, at least 5. */
export function niceMax(v: number): number {
  const x = Math.max(5, v);
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}
