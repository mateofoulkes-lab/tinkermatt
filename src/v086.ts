import { icon, type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faFile, faFolderOpen, faFloppyDisk } from "@fortawesome/free-solid-svg-icons";
import "./v085";
import "./v086.css";
import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmAppVersion?: string;
    tinkerMatt?: Record<string, any>;
  }
}

const VERSION = "0.8.6";
const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.6 no pudo acceder al editor.");

const toolbar = document.querySelector<HTMLElement>(".toolbar-shell");
const outliner = document.querySelector<HTMLElement>("#outliner-tree");
const status = document.querySelector<HTMLElement>("#status");

window.__tmAppVersion = VERSION;
window.tinkerMatt ??= {};
window.tinkerMatt.version = VERSION;

function setProjectIcon(button: HTMLButtonElement | null, definition: IconDefinition) {
  if (!button) return;
  // Keep the original button node: all historical click listeners stay attached
  // to the correct action. Only the visual icon is replaced.
  button.innerHTML = icon(definition).html.join("");
}

function makeDivider(kind: "macro" | "mode") {
  const divider = document.createElement("div");
  divider.className = `toolbar-divider tm-v086-divider tm-v086-${kind}-divider`;
  divider.setAttribute("aria-hidden", "true");
  return divider;
}

function arrangeToolbar() {
  if (!toolbar) return;
  toolbar.classList.add("tm-toolbar-v086");

  const projectControls = toolbar.querySelector<HTMLElement>(":scope > .tm-project-controls");
  const macroControls = toolbar.querySelector<HTMLElement>(":scope > .macro-controls");
  const spacer = toolbar.querySelector<HTMLElement>(":scope > .toolbar-spacer");
  const modeSwitch = toolbar.querySelector<HTMLElement>(":scope > .tm-mode-switch");
  const importButton = toolbar.querySelector<HTMLButtonElement>("#import-stl-top");
  const ioControls = importButton?.closest<HTMLElement>(".io-controls") ?? null;

  if (projectControls) {
    const fresh = projectControls.querySelector<HTMLButtonElement>('[data-tm-project-role="new"]');
    const open = projectControls.querySelector<HTMLButtonElement>('[data-tm-project-role="open"]');
    const save = projectControls.querySelector<HTMLButtonElement>('[data-tm-project-role="save"]');

    // Requested visual assignment, without changing button order or behavior:
    // Nuevo = blank document, Abrir = folder, Guardar = floppy disk.
    setProjectIcon(fresh, faFile);
    setProjectIcon(open, faFolderOpen);
    setProjectIcon(save, faFloppyDisk);
  }

  toolbar.querySelectorAll(":scope > .tm-v086-divider").forEach((node) => node.remove());

  // Record / repeat belong with the editing actions on the left, before the
  // flexible spacer. A dedicated divider separates them from the tool groups.
  if (macroControls && spacer) {
    toolbar.insertBefore(macroControls, spacer);
    toolbar.insertBefore(makeDivider("macro"), macroControls);
  }

  // Object/Edit belongs on the right, immediately before Import/Export.
  // It gets its own separator from the I/O actions.
  if (modeSwitch && ioControls) {
    toolbar.insertBefore(modeSwitch, ioControls);
    toolbar.insertBefore(makeDivider("mode"), ioControls);
  }
}

let scrollFrame = 0;
function revealActiveOutlinerRow() {
  if (!outliner) return;
  const active = editor.activeObject();
  const id = active ? getMeta(active)?.id : null;
  if (!id) return;

  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const rows = [...outliner.querySelectorAll<HTMLElement>(".outliner-row")];
    const activeRow = rows.find((row) => row.dataset.id === id);
    if (!activeRow) return;

    // renderOutliner already marks selected rows, but reinforce the active row
    // so historical rendering layers cannot leave the visual state stale.
    activeRow.classList.add("selected");
    activeRow.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  });
}

// Clicking a 3D object emits selection. main.ts rebuilds the outliner first;
// this later listener then reveals the corresponding row, even if it was off-screen.
editor.on("selection", revealActiveOutlinerRow);

// If a historical layer rebuilds the tree after the selection event, reveal it
// again once the new rows exist.
if (outliner) {
  new MutationObserver(() => {
    if (editor.activeObject()) revealActiveOutlinerRow();
  }).observe(outliner, { childList: true, subtree: false });
}

function applyVersion() {
  document.querySelectorAll<HTMLElement>("[data-version], .version, .app-version").forEach((node) => {
    if (/^v?0\.8\./i.test(node.textContent?.trim() ?? "")) node.textContent = `v${VERSION}`;
  });
}

arrangeToolbar();
queueMicrotask(() => {
  arrangeToolbar();
  revealActiveOutlinerRow();
  applyVersion();
});
requestAnimationFrame(() => {
  arrangeToolbar();
  revealActiveOutlinerRow();
  applyVersion();
});

applyVersion();
if (status) status.textContent = "TinkerMatt v0.8.6 listo · toolbar y outliner sincronizados.";
