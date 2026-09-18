import * as THREE from "three";
import "./v050.css";
import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";
import { openSketchEditor } from "./sketch-editor";
import {
  createAdvancedPrimitive,
  createSketchObject,
  replaceSketchGeometry,
  type AdvancedPrimitiveKind,
  type SketchData,
  type SketchOperation,
} from "./v050-geometry";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, unknown>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.0 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.0";

const library = document.querySelector<HTMLElement>(".library-panel");
const outliner = document.querySelector<HTMLElement>("#outliner-tree");
const status = document.querySelector<HTMLElement>("#status");

function setStatus(text: string) {
  if (status) status.textContent = text;
}

function emitChanged() {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}

// -----------------------------------------------------------------------------
// Compact Photoshop-style tool families.
// -----------------------------------------------------------------------------
type ToolChoice<T extends string> = {
  id: T;
  label: string;
  icon: string;
  action: () => void | Promise<void>;
};

const shapeIcons: Record<AdvancedPrimitiveKind, string> = {
  cone: `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="35" rx="13" ry="5" fill="#713b8a"/><path d="M11 35 24 8 37 35Z" fill="#8b4ca6"/><path d="M24 8 37 35 24 31Z" fill="#5a2e71"/></svg>`,
  pyramid: `<svg viewBox="0 0 48 48"><path d="M24 7 40 34 24 40 8 34Z" fill="#f2c20f"/><path d="M24 7 24 40 8 34Z" fill="#d9a900"/><path d="M24 7 40 34 24 31Z" fill="#ffd72a"/></svg>`,
  roof: `<svg viewBox="0 0 48 48"><path d="M8 34 19 14 40 22 30 40Z" fill="#42a84d"/><path d="M19 14 31 9 40 22Z" fill="#31883b"/><path d="M30 40 40 22 31 9 31 31Z" fill="#23732e"/></svg>`,
  wedge: `<svg viewBox="0 0 48 48"><path d="M8 34 37 38 37 16Z" fill="#2f4c93"/><path d="M8 34 37 16 17 12Z" fill="#4865ad"/><path d="M37 16 37 38 42 33 42 21Z" fill="#203b78"/></svg>`,
  halfCylinder: `<svg viewBox="0 0 48 48"><path d="M8 34V26C8 15 16 9 26 9s14 6 14 17v8Z" fill="#65c1cf"/><path d="M8 34 40 34 34 39 13 39Z" fill="#408f9e"/><path d="M26 9c8 0 14 6 14 17H26Z" fill="#4aa6b5"/></svg>`,
  dome: `<svg viewBox="0 0 48 48"><ellipse cx="24" cy="35" rx="15" ry="5" fill="#a50069"/><path d="M9 35a15 15 0 0 1 30 0Z" fill="#d60088"/></svg>`,
  torus: `<svg viewBox="0 0 48 48"><ellipse cx="24" cy="26" rx="17" ry="11" fill="#0389bb"/><ellipse cx="24" cy="25" rx="9" ry="5" fill="#f8fbfc"/><path d="M8 27c2 8 9 12 16 12s14-4 16-12c-4 5-10 7-16 7S12 32 8 27Z" fill="#066d94" opacity=".65"/></svg>`,
  washer: `<svg viewBox="0 0 48 48"><ellipse cx="24" cy="26" rx="17" ry="11" fill="#d47b1e"/><ellipse cx="24" cy="25" rx="8" ry="4" fill="#6d3a12"/><path d="M8 27c2 8 9 12 16 12s14-4 16-12c-4 5-10 7-16 7S12 32 8 27Z" fill="#9e5815" opacity=".7"/></svg>`,
  prism: `<svg viewBox="0 0 48 48"><path d="M10 13 29 8 39 16 37 37 18 41 9 34Z" fill="#2e4f92"/><path d="M29 8 39 16 37 37 29 31Z" fill="#1f3a72"/><path d="M10 13 29 8 29 31 18 41 9 34Z" fill="#3b5da3"/></svg>`,
  polyhedron: `<svg viewBox="0 0 48 48"><path d="m24 6 14 9 5 16-12 11-17-3L6 25 12 11Z" fill="#dd2436"/><path d="m24 6 2 16 12-7Z" fill="#f05262"/><path d="m26 22 17 9-12 11Z" fill="#b81728"/><path d="m6 25 20-3-12 17Z" fill="#ca1b2c"/></svg>`,
};

