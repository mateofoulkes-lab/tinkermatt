import * as THREE from "three";
import "./v078";
import { getMeta, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV079PointerDownOverride?: (event: PointerEvent) => boolean;
    __tmV079KeydownOverride?: (event: KeyboardEvent) => boolean;
    tinkerMatt: Record<string, any>;
  }
}

type ComponentMode = "vertex" | "edge" | "face";
type TransformKind = "move" | "rotate" | "scale";
type Axis = "x" | "y" | "z";
type GeomVertex = { id: string; point: THREE.Vector3; indices: number[] };
type TopoTriangle = {
  index: number;
  raw: [number, number, number];
  vertices: [string, string, string];
  edges: [string, string, string];
  normal: THREE.Vector3;
  plane: number;
};
type TopoEdge = { id: string; a: string; b: string; triangles: number[]; feature: boolean };
type LogicalFace = { id: string; triangles: number[]; vertices: Set<string> };
type EdgeChain = { id: string; edges: string[]; vertices: Set<string> };
type EditTopology = {
  vertices: Map<string, GeomVertex>;
  rawToVertex: Map<number, string>;
  triangles: TopoTriangle[];
  triangleByIndex: Map<number, TopoTriangle>;
  edges: Map<string, TopoEdge>;
  faces: Map<string, LogicalFace>;
  faceByTriangle: Map<number, string>;
  chains: Map<string, EdgeChain>;
  chainByEdge: Map<string, string>;
  weldTolerance: number;
  planeTolerance: number;
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
if (!editor) throw new Error("TinkerMatt v0.7.9 no pudo acceder al editor.");
const rawEditor = editor as any;
const canvas = editor.renderer.domElement;
const version = document.querySelector<HTMLElement>(".version");
const status = document.querySelector<HTMLElement>("#status");
const editToolbar = document.querySelector<HTMLElement>(".tm-edit-toolbar");
const editCount = document.querySelector<HTMLElement>("[data-edit-count]");
const editModeLabel = document.querySelector<HTMLElement>("[data-edit-mode-label]");
const topologyLabel = document.querySelector<HTMLElement>("[data-edit-topology]");
const modalBadge = document.querySelector<HTMLElement>(".tm-modal-badge");

const inEditMode = () => document.documentElement.classList.contains("tm-edit-mode");
const setStatus = (text: string) => { if (status) status.textContent = text; };
const applyVersion = () => { if (version) version.textContent = "v0.7.9"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

let targetMesh: THREE.Mesh | null = null;
let targetId: string | null = null;
let topology: EditTopology | null = null;
let mode: ComponentMode = "vertex";
const selectedVertices = new Set<string>();
const selectedChains = new Set<string>();
const selectedFaces = new Set<string>();
let modal: ModalTransform | null = null;
let lastPointer = new THREE.Vector2();

const selectionVisual = new THREE.Group();
selectionVisual.name = "__tm_v079_selection";
editor.scene.add(selectionVisual);

function rawIndex(geometry: THREE.BufferGeometry, triangle: number, corner: number) {
  const item = triangle * 3 + corner;
  return geometry.index ? geometry.index.getX(item) : item;
}

function pairId(a: string, b: string) {
  return a < b ? `e:${a}|${b}` : `e:${b}|${a}`;
}

function buildTopology(mesh: THREE.Mesh): EditTopology {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
  const diagonal = Math.max(1, size.length());
  // CSG frequently duplicates what is visually one vertex with tiny numerical
  // differences. Treat sub-micron/render noise as one CAD vertex.
  const weldTolerance = Math.max(1e-5, diagonal * 1e-5);
  const planeTolerance = Math.max(1e-5, diagonal * 2e-5);
  const cell = weldTolerance;
  const buckets = new Map<string, Array<{ point: THREE.Vector3; indices: number[] }>>();
  const groups: Array<{ point: THREE.Vector3; indices: number[] }> = [];
  const rawGroup = new Map<number, { point: THREE.Vector3; indices: number[] }>();
  const keyFor = (x: number, y: number, z: number) => `${x},${y},${z}`;

  for (let i = 0; i < position.count; i += 1) {
    const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const cx = Math.floor(point.x / cell), cy = Math.floor(point.y / cell), cz = Math.floor(point.z / cell);
    let group: { point: THREE.Vector3; indices: number[] } | null = null;
    for (let dx = -1; dx <= 1 && !group; dx += 1) {
      for (let dy = -1; dy <= 1 && !group; dy += 1) {
        for (let dz = -1; dz <= 1 && !group; dz += 1) {
          for (const candidate of buckets.get(keyFor(cx + dx, cy + dy, cz + dz)) ?? []) {
            if (candidate.point.distanceToSquared(point) <= weldTolerance * weldTolerance) { group = candidate; break; }
          }
        }
      }
    }
    if (!group) {
      group = { point: point.clone(), indices: [] };
      groups.push(group);
      const key = keyFor(cx, cy, cz);
      const list = buckets.get(key) ?? [];
      list.push(group);
      buckets.set(key, list);
    }
    group.indices.push(i);
    rawGroup.set(i, group);
  }

  const vertices = new Map<string, GeomVertex>();
  const rawToVertex = new Map<number, string>();
  for (const group of groups) {
    group.indices.sort((a, b) => a - b);
    const id = `v:${group.indices.join(".")}`;
    // Average the near-coincident positions; this is only the logical point used
    // for topology. Actual raw positions are preserved until the user edits.
    const average = new THREE.Vector3();
    for (const index of group.indices) average.add(new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)));
    average.multiplyScalar(1 / group.indices.length);
    vertices.set(id, { id, point: average, indices: [...group.indices] });
    group.indices.forEach((index) => rawToVertex.set(index, id));
  }

  const triangles: TopoTriangle[] = [];
  const edges = new Map<string, TopoEdge>();
  const triangleCount = geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(position.count / 3);
  for (let triIndex = 0; triIndex < triangleCount; triIndex += 1) {
    const raw = [rawIndex(geometry, triIndex, 0), rawIndex(geometry, triIndex, 1), rawIndex(geometry, triIndex, 2)] as [number, number, number];
    const ids = raw.map((index) => rawToVertex.get(index)!) as [string, string, string];
    if (ids.some((id) => !id) || new Set(ids).size < 3) continue;
    const points = ids.map((id) => vertices.get(id)!.point) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const normal = new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0]));
    if (normal.lengthSq() < 1e-16) continue;
    normal.normalize();
    const edgeIds = [pairId(ids[0], ids[1]), pairId(ids[1], ids[2]), pairId(ids[2], ids[0])] as [string, string, string];
    const tri: TopoTriangle = { index: triIndex, raw, vertices: ids, edges: edgeIds, normal, plane: normal.dot(points[0]) };
    triangles.push(tri);
    for (let i = 0; i < 3; i += 1) {
      const a = ids[i], b = ids[(i + 1) % 3], id = edgeIds[i];
      const edge = edges.get(id) ?? { id, a: a < b ? a : b, b: a < b ? b : a, triangles: [], feature: true };
      edge.triangles.push(triIndex);
      edges.set(id, edge);
    }
  }
  const triangleByIndex = new Map(triangles.map((triangle) => [triangle.index, triangle]));
  const coplanar = (a: TopoTriangle, b: TopoTriangle) => {
    const dot = a.normal.dot(b.normal);
    if (Math.abs(dot) < 0.99999) return false;
    return dot >= 0 ? Math.abs(a.plane - b.plane) <= planeTolerance : Math.abs(a.plane + b.plane) <= planeTolerance;
  };

  for (const edge of edges.values()) {
    if (edge.triangles.length !== 2) { edge.feature = true; continue; }
    const a = triangleByIndex.get(edge.triangles[0]), b = triangleByIndex.get(edge.triangles[1]);
    edge.feature = !(a && b && coplanar(a, b));
  }

  // Logical faces = connected components of coplanar triangles. Coplanarity
  // alone is not enough: disconnected islands on the same plane stay separate.
  const faces = new Map<string, LogicalFace>();
  const faceByTriangle = new Map<number, string>();
  const visitedTriangles = new Set<number>();
  for (const seed of triangles) {
    if (visitedTriangles.has(seed.index)) continue;
    const queue = [seed.index];
    const members: number[] = [];
    const faceVertices = new Set<string>();
    while (queue.length) {
      const index = queue.pop()!;
      if (visitedTriangles.has(index)) continue;
      const tri = triangleByIndex.get(index);
      if (!tri || !coplanar(seed, tri)) continue;
      visitedTriangles.add(index);
      members.push(index);
      tri.vertices.forEach((id) => faceVertices.add(id));
      for (const edgeId of tri.edges) {
        for (const neighbor of edges.get(edgeId)?.triangles ?? []) {
          if (!visitedTriangles.has(neighbor)) queue.push(neighbor);
        }
      }
    }
    members.sort((a, b) => a - b);
    const id = `f:${members.join(".")}`;
    const face = { id, triangles: members, vertices: faceVertices };
    faces.set(id, face);
    members.forEach((index) => faceByTriangle.set(index, id));
  }

  // Logical edges = connected, collinear chains of feature edges. This makes a
  // subdivided cube edge behave as one CAD edge instead of many little segments.
  const vertexToFeatureEdges = new Map<string, string[]>();
  for (const edge of edges.values()) {
    if (!edge.feature) continue;
    for (const vertexId of [edge.a, edge.b]) {
      const list = vertexToFeatureEdges.get(vertexId) ?? [];
      list.push(edge.id);
      vertexToFeatureEdges.set(vertexId, list);
    }
  }
  const edgeDirection = (edge: TopoEdge) => vertices.get(edge.b)!.point.clone().sub(vertices.get(edge.a)!.point).normalize();
  const chains = new Map<string, EdgeChain>();
  const chainByEdge = new Map<string, string>();
  const visitedEdges = new Set<string>();
  for (const seed of edges.values()) {
    if (!seed.feature || visitedEdges.has(seed.id)) continue;
    const reference = edgeDirection(seed);
    const queue = [seed.id];
    const memberEdges: string[] = [];
    const memberVertices = new Set<string>();
    while (queue.length) {
      const edgeId = queue.pop()!;
      if (visitedEdges.has(edgeId)) continue;
      const edge = edges.get(edgeId);
      if (!edge?.feature) continue;
      const direction = edgeDirection(edge);
      if (Math.abs(direction.dot(reference)) < 0.9995) continue;
      visitedEdges.add(edgeId);
      memberEdges.push(edgeId);
      memberVertices.add(edge.a); memberVertices.add(edge.b);
      for (const vertexId of [edge.a, edge.b]) {
        for (const neighborId of vertexToFeatureEdges.get(vertexId) ?? []) {
          if (!visitedEdges.has(neighborId)) {
            const neighbor = edges.get(neighborId);
            if (neighbor && Math.abs(edgeDirection(neighbor).dot(reference)) >= 0.9995) queue.push(neighborId);
          }
        }
      }
    }
    memberEdges.sort();
    const id = `c:${memberEdges.join(";")}`;
    const chain = { id, edges: memberEdges, vertices: memberVertices };
    chains.set(id, chain);
    memberEdges.forEach((edgeId) => chainByEdge.set(edgeId, id));
  }

  return { vertices, rawToVertex, triangles, triangleByIndex, edges, faces, faceByTriangle, chains, chainByEdge, weldTolerance, planeTolerance };
}

