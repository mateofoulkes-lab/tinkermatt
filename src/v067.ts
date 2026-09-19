import * as THREE from "three";
import "./v067.css";
import { createBox, createCylinder, createSphere, materialFor } from "./geometry";
import { getMeta, setMeta, type SolidMode } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV067TransformKeydownOverride?: (event: KeyboardEvent) => boolean;
  }
}

type Axis = "x" | "y" | "z";
type ControlKind = "move" | "rotate";
type ControlInfo = { kind: ControlKind; axis: Axis };
type MoveState = { object: THREE.Object3D; worldPosition: THREE.Vector3 };
type RotateState = { object: THREE.Object3D; worldQuaternion: THREE.Quaternion };
type WidgetGesture =
  | { kind: "move"; pointerId: number; axis: Axis; centerWorld: THREE.Vector3; startX: number; startY: number; states: MoveState[] }
  | { kind: "rotate"; pointerId: number; axis: Axis; centerWorld: THREE.Vector3; centerClient: THREE.Vector2; startAngle: number; states: RotateState[] };
type KeyboardModal = {
  kind: "move" | "rotate";
  axis: Axis | null;
  space: "global" | "local";
  centerWorld: THREE.Vector3;
  centerClient: THREE.Vector2;
  startPointer: THREE.Vector2;
  startAngle: number;
  activeWorldQuaternion: THREE.Quaternion;
  moveStates: MoveState[];
  rotateStates: RotateState[];
};
type BasicDescriptor = { kind: "box" | "cylinder" | "sphere"; mode: SolidMode };
type BasicDrag = {
  pointerId: number;
  source: HTMLElement;
  startX: number;
  startY: number;
  descriptor: BasicDescriptor;
  dragging: boolean;
  preview: THREE.Object3D | null;
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.7 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const status = document.querySelector<HTMLElement>("#status");
const modalBadge = document.querySelector<HTMLElement>(".tm-modal-badge");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.7";
const setStatus = (text: string) => { if (status) status.textContent = text; };

const axisVector = (axis: Axis) => axis === "x"
  ? new THREE.Vector3(1, 0, 0)
  : axis === "y"
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

function projectToViewport(world: THREE.Vector3) {
  const p = world.clone().project(editor.camera);
  return new THREE.Vector2(
    (p.x * 0.5 + 0.5) * viewport.clientWidth,
    (-p.y * 0.5 + 0.5) * viewport.clientHeight,
  );
}
function worldDirectionOnScreen(direction: THREE.Vector3, origin: THREE.Vector3) {
  const a = projectToViewport(origin);
  const b = projectToViewport(origin.clone().add(direction));
  return b.sub(a);
}
function pointerScalar(dx: number, dy: number, direction: THREE.Vector3, origin: THREE.Vector3) {
  const v = worldDirectionOnScreen(direction, origin);
  const lenSq = v.lengthSq();
  return lenSq < 1e-8 ? 0 : (dx * v.x + dy * v.y) / lenSq;
}
function snap(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}
function normalizeDegrees(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}
function selectionCenter() {
  const active = editor.activeObject();
  if (!active) return null;
  active.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(active);
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}
function worldPosition(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return object.getWorldPosition(new THREE.Vector3());
}
function setWorldPosition(object: THREE.Object3D, position: THREE.Vector3) {
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    object.position.copy(object.parent.worldToLocal(position.clone()));
  } else object.position.copy(position);
  object.updateMatrixWorld(true);
}
function worldQuaternion(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return object.getWorldQuaternion(new THREE.Quaternion());
}
function setWorldQuaternion(object: THREE.Object3D, quaternion: THREE.Quaternion) {
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
    object.quaternion.copy(parentWorld.invert().multiply(quaternion));
  } else object.quaternion.copy(quaternion);
  object.updateMatrixWorld(true);
}
function notifyChanged() {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
}

