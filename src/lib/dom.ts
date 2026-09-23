import { createElement, type IconNode } from "lucide";

export function icon(node: IconNode, size = 16): SVGElement {
  return createElement(node, { width: size, height: size, "stroke-width": 1.75, "aria-hidden": "true" });
}

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Counts a number up/down in place, e.g. "62". */
export function tweenNumber(el: HTMLElement, from: number, to: number, ms = 900): void {
  const prev = (el as HTMLElement & { _raf?: number })._raf;
  if (prev) cancelAnimationFrame(prev);
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = String(Math.round(to));
    return;
  }
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = String(Math.round(from + (to - from) * easeOut(k)));
    if (k < 1) (el as HTMLElement & { _raf?: number })._raf = requestAnimationFrame(step);
  };
  (el as HTMLElement & { _raf?: number })._raf = requestAnimationFrame(step);
}
