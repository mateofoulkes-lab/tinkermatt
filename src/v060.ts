import * as THREE from "three";
import { icon } from "@fortawesome/fontawesome-svg-core";
import { faArrowDown, faArrowRotateLeft } from "@fortawesome/free-solid-svg-icons";
import "./v060.css";
import { getMeta, setMeta } from "./model";
import type { TinkerEditor } from "./editor";
import { buildPrimitiveGeometry, type PrimitiveValues } from "./v059-geometry";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type RotationState = {
  axis: Axis;
  pivot: { x: number; y: number };
  startAngle: number;
  states: Array<{ object: THREE.Object3D; rotation: THREE.Euler }>;
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.0 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.0";
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };
const viewport = document.querySelector<HTMLElement>("#viewport")!;

// -----------------------------------------------------------------------------
// Parametric slider stability.
// v0.5.9 rebuilt the inspector after every geometry update because rebuilds also
// emitted a selection event. Replacing an <input type=range> while the browser is
// dragging it releases pointer capture, so the thumb jumped and stopped following
// the mouse. Suppress that redundant selection refresh only during a live edit.
// -----------------------------------------------------------------------------
const originalEmit = rawEditor.emit.bind(editor);
let primitiveEditActive = false;
let primitiveRangeDragging = false;

rawEditor.emit = (name: string, ...args: any[]) => {
  if (name === "selection" && primitiveEditActive) return;
  return originalEmit(name, ...args);
};

function primitivePanel() {
  return document.querySelector<HTMLElement>(".tm-primitive-properties");
}

document.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement | null;
  if (!(target instanceof HTMLInputElement) || target.type !== "range" || !target.closest(".tm-primitive-properties")) return;
  primitiveRangeDragging = true;
  primitiveEditActive = true;
}, true);

window.addEventListener("pointerup", () => {
  if (!primitiveRangeDragging) return;
  primitiveRangeDragging = false;
  primitiveEditActive = false;
  queueMicrotask(tunePrimitiveRanges);
}, true);
window.addEventListener("pointercancel", () => {
  primitiveRangeDragging = false;
  primitiveEditActive = false;
}, true);

document.addEventListener("focusin", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".tm-primitive-properties") && target instanceof HTMLInputElement) primitiveEditActive = true;
}, true);
document.addEventListener("focusout", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".tm-primitive-properties")) return;
  queueMicrotask(() => {
    primitiveEditActive = primitiveRangeDragging || Boolean(document.activeElement?.closest?.(".tm-primitive-properties"));
    if (!primitiveEditActive) tunePrimitiveRanges();
  });
}, true);

function activePrimitiveParameters() {
  try {
    return window.tinkerMatt.getPrimitiveParameters?.() as ({ kind: string } & PrimitiveValues) | null;
  } catch {
    return null;
  }
}

function usefulRangeMax(key: string, value: number, params: ({ kind: string } & PrimitiveValues)) {
  if (key === "radius") return Math.max(0.01, Math.min(Number(params.length), Number(params.width), Number(params.height)) / 2);
  if (key === "bevel") return Math.max(0.01, Math.min(Number(params.diameter) / 2, Number(params.height) / 2));
  if (key === "innerDiameter" || key === "tubeDiameter") return Math.max(0.01, Number(params.outerDiameter) - 0.01);
  const counts = new Set(["steps", "sides", "segments", "rings", "bevelSegments", "radialSegments", "tubularSegments", "detail"]);
  if (counts.has(key)) return null;
  // Dimensions should have useful mouse resolution around the current part, while
  // the number field remains available for arbitrarily large exact values.
  return Math.max(50, Math.ceil(Math.max(1, Math.abs(value)) * 3));
}

function tunePrimitiveRanges() {
  if (primitiveEditActive) return;
  const panel = primitivePanel();
  const params = activePrimitiveParameters();
  if (!panel || !params) return;
  for (const row of panel.querySelectorAll<HTMLElement>(".tm-param-row[data-param]")) {
    const key = row.dataset.param ?? "";
    const range = row.querySelector<HTMLInputElement>('input[type="range"]');
    const number = row.querySelector<HTMLInputElement>('input[type="number"]');
    if (!range) continue;
    const value = Number(params[key] ?? range.value);
    const max = usefulRangeMax(key, value, params);
    if (max !== null && Number.isFinite(max)) range.max = String(Math.max(max, value));
    // Keep the exact number input permissive. The model itself performs physical
    // clamping where necessary (e.g. bevel cannot exceed half the smallest side).
    if (number && max !== null && ["radius", "bevel", "innerDiameter", "tubeDiameter"].includes(key)) number.max = String(max);
  }
}