function currentSet() {
  return mode === "vertex" ? selectedVertices : mode === "edge" ? selectedChains : selectedFaces;
}

function selectedVertexIds() {
  const result = new Set<string>();
  if (!topology) return result;
  if (mode === "vertex") selectedVertices.forEach((id) => result.add(id));
  else if (mode === "edge") selectedChains.forEach((id) => topology!.chains.get(id)?.vertices.forEach((vertexId) => result.add(vertexId)));
  else selectedFaces.forEach((id) => topology!.faces.get(id)?.vertices.forEach((vertexId) => result.add(vertexId)));
  return result;
}

function selectedRawIndices() {
  const result = new Set<number>();
  if (!topology) return result;
  selectedVertexIds().forEach((id) => topology!.vertices.get(id)?.indices.forEach((index) => result.add(index)));
  return result;
}

function localPointForVertex(id: string) {
  if (!targetMesh || !topology) return null;
  const vertex = topology.vertices.get(id);
  if (!vertex?.indices.length) return null;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const average = new THREE.Vector3();
  for (const index of vertex.indices) average.add(new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)));
  return average.multiplyScalar(1 / vertex.indices.length);
}

function worldPointForVertex(id: string) {
  if (!targetMesh) return null;
  const local = localPointForVertex(id);
  if (!local) return null;
  targetMesh.updateMatrixWorld(true);
  return local.applyMatrix4(targetMesh.matrixWorld);
}

