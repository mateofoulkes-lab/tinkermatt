import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import "./v073";
import { getMeta, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV064ScaleKeydownOverride?: (event: KeyboardEvent) => boolean;
    __tmV067TransformKeydownOverride?: (event: KeyboardEvent) => boolean;
    tinkerMatt: Record<string, any>;
  }
}

type EditTransformMode = "translate" | "rotate" | "scale";
type VertexGroup = { id: string; indices: number[] };
type TransformBaseline = {
  positions: Float32Array;
  indices: Set<number>;
  meshWorld: THREE.Matrix4;
  meshWorldInverse: THREE.Matrix4;
  pivotWorld: THREE.Matrix4;
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.7.4 no pudo acceder al editor.");
const rawEditor = editor as any;
const canvas = editor.renderer.domElement;
const status = document.querySelector<HTMLElement>("#status");
const editToolbar = document.querySelector<HTMLElement>(".tm-edit-toolbar");
const editCountLabel = document.querySelector<HTMLElement>("[data-edit-count]");
const version = document.querySelector<HTMLElement>(".version");

const setStatus = (text: string) => { if (status) status.textContent = text; };
const applyVersion = () => { if (version) version.textContent = "v0.7.4"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

let targetMesh: THREE.Mesh | null = null;
let vertexGroups = new Map<string, VertexGroup>();
let selectedVertices = new Set<string>();
let transformMode: EditTransformMode = "translate";
let baseline: TransformBaseline | null = null;
let resettingPivot = false;

const selectionVisual = new THREE.Group();
selectionVisual.name = "__tm_v074_vertex_selection";
editor.scene.add(selectionVisual);

const editPivot = new THREE.Object3D();
editPivot.name = "__tm_v074_edit_pivot";
editor.scene.add(editPivot);

const editTransform = new TransformControls(editor.camera, canvas);
editTransform.setMode("translate");
editTransform.setSpace("world");
(editTransform as any).setSize?.(.78);
const editTransformHelper = editTransform.getHelper();
editTransformHelper.visible = false;
editTransformHelper.name = "__tm_v074_edit_transform";
editor.scene.add(editTransformHelper);

function inEditMode() {
  return document.documentElement.classList.contains("tm-edit-mode");
}

function currentComponentMode() {
  return editToolbar?.querySelector<HTMLElement>("[data-edit-select].active")?.dataset.editSelect ?? "vertex";
}

function disposeGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    child.removeFromParent();
    const geometry = (child as THREE.Points).geometry as THREE.BufferGeometry | undefined;
    geometry?.dispose?.();
    const material = (child as THREE.Points).material as THREE.Material | THREE.Material[] | undefined;
    if (material) (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
  }
}

function buildVertexGroups(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const groups = new Map<string, VertexGroup>();
  if (!position) return groups;

  geometry.computeBoundingBox();
  const diagonal = geometry.boundingBox?.getSize(new THREE.Vector3()).length() || 1;
  const epsilon = Math.max(1e-7, diagonal * 1e-6);
  const byPosition = new Map<string, number[]>();

  for (let index = 0; index < position.count; index += 1) {
    const key = `${Math.round(position.getX(index) / epsilon)},${Math.round(position.getY(index) / epsilon)},${Math.round(position.getZ(index) / epsilon)}`;
    const indices = byPosition.get(key) ?? [];
    indices.push(index);
    byPosition.set(key, indices);
  }

  for (const indices of byPosition.values()) {
    indices.sort((a, b) => a - b);
    const id = `v:${indices.join(".")}`;
    groups.set(id, { id, indices });
  }
  return groups;
}

function groupLocalPoint(group: VertexGroup) {
  if (!targetMesh) return null;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const index = group.indices[0];
  if (!position || index == null || index >= position.count) return null;
  return new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
}

function groupWorldPoint(group: VertexGroup) {
  if (!targetMesh) return null;
  const local = groupLocalPoint(group);
  if (!local) return null;
  targetMesh.updateMatrixWorld(true);
  return local.applyMatrix4(targetMesh.matrixWorld);
}

function selectedRawIndices() {
  const result = new Set<number>();
  for (const id of selectedVertices) vertexGroups.get(id)?.indices.forEach((index) => result.add(index));
  return result;
}

function selectedCenter() {
  const box = new THREE.Box3();
  for (const id of selectedVertices) {
    const group = vertexGroups.get(id);
    const world = group ? groupWorldPoint(group) : null;
    if (world) box.expandByPoint(world);
  }
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}

function syncCount() {
  if (editCountLabel && currentComponentMode() === "vertex") {
    editCountLabel.textContent = `${selectedVertices.size} seleccionado${selectedVertices.size === 1 ? "" : "s"}`;
  }
}

function refreshSelectionVisual() {
  disposeGroup(selectionVisual);
  if (!inEditMode() || currentComponentMode() !== "vertex" || !targetMesh || !selectedVertices.size) return;

  const points: THREE.Vector3[] = [];
  for (const id of selectedVertices) {
    const group = vertexGroups.get(id);
    const world = group ? groupWorldPoint(group) : null;
    if (world) points.push(world);
  }
  if (!points.length) return;

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.PointsMaterial({ color: 0x00b5ee, size: 14, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 1 });
  const cloud = new THREE.Points(geometry, material);
  cloud.renderOrder = 4300;
  selectionVisual.add(cloud);
}

function refreshPivot() {
  if (!inEditMode() || currentComponentMode() !== "vertex" || !targetMesh || !selectedVertices.size) {
    editTransform.detach();
    editTransformHelper.visible = false;
    return;
  }
  const center = selectedCenter();
  if (!center) {
    editTransform.detach();
    editTransformHelper.visible = false;
    return;
  }
  resettingPivot = true;
  editPivot.position.copy(center);
  editPivot.quaternion.identity();
  editPivot.scale.set(1, 1, 1);
  editPivot.updateMatrixWorld(true);
  editTransform.attach(editPivot);
  editTransform.setMode(transformMode);
  editTransform.setSpace("world");
  editTransformHelper.visible = true;
  resettingPivot = false;
}

function refreshVertexUi() {
  syncCount();
  refreshSelectionVisual();
  refreshPivot();
}

function clearVertexSelection(refresh = true) {
  selectedVertices.clear();
  if (refresh) refreshVertexUi();
}

function setTransformMode(mode: EditTransformMode) {
  transformMode = mode;
  editTransform.setMode(mode);
  editToolbar?.querySelectorAll<HTMLElement>("[data-edit-transform]").forEach((button) => {
    button.classList.toggle("active", button.dataset.editTransform === mode);
  });
  refreshPivot();
  setStatus(`${mode === "translate" ? "Mover" : mode === "rotate" ? "Rotar" : "Escalar"} vértices seleccionados.`);
}

function vertexAt(clientX: number, clientY: number) {
  if (!targetMesh) return null;
  const rect = canvas.getBoundingClientRect();
  const cursor = new THREE.Vector2(clientX, clientY);
  let best: { id: string; screenDistance: number; cameraDistance: number } | null = null;

  targetMesh.updateMatrixWorld(true);
  for (const [id, group] of vertexGroups) {
    const world = groupWorldPoint(group);
    if (!world) continue;
    const projected = world.clone().project(editor.camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const screen = new THREE.Vector2(
      rect.left + (projected.x * .5 + .5) * rect.width,
      rect.top + (-projected.y * .5 + .5) * rect.height,
    );
    const screenDistance = screen.distanceTo(cursor);
    if (screenDistance > 20) continue;
    const cameraDistance = world.distanceToSquared(editor.camera.position);
    if (!best || screenDistance < best.screenDistance - .75 || (Math.abs(screenDistance - best.screenDistance) <= .75 && cameraDistance < best.cameraDistance)) {
      best = { id, screenDistance, cameraDistance };
    }
  }
  return best?.id ?? null;
}

function snapshotPositions(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  return new Float32Array(position.array as ArrayLike<number>);
}

function markDirectMesh() {
  if (!targetMesh) return;
  const meta = getMeta(targetMesh);
  if (!meta) return;
  if ((meta as any).kind !== "mesh") {
    meta.params = { ...(meta.params ?? {}), sourceKind: String(meta.kind), directMeshEdit: true };
    (meta as any).kind = "mesh";
    setMeta(targetMesh, meta);
  }
}

function applyTransformDelta() {
  if (!baseline || !targetMesh || resettingPivot) return;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  editPivot.updateMatrixWorld(true);
  const delta = editPivot.matrixWorld.clone().multiply(baseline.pivotWorld.clone().invert());
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();

  for (const index of baseline.indices) {
    local.set(baseline.positions[index * 3], baseline.positions[index * 3 + 1], baseline.positions[index * 3 + 2]);
    world.copy(local).applyMatrix4(baseline.meshWorld).applyMatrix4(delta);
    local.copy(world).applyMatrix4(baseline.meshWorldInverse);
    position.setXYZ(index, local.x, local.y, local.z);
  }

  position.needsUpdate = true;
  targetMesh.geometry.computeVertexNormals();
  targetMesh.geometry.computeBoundingBox();
  targetMesh.geometry.computeBoundingSphere();
  refreshSelectionVisual();
}

editTransform.addEventListener("dragging-changed", (event: any) => {
  editor.orbit.enabled = !event.value;
});
editTransform.addEventListener("mouseDown", () => {
  if (!targetMesh || !selectedVertices.size) return;
  editor.checkpoint();
  targetMesh.updateMatrixWorld(true);
  editPivot.updateMatrixWorld(true);
  baseline = {
    positions: snapshotPositions(targetMesh),
    indices: selectedRawIndices(),
    meshWorld: targetMesh.matrixWorld.clone(),
    meshWorldInverse: targetMesh.matrixWorld.clone().invert(),
    pivotWorld: editPivot.matrixWorld.clone(),
  };
});
editTransform.addEventListener("objectChange", applyTransformDelta);
editTransform.addEventListener("mouseUp", () => {
  if (!targetMesh || !baseline) return;
  baseline = null;
  markDirectMesh();
  vertexGroups = buildVertexGroups(targetMesh);
  // Re-associate the selection with the nearest rebuilt vertices by position.
  // For the common single/multi-vertex transform, keeping the same raw-index IDs
  // works because direct edits do not change the buffer topology.
  selectedVertices = new Set([...selectedVertices].filter((id) => vertexGroups.has(id)));
  refreshVertexUi();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
});

function beginEditSession() {
  const active = editor.activeObject();
  targetMesh = active instanceof THREE.Mesh && Boolean(active.geometry?.getAttribute("position")) ? active : null;
  vertexGroups = targetMesh ? buildVertexGroups(targetMesh) : new Map();
  clearVertexSelection(false);
  refreshVertexUi();
  applyVersion();
}

function endEditSession() {
  baseline = null;
  targetMesh = null;
  vertexGroups = new Map();
  clearVertexSelection(false);
  disposeGroup(selectionVisual);
  editTransform.detach();
  editTransformHelper.visible = false;
}

// Lock object-level selection while editing. Edit Mode owns the active mesh;
// clicking empty space or another object must never kick the user back to Object Mode.
const originalSetSelection = editor.setSelection.bind(editor);
(editor as any).setSelection = (objects: THREE.Object3D[]) => {
  if (inEditMode() && targetMesh?.parent) {
    const current = editor.getSelection();
    if (current.length === 1 && current[0] === targetMesh) return;
    originalSetSelection([targetMesh]);
    return;
  }
  originalSetSelection(objects);
};

// Own vertex clicks one level above the canvas so legacy object picking cannot
// clear the object selection before component editing gets the event.
window.addEventListener("pointerdown", (event) => {
  if (!inEditMode() || currentComponentMode() !== "vertex" || event.button !== 0 || event.target !== canvas) return;
  if ((editTransform as any).dragging || editTransform.axis) return;
  if (!targetMesh) beginEditSession();
  if (!targetMesh) return;

  const id = vertexAt(event.clientX, event.clientY);
  event.preventDefault();
  event.stopImmediatePropagation();

  if (!id) {
    if (!event.shiftKey) clearVertexSelection();
    setStatus("EDIT MODE · sin vértice bajo el cursor.");
    return;
  }

  if (!event.shiftKey) selectedVertices.clear();
  if (event.shiftKey && selectedVertices.has(id)) selectedVertices.delete(id);
  else selectedVertices.add(id);
  refreshVertexUi();
  setStatus(`${selectedVertices.size} vértice${selectedVertices.size === 1 ? "" : "s"} seleccionado${selectedVertices.size === 1 ? "" : "s"} · G mover · R rotar · S escalar.`);
}, true);

const inheritedScaleOverride = window.__tmV064ScaleKeydownOverride;
const inheritedTransformOverride = window.__tmV067TransformKeydownOverride;
function vertexTransformKey(event: KeyboardEvent) {
  if (!inEditMode() || currentComponentMode() !== "vertex" || !selectedVertices.size) return false;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return false;
  const key = event.key.toLowerCase();
  if (key !== "g" && key !== "m" && key !== "r" && key !== "s") return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  setTransformMode(key === "r" ? "rotate" : key === "s" ? "scale" : "translate");
  return true;
}
window.__tmV064ScaleKeydownOverride = (event) => vertexTransformKey(event) || inheritedScaleOverride?.(event) || false;
window.__tmV067TransformKeydownOverride = (event) => vertexTransformKey(event) || inheritedTransformOverride?.(event) || false;

// Small keyboard nudges make vertex editing usable even without grabbing the gizmo.
window.addEventListener("keydown", (event) => {
  if (!inEditMode() || currentComponentMode() !== "vertex" || !selectedVertices.size || !targetMesh) return;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return;

  const directions: Record<string, THREE.Vector3> = {
    ArrowLeft: new THREE.Vector3(-1, 0, 0),
    ArrowRight: new THREE.Vector3(1, 0, 0),
    ArrowUp: new THREE.Vector3(0, 1, 0),
    ArrowDown: new THREE.Vector3(0, -1, 0),
    PageUp: new THREE.Vector3(0, 0, 1),
    PageDown: new THREE.Vector3(0, 0, -1),
  };
  const direction = directions[event.key];
  if (!direction) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const snap = editor.getSnap();
  const baseStep = snap.enabled ? snap.gridSize : 1;
  const step = baseStep * (event.altKey ? .1 : event.shiftKey ? 10 : 1);
  editor.checkpoint();

  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  targetMesh.updateMatrixWorld(true);
  const inverse = targetMesh.matrixWorld.clone().invert();
  const localDeltaOrigin = new THREE.Vector3(0, 0, 0).applyMatrix4(inverse);
  const localDeltaTip = direction.clone().multiplyScalar(step).applyMatrix4(inverse);
  const localDelta = localDeltaTip.sub(localDeltaOrigin);
  for (const index of selectedRawIndices()) {
    position.setXYZ(index, position.getX(index) + localDelta.x, position.getY(index) + localDelta.y, position.getZ(index) + localDelta.z);
  }
  position.needsUpdate = true;
  targetMesh.geometry.computeVertexNormals();
  targetMesh.geometry.computeBoundingBox();
  targetMesh.geometry.computeBoundingSphere();
  markDirectMesh();
  vertexGroups = buildVertexGroups(targetMesh);
  refreshVertexUi();
  rawEditor.emit?.("changed");
  setStatus(`Vértices movidos ${step.toFixed(2)} mm en ${event.key}.`);
}, true);

// Track Object/Edit transitions made by the original v0.7.0 controls.
let lastEditMode = inEditMode();
if (lastEditMode) beginEditSession();
const modeObserver = new MutationObserver(() => {
  const now = inEditMode();
  if (now !== lastEditMode) {
    lastEditMode = now;
    if (now) beginEditSession(); else endEditSession();
  }
  applyVersion();
});
modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

// If 1/2/3 changes component mode, our vertex-only selection must not leak into
// edge/face mode. The original edge/face implementation remains in charge there.
if (editToolbar) {
  const componentObserver = new MutationObserver(() => {
    if (currentComponentMode() !== "vertex" && selectedVertices.size) clearVertexSelection();
  });
  componentObserver.observe(editToolbar, { subtree: true, attributes: true, attributeFilter: ["class"] });
}

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  getVertexEditSelection: () => [...selectedVertices],
  clearVertexEditSelection: () => clearVertexSelection(),
});

setStatus("TinkerMatt v0.7.4 · selección de vértices persistente y modo Edición bloqueado al objeto activo.");
