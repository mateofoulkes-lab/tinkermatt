import * as THREE from "three";
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

type ComponentMode = "vertex" | "edge" | "face";
type TransformKind = "move" | "rotate" | "scale";
type Axis = "x" | "y" | "z";
type EditVertex = { id: string; indices: number[] };
type EditEdge = { id: string; a: string; b: string; triangles: number[]; feature: boolean };
type EditTriangle = { index: number; raw: [number, number, number]; vertices: [string, string, string]; edges: [string, string, string]; normal: THREE.Vector3; plane: number };
type EditFace = { id: string; triangles: number[]; vertices: Set<string> };
type EditTopology = {
  vertices: Map<string, EditVertex>;
  rawToVertex: Map<number, string>;
  edges: Map<string, EditEdge>;
  triangles: EditTriangle[];
  faces: Map<string, EditFace>;
  faceByTriangle: Map<number, string>;
};
type ModalTransform = {
  kind: TransformKind;
  axis: Axis | null;
  centerWorld: THREE.Vector3;
  centerClient: THREE.Vector2;
  startPointer: THREE.Vector2;
  startAngle: number;
  startRadius: number;
  positions: Float32Array;
  rawIndices: Set<number>;
  meshWorld: THREE.Matrix4;
  meshWorldInverse: THREE.Matrix4;
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.7.7 no pudo acceder al editor.");
const rawEditor = editor as any;
const canvas = editor.renderer.domElement;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
const editToolbar = document.querySelector<HTMLElement>(".tm-edit-toolbar");
const editCount = document.querySelector<HTMLElement>("[data-edit-count]");
const editModeLabel = document.querySelector<HTMLElement>("[data-edit-mode-label]");
const modalBadge = document.querySelector<HTMLElement>(".tm-modal-badge");

const setStatus = (text: string) => { if (status) status.textContent = text; };
const inEditMode = () => document.documentElement.classList.contains("tm-edit-mode");
const applyVersion = () => { if (version) version.textContent = "v0.7.7"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

let targetMesh: THREE.Mesh | null = null;
let targetId: string | null = null;
let topology: EditTopology | null = null;
let mode: ComponentMode = "vertex";
const selectedVertices = new Set<string>();
const selectedEdges = new Set<string>();
const selectedFaces = new Set<string>();
let modal: ModalTransform | null = null;
let lastPointer = new THREE.Vector2();

const selectionVisual = new THREE.Group();
selectionVisual.name = "__tm_v077_selection";
editor.scene.add(selectionVisual);

function rawIndex(geometry: THREE.BufferGeometry, triangle: number, corner: number) {
  const item = triangle * 3 + corner;
  return geometry.index ? geometry.index.getX(item) : item;
}

function buildTopology(mesh: THREE.Mesh): EditTopology {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  geometry.computeBoundingBox();
  const diagonal = geometry.boundingBox?.getSize(new THREE.Vector3()).length() || 1;
  const epsilon = Math.max(1e-7, diagonal * 1e-6);
  const planeTolerance = Math.max(1e-6, diagonal * 2e-6);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < position.count; i += 1) {
    const key = `${Math.round(position.getX(i) / epsilon)},${Math.round(position.getY(i) / epsilon)},${Math.round(position.getZ(i) / epsilon)}`;
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  }

  const vertices = new Map<string, EditVertex>();
  const rawToVertex = new Map<number, string>();
  for (const indices of groups.values()) {
    indices.sort((a, b) => a - b);
    const id = `v:${indices.join(".")}`;
    vertices.set(id, { id, indices });
    for (const index of indices) rawToVertex.set(index, id);
  }

  const pair = (a: string, b: string) => a < b ? `e:${a}|${b}` : `e:${b}|${a}`;
  const triangles: EditTriangle[] = [];
  const edges = new Map<string, EditEdge>();
  const triangleCount = geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(position.count / 3);

  for (let tri = 0; tri < triangleCount; tri += 1) {
    const raw = [rawIndex(geometry, tri, 0), rawIndex(geometry, tri, 1), rawIndex(geometry, tri, 2)] as [number, number, number];
    const ids = raw.map((index) => rawToVertex.get(index)!) as [string, string, string];
    if (ids.some((id) => !id)) continue;
    const points = raw.map((index) => new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index))) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const normal = new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0])).normalize();
    const edgeIds = [pair(ids[0], ids[1]), pair(ids[1], ids[2]), pair(ids[2], ids[0])] as [string, string, string];
    triangles.push({ index: tri, raw, vertices: ids, edges: edgeIds, normal, plane: normal.dot(points[0]) });
    for (let i = 0; i < 3; i += 1) {
      const a = ids[i];
      const b = ids[(i + 1) % 3];
      const id = edgeIds[i];
      const edge = edges.get(id) ?? { id, a: a < b ? a : b, b: a < b ? b : a, triangles: [], feature: true };
      edge.triangles.push(tri);
      edges.set(id, edge);
    }
  }

  const byTriangle = new Map(triangles.map((triangle) => [triangle.index, triangle]));
  const coplanar = (a: EditTriangle, b: EditTriangle) => {
    const dot = a.normal.dot(b.normal);
    if (Math.abs(dot) < 0.999995) return false;
    return dot >= 0 ? Math.abs(a.plane - b.plane) <= planeTolerance : Math.abs(a.plane + b.plane) <= planeTolerance;
  };
  for (const edge of edges.values()) {
    if (edge.triangles.length === 2) {
      const a = byTriangle.get(edge.triangles[0]);
      const b = byTriangle.get(edge.triangles[1]);
      edge.feature = Boolean(a && b) ? !coplanar(a!, b!) : true;
    } else edge.feature = true;
  }

  const faces = new Map<string, EditFace>();
  const faceByTriangle = new Map<number, string>();
  const visited = new Set<number>();
  for (const seed of triangles) {
    if (visited.has(seed.index)) continue;
    const queue = [seed.index];
    const members: number[] = [];
    const faceVertices = new Set<string>();
    while (queue.length) {
      const index = queue.pop()!;
      if (visited.has(index)) continue;
      const tri = byTriangle.get(index);
      if (!tri || !coplanar(seed, tri)) continue;
      visited.add(index);
      members.push(index);
      tri.vertices.forEach((id) => faceVertices.add(id));
      for (const edgeId of tri.edges) {
        for (const neighbor of edges.get(edgeId)?.triangles ?? []) if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    members.sort((a, b) => a - b);
    const id = `f:${members.join(".")}`;
    faces.set(id, { id, triangles: members, vertices: faceVertices });
    members.forEach((index) => faceByTriangle.set(index, id));
  }

  return { vertices, rawToVertex, edges, triangles, faces, faceByTriangle };
}

function currentSet() {
  return mode === "vertex" ? selectedVertices : mode === "edge" ? selectedEdges : selectedFaces;
}

function localPointForVertex(id: string) {
  if (!targetMesh || !topology) return null;
  const vertex = topology.vertices.get(id);
  if (!vertex?.indices.length) return null;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const index = vertex.indices[0];
  return new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
}

function worldPointForVertex(id: string) {
  if (!targetMesh) return null;
  const local = localPointForVertex(id);
  if (!local) return null;
  targetMesh.updateMatrixWorld(true);
  return local.applyMatrix4(targetMesh.matrixWorld);
}

function selectedVertexIds() {
  const ids = new Set<string>();
  if (!topology) return ids;
  if (mode === "vertex") selectedVertices.forEach((id) => ids.add(id));
  else if (mode === "edge") selectedEdges.forEach((id) => {
    const edge = topology!.edges.get(id);
    if (edge) { ids.add(edge.a); ids.add(edge.b); }
  });
  else selectedFaces.forEach((id) => topology!.faces.get(id)?.vertices.forEach((vertexId) => ids.add(vertexId)));
  return ids;
}

function selectedRawIndices() {
  const result = new Set<number>();
  if (!topology) return result;
  for (const id of selectedVertexIds()) topology.vertices.get(id)?.indices.forEach((index) => result.add(index));
  return result;
}

function disposeVisuals() {
  for (const child of [...selectionVisual.children]) {
    child.removeFromParent();
    const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    geometry?.dispose?.();
    const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material) (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
  }
}

function renderVertex(id: string) {
  const point = worldPointForVertex(id);
  if (!point) return;
  const geometry = new THREE.BufferGeometry().setFromPoints([point]);
  const material = new THREE.PointsMaterial({ color: 0x00b5ee, size: 14, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 1 });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 6000;
  selectionVisual.add(points);
}

function renderEdge(id: string) {
  if (!topology) return;
  const edge = topology.edges.get(id);
  if (!edge) return;
  const a = worldPointForVertex(edge.a);
  const b = worldPointForVertex(edge.b);
  if (!a || !b) return;
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
  const material = new THREE.LineBasicMaterial({ color: 0x00b5ee, depthTest: false, transparent: true, opacity: 1 });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 5999;
  selectionVisual.add(line);
}

function renderFace(id: string) {
  if (!targetMesh || !topology) return;
  const face = topology.faces.get(id);
  if (!face) return;
  const values: number[] = [];
  for (const triIndex of face.triangles) {
    const triangle = topology.triangles.find((item) => item.index === triIndex);
    if (!triangle) continue;
    for (const vertexId of triangle.vertices) {
      const p = worldPointForVertex(vertexId);
      if (p) values.push(p.x, p.y, p.z);
    }
  }
  if (!values.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  const material = new THREE.MeshBasicMaterial({ color: 0x00b5ee, transparent: true, opacity: .38, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 5998;
  selectionVisual.add(mesh);
}

function updateSelectionUi() {
  if (editModeLabel) editModeLabel.textContent = mode === "vertex" ? "Vértices" : mode === "edge" ? "Aristas" : "Caras";
  if (editCount) {
    const count = currentSet().size;
    editCount.textContent = `${count} seleccionado${count === 1 ? "" : "s"}`;
  }
}

function repaintSelection() {
  disposeVisuals();
  if (!inEditMode() || !targetMesh) return;
  if (mode === "vertex") selectedVertices.forEach(renderVertex);
  else if (mode === "edge") selectedEdges.forEach(renderEdge);
  else selectedFaces.forEach(renderFace);
  updateSelectionUi();
}

function clearSelection() {
  selectedVertices.clear();
  selectedEdges.clear();
  selectedFaces.clear();
  repaintSelection();
}

function projectWorld(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const projected = point.clone().project(editor.camera);
  return new THREE.Vector2(
    rect.left + (projected.x * .5 + .5) * rect.width,
    rect.top + (-projected.y * .5 + .5) * rect.height,
  );
}

function segmentDistance(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-8) return point.distanceTo(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lenSq, 0, 1);
  return point.distanceTo(a.add(ab.multiplyScalar(t)));
}

const raycaster = new THREE.Raycaster();
function faceAt(clientX: number, clientY: number) {
  if (!targetMesh || !topology) return null;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, editor.camera);
  const hit = raycaster.intersectObject(targetMesh, false)[0];
  if (!hit || hit.faceIndex == null) return null;
  return topology.faceByTriangle.get(hit.faceIndex) ?? null;
}

function vertexAt(clientX: number, clientY: number) {
  if (!targetMesh || !topology) return null;
  const cursor = new THREE.Vector2(clientX, clientY);
  let best: { id: string; distance: number; camera: number } | null = null;
  for (const id of topology.vertices.keys()) {
    const world = worldPointForVertex(id);
    if (!world) continue;
    const projected = world.clone().project(editor.camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const distance = projectWorld(world).distanceTo(cursor);
    if (distance > 22) continue;
    const cameraDistance = world.distanceToSquared(editor.camera.position);
    if (!best || distance < best.distance - .5 || (Math.abs(distance - best.distance) <= .5 && cameraDistance < best.camera)) best = { id, distance, camera: cameraDistance };
  }
  return best?.id ?? null;
}

function edgeAt(clientX: number, clientY: number) {
  if (!topology) return null;
  const cursor = new THREE.Vector2(clientX, clientY);
  let best: { id: string; distance: number; camera: number } | null = null;
  for (const edge of topology.edges.values()) {
    if (!edge.feature) continue;
    const a = worldPointForVertex(edge.a);
    const b = worldPointForVertex(edge.b);
    if (!a || !b) continue;
    const distance = segmentDistance(cursor, projectWorld(a), projectWorld(b));
    if (distance > 18) continue;
    const center = a.clone().add(b).multiplyScalar(.5);
    const cameraDistance = center.distanceToSquared(editor.camera.position);
    if (!best || distance < best.distance - .5 || (Math.abs(distance - best.distance) <= .5 && cameraDistance < best.camera)) best = { id: edge.id, distance, camera: cameraDistance };
  }
  return best?.id ?? null;
}

function componentAt(clientX: number, clientY: number) {
  if (mode === "vertex") return vertexAt(clientX, clientY);
  if (mode === "edge") return edgeAt(clientX, clientY);
  return faceAt(clientX, clientY);
}

function lockTargetMesh() {
  const active = editor.activeObject();
  targetMesh = active instanceof THREE.Mesh && Boolean(active.geometry?.getAttribute("position")) ? active : null;
  targetId = targetMesh ? getMeta(targetMesh)?.id ?? null : null;
  topology = targetMesh ? buildTopology(targetMesh) : null;
  clearSelection();
}

function hideObjectManipulators() {
  const edit = inEditMode();
  for (const name of ["__tm_tinkercad_controls", "__tm_tinkercad_controls_v044"]) {
    const object = editor.scene.getObjectByName(name);
    if (object && edit) object.visible = false;
  }
  if (edit) {
    editor.transform.detach();
    editor.transform.getHelper().visible = false;
  }
}
requestAnimationFrame(function suppressObjectUi() {
  hideObjectManipulators();
  requestAnimationFrame(suppressObjectUi);
});

// Object selection is frozen while editing. Component selection below is the
// only left-click owner on the canvas in Edit Mode.
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

window.addEventListener("pointermove", (event) => {
  lastPointer.set(event.clientX, event.clientY);
  if (modal) updateModal(event.clientX, event.clientY, event.shiftKey, event.altKey);
}, true);

window.addEventListener("pointerdown", (event) => {
  if (!inEditMode() || event.button !== 0 || event.target !== canvas) return;
  if (modal) {
    event.preventDefault();
    event.stopImmediatePropagation();
    finishModal(false);
    return;
  }
  if (!targetMesh) lockTargetMesh();
  if (!targetMesh || !topology) return;

  const id = componentAt(event.clientX, event.clientY);
  event.preventDefault();
  event.stopImmediatePropagation();

  const set = currentSet();
  if (!id) {
    if (!event.shiftKey) set.clear();
  } else if (event.shiftKey) {
    if (set.has(id)) set.delete(id); else set.add(id);
  } else {
    set.clear();
    set.add(id);
  }
  repaintSelection();
  const count = set.size;
  setStatus(`${count} ${mode === "vertex" ? "vértice" : mode === "edge" ? "arista" : "cara"}${count === 1 ? "" : "s"} seleccionado${count === 1 ? "" : "s"}. Shift suma/quita · M/G mueve · R rota · S escala.`);
}, true);

function selectionCenterWorld() {
  const ids = selectedVertexIds();
  if (!ids.size) return null;
  const sum = new THREE.Vector3();
  let count = 0;
  for (const id of ids) {
    const world = worldPointForVertex(id);
    if (!world) continue;
    sum.add(world);
    count += 1;
  }
  return count ? sum.multiplyScalar(1 / count) : null;
}

function snapshotPositions() {
  if (!targetMesh) return new Float32Array();
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  return new Float32Array(position.array as ArrayLike<number>);
}

function axisVector(axis: Axis) {
  return axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}

function pointerScalar(dx: number, dy: number, direction: THREE.Vector3, origin: THREE.Vector3) {
  const a = projectWorld(origin);
  const b = projectWorld(origin.clone().add(direction));
  const v = b.sub(a);
  const lenSq = v.lengthSq();
  return lenSq < 1e-8 ? 0 : (dx * v.x + dy * v.y) / lenSq;
}

function rayToPlane(clientX: number, clientY: number, center: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, editor.camera);
  const normal = editor.camera.getWorldDirection(new THREE.Vector3());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
  return ray.ray.intersectPlane(plane, new THREE.Vector3());
}

function beginModal(kind: TransformKind) {
  if (!inEditMode() || !targetMesh || !currentSet().size) return false;
  const center = selectionCenterWorld();
  if (!center) return false;
  const centerClient = projectWorld(center);
  const pointer = lastPointer.lengthSq() ? lastPointer.clone() : centerClient.clone().add(new THREE.Vector2(90, 0));
  editor.checkpoint();
  targetMesh.updateMatrixWorld(true);
  modal = {
    kind,
    axis: null,
    centerWorld: center,
    centerClient,
    startPointer: pointer,
    startAngle: Math.atan2(pointer.y - centerClient.y, pointer.x - centerClient.x),
    startRadius: Math.max(12, pointer.distanceTo(centerClient)),
    positions: snapshotPositions(),
    rawIndices: selectedRawIndices(),
    meshWorld: targetMesh.matrixWorld.clone(),
    meshWorldInverse: targetMesh.matrixWorld.clone().invert(),
  };
  modalBadge?.classList.remove("hidden");
  updateModal(pointer.x, pointer.y, false, false);
  return true;
}

function applyWorldPoint(index: number, world: THREE.Vector3) {
  if (!targetMesh || !modal) return;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const local = world.applyMatrix4(modal.meshWorldInverse);
  position.setXYZ(index, local.x, local.y, local.z);
}

function updateModal(clientX: number, clientY: number, shift: boolean, alt: boolean) {
  if (!modal || !targetMesh) return;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const step = editor.getSnap();
  const snapStep = step.enabled ? step.gridSize * (alt ? .1 : shift ? 10 : 1) : 0;
  const axis = modal.axis;

  let moveDelta = new THREE.Vector3();
  let angle = 0;
  let ratio = 1;
  if (modal.kind === "move") {
    if (axis) {
      let amount = pointerScalar(clientX - modal.startPointer.x, clientY - modal.startPointer.y, axisVector(axis), modal.centerWorld);
      if (snapStep > 0) amount = Math.round(amount / snapStep) * snapStep;
      moveDelta.copy(axisVector(axis)).multiplyScalar(amount);
    } else {
      const a = rayToPlane(modal.startPointer.x, modal.startPointer.y, modal.centerWorld);
      const b = rayToPlane(clientX, clientY, modal.centerWorld);
      if (a && b) moveDelta.copy(b).sub(a);
    }
  } else if (modal.kind === "rotate") {
    const current = Math.atan2(clientY - modal.centerClient.y, clientX - modal.centerClient.x);
    angle = current - modal.startAngle;
    const angleStep = shift ? 15 : alt ? .5 : 1;
    angle = THREE.MathUtils.degToRad(Math.round(THREE.MathUtils.radToDeg(angle) / angleStep) * angleStep);
  } else {
    ratio = Math.max(.01, new THREE.Vector2(clientX, clientY).distanceTo(modal.centerClient) / modal.startRadius);
    if (shift) ratio = Math.round(ratio * 10) / 10;
  }

  const rotationAxis = axisVector(axis ?? "z");
  const rotation = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);

  for (const index of modal.rawIndices) {
    const local = new THREE.Vector3(modal.positions[index * 3], modal.positions[index * 3 + 1], modal.positions[index * 3 + 2]);
    const world = local.applyMatrix4(modal.meshWorld);
    if (modal.kind === "move") world.add(moveDelta);
    else if (modal.kind === "rotate") world.sub(modal.centerWorld).applyQuaternion(rotation).add(modal.centerWorld);
    else {
      const relative = world.sub(modal.centerWorld);
      if (!axis) relative.multiplyScalar(ratio);
      else relative[axis] *= ratio;
      world.copy(relative.add(modal.centerWorld));
    }
    applyWorldPoint(index, world);
  }

  position.needsUpdate = true;
  targetMesh.geometry.computeVertexNormals();
  targetMesh.geometry.computeBoundingBox();
  targetMesh.geometry.computeBoundingSphere();
  repaintSelection();
  rawEditor.emit?.("changed");
  if (modalBadge) {
    const name = modal.kind === "move" ? "MOVER" : modal.kind === "rotate" ? "ROTAR" : "ESCALAR";
    modalBadge.textContent = `${name}${axis ? ` · ${axis.toUpperCase()}` : ""} · X/Y/Z restringe · click/Enter confirma · Esc cancela`;
  }
}

function restoreModalPositions() {
  if (!modal || !targetMesh) return;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (const index of modal.rawIndices) {
    position.setXYZ(index, modal.positions[index * 3], modal.positions[index * 3 + 1], modal.positions[index * 3 + 2]);
  }
  position.needsUpdate = true;
  targetMesh.geometry.computeVertexNormals();
  targetMesh.geometry.computeBoundingBox();
  targetMesh.geometry.computeBoundingSphere();
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

function finishModal(cancel: boolean) {
  if (!modal) return;
  if (cancel) restoreModalPositions();
  else markDirectMesh();
  modal = null;
  modalBadge?.classList.add("hidden");
  if (targetMesh) topology = buildTopology(targetMesh);
  repaintSelection();
  rawEditor.emit?.("changed");
  setStatus(cancel ? "Transformación cancelada." : "Transformación aplicada a la selección pintada.");
}

const oldScaleOverride = window.__tmV064ScaleKeydownOverride;
const oldTransformOverride = window.__tmV067TransformKeydownOverride;
function editKeyOverride(event: KeyboardEvent) {
  if (!inEditMode()) return false;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return false;
  const key = event.key.toLowerCase();

  if (modal) {
    if (key === "x" || key === "y" || key === "z") {
      event.preventDefault(); event.stopImmediatePropagation();
      modal.axis = modal.axis === key ? null : key;
      updateModal(lastPointer.x, lastPointer.y, event.shiftKey, event.altKey);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); finishModal(true); return true;
    }
    if (event.key === "Enter") {
      event.preventDefault(); event.stopImmediatePropagation(); finishModal(false); return true;
    }
    if (key === "m" || key === "g" || key === "r" || key === "s") {
      event.preventDefault(); event.stopImmediatePropagation(); return true;
    }
    return false;
  }

  const kind: TransformKind | null = key === "m" || key === "g" ? "move" : key === "r" ? "rotate" : key === "s" ? "scale" : null;
  if (!kind || !currentSet().size) return false;
  event.preventDefault(); event.stopImmediatePropagation();
  beginModal(kind);
  return true;
}
window.__tmV064ScaleKeydownOverride = (event) => inEditMode() ? editKeyOverride(event) : oldScaleOverride?.(event) ?? false;
window.__tmV067TransformKeydownOverride = (event) => inEditMode() ? editKeyOverride(event) : oldTransformOverride?.(event) ?? false;

// Our own capture listener also catches key events registered after the original
// override bridge, including Tab and component-mode switches.
window.addEventListener("keydown", (event) => {
  if (!inEditMode()) return;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return;
  if (editKeyOverride(event)) return;
  if (event.key === "1" || event.key === "2" || event.key === "3") {
    event.preventDefault(); event.stopImmediatePropagation();
    mode = event.key === "1" ? "vertex" : event.key === "2" ? "edge" : "face";
    clearSelection();
    document.querySelector<HTMLButtonElement>(`.tm-edit-toolbar [data-edit-select="${mode}"]`)?.click();
  }
}, true);

editToolbar?.querySelectorAll<HTMLButtonElement>("[data-edit-select]").forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.editSelect;
    mode = next === "edge" || next === "face" ? next : "vertex";
    clearSelection();
  });
});
editToolbar?.querySelectorAll<HTMLButtonElement>("[data-edit-transform]").forEach((button) => {
  button.addEventListener("click", () => {
    const kind = button.dataset.editTransform === "rotate" ? "rotate" : button.dataset.editTransform === "scale" ? "scale" : "move";
    if (currentSet().size) beginModal(kind);
  });
});