function clearVisuals() {
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
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x00b5ee, size: 14, sizeAttenuation: false, depthTest: false }));
  points.renderOrder = 7000;
  selectionVisual.add(points);
}

function renderChain(id: string) {
  if (!topology) return;
  const chain = topology.chains.get(id);
  if (!chain) return;
  for (const edgeId of chain.edges) {
    const edge = topology.edges.get(edgeId);
    if (!edge) continue;
    const a = worldPointForVertex(edge.a), b = worldPointForVertex(edge.b);
    if (!a || !b) continue;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: 0x00b5ee, depthTest: false }),
    );
    line.renderOrder = 6999;
    selectionVisual.add(line);
  }
}

function renderFace(id: string) {
  if (!topology) return;
  const face = topology.faces.get(id);
  if (!face) return;
  const values: number[] = [];
  for (const triIndex of face.triangles) {
    const tri = topology.triangleByIndex.get(triIndex);
    if (!tri) continue;
    for (const vertexId of tri.vertices) {
      const point = worldPointForVertex(vertexId);
      if (point) values.push(point.x, point.y, point.z);
    }
  }
  if (!values.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x00b5ee, transparent: true, opacity: .38, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  mesh.renderOrder = 6998;
  selectionVisual.add(mesh);
}

function updateUi() {
  if (editModeLabel) editModeLabel.textContent = mode === "vertex" ? "Vértices" : mode === "edge" ? "Aristas" : "Caras";
  if (editCount) {
    const count = currentSet().size;
    editCount.textContent = `${count} seleccionado${count === 1 ? "" : "s"}`;
  }
  if (topologyLabel && topology) topologyLabel.textContent = `${topology.vertices.size} vértices · ${topology.chains.size} aristas lógicas · ${topology.faces.size} caras lógicas`;
}

function repaintSelection() {
  clearVisuals();
  if (!inEditMode() || !targetMesh || !topology) { updateUi(); return; }
  if (mode === "vertex") selectedVertices.forEach(renderVertex);
  else if (mode === "edge") selectedChains.forEach(renderChain);
  else selectedFaces.forEach(renderFace);
  updateUi();
}

function clearSelection() {
  selectedVertices.clear(); selectedChains.clear(); selectedFaces.clear();
  repaintSelection();
}

function projectWorld(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const projected = point.clone().project(editor.camera);
  return new THREE.Vector2(rect.left + (projected.x * .5 + .5) * rect.width, rect.top + (-projected.y * .5 + .5) * rect.height);
}

function segmentDistance(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a), lenSq = ab.lengthSq();
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
  return hit?.faceIndex == null ? null : topology.faceByTriangle.get(hit.faceIndex) ?? null;
}

