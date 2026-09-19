import "./v072";
import "./v073.css";

const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.7.3";

const workspace = document.querySelector<HTMLElement>(".workspace");
const editPanel = document.querySelector<HTMLElement>(".tm-edit-side-panel");
const viewport = document.querySelector<HTMLElement>("#viewport");

// Keep the floating Edit properties panel OUT of the workspace grid. In v0.7.2
// it was absolutely positioned while still being a grid child, which let the
// browser's grid auto-placement get confused on mode changes and could collapse
// the viewport to a thin strip while the outliner consumed the central area.
if (workspace && editPanel && workspace.parentElement && editPanel.parentElement === workspace) {
  workspace.insertAdjacentElement("afterend", editPanel);
}

// TinkerEditor historically only listened to window.resize. Object/Edit mode
// changes the viewport dimensions without resizing the browser window, so keep
// the WebGL drawing buffer + camera aspect synchronized with the actual viewport.
if (viewport) {
  let lastWidth = -1;
  let lastHeight = -1;
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    const width = Math.round(entry?.contentRect.width ?? viewport.clientWidth);
    const height = Math.round(entry?.contentRect.height ?? viewport.clientHeight);
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    window.dispatchEvent(new Event("resize"));
  });
  observer.observe(viewport);
}

// Force one resize after the DOM relocation/layout settles.
requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))));

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.7.3 listo.";
