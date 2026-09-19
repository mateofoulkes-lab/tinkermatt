import * as THREE from "three";
import "./v074";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV067TransformKeydownOverride?: (event: KeyboardEvent) => boolean;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type ComponentMode = "vertex" | "edge" | "face";
type PickVertex = { id: string; point: THREE.Vector3; indices: number[]; triangles: number[] };
type PickTriangle = { index: number; vertices: [string, string, string]; edges: [string, string, string]; normal: THREE.Vector3; plane: number };
type PickEdge = { id: string; a: string; b: string; triangles: number[]; feature: boolean };
type PickTopology = { vertices: Map<string, PickVertex>; triangles: PickTriangle[]; edges: Map<string, PickEdge> };
type RotateControl = { kind: "rotate"; axis: Axis };
type ObjectRotateState = { object: THREE.Object3D; worldPosition: THREE.Vector3; worldQuaternion: THREE.Quaternion };
type ObjectRotateGesture = {
  pointerId: number;
  axis: Axis;
  centerWorld: THREE.Vector3;
  centerClient: THREE.Vector2;
  startAngle: number;
  states: ObjectRotateState[];
};
type ObjectKeyboardRotate = {
  axis: Axis | null;
  space: "global" | "local";
  centerWorld: THREE.Vector3;
  centerClient: THREE.Vector2;
  startPointer: THREE.Vector2;
  startAngle: number;
  activeWorldQuaternion: THREE.Quaternion;
  states: ObjectRotateState[];
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.7.6 no pudo acceder al editor.");
const rawEditor = editor as any;
const canvas = editor.renderer.domElement;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
const modalBadge = document.querySelector<HTMLElement>(".tm-modal-badge");

const setStatus = (text: string) => { if (status) status.textContent = text; };
const inEditMode = () => document.documentElement.classList.contains("tm-edit-mode");
const applyVersion = () => { if (version) version.textContent = "v0.7.6"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

// -----------------------------------------------------------------------------
// Edit-mode selection bridge.
//
// v0.7.0 already has the correct persistent selection SETS, paint overlays and
// transform logic for vertices/edges/faces. Its weak point is hit-testing: for a
// vertex or edge it first requires a triangle hit exactly under the cursor. That
// makes silhouette vertices/edges unreliable and makes selection look like it
// "doesn't stick". This layer does robust screen-space hit-testing, then forwards
// one synthetic click at a safe point just inside the same triangle. The original
// v0.7.0 selection sets remain the single source of truth.
// -----------------------------------------------------------------------------
function rawIndex(geometry: THREE.BufferGeometry, triangle: number, corner: number) {
  const item = triangle * 3 + corner;
  return geometry.index ? geometry.index.getX(item) : item;
}

function buildPickTopology(mesh: THREE.Mesh): PickTopology | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) return null;
  geometry.computeBoundingBox();
  const diagonal = geometry.boundingBox?.getSize(new THREE.Vector3()).length() || 1;
  const epsilon = Math.max(1e-7, diagonal * 1e-6);
  const planeTolerance = Math.max(1e-6, diagonal * 2e-6);
  const groups = new Map<string, number[]>();
  const pointKey = (index: number) => `${Math.round(position.getX(index) / epsilon)},${Math.round(position.getY(index) / epsilon)},${Math.round(position.getZ(index) / epsilon)}`;

  for (let i = 0; i < position.count; i += 1) {
    const key = pointKey(i);
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  }

  const vertices = new Map<string, PickVertex>();
  const rawToVertex = new Map<number, string>();
  for (const indices of groups.values()) {
    indices.sort((a, b) => a - b);
    const id = `v:${indices.join(".")}`;
    const first = indices[0];
    vertices.set(id, {
      id,
      point: new THREE.Vector3(position.getX(first), position.getY(first), position.getZ(first)),
      indices,
      triangles: [],
    });
    indices.forEach((index) => rawToVertex.set(index, id));
  }

  const pair = (a: string, b: string) => a < b ? `e:${a}|${b}` : `e:${b}|${a}`;
  const triangles: PickTriangle[] = [];
  const edges = new Map<string, PickEdge>();
  const triangleCount = geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(position.count / 3);

  for (let tri = 0; tri < triangleCount; tri += 1) {
    const raw = [rawIndex(geometry, tri, 0), rawIndex(geometry, tri, 1), rawIndex(geometry, tri, 2)] as [number, number, number];
    const ids = raw.map((index) => rawToVertex.get(index)!) as [string, string, string];
    if (ids.some((id) => !id)) continue;
    const points = ids.map((id) => vertices.get(id)!.point) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const normal = new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0])).normalize();
    const edgeIds = [pair(ids[0], ids[1]), pair(ids[1], ids[2]), pair(ids[2], ids[0])] as [string, string, string];
    triangles.push({ index: tri, vertices: ids, edges: edgeIds, normal, plane: normal.dot(points[0]) });
    ids.forEach((id) => vertices.get(id)?.triangles.push(tri));
    for (let i = 0; i < 3; i += 1) {
      const a = ids[i];
      const b = ids[(i + 1) % 3];
      const id = edgeIds[i];
      const edge = edges.get(id) ?? { id, a: a < b ? a : b, b: a < b ? b : a, triangles: [], feature: true };
      edge.triangles.push(tri);
      edges.set(id, edge);
    }
  }

  const byIndex = new Map(triangles.map((triangle) => [triangle.index, triangle]));
  const coplanar = (a: PickTriangle, b: PickTriangle) => {
    const dot = a.normal.dot(b.normal);
    if (Math.abs(dot) < 0.999995) return false;
    return dot >= 0 ? Math.abs(a.plane - b.plane) <= planeTolerance : Math.abs(a.plane + b.plane) <= planeTolerance;
  };
  for (const edge of edges.values()) {
    if (edge.triangles.length === 2) {
      const a = byIndex.get(edge.triangles[0]);
      const b = byIndex.get(edge.triangles[1]);
      edge.feature = Boolean(a && b) ? !coplanar(a!, b!) : true;
    } else edge.feature = true;
  }

  return { vertices, triangles, edges };
}