function vertexAt(clientX: number, clientY: number) {
  if (!topology) return null;
  const cursor = new THREE.Vector2(clientX, clientY);
  let best: { id: string; screen: number; camera: number } | null = null;
  for (const id of topology.vertices.keys()) {
    const world = worldPointForVertex(id);
    if (!world) continue;
    const clip = world.clone().project(editor.camera);
    if (clip.z < -1 || clip.z > 1) continue;
    const screen = projectWorld(world).distanceTo(cursor);
    if (screen > 22) continue;
    const camera = world.distanceToSquared(editor.camera.position);
    if (!best || screen < best.screen - .5 || (Math.abs(screen - best.screen) <= .5 && camera < best.camera)) best = { id, screen, camera };
  }
  return best?.id ?? null;
}

function chainAt(clientX: number, clientY: number) {
  if (!topology) return null;
  const cursor = new THREE.Vector2(clientX, clientY);
  let best: { chain: string; screen: number; camera: number } | null = null;
  for (const edge of topology.edges.values()) {
    if (!edge.feature) continue;
    const a = worldPointForVertex(edge.a), b = worldPointForVertex(edge.b);
    if (!a || !b) continue;
    const screen = segmentDistance(cursor, projectWorld(a), projectWorld(b));
    if (screen > 18) continue;
    const center = a.clone().add(b).multiplyScalar(.5);
    const camera = center.distanceToSquared(editor.camera.position);
    const chain = topology.chainByEdge.get(edge.id);
    if (chain && (!best || screen < best.screen - .5 || (Math.abs(screen - best.screen) <= .5 && camera < best.camera))) best = { chain, screen, camera };
  }
  return best?.chain ?? null;
}

