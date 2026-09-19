// v0.6.6 primitive-drag compatibility guard.
//
// v0.6.3 intentionally dispatches a synthetic pointercancel when a library item
// turns from a click/long-press into a drag. That synthetic event is useful for
// cancelling the old long-press timers, but its own window-level pointercancel
// handler also consumed it and cancelled the drag it had just started.
//
// While v0.6.3 registers its listeners, wrap capture-phase pointercancel handlers
// so synthetic cancels are ignored at window level. Real browser pointercancel
// events still flow normally. v066-drag-post restores addEventListener
// immediately after v0.6.3 has evaluated.

declare global {
  interface Window {
    __tmV066NativeAddEventListener?: typeof window.addEventListener;
  }
}

const nativeAddEventListener = window.addEventListener;
window.__tmV066NativeAddEventListener = nativeAddEventListener;

(window as any).addEventListener = function patchedAddEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  const capture = options === true || (typeof options === "object" && Boolean(options?.capture));
  if (type === "pointercancel" && capture && typeof listener === "function") {
    const original = listener as EventListener;
    const wrapped: EventListener = (event) => {
      if (!event.isTrusted) return;
      original.call(window, event);
    };
    return nativeAddEventListener.call(window, type, wrapped, options as any);
  }
  return nativeAddEventListener.call(window, type, listener as any, options as any);
};
