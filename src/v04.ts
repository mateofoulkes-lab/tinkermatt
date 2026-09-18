import * as THREE from "three";
import { icon } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowRightLong,
  faArrowsUpDown,
  faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import "./v04.css";
import type { TinkerEditor } from "./editor";

type Axis = "x" | "y" | "z";
type Mode = "translate" | "rotate" | "scale";
type ManipulatorMode = "tinker" | "gizmo" | "both";

type ObjectState = {
  object: THREE.Object3D;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
};

type ModalState = {
  mode: Mode;
  axis: Axis | null;
  startPointer: { x: number; y: number };
  pivotWorld: THREE.Vector3;
  pivotScreen: { x: number; y: number };
  startAngle: number;
  states: ObjectState[];
};

type DragState = {
  kind: "scale" | "move" | "rotate";
  axis?: Axis;
  signs?: Partial<Record<Axis, -1 | 1>>;
  pointerId: number;
  startX: number;
  startY: number;
  startBox: THREE.Box3;
  startSize: THREE.Vector3;
  startCenter: THREE.Vector3;
  states: ObjectState[];
  startAngle?: number;
};

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.4 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const toolbar = document.querySelector<HTMLElement>(".toolbar-shell")!;
const status = document.querySelector<HTMLElement>("#status")!;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.4.0";

const project = (world: THREE.Vector3) => {
  const rect = viewport.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return {
    x: (p.x * 0.5 + 0.5) * rect.width,
    y: (-p.y * 0.5 + 0.5) * rect.height,
  };
};

const axisVector = (axis: Axis) =>
  axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

const captureSelection = (): ObjectState[] =>
  editor.getSelection().map((object) => ({
    object,
    position: object.position.clone(),
    rotation: object.rotation.clone(),
    scale: object.scale.clone(),
  }));

const notifyChanged = () => {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
};

const setStatus = (text: string) => {
  status.textContent = text;
};

const snapScalar = (value: number, step: number) => step > 0 ? Math.round(value / step) * step : value;

const screenAxis = (axis: Axis, origin: THREE.Vector3) => {
  const a = project(origin);
  const b = project(origin.clone().add(axisVector(axis)));
  return new THREE.Vector2(b.x - a.x, b.y - a.y);
};

const pointerScalarOnAxis = (dx: number, dy: number, axis: Axis, origin: THREE.Vector3) => {
  const v = screenAxis(axis, origin);
  const lenSq = v.lengthSq();
  if (lenSq < 0.0001) return 0;
  return (dx * v.x + dy * v.y) / lenSq;
};

const rayToHorizontalPlane = (clientX: number, clientY: number, z: number) => {
  const rect = editor.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, editor.camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
};

