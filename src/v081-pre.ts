// v0.8.1 early toolbar bridge.
// Registered before historical toolbar listeners so the safe topology transform
// layer can own face transforms without older compatibility layers also firing.
declare global {
  interface Window {
    __tmV081ToolbarClickOverride?: (event: MouseEvent) => boolean;
  }
}

window.addEventListener("click", (event) => {
  if (!window.__tmV081ToolbarClickOverride?.(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