editor.on("selection", () => queueMicrotask(tunePrimitiveRanges));
editor.on("changed", () => { if (!primitiveEditActive) queueMicrotask(tunePrimitiveRanges); });
queueMicrotask(tunePrimitiveRanges);

// -----------------------------------------------------------------------------
// "Anillo" means a hollow straight cylinder/tube. Legacy v0.5.0 created it as a
// second torus. Upgrade old/new legacy washers once without creating an undo step.
// -----------------------------------------------------------------------------
let upgradingWashers = false;
function upgradeLegacyWashers() {
  if (upgradingWashers) return;
  const targets: THREE.Mesh[] = [];
  for (const root of editor.getSceneRoots()) {
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && getMeta(node)?.kind === "washer" && Number(getMeta(node)?.params?.primitiveVersion ?? 0) < 2) targets.push(node);
    });
  }
  if (!targets.length) return;
  upgradingWashers = true;
  try {
    for (const object of targets) {
      const meta = getMeta(object)!;
      const info = window.tinkerMatt.getPrimitiveParameters?.(meta.id) as ({ kind: string } & PrimitiveValues) | null;
      if (!info) continue;
      const values = { ...info } as PrimitiveValues & { kind?: string };
      delete values.kind;
      object.geometry.computeBoundingBox();
      const oldMin = new THREE.Box3().setFromObject(object).min.z;
      const oldGeometry = object.geometry;
      object.geometry = buildPrimitiveGeometry("washer", values);
      object.scale.set(1, 1, 1);
      object.updateMatrixWorld(true);
      const newMin = new THREE.Box3().setFromObject(object).min.z;
      object.position.z += oldMin - newMin;
      oldGeometry.dispose();
      meta.params = { ...(meta.params ?? {}), ...values, primitiveVersion: 2 };
      setMeta(object, meta);
    }
    originalEmit("changed");
  } finally {
    upgradingWashers = false;
  }
}
editor.on("changed", upgradeLegacyWashers);
queueMicrotask(upgradeLegacyWashers);

// -----------------------------------------------------------------------------
// Restore the three-zone Tinkercad rotation band.
// Outer band = free rotation, middle band = 1 degree, inner band = 45 degrees.
// We intercept only an active rotation gesture; move/scale/camera remain untouched.
// -----------------------------------------------------------------------------
const ring = document.querySelector<HTMLElement>(".tm-rotation-ring");
const angleInput = ring?.querySelector<HTMLInputElement>(".tm-angle-input") ?? null;
let rotationState: RotationState | null = null;

function project(world: THREE.Vector3) {
  const rect = viewport.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height };
}

function beginRotation(axis: Axis, event: PointerEvent) {
  const active = editor.activeObject();
  if (!active) return;
  const box = new THREE.Box3().setFromObject(active);
  if (box.isEmpty()) return;
  const pivot = project(box.getCenter(new THREE.Vector3()));
  const rect = viewport.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  rotationState = {
    axis,
    pivot,
    startAngle: Math.atan2(py - pivot.y, px - pivot.x),
    states: editor.getSelection().map((object) => ({ object, rotation: object.rotation.clone() })),
  };
  if (ring) {
    ring.classList.remove("hidden");
    ring.style.left = `${pivot.x}px`;
    ring.style.top = `${pivot.y}px`;
    ring.dataset.zone = "outer";
  }
}

for (const axis of ["x", "y", "z"] as const) {
  document.querySelector<HTMLElement>(`.tm-rotate-${axis}`)?.addEventListener("pointerdown", (event) => beginRotation(axis, event));
}

