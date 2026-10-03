import { ChevronLeft } from "lucide";
import { h, icon } from "./lib/dom";
import type { Backend } from "./lib/ipc";
import { segmented } from "./lib/segmented";
import { buildSeries, niceMax, RANGE_HOURS, type Bucket, type Metric, type Range, type Series } from "./lib/usage-history";
import type { HistorySample } from "./lib/types";
import { avgPct, pct } from "./lib/format";
import { locale, t, type Key } from "./lib/i18n";

const SVG = "http://www.w3.org/2000/svg";
const W = 284;
const HGT = 148;
const PAD = { l: 24, r: 2, t: 16, b: 18 };
const RANGES: { value: Range; key: Key }[] = [
  { value: "today", key: "rangeToday" },
  { value: "24h", key: "range24h" },
  { value: "3d", key: "range3d" },
  { value: "week", key: "rangeWeek" },
  { value: "month", key: "rangeMonth" },
];

// Created on first use, after the UI language is known.
let fmt: { weekday: Intl.DateTimeFormat; hm: Intl.DateTimeFormat; hour: Intl.DateTimeFormat; dm: Intl.DateTimeFormat; wdm: Intl.DateTimeFormat; full: Intl.DateTimeFormat } | null = null;
function f() {
  const loc = locale();
  fmt ??= {
    weekday: new Intl.DateTimeFormat(loc, { weekday: "short" }),
    hm: new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit" }),
    hour: new Intl.DateTimeFormat(loc, { hour: "numeric" }),
    dm: new Intl.DateTimeFormat(loc, { day: "numeric", month: "numeric" }),
    wdm: new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "numeric" }),
    full: new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit" }),
  };
  return fmt;
}

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

function bucketLabel(b: Bucket, range: Range): string {
  const s = new Date(b.start);
  const e = new Date(b.end);
  const { wdm, hm } = f();
  if (range === "week" || range === "month") return wdm.format(s);
  const span = `${hm.format(s)}–${hm.format(e)}`;
  return range === "today" ? span : `${wdm.format(s)} ${span}`;
}

/** Sparse x-axis labels so they never collide at 284 px. */
function tickLabel(b: Bucket, i: number, range: Range): string | null {
  const d = new Date(b.start);
  const { weekday, hm, dm } = f();
  switch (range) {
    case "today":
    case "24h":
      return d.getHours() % 6 === 0 ? hm.format(d) : null;
    case "3d":
      return d.getHours() === 0 ? weekday.format(d) : null;
    case "week":
      return weekday.format(d);
    case "month":
      return i % 7 === 2 ? dm.format(d) : null;
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

  const rangeCtl = segmented<Range>(RANGES.map((r) => ({ value: r.value, label: t(r.key) })), () => range, (v) => {
    range = v;
    save("cu.history.range", v);
    sync();
    void refresh();
  });
  const metricCtl = segmented<Metric>(
    [
      { value: "weekly", label: t("metricWeekly") },
      { value: "session", label: t("metricSession") },
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
      h("button", { class: "icon-btn", "aria-label": t("back"), title: t("back"), onclick: onBack }, icon(ChevronLeft)),
      h("h1", {}, t("historyTitle")),
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
          h("div", { class: "c-title" }, t("historyEmptyTitle")),
          h("p", {}, t("historyEmptyBody")),
        ),
      );
      onResize();
      return;
    }
    body.replaceChildren(...chart(series));
    onResize();
  }

  function chart(series: Series): Node[] {
    const weekly = series.metric === "weekly";
    const unit = weekly ? t("metricWeekly") : t("metricSession");
    const avgText = series.average == null ? "–" : weekly ? `Ø ${avgPct(series.average)}` : pct(series.average);
    const avgUnit = ` ${weekly ? t(series.averageUnit === "hour" ? "perHour" : "perDay") : t("avgSession")}`;
    const peakAt = series.peak ? bucketLabel(series.peak, range) : null;
    const detail = weekly
      ? [t("total", { v: pct(series.total) }), peakAt && t("peakAt", { when: peakAt })].filter(Boolean).join(" · ")
      : series.sessions > 0
        ? [t("sessionsCount", { n: series.sessions }), peakAt && t("highestAt", { when: peakAt })].filter(Boolean).join(" · ")
        : t("noSessions");
    const stat = h(
      "div",
      { class: "chart-stat" },
      h("div", {}, h("span", { class: "chart-total" }, avgText), h("span", { class: "chart-unit" }, avgUnit)),
      h("div", { class: "chart-peak" }, weekly && series.total === 0 ? t("noUsage") : detail),
    );

    const n = series.buckets.length;
    const plotW = W - PAD.l - PAD.r;
    const plotH = HGT - PAD.t - PAD.b;
    // Session peaks live on a fixed 0–100 % scale.
    const max = weekly ? niceMax(series.peak?.value ?? 0) : 100;
    const slot = plotW / n;
    const bw = Math.max(2, Math.min(24, slot - 2));
    const y = (v: number) => PAD.t + plotH - (v / max) * plotH;

    const svg = el("svg", { viewBox: `0 0 ${W} ${HGT}`, class: "chart", role: "img", "aria-label": `${unit}: ${avgText}${avgUnit}` });
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
      const value = b.future ? "—" : b.covered || b.value > 0 ? pct(b.value) : t("noData");
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
      h("caption", {}, unit),
      ...series.buckets.filter((b) => !b.future).map((b) => h("tr", {}, h("th", {}, bucketLabel(b, range)), h("td", {}, b.covered || b.value > 0 ? pct(b.value) : t("noData")))),
    );

    const fromNote = series.historyFrom ? `${t("historyFrom", { when: f().full.format(new Date(series.historyFrom)) })} ` : "";
    const note = h("div", { class: "chart-note" }, `${fromNote}${t("historyNote")}`);
    return [stat, wrap, note, table];
  }

  return {
    open() {
      sync();
      void refresh();
    },
  };
}
