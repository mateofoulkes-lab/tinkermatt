import * as THREE from "three";
import "./v066.css";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
  }
}

type Axis = "x" | "y" | "z";
type RotationState = {
  object: THREE.Object3D;
  rotation: THREE.Euler;
};
type RotationDrag = {
  pointerId: number;
  axis: Axis;
  centerWorld: THREE.Vector3;
  centerScreen: { x: number; y: number };
  startAngle: number;
  states: RotationState[];
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.6 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const version = document.querySelector<HTMLElement>(".version");
const status = document.querySelector<HTMLElement>("#status");
if (version) version.textContent = "v0.6.6";
const setStatus = (text: string) => { if (status) status.textContent = text; };

function project(world: THREE.Vector3) {
  const rect = viewport.getBoundingClientRect();
  const point = world.clone().project(editor.camera);
  return {
    x: (point.x * 0.5 + 0.5) * rect.width,
    y: (-point.y * 0.5 + 0.5) * rect.height,
  };
}

function polarLine(angleDeg: number, r1: number, r2: number, className: string) {
  const angle = THREE.MathUtils.degToRad(angleDeg - 90);
  const cx = 170;
  const cy = 170;
  const x1 = cx + Math.cos(angle) * r1;
  const y1 = cy + Math.sin(angle) * r1;
  const x2 = cx + Math.cos(angle) * r2;
  const y2 = cy + Math.sin(angle) * r2;
  return `<line class="${className}" x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}"/>`;
}

const middleTicks = Array.from({ length: 360 }, (_, index) => {
  const major = index % 10 === 0;
  return polarLine(index, major ? 116 : 120, 126, `tm-v066-mid-tick${major ? " major" : ""}`);
}).join("");
const innerTicks = Array.from({ length: 8 }, (_, index) => polarLine(index * 45, 25, 70, "tm-v066-inner-tick")).join("");

const guide = document.createElement("div");
guide.className = "tm-rotation-guide-v066 hidden";
guide.dataset.zone = "outer";
guide.innerHTML = `
  <svg viewBox="0 0 340 340" aria-hidden="true">
    <circle class="tm-v066-band tm-v066-outer-band" cx="170" cy="170" r="148" fill="none"/>
    <circle class="tm-v066-band tm-v066-mid-band" cx="170" cy="170" r="101" fill="none"/>
    <circle class="tm-v066-band tm-v066-inner-band" cx="170" cy="170" r="48" fill="none"/>
    <circle class="tm-v066-boundary outer" cx="170" cy="170" r="166"/>
    <circle class="tm-v066-boundary outer" cx="170" cy="170" r="130"/>
    <circle class="tm-v066-boundary mid" cx="170" cy="170" r="126"/>
    <circle class="tm-v066-boundary mid" cx="170" cy="170" r="76"/>
    <circle class="tm-v066-boundary inner" cx="170" cy="170" r="71"/>
    <circle class="tm-v066-boundary inner" cx="170" cy="170" r="24"/>
    ${middleTicks}
    ${innerTicks}
  </svg>
  <div class="tm-v066-angle-badge">0.0° · libre</div>
`;
viewport.append(guide);
const angleBadge = guide.querySelector<HTMLElement>(".tm-v066-angle-badge")!;

function rotationAxisFor(target: EventTarget | null): Axis | null {
  const handle = (target as HTMLElement | null)?.closest<HTMLElement>(".tm-rotate-handle");
  if (!handle) return null;
  if (handle.classList.contains("tm-rotate-x")) return "x";
  if (handle.classList.contains("tm-rotate-y")) return "y";
  if (handle.classList.contains("tm-rotate-z")) return "z";
  return null;
}

function normalizeDegrees(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function snap(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}

function zoneFor(radius: number): { zone: "inner" | "mid" | "outer"; snapDeg: number; label: string } {
  if (radius <= 72) return { zone: "inner", snapDeg: 45, label: "45°" };
  if (radius <= 127) return { zone: "mid", snapDeg: 1, label: "1°" };
  return { zone: "outer", snapDeg: 0, label: "libre" };
}

let rotationDrag: RotationDrag | null = null;

// Own the rotation gesture at capture phase. The visible 3D arrows proxy their
// pointerdown into the historical DOM handles; intercepting that proxy here keeps
// the old v0.4 drag engine from competing with this one.
window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || rotationDrag) return;
  const axis = rotationAxisFor(event.target);
  if (!axis) return;
  const active = editor.activeObject();
  const selection = editor.getSelection();
  if (!active || !selection.length) return;

  active.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(active);
  if (box.isEmpty()) return;
  const centerWorld = box.getCenter(new THREE.Vector3());
  const centerScreen = project(centerWorld);
  const rect = viewport.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;

  editor.checkpoint();
  rotationDrag = {
    pointerId: event.pointerId,
    axis,
    centerWorld,
    centerScreen,
    startAngle: Math.atan2(localY - centerScreen.y, localX - centerScreen.x),
    states: selection.map((object) => ({ object, rotation: object.rotation.clone() })),
  };

  guide.style.left = `${centerScreen.x}px`;
  guide.style.top = `${centerScreen.y}px`;
  guide.classList.remove("hidden");
  const initialRadius = Math.hypot(localX - centerScreen.x, localY - centerScreen.y);
  const zone = zoneFor(initialRadius);
  guide.dataset.zone = zone.zone;
  const currentDeg = THREE.MathUtils.radToDeg((active.rotation as any)[axis]);
  angleBadge.textContent = `${axis.toUpperCase()} ${currentDeg.toFixed(1)}° · ${zone.label}`;
  setStatus(`Rotar ${axis.toUpperCase()} · exterior libre · medio 1° · interior 45°`);

  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener("pointermove", (event) => {
  const drag = rotationDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const rect = viewport.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const angle = Math.atan2(localY - drag.centerScreen.y, localX - drag.centerScreen.x);
  let deltaDeg = normalizeDegrees(THREE.MathUtils.radToDeg(angle - drag.startAngle));
  const radius = Math.hypot(localX - drag.centerScreen.x, localY - drag.centerScreen.y);
  const zone = zoneFor(radius);
  if (zone.snapDeg) deltaDeg = snap(deltaDeg, zone.snapDeg);
  const deltaRad = THREE.MathUtils.degToRad(deltaDeg);

  for (const state of drag.states) {
    state.object.rotation.copy(state.rotation);
    (state.object.rotation as any)[drag.axis] += deltaRad;
    state.object.updateMatrixWorld(true);
  }

  const active = editor.activeObject();
  const currentDeg = active ? THREE.MathUtils.radToDeg((active.rotation as any)[drag.axis]) : deltaDeg;
  guide.dataset.zone = zone.zone;
  angleBadge.textContent = `${drag.axis.toUpperCase()} ${currentDeg.toFixed(1)}° · ${zone.label}`;
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function finishRotation(event: PointerEvent, cancel: boolean) {
  const drag = rotationDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  rotationDrag = null;
  if (cancel) {
    for (const state of drag.states) state.object.rotation.copy(state.rotation);
  }
  guide.classList.add("hidden");
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(cancel ? "Rotación cancelada." : "Rotación confirmada.");
  event.preventDefault();
  event.stopImmediatePropagation();
}
window.addEventListener("pointerup", (event) => finishRotation(event, false), true);
window.addEventListener("pointercancel", (event) => {
  // Ignore the synthetic cancel used by primitive dragging; it is unrelated to
  // an active rotation and, when rotation is active, the browser supplies a
  // trusted pointercancel for a genuine cancellation.
  if (!event.isTrusted) return;
  finishRotation(event, true);
}, true);

setStatus("TinkerMatt v0.6.6 · guía de rotación visible + drag de primitivas corregido.");