// --- Compact left library ----------------------------------------------------
for (const element of document.querySelectorAll<HTMLElement>(".library-item, .library-family > summary")) {
  if (!element.title) element.title = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

// --- Manipulator selector ----------------------------------------------------
const modeBox = document.createElement("label");
modeBox.className = "manipulator-mode-box";
modeBox.title = "Elegí el manipulador 3D";
modeBox.innerHTML = `<span>Widget</span><select aria-label="Manipulador"><option value="tinker">Tinker</option><option value="gizmo">Gizmo</option><option value="both">Ambos</option></select>`;
const modeSelect = modeBox.querySelector<HTMLSelectElement>("select")!;
const savedMode = localStorage.getItem("tinkermatt-manipulator") as ManipulatorMode | null;
modeSelect.value = savedMode && ["tinker", "gizmo", "both"].includes(savedMode) ? savedMode : "tinker";
const snapControls = toolbar.querySelector(".snap-controls");
if (snapControls) snapControls.insertAdjacentElement("afterend", modeBox);
else toolbar.append(modeBox);

// --- Tinker-style DOM widget -------------------------------------------------
const overlay = document.createElement("div");
overlay.className = "tm-manipulator";
viewport.append(overlay);

const makeHandle = (className: string, title: string) => {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.title = title;
  overlay.append(el);
  return el;
};

const cornerHandles = [
  { sx: -1 as const, sy: -1 as const },
  { sx: 1 as const, sy: -1 as const },
  { sx: -1 as const, sy: 1 as const },
  { sx: 1 as const, sy: 1 as const },
].map(({ sx, sy }) => {
  const el = makeHandle("tm-scale-handle tm-corner-handle", "Escalar X/Y · Shift uniforme · Alt desde el centro");
  el.dataset.sx = String(sx);
  el.dataset.sy = String(sy);
  return el;
});
const zScaleHandle = makeHandle("tm-scale-handle tm-z-handle", "Altura · Shift uniforme · Alt desde el centro");

const dimInputs = {
  x: document.createElement("input"),
  y: document.createElement("input"),
  z: document.createElement("input"),
};
for (const axis of ["x", "y", "z"] as const) {
  const input = dimInputs[axis];
  input.type = "number";
  input.step = "0.1";
  input.min = "0.01";
  input.className = `tm-measure tm-measure-${axis}`;
  input.title = `Medida ${axis.toUpperCase()} (mm)`;
  overlay.append(input);
  input.addEventListener("focus", () => editor.checkpoint());
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (Number.isFinite(value) && value > 0) editor.setActiveDimension(axis, value);
  });
}

const moveHandles = {
  x: makeHandle("tm-move-handle tm-move-x", "Mover en X"),
  y: makeHandle("tm-move-handle tm-move-y", "Mover en Y"),
  z: makeHandle("tm-move-handle tm-move-z", "Mover en Z"),
};
moveHandles.x.innerHTML = `${icon(faArrowRightLong).html.join("")}<b>X</b>`;
moveHandles.y.innerHTML = `${icon(faArrowRightLong).html.join("")}<b>Y</b>`;
moveHandles.z.innerHTML = `${icon(faArrowsUpDown).html.join("")}<b>Z</b>`;

const rotateHandles = {
  x: makeHandle("tm-rotate-handle tm-rotate-x", "Rotar X"),
  y: makeHandle("tm-rotate-handle tm-rotate-y", "Rotar Y"),
  z: makeHandle("tm-rotate-handle tm-rotate-z", "Rotar Z"),
};
for (const axis of ["x", "y", "z"] as const) {
  rotateHandles[axis].innerHTML = `${icon(faRotateRight).html.join("")}<b>${axis.toUpperCase()}</b>`;
}

const deltaBadge = document.createElement("div");
deltaBadge.className = "tm-delta-badge hidden";
overlay.append(deltaBadge);

const modalBadge = document.createElement("div");
modalBadge.className = "tm-modal-badge hidden";
viewport.append(modalBadge);

const ring = document.createElement("div");
ring.className = "tm-rotation-ring hidden";
ring.innerHTML = `<div class="tm-ring tm-ring-outer"></div><div class="tm-ring tm-ring-mid"></div><div class="tm-ring tm-ring-inner"></div><input class="tm-angle-input" type="number" step="1" value="0" />`;
viewport.append(ring);
const angleInput = ring.querySelector<HTMLInputElement>(".tm-angle-input")!;
let activeRotationAxis: Axis = "z";
angleInput.addEventListener("focus", () => editor.checkpoint());
angleInput.addEventListener("input", () => {
  const object = editor.activeObject();
  if (!object) return;
  const target = Number(angleInput.value);
  if (!Number.isFinite(target)) return;
  const current = THREE.MathUtils.radToDeg((object.rotation as any)[activeRotationAxis]);
  const delta = THREE.MathUtils.degToRad(target - current);
  for (const selected of editor.getSelection()) (selected.rotation as any)[activeRotationAxis] += delta;
  notifyChanged();
});

