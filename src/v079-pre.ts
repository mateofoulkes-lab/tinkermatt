// v0.7.9 early event bridge.
// Registers before the historical edit-mode capture listeners so the current
// topology editor can own component picking and transform shortcuts without
// fighting older compatibility layers.
declare global {
  interface Window {
    __tmV079PointerDownOverride?: (event: PointerEvent) => boolean;
    __tmV079KeydownOverride?: (event: KeyboardEvent) => boolean;
  }
}

window.addEventListener("pointerdown", (event) => {
  if (!window.__tmV079PointerDownOverride?.(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener("keydown", (event) => {
  if (!window.__tmV079KeydownOverride?.(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
