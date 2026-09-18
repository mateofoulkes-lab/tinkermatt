import * as THREE from "three";
import { icon } from "@fortawesome/fontawesome-svg-core";
import { faArrowRotateRight, faPlus } from "@fortawesome/free-solid-svg-icons";
import { clonePreservingIds, getMeta, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, unknown>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.4 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.4";

// -----------------------------------------------------------------------------
// Box: Pasos = 1 must read as a real planar chamfer, not as a smoothed curve.
// RoundedBoxGeometry already gives us a single geometric strip for one step,
// but it ships custom interpolated normals that visually round that strip.
// Recompute normals on a non-indexed copy so every triangle uses its real plane.
// Coplanar triangles get the same normal, yielding one flat chamfer face.
// -----------------------------------------------------------------------------
let flatteningBox = false;
function enforceFlatOneStepBox() {
  if (flatteningBox) return;
  const object = editor.activeObject();
  if (!(object instanceof THREE.Mesh)) return;
  const meta = getMeta(object);
  if (meta?.kind !== "box" || Number(meta.params?.steps ?? 1) !== 1 || Number(meta.params?.radius ?? 0) <= 0) return;
  if (object.geometry.userData.tmFlatChamfer === true) return;

  flatteningBox = true;
  try {
    const previous = object.geometry;
    const flat = previous.index ? previous.toNonIndexed() : previous.clone();
    flat.computeVertexNormals();
    flat.computeBoundingBox();
    flat.computeBoundingSphere();
    flat.userData.tmFlatChamfer = true;
    object.geometry = flat;
    previous.dispose();
    rawEditor.refreshSelectionHelpers?.();
  } finally {
    flatteningBox = false;
  }
}
editor.on("selection", enforceFlatOneStepBox);
editor.on("changed", enforceFlatOneStepBox);
queueMicrotask(enforceFlatOneStepBox);

// -----------------------------------------------------------------------------
// Redo / Rehacer.
// Keep a forward stack beside the editor's existing undo snapshots.
// -----------------------------------------------------------------------------
type HistorySnapshot = { roots: THREE.Object3D[]; selectionIds: string[] };
const redoStack: HistorySnapshot[] = [];
const checkpointWithMacro = rawEditor.checkpoint.bind(editor);
rawEditor.checkpoint = (...args: unknown[]) => {
  redoStack.length = 0;
  return checkpointWithMacro(...args);
};

const originalUndo = editor.undo.bind(editor);
rawEditor.undo = () => {
  if ((rawEditor.history?.length ?? 0) > 0) {
    redoStack.push(rawEditor.snapshotHistory() as HistorySnapshot);
    if (redoStack.length > 60) redoStack.shift();
  }
  return originalUndo();
};

function restoreSnapshot(snapshot: HistorySnapshot, statusText: string) {
  rawEditor.restoringHistory = true;
  try {
    editor.setSelection([]);
    for (const root of editor.getSceneRoots()) root.removeFromParent();
    for (const saved of snapshot.roots) {
      const restored = clonePreservingIds(saved);
      rawEditor.prepareObject(restored);
      editor.scene.add(restored);
    }
    const selection = snapshot.selectionIds
      .map((id) => editor.findById(id))
      .filter((object): object is THREE.Object3D => Boolean(object));
    editor.setSelection(selection);
    rawEditor.emit?.("changed");
    rawEditor.emit?.("status", statusText);
  } finally {
    rawEditor.restoringHistory = false;
  }
}

rawEditor.redo = () => {
  const snapshot = redoStack.pop();
  if (!snapshot) {
    rawEditor.emit?.("status", "No hay nada para rehacer.");
    return;
  }
  const current = rawEditor.snapshotHistory() as HistorySnapshot;
  rawEditor.history.push(current);
  if (rawEditor.history.length > 60) rawEditor.history.shift();
  restoreSnapshot(snapshot, "Rehacer.");
};

const undoButton = document.querySelector<HTMLButtonElement>("#undo");
if (undoButton) {
  const redoButton = document.createElement("button");
  redoButton.type = "button";
  redoButton.id = "redo";
  redoButton.className = undoButton.className;
  redoButton.title = "Rehacer · Ctrl+Y / Ctrl+Shift+Z";
  redoButton.setAttribute("aria-label", "Rehacer");
  redoButton.innerHTML = icon(faArrowRotateRight).html.join("");
  undoButton.insertAdjacentElement("afterend", redoButton);
  redoButton.addEventListener("click", () => rawEditor.redo());
}

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
  if (typing) return;
  const redo = ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") ||
    ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z");
  if (!redo) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  rawEditor.redo();
}, true);