let manipulatorMode = modeSelect.value as ManipulatorMode;
const applyManipulatorMode = () => {
  manipulatorMode = modeSelect.value as ManipulatorMode;
  localStorage.setItem("tinkermatt-manipulator", manipulatorMode);
  const helper = editor.transform.getHelper();
  helper.visible = manipulatorMode !== "tinker";
  overlay.classList.toggle("widget-disabled", manipulatorMode === "gizmo");
};
modeSelect.addEventListener("change", applyManipulatorMode);
applyManipulatorMode();

const place = (el: HTMLElement, p: { x: number; y: number }) => {
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
};

const activeBounds = () => {
  const object = editor.activeObject();
  if (!object || !object.visible) return null;
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return { object, box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
};

function refreshTinkerWidget() {
  const info = activeBounds();
  const visible = Boolean(info) && manipulatorMode !== "gizmo";
  overlay.classList.toggle("hidden", !visible);
  if (!info || !visible) return;

  const { box, size, center } = info;
  const z = box.min.z;
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, z),
    new THREE.Vector3(box.max.x, box.min.y, z),
    new THREE.Vector3(box.min.x, box.max.y, z),
    new THREE.Vector3(box.max.x, box.max.y, z),
  ];
  cornerHandles.forEach((handle, i) => place(handle, project(corners[i])));
  place(zScaleHandle, project(new THREE.Vector3(center.x, center.y, box.max.z)));

  place(dimInputs.x, project(new THREE.Vector3(center.x, box.min.y, z)));
  place(dimInputs.y, project(new THREE.Vector3(box.max.x, center.y, z)));
  place(dimInputs.z, project(new THREE.Vector3(center.x, center.y, box.max.z)));
  if (document.activeElement !== dimInputs.x) dimInputs.x.value = size.x.toFixed(2);
  if (document.activeElement !== dimInputs.y) dimInputs.y.value = size.y.toFixed(2);
  if (document.activeElement !== dimInputs.z) dimInputs.z.value = size.z.toFixed(2);

  const c = project(center);
  place(moveHandles.x, { x: c.x + 48, y: c.y + 24 });
  place(moveHandles.y, { x: c.x - 50, y: c.y + 18 });
  place(moveHandles.z, { x: c.x + 8, y: c.y - 55 });
  place(rotateHandles.x, { x: c.x - 72, y: c.y - 55 });
  place(rotateHandles.y, { x: c.x + 65, y: c.y - 54 });
  place(rotateHandles.z, { x: c.x - 7, y: c.y - 83 });
}

requestAnimationFrame(function loop() {
  refreshTinkerWidget();
  requestAnimationFrame(loop);
});

let drag: DragState | null = null;

const startDrag = (kind: DragState["kind"], event: PointerEvent, extras: Partial<DragState> = {}) => {
  const info = activeBounds();
  if (!info) return;
  editor.checkpoint();
  drag = {
    kind,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startBox: info.box.clone(),
    startSize: info.size.clone(),
    startCenter: info.center.clone(),
    states: captureSelection(),
    ...extras,
  };
  deltaBadge.classList.remove("hidden");
  event.preventDefault();
  event.stopPropagation();
};

for (const handle of cornerHandles) {
  handle.addEventListener("pointerdown", (event) => startDrag("scale", event, {
    signs: { x: Number(handle.dataset.sx) as -1 | 1, y: Number(handle.dataset.sy) as -1 | 1 },
  }));
}
zScaleHandle.addEventListener("pointerdown", (event) => startDrag("scale", event, { signs: { z: 1 } }));
for (const axis of ["x", "y", "z"] as const) {
  moveHandles[axis].addEventListener("pointerdown", (event) => startDrag("move", event, { axis }));
  rotateHandles[axis].addEventListener("pointerdown", (event) => {
    activeRotationAxis = axis;
    const info = activeBounds();
    if (!info) return;
    const p = project(info.center);
    const a = Math.atan2(event.clientY - viewport.getBoundingClientRect().top - p.y, event.clientX - viewport.getBoundingClientRect().left - p.x);
    startDrag("rotate", event, { axis, startAngle: a });
    ring.classList.remove("hidden");
    ring.style.left = `${p.x}px`;
    ring.style.top = `${p.y}px`;
    const object = editor.activeObject();
    if (object) angleInput.value = THREE.MathUtils.radToDeg((object.rotation as any)[axis]).toFixed(1);
  });
}

