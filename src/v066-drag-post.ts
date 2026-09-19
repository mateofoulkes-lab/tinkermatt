// Restore the native listener registration immediately after v0.6.3 has bound
// its primitive-drag handlers. This keeps the compatibility guard tightly scoped.
const nativeAddEventListener = window.__tmV066NativeAddEventListener;
if (nativeAddEventListener) {
  (window as any).addEventListener = nativeAddEventListener;
  delete window.__tmV066NativeAddEventListener;
}

export {};