// -----------------------------------------------------------------------------
// Rotation guide: fixed to <body>, above every editor layer. This intentionally
// does not depend on the historical DOM rotation widget, so it cannot be hidden
// behind the WebGL canvas or clipped by a viewport stacking context.
// -----------------------------------------------------------------------------
function polarLine(angleDeg: number, r1: number, r2: number, className: string) {
  const angle = THREE.MathUtils.degToRad(angleDeg - 90);
  const cx = 180;
  const cy = 180;
  return `<line class="${className}" x1="${(cx + Math.cos(angle) * r1).toFixed(2)}" y1="${(cy + Math.sin(angle) * r1).toFixed(2)}" x2="${(cx + Math.cos(angle) * r2).toFixed(2)}" y2="${(cy + Math.sin(angle) * r2).toFixed(2)}"/>`;
}
const degreeTicks = Array.from({ length: 180 }, (_, i) => polarLine(i * 2, i % 5 === 0 ? 123 : 127, 133, `tm-v067-degree-tick${i % 5 === 0 ? " major" : ""}`)).join("");
const fortyFiveTicks = Array.from({ length: 8 }, (_, i) => polarLine(i * 45, 27, 76, "tm-v067-45-tick")).join("");
const rotationGuide = document.createElement("div");
rotationGuide.className = "tm-rotation-guide-v067 hidden";
rotationGuide.dataset.zone = "outer";
rotationGuide.innerHTML = `
  <svg viewBox="0 0 360 360" aria-hidden="true">
    <circle class="tm-v067-band tm-v067-outer" cx="180" cy="180" r="157"/>
    <circle class="tm-v067-band tm-v067-mid" cx="180" cy="180" r="104"/>
    <circle class="tm-v067-band tm-v067-inner" cx="180" cy="180" r="51"/>
    ${degreeTicks}
    ${fortyFiveTicks}
    <circle class="tm-v067-boundary outer-a" cx="180" cy="180" r="176"/>
    <circle class="tm-v067-boundary outer-b" cx="180" cy="180" r="137"/>
    <circle class="tm-v067-boundary mid-a" cx="180" cy="180" r="132"/>
    <circle class="tm-v067-boundary mid-b" cx="180" cy="180" r="78"/>
    <circle class="tm-v067-boundary inner-a" cx="180" cy="180" r="74"/>
    <circle class="tm-v067-boundary inner-b" cx="180" cy="180" r="27"/>
  </svg>
  <div class="tm-v067-angle">0.0° · libre</div>`;
document.body.append(rotationGuide);
const rotationAngle = rotationGuide.querySelector<HTMLElement>(".tm-v067-angle")!;

function showRotationGuide(centerWorld: THREE.Vector3, axis: Axis, currentDeg: number, zone: ReturnType<typeof zoneFor>) {
  const p = projectToViewport(centerWorld);
  const rect = viewport.getBoundingClientRect();
  rotationGuide.style.left = `${rect.left + p.x}px`;
  rotationGuide.style.top = `${rect.top + p.y}px`;
  rotationGuide.dataset.zone = zone.zone;
  rotationAngle.textContent = `${axis.toUpperCase()} ${currentDeg.toFixed(1)}° · ${zone.label}`;
  rotationGuide.classList.remove("hidden");
}
function hideRotationGuide() {
  rotationGuide.classList.add("hidden");
}
function zoneFor(radius: number) {
  if (radius <= 78) return { zone: "inner" as const, step: 45, label: "45°" };
  if (radius <= 135) return { zone: "mid" as const, step: 1, label: "1°" };
  return { zone: "outer" as const, step: 0, label: "libre" };
}

// -----------------------------------------------------------------------------
// Direct hit-testing of the 3D Tinker arrows. Owning the gesture before v0.4.3
// proxies it into the old DOM buttons fixes both movement and rotation so the
// on-object widget is ALWAYS global/world-space.
// -----------------------------------------------------------------------------
const controlRaycaster = new THREE.Raycaster();
const controlPointer = new THREE.Vector2();
function controlAt(clientX: number, clientY: number): ControlInfo | null {
  const controls = editor.scene.getObjectByName("__tm_tinkercad_controls");
  if (!controls?.visible) return null;
  const rect = canvas.getBoundingClientRect();
  controlPointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  controlRaycaster.setFromCamera(controlPointer, editor.camera);
  const hit = controlRaycaster.intersectObject(controls, true)[0]?.object;
  let current: THREE.Object3D | null = hit ?? null;
  while (current && current !== controls) {
    if (current.userData.tmControl) return current.userData.tmControl as ControlInfo;
    current = current.parent;
  }
  return null;
}