window.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  const activeState = drag.states[drag.states.length - 1];
  if (!activeState) return;

  if (drag.kind === "move" && drag.axis) {
    let delta = pointerScalarOnAxis(dx, dy, drag.axis, drag.startCenter);
    const snap = editor.getSnap();
    const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const step = snap.enabled ? snap.gridSize * multiplier : 0;
    if (step) delta = snapScalar(delta, step);
    for (const state of drag.states) {
      state.object.position.copy(state.position);
      (state.object.position as any)[drag.axis] += delta;
    }
    deltaBadge.textContent = `${drag.axis.toUpperCase()} ${delta.toFixed(2)} mm`;
  } else if (drag.kind === "scale" && drag.signs) {
    const active = activeState.object;
    active.position.copy(activeState.position);
    active.scale.copy(activeState.scale);
    const uniform = event.shiftKey;
    const fromCenter = event.altKey;
    const changes: Partial<Record<Axis, number>> = {};
    for (const axis of Object.keys(drag.signs) as Axis[]) {
      const sign = drag.signs[axis]!;
      let scalar = pointerScalarOnAxis(dx, dy, axis, drag.startCenter);
      const snap = editor.getSnap();
      if (snap.enabled) scalar = snapScalar(scalar, snap.gridSize * (event.altKey ? 0.1 : 1));
      changes[axis] = scalar * sign;
    }

    if (uniform) {
      const firstAxis = (Object.keys(changes)[0] ?? "x") as Axis;
      const base = (drag.startSize as any)[firstAxis] || 1;
      const ratio = Math.max(0.01, (base + (changes[firstAxis] ?? 0)) / base);
      active.scale.set(activeState.scale.x * ratio, activeState.scale.y * ratio, activeState.scale.z * ratio);
      deltaBadge.textContent = `Escala ${(ratio * 100).toFixed(1)}%`;
    } else {
      for (const axis of Object.keys(changes) as Axis[]) {
        const baseSize = (drag.startSize as any)[axis] as number;
        const target = Math.max(0.01, baseSize + (changes[axis] ?? 0));
        const ratio = target / Math.max(0.0001, baseSize);
        (active.scale as any)[axis] = (activeState.scale as any)[axis] * ratio;
        if (!fromCenter) {
          const signedScreenMove = pointerScalarOnAxis(dx, dy, axis, drag.startCenter);
          (active.position as any)[axis] = (activeState.position as any)[axis] + signedScreenMove / 2;
        }
      }
      const now = editor.boundsOf(active);
      deltaBadge.textContent = `${now.x.toFixed(1)} × ${now.y.toFixed(1)} × ${now.z.toFixed(1)} mm`;
    }
  } else if (drag.kind === "rotate" && drag.axis) {
    const rect = viewport.getBoundingClientRect();
    const pivot = project(drag.startCenter);
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const angle = Math.atan2(py - pivot.y, px - pivot.x);
    let deltaDeg = THREE.MathUtils.radToDeg(angle - (drag.startAngle ?? 0));
    while (deltaDeg > 180) deltaDeg -= 360;
    while (deltaDeg < -180) deltaDeg += 360;
    const radius = Math.hypot(px - pivot.x, py - pivot.y);
    const snapDeg = radius < 72 ? 45 : radius < 125 ? 15 : 0;
    if (snapDeg) deltaDeg = snapScalar(deltaDeg, snapDeg);
    const deltaRad = THREE.MathUtils.degToRad(deltaDeg);
    for (const state of drag.states) {
      state.object.rotation.copy(state.rotation);
      (state.object.rotation as any)[drag.axis] += deltaRad;
    }
    const current = THREE.MathUtils.radToDeg((activeState.object.rotation as any)[drag.axis]);
    angleInput.value = current.toFixed(1);
    deltaBadge.textContent = `${drag.axis.toUpperCase()} ${current.toFixed(1)}°${snapDeg ? ` · snap ${snapDeg}°` : " · libre"}`;
  }
  notifyChanged();
}, true);