// -----------------------------------------------------------------------------
// Tinkercad-style boolean UI: + means group/union; holes subtract automatically.
// Keep explicit subtract/intersect in the semantic API, but remove visual clutter.
// -----------------------------------------------------------------------------
const unionButton = document.querySelector<HTMLButtonElement>("#bool-union");
if (unionButton) {
  unionButton.innerHTML = icon(faPlus).html.join("");
  unionButton.title = "Unir / agrupar (+). Los objetos Hueco se restan.";
  unionButton.setAttribute("aria-label", "Unir");
}
document.querySelector<HTMLElement>("#bool-subtract")?.remove();
document.querySelector<HTMLElement>("#bool-intersect")?.remove();

// -----------------------------------------------------------------------------
// Cylinder parameters: sides, bevel, bevel segments.
// Geometry is generated from a radial profile so Segmentos=1 is literally one
// straight diagonal between cap and wall; higher values approximate a quarter arc.
// -----------------------------------------------------------------------------
type CylinderValues = { sides: number; bevel: number; segments: number };
type CylinderParam = keyof CylinderValues;

const inspector = document.querySelector<HTMLElement>("#inspector");
const paletteTitle = inspector?.querySelector<HTMLElement>(".palette-title");
const cylinderSection = document.createElement("section");
cylinderSection.className = "tm-box-properties tm-cylinder-properties hidden";
cylinderSection.innerHTML = `
  <div class="tm-shape-properties-title">Propiedades del cilindro</div>
  <div class="tm-param-row" data-param="sides">
    <label>Lados</label>
    <div class="tm-param-control">
      <input class="tm-param-range" type="range" min="3" max="128" step="1" />
      <input class="tm-param-number" type="number" min="3" max="128" step="1" />
    </div>
  </div>
  <div class="tm-param-row" data-param="bevel">
    <label>Bisel</label>
    <div class="tm-param-control">
      <input class="tm-param-range" type="range" min="0" max="10" step="0.01" />
      <input class="tm-param-number" type="number" min="0" step="0.01" />
    </div>
  </div>
  <div class="tm-param-row" data-param="segments">
    <label>Segmentos</label>
    <div class="tm-param-control">
      <input class="tm-param-range" type="range" min="1" max="20" step="1" />
      <input class="tm-param-number" type="number" min="1" max="20" step="1" />
    </div>
  </div>
`;
if (inspector) {
  if (paletteTitle) inspector.insertBefore(cylinderSection, paletteTitle);
  else inspector.append(cylinderSection);
}

function activeCylinder(): THREE.Mesh | null {
  const object = editor.activeObject();
  return object instanceof THREE.Mesh && getMeta(object)?.kind === "cylinder" ? object : null;
}