let widgetGesture: WidgetGesture | null = null;
window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target !== canvas || widgetGesture) return;
  const control = controlAt(event.clientX, event.clientY);
  if (!control) return;
  const center = selectionCenter();
  const selection = editor.getSelection();
  const active = editor.activeObject();
  if (!center || !selection.length || !active) return;
  editor.checkpoint();

  if (control.kind === "move") {
    widgetGesture = {
      kind: "move",
      pointerId: event.pointerId,
      axis: control.axis,
      centerWorld: center,
      startX: event.clientX,
      startY: event.clientY,
      states: selection.map((object) => ({ object, worldPosition: worldPosition(object) })),
    };
    setStatus(`Mover ${control.axis.toUpperCase()} GLOBAL`);
  } else {
    const centerLocal = projectToViewport(center);
    const viewportRect = viewport.getBoundingClientRect();
    const centerClient = new THREE.Vector2(viewportRect.left + centerLocal.x, viewportRect.top + centerLocal.y);
    const startAngle = Math.atan2(event.clientY - centerClient.y, event.clientX - centerClient.x);
    const initialZone = zoneFor(Math.hypot(event.clientX - centerClient.x, event.clientY - centerClient.y));
    widgetGesture = {
      kind: "rotate",
      pointerId: event.pointerId,
      axis: control.axis,
      centerWorld: center,
      centerClient,
      startAngle,
      states: selection.map((object) => ({ object, worldQuaternion: worldQuaternion(object) })),
    };
    showRotationGuide(center, control.axis, THREE.MathUtils.radToDeg((active.rotation as any)[control.axis]), initialZone);
    setStatus(`Rotar ${control.axis.toUpperCase()} GLOBAL · exterior libre · medio 1° · interior 45°`);
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener("pointermove", (event) => {
  const gesture = widgetGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  if (gesture.kind === "move") {
    const direction = axisVector(gesture.axis);
    let amount = pointerScalar(event.clientX - gesture.startX, event.clientY - gesture.startY, direction, gesture.centerWorld);
    const snapConfig = editor.getSnap();
    if (snapConfig.enabled) amount = snap(amount, snapConfig.gridSize * (event.altKey ? 0.1 : event.shiftKey ? 10 : 1));
    const delta = direction.multiplyScalar(amount);
    for (const state of gesture.states) setWorldPosition(state.object, state.worldPosition.clone().add(delta));
    setStatus(`Mover ${gesture.axis.toUpperCase()} GLOBAL: ${amount.toFixed(2)} mm`);
  } else {
    let deltaDeg = normalizeDegrees(THREE.MathUtils.radToDeg(Math.atan2(event.clientY - gesture.centerClient.y, event.clientX - gesture.centerClient.x) - gesture.startAngle));
    const zone = zoneFor(Math.hypot(event.clientX - gesture.centerClient.x, event.clientY - gesture.centerClient.y));
    if (zone.step) deltaDeg = snap(deltaDeg, zone.step);
    const deltaQ = new THREE.Quaternion().setFromAxisAngle(axisVector(gesture.axis), THREE.MathUtils.degToRad(deltaDeg));
    for (const state of gesture.states) setWorldQuaternion(state.object, deltaQ.clone().multiply(state.worldQuaternion));
    const active = editor.activeObject();
    const currentDeg = active ? THREE.MathUtils.radToDeg((active.rotation as any)[gesture.axis]) : deltaDeg;
    showRotationGuide(gesture.centerWorld, gesture.axis, currentDeg, zone);
  }
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function finishWidgetGesture(event: PointerEvent) {
  if (!widgetGesture || widgetGesture.pointerId !== event.pointerId) return;
  widgetGesture = null;
  hideRotationGuide();
  notifyChanged();
  event.preventDefault();
  event.stopImmediatePropagation();
}
window.addEventListener("pointerup", finishWidgetGesture, true);
window.addEventListener("pointercancel", finishWidgetGesture, true);

// -----------------------------------------------------------------------------
// Keyboard G/R: first axis press = GLOBAL, repeated same axis = LOCAL. A third
// press toggles back to GLOBAL. S keeps the v0.6.4 implementation with the same
// semantics, so G/R/S now behave consistently.
// -----------------------------------------------------------------------------
let lastPointer = new THREE.Vector2();
let lastModifiers = { shift: false, alt: false };
let keyboardModal: KeyboardModal | null = null;
window.addEventListener("pointermove", (event) => {
  lastPointer.set(event.clientX, event.clientY);
  lastModifiers = { shift: event.shiftKey, alt: event.altKey };
  if (keyboardModal) updateKeyboardModal(event.clientX, event.clientY, event.shiftKey, event.altKey);
}, true);

function modalDirection(modal: KeyboardModal) {
  if (!modal.axis) return null;
  if (modal.space === "global") return axisVector(modal.axis);
  return axisVector(modal.axis).applyQuaternion(modal.activeWorldQuaternion).normalize();
}
function rayToPlane(clientX: number, clientY: number, z: number) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, editor.camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3());
}
function updateKeyboardModal(clientX: number, clientY: number, shift: boolean, alt: boolean) {
  const modal = keyboardModal;
  if (!modal) return;
  if (modal.kind === "move") {
    let delta = new THREE.Vector3();
    const direction = modalDirection(modal);
    if (direction) {
      let amount = pointerScalar(clientX - modal.startPointer.x, clientY - modal.startPointer.y, direction, modal.centerWorld);
      const snapConfig = editor.getSnap();
      if (snapConfig.enabled) amount = snap(amount, snapConfig.gridSize * (alt ? 0.1 : shift ? 10 : 1));
      delta.copy(direction).multiplyScalar(amount);
    } else {
      const a = rayToPlane(modal.startPointer.x, modal.startPointer.y, modal.centerWorld.z);
      const b = rayToPlane(clientX, clientY, modal.centerWorld.z);
      if (a && b) delta.copy(b).sub(a);
    }
    for (const state of modal.moveStates) setWorldPosition(state.object, state.worldPosition.clone().add(delta));
    const axisText = modal.axis ? `${modal.axis.toUpperCase()} ${modal.space.toUpperCase()}` : "XY GLOBAL";
    setStatus(`Mover ${axisText}: ${delta.length().toFixed(2)} mm`);
  } else {
    let deltaDeg = normalizeDegrees(THREE.MathUtils.radToDeg(Math.atan2(clientY - modal.centerClient.y, clientX - modal.centerClient.x) - modal.startAngle));
    const step = shift ? 15 : alt ? 0.5 : 1;
    deltaDeg = snap(deltaDeg, step);
    const axis = modal.axis ?? "z";
    for (const state of modal.rotateStates) {
      if (modal.space === "local" && modal.axis) {
        const deltaLocal = new THREE.Quaternion().setFromAxisAngle(axisVector(axis), THREE.MathUtils.degToRad(deltaDeg));
        setWorldQuaternion(state.object, state.worldQuaternion.clone().multiply(deltaLocal));
      } else {
        const deltaWorld = new THREE.Quaternion().setFromAxisAngle(axisVector(axis), THREE.MathUtils.degToRad(deltaDeg));
        setWorldQuaternion(state.object, deltaWorld.multiply(state.worldQuaternion));
      }
    }
    const axisText = `${axis.toUpperCase()} ${modal.axis ? modal.space.toUpperCase() : "GLOBAL"}`;
    setStatus(`Rotar ${axisText}: ${deltaDeg.toFixed(1)}°`);
  }
  if (modalBadge) {
    const axisText = modal.axis ? `${modal.axis.toUpperCase()} ${modal.space.toUpperCase()}` : modal.kind === "move" ? "libre" : "Z GLOBAL";
    modalBadge.textContent = `${modal.kind === "move" ? "G" : "R"} · ${axisText} · repetir eje alterna GLOBAL/LOCAL · click/Enter confirma · Esc cancela`;
  }
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}
function beginKeyboardModal(kind: "move" | "rotate") {
  const selection = editor.getSelection();
  const active = editor.activeObject();
  const center = selectionCenter();
  if (!selection.length || !active || !center) return;
  editor.checkpoint();
  const localCenter = projectToViewport(center);
  const rect = viewport.getBoundingClientRect();
  const centerClient = new THREE.Vector2(rect.left + localCenter.x, rect.top + localCenter.y);
  const startPointer = lastPointer.lengthSq() > 0 ? lastPointer.clone() : centerClient.clone().add(new THREE.Vector2(90, 0));
  keyboardModal = {
    kind,
    axis: null,
    space: "global",
    centerWorld: center,
    centerClient,
    startPointer,
    startAngle: Math.atan2(startPointer.y - centerClient.y, startPointer.x - centerClient.x),
    activeWorldQuaternion: worldQuaternion(active),
    moveStates: selection.map((object) => ({ object, worldPosition: worldPosition(object) })),
    rotateStates: selection.map((object) => ({ object, worldQuaternion: worldQuaternion(object) })),
  };
  modalBadge?.classList.remove("hidden");
  updateKeyboardModal(startPointer.x, startPointer.y, lastModifiers.shift, lastModifiers.alt);
}
function finishKeyboardModal(cancel: boolean) {
  const modal = keyboardModal;
  if (!modal) return;
  if (cancel) {
    for (const state of modal.moveStates) setWorldPosition(state.object, state.worldPosition);
    for (const state of modal.rotateStates) setWorldQuaternion(state.object, state.worldQuaternion);
  }
  keyboardModal = null;
  modalBadge?.classList.add("hidden");
  editor.clearAxisConstraint();
  notifyChanged();
  setStatus(cancel ? "Transformación cancelada." : "Transformación confirmada.");
}

window.__tmV067TransformKeydownOverride = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
  if (typing) return false;
  const key = event.key.toLowerCase();
  if (keyboardModal) {
    if (key === "x" || key === "y" || key === "z") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (keyboardModal.axis === key) keyboardModal.space = keyboardModal.space === "global" ? "local" : "global";
      else { keyboardModal.axis = key; keyboardModal.space = "global"; }
      editor.constrainAxis(key);
      updateKeyboardModal(lastPointer.x, lastPointer.y, lastModifiers.shift, lastModifiers.alt);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); finishKeyboardModal(true); return true;
    }
    if (event.key === "Enter") {
      event.preventDefault(); event.stopImmediatePropagation(); finishKeyboardModal(false); return true;
    }
    if (key === "g" || key === "m" || key === "r") {
      event.preventDefault(); event.stopImmediatePropagation(); return true;
    }
    return false;
  }
  if ((key === "g" || key === "m" || key === "r") && editor.getSelection().length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    beginKeyboardModal(key === "r" ? "rotate" : "move");
    return true;
  }
  return false;
};