function componentAt(clientX: number, clientY: number) {
  return mode === "vertex" ? vertexAt(clientX, clientY) : mode === "edge" ? chainAt(clientX, clientY) : faceAt(clientX, clientY);
}

function lockTarget() {
  const active = editor.activeObject();
  targetMesh = active instanceof THREE.Mesh && Boolean(active.geometry?.getAttribute("position")) ? active : null;
  targetId = targetMesh ? getMeta(targetMesh)?.id ?? null : null;
  topology = targetMesh ? buildTopology(targetMesh) : null;
  clearSelection();
  updateUi();
}

function selectionCenterWorld() {
  const ids = selectedVertexIds();
  if (!ids.size) return null;
  const box = new THREE.Box3();
  for (const id of ids) {
    const point = worldPointForVertex(id);
    if (point) box.expandByPoint(point);
  }
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
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
  const a = projectWorld(origin), b = projectWorld(origin.clone().add(direction)), vector = b.sub(a), lenSq = vector.lengthSq();
  return lenSq < 1e-8 ? 0 : (dx * vector.x + dy * vector.y) / lenSq;
}

function rayToPlane(clientX: number, clientY: number, center: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, editor.camera);
  const normal = editor.camera.getWorldDirection(new THREE.Vector3());
  return ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), new THREE.Vector3());
}

function beginModal(kind: TransformKind) {
  if (!targetMesh || !currentSet().size) return false;
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
  const local = world.applyMatrix4(modal.meshWorldInverse);
  (targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute).setXYZ(index, local.x, local.y, local.z);
}

