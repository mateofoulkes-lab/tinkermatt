import * as THREE from "three";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV068PointerdownOverride?: (event: PointerEvent) => boolean;
  }
}

type Axis = "x" | "y" | "z";
type Sign = -1 | 1;
type MeshBase = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  meshToRoot: THREE.Matrix4;
};
type ScaleDrag = {
  pointerId: number;
  source: HTMLElement;
  object: THREE.Object3D;
  startBox: THREE.Box3;
  startSize: THREE.Vector3;
  startCenter: THREE.Vector3;
  signs: Partial<Record<Axis, Sign>>;
  startRootWorld: THREE.Matrix4;
  meshes: MeshBase[];
  oldDeform: THREE.Matrix4;
  startAxisParam?: number;
  startPlanePoint?: THREE.Vector3;
};
type RotateState = { object: THREE.Object3D; worldQuaternion: THREE.Quaternion };
type RotateDrag = {
  pointerId: number;
  axis: Axis;
  centerWorld: THREE.Vector3;
  centerClient: THREE.Vector2;
  startAngle: number;
  states: RotateState[];
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.9 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.9";
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
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, editor.camera);
  return rc.ray.clone();
}

function storedDeform(object: THREE.Object3D) {
  const raw = object.userData.tmWorldDeform;
  if (Array.isArray(raw) && raw.length === 16 && raw.every((value) => Number.isFinite(Number(value)))) {
    return new THREE.Matrix4().fromArray(raw.map(Number));
  }
  return new THREE.Matrix4();
}
function matrixSignature(matrix: THREE.Matrix4) {
  return matrix.elements.map((value) => Number(value.toFixed(7))).join(",");
}
function refreshGeometry(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
function worldPosition(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return object.getWorldPosition(new THREE.Vector3());
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
function projectClient(world: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return new THREE.Vector2(
    rect.left + (p.x * 0.5 + 0.5) * rect.width,
    rect.top + (-p.y * 0.5 + 0.5) * rect.height,
  );
}

// -----------------------------------------------------------------------------
// Scale widget v4: every mousemove is rebuilt from the ORIGINAL drag snapshot.
// There is no incremental scale -> translate -> scale feedback loop anymore.
// -----------------------------------------------------------------------------
function captureMeshes(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const invRoot = root.matrixWorld.clone().invert();
  const meshes: MeshBase[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.updateMatrixWorld(true);
    meshes.push({
      mesh: node,
      geometry: node.geometry.clone(),
      meshToRoot: invRoot.clone().multiply(node.matrixWorld),
    });
  });
  return meshes;
}
function disposeMeshes(meshes: MeshBase[]) {
  for (const item of meshes) item.geometry.dispose();
}
function restoreBase(drag: ScaleDrag) {
  for (const item of drag.meshes) {
    item.mesh.geometry.copy(item.geometry);
    refreshGeometry(item.mesh.geometry);
  }
}
function worldScaleMatrix(pivot: THREE.Vector3, scale: THREE.Vector3) {
  return new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}
function applyScaleFromStart(drag: ScaleDrag, scale: THREE.Vector3, pivot: THREE.Vector3) {
  restoreBase(drag);
  const worldDelta = worldScaleMatrix(pivot, scale);
  const rootDelta = drag.startRootWorld.clone().invert().multiply(worldDelta).multiply(drag.startRootWorld);
  for (const item of drag.meshes) {
    const localDelta = item.meshToRoot.clone().invert().multiply(rootDelta).multiply(item.meshToRoot);
    item.mesh.geometry.applyMatrix4(localDelta);
    refreshGeometry(item.mesh.geometry);
  }
  drag.object.updateMatrixWorld(true);
  rawEditor.refreshSelectionHelpers?.();
  return rootDelta;
}

// Closest point parameter on an infinite world axis to the mouse ray. This gives
// a true 1:1 axis drag in perspective and avoids the handle lagging behind.
function pointerAxisParameter(clientX: number, clientY: number, axisPoint: THREE.Vector3, axis: Axis) {
  const ray = pointerRay(clientX, clientY);
  const u = axisVector(axis);
  const d = ray.direction.clone().normalize();
  const w = ray.origin.clone().sub(axisPoint);
  const b = d.dot(u);
  const d0 = d.dot(w);
  const e = u.dot(w);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return null;
  return (e - b * d0) / denom;
}
function pointerXY(clientX: number, clientY: number, z: number) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  return pointerRay(clientX, clientY).intersectPlane(plane, new THREE.Vector3());
}
function scaleSigns(handle: HTMLElement): Partial<Record<Axis, Sign>> | null {
  if (handle.classList.contains("tm-z-handle")) return { z: 1 };
  if (handle.classList.contains("tm-edge-handle")) {
    const axis = handle.dataset.axis as Axis | undefined;
    if (axis !== "x" && axis !== "y") return null;
    return { [axis]: Number(handle.dataset.sign) < 0 ? -1 : 1 };
  }
  if (handle.classList.contains("tm-corner-handle")) {
    return {
      x: Number(handle.dataset.sx) < 0 ? -1 : 1,
      y: Number(handle.dataset.sy) < 0 ? -1 : 1,
    };
  }
  return null;
}