let lastEditMode = inEditMode();
if (lastEditMode) lockTargetMesh();
const modeObserver = new MutationObserver(() => {
  const now = inEditMode();
  if (now !== lastEditMode) {
    lastEditMode = now;
    if (now) {
      mode = currentComponentModeFromUi();
      lockTargetMesh();
      hideObjectManipulators();
      setStatus("EDIT MODE · click selecciona y pinta · Shift suma/quita · M/G/R/S transforma sólo lo pintado.");
    } else {
      modal = null;
      targetMesh = null;
      targetId = null;
      topology = null;
      selectedVertices.clear(); selectedEdges.clear(); selectedFaces.clear();
      disposeVisuals();
      modalBadge?.classList.add("hidden");
    }
  }
  applyVersion();
});
modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

function currentComponentModeFromUi(): ComponentMode {
  const active = editToolbar?.querySelector<HTMLElement>("[data-edit-select].active")?.dataset.editSelect;
  return active === "edge" || active === "face" ? active : "vertex";
}

// Undo/redo may replace the mesh instance. Retarget by stable semantic id.
editor.on("changed", () => {
  if (!inEditMode() || !targetId) return;
  if (!targetMesh?.parent) {
    const replacement = editor.findById(targetId);
    if (replacement instanceof THREE.Mesh) {
      targetMesh = replacement;
      topology = buildTopology(replacement);
      clearSelection();
    }
  }
});

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  editSelectionVersion: "0.7.7",
  getEditSelection: () => ({ mode, ids: [...currentSet()] }),
  clearEditSelection: () => clearSelection(),
});

setStatus("TinkerMatt v0.7.7 · selección persistente propia + bloqueo total de controles de objeto en Edición.");