function normalizedDegrees(value: number) {
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

window.addEventListener("pointermove", (event) => {
  const state = rotationState;
  if (!state) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const rect = viewport.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const angle = Math.atan2(py - state.pivot.y, px - state.pivot.x);
  let deltaDeg = normalizedDegrees(THREE.MathUtils.radToDeg(angle - state.startAngle));
  const radius = Math.hypot(px - state.pivot.x, py - state.pivot.y);
  const snap = radius < 72 ? 45 : radius < 125 ? 1 : 0;
  if (snap) deltaDeg = Math.round(deltaDeg / snap) * snap;
  if (ring) ring.dataset.zone = radius < 72 ? "inner" : radius < 125 ? "mid" : "outer";
  const delta = THREE.MathUtils.degToRad(deltaDeg);
  for (const item of state.states) {
    item.object.rotation.copy(item.rotation);
    item.object.rotation[state.axis] += delta;
  }
  if (angleInput) {
    const active = state.states[state.states.length - 1]?.object;
    if (active) angleInput.value = THREE.MathUtils.radToDeg(active.rotation[state.axis]).toFixed(1);
  }
  rawEditor.refreshSelectionHelpers?.();
  originalEmit("changed");
}, true);

const finishRotation = () => { rotationState = null; };
window.addEventListener("pointerup", finishRotation, true);
window.addEventListener("pointercancel", finishRotation, true);

// -----------------------------------------------------------------------------
// Inspector quick actions, above Posición: reset transform and drop to workplane.
// -----------------------------------------------------------------------------
const inspector = document.querySelector<HTMLElement>("#inspector");
const positionTitle = inspector ? [...inspector.querySelectorAll<HTMLElement>(".inspector-section-title")].find((node) => /posici[oó]n/i.test(node.textContent ?? "")) : null;

function emitTransformChanged(message: string) {
  rawEditor.refreshSelectionHelpers?.();
  originalEmit("changed");
  originalEmit("selection", editor.getSelection());
  setStatus(message);
}

function dropObjectsToFloor(objects = editor.getSelection()) {
  if (!objects.length) return false;
  for (const object of objects) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty() && Number.isFinite(box.min.z)) object.position.z -= box.min.z;
  }
  return true;
}

function dropSelectionToFloor() {
  const objects = editor.getSelection();
  if (!objects.length) return false;
  editor.checkpoint();
  dropObjectsToFloor(objects);
  emitTransformChanged("Al piso · el punto más bajo quedó en Z = 0.");
  return true;
}

function restoreSelectionTransform() {
  const objects = editor.getSelection();
  if (!objects.length) return false;
  editor.checkpoint();
  for (const object of objects) {
    object.position.set(0, 0, 0);
    object.rotation.set(0, 0, 0);
    object.scale.set(1, 1, 1);
  }
  dropObjectsToFloor(objects);
  emitTransformChanged("Transformación restaurada · posición/rotación/escala iniciales.");
  return true;
}

if (inspector && positionTitle && !inspector.querySelector(".tm-transform-quick-actions")) {
  const actions = document.createElement("div");
  actions.className = "tm-transform-quick-actions";
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "tm-transform-quick-button";
  restore.title = "Restaurar transformación · posición y rotación originales, escala 1:1";
  restore.setAttribute("aria-label", "Restaurar transformación");
  restore.innerHTML = icon(faArrowRotateLeft).html.join("");
  restore.addEventListener("click", restoreSelectionTransform);

  const floor = document.createElement("button");
  floor.type = "button";
  floor.className = "tm-transform-quick-button";
  floor.title = "Al piso · mover en Z hasta que el punto más bajo toque Z = 0";
  floor.setAttribute("aria-label", "Al piso");
  floor.innerHTML = icon(faArrowDown).html.join("");
  floor.addEventListener("click", dropSelectionToFloor);
  actions.append(restore, floor);
  inspector.insertBefore(actions, positionTitle);
}

Object.assign(window.tinkerMatt, {
  dropToFloor: (object?: string) => {
    if (!object) return dropSelectionToFloor();
    const target = editor.findById(object) ?? editor.getSceneRoots().find((item) => getMeta(item)?.name === object);
    if (!target) throw new Error(`No existe el objeto “${object}”.`);
    editor.checkpoint();
    dropObjectsToFloor([target]);
    emitTransformChanged(`“${getMeta(target)?.name ?? object}” llevado al piso.`);
    return true;
  },
  restoreTransform: (object?: string) => {
    if (!object) return restoreSelectionTransform();
    const target = editor.findById(object) ?? editor.getSceneRoots().find((item) => getMeta(item)?.name === object);
    if (!target) throw new Error(`No existe el objeto “${object}”.`);
    editor.checkpoint();
    target.position.set(0, 0, 0); target.rotation.set(0, 0, 0); target.scale.set(1, 1, 1);
    dropObjectsToFloor([target]);
    emitTransformChanged(`Transformación de “${getMeta(target)?.name ?? object}” restaurada.`);
    return true;
  },
});

setStatus("TinkerMatt v0.6.0 · sliders estables + bevel por aristas + anillo tubular + rotación por zonas.");
