import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.4 UI no pudo acceder al editor.");
const outliner = document.querySelector<HTMLElement>("#outliner-tree");
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };

function findByRow(row: HTMLElement) {
  const id = row.dataset.id;
  return id ? editor.findById(id) : null;
}

function beginRename(row: HTMLElement) {
  const object = findByRow(row);
  const meta = object && getMeta(object);
  const name = row.querySelector<HTMLElement>(".outliner-name");
  if (!object || !meta || !name) return;
  if (name.dataset.renaming === "1") return;
  name.dataset.renaming = "1";
  name.dataset.originalName = meta.name;
  name.contentEditable = "true";
  name.spellcheck = false;
  name.focus();
  const range = document.createRange();
  range.selectNodeContents(name);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  setStatus(`Renombrando “${meta.name}” · Enter confirma · Esc cancela.`);
}

function finishRename(name: HTMLElement, cancel = false) {
  const row = name.closest<HTMLElement>(".outliner-row");
  const object = row && findByRow(row);
  const meta = object && getMeta(object);
  if (!row || !object || !meta || name.dataset.renaming !== "1") return;
  const original = name.dataset.originalName || meta.name;
  const next = cancel ? original : (name.textContent?.trim() || original);
  name.contentEditable = "false";
  delete name.dataset.renaming;
  delete name.dataset.originalName;
  if (cancel) name.textContent = original;
  else editor.renameById(meta.id, next);
  setStatus(cancel ? "Renombrado cancelado." : `Objeto renombrado a “${next}”.`);
}

function decorateRow(row: HTMLElement) {
  if (row.dataset.v084Decorated === "1") return;
  row.dataset.v084Decorated = "1";
  const object = findByRow(row);
  const name = row.querySelector<HTMLElement>(".outliner-name");
  if (!object || !name) return;
  name.title = "Doble click para renombrar · F2 con el objeto seleccionado";

  // Capture-phase fallback: historical layers sometimes replace the row and lose
  // main.ts' original dblclick listener. This works regardless of which layer rendered it.
  name.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    beginRename(row);
  }, true);
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finishRename(name, false);
      name.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishRename(name, true);
      name.blur();
    }
  }, true);
  name.addEventListener("blur", () => finishRename(name, false), true);

  const existing = row.querySelector<HTMLButtonElement>(".tm-v084-lock");
  if (!existing) {
    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "tm-v084-lock";
    lock.setAttribute("aria-label", "Bloquear o desbloquear objeto");
    lock.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = findByRow(row);
      const currentMeta = current && getMeta(current);
      if (!current || !currentMeta) return;
      const next = current.userData.tmLocked !== true;
      await window.tinkerMatt.lockObjects?.({ objects: [currentMeta.id], locked: next, allowLocked: true });
      decorateOutliner();
      setStatus(next ? `“${currentMeta.name}” bloqueado.` : `“${currentMeta.name}” desbloqueado.`);
    });
    const eye = row.querySelector(".eye-button");
    if (eye) row.insertBefore(lock, eye);
    else row.append(lock);
  }
  const lock = row.querySelector<HTMLButtonElement>(".tm-v084-lock");
  if (lock) {
    const locked = object.userData.tmLocked === true;
    lock.textContent = locked ? "🔒" : "🔓";
    lock.title = locked ? "Desbloquear objeto" : "Bloquear objeto";
    row.classList.toggle("tm-v084-locked", locked);
  }
}

function decorateOutliner() {
  if (!outliner) return;
  outliner.querySelectorAll<HTMLElement>(".outliner-row").forEach(decorateRow);
}

if (outliner) {
  decorateOutliner();
  new MutationObserver(decorateOutliner).observe(outliner, { childList: true, subtree: true });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "F2" || event.ctrlKey || event.altKey || event.metaKey) return;
  const active = document.activeElement as HTMLElement | null;
  if (active?.matches("input,textarea,[contenteditable='true']")) return;
  const selectedRows = [...document.querySelectorAll<HTMLElement>("#outliner-tree .outliner-row.selected")];
  const row = selectedRows[selectedRows.length - 1];
  if (!row) return;
  event.preventDefault();
  beginRename(row);
});

const style = document.createElement("style");
style.textContent = `
#outliner-tree .outliner-name[contenteditable="true"]{
  background:#fff;border:1px solid #078ac2;border-radius:4px;outline:none;
  padding:1px 4px;min-width:44px;box-shadow:0 0 0 2px rgba(7,138,194,.12)
}
#outliner-tree .tm-v084-lock{
  border:0;background:transparent;padding:2px 4px;margin-left:auto;cursor:pointer;
  opacity:.42;font-size:11px;line-height:1
}
#outliner-tree .tm-v084-lock:hover,#outliner-tree .tm-v084-locked .tm-v084-lock{opacity:.9}
#outliner-tree .tm-v084-locked .outliner-name{opacity:.68}
`;
document.head.append(style);

setStatus("TinkerMatt v0.8.4 · outliner: doble click/F2 renombra · lock visible.");
