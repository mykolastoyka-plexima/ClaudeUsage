import { ChevronLeft } from "lucide";
import { h, icon } from "./lib/dom";
import type { Backend } from "./lib/ipc";
import { segmented } from "./lib/segmented";
import { buildSeries, niceMax, RANGE_HOURS, type Bucket, type Metric, type Range, type Series } from "./lib/usage-history";
import type { HistorySample } from "./lib/types";

const SVG = "http://www.w3.org/2000/svg";
const W = 284;
const HGT = 148;
const PAD = { l: 24, r: 2, t: 16, b: 18 };
const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Dnes" },
  { value: "24h", label: "24 h" },
  { value: "3d", label: "3 dny" },
  { value: "week", label: "Týden" },
  { value: "month", label: "Měsíc" },
];

const weekday = new Intl.DateTimeFormat("cs-CZ", { weekday: "short" });
const hm = new Intl.DateTimeFormat("cs-CZ", { hour: "numeric", minute: "2-digit" });
const dm = (d: Date) => `${d.getDate()}. ${d.getMonth() + 1}.`;

function load<T extends string>(key: string, fallback: T, allowed: readonly string[]): T {
  try {
    const v = localStorage.getItem(key);
    return v && allowed.includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* per-viewer convenience only */
  }
}

function pct(v: number): string {
  if (v > 0 && v < 1) return "<1 %";
  return `${Math.round(v)} %`;
}

function bucketLabel(b: Bucket, range: Range): string {
  const s = new Date(b.start);
  const e = new Date(b.end);
  if (range === "week" || range === "month") return `${weekday.format(s)} ${dm(s)}`;
  const span = `${hm.format(s)}–${hm.format(e)}`;
  return range === "today" ? span : `${weekday.format(s)} ${dm(s)} ${span}`;
}

