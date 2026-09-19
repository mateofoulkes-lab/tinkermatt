// v0.6.8 early interaction gate.
// Registered immediately after v0.4 so it runs in capture phase before the
// historical target-level Tinker widget handlers (v0.4.1/v0.4.3) and before
// later compatibility layers. The actual handler is installed by v068.ts once
// the whole editor has initialized.

declare global {
  interface Window {
    __tmV068PointerdownOverride?: (event: PointerEvent) => boolean;
  }
}

window.addEventListener("pointerdown", (event) => {
  window.__tmV068PointerdownOverride?.(event);
}, true);

export {};
