import * as THREE from "three";
import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV064ScaleKeydownOverride?: (event: KeyboardEvent) => boolean;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type MeshSnapshot = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  meshToRoot: THREE.Matrix4;
};
type RootScaleSnapshot = {
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  rootWorld: THREE.Matrix4;
  box: THREE.Box3;
  totalDeform: THREE.Matrix4;
  meshes: MeshSnapshot[];
};
type WidgetScaleDrag = {
  pointerId: number;
  source: HTMLElement;
  startX: number;
  startY: number;
  signs: Partial<Record<Axis, -1 | 1>>;
  snapshot: RootScaleSnapshot;
};
type ScaleModal = {
  axis: Axis | null;
  space: "global" | "local";
  startPointer: { x: number; y: number };
  pivotScreen: { x: number; y: number };
  ratio: number;
  snapshots: RootScaleSnapshot[];
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.4 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const status = document.querySelector<HTMLElement>("#status");
const modalBadge = document.querySelector<HTMLElement>(".tm-modal-badge");
const deltaBadge = document.querySelector<HTMLElement>(".tm-delta-badge");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.4";
const setStatus = (text: string) => { if (status) status.textContent = text; };

const axisVector = (axis: Axis) => axis === "x"
  ? new THREE.Vector3(1, 0, 0)
  : axis === "y"
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

function project(world: THREE.Vector3) {
  const rect = viewport.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return {
    x: (p.x * 0.5 + 0.5) * rect.width,
    y: (-p.y * 0.5 + 0.5) * rect.height,
  };
}

function screenAxis(axis: Axis, origin: THREE.Vector3) {
  const a = project(origin);
  const b = project(origin.clone().add(axisVector(axis)));
  return new THREE.Vector2(b.x - a.x, b.y - a.y);
}

function pointerScalarOnAxis(dx: number, dy: number, axis: Axis, origin: THREE.Vector3) {
  const v = screenAxis(axis, origin);
  const lenSq = v.lengthSq();
  if (lenSq < 0.0001) return 0;
  return (dx * v.x + dy * v.y) / lenSq;
}

function snapScalar(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}

function matrixSignature(matrix: THREE.Matrix4) {
  return matrix.elements.map((value) => Number(value.toFixed(7))).join(",");
}

function storedDeform(object: THREE.Object3D) {
  const raw = object.userData.tmWorldDeform;
  if (Array.isArray(raw) && raw.length === 16 && raw.every((value) => Number.isFinite(Number(value)))) {
    return new THREE.Matrix4().fromArray(raw.map(Number));
  }
  return new THREE.Matrix4();
}

function storeDeform(object: THREE.Object3D, matrix: THREE.Matrix4) {
  const identity = new THREE.Matrix4();
  const sameAsIdentity = matrix.elements.every((value, index) => Math.abs(value - identity.elements[index]) < 1e-10);
  if (sameAsIdentity) delete object.userData.tmWorldDeform;
  else object.userData.tmWorldDeform = matrix.toArray();
}

function markGeometry(mesh: THREE.Mesh, total: THREE.Matrix4) {
  mesh.geometry.userData.tmWorldDeformApplied = matrixSignature(total);
}

function refreshGeometryBounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function captureRootScaleSnapshot(object: THREE.Object3D): RootScaleSnapshot {
  object.updateMatrixWorld(true);
  const rootWorld = object.matrixWorld.clone();
  const invRoot = rootWorld.clone().invert();
  const totalDeform = storedDeform(object);
  const meshes: MeshSnapshot[] = [];
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.updateMatrixWorld(true);
    meshes.push({
      mesh: node,
      geometry: node.geometry.clone(),
      meshToRoot: invRoot.clone().multiply(node.matrixWorld),
    });
  });
  return {
    object,
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
    rootWorld,
    box: new THREE.Box3().setFromObject(object),
    totalDeform,
    meshes,
  };
}

function restoreSnapshot(snapshot: RootScaleSnapshot) {
  const { object } = snapshot;
  object.position.copy(snapshot.position);
  object.quaternion.copy(snapshot.quaternion);
  object.scale.copy(snapshot.scale);
  object.updateMatrixWorld(true);
  storeDeform(object, snapshot.totalDeform);
  for (const item of snapshot.meshes) {
    item.mesh.geometry.copy(item.geometry);
    refreshGeometryBounds(item.mesh.geometry);
    markGeometry(item.mesh, snapshot.totalDeform);
  }
}

function disposeSnapshot(snapshot: RootScaleSnapshot) {
  for (const item of snapshot.meshes) item.geometry.dispose();
}

