const MIN = 60_000;

export type Tone = "ok" | "warn" | "danger" | "muted";

export function toneFor(p: number): Tone {
  if (p > 95) return "danger";
  if (p >= 80) return "warn";
  return "ok";
}

/** "2 h 14 min", "38 min", "3 d 4 h" */
export function countdown(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.ceil((t - now) / MIN));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

const weekday = new Intl.DateTimeFormat("cs-CZ", { weekday: "short" });
const time = new Intl.DateTimeFormat("cs-CZ", { hour: "numeric", minute: "2-digit" });

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "dnes v 15:49", "zítra v 7:00", "čt 26. 9. v 7:00" */
export function resetDate(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // The API reports e.g. 04:59:59.53 or 05:00:00.4; round to the nearest minute.
  const r = new Date(Math.round(d.getTime() / MIN) * MIN);
  const days = Math.round((startOfDay(r) - startOfDay(now)) / 86_400_000);
  const t = time.format(r);
  if (days === 0) return `dnes v ${t}`;
  if (days === 1) return `zítra v ${t}`;
  return `${weekday.format(r)} ${r.getDate()}. ${r.getMonth() + 1}. v ${t}`;
}

export function updatedAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return "Zatím neaktualizováno";
  const mins = Math.floor((now - ms) / MIN);
  if (mins < 1) return "Aktualizováno právě teď";
  if (mins < 60) return `Aktualizováno před ${mins} min`;
  const h = Math.floor(mins / 60);
  return `Aktualizováno před ${h} h`;
}

export function money(v: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
}