const sketchIcons = {
  extrude: `<svg viewBox="0 0 48 48"><path d="M10 31 24 23 38 31 24 39Z" fill="#bfe8f5" stroke="#197da2"/><path d="M10 31V19L24 11l14 8v12l-14 8-14-8Z" fill="none" stroke="#197da2" stroke-width="2"/><path d="M24 23V11" stroke="#197da2" stroke-width="2"/><path d="m20 15 4-4 4 4" fill="none" stroke="#197da2" stroke-width="2"/></svg>`,
  revolve: `<svg viewBox="0 0 48 48"><path d="M17 37c0-12 5-20 11-25 0 9 3 15 8 21-6 4-12 5-19 4Z" fill="#bfe8f5" stroke="#197da2" stroke-width="1.5"/><path d="M24 7v34" stroke="#6d8794" stroke-dasharray="2 2"/><path d="M12 16c5-7 17-10 26-4" fill="none" stroke="#197da2" stroke-width="2.2"/><path d="m35 8 4 4-6 1" fill="#197da2"/></svg>`,
};

function createFamily<T extends string>(title: string, choices: ToolChoice<T>[]) {
  if (!library || !choices.length) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "tm-v050-family";
  const parent = document.createElement("button");
  parent.type = "button";
  parent.className = "tm-v050-parent";
  parent.title = title;
  const corner = `<span class="tm-v050-corner">◢</span>`;
  let active = choices[0];
  const renderParent = () => {
    parent.innerHTML = `${active.icon}${corner}`;
    parent.title = active.label;
  };
  renderParent();
  wrapper.append(parent);
  library.append(wrapper);

  const flyout = document.createElement("div");
  flyout.className = "tm-v050-flyout hidden";
  document.body.append(flyout);

  const close = () => flyout.classList.add("hidden");
  const open = () => {
    flyout.replaceChildren();
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tm-v050-choice";
      button.title = choice.label;
      button.innerHTML = `${choice.icon}<span>${choice.label}</span>`;
      button.addEventListener("click", () => {
        active = choice;
        renderParent();
        close();
        void choice.action();
      });
      flyout.append(button);
    }
    const rect = parent.getBoundingClientRect();
    flyout.style.left = `${rect.right + 6}px`;
    flyout.style.top = `${Math.max(8, Math.min(innerHeight - 86, rect.top))}px`;
    flyout.classList.remove("hidden");
  };

  let timer = 0;
  let longPress = false;
  parent.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    longPress = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      longPress = true;
      open();
    }, 430);
  });
  parent.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    clearTimeout(timer);
    if (!longPress) void active.action();
  });
  parent.addEventListener("pointercancel", () => clearTimeout(timer));
  document.addEventListener("pointerdown", (event) => {
    if (flyout.classList.contains("hidden")) return;
    const target = event.target as Node;
    if (!flyout.contains(target) && !parent.contains(target)) close();
  });
  return wrapper;
}

const advancedChoices: ToolChoice<AdvancedPrimitiveKind>[] = ([
  ["cone", "Cono"],
  ["pyramid", "Pirámide"],
  ["roof", "Techo"],
  ["wedge", "Cuña"],
  ["halfCylinder", "Bóveda"],
  ["dome", "Cúpula"],
  ["torus", "Toro"],
  ["washer", "Anillo"],
  ["prism", "Prisma"],
  ["polyhedron", "Poliedro"],
] as const).map(([id, label]) => ({
  id,
  label,
  icon: shapeIcons[id],
  action: () => {
    const object = createAdvancedPrimitive(id);
    editor.addObject(object);
    setStatus(`${label} creado.`);
  },
}));