function updateModal(clientX: number, clientY: number, shift: boolean, alt: boolean) {
  if (!modal || !targetMesh) return;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const snap = editor.getSnap();
  const snapStep = snap.enabled ? snap.gridSize * (alt ? .1 : shift ? 10 : 1) : 0;
  let moveDelta = new THREE.Vector3(), angle = 0, ratio = 1;
  if (modal.kind === "move") {
    if (modal.axis) {
      let amount = pointerScalar(clientX - modal.startPointer.x, clientY - modal.startPointer.y, axisVector(modal.axis), modal.centerWorld);
      if (snapStep > 0) amount = Math.round(amount / snapStep) * snapStep;
      moveDelta.copy(axisVector(modal.axis)).multiplyScalar(amount);
    } else {
      const a = rayToPlane(modal.startPointer.x, modal.startPointer.y, modal.centerWorld), b = rayToPlane(clientX, clientY, modal.centerWorld);
      if (a && b) moveDelta.copy(b).sub(a);
    }
  } else if (modal.kind === "rotate") {
    const current = Math.atan2(clientY - modal.centerClient.y, clientX - modal.centerClient.x);
    angle = current - modal.startAngle;
    const step = shift ? 15 : alt ? .5 : 1;
    angle = THREE.MathUtils.degToRad(Math.round(THREE.MathUtils.radToDeg(angle) / step) * step);
  } else {
    ratio = Math.max(.01, new THREE.Vector2(clientX, clientY).distanceTo(modal.centerClient) / modal.startRadius);
    if (shift) ratio = Math.round(ratio * 10) / 10;
  }
  const rotation = new THREE.Quaternion().setFromAxisAngle(axisVector(modal.axis ?? "z"), angle);
  for (const index of modal.rawIndices) {
    const local = new THREE.Vector3(modal.positions[index * 3], modal.positions[index * 3 + 1], modal.positions[index * 3 + 2]);
    const world = local.applyMatrix4(modal.meshWorld);
    if (modal.kind === "move") world.add(moveDelta);
    else if (modal.kind === "rotate") world.sub(modal.centerWorld).applyQuaternion(rotation).add(modal.centerWorld);
    else {
      const relative = world.sub(modal.centerWorld);
      if (modal.axis) relative[modal.axis] *= ratio; else relative.multiplyScalar(ratio);
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
  if (modalBadge) modalBadge.textContent = `${modal.kind === "move" ? "MOVER" : modal.kind === "rotate" ? "ROTAR" : "ESCALAR"}${modal.axis ? ` · ${modal.axis.toUpperCase()}` : ""} · X/Y/Z restringe · click/Enter confirma · Esc cancela`;
}

function restoreModal() {
  if (!modal || !targetMesh) return;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (const index of modal.rawIndices) position.setXYZ(index, modal.positions[index * 3], modal.positions[index * 3 + 1], modal.positions[index * 3 + 2]);
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
  if (cancel) restoreModal(); else markDirectMesh();
  modal = null;
  modalBadge?.classList.add("hidden");
  rawEditor.emit?.("changed");
  // v0.7.8 recenters the pivot in its changed listener. Rebuild topology after
  // that compensation so logical ids/positions reflect the final geometry.
  queueMicrotask(() => {
    if (targetMesh?.parent) topology = buildTopology(targetMesh);
    repaintSelection();
  });
  setStatus(cancel ? "Transformación cancelada." : "Transformación aplicada a la entidad topológica completa.");
}

function setMode(next: ComponentMode, clickButton = true) {
  if (mode === next && !clickButton) return;
  mode = next;
  clearSelection();
  if (clickButton) {
    const button = editToolbar?.querySelector<HTMLButtonElement>(`[data-edit-select="${next}"]`);
    if (button && !button.classList.contains("active")) button.click();
  }
  updateUi();
}

window.__tmV079PointerDownOverride = (event) => {
  if (!inEditMode() || event.button !== 0 || event.target !== canvas) return false;
  if (modal) { finishModal(false); return true; }
  if (!targetMesh?.parent || !topology) lockTarget();
  if (!targetMesh || !topology) return true;
  const id = componentAt(event.clientX, event.clientY);
  const set = currentSet();
  if (!id) {
    if (!event.shiftKey) set.clear();
  } else if (event.shiftKey) {
    if (set.has(id)) set.delete(id); else set.add(id);
  } else {
    set.clear(); set.add(id);
  }
  repaintSelection();
  const count = set.size;
  const noun = mode === "vertex" ? "vértice" : mode === "edge" ? "arista lógica" : "cara lógica";
  setStatus(`${count} ${noun}${count === 1 ? "" : "s"} seleccionado${count === 1 ? "" : "s"}. Shift suma/quita · M/G mueve · R rota · S escala.`);
  return true;
};

window.__tmV079KeydownOverride = (event) => {
  if (!inEditMode()) return false;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return false;
  const key = event.key.toLowerCase();
  if (event.key === "1" || event.key === "2" || event.key === "3") {
    setMode(event.key === "1" ? "vertex" : event.key === "2" ? "edge" : "face");
    return true;
  }
  if (modal) {
    if (key === "x" || key === "y" || key === "z") {
      modal.axis = modal.axis === key ? null : key;
      updateModal(lastPointer.x, lastPointer.y, event.shiftKey, event.altKey);
      return true;
    }
    if (event.key === "Escape") { finishModal(true); return true; }
    if (event.key === "Enter") { finishModal(false); return true; }
    if (key === "m" || key === "g" || key === "r" || key === "s") return true;
  }
  if (key === "a") {
    currentSet().clear();
    if (event.altKey) { repaintSelection(); return true; }
    if (topology) {
      if (mode === "vertex") topology.vertices.forEach((_, id) => selectedVertices.add(id));
      else if (mode === "edge") topology.chains.forEach((_, id) => selectedChains.add(id));
      else topology.faces.forEach((_, id) => selectedFaces.add(id));
    }
    repaintSelection();
    return true;
  }
  if (key === "m" || key === "g" || key === "r" || key === "s") {
    if (currentSet().size) beginModal(key === "r" ? "rotate" : key === "s" ? "scale" : "move");
    return true; // Never fall through to Object Mode transforms while editing.
  }
  return false;
};

window.addEventListener("pointermove", (event) => {
  lastPointer.set(event.clientX, event.clientY);
  if (modal) updateModal(event.clientX, event.clientY, event.shiftKey, event.altKey);
}, true);

editToolbar?.querySelectorAll<HTMLButtonElement>("[data-edit-select]").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.editSelect;
    const next: ComponentMode = value === "edge" || value === "face" ? value : "vertex";
    if (mode !== next) setMode(next, false);
  });
});
editToolbar?.querySelectorAll<HTMLButtonElement>("[data-edit-transform]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!currentSet().size || modal) return;
    const value = button.dataset.editTransform;
    beginModal(value === "rotate" ? "rotate" : value === "scale" ? "scale" : "move");
  });
});