/** Sparse x-axis labels so they never collide at 284 px. */
function tickLabel(b: Bucket, i: number, range: Range): string | null {
  const d = new Date(b.start);
  switch (range) {
    case "today":
    case "24h":
      return d.getHours() % 6 === 0 ? `${d.getHours()}:00` : null;
    case "3d":
      return d.getHours() === 0 ? weekday.format(d) : null;
    case "week":
      return weekday.format(d);
    case "month":
      return i % 7 === 2 ? dm(d) : null;
  }
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** Column with a rounded data-end and a square baseline. */
function barPath(x: number, y: number, w: number, hgt: number): string {
  const r = Math.min(w < 8 ? 2 : 4, w / 2, hgt);
  const b = y + hgt;
  return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${b}Z`;
}

export interface HistoryPanel {
  open(): void;
}

export function buildHistoryPanel(root: HTMLElement, be: Backend, onBack: () => void, onResize: () => void): HistoryPanel {
  let range = load<Range>("cu.history.range", "24h", RANGES.map((r) => r.value));
  let metric = load<Metric>("cu.history.metric", "weekly", ["weekly", "session"]);
  let samples: HistorySample[] = [];
  let loaded = false;

  const rangeCtl = segmented<Range>(RANGES, () => range, (v) => {
    range = v;
    save("cu.history.range", v);
    sync();
    void refresh();
  });
  const metricCtl = segmented<Metric>(
    [
      { value: "weekly", label: "Týdenní limit" },
      { value: "session", label: "Session" },
    ],
    () => metric,
    (v) => {
      metric = v;
      save("cu.history.metric", v);
      sync();
      render();
    },
  );
  const sync = () => {
    (rangeCtl as HTMLElement & { sync: () => void }).sync();
    (metricCtl as HTMLElement & { sync: () => void }).sync();
  };

  const body = h("div", { class: "card chart-card" });
  root.replaceChildren(
    h(
      "div",
      { class: "settings-head" },
      h("button", { class: "icon-btn", "aria-label": "Zpět", title: "Zpět", onclick: onBack }, icon(ChevronLeft)),
      h("h1", {}, "Historie spotřeby"),
    ),
    h("div", { class: "seg-stack" }, rangeCtl, metricCtl),
    body,
  );

  async function refresh(): Promise<void> {
    try {
      samples = await be.getHistory(RANGE_HOURS[range] + 2);
    } catch {
      samples = [];
    }
    loaded = true;
    render();
  }

  function render(): void {
    if (!loaded) return;
    const series = buildSeries(samples, range, metric);
    const anyData = series.buckets.some((b) => b.covered);
    if (!anyData) {
      body.replaceChildren(
        h(
          "div",
          { class: "chart-empty" },
          h("div", { class: "c-title" }, "Zatím žádná historie"),
          h("p", {}, "ClaudeUsage ukládá spotřebu při každé obnově. Graf se naplní, jak bude aplikace běžet."),
        ),
      );
      onResize();
      return;
    }
    body.replaceChildren(...chart(series));
    onResize();
  }

  function chart(series: Series): Node[] {
    const unit = metric === "weekly" ? "týdenního limitu" : "session limitu (součet)";
    const stat = h(
      "div",
      { class: "chart-stat" },
      h("div", {}, h("span", { class: "chart-total" }, pct(series.total)), h("span", { class: "chart-unit" }, ` ${unit}`)),
      h("div", { class: "chart-peak" }, series.peak ? `Nejvíc ${bucketLabel(series.peak, range)}` : "Za období bez spotřeby"),
    );

    const n = series.buckets.length;
    const plotW = W - PAD.l - PAD.r;
    const plotH = HGT - PAD.t - PAD.b;
    const max = niceMax(series.peak?.value ?? 0);
    const slot = plotW / n;
    const bw = Math.max(2, Math.min(24, slot - 2));
    const y = (v: number) => PAD.t + plotH - (v / max) * plotH;

    const svg = el("svg", { viewBox: `0 0 ${W} ${HGT}`, class: "chart", role: "img", "aria-label": `Spotřeba ${unit}, celkem ${pct(series.total)}` });
    // Integer ticks only; a half tick like 2.5 % reads as noise.
    for (const v of Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max]) {
      const gy = Math.round(y(v)) + 0.5;
      svg.append(el("line", { x1: PAD.l, x2: W - PAD.r, y1: gy, y2: gy, class: "grid" }));
      const t = el("text", { x: PAD.l - 6, y: gy + 3.5, class: "axis", "text-anchor": "end" });
      t.textContent = String(v);
      svg.append(t);
    }

    const bars: SVGPathElement[] = [];
    series.buckets.forEach((b, i) => {
      const x = PAD.l + i * slot + (slot - bw) / 2;
      if (!b.future && b.value > 0) {
        const hgt = Math.max(2, (b.value / max) * plotH);
        const p = el("path", { d: barPath(x, PAD.t + plotH - hgt, bw, hgt), class: "bar-mark" });
        svg.append(p);
        bars[i] = p;
      } else if (b.covered && !b.future) {
        // Sampled but nothing consumed: a hairline tick on the baseline.
        svg.append(el("rect", { x, y: PAD.t + plotH - 1, width: bw, height: 1, class: "bar-zero" }));
      }
      const label = tickLabel(b, i, range);
      if (label) {
        const t = el("text", { x: PAD.l + i * slot + slot / 2, y: HGT - 4, class: "axis", "text-anchor": "middle" });
        t.textContent = label;
        svg.append(t);
      }
    });

    // Direct label on the peak only.
    if (series.peak) {
      const i = series.buckets.indexOf(series.peak);
      const t = el("text", { x: PAD.l + i * slot + slot / 2, y: y(series.peak.value) - 5, class: "peak", "text-anchor": "middle" });
      t.textContent = pct(series.peak.value);
      svg.append(t);
    }

    // Hover layer: each full-height slot is the hit target.
    const tip = h("div", { class: "chart-tip", role: "status" });
    const wrap = h("div", { class: "chart-wrap" }, svg, tip);
    let active = -1;
    const show = (i: number) => {
      active = i;
      bars.forEach((p, j) => p?.classList.toggle("dim", j !== i));
      const b = series.buckets[i];
      const value = b.future ? "—" : b.covered || b.value > 0 ? pct(b.value) : "bez dat";
      tip.replaceChildren(h("span", { class: "tip-k" }, bucketLabel(b, range)), h("span", { class: "tip-v" }, value));
      tip.classList.add("on");
      const cx = ((PAD.l + i * slot + slot / 2) / W) * wrap.clientWidth;
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.min(wrap.clientWidth - half, Math.max(half, cx))}px`;
    };
    const hide = () => {
      active = -1;
      bars.forEach((p) => p?.classList.remove("dim"));
      tip.classList.remove("on");
    };
    series.buckets.forEach((_, i) => {
      const hit = el("rect", { x: PAD.l + i * slot, y: 0, width: slot, height: HGT, class: "hit" });
      hit.addEventListener("mouseenter", () => show(i));
      svg.append(hit);
    });
    svg.addEventListener("mouseleave", hide);
    svg.setAttribute("tabindex", "0");
    svg.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const last = series.buckets.findLastIndex((b) => !b.future);
      const next = active < 0 ? last : active + (e.key === "ArrowRight" ? 1 : -1);
      show(Math.max(0, Math.min(last, next)));
    });
    svg.addEventListener("blur", hide);

    // Table view for screen readers.
    const table = h(
      "table",
      { class: "sr-only" },
      h("caption", {}, `Spotřeba ${unit}`),
      ...series.buckets.filter((b) => !b.future).map((b) => h("tr", {}, h("th", {}, bucketLabel(b, range)), h("td", {}, b.covered || b.value > 0 ? pct(b.value) : "bez dat"))),
    );

    const fromNote = series.historyFrom
      ? `Historie od ${weekday.format(new Date(series.historyFrom))} ${dm(new Date(series.historyFrom))} ${hm.format(new Date(series.historyFrom))}. `
      : "";
    const note = h("div", { class: "chart-note" }, `${fromNote}Počítá se z dat, která ClaudeUsage uložil, když běžel.`);
    return [stat, wrap, note, table];
  }

  return {
    open() {
      sync();
      void refresh();
    },
  };
}