window.addEventListener("pointerdown", (event) => {
  if (!keyboardModal || widgetGesture) return;
  // A click confirms the active modal, Blender-style.
  event.preventDefault();
  event.stopImmediatePropagation();
  finishKeyboardModal(false);
}, true);

// -----------------------------------------------------------------------------
// Drag basic primitives from the VISIBLE family summary. v0.6.3 handled the
// hidden child buttons and advanced forms, but the compact Cube/Cylinder/Sphere
// parents are <summary> elements, so they never matched its selector.
// -----------------------------------------------------------------------------
function basicDescriptorFromSummary(target: EventTarget | null): { source: HTMLElement; descriptor: BasicDescriptor } | null {
  const summary = (target as HTMLElement | null)?.closest<HTMLElement>(".library-family > summary");
  if (!summary) return null;
  const family = summary.parentElement;
  if (!family) return null;
  const items = [...family.querySelectorAll<HTMLButtonElement>(":scope > .library-item[data-shape]")];
  if (!items.length) return null;
  const activeId = summary.dataset.activeToolId;
  const index = Number(summary.dataset.activeToolIndex ?? 0);
  const item = (activeId ? items.find((candidate) => candidate.id === activeId) : undefined) ?? items[Math.max(0, Math.min(items.length - 1, index))];
  const kind = item?.dataset.shape;
  if (kind !== "box" && kind !== "cylinder" && kind !== "sphere") return null;
  return { source: summary, descriptor: { kind, mode: (item.dataset.mode ?? "solid") as SolidMode } };
}
function makeBasic(descriptor: BasicDescriptor) {
  const object = descriptor.kind === "box" ? createBox() : descriptor.kind === "cylinder" ? createCylinder() : createSphere();
  if (descriptor.mode === "hole") {
    const meta = getMeta(object);
    if (meta) {
      meta.mode = "hole";
      setMeta(object, meta);
      object.traverse((node) => { if (node instanceof THREE.Mesh) node.material = materialFor(meta.material, "hole"); });
    }
  }
  return object;
}
function makeBasicPreview(descriptor: BasicDescriptor) {
  const preview = makeBasic(descriptor);
  preview.name = "__tm_basic_drag_preview";
  preview.traverse((node) => {
    delete node.userData.tinker;
    if (node instanceof THREE.Mesh) node.material = new THREE.MeshBasicMaterial({ color: 0x079bd0, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
  });
  return preview;
}
function pointerOnWorkplane(clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, editor.camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
}
function insideViewport(clientX: number, clientY: number) {
  const rect = viewport.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}
function placeOnPointer(object: THREE.Object3D, clientX: number, clientY: number) {
  const point = pointerOnWorkplane(clientX, clientY);
  if (!point) return false;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x += point.x - center.x;
  object.position.y += point.y - center.y;
  object.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(object);
  object.position.z -= after.min.z;
  object.updateMatrixWorld(true);
  return true;
}
function disposePreview(preview: THREE.Object3D | null) {
  if (!preview) return;
  preview.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material.dispose());
    }
  });
  preview.removeFromParent();
}