function currentComponentMode(): ComponentMode {
  const value = document.querySelector<HTMLElement>(".tm-edit-toolbar [data-edit-select].active")?.dataset.editSelect;
  return value === "edge" || value === "face" ? value : "vertex";
}

function projectWorld(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const p = point.clone().project(editor.camera);
  return new THREE.Vector2(
    rect.left + (p.x * .5 + .5) * rect.width,
    rect.top + (-p.y * .5 + .5) * rect.height,
  );
}

function segmentDistance(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a);
  const len = ab.lengthSq();
  if (len < 1e-8) return point.distanceTo(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / len, 0, 1);
  return point.distanceTo(a.add(ab.multiplyScalar(t)));
}

const pickRaycaster = new THREE.Raycaster();
function triangleHitAt(mesh: THREE.Mesh, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  pickRaycaster.setFromCamera(pointer, editor.camera);
  return pickRaycaster.intersectObject(mesh, false)[0] ?? null;
}

function triangleByIndex(topology: PickTopology, index: number) {
  return topology.triangles.find((triangle) => triangle.index === index) ?? null;
}

function nearestVertex(mesh: THREE.Mesh, topology: PickTopology, clientX: number, clientY: number) {
  mesh.updateMatrixWorld(true);
  const cursor = new THREE.Vector2(clientX, clientY);
  let best: { id: string; screen: number; camera: number } | null = null;
  for (const [id, vertex] of topology.vertices) {
    const world = vertex.point.clone().applyMatrix4(mesh.matrixWorld);
    const projected = world.clone().project(editor.camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const distance = projectWorld(world).distanceTo(cursor);
    if (distance > 22) continue;
    const cameraDistance = world.distanceToSquared(editor.camera.position);
    if (!best || distance < best.screen - .5 || (Math.abs(distance - best.screen) <= .5 && cameraDistance < best.camera)) {
      best = { id, screen: distance, camera: cameraDistance };
    }
  }
  return best?.id ?? null;
}

function nearestEdge(mesh: THREE.Mesh, topology: PickTopology, clientX: number, clientY: number) {
  mesh.updateMatrixWorld(true);
  const cursor = new THREE.Vector2(clientX, clientY);
  let best: { id: string; screen: number; camera: number } | null = null;
  for (const edge of topology.edges.values()) {
    if (!edge.feature) continue;
    const aWorld = topology.vertices.get(edge.a)!.point.clone().applyMatrix4(mesh.matrixWorld);
    const bWorld = topology.vertices.get(edge.b)!.point.clone().applyMatrix4(mesh.matrixWorld);
    const distance = segmentDistance(cursor, projectWorld(aWorld), projectWorld(bWorld));
    if (distance > 18) continue;
    const cameraDistance = aWorld.clone().add(bWorld).multiplyScalar(.5).distanceToSquared(editor.camera.position);
    if (!best || distance < best.screen - .5 || (Math.abs(distance - best.screen) <= .5 && cameraDistance < best.camera)) {
      best = { id: edge.id, screen: distance, camera: cameraDistance };
    }
  }
  return best?.id ?? null;
}

function triangleCentroidScreen(mesh: THREE.Mesh, topology: PickTopology, triangle: PickTriangle) {
  mesh.updateMatrixWorld(true);
  const points = triangle.vertices.map((id) => topology.vertices.get(id)!.point.clone().applyMatrix4(mesh.matrixWorld));
  const centroid = points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3);
  return projectWorld(centroid);
}