function finite(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function currentCylinderValues(object: THREE.Mesh): CylinderValues {
  const params = getMeta(object)?.params ?? {};
  return {
    sides: Math.max(3, Math.min(128, Math.round(finite(params.sides, 48)))),
    bevel: Math.max(0, finite(params.bevel, 0)),
    segments: Math.max(1, Math.min(20, Math.round(finite(params.segments, 1)))),
  };
}

function makeCylinderGeometry(object: THREE.Mesh, values: CylinderValues) {
  const meta = getMeta(object)!;
  const params = meta.params ?? {};
  const radius = Math.max(0.01, finite(params.radius, 10));
  const height = Math.max(0.01, finite(params.height, 20));
  const maxBevel = Math.max(0, Math.min(radius, height / 2) - 0.0001);
  const bevel = Math.min(Math.max(0, values.bevel), maxBevel);
  const points: THREE.Vector2[] = [];

  if (bevel <= 0.0001) {
    points.push(new THREE.Vector2(0, -height / 2));
    points.push(new THREE.Vector2(radius, -height / 2));
    points.push(new THREE.Vector2(radius, height / 2));
    points.push(new THREE.Vector2(0, height / 2));
  } else {
    points.push(new THREE.Vector2(0, -height / 2));
    const bottomCenter = new THREE.Vector2(radius - bevel, -height / 2 + bevel);
    for (let i = 0; i <= values.segments; i += 1) {
      const t = i / values.segments;
      const angle = -Math.PI / 2 + t * Math.PI / 2;
      points.push(new THREE.Vector2(
        bottomCenter.x + Math.cos(angle) * bevel,
        bottomCenter.y + Math.sin(angle) * bevel,
      ));
    }
    const topCenter = new THREE.Vector2(radius - bevel, height / 2 - bevel);
    for (let i = 0; i <= values.segments; i += 1) {
      const t = i / values.segments;
      const angle = t * Math.PI / 2;
      points.push(new THREE.Vector2(
        topCenter.x + Math.cos(angle) * bevel,
        topCenter.y + Math.sin(angle) * bevel,
      ));
    }
    points.push(new THREE.Vector2(0, height / 2));
  }

  let geometry: THREE.BufferGeometry = new THREE.LatheGeometry(points, values.sides, 0, Math.PI * 2);
  geometry.rotateX(Math.PI / 2);
  if (bevel > 0.0001 && values.segments === 1) {
    geometry = geometry.toNonIndexed();
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, bevel };
}

function rebuildCylinder(object: THREE.Mesh, next: CylinderValues) {
  const meta = getMeta(object);
  if (!meta) return;
  next.sides = Math.max(3, Math.min(128, Math.round(next.sides)));
  next.segments = Math.max(1, Math.min(20, Math.round(next.segments)));
  const { geometry, bevel } = makeCylinderGeometry(object, next);
  object.geometry.dispose();
  object.geometry = geometry;
  meta.params = { ...(meta.params ?? {}), sides: next.sides, bevel, segments: next.segments };
  setMeta(object, meta);
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}

const cylinderRows = new Map<CylinderParam, { range: HTMLInputElement; number: HTMLInputElement }>();
for (const row of cylinderSection.querySelectorAll<HTMLElement>(".tm-param-row")) {
  const name = row.dataset.param as CylinderParam;
  cylinderRows.set(name, {
    range: row.querySelector<HTMLInputElement>(".tm-param-range")!,
    number: row.querySelector<HTMLInputElement>(".tm-param-number")!,
  });
}

let cylinderEditing = false;
function refreshCylinder() {
  const object = activeCylinder();
  cylinderSection.classList.toggle("hidden", !object);
  if (!object) return;
  const values = currentCylinderValues(object);
  const meta = getMeta(object)!;
  const radius = Math.max(0.01, finite(meta.params?.radius, 10));
  const height = Math.max(0.01, finite(meta.params?.height, 20));
  const maxBevel = Math.max(0, Math.min(radius, height / 2));
  const bevelControls = cylinderRows.get("bevel")!;
  bevelControls.range.max = String(maxBevel);
  bevelControls.number.max = String(maxBevel);
  for (const [name, value] of Object.entries(values) as Array<[CylinderParam, number]>) {
    const controls = cylinderRows.get(name)!;
    const text = name === "bevel" ? Number(value.toFixed(2)).toString() : String(Math.round(value));
    if (document.activeElement !== controls.range) controls.range.value = String(value);
    if (document.activeElement !== controls.number) controls.number.value = text;
  }
}

for (const [name, controls] of cylinderRows) {
  const apply = (source: HTMLInputElement) => {
    const object = activeCylinder();
    if (!object) return;
    const raw = Number(source.value);
    if (!Number.isFinite(raw)) return;
    const next = currentCylinderValues(object);
    if (name === "bevel") next.bevel = Math.max(0, raw);
    else next[name] = Math.round(raw) as never;
    if (!cylinderEditing) {
      editor.checkpoint();
      cylinderEditing = true;
    }
    rebuildCylinder(object, next);
    const other = source === controls.range ? controls.number : controls.range;
    other.value = name === "bevel" ? Number(raw.toFixed(2)).toString() : String(Math.round(raw));
  };
  controls.range.addEventListener("pointerdown", () => { cylinderEditing = false; });
  controls.number.addEventListener("focus", () => { cylinderEditing = false; });
  controls.range.addEventListener("input", () => apply(controls.range));
  controls.number.addEventListener("input", () => apply(controls.number));
  controls.range.addEventListener("change", () => { cylinderEditing = false; });
  controls.number.addEventListener("change", () => { cylinderEditing = false; });
}

editor.on("selection", () => {
  refreshCylinder();
  enforceFlatOneStepBox();
});
editor.on("changed", () => {
  if (!cylinderEditing) refreshCylinder();
});
refreshCylinder();

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  redo: () => rawEditor.redo(),
  setCylinderParameters: (parameters: Partial<CylinderValues>) => {
    const object = activeCylinder();
    if (!object) throw new Error("Seleccioná un cilindro.");
    const values = { ...currentCylinderValues(object), ...parameters };
    editor.checkpoint();
    rebuildCylinder(object, values);
    refreshCylinder();
    return getMeta(object);
  },
  getCylinderParameters: () => {
    const object = activeCylinder();
    return object ? currentCylinderValues(object) : null;
  },
});

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.5.4 · chaflán plano real + rehacer + cilindro paramétrico.";