let basicDrag: BasicDrag | null = null;
document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || basicDrag) return;
  const found = basicDescriptorFromSummary(event.target);
  if (!found) return;
  basicDrag = {
    pointerId: event.pointerId,
    source: found.source,
    startX: event.clientX,
    startY: event.clientY,
    descriptor: found.descriptor,
    dragging: false,
    preview: null,
  };
}, true);
window.addEventListener("pointermove", (event) => {
  const drag = basicDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6) {
    drag.dragging = true;
    drag.source.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: event.pointerId, pointerType: event.pointerType }));
    drag.preview = makeBasicPreview(drag.descriptor);
    editor.scene.add(drag.preview);
    viewport.classList.add("tm-primitive-dragging");
  }
  if (!drag.dragging || !drag.preview) return;
  drag.preview.visible = insideViewport(event.clientX, event.clientY);
  if (drag.preview.visible) placeOnPointer(drag.preview, event.clientX, event.clientY);
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
function finishBasicDrag(event: PointerEvent, cancelled: boolean) {
  const drag = basicDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  basicDrag = null;
  if (!drag.dragging) return;
  viewport.classList.remove("tm-primitive-dragging");
  event.preventDefault();
  event.stopImmediatePropagation();
  const canDrop = !cancelled && insideViewport(event.clientX, event.clientY);
  disposePreview(drag.preview);
  if (!canDrop) return;
  const object = makeBasic(drag.descriptor);
  if (!placeOnPointer(object, event.clientX, event.clientY)) return;
  editor.addObject(object);
  setStatus(`${getMeta(object)?.name ?? "Primitiva"} colocada en el plano de trabajo.`);
}
window.addEventListener("pointerup", (event) => finishBasicDrag(event, false), true);
window.addEventListener("pointercancel", (event) => { if (event.isTrusted) finishBasicDrag(event, true); }, true);

// Fix only the old cone DRAG PREVIEW. The final cone is already rebuilt by the
// current parametric layer, but v0.6.3 previews the legacy cone before that rebuild.
requestAnimationFrame(function fixConePreviewLoop() {
  const preview = editor.scene.getObjectByName("__tm_drag_primitive_preview");
  if (preview instanceof THREE.Mesh && !preview.userData.tmV067ConePreviewFixed) {
    const parameters = (preview.geometry as any).parameters;
    if (parameters?.radiusTop > 0 && parameters?.radiusBottom === 0 && parameters?.radialSegments === 64) {
      preview.geometry.rotateX(Math.PI);
      preview.geometry.computeBoundingBox();
      preview.geometry.computeBoundingSphere();
      preview.userData.tmV067ConePreviewFixed = true;
    }
  }
  requestAnimationFrame(fixConePreviewLoop);
});

setStatus("TinkerMatt v0.6.7 · widgets globales + G/R global-local + guía visible + drag básico.");