function safeVertexPoint(mesh: THREE.Mesh, topology: PickTopology, id: string) {
  const vertex = topology.vertices.get(id);
  if (!vertex) return null;
  const world = vertex.point.clone().applyMatrix4(mesh.matrixWorld);
  const screen = projectWorld(world);
  const triangles = vertex.triangles.map((index) => triangleByIndex(topology, index)).filter((triangle): triangle is PickTriangle => Boolean(triangle));
  for (const triangle of triangles) {
    const centroid = triangleCentroidScreen(mesh, topology, triangle);
    const direction = centroid.clone().sub(screen);
    if (direction.lengthSq() < 1e-6) continue;
    direction.normalize();
    for (const inset of [4, 7, 10, 14]) {
      const candidate = screen.clone().addScaledVector(direction, inset);
      const hit = triangleHitAt(mesh, candidate.x, candidate.y);
      if (hit?.faceIndex == null) continue;
      const hitTriangle = triangleByIndex(topology, hit.faceIndex);
      if (hitTriangle?.vertices.includes(id)) return candidate;
    }
  }
  return screen;
}

function safeEdgePoint(mesh: THREE.Mesh, topology: PickTopology, id: string) {
  const edge = topology.edges.get(id);
  if (!edge) return null;
  mesh.updateMatrixWorld(true);
  const a = projectWorld(topology.vertices.get(edge.a)!.point.clone().applyMatrix4(mesh.matrixWorld));
  const b = projectWorld(topology.vertices.get(edge.b)!.point.clone().applyMatrix4(mesh.matrixWorld));
  const midpoint = a.clone().add(b).multiplyScalar(.5);
  for (const triIndex of edge.triangles) {
    const triangle = triangleByIndex(topology, triIndex);
    if (!triangle) continue;
    const centroid = triangleCentroidScreen(mesh, topology, triangle);
    const direction = centroid.clone().sub(midpoint);
    if (direction.lengthSq() < 1e-6) continue;
    direction.normalize();
    for (const inset of [4, 7, 10, 14]) {
      const candidate = midpoint.clone().addScaledVector(direction, inset);
      const hit = triangleHitAt(mesh, candidate.x, candidate.y);
      if (hit?.faceIndex == null) continue;
      const hitTriangle = triangleByIndex(topology, hit.faceIndex);
      if (hitTriangle?.vertices.includes(edge.a) && hitTriangle.vertices.includes(edge.b)) return candidate;
    }
  }
  return midpoint;
}

function findLegacyEditTransform(): any | null {
  const pivot = editor.scene.getObjectByName("__tm_edit_pivot");
  if (!pivot) return null;
  let found: any = null;
  editor.scene.traverse((object) => {
    if (found) return;
    const controls = (object as any).controls;
    if (controls?.object === pivot && typeof controls.pointerHover === "function") found = controls;
  });
  return found;
}

