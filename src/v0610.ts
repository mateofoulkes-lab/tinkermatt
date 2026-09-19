import * as THREE from "three";
import "./v0610.css";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV068PointerdownOverride?: (event: PointerEvent) => boolean;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type Sign = -1 | 1;
type MeshSnapshot = {
  mesh: THREE.Mesh;
  basePositions: Float32Array;
  world: THREE.Matrix4;
  worldInverse: THREE.Matrix4;
};
type ScaleDrag = {
  pointerId: number;
  source: HTMLElement;
  object: THREE.Object3D;
  startBox: THREE.Box3;
  startSize: THREE.Vector3;
  startCenter: THREE.Vector3;
  startMouse: THREE.Vector2;
  signs: Partial<Record<Axis, Sign>>;
  meshes: MeshSnapshot[];
  axisWorldPoint?: THREE.Vector3;
  planeStart?: THREE.Vector3;
};
type RotateState = { object: THREE.Object3D; quaternion: THREE.Quaternion };
type RotateDrag = {
  pointerId: number;
  axis: Axis;
  centerWorld: THREE.Vector3;
  centerClient: THREE.Vector2;
  startAngle: number;
  facing: number;
  states: RotateState[];
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.10 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.10";
const setStatus = (text: string) => { if (status) status.textContent = text; };

const axisVector = (axis: Axis) => axis === "x"
  ? new THREE.Vector3(1, 0, 0)
  : axis === "y"
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

function projectClient(world: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return new THREE.Vector2(
    rect.left + (p.x * 0.5 + 0.5) * rect.width,
    rect.top + (-p.y * 0.5 + 0.5) * rect.height,
  );
}
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
function insideViewport(clientX: number, clientY: number) {
  const rect = viewport.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
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
function normalizeDegrees(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}
function snap(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}

// -----------------------------------------------------------------------------
// WORLD-space scale widget, rebuilt directly from the drag-start vertex snapshot.
// For every vertex we go local -> start world -> scale only requested WORLD axes
// -> start local. Therefore scaling Z literally cannot alter a vertex's world Y.
// -----------------------------------------------------------------------------
function clearLegacyWorldDeform(root: THREE.Object3D) {
  delete root.userData.tmWorldDeform;
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) delete node.geometry.userData.tmWorldDeformApplied;
  });
}
function captureMeshes(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const result: MeshSnapshot[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.updateMatrixWorld(true);
    const position = node.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!position || position.itemSize < 3) return;
    const base = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      base[i * 3] = position.getX(i);
      base[i * 3 + 1] = position.getY(i);
      base[i * 3 + 2] = position.getZ(i);
    }
    result.push({
      mesh: node,
      basePositions: base,
      world: node.matrixWorld.clone(),
      worldInverse: node.matrixWorld.clone().invert(),
    });
  });
  return result;
}
function restoreMeshSnapshot(item: MeshSnapshot) {
  const position = item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) return;
  for (let i = 0; i < position.count; i += 1) {
    position.setXYZ(i, item.basePositions[i * 3], item.basePositions[i * 3 + 1], item.basePositions[i * 3 + 2]);
  }
  position.needsUpdate = true;
  item.mesh.geometry.computeVertexNormals();
  item.mesh.geometry.computeBoundingBox();
  item.mesh.geometry.computeBoundingSphere();
}
function applyWorldScaleFromSnapshot(drag: ScaleDrag, factors: THREE.Vector3, pivot: THREE.Vector3) {
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  for (const item of drag.meshes) {
    const position = item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!position) continue;
    for (let i = 0; i < position.count; i += 1) {
      local.set(item.basePositions[i * 3], item.basePositions[i * 3 + 1], item.basePositions[i * 3 + 2]);
      world.copy(local).applyMatrix4(item.world);
      world.x = pivot.x + (world.x - pivot.x) * factors.x;
      world.y = pivot.y + (world.y - pivot.y) * factors.y;
      world.z = pivot.z + (world.z - pivot.z) * factors.z;
      local.copy(world).applyMatrix4(item.worldInverse);
      position.setXYZ(i, local.x, local.y, local.z);
    }
    position.needsUpdate = true;
    item.mesh.geometry.computeVertexNormals();
    item.mesh.geometry.computeBoundingBox();
    item.mesh.geometry.computeBoundingSphere();
  }
  drag.object.updateMatrixWorld(true);
  rawEditor.refreshSelectionHelpers?.();
}
function scaleSigns(handle: HTMLElement): Partial<Record<Axis, Sign>> | null {
  if (handle.classList.contains("tm-z-handle")) return { z: 1 };
  if (handle.classList.contains("tm-edge-handle")) {
    const axis = handle.dataset.axis as Axis | undefined;
    if (axis !== "x" && axis !== "y" && axis !== "z") return null;
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
function handleWorldPoint(box: THREE.Box3, signs: Partial<Record<Axis, Sign>>) {
  const p = box.getCenter(new THREE.Vector3());
  for (const axis of Object.keys(signs) as Axis[]) p[axis] = signs[axis]! > 0 ? box.max[axis] : box.min[axis];
  if (signs.x && signs.y && !signs.z) p.z = box.min.z;
  return p;
}
function pointOnHorizontalPlane(clientX: number, clientY: number, z: number) {
  return pointerRay(clientX, clientY).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3());
}

// Invert perspective projection numerically so the dragged WORLD-axis handle
// remains under the mouse instead of using an approximate pixels-per-mm ratio.
function solveAxisWorldDelta(
  clientX: number,
  clientY: number,
  startMouse: THREE.Vector2,
  worldPoint: THREE.Vector3,
  axis: Axis,
) {
  const direction = axisVector(axis);
  const p0 = projectClient(worldPoint);
  const p1 = projectClient(worldPoint.clone().add(direction));
  const screenAxis = p1.sub(p0);
  const pixelsPerUnit = screenAxis.length();
  if (pixelsPerUnit < 1e-5) return 0;
  screenAxis.normalize();
  const targetPx = new THREE.Vector2(clientX - startMouse.x, clientY - startMouse.y).dot(screenAxis);
  let t = targetPx / pixelsPerUnit;
  const scalarAt = (value: number) => projectClient(worldPoint.clone().addScaledVector(direction, value)).sub(p0).dot(screenAxis);
  for (let i = 0; i < 7; i += 1) {
    const f = scalarAt(t) - targetPx;
    if (Math.abs(f) < 0.02) break;
    const eps = Math.max(0.01, Math.abs(t) * 0.002);
    const derivative = (scalarAt(t + eps) - scalarAt(t - eps)) / (2 * eps);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-5) break;
    t -= f / derivative;
    t = THREE.MathUtils.clamp(t, -10000, 10000);
  }
  return Number.isFinite(t) ? t : 0;
}