window.addEventListener("pointerup", () => {
  if (!drag) return;
  drag = null;
  deltaBadge.classList.add("hidden");
  ring.classList.add("hidden");
  notifyChanged();
}, true);

// --- Blender-style modal G / R / S ------------------------------------------
let lastPointer = { x: 0, y: 0 };
let modal: ModalState | null = null;
window.addEventListener("pointermove", (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
  if (modal) updateModal(event);
}, true);

function startModal(mode: Mode) {
  const info = activeBounds();
  if (!info || !editor.getSelection().length) return;
  editor.checkpoint();
  const p = project(info.center);
  const rect = viewport.getBoundingClientRect();
  const sx = lastPointer.x || rect.left + p.x;
  const sy = lastPointer.y || rect.top + p.y;
  modal = {
    mode,
    axis: null,
    startPointer: { x: sx, y: sy },
    pivotWorld: info.center.clone(),
    pivotScreen: p,
    startAngle: Math.atan2(sy - rect.top - p.y, sx - rect.left - p.x),
    states: captureSelection(),
  };
  editor.setTransformMode(mode);
  modalBadge.classList.remove("hidden");
  modalBadge.textContent = `${mode === "translate" ? "G · mover" : mode === "rotate" ? "R · rotar" : "S · escalar"} · X/Y/Z restringe · click/Enter confirma · Esc cancela`;
  setStatus(modalBadge.textContent);
}

function updateModal(event: PointerEvent) {
  if (!modal) return;
  const dx = event.clientX - modal.startPointer.x;
  const dy = event.clientY - modal.startPointer.y;
  const snap = editor.getSnap();

  if (modal.mode === "translate") {
    let delta = new THREE.Vector3();
    if (modal.axis) {
      let amount = pointerScalarOnAxis(dx, dy, modal.axis, modal.pivotWorld);
      const step = snap.enabled ? snap.gridSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1) : 0;
      if (step) amount = snapScalar(amount, step);
      delta.copy(axisVector(modal.axis)).multiplyScalar(amount);
    } else {
      const a = rayToHorizontalPlane(modal.startPointer.x, modal.startPointer.y, modal.pivotWorld.z);
      const b = rayToHorizontalPlane(event.clientX, event.clientY, modal.pivotWorld.z);
      if (a && b) delta.copy(b).sub(a);
      if (snap.enabled) {
        const step = snap.gridSize * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
        delta.x = snapScalar(delta.x, step);
        delta.y = snapScalar(delta.y, step);
      }
    }
    for (const state of modal.states) state.object.position.copy(state.position).add(delta);
    setStatus(`Mover ${modal.axis?.toUpperCase() ?? "XY"}: ${delta.x.toFixed(2)}, ${delta.y.toFixed(2)}, ${delta.z.toFixed(2)} mm`);
  } else if (modal.mode === "rotate") {
    const rect = viewport.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const angle = Math.atan2(py - modal.pivotScreen.y, px - modal.pivotScreen.x);
    let delta = angle - modal.startAngle;
    let deltaDeg = THREE.MathUtils.radToDeg(delta);
    const step = event.shiftKey ? 50 : event.altKey ? 0.5 : 5;
    deltaDeg = snapScalar(deltaDeg, step);
    delta = THREE.MathUtils.degToRad(deltaDeg);
    const axis = modal.axis ?? "z";
    for (const state of modal.states) {
      state.object.rotation.copy(state.rotation);
      (state.object.rotation as any)[axis] += delta;
    }
    setStatus(`Rotar ${axis.toUpperCase()}: ${deltaDeg.toFixed(1)}°`);
  } else {
    const startR = Math.max(20, Math.hypot(modal.startPointer.x - viewport.getBoundingClientRect().left - modal.pivotScreen.x, modal.startPointer.y - viewport.getBoundingClientRect().top - modal.pivotScreen.y));
    const currentR = Math.max(2, Math.hypot(event.clientX - viewport.getBoundingClientRect().left - modal.pivotScreen.x, event.clientY - viewport.getBoundingClientRect().top - modal.pivotScreen.y));
    let ratio = currentR / startR;
    const step = event.shiftKey ? 0.25 : event.altKey ? 0.01 : 0.05;
    ratio = Math.max(0.01, snapScalar(ratio, step));
    for (const state of modal.states) {
      state.object.scale.copy(state.scale);
      if (modal.axis) (state.object.scale as any)[modal.axis] = (state.scale as any)[modal.axis] * ratio;
      else state.object.scale.set(state.scale.x * ratio, state.scale.y * ratio, state.scale.z * ratio);
    }
    setStatus(`Escala ${modal.axis?.toUpperCase() ?? "uniforme"}: ${(ratio * 100).toFixed(1)}%`);
  }
  notifyChanged();
}