createFamily("Más formas", advancedChoices);

async function newSketch(mode: "extrude" | "revolve") {
  const operation: SketchOperation = mode === "extrude"
    ? { mode, depth: 10 }
    : { mode, angle: 360, segments: 64 };
  const result = await openSketchEditor(undefined, operation);
  if (!result) return;
  try {
    const object = createSketchObject(result.data, result.operation);
    editor.addObject(object);
    setStatus(result.operation.mode === "extrude" ? "Sketch extruido." : "Revolve creado.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

createFamily("Sketch", [
  { id: "extrude", label: "Sketch → Extrude", icon: sketchIcons.extrude, action: () => newSketch("extrude") },
  { id: "revolve", label: "Sketch → Revolve", icon: sketchIcons.revolve, action: () => newSketch("revolve") },
]);

// -----------------------------------------------------------------------------
// Editable sketch feature rows in the Blender-like outliner.
// -----------------------------------------------------------------------------
function operationFromMeta(object: THREE.Object3D): SketchOperation | null {
  const params = getMeta(object)?.params;
  if (!params) return null;
  if (params.featureType === "extrude") return { mode: "extrude", depth: Number(params.depth) || 10 };
  if (params.featureType === "revolve") {
    return { mode: "revolve", angle: Number(params.angle) || 360, segments: Number(params.segments) || 64 };
  }
  return null;
}

function sketchFromMeta(object: THREE.Object3D): SketchData | null {
  const raw = getMeta(object)?.params?.sketchJson;
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw) as SketchData; } catch { return null; }
}

async function editSketch(object: THREE.Object3D) {
  if (!(object instanceof THREE.Mesh)) return;
  const data = sketchFromMeta(object);
  const operation = operationFromMeta(object);
  if (!data || !operation) return;
  const result = await openSketchEditor(data, operation);
  if (!result) return;
  editor.checkpoint();
  try {
    replaceSketchGeometry(object, result.data, result.operation);
    emitChanged();
    editor.setSelection([object]);
    setStatus("Sketch actualizado y sólido regenerado.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function decorateSketchFeatures() {
  if (!outliner) return;
  outliner.querySelectorAll(".tm-sketch-feature-row").forEach((row) => row.remove());
  for (const object of editor.getSceneRoots()) {
    const meta = getMeta(object);
    if (!meta || (meta.kind !== "sketchExtrude" && meta.kind !== "revolve")) continue;
    const objectRow = outliner.querySelector<HTMLElement>(`[data-id="${CSS.escape(meta.id)}"]`);
    if (!objectRow) continue;
    const row = document.createElement("div");
    row.className = "outliner-row tm-sketch-feature-row";
    row.style.paddingLeft = "22px";
    row.innerHTML = `<span class="outliner-kind">⌁</span><span class="outliner-name">Sketch</span><span></span>`;
    row.title = "Doble click para editar el perfil Bézier";
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      editor.setSelection([object]);
      setStatus("Sketch seleccionado · doble click para editar.");
    });
    row.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      void editSketch(object);
    });
    objectRow.insertAdjacentElement("afterend", row);
  }
}

let decorateQueued = false;
function queueDecoration() {
  if (decorateQueued) return;
  decorateQueued = true;
  queueMicrotask(() => {
    decorateQueued = false;
    decorateSketchFeatures();
  });
}
editor.on("changed", queueDecoration);
editor.on("selection", queueDecoration);
queueDecoration();

// -----------------------------------------------------------------------------
// Semantic API groundwork for the future MCP.
// -----------------------------------------------------------------------------
window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  createAdvancedPrimitive: (kind: AdvancedPrimitiveKind) => editor.addObject(createAdvancedPrimitive(kind)),
  openSketchExtrude: () => newSketch("extrude"),
  openSketchRevolve: () => newSketch("revolve"),
});

setStatus("TinkerMatt v0.5.0 · nuevas primitivas + Sketch / Extrude / Revolve.");