function syncSizeReadouts(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  const map: Record<Axis, string[]> = {
    x: [".tm-measure-x", "#size-x"],
    y: [".tm-measure-y", "#size-y"],
    z: [".tm-measure-z", "#size-z"],
  };
  for (const axis of ["x", "y", "z"] as const) {
    for (const selector of map[axis]) {
      const input = document.querySelector<HTMLInputElement>(selector);
      if (input && document.activeElement !== input) input.value = size[axis].toFixed(2);
    }
  }
  const badge = document.querySelector<HTMLElement>(".tm-delta-badge");
  if (badge) {
    badge.classList.remove("hidden");
    badge.textContent = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} mm · GLOBAL`;
  }
}

let scaleDrag: ScaleDrag | null = null;
function startScale(event: PointerEvent, source: HTMLElement) {
  const object = editor.activeObject();
  const signs = scaleSigns(source);
  if (!object || !signs) return false;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return false;
  clearLegacyWorldDeform(object);
  editor.checkpoint();
  const meshes = captureMeshes(object);
  if (!meshes.length) return false;
  const axes = Object.keys(signs) as Axis[];
  const drag: ScaleDrag = {
    pointerId: event.pointerId,
    source,
    object,
    startBox: box.clone(),
    startSize: box.getSize(new THREE.Vector3()),
    startCenter: box.getCenter(new THREE.Vector3()),
    startMouse: new THREE.Vector2(event.clientX, event.clientY),
    signs,
    meshes,
  };
  if (axes.length === 1) drag.axisWorldPoint = handleWorldPoint(box, signs);
  else drag.planeStart = pointOnHorizontalPlane(event.clientX, event.clientY, box.min.z) ?? undefined;
  scaleDrag = drag;
  try { source.setPointerCapture(event.pointerId); } catch { /* optional */ }
  syncSizeReadouts(object);
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
  if (axes.length === 1 && drag.axisWorldPoint) {
    deltas[axes[0]] = solveAxisWorldDelta(event.clientX, event.clientY, drag.startMouse, drag.axisWorldPoint, axes[0]);
  } else {
    const current = pointOnHorizontalPlane(event.clientX, event.clientY, drag.startBox.min.z);
    if (current && drag.planeStart) {
      deltas.x = current.x - drag.planeStart.x;
      deltas.y = current.y - drag.planeStart.y;
    }
  }

  const factors = new THREE.Vector3(1, 1, 1);
  const pivot = drag.startCenter.clone();
  const snapCfg = editor.getSnap();
  const minimum = 0.1;
  for (const axis of axes) {
    const sign = drag.signs[axis]!;
    let delta = deltas[axis] ?? 0;
    if (snapCfg.enabled) {
      const step = snapCfg.gridSize * (event.ctrlKey || event.metaKey ? 0.1 : 1);
      delta = snap(delta, step);
    }
    const start = Math.max(minimum, drag.startSize[axis]);
    const target = Math.max(minimum, start + delta * sign * (event.altKey ? 2 : 1));
    factors[axis] = target / start;
    if (!event.altKey) pivot[axis] = sign > 0 ? drag.startBox.min[axis] : drag.startBox.max[axis];
  }
  if (event.shiftKey && axes.length) {
    const ratio = factors[axes[0]];
    factors.set(ratio, ratio, ratio);
    if (!event.altKey) {
      // Uniform scaling keeps the selected object's original center unless the
      // user explicitly grabbed multiple directional faces.
      if (axes.length === 1) pivot.copy(drag.startCenter);
    }
  }

  applyWorldScaleFromSnapshot(drag, factors, pivot);
  syncSizeReadouts(drag.object);
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
function finishScale(event: PointerEvent, cancel: boolean) {
  const drag = scaleDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  scaleDrag = null;
  if (cancel) for (const item of drag.meshes) restoreMeshSnapshot(item);
  try { drag.source.releasePointerCapture(event.pointerId); } catch { /* optional */ }
  document.querySelector<HTMLElement>(".tm-delta-badge")?.classList.add("hidden");
  syncSizeReadouts(drag.object);
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(cancel ? "Escala cancelada." : "Escala confirmada.");
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

// -----------------------------------------------------------------------------
// Rotation guide + WORLD rotation. The visible 3D controls are the v0.4.4 group
// (__tm_tinkercad_controls_v044). Previous releases were raycasting the hidden
// v0.4.3 group, so the new rotation handler (and therefore the ring) never ran.
// -----------------------------------------------------------------------------
const rotationCanvas = document.createElement("canvas");
rotationCanvas.id = "tm-rotation-ring-v0610";
rotationCanvas.width = 440;
rotationCanvas.height = 440;
Object.assign(rotationCanvas.style, {
  position: "fixed",
  width: "440px",
  height: "440px",
  transform: "translate(-50%, -50%)",
  pointerEvents: "none",
  zIndex: "2147483647",
  display: "none",
});
rotationCanvas.style.setProperty("position", "fixed", "important");
rotationCanvas.style.setProperty("z-index", "2147483647", "important");
rotationCanvas.style.setProperty("pointer-events", "none", "important");
document.body.append(rotationCanvas);
const rotationCtx = rotationCanvas.getContext("2d")!;
function rotationZone(radius: number) {
  if (radius <= 92) return { step: 45, label: "45°", zone: "inner" as const };
  if (radius <= 154) return { step: 1, label: "1°", zone: "mid" as const };
  return { step: 0, label: "libre", zone: "outer" as const };
}
function drawRotationRing(axis: Axis, degrees: number, zone: ReturnType<typeof rotationZone>) {
  const ctx = rotationCtx;
  const cx = 220, cy = 220;
  ctx.clearRect(0, 0, 440, 440);
  const bands = [
    { r: 187, width: zone.zone === "outer" ? 48 : 42, color: "rgba(20,151,211,.32)" },
    { r: 124, width: zone.zone === "mid" ? 60 : 54, color: "rgba(52,166,91,.31)" },
    { r: 61, width: zone.zone === "inner" ? 58 : 52, color: "rgba(229,145,31,.36)" },
  ];
  for (const band of bands) {
    ctx.beginPath(); ctx.arc(cx, cy, band.r, 0, Math.PI * 2);
    ctx.lineWidth = band.width; ctx.strokeStyle = band.color; ctx.stroke();
  }
  for (let deg = 0; deg < 360; deg += 2) {
    const a = THREE.MathUtils.degToRad(deg - 90);
    const major = deg % 10 === 0;
    const r1 = major ? 146 : 150, r2 = 157;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.lineWidth = major ? 1.3 : 0.65;
    ctx.strokeStyle = major ? "rgba(28,112,60,.52)" : "rgba(28,112,60,.22)";
    ctx.stroke();
  }
  for (let deg = 0; deg < 360; deg += 45) {
    const a = THREE.MathUtils.degToRad(deg - 90);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 31, cy + Math.sin(a) * 31);
    ctx.lineTo(cx + Math.cos(a) * 92, cy + Math.sin(a) * 92);
    ctx.lineWidth = 1.7; ctx.strokeStyle = "rgba(172,94,4,.72)"; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, 211, 0, Math.PI * 2);
  ctx.lineWidth = 2; ctx.strokeStyle = "rgba(4,123,178,.78)"; ctx.stroke();
  const label = `${axis.toUpperCase()} ${degrees.toFixed(1)}° · ${zone.label}`;
  ctx.font = "800 12px system-ui,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const width = ctx.measureText(label).width + 24;
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.strokeStyle = "rgba(80,112,132,.68)";
  ctx.beginPath(); ctx.roundRect(cx - width / 2, 405, width, 27, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#294b5f"; ctx.fillText(label, cx, 418);
}
function showRotationRing(center: THREE.Vector3, axis: Axis, degrees: number, zone: ReturnType<typeof rotationZone>) {
  const p = projectClient(center);
  rotationCanvas.style.setProperty("left", `${p.x}px`, "important");
  rotationCanvas.style.setProperty("top", `${p.y}px`, "important");
  rotationCanvas.style.setProperty("display", "block", "important");
  rotationCanvas.style.setProperty("visibility", "visible", "important");
  rotationCanvas.style.setProperty("opacity", "1", "important");
  drawRotationRing(axis, degrees, zone);
}
function hideRotationRing() {
  rotationCanvas.style.setProperty("display", "none", "important");
}
function rotationAxisFromDom(target: EventTarget | null): Axis | null {
  const handle = (target as HTMLElement | null)?.closest<HTMLElement>(".tm-rotate-handle");
  if (!handle) return null;
  if (handle.classList.contains("tm-rotate-x")) return "x";
  if (handle.classList.contains("tm-rotate-y")) return "y";
  if (handle.classList.contains("tm-rotate-z")) return "z";
  return null;
}
const rotationRaycaster = new THREE.Raycaster();
const rotationPointer = new THREE.Vector2();
function rotationAxisAt(clientX: number, clientY: number): Axis | null {
  const groups = [
    editor.scene.getObjectByName("__tm_tinkercad_controls_v044"),
    editor.scene.getObjectByName("__tm_tinkercad_controls"),
  ].filter((group): group is THREE.Object3D => Boolean(group?.visible));
  const rect = canvas.getBoundingClientRect();
  rotationPointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  rotationRaycaster.setFromCamera(rotationPointer, editor.camera);
  for (const group of groups) {
    for (const hit of rotationRaycaster.intersectObject(group, true)) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node !== group) {
        const info = node.userData.tmControl as { kind?: string; axis?: Axis } | undefined;
        if (info?.kind === "rotate" && (info.axis === "x" || info.axis === "y" || info.axis === "z")) return info.axis;
        node = node.parent;
      }
    }
  }
  return null;
}
let rotateDrag: RotateDrag | null = null;
function startRotate(event: PointerEvent, axis: Axis) {
  const active = editor.activeObject();
  const selection = editor.getSelection();
  if (!active || !selection.length) return false;
  active.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(active);
  if (box.isEmpty()) return false;
  const centerWorld = box.getCenter(new THREE.Vector3());
  const centerClient = projectClient(centerWorld);
  const startAngle = Math.atan2(event.clientY - centerClient.y, event.clientX - centerClient.x);
  const facing = editor.camera.position.clone().sub(centerWorld).dot(axisVector(axis)) >= 0 ? 1 : -1;
  editor.checkpoint();
  rotateDrag = {
    pointerId: event.pointerId,
    axis,
    centerWorld,
    centerClient,
    startAngle,
    facing,
    states: selection.map((object) => ({ object, quaternion: worldQuaternion(object) })),
  };
  const zone = rotationZone(Math.hypot(event.clientX - centerClient.x, event.clientY - centerClient.y));
  showRotationRing(centerWorld, axis, THREE.MathUtils.radToDeg((active.rotation as any)[axis]), zone);
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
  deltaDeg *= -drag.facing;
  const zone = rotationZone(Math.hypot(event.clientX - drag.centerClient.x, event.clientY - drag.centerClient.y));
  deltaDeg = snap(deltaDeg, zone.step);
  const delta = new THREE.Quaternion().setFromAxisAngle(axisVector(drag.axis), THREE.MathUtils.degToRad(deltaDeg));
  for (const state of drag.states) setWorldQuaternion(state.object, delta.clone().multiply(state.quaternion));
  const active = editor.activeObject();
  const degrees = active ? THREE.MathUtils.radToDeg((active.rotation as any)[drag.axis]) : deltaDeg;
  showRotationRing(drag.centerWorld, drag.axis, degrees, zone);
  rawEditor.refreshSelectionHelpers?.();
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
function finishRotate(event: PointerEvent, cancel: boolean) {
  const drag = rotateDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  rotateDrag = null;
  if (cancel) for (const state of drag.states) setWorldQuaternion(state.object, state.quaternion);
  hideRotationRing();
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(cancel ? "Rotación cancelada." : "Rotación confirmada.");
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

// This capture hook was installed near the beginning of bootstrap. Replacing its
// callback here lets the current release own scale/rotation before all legacy
// target handlers see the pointer event.
window.__tmV068PointerdownOverride = (event: PointerEvent) => {
  if (event.button !== 0 || scaleDrag || rotateDrag) return false;
  const target = event.target as HTMLElement | null;
  const scaleHandle = target?.closest<HTMLElement>(".tm-scale-handle");
  if (scaleHandle && startScale(event, scaleHandle)) return true;
  const domAxis = rotationAxisFromDom(event.target);
  if (domAxis && startRotate(event, domAxis)) return true;
  if (event.target === canvas && insideViewport(event.clientX, event.clientY)) {
    const axis = rotationAxisAt(event.clientX, event.clientY);
    if (axis && startRotate(event, axis)) return true;
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

// -----------------------------------------------------------------------------
// Surface shading preference. Default = FACETED, because CAD geometry should
// show its real polygonal structure unless the user explicitly asks to smooth it.
// -----------------------------------------------------------------------------
const shadingKey = "tinkermatt-smooth-surfaces";
let smoothSurfaces = localStorage.getItem(shadingKey) === "1";
function setMaterialShading(material: THREE.Material) {
  if (!("flatShading" in material)) return;
  const anyMaterial = material as THREE.Material & { flatShading: boolean };
  const desiredFlat = !smoothSurfaces;
  if (anyMaterial.flatShading === desiredFlat) return;
  anyMaterial.flatShading = desiredFlat;
  material.needsUpdate = true;
}
function applySurfaceShading() {
  for (const root of editor.getSceneRoots()) {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(setMaterialShading);
    });
  }
}
const settings = document.querySelector<HTMLElement>(".tm-settings-menu");
if (settings && !settings.querySelector(".tm-surface-shading-option")) {
  const option = document.createElement("label");
  option.className = "tm-surface-shading-option";
  option.innerHTML = `
    <span class="tm-surface-shading-copy">
      <b>Suavizar superficies</b>
      <small>Desactivado muestra las facetas reales de la geometría</small>
    </span>
    <input type="checkbox" aria-label="Suavizar superficies">`;
  const checkbox = option.querySelector<HTMLInputElement>("input")!;
  checkbox.checked = smoothSurfaces;
  const install = settings.querySelector(".tm-install-pwa");
  if (install) settings.insertBefore(option, install);
  else settings.append(option);
  checkbox.addEventListener("change", () => {
    smoothSurfaces = checkbox.checked;
    localStorage.setItem(shadingKey, smoothSurfaces ? "1" : "0");
    applySurfaceShading();
    setStatus(smoothSurfaces ? "Superficies suavizadas." : "Superficies facetadas: geometría real visible.");
  });
}
editor.on("changed", applySurfaceShading);
editor.on("selection", applySurfaceShading);
queueMicrotask(applySurfaceShading);
window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  getSurfaceSmoothing: () => smoothSurfaces,
  setSurfaceSmoothing: (enabled: boolean) => {
    smoothSurfaces = Boolean(enabled);
    localStorage.setItem(shadingKey, smoothSurfaces ? "1" : "0");
    const checkbox = document.querySelector<HTMLInputElement>(".tm-surface-shading-option input");
    if (checkbox) checkbox.checked = smoothSurfaces;
    applySurfaceShading();
    return smoothSurfaces;
  },
});

setStatus("TinkerMatt v0.6.10 · escala WORLD por vértices + anillo sobre controles reales + facetado configurable.");
