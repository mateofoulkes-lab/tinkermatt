import * as THREE from "three";
import "./v073";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

// v0.7.5 hotfix
//
// v0.7.4 accidentally created a second vertex-selection/TransformControls stack
// on top of v0.7.0. The window-level pointer capture needed to beat the original
// selector also prevented THREE.TransformControls from receiving pointer events.
// Keep ONE edit implementation (v0.7.0) and only patch the object-selection leak
// plus keyboard nudging here.

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.7.5 no pudo acceder al editor.");
const rawEditor = editor as any;
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");

const inEditMode = () => document.documentElement.classList.contains("tm-edit-mode");
const setStatus = (text: string) => { if (status) status.textContent = text; };
const applyVersion = () => { if (version) version.textContent = "v0.7.5"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

// While Edit Mode is active the selected object is the editing context. Legacy
// object pickers must not clear/swap that selection when clicking empty space or
// another object. Component picking in v0.7.0 owns the canvas event itself.
const originalSetSelection = editor.setSelection.bind(editor);
(editor as any).setSelection = (objects: THREE.Object3D[]) => {
  if (inEditMode()) {
    const active = editor.activeObject();
    if (active?.parent) {
      const current = editor.getSelection();
      const unchanged = current.length === 1 && current[0] === active;
      const requestedSame = objects.length === 1 && objects[0] === active;
      if (unchanged && !requestedSame) return;
    }
  }
  originalSetSelection(objects);
};

function editSelection() {
  const selection = window.tinkerMatt?.getEditSelection?.();
  if (!selection || selection.mode !== "vertex" || !Array.isArray(selection.ids)) return null;
  return selection as { mode: "vertex"; ids: string[] };
}

function rawIndicesFromVertexIds(ids: string[]) {
  const indices = new Set<number>();
  for (const id of ids) {
    if (!id.startsWith("v:")) continue;
    for (const token of id.slice(2).split(".")) {
      const index = Number(token);
      if (Number.isInteger(index) && index >= 0) indices.add(index);
    }
  }
  return indices;
}

// Arrow-key nudge for selected vertices. G/R/S remain owned by v0.7.0 and switch
// the live gizmo between translate / rotate / scale.
window.addEventListener("keydown", (event) => {
  if (!inEditMode()) return;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return;

  const selection = editSelection();
  if (!selection?.ids.length) return;
  const mesh = editor.activeObject();
  if (!(mesh instanceof THREE.Mesh)) return;

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

  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) return;
  const indices = rawIndicesFromVertexIds(selection.ids);
  if (!indices.size) return;

  const snap = editor.getSnap();
  const baseStep = snap.enabled ? snap.gridSize : 1;
  const step = baseStep * (event.altKey ? 0.1 : event.shiftKey ? 10 : 1);

  editor.checkpoint();
  mesh.updateMatrixWorld(true);
  const inverse = mesh.matrixWorld.clone().invert();
  const localOrigin = new THREE.Vector3().applyMatrix4(inverse);
  const localTip = direction.clone().multiplyScalar(step).applyMatrix4(inverse);
  const delta = localTip.sub(localOrigin);

  for (const index of indices) {
    if (index >= position.count) continue;
    position.setXYZ(index,
      position.getX(index) + delta.x,
      position.getY(index) + delta.y,
      position.getZ(index) + delta.z,
    );
  }

  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  rawEditor.emit?.("changed");
  setStatus(`Vértices movidos ${step.toFixed(2)} mm · flechas XY · PageUp/PageDown Z.`);
}, true);

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  editHotfixVersion: "0.7.5",
});

setStatus("TinkerMatt v0.7.5 · selección de malla unificada + transformaciones restauradas.");