function finishModal(cancel: boolean) {
  if (!modal) return;
  if (cancel) {
    for (const state of modal.states) {
      state.object.position.copy(state.position);
      state.object.rotation.copy(state.rotation);
      state.object.scale.copy(state.scale);
    }
  }
  modal = null;
  modalBadge.classList.add("hidden");
  editor.clearAxisConstraint();
  notifyChanged();
  setStatus(cancel ? "Transformación cancelada." : "Transformación confirmada.");
}

window.addEventListener("pointerdown", (event) => {
  if (!modal) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishModal(false);
}, true);

// --- Arrow nudges ------------------------------------------------------------
function nudge(event: KeyboardEvent) {
  const selection = editor.getSelection();
  if (!selection.length) return false;
  const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  if (!arrows.includes(event.key)) return false;

  editor.checkpoint();
  const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
  const positive = event.key === "ArrowRight" || event.key === "ArrowUp";
  const sign = positive ? 1 : -1;
  const mode = editor.getTransformMode();
  let axis: Axis = event.ctrlKey || event.metaKey ? "z" : (event.key === "ArrowLeft" || event.key === "ArrowRight" ? "x" : "y");

  if (mode === "rotate") {
    const degrees = 5 * multiplier * sign;
    const radians = THREE.MathUtils.degToRad(degrees);
    for (const object of selection) (object.rotation as any)[axis] += radians;
    setStatus(`Rotación ${axis.toUpperCase()} ${degrees > 0 ? "+" : ""}${degrees.toFixed(1)}°`);
  } else {
    const snap = editor.getSnap();
    const amount = (snap.enabled ? snap.gridSize : 1) * multiplier * sign;
    for (const object of selection) (object.position as any)[axis] += amount;
    setStatus(`Mover ${axis.toUpperCase()} ${amount > 0 ? "+" : ""}${amount.toFixed(2)} mm`);
  }
  notifyChanged();
  return true;
}

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
  if (typing) return;

  if (modal) {
    const key = event.key.toLowerCase();
    if (key === "x" || key === "y" || key === "z") {
      event.preventDefault();
      event.stopImmediatePropagation();
      modal.axis = key;
      editor.constrainAxis(key);
      modalBadge.textContent = `${modal.mode.toUpperCase()} · eje ${key.toUpperCase()} · click/Enter confirma · Esc cancela`;
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishModal(true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishModal(false);
      return;
    }
  }

  if (nudge(event)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "g" || key === "m" || key === "r" || key === "s") {
    if (!editor.getSelection().length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startModal(key === "r" ? "rotate" : key === "s" ? "scale" : "translate");
  }
}, true);

setStatus("TinkerMatt v0.4 · Widget Tinker disponible. G/M, R y S ahora son transformaciones modales.");
