// v0.6.4 pre-bootstrap hook.
//
// v0.4 owns the original capture-phase G/R/S keyboard handler. We keep that
// compatibility layer intact, but wrap its keydown registration so the current
// release can replace only S (scale) with the newer global/local semantics.

declare global {
  interface Window {
    __tmV064ScaleKeydownOverride?: (event: KeyboardEvent) => boolean;
  }
}

const nativeAddEventListener = window.addEventListener;
let intercepted = false;

(window as any).addEventListener = function patchedAddEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  const capture = options === true || (typeof options === "object" && Boolean(options?.capture));
  if (!intercepted && type === "keydown" && capture && typeof listener === "function") {
    intercepted = true;
    const legacy = listener as EventListener;
    const wrapped: EventListener = (rawEvent) => {
      const event = rawEvent as KeyboardEvent;
      if (window.__tmV064ScaleKeydownOverride?.(event)) return;
      legacy.call(window, rawEvent);
    };
    nativeAddEventListener.call(window, type, wrapped, options as any);
    // Only the v0.4 modal handler needs interception. Restore the native method
    // immediately so later modules register listeners normally.
    (window as any).addEventListener = nativeAddEventListener;
    return;
  }
  return nativeAddEventListener.call(window, type, listener as any, options as any);
};