let scaleDrag: ScaleDrag | null = null;
function startScale(event: PointerEvent, handle: HTMLElement) {
  const object = editor.activeObject();
  const signs = scaleSigns(handle);
  if (!object || !signs) return false;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return false;
  const startCenter = box.getCenter(new THREE.Vector3());
  const axes = Object.keys(signs) as Axis[];
  const drag: ScaleDrag = {
    pointerId: event.pointerId,
    source: handle,
    object,
    startBox: box.clone(),
    startSize: box.getSize(new THREE.Vector3()),
    startCenter,
    signs,
    startRootWorld: object.matrixWorld.clone(),
    meshes: captureMeshes(object),
    oldDeform: storedDeform(object),
  };
  if (axes.length === 1) {
    drag.startAxisParam = pointerAxisParameter(event.clientX, event.clientY, startCenter, axes[0]) ?? 0;
  } else {
    drag.startPlanePoint = pointerXY(event.clientX, event.clientY, box.min.z) ?? undefined;
  }
  editor.checkpoint();
  scaleDrag = drag;
  try { handle.setPointerCapture(event.pointerId); } catch { /* optional */ }
  setStatus(`Escalar ${axes.join("+").toUpperCase()} GLOBAL`);
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function updateScale(event: PointerEvent) {
  const drag = scaleDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  const axes = Object.keys(drag.signs) as Axis[];
  const deltas: Partial<Record<Axis, number>> = {};
  if (axes.length === 1) {
    const axis = axes[0];
    const param = pointerAxisParameter(event.clientX, event.clientY, drag.startCenter, axis);
    deltas[axis] = param === null ? 0 : param - (drag.startAxisParam ?? 0);
  } else {
    const p = pointerXY(event.clientX, event.clientY, drag.startBox.min.z);
    if (p && drag.startPlanePoint) {
      deltas.x = p.x - drag.startPlanePoint.x;
      deltas.y = p.y - drag.startPlanePoint.y;
    }
  }

  const snapConfig = editor.getSnap();
  const scale = new THREE.Vector3(1, 1, 1);
  const pivot = drag.startCenter.clone();
  for (const axis of axes) {
    const sign = drag.signs[axis]!;
    let delta = deltas[axis] ?? 0;
    if (snapConfig.enabled) {
      const step = snapConfig.gridSize * (event.ctrlKey || event.metaKey ? 0.1 : 1);
      delta = Math.round(delta / step) * step;
    }
    const start = Math.max(0.0001, drag.startSize[axis]);
    let target = Math.max(0.01, start + delta * sign * (event.altKey ? 2 : 1));
    scale[axis] = target / start;
    if (!event.altKey) pivot[axis] = sign > 0 ? drag.startBox.min[axis] : drag.startBox.max[axis];
  }

  if (event.shiftKey && axes.length) {
    const driver = axes[0];
    const ratio = scale[driver];
    scale.set(ratio, ratio, ratio);
    if (!event.altKey) {
      for (const axis of axes) {
        const sign = drag.signs[axis]!;
        pivot[axis] = sign > 0 ? drag.startBox.min[axis] : drag.startBox.max[axis];
      }
    }
  }

  applyScaleFromStart(drag, scale, pivot);
  // Intentionally NO changed/selection event here. Heavy inspector/autosave
  // listeners used to run at every pixel and made the handle visibly lag.
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function finishScale(event: PointerEvent, cancel: boolean) {
  const drag = scaleDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  scaleDrag = null;
  if (cancel) {
    restoreBase(drag);
  } else {
    // Derive the final world affine delta by comparing one last AABB against the
    // start transform is not reliable; instead compose from the geometry itself
    // only when an older deformation already exists. Mark current geometry as
    // authoritative so v0.6.4's compatibility reapply loop never doubles it.
    delete drag.object.userData.tmWorldDeform;
    for (const item of drag.meshes) delete item.mesh.geometry.userData.tmWorldDeformApplied;
  }
  disposeMeshes(drag.meshes);
  try { drag.source.releasePointerCapture(event.pointerId); } catch { /* optional */ }
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(cancel ? "Escala cancelada." : "Escala confirmada.");
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

// -----------------------------------------------------------------------------
// Rotation guide: real top-level 2D canvas. No inherited CSS, SVG class,
// viewport clipping or historical .hidden selector can make it disappear.
// -----------------------------------------------------------------------------
const ring = document.createElement("canvas");
ring.width = 420;
ring.height = 420;
ring.setAttribute("aria-hidden", "true");
ring.style.setProperty("position", "fixed", "important");
ring.style.setProperty("width", "420px", "important");
ring.style.setProperty("height", "420px", "important");
ring.style.setProperty("pointer-events", "none", "important");
ring.style.setProperty("z-index", "2147483647", "important");
ring.style.setProperty("transform", "translate(-50%,-50%)", "important");
ring.style.setProperty("display", "none", "important");
document.body.append(ring);
const ringCtx = ring.getContext("2d")!;

function rotationZone(radius: number) {
  if (radius <= 88) return { step: 45, label: "45°", zone: "inner" as const };
  if (radius <= 148) return { step: 1, label: "1°", zone: "mid" as const };
  return { step: 0, label: "libre", zone: "outer" as const };
}
function drawRing(axis: Axis, degrees: number, zone: ReturnType<typeof rotationZone>) {
  const ctx = ringCtx;
  ctx.clearRect(0, 0, ring.width, ring.height);
  const cx = 210, cy = 210;
  const bands = [
    { r: 175, w: zone.zone === "outer" ? 48 : 42, stroke: "rgba(31,156,214,.30)" },
    { r: 116, w: zone.zone === "mid" ? 62 : 56, stroke: "rgba(61,174,102,.30)" },
    { r: 57, w: zone.zone === "inner" ? 58 : 52, stroke: "rgba(231,151,42,.34)" },
  ];
  for (const band of bands) {
    ctx.beginPath(); ctx.arc(cx, cy, band.r, 0, Math.PI * 2); ctx.lineWidth = band.w; ctx.strokeStyle = band.stroke; ctx.stroke();
  }
  ctx.lineCap = "butt";
  for (let deg = 0; deg < 360; deg += 2) {
    const a = (deg - 90) * Math.PI / 180;
    const major = deg % 10 === 0;
    const r1 = major ? 137 : 141, r2 = 148;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.lineWidth = major ? 1.4 : .7; ctx.strokeStyle = major ? "rgba(34,119,67,.48)" : "rgba(34,119,67,.20)"; ctx.stroke();
  }
  for (let deg = 0; deg < 360; deg += 45) {
    const a = (deg - 90) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 31, cy + Math.sin(a) * 31); ctx.lineTo(cx + Math.cos(a) * 86, cy + Math.sin(a) * 86);
    ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(174,102,11,.65)"; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, 198, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(15,125,177,.72)"; ctx.stroke();
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = `${axis.toUpperCase()} ${degrees.toFixed(1)}° · ${zone.label}`;
  const metrics = ctx.measureText(label);
  const w = metrics.width + 24;
  ctx.fillStyle = "rgba(255,255,255,.88)";
  ctx.strokeStyle = "rgba(93,124,141,.65)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(cx - w / 2, 389, w, 26, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#304d5e"; ctx.fillText(label, cx, 402);
}
function showRing(center: THREE.Vector3, axis: Axis, degrees: number, zone: ReturnType<typeof rotationZone>) {
  const p = projectClient(center);
  ring.style.setProperty("left", `${p.x}px`, "important");
  ring.style.setProperty("top", `${p.y}px`, "important");
  ring.style.setProperty("display", "block", "important");
  drawRing(axis, degrees, zone);
}
function hideRing() { ring.style.setProperty("display", "none", "important"); }

function rotationAxisFromDom(target: EventTarget | null): Axis | null {
  const handle = (target as HTMLElement | null)?.closest<HTMLElement>(".tm-rotate-handle");
  if (!handle) return null;
  if (handle.classList.contains("tm-rotate-x")) return "x";
  if (handle.classList.contains("tm-rotate-y")) return "y";
  if (handle.classList.contains("tm-rotate-z")) return "z";
  return null;
}
const controlRaycaster = new THREE.Raycaster();
const controlPointer = new THREE.Vector2();
function rotationAxisAt(clientX: number, clientY: number): Axis | null {
  const controls = editor.scene.getObjectByName("__tm_tinkercad_controls");
  if (!controls?.visible) return null;
  const rect = canvas.getBoundingClientRect();
  controlPointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  controlRaycaster.setFromCamera(controlPointer, editor.camera);
  // Search ALL intersections, not only the nearest one: an invisible pick mesh
  // from another control used to mask the intended rotation arrow.
  for (const intersection of controlRaycaster.intersectObject(controls, true)) {
    let current: THREE.Object3D | null = intersection.object;
    while (current && current !== controls) {
      const info = current.userData.tmControl as { kind?: string; axis?: Axis } | undefined;
      if (info?.kind === "rotate" && (info.axis === "x" || info.axis === "y" || info.axis === "z")) return info.axis;
      current = current.parent;
    }
  }
  return null;
}
function normalizeDegrees(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}
function snap(value: number, step: number) { return step ? Math.round(value / step) * step : value; }

let rotateDrag: RotateDrag | null = null;
function startRotate(event: PointerEvent, axis: Axis) {
  const active = editor.activeObject();
  const selection = editor.getSelection();
  if (!active || !selection.length) return false;
  const box = new THREE.Box3().setFromObject(active);
  if (box.isEmpty()) return false;
  const centerWorld = box.getCenter(new THREE.Vector3());
  const centerClient = projectClient(centerWorld);
  const startAngle = Math.atan2(event.clientY - centerClient.y, event.clientX - centerClient.x);
  editor.checkpoint();
  rotateDrag = {
    pointerId: event.pointerId,
    axis,
    centerWorld,
    centerClient,
    startAngle,
    states: selection.map((object) => ({ object, worldQuaternion: worldQuaternion(object) })),
  };
  const radius = Math.hypot(event.clientX - centerClient.x, event.clientY - centerClient.y);
  const zone = rotationZone(radius);
  showRing(centerWorld, axis, THREE.MathUtils.radToDeg((active.rotation as any)[axis]), zone);
  setStatus(`Rotar ${axis.toUpperCase()} GLOBAL · exterior libre · medio 1° · interior 45°`);
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
function updateRotate(event: PointerEvent) {
  const drag = rotateDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  let deltaDeg = normalizeDegrees(THREE.MathUtils.radToDeg(
    Math.atan2(event.clientY - drag.centerClient.y, event.clientX - drag.centerClient.x) - drag.startAngle,
  ));
  const radius = Math.hypot(event.clientX - drag.centerClient.x, event.clientY - drag.centerClient.y);
  const zone = rotationZone(radius);
  deltaDeg = snap(deltaDeg, zone.step);
  const deltaQ = new THREE.Quaternion().setFromAxisAngle(axisVector(drag.axis), THREE.MathUtils.degToRad(deltaDeg));
  for (const state of drag.states) setWorldQuaternion(state.object, deltaQ.clone().multiply(state.worldQuaternion));
  const active = editor.activeObject();
  const deg = active ? THREE.MathUtils.radToDeg((active.rotation as any)[drag.axis]) : deltaDeg;
  showRing(drag.centerWorld, drag.axis, deg, zone);
  rawEditor.refreshSelectionHelpers?.();
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
function finishRotate(event: PointerEvent, cancel: boolean) {
  const drag = rotateDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  rotateDrag = null;
  if (cancel) for (const state of drag.states) setWorldQuaternion(state.object, state.worldQuaternion);
  hideRing();
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(cancel ? "Rotación cancelada." : "Rotación confirmada.");
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

// v068-pre installed this capture hook before every historical widget handler.
// Replace its implementation with the current one.
window.__tmV068PointerdownOverride = (event: PointerEvent) => {
  if (event.button !== 0 || scaleDrag || rotateDrag) return false;
  const target = event.target as HTMLElement | null;
  const scaleHandle = target?.closest<HTMLElement>(".tm-scale-handle");
  if (scaleHandle && startScale(event, scaleHandle)) return true;

  const domAxis = rotationAxisFromDom(event.target);
  if (domAxis && startRotate(event, domAxis)) return true;

  if (event.target === canvas) {
    const worldAxis = rotationAxisAt(event.clientX, event.clientY);
    if (worldAxis && startRotate(event, worldAxis)) return true;
  }
  return false;
};

window.addEventListener("pointermove", (event) => {
  if (updateScale(event)) return;
  updateRotate(event);
}, true);
window.addEventListener("pointerup", (event) => {
  if (finishScale(event, false)) return;
  finishRotate(event, false);
}, true);
window.addEventListener("pointercancel", (event) => {
  if (finishScale(event, true)) return;
  finishRotate(event, true);
}, true);

setStatus("TinkerMatt v0.6.9 · escala de widget desde snapshot + rotación screen-space + anillo canvas.");