function worldScaleMatrix(pivot: THREE.Vector3, scale: THREE.Vector3) {
  return new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

function applyWorldScaleFromSnapshot(snapshot: RootScaleSnapshot, scale: THREE.Vector3, pivot: THREE.Vector3) {
  restoreSnapshot(snapshot);
  const worldScale = worldScaleMatrix(pivot, scale);
  const rootDelta = snapshot.rootWorld.clone().invert().multiply(worldScale).multiply(snapshot.rootWorld);
  const total = rootDelta.clone().multiply(snapshot.totalDeform);
  const signature = matrixSignature(total);

  for (const item of snapshot.meshes) {
    const localDelta = item.meshToRoot.clone().invert().multiply(rootDelta).multiply(item.meshToRoot);
    item.mesh.geometry.applyMatrix4(localDelta);
    refreshGeometryBounds(item.mesh.geometry);
    item.mesh.geometry.userData.tmWorldDeformApplied = signature;
  }
  storeDeform(snapshot.object, total);
  snapshot.object.updateMatrixWorld(true);
}

function reapplyStoredDeforms() {
  for (const root of editor.getSceneRoots()) {
    const candidates: THREE.Object3D[] = [];
    root.traverse((node) => {
      if (Array.isArray(node.userData.tmWorldDeform) && node.userData.tmWorldDeform.length === 16) candidates.push(node);
    });
    for (const object of candidates) {
      const total = storedDeform(object);
      const signature = matrixSignature(total);
      object.updateMatrixWorld(true);
      const invRoot = object.matrixWorld.clone().invert();
      object.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        if (node.geometry.userData.tmWorldDeformApplied === signature) return;
        node.updateMatrixWorld(true);
        const meshToRoot = invRoot.clone().multiply(node.matrixWorld);
        const localDelta = meshToRoot.clone().invert().multiply(total).multiply(meshToRoot);
        node.geometry.applyMatrix4(localDelta);
        refreshGeometryBounds(node.geometry);
        node.geometry.userData.tmWorldDeformApplied = signature;
      });
    }
  }
}

let reapplying = false;
editor.on("changed", () => {
  if (reapplying) return;
  reapplying = true;
  try { reapplyStoredDeforms(); }
  finally { reapplying = false; }
});
queueMicrotask(reapplyStoredDeforms);

// -----------------------------------------------------------------------------
// Absolute world dimensions.
// X/Y/Z in both inspector and Tinker widget now literally mean world X/Y/Z.
// A rotated object is deformed along the requested world direction rather than
// guessing which local scale component happens to contribute most to its AABB.
// -----------------------------------------------------------------------------
rawEditor.setActiveDimension = (axis: Axis, value: number) => {
  const object = editor.activeObject();
  if (!object || !Number.isFinite(value) || value <= 0) return;
  const snapshot = captureRootScaleSnapshot(object);
  const size = snapshot.box.getSize(new THREE.Vector3());
  const current = size[axis];
  if (!(current > 1e-8)) {
    disposeSnapshot(snapshot);
    return;
  }
  const ratio = Math.max(0.0001, value / current);
  const scale = new THREE.Vector3(1, 1, 1);
  scale[axis] = ratio;
  applyWorldScaleFromSnapshot(snapshot, scale, snapshot.box.getCenter(new THREE.Vector3()));
  disposeSnapshot(snapshot);
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
};

// -----------------------------------------------------------------------------
// Tinker widget scale handles: always world-space.
// Numeric dimension fields already route through setActiveDimension above. The
// square XY handles and Z handle are intercepted before the legacy local-scaling
// drag starts, so they now deform strictly along world X/Y/Z too.
// -----------------------------------------------------------------------------
let widgetDrag: WidgetScaleDrag | null = null;

function beginWidgetScale(event: PointerEvent, source: HTMLElement, signs: Partial<Record<Axis, -1 | 1>>) {
  const object = editor.activeObject();
  if (!object || event.button !== 0) return;
  editor.checkpoint();
  widgetDrag = {
    pointerId: event.pointerId,
    source,
    startX: event.clientX,
    startY: event.clientY,
    signs,
    snapshot: captureRootScaleSnapshot(object),
  };
  try { source.setPointerCapture(event.pointerId); } catch { /* no-op */ }
  deltaBadge?.classList.remove("hidden");
  event.preventDefault();
  event.stopImmediatePropagation();
}

for (const handle of document.querySelectorAll<HTMLElement>(".tm-corner-handle")) {
  handle.addEventListener("pointerdown", (event) => {
    beginWidgetScale(event, handle, {
      x: Number(handle.dataset.sx) < 0 ? -1 : 1,
      y: Number(handle.dataset.sy) < 0 ? -1 : 1,
    });
  }, true);
}
const zHandle = document.querySelector<HTMLElement>(".tm-z-handle");
zHandle?.addEventListener("pointerdown", (event) => beginWidgetScale(event, zHandle, { z: 1 }), true);