let forwardingEditPointer = false;
window.addEventListener("pointerdown", (event) => {
  if (forwardingEditPointer || !inEditMode() || event.button !== 0 || event.target !== canvas) return;

  // If the legacy edit TransformControls has an axis under the pointer, this is
  // a gizmo drag, not a component pick. Let it receive the real event untouched.
  const legacyTransform = findLegacyEditTransform();
  if (legacyTransform?.axis) return;

  const mesh = editor.activeObject();
  if (!(mesh instanceof THREE.Mesh) || !mesh.geometry?.getAttribute("position")) return;
  const topology = buildPickTopology(mesh);
  if (!topology) return;
  const mode = currentComponentMode();

  let point = new THREE.Vector2(event.clientX, event.clientY);
  if (mode === "vertex") {
    const id = nearestVertex(mesh, topology, event.clientX, event.clientY);
    if (id) point = safeVertexPoint(mesh, topology, id) ?? point;
  } else if (mode === "edge") {
    const id = nearestEdge(mesh, topology, event.clientX, event.clientY);
    if (id) point = safeEdgePoint(mesh, topology, id) ?? point;
  }

  // Own the trusted click so object-level picking can never run underneath it.
  // The forwarded synthetic pointerdown reaches the original v0.7.0 component
  // selector, which updates its persistent sets, paints the selection and moves
  // its own transform pivot to the selected components.
  event.preventDefault();
  event.stopImmediatePropagation();
  forwardingEditPointer = true;
  try {
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    }));
  } finally {
    forwardingEditPointer = false;
  }
}, true);

// -----------------------------------------------------------------------------
// Object-mode geometric rotation pivot.
//
// v0.6.7 draws its rotate controls around the geometric center but rotates only
// object.quaternion, so off-center geometry actually spins around the object's
// internal origin. Keep the existing visual widget, remove only its old rotate
// metadata, and own rotation here: position + quaternion are transformed around
// the true geometric center of the current selection.
// -----------------------------------------------------------------------------
const controlRootName = "__tm_tinkercad_controls";
function patchRotationControls() {
  const root = editor.scene.getObjectByName(controlRootName);
  root?.traverse((object) => {
    const info = object.userData.tmControl as RotateControl | { kind: string; axis: Axis } | undefined;
    if (info?.kind !== "rotate") return;
    object.userData.tmControlV076 = { kind: "rotate", axis: info.axis } satisfies RotateControl;
    delete object.userData.tmControl;
  });
}
patchRotationControls();
requestAnimationFrame(patchRotationControls);
editor.on("selection", patchRotationControls);

const objectControlRaycaster = new THREE.Raycaster();
const objectControlPointer = new THREE.Vector2();
function rotationControlAt(clientX: number, clientY: number): RotateControl | null {
  const root = editor.scene.getObjectByName(controlRootName);
  if (!root?.visible) return null;
  const rect = canvas.getBoundingClientRect();
  objectControlPointer.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  objectControlRaycaster.setFromCamera(objectControlPointer, editor.camera);
  const hit = objectControlRaycaster.intersectObject(root, true)[0]?.object ?? null;
  let current: THREE.Object3D | null = hit;
  while (current && current !== root) {
    const info = current.userData.tmControlV076 as RotateControl | undefined;
    if (info?.kind === "rotate") return info;
    current = current.parent;
  }
  return null;
}

function selectionGeometricCenter() {
  const selection = editor.getSelection();
  if (!selection.length) return null;
  const box = new THREE.Box3();
  for (const object of selection) {
    object.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(object));
  }
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}

function worldPosition(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return object.getWorldPosition(new THREE.Vector3());
}

function worldQuaternion(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return object.getWorldQuaternion(new THREE.Quaternion());
}

function setWorldPosition(object: THREE.Object3D, position: THREE.Vector3) {
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    object.position.copy(object.parent.worldToLocal(position.clone()));
  } else object.position.copy(position);
  object.updateMatrixWorld(true);
}

function setWorldQuaternion(object: THREE.Object3D, quaternion: THREE.Quaternion) {
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
    object.quaternion.copy(parentWorld.invert().multiply(quaternion));
  } else object.quaternion.copy(quaternion);
  object.updateMatrixWorld(true);
}