let lastEditMode = inEditMode();
if (lastEditMode) lockTarget();
const modeObserver = new MutationObserver(() => {
  const now = inEditMode();
  if (now !== lastEditMode) {
    lastEditMode = now;
    if (now) {
      const active = editToolbar?.querySelector<HTMLElement>("[data-edit-select].active")?.dataset.editSelect;
      mode = active === "edge" || active === "face" ? active : "vertex";
      lockTarget();
      setStatus("EDIT MODE · caras = islas coplanares · aristas = cadenas colineales · vértices coincidentes se editan juntos.");
    } else {
      modal = null;
      targetMesh = null; targetId = null; topology = null;
      selectedVertices.clear(); selectedChains.clear(); selectedFaces.clear();
      clearVisuals();
    }
  }
  applyVersion();
});
modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

editor.on("changed", () => {
  if (!inEditMode() || modal) return;
  if (targetId && !targetMesh?.parent) {
    const replacement = editor.findById(targetId);
    targetMesh = replacement instanceof THREE.Mesh ? replacement : null;
  }
  if (targetMesh?.parent) topology = buildTopology(targetMesh);
  repaintSelection();
});

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  editTopologyVersion: "0.7.9",
  getEditSelection: () => ({ mode, ids: [...currentSet()] }),
  clearEditSelection: () => clearSelection(),
  rebuildEditTopology: () => {
    if (targetMesh?.parent) topology = buildTopology(targetMesh);
    repaintSelection();
    return topology ? { vertices: topology.vertices.size, edges: topology.chains.size, faces: topology.faces.size } : null;
  },
});

setStatus("TinkerMatt v0.7.9 · caras coplanares conectadas + aristas colineales completas + weld robusto de vértices CSG.");
