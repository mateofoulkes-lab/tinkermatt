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
// exact tools must obey lock too. While wrapping them, normalize their old bridge
// argument shape into the current MCP action shape so repeat_last_action works
// regardless of which TinkerMatt generation originally provided the tool.
// -----------------------------------------------------------------------------
const api = window.tinkerMatt;
const remember = (action: string, args: any) => api.__rememberOperation?.({ action, args });

function canonicalArgs(name: string, args: any) {
  if (["createBox", "createCylinder", "createSphere"].includes(name)) return {
    name: args?.name,
    mode: args?.mode,
    x: args?.size?.x, y: args?.size?.y, z: args?.size?.z,
    posX: args?.position?.x, posY: args?.position?.y, posZ: args?.position?.z,
  };
  if (name === "createText") return {
    text: args?.text, name: args?.name, height: args?.height, depth: args?.depth, mode: args?.mode,
    posX: args?.position?.x, posY: args?.position?.y, posZ: args?.position?.z,
    rotX: args?.rotationDegrees?.x, rotY: args?.rotationDegrees?.y, rotZ: args?.rotationDegrees?.z,
  };
  if (name === "moveObject") return {
    object: args?.object,
    dx: args?.delta?.x, dy: args?.delta?.y, dz: args?.delta?.z,
    x: args?.position?.x, y: args?.position?.y, z: args?.position?.z,
    allowLocked: args?.allowLocked,
  };
  if (name === "rotateObject") return {
    object: args?.object,
    dx: args?.deltaDegrees?.x, dy: args?.deltaDegrees?.y, dz: args?.deltaDegrees?.z,
    x: args?.rotationDegrees?.x, y: args?.rotationDegrees?.y, z: args?.rotationDegrees?.z,
    allowLocked: args?.allowLocked,
  };
  return structuredClone(args ?? {});
}

const actionForMethod: Record<string, string> = {
  createBox: "create_box",
  createCylinder: "create_cylinder",
  createSphere: "create_sphere",
  createText: "create_text",
  moveObject: "move_object",
  rotateObject: "rotate_object",
  setDimensions: "set_dimensions",
  setSolidMode: "set_solid_mode",
  unionObjects: "union_objects",
  deleteObjects: "delete_objects",
  deleteSelectedRemote: "delete_selected",
  duplicateObject: "duplicate_object",
  duplicateObjects: "duplicate_objects",
  arrayObject: "array_object",
  groupObjects: "group_objects",
  ungroupObjects: "ungroup_objects",
  renameObject: "rename_object",
};

const lockSensitive = new Set([
  "moveObject", "rotateObject", "setDimensions", "setSolidMode", "unionObjects",
  "deleteObjects", "groupObjects", "ungroupObjects", "renameObject",
]);

for (const name of Object.keys(actionForMethod)) {
  const original = api[name];
  if (typeof original !== "function") continue;
  api[name] = async (args: any) => {
    if (lockSensitive.has(name)) ensureArgsUnlocked(args ?? {});
    const result = await original(args);
    remember(actionForMethod[name], canonicalArgs(name, args));
    return result;
  };
}

// Clear scene preserves locked objects by default. Explicit allowLocked=true can
// still clear everything deliberately.
const clearSceneOriginal = api.clearScene;
if (typeof clearSceneOriginal === "function") {
  api.clearScene = async (args: any = {}) => {
    let effective = args;
    if (args.allowLocked !== true) {
      const lockedIds: string[] = [];
      for (const root of editor.getSceneRoots()) {
        root.traverse((node) => {
          const meta = getMeta(node);
          if (meta && locked(node)) lockedIds.push(meta.id);
        });
      }
      effective = { ...args, except: [...new Set([...(args.except ?? []), ...lockedIds])] };
    }
    const result = await clearSceneOriginal(effective);
    remember("clear_scene", args);
    return result;
  };
}

setStatus("TinkerMatt v0.8.4 · lock endurecido + repeat compatible con MCP legado.");