function axisVector(axis: Axis) {
  return axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
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

function zoneFor(radius: number) {
  if (radius <= 78) return { step: 45, label: "45°" };
  if (radius <= 135) return { step: 1, label: "1°" };
  return { step: 0, label: "libre" };
}

function rotateStates(states: ObjectRotateState[], centerWorld: THREE.Vector3, deltaQuaternion: THREE.Quaternion) {
  for (const state of states) {
    const offset = state.worldPosition.clone().sub(centerWorld).applyQuaternion(deltaQuaternion);
    setWorldPosition(state.object, centerWorld.clone().add(offset));
    setWorldQuaternion(state.object, deltaQuaternion.clone().multiply(state.worldQuaternion));
  }
}

function captureRotateStates() {
  return editor.getSelection().map((object) => ({
    object,
    worldPosition: worldPosition(object),
    worldQuaternion: worldQuaternion(object),
  }));
}

let objectRotateGesture: ObjectRotateGesture | null = null;
window.addEventListener("pointerdown", (event) => {
  if (inEditMode() || event.button !== 0 || event.target !== canvas || objectRotateGesture) return;
  patchRotationControls();
  const control = rotationControlAt(event.clientX, event.clientY);
  if (!control) return;
  const centerWorld = selectionGeometricCenter();
  const selection = editor.getSelection();
  if (!centerWorld || !selection.length) return;

  const centerClient = projectWorld(centerWorld);
  objectRotateGesture = {
    pointerId: event.pointerId,
    axis: control.axis,
    centerWorld,
    centerClient,
    startAngle: Math.atan2(event.clientY - centerClient.y, event.clientX - centerClient.x),
    states: captureRotateStates(),
  };
  editor.checkpoint();
  setStatus(`Rotar ${control.axis.toUpperCase()} · pivot = centro geométrico.`);
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener("pointermove", (event) => {
  const gesture = objectRotateGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  let deltaDeg = normalizeDegrees(THREE.MathUtils.radToDeg(
    Math.atan2(event.clientY - gesture.centerClient.y, event.clientX - gesture.centerClient.x) - gesture.startAngle,
  ));
  const zone = zoneFor(Math.hypot(event.clientX - gesture.centerClient.x, event.clientY - gesture.centerClient.y));
  if (zone.step) deltaDeg = snap(deltaDeg, zone.step);
  const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(axisVector(gesture.axis), THREE.MathUtils.degToRad(deltaDeg));
  rotateStates(gesture.states, gesture.centerWorld, deltaQuaternion);
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  setStatus(`Rotar ${gesture.axis.toUpperCase()}: ${deltaDeg.toFixed(1)}° · pivot geométrico · ${zone.label}`);
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function finishObjectRotateGesture(event: PointerEvent) {
  if (!objectRotateGesture || objectRotateGesture.pointerId !== event.pointerId) return;
  objectRotateGesture = null;
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus("Rotación confirmada · pivot geométrico.");
  event.preventDefault();
  event.stopImmediatePropagation();
}
window.addEventListener("pointerup", finishObjectRotateGesture, true);
window.addEventListener("pointercancel", finishObjectRotateGesture, true);

// Keyboard R uses the same geometric pivot. G/M and S remain delegated to the
// existing implementations; Edit Mode still delegates all G/M/R/S to v0.7.0.
let lastPointer = new THREE.Vector2();
let objectKeyboardRotate: ObjectKeyboardRotate | null = null;
window.addEventListener("pointermove", (event) => {
  lastPointer.set(event.clientX, event.clientY);
  if (objectKeyboardRotate) updateObjectKeyboardRotate(event.clientX, event.clientY, event.shiftKey, event.altKey);
}, true);

function updateObjectKeyboardRotate(clientX: number, clientY: number, shift: boolean, alt: boolean) {
  const modal = objectKeyboardRotate;
  if (!modal) return;
  let deltaDeg = normalizeDegrees(THREE.MathUtils.radToDeg(
    Math.atan2(clientY - modal.centerClient.y, clientX - modal.centerClient.x) - modal.startAngle,
  ));
  deltaDeg = snap(deltaDeg, shift ? 15 : alt ? .5 : 1);
  const axis = modal.axis ?? "z";
  const axisWorld = axisVector(axis);
  if (modal.space === "local" && modal.axis) axisWorld.applyQuaternion(modal.activeWorldQuaternion).normalize();
  const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(axisWorld, THREE.MathUtils.degToRad(deltaDeg));
  rotateStates(modal.states, modal.centerWorld, deltaQuaternion);
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  const axisText = `${axis.toUpperCase()} ${modal.axis ? modal.space.toUpperCase() : "GLOBAL"}`;
  if (modalBadge) modalBadge.textContent = `R · ${axisText} · pivot geométrico · click/Enter confirma · Esc cancela`;
  setStatus(`Rotar ${axisText}: ${deltaDeg.toFixed(1)}° · pivot geométrico.`);
}

function beginObjectKeyboardRotate() {
  const selection = editor.getSelection();
  const active = editor.activeObject();
  const centerWorld = selectionGeometricCenter();
  if (!selection.length || !active || !centerWorld) return false;
  editor.checkpoint();
  const centerClient = projectWorld(centerWorld);
  const startPointer = lastPointer.lengthSq() > 0 ? lastPointer.clone() : centerClient.clone().add(new THREE.Vector2(90, 0));
  objectKeyboardRotate = {
    axis: null,
    space: "global",
    centerWorld,
    centerClient,
    startPointer,
    startAngle: Math.atan2(startPointer.y - centerClient.y, startPointer.x - centerClient.x),
    activeWorldQuaternion: worldQuaternion(active),
    states: captureRotateStates(),
  };
  modalBadge?.classList.remove("hidden");
  updateObjectKeyboardRotate(startPointer.x, startPointer.y, false, false);
  return true;
}

function finishObjectKeyboardRotate(cancel: boolean) {
  const modal = objectKeyboardRotate;
  if (!modal) return;
  if (cancel) {
    for (const state of modal.states) {
      setWorldPosition(state.object, state.worldPosition);
      setWorldQuaternion(state.object, state.worldQuaternion);
    }
  }
  objectKeyboardRotate = null;
  modalBadge?.classList.add("hidden");
  editor.clearAxisConstraint();
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(cancel ? "Rotación cancelada." : "Rotación confirmada · pivot geométrico.");
}

const inheritedTransformKey = window.__tmV067TransformKeydownOverride;
window.__tmV067TransformKeydownOverride = (event: KeyboardEvent) => {
  if (inEditMode()) return inheritedTransformKey?.(event) ?? false;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return false;
  const key = event.key.toLowerCase();

  if (objectKeyboardRotate) {
    if (key === "x" || key === "y" || key === "z") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (objectKeyboardRotate.axis === key) objectKeyboardRotate.space = objectKeyboardRotate.space === "global" ? "local" : "global";
      else { objectKeyboardRotate.axis = key; objectKeyboardRotate.space = "global"; }
      editor.constrainAxis(key);
      updateObjectKeyboardRotate(lastPointer.x, lastPointer.y, event.shiftKey, event.altKey);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); finishObjectKeyboardRotate(true); return true;
    }
    if (event.key === "Enter") {
      event.preventDefault(); event.stopImmediatePropagation(); finishObjectKeyboardRotate(false); return true;
    }
    if (key === "r") {
      event.preventDefault(); event.stopImmediatePropagation(); return true;
    }
    return false;
  }

  if (key === "r" && !event.ctrlKey && !event.metaKey && !event.altKey && editor.getSelection().length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return beginObjectKeyboardRotate();
  }
  return inheritedTransformKey?.(event) ?? false;
};

window.addEventListener("pointerdown", (event) => {
  if (!objectKeyboardRotate || objectRotateGesture) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishObjectKeyboardRotate(false);
}, true);

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  editSelectionContract: "persistent-painted-selection",
  rotationPivotMode: "geometric-center",
  selectionBridgeVersion: "0.7.6",
});

setStatus("TinkerMatt v0.7.6 · selección persistente pintada + pivot geométrico de rotación.");
