import * as THREE from "three";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV068PointerdownOverride?: (event: PointerEvent) => boolean;
  }
}

type Axis = "x" | "y" | "z";
type EdgeScaleDrag = {
  pointerId: number;
  axis: Axis;
  sign: -1 | 1;
  object: THREE.Object3D;
  startBox: THREE.Box3;
  startSize: THREE.Vector3;
  plane: THREE.Plane;
  startPoint: THREE.Vector3;
};
type RotationState = { object: THREE.Object3D; worldQuaternion: THREE.Quaternion };
type RotationDrag = {
  pointerId: number;
  axis: Axis;
  centerWorld: THREE.Vector3;
  centerClient: THREE.Vector2;
  basisU: THREE.Vector3;
  basisV: THREE.Vector3;
  startAngle: number;
  states: RotationState[];
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.8 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.8";
const setStatus = (text: string) => { if (status) status.textContent = text; };

const axisVector = (axis: Axis) => axis === "x"
  ? new THREE.Vector3(1, 0, 0)
  : axis === "y"
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

function pointerRay(clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, editor.camera);
  return raycaster.ray.clone();
}

function projectClient(world: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return new THREE.Vector2(
    rect.left + (p.x * 0.5 + 0.5) * rect.width,
    rect.top + (-p.y * 0.5 + 0.5) * rect.height,
  );
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
function insideViewport(clientX: number, clientY: number) {
  const rect = viewport.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

// -----------------------------------------------------------------------------
// Scale midpoint handles: use a camera-facing drag plane containing the WORLD
// axis. This is perspective-correct, so especially the Y handle stays under the
// mouse instead of lagging behind while the object's center changes.
// -----------------------------------------------------------------------------
function axisDragPlane(origin: THREE.Vector3, axis: Axis) {
  const direction = axisVector(axis);
  const toCamera = editor.camera.position.clone().sub(origin).normalize();
  let normal = toCamera.clone().addScaledVector(direction, -toCamera.dot(direction));
  if (normal.lengthSq() < 1e-8) {
    const fallback = Math.abs(direction.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    normal = fallback.addScaledVector(direction, -fallback.dot(direction));
  }
  normal.normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
}
function pointOnPlane(clientX: number, clientY: number, plane: THREE.Plane) {
  return pointerRay(clientX, clientY).intersectPlane(plane, new THREE.Vector3());
}

let edgeScaleDrag: EdgeScaleDrag | null = null;
function startEdgeScale(event: PointerEvent, handle: HTMLElement) {
  const object = editor.activeObject();
  if (!object) return false;
  const axis = handle.dataset.axis as Axis | undefined;
  if (axis !== "x" && axis !== "y" && axis !== "z") return false;
  const sign = Number(handle.dataset.sign) < 0 ? -1 : 1;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return false;
  const center = box.getCenter(new THREE.Vector3());
  const plane = axisDragPlane(center, axis);
  const startPoint = pointOnPlane(event.clientX, event.clientY, plane);
  if (!startPoint) return false;
  editor.checkpoint();
  edgeScaleDrag = {
    pointerId: event.pointerId,
    axis,
    sign,
    object,
    startBox: box.clone(),
    startSize: box.getSize(new THREE.Vector3()),
    plane,
    startPoint,
  };
  setStatus(`Escalar ${axis.toUpperCase()} GLOBAL`);
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function updateEdgeScale(event: PointerEvent) {
  const drag = edgeScaleDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  const point = pointOnPlane(event.clientX, event.clientY, drag.plane);
  if (!point) return true;
  const direction = axisVector(drag.axis);
  let faceMotion = point.clone().sub(drag.startPoint).dot(direction);
  const snap = editor.getSnap();
  if (snap.enabled) {
    const step = snap.gridSize * (event.altKey ? 0.1 : event.shiftKey ? 10 : 1);
    faceMotion = Math.round(faceMotion / step) * step;
  }
  const targetSize = Math.max(0.01, drag.startSize[drag.axis] + faceMotion * drag.sign * (event.altKey ? 2 : 1));
  rawEditor.setActiveDimension(drag.axis, targetSize);

  // Scale-from-side keeps the opposite face fixed. This translation is only the
  // expected half-size center shift along the chosen WORLD axis; there is no
  // sideways/local-axis drift.
  if (!event.altKey) {
    const current = new THREE.Box3().setFromObject(drag.object);
    const correction = new THREE.Vector3();
    correction[drag.axis] = drag.sign > 0
      ? drag.startBox.min[drag.axis] - current.min[drag.axis]
      : drag.startBox.max[drag.axis] - current.max[drag.axis];
    setWorldPosition(drag.object, worldPosition(drag.object).add(correction));
  }
  notifyChanged();
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

// -----------------------------------------------------------------------------
// Rotation guide: inline-styled body overlay. It does not rely on any historical
// CSS class, and display is forced with !important while rotating. This removes
// every stacking/clipping/legacy-hidden failure mode that affected v0.6.6/0.6.7.
// -----------------------------------------------------------------------------
function polarLine(angleDeg: number, r1: number, r2: number, opacity: number, width: number) {
  const a = THREE.MathUtils.degToRad(angleDeg - 90);
  const cx = 180;
  const cy = 180;
  return `<line x1="${(cx + Math.cos(a) * r1).toFixed(2)}" y1="${(cy + Math.sin(a) * r1).toFixed(2)}" x2="${(cx + Math.cos(a) * r2).toFixed(2)}" y2="${(cy + Math.sin(a) * r2).toFixed(2)}" stroke="rgba(38,118,69,${opacity})" stroke-width="${width}"/>`;
}
const degreeTicks = Array.from({ length: 180 }, (_, i) => polarLine(i * 2, i % 5 === 0 ? 124 : 128, 134, i % 5 === 0 ? 0.48 : 0.20, i % 5 === 0 ? 1.15 : 0.7)).join("");
const fortyFiveTicks = Array.from({ length: 8 }, (_, i) => {
  const a = THREE.MathUtils.degToRad(i * 45 - 90);
  const x1 = 180 + Math.cos(a) * 28;
  const y1 = 180 + Math.sin(a) * 28;
  const x2 = 180 + Math.cos(a) * 77;
  const y2 = 180 + Math.sin(a) * 77;
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="rgba(173,101,10,.62)" stroke-width="1.5"/>`;
}).join("");

const rotationGuide = document.createElement("div");
rotationGuide.className = "tm-rotation-guide-v068";
rotationGuide.setAttribute("aria-hidden", "true");
Object.assign(rotationGuide.style, {
  position: "fixed",
  width: "360px",
  height: "360px",
  transform: "translate(-50%, -50%)",
  pointerEvents: "none",
  zIndex: "2147483647",
  filter: "drop-shadow(0 5px 14px rgba(20,40,52,.22))",
});
rotationGuide.style.setProperty("display", "none", "important");
rotationGuide.innerHTML = `
  <svg viewBox="0 0 360 360" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">
    <circle cx="180" cy="180" r="157" fill="none" stroke="rgba(21,152,211,.27)" stroke-width="40"/>
    <circle cx="180" cy="180" r="104" fill="none" stroke="rgba(59,167,95,.29)" stroke-width="54"/>
    <circle cx="180" cy="180" r="51" fill="none" stroke="rgba(227,148,39,.34)" stroke-width="50"/>
    ${degreeTicks}
    ${fortyFiveTicks}
    <circle cx="180" cy="180" r="176" fill="none" stroke="rgba(7,134,189,.85)" stroke-width="1.8"/>
    <circle cx="180" cy="180" r="137" fill="none" stroke="rgba(7,134,189,.70)" stroke-width="1.6"/>
    <circle cx="180" cy="180" r="132" fill="none" stroke="rgba(39,138,73,.80)" stroke-width="1.7"/>
    <circle cx="180" cy="180" r="78" fill="none" stroke="rgba(39,138,73,.72)" stroke-width="1.6"/>
    <circle cx="180" cy="180" r="74" fill="none" stroke="rgba(189,111,12,.82)" stroke-width="1.7"/>
    <circle cx="180" cy="180" r="27" fill="none" stroke="rgba(189,111,12,.72)" stroke-width="1.6"/>
  </svg>
  <div class="tm-v068-angle" style="position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);min-width:118px;padding:6px 10px;border:1px solid rgba(94,125,142,.66);border-radius:7px;background:rgba(255,255,255,.82);box-shadow:0 3px 11px rgba(22,44,57,.18);backdrop-filter:blur(5px);color:#304d5e;text-align:center;font:800 10px/1.2 system-ui,sans-serif;font-variant-numeric:tabular-nums">0.0° · libre</div>`;
document.body.append(rotationGuide);
const rotationBadge = rotationGuide.querySelector<HTMLElement>(".tm-v068-angle")!;

function rotationZone(radius: number) {
  if (radius <= 78) return { step: 45, label: "45°" };
  if (radius <= 135) return { step: 1, label: "1°" };
  return { step: 0, label: "libre" };
}
function showRotationGuide(center: THREE.Vector3, axis: Axis, degrees: number, zone: ReturnType<typeof rotationZone>) {
  const p = projectClient(center);
  rotationGuide.style.left = `${p.x}px`;
  rotationGuide.style.top = `${p.y}px`;
  rotationBadge.textContent = `${axis.toUpperCase()} ${degrees.toFixed(1)}° · ${zone.label}`;
  rotationGuide.style.setProperty("display", "block", "important");
}
function hideRotationGuide() {
  rotationGuide.style.setProperty("display", "none", "important");
}

function basisForAxis(axis: Axis) {
  const normal = axisVector(axis);
  const reference = Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const u = reference.clone().cross(normal).normalize();
  const v = normal.clone().cross(u).normalize();
  return { u, v };
}
function rotationAngleAt(clientX: number, clientY: number, center: THREE.Vector3, axis: Axis, u: THREE.Vector3, v: THREE.Vector3) {
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisVector(axis), center);
  const point = pointerRay(clientX, clientY).intersectPlane(plane, new THREE.Vector3());
  if (!point) return null;
  const relative = point.sub(center);
  if (relative.lengthSq() < 1e-8) return null;
  return Math.atan2(relative.dot(v), relative.dot(u));
}
function normalizeDegrees(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

const controlRaycaster = new THREE.Raycaster();
const controlPointer = new THREE.Vector2();
function rotationAxisAt(clientX: number, clientY: number): Axis | null {
  const controls = editor.scene.getObjectByName("__tm_tinkercad_controls");
  if (!controls?.visible) return null;
  const rect = canvas.getBoundingClientRect();
  controlPointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  controlRaycaster.setFromCamera(controlPointer, editor.camera);
  const hit = controlRaycaster.intersectObject(controls, true)[0]?.object;
  let current: THREE.Object3D | null = hit ?? null;
  while (current && current !== controls) {
    const info = current.userData.tmControl as { kind?: string; axis?: Axis } | undefined;
    if (info?.kind === "rotate" && (info.axis === "x" || info.axis === "y" || info.axis === "z")) return info.axis;
    current = current.parent;
  }
  return null;
}
function rotationAxisFromDom(target: EventTarget | null): Axis | null {
  const handle = (target as HTMLElement | null)?.closest<HTMLElement>(".tm-rotate-handle");
  if (!handle) return null;
  if (handle.classList.contains("tm-rotate-x")) return "x";
  if (handle.classList.contains("tm-rotate-y")) return "y";
  if (handle.classList.contains("tm-rotate-z")) return "z";
  return null;
}

let rotationDrag: RotationDrag | null = null;
function startRotation(event: PointerEvent, axis: Axis) {
  const active = editor.activeObject();
  const selection = editor.getSelection();
  if (!active || !selection.length) return false;
  active.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(active);
  if (box.isEmpty()) return false;
  const center = box.getCenter(new THREE.Vector3());
  const { u, v } = basisForAxis(axis);
  const startAngle = rotationAngleAt(event.clientX, event.clientY, center, axis, u, v);
  if (startAngle === null) return false;
  editor.checkpoint();
  const centerClient = projectClient(center);
  rotationDrag = {
    pointerId: event.pointerId,
    axis,
    centerWorld: center,
    centerClient,
    basisU: u,
    basisV: v,
    startAngle,
    states: selection.map((object) => ({ object, worldQuaternion: worldQuaternion(object) })),
  };
  const radius = Math.hypot(event.clientX - centerClient.x, event.clientY - centerClient.y);
  const zone = rotationZone(radius);
  showRotationGuide(center, axis, THREE.MathUtils.radToDeg((active.rotation as any)[axis]), zone);
  setStatus(`Rotar ${axis.toUpperCase()} GLOBAL · exterior libre · medio 1° · interior 45°`);
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function updateRotation(event: PointerEvent) {
  const drag = rotationDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  const angle = rotationAngleAt(event.clientX, event.clientY, drag.centerWorld, drag.axis, drag.basisU, drag.basisV);
  if (angle === null) return true;
  let deltaDeg = normalizeDegrees(THREE.MathUtils.radToDeg(angle - drag.startAngle));
  const radius = Math.hypot(event.clientX - drag.centerClient.x, event.clientY - drag.centerClient.y);
  const zone = rotationZone(radius);
  if (zone.step) deltaDeg = Math.round(deltaDeg / zone.step) * zone.step;
  const deltaQ = new THREE.Quaternion().setFromAxisAngle(axisVector(drag.axis), THREE.MathUtils.degToRad(deltaDeg));
  for (const state of drag.states) setWorldQuaternion(state.object, deltaQ.clone().multiply(state.worldQuaternion));
  const active = editor.activeObject();
  const current = active ? THREE.MathUtils.radToDeg((active.rotation as any)[drag.axis]) : deltaDeg;
  showRotationGuide(drag.centerWorld, drag.axis, current, zone);
  notifyChanged();
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

// Early capture hook installed by v068-pre.ts. It owns edge scaling and ALL
// rotation handle starts before legacy handlers can translate them into local
// Euler operations.
window.__tmV068PointerdownOverride = (event: PointerEvent) => {
  if (event.button !== 0 || edgeScaleDrag || rotationDrag) return false;

  const edge = (event.target as HTMLElement | null)?.closest<HTMLElement>(".tm-edge-handle");
  if (edge && startEdgeScale(event, edge)) return true;

  const domAxis = rotationAxisFromDom(event.target);
  if (domAxis && startRotation(event, domAxis)) return true;

  if (!insideViewport(event.clientX, event.clientY)) return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input,select,textarea,button,.tm-scale-handle,.tm-measure")) return false;
  const worldAxis = rotationAxisAt(event.clientX, event.clientY);
  if (worldAxis && startRotation(event, worldAxis)) return true;
  return false;
};

window.addEventListener("pointermove", (event) => {
  if (updateEdgeScale(event)) return;
  updateRotation(event);
}, true);

function finish(event: PointerEvent, cancel: boolean) {
  if (edgeScaleDrag && edgeScaleDrag.pointerId === event.pointerId) {
    edgeScaleDrag = null;
    notifyChanged();
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (rotationDrag && rotationDrag.pointerId === event.pointerId) {
    const drag = rotationDrag;
    rotationDrag = null;
    if (cancel) {
      for (const state of drag.states) setWorldQuaternion(state.object, state.worldQuaternion);
    }
    hideRotationGuide();
    notifyChanged();
    setStatus(cancel ? "Rotación cancelada." : "Rotación confirmada.");
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
window.addEventListener("pointerup", (event) => finish(event, false), true);
window.addEventListener("pointercancel", (event) => {
  if (!event.isTrusted) return;
  finish(event, true);
}, true);

setStatus("TinkerMatt v0.6.8 · Y widget perspective-correct + guía de rotación forzada.");