window.addEventListener("pointermove", (event) => {
  const drag = widgetDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  const startSize = drag.snapshot.box.getSize(new THREE.Vector3());
  const startCenter = drag.snapshot.box.getCenter(new THREE.Vector3());
  const scale = new THREE.Vector3(1, 1, 1);
  const pivot = startCenter.clone();
  const axes = Object.keys(drag.signs) as Axis[];
  const changes: Partial<Record<Axis, number>> = {};

  for (const axis of axes) {
    const sign = drag.signs[axis]!;
    let amount = pointerScalarOnAxis(dx, dy, axis, startCenter) * sign;
    const snap = editor.getSnap();
    if (snap.enabled) amount = snapScalar(amount, snap.gridSize * (event.altKey ? 0.1 : 1));
    changes[axis] = amount;
  }

  if (event.shiftKey) {
    const axis = axes[0] ?? "x";
    const base = Math.max(0.0001, startSize[axis]);
    const ratio = Math.max(0.0001, (base + (changes[axis] ?? 0)) / base);
    scale.set(ratio, ratio, ratio);
    if (!event.altKey) {
      for (const selectedAxis of axes) {
        const sign = drag.signs[selectedAxis]!;
        pivot[selectedAxis] = sign > 0 ? drag.snapshot.box.min[selectedAxis] : drag.snapshot.box.max[selectedAxis];
      }
    }
  } else {
    for (const axis of axes) {
      const base = Math.max(0.0001, startSize[axis]);
      const target = Math.max(0.01, base + (changes[axis] ?? 0));
      scale[axis] = target / base;
      if (!event.altKey) {
        const sign = drag.signs[axis]!;
        pivot[axis] = sign > 0 ? drag.snapshot.box.min[axis] : drag.snapshot.box.max[axis];
      }
    }
  }

  applyWorldScaleFromSnapshot(drag.snapshot, scale, pivot);
  const now = new THREE.Box3().setFromObject(drag.snapshot.object).getSize(new THREE.Vector3());
  if (deltaBadge) deltaBadge.textContent = `${now.x.toFixed(1)} × ${now.y.toFixed(1)} × ${now.z.toFixed(1)} mm · global`;
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function finishWidgetScale(event: PointerEvent, cancel: boolean) {
  const drag = widgetDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  widgetDrag = null;
  if (cancel) restoreSnapshot(drag.snapshot);
  disposeSnapshot(drag.snapshot);
  deltaBadge?.classList.add("hidden");
  try { drag.source.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}
window.addEventListener("pointerup", (event) => finishWidgetScale(event, false), true);
window.addEventListener("pointercancel", (event) => finishWidgetScale(event, true), true);

// -----------------------------------------------------------------------------
// Blender-style S axis semantics.
// S, X   = global/world X
// S, X,X = native/local X
// Same for Y/Z. Repeating the same axis toggles global/local.
// Uniform S is coordinate-system independent and keeps the old behavior.
// -----------------------------------------------------------------------------
let lastPointer = { x: 0, y: 0 };
let lastModifiers = { shift: false, alt: false };
let scaleModal: ScaleModal | null = null;

window.addEventListener("pointermove", (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
  lastModifiers = { shift: event.shiftKey, alt: event.altKey };
  if (scaleModal) updateScaleModal(event.clientX, event.clientY, event.shiftKey, event.altKey);
}, true);

function restoreModalStart() {
  if (!scaleModal) return;
  for (const snapshot of scaleModal.snapshots) restoreSnapshot(snapshot);
}

function currentModalRatio(clientX: number, clientY: number, shift: boolean, alt: boolean) {
  if (!scaleModal) return 1;
  const rect = viewport.getBoundingClientRect();
  const startR = Math.max(20, Math.hypot(
    scaleModal.startPointer.x - rect.left - scaleModal.pivotScreen.x,
    scaleModal.startPointer.y - rect.top - scaleModal.pivotScreen.y,
  ));
  const currentR = Math.max(2, Math.hypot(
    clientX - rect.left - scaleModal.pivotScreen.x,
    clientY - rect.top - scaleModal.pivotScreen.y,
  ));
  let ratio = currentR / startR;
  const step = shift ? 0.25 : alt ? 0.01 : 0.05;
  ratio = Math.max(0.01, snapScalar(ratio, step));
  return ratio;
}

function updateScaleModal(clientX: number, clientY: number, shift: boolean, alt: boolean) {
  const modal = scaleModal;
  if (!modal) return;
  const ratio = currentModalRatio(clientX, clientY, shift, alt);
  modal.ratio = ratio;
  restoreModalStart();

  if (!modal.axis) {
    for (const snapshot of modal.snapshots) {
      snapshot.object.scale.set(
        snapshot.scale.x * ratio,
        snapshot.scale.y * ratio,
        snapshot.scale.z * ratio,
      );
      snapshot.object.updateMatrixWorld(true);
    }
    setStatus(`Escala uniforme: ${(ratio * 100).toFixed(1)}%`);
  } else if (modal.space === "local") {
    for (const snapshot of modal.snapshots) {
      snapshot.object.scale.copy(snapshot.scale);
      snapshot.object.scale[modal.axis] = snapshot.scale[modal.axis] * ratio;
      snapshot.object.updateMatrixWorld(true);
    }
    setStatus(`Escala ${modal.axis.toUpperCase()} LOCAL: ${(ratio * 100).toFixed(1)}%`);
  } else {
    const axisScale = new THREE.Vector3(1, 1, 1);
    axisScale[modal.axis] = ratio;
    for (const snapshot of modal.snapshots) {
      applyWorldScaleFromSnapshot(snapshot, axisScale, snapshot.box.getCenter(new THREE.Vector3()));
    }
    setStatus(`Escala ${modal.axis.toUpperCase()} GLOBAL: ${(ratio * 100).toFixed(1)}%`);
  }

  if (modalBadge) {
    const axisText = modal.axis ? `${modal.axis.toUpperCase()} ${modal.space === "local" ? "LOCAL" : "GLOBAL"}` : "uniforme";
    modalBadge.textContent = `S · ${axisText} · repetir eje cambia global/local · click/Enter confirma · Esc cancela`;
  }
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}

function beginScaleModal() {
  const selection = editor.getSelection();
  const active = editor.activeObject();
  if (!selection.length || !active) return;
  editor.checkpoint();
  active.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(active);
  const center = box.getCenter(new THREE.Vector3());
  const pivotScreen = project(center);
  const rect = viewport.getBoundingClientRect();
  const sx = lastPointer.x || rect.left + pivotScreen.x + 80;
  const sy = lastPointer.y || rect.top + pivotScreen.y;
  scaleModal = {
    axis: null,
    space: "global",
    startPointer: { x: sx, y: sy },
    pivotScreen,
    ratio: 1,
    snapshots: selection.map(captureRootScaleSnapshot),
  };
  editor.setTransformMode("scale");
  modalBadge?.classList.remove("hidden");
  if (modalBadge) modalBadge.textContent = "S · escala uniforme · X/Y/Z = global · repetir eje = local · click/Enter confirma · Esc cancela";
  setStatus("S · escala uniforme. X/Y/Z restringe en GLOBAL; repetí el mismo eje para LOCAL.");
}

function finishScaleModal(cancel: boolean) {
  const modal = scaleModal;
  if (!modal) return;
  if (cancel) for (const snapshot of modal.snapshots) restoreSnapshot(snapshot);
  for (const snapshot of modal.snapshots) disposeSnapshot(snapshot);
  scaleModal = null;
  modalBadge?.classList.add("hidden");
  editor.clearAxisConstraint();
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(cancel ? "Escala cancelada." : "Escala confirmada.");
}

window.__tmV064ScaleKeydownOverride = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
  if (typing) return false;
  const key = event.key.toLowerCase();

  if (scaleModal) {
    if (key === "x" || key === "y" || key === "z") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (scaleModal.axis === key) scaleModal.space = scaleModal.space === "global" ? "local" : "global";
      else {
        scaleModal.axis = key;
        scaleModal.space = "global";
      }
      editor.constrainAxis(key);
      updateScaleModal(lastPointer.x, lastPointer.y, lastModifiers.shift, lastModifiers.alt);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishScaleModal(true);
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishScaleModal(false);
      return true;
    }
    if (key === "s") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
    return false;
  }

  if (key === "s" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!editor.getSelection().length) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginScaleModal();
    return true;
  }
  return false;
};

window.addEventListener("pointerdown", (event) => {
  if (!scaleModal) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishScaleModal(false);
}, true);

editor.on("selection", () => {
  if (scaleModal) finishScaleModal(true);
});

Object.assign(window.tinkerMatt, {
  setWorldDimension: (axis: Axis, value: number) => rawEditor.setActiveDimension(axis, value),
});

setStatus("TinkerMatt v0.6.4 · dimensiones globales absolutas + S eje global / doble eje local.");
