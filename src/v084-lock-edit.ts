import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global { interface Window { __tinkerEditor: TinkerEditor; } }

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.4 lock/edit guard no pudo acceder al editor.");
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };

function activeLocked() {
  return editor.activeObject()?.userData.tmLocked === true;
}

function editing() {
  return document.documentElement.classList.contains("tm-edit-mode");
}

function syncControls() {
  const active = editor.activeObject();
  const locked = Boolean(active?.userData.tmLocked === true);
  const controls = editor.scene.getObjectByName("__tm_tinkercad_controls");
  if (controls) controls.visible = Boolean(active) && !locked && !editing();
  if (locked) editor.transform.detach();
}

// Stop the explicit Edit button before v070's target listener sees it.
document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tm-mode='edit']");
  if (!button || !activeLocked()) return;
  const active = editor.activeObject();
  event.preventDefault();
  event.stopImmediatePropagation();
  setStatus(`🔒 “${active ? getMeta(active)?.name ?? active.name : "Objeto"}” está bloqueado. Desbloquealo para editar su malla.`);
}, true);

// Tab or a compatibility layer could still enter Edit Mode. If that happens,
// immediately ask the real v070 Object button to leave Edit Mode again.
const rootObserver = new MutationObserver(() => {
  if (editing() && activeLocked()) {
    document.querySelector<HTMLButtonElement>("[data-tm-mode='object']")?.click();
    const active = editor.activeObject();
    setStatus(`🔒 “${active ? getMeta(active)?.name ?? active.name : "Objeto"}” está bloqueado. Edit Mode cancelado.`);
  }
  syncControls();
});
rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
editor.on("selection", syncControls);
editor.on("changed", syncControls);
queueMicrotask(syncControls);
