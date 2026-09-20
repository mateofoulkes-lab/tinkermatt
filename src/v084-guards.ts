import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
    __tmV067TransformKeydownOverride?: (event: KeyboardEvent) => boolean;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.4 guards no pudo acceder al editor.");
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };

function locked(object: any) {
  return Boolean(object?.userData?.tmLocked === true);
}

function selectedLocked() {
  return editor.getSelection().filter(locked);
}

function blocked(label = "modificar") {
  const objects = selectedLocked();
  if (!objects.length) return false;
  setStatus(`🔒 No se puede ${label}: ${objects.map((o) => getMeta(o)?.name ?? o.name).join(", ")} está bloqueado.`);
  return true;
}

function findObject(ref: string) {
  return editor.findById(ref) ?? editor.getSceneRoots().flatMap((root) => {
    const found: any[] = [];
    root.traverse((node) => { if (getMeta(node)?.name === ref) found.push(node); });
    return found;
  })[0] ?? null;
}

function refsFromArgs(args: any) {
  const refs: string[] = [];
  if (typeof args?.object === "string") refs.push(args.object);
  if (Array.isArray(args?.objects)) refs.push(...args.objects.map(String));
  if (Array.isArray(args?.groups)) refs.push(...args.groups.map(String));
  if (Array.isArray(args?.targets)) refs.push(...args.targets.map(String));
  return refs;
}

function ensureArgsUnlocked(args: any) {
  if (args?.allowLocked === true) return;
  const objects = refsFromArgs(args).map(findObject).filter(Boolean);
  const hit = objects.filter(locked);
  if (hit.length) throw new Error(`Objeto(s) bloqueado(s): ${hit.map((o: any) => getMeta(o)?.name ?? o.name).join(", ")}`);
}

// -----------------------------------------------------------------------------
// Human-facing editor methods.
// -----------------------------------------------------------------------------
for (const [name, verb] of [
  ["setActivePosition", "mover"],
  ["setActiveRotation", "rotar"],
  ["setActiveDimension", "dimensionar"],
  ["deleteSelected", "borrar"],
  ["groupSelected", "agrupar"],
  ["ungroupSelected", "desagrupar"],
  ["setSolidMode", "cambiar sólido/hueco"],
  ["toggleHole", "cambiar sólido/hueco"],
  ["applyBoolean", "aplicar una booleana"],
] as const) {
  const original = (editor as any)[name]?.bind(editor);
  if (typeof original !== "function") continue;
  (editor as any)[name] = (...args: any[]) => {
    if (blocked(verb)) return undefined;
    return original(...args);
  };
}

// Stock TransformControls are already detached by v084-core. Hide the custom
// Tinkercad-style controls too, otherwise v067 can still move/rotate locked items.
function refreshLockedWidgets() {
  const active = editor.activeObject();
  const controls = editor.scene.getObjectByName("__tm_tinkercad_controls");
  if (controls) controls.visible = Boolean(active) && !locked(active);
  document.documentElement.classList.toggle("tm-active-object-locked", Boolean(active && locked(active)));
}
editor.on("selection", refreshLockedWidgets);
editor.on("changed", refreshLockedWidgets);
queueMicrotask(refreshLockedWidgets);

// Historical keyboard G/R modal hook. If the active object is locked, consume
// transformation shortcuts before that compatibility layer starts a gesture.
const previousTransformKeyHook = window.__tmV067TransformKeydownOverride;
window.__tmV067TransformKeydownOverride = (event: KeyboardEvent) => {
  const active = editor.activeObject();
  const key = event.key.toLowerCase();
  if (active && locked(active) && ["g", "m", "r", "s", "x", "y", "z"].includes(key)) {
    setStatus(`🔒 “${getMeta(active)?.name ?? active.name}” está bloqueado.`);
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  return previousTransformKeyHook?.(event) ?? false;
};

// Hide/disable the historical DOM scale handles for locked active objects.
const style = document.createElement("style");
style.textContent = `
.tm-active-object-locked .tm-z-handle,
.tm-active-object-locked .tm-edge-handle,
.tm-active-object-locked .tm-corner-handle,
.tm-active-object-locked .tm-rotate-handle,
.tm-active-object-locked .tm-move-handle{
  pointer-events:none !important;
  opacity:.18 !important;
}
`;
document.head.append(style);

// -----------------------------------------------------------------------------
// Legacy MCP methods. New v084 methods already enforce this internally, but old
// exact tools (move_object, set_dimensions, delete_objects...) must obey lock too.
// -----------------------------------------------------------------------------
const api = window.tinkerMatt;
for (const name of [
  "moveObject", "rotateObject", "setDimensions", "setSolidMode", "unionObjects",
  "deleteObjects", "groupObjects", "ungroupObjects", "renameObject",
] as const) {
  const original = api[name];
  if (typeof original !== "function") continue;
  api[name] = async (args: any) => {
    ensureArgsUnlocked(args ?? {});
    return await original(args);
  };
}

// Clear scene preserves locked objects by default. Explicit allowLocked=true can
// still clear everything deliberately.
const clearSceneOriginal = api.clearScene;
if (typeof clearSceneOriginal === "function") {
  api.clearScene = async (args: any = {}) => {
    if (args.allowLocked === true) return await clearSceneOriginal(args);
    const lockedIds: string[] = [];
    for (const root of editor.getSceneRoots()) {
      root.traverse((node) => {
        const meta = getMeta(node);
        if (meta && locked(node)) lockedIds.push(meta.id);
      });
    }
    return await clearSceneOriginal({ ...args, except: [...new Set([...(args.except ?? []), ...lockedIds])] });
  };
}

setStatus("TinkerMatt v0.8.4 · lock endurecido en editor + MCP legado.");
