import { h, icon } from "./dom";

/** Segmented control with a sliding thumb; call `.sync()` on the returned element after state changes. */
export function segmented<T extends string | number>(
  options: { value: T; label: string; icon?: Parameters<typeof icon>[0] }[],
  current: () => T,
  onPick: (v: T) => void,
): HTMLElement {
  const thumb = h("div", { class: "thumb" });
  const wrap = h("div", { class: "segmented", role: "group" }, thumb);
  const buttons = options.map((o) =>
    h("button", { type: "button", onclick: () => onPick(o.value) }, o.icon ? icon(o.icon, 13) : null, o.label),
  );
  wrap.append(...buttons);
  const sync = () => {
    const i = Math.max(0, options.findIndex((o) => o.value === current()));
    thumb.style.width = `calc((100% - 4px) / ${options.length})`;
    thumb.style.transform = `translateX(${i * 100}%)`;
    buttons.forEach((b, j) => b.setAttribute("aria-pressed", String(i === j)));
  };
  (wrap as HTMLElement & { sync?: () => void }).sync = sync;
  sync();
  return wrap;
}
