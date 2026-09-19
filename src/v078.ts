import * as THREE from "three";
import "./v077";
import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.7.8 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
const status = document.querySelector<HTMLElement>("#status");
const editToolbar = document.querySelector<HTMLElement>(".tm-edit-toolbar");
const topologyLabel = document.querySelector<HTMLElement>("[data-edit-topology]");
const modalBadge = document.querySelector<HTMLElement>(".tm-modal-badge");

const inEditMode = () => document.documentElement.classList.contains("tm-edit-mode");
const setStatus = (text: string) => { if (status) status.textContent = text; };
const applyVersion = () => { if (version) version.textContent = "v0.7.8"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

// -----------------------------------------------------------------------------
// 1 / 2 / 3: the historical edit layer owns the early capture listener, while
// v0.7.7 owns the real persistent component selection. Keep both synchronized
// through the toolbar itself, which is the shared public UI contract.
// -----------------------------------------------------------------------------
let syncingComponentMode = false;
function activeComponentButton() {
  return editToolbar?.querySelector<HTMLButtonElement>("[data-edit-select].active") ?? null;
}
function syncComponentModeFromToolbar() {
  if (!inEditMode() || syncingComponentMode) return;
  const button = activeComponentButton();
  const desired = button?.dataset.editSelect;
  const current = window.tinkerMatt?.getEditSelection?.()?.mode;
  if (!button || !desired || desired === current) return;
  syncingComponentMode = true;
  try { button.click(); }
  finally { queueMicrotask(() => { syncingComponentMode = false; }); }
}
if (editToolbar) {
  const observer = new MutationObserver(syncComponentModeFromToolbar);
  observer.observe(editToolbar, { subtree: true, attributes: true, attributeFilter: ["class"] });
}
// Fallback: even if an older window-capture key handler stops keydown propagation,
// keyup still reaches us and makes the shortcut deterministic.
window.addEventListener("keyup", (event) => {
  if (!inEditMode() || (event.key !== "1" && event.key !== "2" && event.key !== "3")) return;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return;
  const desired = event.key === "1" ? "vertex" : event.key === "2" ? "edge" : "face";
  const button = editToolbar?.querySelector<HTMLButtonElement>(`[data-edit-select="${desired}"]`);
  if (button && window.tinkerMatt?.getEditSelection?.()?.mode !== desired) button.click();
}, true);

// -----------------------------------------------------------------------------
// Geometry truth: bounds are recomputed after EVERY changed event. When an edit
// operation has finished (or an object is rebuilt by CSG/parametric code), the
// mesh pivot is recentered on the current local geometric bounding-box center.
// Geometry is translated the opposite way and object.position is compensated,
// so the object does not jump in world space.
// -----------------------------------------------------------------------------
function recomputeBounds(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  if (!geometry?.getAttribute("position")) return;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function recenterMeshPivot(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position?.count) return false;
  recomputeBounds(mesh);
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) return false;
  const center = box.getCenter(new THREE.Vector3());
  const epsilon = Math.max(1e-8, box.getSize(new THREE.Vector3()).length() * 1e-9);
  if (center.length() <= epsilon) return false;

  // Preserve the current world appearance: p_world = T + R*S*p_local.
  const compensation = center.clone().multiply(mesh.scale).applyQuaternion(mesh.quaternion);
  geometry.translate(-center.x, -center.y, -center.z);
  mesh.position.add(compensation);
  recomputeBounds(mesh);
  mesh.updateMatrixWorld(true);
  return true;
}

function selectedMeshes() {
  const meshes: THREE.Mesh[] = [];
  for (const root of editor.getSelection()) {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.geometry?.getAttribute("position")) meshes.push(object);
    });
  }
  return meshes;
}

function editTransformIsLive() {
  return inEditMode() && Boolean(modalBadge && !modalBadge.classList.contains("hidden"));
}

// Hole previews are construction geometry. The workplane must never occlude them;
// they intentionally render as an overlay while remaining translucent.
function applyHolePreviewRendering() {
  for (const root of editor.getSceneRoots()) {
    const meta = getMeta(root);
    if (meta?.mode !== "hole") continue;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.transparent = true;
        material.depthWrite = false;
        material.depthTest = false;
        material.needsUpdate = true;
      }
      object.renderOrder = Math.max(object.renderOrder, 1800);
    });
  }
}

function stampLogicalPrimitiveTopology() {
  for (const root of editor.getSceneRoots()) {
    const meta = getMeta(root);
    if (!(root instanceof THREE.Mesh) || !meta) continue;
    if (meta.kind === "box") {
      root.geometry.userData.tinkerLogicalTopology = {
        kind: "box",
        vertices: 8,
        edges: 12,
        faces: 6,
        note: "Render triangulation is internal only; editor topology is six quads.",
      };
    } else if (meta.kind === "cylinder") {
      const sides = Math.max(3, Number(meta.params?.sides) || 64);
      root.geometry.userData.tinkerLogicalTopology = {
        kind: "cylinder",
        vertices: sides * 2,
        edges: sides * 3,
        faces: sides + 2,
        note: "Caps and side quads are logical faces; render triangles stay internal.",
      };
    }
  }
}

function updateLogicalTopologyLabel() {
  if (!inEditMode() || !topologyLabel) return;
  const object = editor.activeObject();
  if (!(object instanceof THREE.Mesh)) return;
  const logical = object.geometry.userData.tinkerLogicalTopology as { vertices?: number; edges?: number; faces?: number } | undefined;
  if (!logical) return;
  topologyLabel.textContent = `${logical.vertices ?? "?"} vértices · ${logical.edges ?? "?"} aristas · ${logical.faces ?? "?"} caras lógicas`;
}

let fixingGeometry = false;
function refreshGeometryTruth() {
  if (fixingGeometry) return;
  fixingGeometry = true;
  try {
    const meshes = selectedMeshes();
    for (const mesh of meshes) recomputeBounds(mesh);

    // During a live modal edit v0.7.7 recomputes bounds continuously, but moving
    // the pivot mid-gesture would invalidate its baseline. Recenter only once the
    // transform is confirmed/cancelled, and after all other geometry rebuilds.
    if (!editTransformIsLive()) {
      let recentered = false;
      for (const mesh of meshes) recentered = recenterMeshPivot(mesh) || recentered;
      if (recentered) rawEditor.refreshSelectionHelpers?.();
    }

    stampLogicalPrimitiveTopology();
    applyHolePreviewRendering();
    updateLogicalTopologyLabel();
  } finally {
    fixingGeometry = false;
  }
}

editor.on("changed", refreshGeometryTruth);
editor.on("selection", () => {
  stampLogicalPrimitiveTopology();
  applyHolePreviewRendering();
  updateLogicalTopologyLabel();
});

const editModeObserver = new MutationObserver(() => {
  if (inEditMode()) {
    syncComponentModeFromToolbar();
    updateLogicalTopologyLabel();
  }
  applyVersion();
});
editModeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

// Run once for objects already in the scene before this layer loaded.
stampLogicalPrimitiveTopology();
applyHolePreviewRendering();
refreshGeometryTruth();

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  geometryTruthVersion: "0.7.8",
  recomputeBounds: () => selectedMeshes().forEach(recomputeBounds),
  recenterSelectedPivots: () => {
    for (const mesh of selectedMeshes()) recenterMeshPivot(mesh);
    rawEditor.refreshSelectionHelpers?.();
  },
});

setStatus("TinkerMatt v0.7.8 · 1/2/3 sincronizados · bounds vivos · pivots geométricos · primitivas con caras lógicas · huecos sobre el plano.");
