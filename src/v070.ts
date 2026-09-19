import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import "./v070.css";
import { getMeta, makeId, setMeta, type ReferenceKind, type SemanticReference } from "./model";
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
type EditTransformMode = "translate" | "rotate" | "scale";
type EditVertex = { id: string; point: THREE.Vector3; indices: number[] };
type EditTriangle = {
  index: number;
  raw: [number, number, number];
  vertices: [string, string, string];
  edges: [string, string, string];
  normal: THREE.Vector3;
  plane: number;
};
type EditEdge = { id: string; a: string; b: string; triangles: number[]; feature: boolean };
type EditFace = { id: string; triangles: number[]; vertices: Set<string> };
type EditTopology = {
  vertices: Map<string, EditVertex>;
  rawToVertex: Map<number, string>;
  triangles: EditTriangle[];
  edges: Map<string, EditEdge>;
  faces: Map<string, EditFace>;
  faceByTriangle: Map<number, string>;
  epsilon: number;
  planeTolerance: number;
};
type HoverEntity = { mode: "vertex"; id: string } | { mode: "edge"; id: string } | { mode: "face"; id: string };
type TransformBaseline = {
  positions: Float32Array;
  selectedIndices: Set<number>;
  meshWorld: THREE.Matrix4;
  meshWorldInverse: THREE.Matrix4;
  pivotWorld: THREE.Matrix4;
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.7.0 no pudo acceder al editor.");
const rawEditor = editor as any;
const toolbar = document.querySelector<HTMLElement>(".toolbar-shell")!;
const workspace = document.querySelector<HTMLElement>(".workspace")!;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const library = document.querySelector<HTMLElement>(".library-panel");
const inspector = document.querySelector<HTMLElement>("#inspector");
const outliner = document.querySelector<HTMLElement>("#outliner-tree");
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.7.0";
const setStatus = (text: string) => { if (status) status.textContent = text; };

// -----------------------------------------------------------------------------
// Object / Edit mode shell
// -----------------------------------------------------------------------------
const modeSwitch = document.createElement("div");
modeSwitch.className = "tm-mode-switch";
modeSwitch.innerHTML = `<button type="button" data-tm-mode="object" class="active" title="Modo Objeto · Tab">Objeto</button><button type="button" data-tm-mode="edit" title="Modo Edición · Tab">Edición</button>`;
const designName = toolbar.querySelector<HTMLElement>(".design-name");
if (designName) designName.insertAdjacentElement("afterend", modeSwitch); else toolbar.prepend(modeSwitch);
const objectModeButton = modeSwitch.querySelector<HTMLButtonElement>("[data-tm-mode=object]")!;
const editModeButton = modeSwitch.querySelector<HTMLButtonElement>("[data-tm-mode=edit]")!;

const editToolbar = document.createElement("div");
editToolbar.className = "tm-edit-toolbar";
editToolbar.innerHTML = `
  <div class="tm-edit-toolbar-group" title="Tipo de selección · 1/2/3">
    <button type="button" class="tm-edit-icon active" data-edit-select="vertex" title="Vértices · 1"><span class="tm-edit-component-dot">●</span></button>
    <button type="button" class="tm-edit-icon" data-edit-select="edge" title="Aristas · 2"><span class="tm-edit-component-edge">―</span></button>
    <button type="button" class="tm-edit-icon" data-edit-select="face" title="Caras · 3"><span class="tm-edit-component-face">▰</span></button>
  </div>
  <div class="tm-edit-toolbar-group">
    <button type="button" class="tm-edit-icon active" data-edit-transform="translate" title="Mover selección · G"><span class="tm-edit-glyph">G</span></button>
    <button type="button" class="tm-edit-icon" data-edit-transform="rotate" title="Rotar selección · R"><span class="tm-edit-glyph">R</span></button>
    <button type="button" class="tm-edit-icon" data-edit-transform="scale" title="Escalar selección · S"><span class="tm-edit-glyph">S</span></button>
  </div>
  <div class="tm-edit-toolbar-group">
    <button type="button" class="tm-edit-icon" data-edit-bevel title="Bevel de aristas/vértices seleccionados"><span class="tm-edit-glyph">BV</span></button>
  </div>`;
modeSwitch.insertAdjacentElement("afterend", editToolbar);

// Everything that already existed in the toolbar is Object Mode UI. Keep logo,
// design name, mode toggle, edit toolbar and settings visible in both modes.
for (const child of [...toolbar.children] as HTMLElement[]) {
  if (child === modeSwitch || child === editToolbar || child.matches(".logo-wrap,.design-name,.tm-settings-button")) continue;
  child.classList.add("tm-object-toolbar-node");
}

// Old bevel/semantic controls are deliberately retired from Object Mode.
const oldBevelTool = document.querySelector<HTMLButtonElement>(".tm-bevel-tool");
if (oldBevelTool?.classList.contains("active")) oldBevelTool.click();
document.querySelector<HTMLElement>(".tm-bevel-pick-layer")?.classList.remove("active");
document.querySelector<HTMLElement>("#refs-details")?.setAttribute("aria-hidden", "true");

const editSide = document.createElement("aside");
editSide.className = "tm-edit-side-panel";
editSide.innerHTML = `
  <div class="panel-heading"><span>Edición</span><span class="panel-subtle">malla</span></div>
  <div class="tm-edit-target"><strong data-edit-target>Sin objeto</strong><span data-edit-topology>Seleccioná una malla</span></div>
  <div class="tm-edit-section">
    <div class="tm-edit-section-title">Selección</div>
    <div class="tm-edit-selection-summary"><span data-edit-mode-label>Vértices</span><b data-edit-count>0 seleccionados</b></div>
    <div class="tm-edit-small-actions"><button type="button" data-edit-all>Todo</button><button type="button" data-edit-none>Nada</button></div>
  </div>
  <div class="tm-edit-bevel-box" data-edit-bevel-box>
    <div class="tm-edit-section-title">Bevel</div>
    <label><span>Profundidad</span><input data-edit-bevel-depth-range type="range" min="0.1" max="10" step="0.1" value="1"><input data-edit-bevel-depth type="number" min="0.01" step="0.1" value="1"></label>
    <label><span>Pasos</span><input data-edit-bevel-steps-range type="range" min="1" max="8" step="1" value="1"><input data-edit-bevel-steps type="number" min="1" max="8" step="1" value="1"></label>
    <div class="tm-edit-bevel-note" data-edit-bevel-note>Seleccioná aristas o vértices.</div>
    <div class="tm-edit-bevel-actions"><button type="button" data-edit-bevel-cancel>Cancelar</button><button type="button" class="primary" data-edit-bevel-apply>Aplicar</button></div>
  </div>
  <div class="tm-edit-section">
    <div class="tm-edit-section-title">Semánticos</div>
    <div class="tm-edit-semantic-form"><input data-edit-semantic-name placeholder="Ej. BORDE_TAPA"><button type="button" class="tm-edit-semantic-save" data-edit-semantic-save title="Guardar selección">＋</button></div>
    <div class="tm-edit-semantic-list" data-edit-semantic-list></div>
  </div>`;
workspace.insertBefore(editSide, viewport);

const editTargetLabel = editSide.querySelector<HTMLElement>("[data-edit-target]")!;
const editTopologyLabel = editSide.querySelector<HTMLElement>("[data-edit-topology]")!;
const editModeLabel = editSide.querySelector<HTMLElement>("[data-edit-mode-label]")!;
const editCountLabel = editSide.querySelector<HTMLElement>("[data-edit-count]")!;
const semanticName = editSide.querySelector<HTMLInputElement>("[data-edit-semantic-name]")!;
const semanticList = editSide.querySelector<HTMLElement>("[data-edit-semantic-list]")!;
const bevelBox = editSide.querySelector<HTMLElement>("[data-edit-bevel-box]")!;
const bevelDepthRange = editSide.querySelector<HTMLInputElement>("[data-edit-bevel-depth-range]")!;
const bevelDepthNumber = editSide.querySelector<HTMLInputElement>("[data-edit-bevel-depth]")!;
const bevelStepsRange = editSide.querySelector<HTMLInputElement>("[data-edit-bevel-steps-range]")!;
const bevelStepsNumber = editSide.querySelector<HTMLInputElement>("[data-edit-bevel-steps]")!;
const bevelNote = editSide.querySelector<HTMLElement>("[data-edit-bevel-note]")!;

let editMode = false;
let targetMesh: THREE.Mesh | null = null;
let targetId: string | null = null;
let topology: EditTopology | null = null;
let componentMode: ComponentMode = "vertex";
let transformMode: EditTransformMode = "translate";
let hovered: HoverEntity | null = null;
const selectedVertices = new Set<string>();
const selectedEdges = new Set<string>();
const selectedFaces = new Set<string>();
let bevelOpen = false;

// -----------------------------------------------------------------------------
// Topology
// -----------------------------------------------------------------------------
function rawIndex(geometry: THREE.BufferGeometry, triangle: number, corner: number) {
  const item = triangle * 3 + corner;
  return geometry.index ? geometry.index.getX(item) : item;
}
function buildTopology(mesh: THREE.Mesh): EditTopology {
  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const diagonal = geometry.boundingBox?.getSize(new THREE.Vector3()).length() || 1;
  const epsilon = Math.max(1e-7, diagonal * 1e-6);
  const planeTolerance = Math.max(1e-6, diagonal * 2e-6);
  const pointKey = (index: number) => {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    return `${Math.round(x / epsilon)},${Math.round(y / epsilon)},${Math.round(z / epsilon)}`;
  };
  const groups = new Map<string, number[]>();
  for (let i = 0; i < position.count; i += 1) {
    const key = pointKey(i); const list = groups.get(key) ?? []; list.push(i); groups.set(key, list);
  }
  const vertices = new Map<string, EditVertex>();
  const rawToVertex = new Map<number, string>();
  for (const indices of groups.values()) {
    indices.sort((a, b) => a - b);
    const id = `v:${indices.join(".")}`;
    const first = indices[0];
    const point = new THREE.Vector3(position.getX(first), position.getY(first), position.getZ(first));
    vertices.set(id, { id, point, indices });
    indices.forEach((index) => rawToVertex.set(index, id));
  }
  const pair = (a: string, b: string) => a < b ? `e:${a}|${b}` : `e:${b}|${a}`;
  const triangles: EditTriangle[] = [];
  const edges = new Map<string, EditEdge>();
  const triangleCount = geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(position.count / 3);
  for (let tri = 0; tri < triangleCount; tri += 1) {
    const raw = [rawIndex(geometry, tri, 0), rawIndex(geometry, tri, 1), rawIndex(geometry, tri, 2)] as [number, number, number];
    const ids = raw.map((index) => rawToVertex.get(index)!) as [string, string, string];
    const points = ids.map((id) => vertices.get(id)!.point) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const normal = new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0])).normalize();
    const edgeIds = [pair(ids[0], ids[1]), pair(ids[1], ids[2]), pair(ids[2], ids[0])] as [string, string, string];
    triangles.push({ index: tri, raw, vertices: ids, edges: edgeIds, normal, plane: normal.dot(points[0]) });
    for (let i = 0; i < 3; i += 1) {
      const a = ids[i]; const b = ids[(i + 1) % 3]; const id = edgeIds[i];
      const edge = edges.get(id) ?? { id, a: a < b ? a : b, b: a < b ? b : a, triangles: [], feature: true };
      edge.triangles.push(tri); edges.set(id, edge);
    }
  }
  const coplanar = (a: EditTriangle, b: EditTriangle) => {
    const dot = a.normal.dot(b.normal);
    if (Math.abs(dot) < 0.999995) return false;
    return dot >= 0 ? Math.abs(a.plane - b.plane) <= planeTolerance : Math.abs(a.plane + b.plane) <= planeTolerance;
  };
  for (const edge of edges.values()) {
    if (edge.triangles.length === 2) edge.feature = !coplanar(triangles[edge.triangles[0]], triangles[edge.triangles[1]]);
    else edge.feature = true;
  }
  const faces = new Map<string, EditFace>();
  const faceByTriangle = new Map<number, string>();
  const visited = new Set<number>();
  for (let start = 0; start < triangles.length; start += 1) {
    if (visited.has(start)) continue;
    const seed = triangles[start];
    const queue = [start];
    const members: number[] = [];
    const vertexIds = new Set<string>();
    while (queue.length) {
      const triIndex = queue.pop()!;
      if (visited.has(triIndex)) continue;
      const tri = triangles[triIndex];
      if (!tri || !coplanar(seed, tri)) continue;
      visited.add(triIndex); members.push(triIndex); tri.vertices.forEach((id) => vertexIds.add(id));
      for (const edgeId of tri.edges) for (const neighbor of edges.get(edgeId)?.triangles ?? []) if (!visited.has(neighbor)) queue.push(neighbor);
    }
    members.sort((a, b) => a - b);
    const id = `f:${members.join(".")}`;
    const face = { id, triangles: members, vertices: vertexIds };
    faces.set(id, face); members.forEach((tri) => faceByTriangle.set(tri, id));
  }
  return { vertices, rawToVertex, triangles, edges, faces, faceByTriangle, epsilon, planeTolerance };
}

function currentSet() {
  return componentMode === "vertex" ? selectedVertices : componentMode === "edge" ? selectedEdges : selectedFaces;
}
function clearComponentSelection() {
  selectedVertices.clear(); selectedEdges.clear(); selectedFaces.clear(); hovered = null;
  refreshHighlights(); updateEditInfo(); updateEditPivot();
}
function selectedVertexIds() {
  const ids = new Set<string>();
  if (!topology) return ids;
  if (componentMode === "vertex") selectedVertices.forEach((id) => ids.add(id));
  else if (componentMode === "edge") selectedEdges.forEach((id) => {
    const edge = topology!.edges.get(id); if (edge) { ids.add(edge.a); ids.add(edge.b); }
  });
  else selectedFaces.forEach((id) => topology!.faces.get(id)?.vertices.forEach((vertex) => ids.add(vertex)));
  return ids;
}
function selectedRawIndices() {
  const indices = new Set<number>();
  if (!topology) return indices;
  for (const id of selectedVertexIds()) topology.vertices.get(id)?.indices.forEach((index) => indices.add(index));
  return indices;
}

// -----------------------------------------------------------------------------
// Component hit testing / overlays
// -----------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
function projectClient(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const p = point.clone().project(editor.camera);
  return new THREE.Vector2(rect.left + (p.x * .5 + .5) * rect.width, rect.top + (-p.y * .5 + .5) * rect.height);
}
function segmentDistance(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a); const len = ab.lengthSq(); if (len < 1e-8) return p.distanceTo(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len, 0, 1); return p.distanceTo(a.add(ab.multiplyScalar(t)));
}
function hitTriangle(clientX: number, clientY: number) {
  if (!targetMesh) return null;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, editor.camera);
  return raycaster.intersectObject(targetMesh, false)[0] ?? null;
}
function componentAt(clientX: number, clientY: number): HoverEntity | null {
  const hit = hitTriangle(clientX, clientY);
  if (!hit || hit.faceIndex == null || !topology || !targetMesh) return null;
  const tri = topology.triangles[hit.faceIndex]; if (!tri) return null;
  if (componentMode === "face") {
    const id = topology.faceByTriangle.get(hit.faceIndex); return id ? { mode: "face", id } : null;
  }
  targetMesh.updateMatrixWorld(true);
  const cursor = new THREE.Vector2(clientX, clientY);
  if (componentMode === "vertex") {
    let best: { id: string; d: number } | null = null;
    for (const id of tri.vertices) {
      const vertex = topology.vertices.get(id)!;
      const d = projectClient(vertex.point.clone().applyMatrix4(targetMesh.matrixWorld)).distanceTo(cursor);
      if (!best || d < best.d) best = { id, d };
    }
    return best && best.d <= 18 ? { mode: "vertex", id: best.id } : null;
  }
  let best: { id: string; d: number } | null = null;
  for (const id of tri.edges) {
    const edge = topology.edges.get(id); if (!edge?.feature) continue;
    const a = topology.vertices.get(edge.a)!.point.clone().applyMatrix4(targetMesh.matrixWorld);
    const b = topology.vertices.get(edge.b)!.point.clone().applyMatrix4(targetMesh.matrixWorld);
    const d = segmentDistance(cursor, projectClient(a), projectClient(b));
    if (!best || d < best.d) best = { id, d };
  }
  return best && best.d <= 22 ? { mode: "edge", id: best.id } : null;
}

const hoverGroup = new THREE.Group(); hoverGroup.name = "__tm_edit_hover";
const selectionGroup = new THREE.Group(); selectionGroup.name = "__tm_edit_selection";
editor.scene.add(hoverGroup, selectionGroup);
function clearVisualGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    child.removeFromParent();
    const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; geometry?.dispose?.();
    const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material) (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
  }
}
function renderEntity(entity: HoverEntity, group: THREE.Group, color: number, opacity = .9) {
  if (!targetMesh || !topology) return;
  targetMesh.updateMatrixWorld(true);
  if (entity.mode === "vertex") {
    const vertex = topology.vertices.get(entity.id); if (!vertex) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([vertex.point.clone().applyMatrix4(targetMesh.matrixWorld)]);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 12, sizeAttenuation: false, depthTest: false, transparent: true, opacity }));
    points.renderOrder = 4100; group.add(points); return;
  }
  if (entity.mode === "edge") {
    const edge = topology.edges.get(entity.id); if (!edge) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      topology.vertices.get(edge.a)!.point.clone().applyMatrix4(targetMesh.matrixWorld),
      topology.vertices.get(edge.b)!.point.clone().applyMatrix4(targetMesh.matrixWorld),
    ]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity }));
    line.renderOrder = 4099; group.add(line); return;
  }
  const face = topology.faces.get(entity.id); if (!face) return;
  const values: number[] = [];
  for (const triIndex of face.triangles) {
    const tri = topology.triangles[triIndex]; if (!tri) continue;
    for (const id of tri.vertices) {
      const p = topology.vertices.get(id)!.point.clone().applyMatrix4(targetMesh.matrixWorld); values.push(p.x, p.y, p.z);
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Math.min(opacity, .34), side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  mesh.renderOrder = 4098; group.add(mesh);
}
function refreshHighlights() {
  clearVisualGroup(hoverGroup); clearVisualGroup(selectionGroup);
  if (!editMode || !topology) return;
  if (hovered && !currentSet().has(hovered.id)) renderEntity(hovered, hoverGroup, 0xffa000, .95);
  if (componentMode === "vertex") selectedVertices.forEach((id) => renderEntity({ mode: "vertex", id }, selectionGroup, 0x00b5ee, 1));
  else if (componentMode === "edge") selectedEdges.forEach((id) => renderEntity({ mode: "edge", id }, selectionGroup, 0x00b5ee, 1));
  else selectedFaces.forEach((id) => renderEntity({ mode: "face", id }, selectionGroup, 0x00b5ee, .32));
}

// -----------------------------------------------------------------------------
// Edit TransformControls: transforms selected mesh vertices, never the object.
// -----------------------------------------------------------------------------
const editPivot = new THREE.Object3D(); editPivot.name = "__tm_edit_pivot"; editor.scene.add(editPivot);
const editTransform = new TransformControls(editor.camera, canvas);
editTransform.setMode("translate"); editTransform.setSpace("world"); (editTransform as any).setSize?.(.78);
const editTransformHelper = editTransform.getHelper(); editTransformHelper.visible = false; editor.scene.add(editTransformHelper);
let transformBaseline: TransformBaseline | null = null;
let resettingPivot = false;

function selectionWorldCenter() {
  if (!targetMesh || !topology) return null;
  const ids = selectedVertexIds(); if (!ids.size) return null;
  targetMesh.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const id of ids) {
    const vertex = topology.vertices.get(id); if (vertex) box.expandByPoint(vertex.point.clone().applyMatrix4(targetMesh.matrixWorld));
  }
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}
function updateEditPivot() {
  if (!editMode || !targetMesh || !currentSet().size) {
    editTransform.detach(); editTransformHelper.visible = false; return;
  }
  const center = selectionWorldCenter(); if (!center) { editTransform.detach(); editTransformHelper.visible = false; return; }
  resettingPivot = true;
  editPivot.position.copy(center); editPivot.quaternion.identity(); editPivot.scale.set(1, 1, 1); editPivot.updateMatrixWorld(true);
  editTransform.attach(editPivot); editTransform.setMode(transformMode); editTransform.setSpace("world"); editTransformHelper.visible = true;
  resettingPivot = false;
}
function setEditTransformMode(mode: EditTransformMode) {
  transformMode = mode; editTransform.setMode(mode);
  editToolbar.querySelectorAll<HTMLElement>("[data-edit-transform]").forEach((button) => button.classList.toggle("active", button.dataset.editTransform === mode));
  updateEditPivot();
  setStatus(`${mode === "translate" ? "Mover" : mode === "rotate" ? "Rotar" : "Escalar"} componentes seleccionados.`);
}
function snapshotPositions(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  return new Float32Array(position.array as ArrayLike<number>);
}
function applyTransformDelta() {
  if (!transformBaseline || !targetMesh || resettingPivot) return;
  const position = targetMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  editPivot.updateMatrixWorld(true);
  const delta = editPivot.matrixWorld.clone().multiply(transformBaseline.pivotWorld.clone().invert());
  const local = new THREE.Vector3(); const world = new THREE.Vector3();
  for (const index of transformBaseline.selectedIndices) {
    local.set(transformBaseline.positions[index * 3], transformBaseline.positions[index * 3 + 1], transformBaseline.positions[index * 3 + 2]);
    world.copy(local).applyMatrix4(transformBaseline.meshWorld).applyMatrix4(delta);
    local.copy(world).applyMatrix4(transformBaseline.meshWorldInverse);
    position.setXYZ(index, local.x, local.y, local.z);
  }
  position.needsUpdate = true;
  targetMesh.geometry.computeVertexNormals(); targetMesh.geometry.computeBoundingBox(); targetMesh.geometry.computeBoundingSphere();
  topology = buildTopology(targetMesh);
  refreshHighlights(); updateEditInfo();
}
function markDirectMesh() {
  if (!targetMesh) return;
  const meta = getMeta(targetMesh); if (!meta) return;
  if ((meta as any).kind !== "mesh") {
    meta.params = { ...(meta.params ?? {}), sourceKind: String(meta.kind), directMeshEdit: true };
    (meta as any).kind = "mesh";
    setMeta(targetMesh, meta);
  }
}
editTransform.addEventListener("dragging-changed", (event: any) => { editor.orbit.enabled = !event.value; });
editTransform.addEventListener("mouseDown", () => {
  if (!targetMesh || !currentSet().size) return;
  editor.checkpoint(); targetMesh.updateMatrixWorld(true); editPivot.updateMatrixWorld(true);
  transformBaseline = {
    positions: snapshotPositions(targetMesh),
    selectedIndices: selectedRawIndices(),
    meshWorld: targetMesh.matrixWorld.clone(),
    meshWorldInverse: targetMesh.matrixWorld.clone().invert(),
    pivotWorld: editPivot.matrixWorld.clone(),
  };
});
editTransform.addEventListener("objectChange", applyTransformDelta);
editTransform.addEventListener("mouseUp", () => {
  if (!transformBaseline || !targetMesh) return;
  transformBaseline = null; markDirectMesh(); topology = buildTopology(targetMesh); refreshHighlights(); updateEditPivot(); updateEditInfo(); renderSemanticList();
  rawEditor.emit?.("changed"); rawEditor.emit?.("selection", editor.getSelection());
});

// -----------------------------------------------------------------------------
// Bevel v2. For two adjacent directions (the common selected-edge case), steps
// trace the TRUE circular fillet between the two tangent points. Step 1 is a
// straight chamfer; higher steps progressively round toward the original edge.
// -----------------------------------------------------------------------------
function pairId(a: string, b: string) { return a < b ? `e:${a}|${b}` : `e:${b}|${a}`; }
function slerpDirection(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1); const angle = Math.acos(dot);
  if (angle < 1e-5) return a.clone().lerp(b, t).normalize();
  const sin = Math.sin(angle);
  return a.clone().multiplyScalar(Math.sin((1 - t) * angle) / sin).addScaledVector(b, Math.sin(t * angle) / sin).normalize();
}
function roundedPair(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, depth: number, steps: number) {
  const d1 = a.clone().normalize(), d2 = b.clone().normalize();
  if (steps <= 1) return [point.clone().addScaledVector(d1, depth), point.clone().addScaledVector(d2, depth)];
  const center = point.clone().addScaledVector(d1, depth).addScaledVector(d2, depth);
  const start = d2.clone().negate(), end = d1.clone().negate();
  const result: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i += 1) result.push(center.clone().addScaledVector(slerpDirection(start, end, i / steps), depth));
  return result;
}
function bevelGeometryV2(mesh: THREE.Mesh, depth: number, steps: number) {
  const topo = buildTopology(mesh);
  const selectedEdgeIds = new Set(selectedEdges);
  const selectedVertexIdsSet = new Set(selectedVertices);
  const neighbors = new Map<string, Set<string>>();
  const addNeighbor = (a: string, b: string) => { const list = neighbors.get(a) ?? new Set<string>(); list.add(b); neighbors.set(a, list); };
  for (const edge of topo.edges.values()) if (edge.feature) { addNeighbor(edge.a, edge.b); addNeighbor(edge.b, edge.a); }
  const output: THREE.Vector3[] = [];
  for (const vertex of topo.vertices.values()) {
    const around = [...(neighbors.get(vertex.id) ?? [])];
    const selectedAlong = around.filter((neighbor) => selectedEdgeIds.has(pairId(vertex.id, neighbor)));
    const affected = selectedVertexIdsSet.has(vertex.id) || selectedAlong.length > 0;
    if (!affected) { output.push(vertex.point.clone()); continue; }
    let dirsIds = selectedVertexIdsSet.has(vertex.id) ? around : around.filter((neighbor) => !selectedAlong.includes(neighbor));
    if (dirsIds.length < 2) dirsIds = around;
    const distances = dirsIds.map((id) => vertex.point.distanceTo(topo.vertices.get(id)!.point)).filter((value) => value > 1e-6);
    const localDepth = Math.min(depth, (Math.min(...distances) || depth) * .45);
    const dirs = dirsIds.map((id) => topo.vertices.get(id)!.point.clone().sub(vertex.point).normalize());
    if (dirs.length === 2) {
      output.push(...roundedPair(vertex.point, dirs[0], dirs[1], localDepth, steps));
    } else if (dirs.length > 2) {
      // Vertex bevel: sample rounded arcs between every neighboring direction.
      for (let i = 0; i < dirs.length; i += 1) output.push(...roundedPair(vertex.point, dirs[i], dirs[(i + 1) % dirs.length], localDepth, steps));
    } else output.push(vertex.point.clone());
  }
  const unique = new Map<string, THREE.Vector3>();
  output.forEach((point) => unique.set(`${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`, point));
  if (unique.size < 4) throw new Error("No hay geometría suficiente para aplicar bevel.");
  const geometry = new ConvexGeometry([...unique.values()]);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
const bevelPreview = new THREE.Group(); bevelPreview.name = "__tm_edit_bevel_preview"; editor.scene.add(bevelPreview);
let previewOriginalVisible = true;
function clearBevelPreview() {
  if (targetMesh) targetMesh.visible = previewOriginalVisible;
  clearVisualGroup(bevelPreview);
}
function bevelDepth() { return Math.max(.01, Number(bevelDepthNumber.value) || 1); }
function bevelSteps() { return Math.max(1, Math.min(8, Math.round(Number(bevelStepsNumber.value) || 1))); }
function updateBevelPreview() {
  clearBevelPreview();
  if (!bevelOpen || !targetMesh || (componentMode !== "edge" && componentMode !== "vertex") || !currentSet().size) return;
  try {
    const geometry = bevelGeometryV2(targetMesh, bevelDepth(), bevelSteps());
    const preview = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x55bfe7, roughness: .42, metalness: .03, transparent: true, opacity: .76, depthWrite: false }));
    targetMesh.updateMatrixWorld(true); preview.matrix.copy(targetMesh.matrixWorld); preview.matrixAutoUpdate = false; preview.renderOrder = 3900;
    previewOriginalVisible = targetMesh.visible; targetMesh.visible = false; bevelPreview.add(preview);
    bevelNote.textContent = bevelSteps() === 1 ? "1 paso = chaflán recto." : `${bevelSteps()} pasos = redondeo progresivo.`;
  } catch (error) { bevelNote.textContent = error instanceof Error ? error.message : String(error); }
}
function setBevelOpen(open: boolean) {
  bevelOpen = open; bevelBox.classList.toggle("active", open);
  editToolbar.querySelector<HTMLElement>("[data-edit-bevel]")?.classList.toggle("active", open);
  if (open) {
    if (componentMode === "face") { bevelNote.textContent = "Bevel trabaja sobre aristas o vértices. Cambiá el tipo de selección."; return; }
    if (!currentSet().size) { bevelNote.textContent = "Seleccioná al menos una arista o vértice."; return; }
    if (targetMesh) {
      const size = new THREE.Box3().setFromObject(targetMesh, true).getSize(new THREE.Vector3());
      const max = Math.max(.1, Math.min(size.x, size.y, size.z) * .45); bevelDepthRange.max = String(max); bevelDepthNumber.max = String(max);
    }
    updateBevelPreview();
  } else clearBevelPreview();
}
function syncBevelDepth(source: HTMLInputElement) { const value = Math.max(.01, Number(source.value) || 1); bevelDepthNumber.value = String(value); bevelDepthRange.value = String(value); updateBevelPreview(); }
function syncBevelSteps(source: HTMLInputElement) { const value = Math.max(1, Math.min(8, Math.round(Number(source.value) || 1))); bevelStepsNumber.value = String(value); bevelStepsRange.value = String(value); updateBevelPreview(); }
bevelDepthRange.addEventListener("input", () => syncBevelDepth(bevelDepthRange));
bevelDepthNumber.addEventListener("input", () => syncBevelDepth(bevelDepthNumber));
bevelStepsRange.addEventListener("input", () => syncBevelSteps(bevelStepsRange));
bevelStepsNumber.addEventListener("input", () => syncBevelSteps(bevelStepsNumber));
editSide.querySelector<HTMLElement>("[data-edit-bevel-cancel]")!.addEventListener("click", () => setBevelOpen(false));
editSide.querySelector<HTMLElement>("[data-edit-bevel-apply]")!.addEventListener("click", () => {
  if (!targetMesh || (componentMode !== "edge" && componentMode !== "vertex") || !currentSet().size) return;
  try {
    const geometry = bevelGeometryV2(targetMesh, bevelDepth(), bevelSteps());
    editor.checkpoint(); clearBevelPreview();
    const old = targetMesh.geometry; targetMesh.geometry = geometry; old.dispose(); markDirectMesh();
    topology = buildTopology(targetMesh); clearComponentSelection(); setBevelOpen(false);
    rawEditor.emit?.("changed"); rawEditor.emit?.("selection", editor.getSelection());
    setStatus(`Bevel aplicado · ${bevelDepth().toFixed(2)} mm · ${bevelSteps()} paso(s).`);
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
});

// -----------------------------------------------------------------------------
// Semantic selections live in Edit Mode. Save current components; clicking a
// semantic later reselects the corresponding mesh components.
// -----------------------------------------------------------------------------
function semanticKindLabel(kind: ReferenceKind) { return kind === "vertex" ? "V" : kind === "edge" ? "E" : kind === "face" ? "F" : "S"; }
function semanticRefs() { return (targetMesh ? getMeta(targetMesh)?.references ?? [] : []).filter((ref) => ref.kind === "vertex" || ref.kind === "edge" || ref.kind === "face"); }
function renderSemanticList() {
  semanticList.replaceChildren();
  const refs = semanticRefs();
  if (!refs.length) { const empty = document.createElement("div"); empty.className = "tm-edit-semantic-empty"; empty.textContent = "Todavía no hay selecciones guardadas."; semanticList.append(empty); return; }
  for (const ref of refs) {
    const button = document.createElement("button"); button.type = "button"; button.className = "tm-edit-semantic-item"; button.dataset.refId = ref.id;
    const count = ref.kind === "face" ? ref.selection?.faces?.reduce((sum, item) => sum + item.triangles.length, 0) ?? 0 : ref.kind === "edge" ? ref.selection?.edges?.length ?? 0 : ref.selection?.vertices?.length ?? 0;
    button.innerHTML = `<span class="tm-edit-semantic-kind">${semanticKindLabel(ref.kind)}</span><span><strong>${ref.name}</strong><small>${ref.kind} · ${count}</small></span>`;
    button.addEventListener("click", () => reselectSemantic(ref)); semanticList.append(button);
  }
}
function nextSemanticName(kind: ReferenceKind) {
  const typed = semanticName.value.trim(); if (typed) return typed;
  const base = kind === "vertex" ? "VERTICES" : kind === "edge" ? "ARISTAS" : "CARA";
  return `${base}_${semanticRefs().filter((ref) => ref.kind === kind).length + 1}`;
}
function saveSemanticSelection() {
  if (!targetMesh || !topology || !currentSet().size) { setStatus("Seleccioná componentes antes de guardar un semántico."); return; }
  const meta = getMeta(targetMesh); if (!meta) return;
  const kind = componentMode as ReferenceKind;
  const reference: SemanticReference = { id: makeId("ref"), kind, name: nextSemanticName(kind), selection: {} };
  if (componentMode === "face") {
    reference.selection!.faces = [...selectedFaces].map((id) => ({ meshPath: [], triangles: [...(topology!.faces.get(id)?.triangles ?? [])] }));
  } else if (componentMode === "edge") {
    reference.selection!.edges = [...selectedEdges].map((id) => topology!.edges.get(id)).filter((edge): edge is EditEdge => Boolean(edge)).map((edge) => {
      const a = topology!.vertices.get(edge.a)!.point, b = topology!.vertices.get(edge.b)!.point;
      return { meshPath: [], a: [a.x, a.y, a.z], b: [b.x, b.y, b.z] };
    });
  } else {
    reference.selection!.vertices = [...selectedVertices].map((id) => topology!.vertices.get(id)).filter((vertex): vertex is EditVertex => Boolean(vertex)).map((vertex) => ({ meshPath: [], point: [vertex.point.x, vertex.point.y, vertex.point.z] }));
  }
  editor.checkpoint(); meta.references.push(reference); setMeta(targetMesh, meta); semanticName.value = ""; renderSemanticList(); rawEditor.emit?.("changed"); rawEditor.emit?.("selection", editor.getSelection());
  setStatus(`Semántico “${reference.name}” guardado. Clickealo para re-seleccionar.`);
}
function nearestVertexId(point: THREE.Vector3) {
  if (!topology) return null; let best: { id: string; d: number } | null = null;
  for (const vertex of topology.vertices.values()) { const d = vertex.point.distanceToSquared(point); if (!best || d < best.d) best = { id: vertex.id, d }; }
  return best?.id ?? null;
}
function reselectSemantic(reference: SemanticReference) {
  if (!topology) return;
  clearComponentSelection();
  if (reference.kind === "face") {
    componentMode = "face";
    for (const item of reference.selection?.faces ?? []) for (const tri of item.triangles) { const id = topology.faceByTriangle.get(tri); if (id) selectedFaces.add(id); }
  } else if (reference.kind === "edge") {
    componentMode = "edge";
    for (const item of reference.selection?.edges ?? []) {
      const a = nearestVertexId(new THREE.Vector3(...item.a)), b = nearestVertexId(new THREE.Vector3(...item.b));
      if (a && b) { const id = pairId(a, b); if (topology.edges.has(id)) selectedEdges.add(id); }
    }
  } else if (reference.kind === "vertex") {
    componentMode = "vertex";
    for (const item of reference.selection?.vertices ?? []) { const id = nearestVertexId(new THREE.Vector3(...item.point)); if (id) selectedVertices.add(id); }
  }
  syncComponentButtons(); refreshHighlights(); updateEditInfo(); updateEditPivot();
  setStatus(`Semántico “${reference.name}” re-seleccionado.`);
}
editSide.querySelector<HTMLElement>("[data-edit-semantic-save]")!.addEventListener("click", saveSemanticSelection);
semanticName.addEventListener("keydown", (event) => { if (event.key === "Enter") saveSemanticSelection(); });

// Existing semantic rows in the hierarchy now become re-selection shortcuts in Edit Mode.
outliner?.addEventListener("click", (event) => {
  if (!editMode || !targetMesh) return;
  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(".tm-ref-row"); const id = row?.dataset.refId; if (!id) return;
  const ref = getMeta(targetMesh)?.references.find((item) => item.id === id);
  if (ref && (ref.kind === "vertex" || ref.kind === "edge" || ref.kind === "face")) { event.preventDefault(); event.stopImmediatePropagation(); reselectSemantic(ref); }
}, true);

// -----------------------------------------------------------------------------
// Mode transitions / UI state
// -----------------------------------------------------------------------------
const controlNames = ["__tm_tinkercad_controls_v044", "__tm_tinkercad_controls"];
const controlVisibility = new Map<THREE.Object3D, boolean>();
function hideObjectControls() {
  for (const name of controlNames) { const object = editor.scene.getObjectByName(name); if (object) { controlVisibility.set(object, object.visible); object.visible = false; } }
  editor.transform.detach(); editor.transform.getHelper().visible = false;
}
function restoreObjectControls() {
  for (const [object, visible] of controlVisibility) object.visible = visible; controlVisibility.clear();
  const active = editor.activeObject(); if (active) editor.transform.attach(active);
  const modeSelect = document.querySelector<HTMLSelectElement>(".manipulator-mode-box select");
  editor.transform.getHelper().visible = (modeSelect?.value ?? "tinker") !== "tinker";
}
function syncComponentButtons() {
  editToolbar.querySelectorAll<HTMLElement>("[data-edit-select]").forEach((button) => button.classList.toggle("active", button.dataset.editSelect === componentMode));
}
function updateEditInfo() {
  editModeLabel.textContent = componentMode === "vertex" ? "Vértices" : componentMode === "edge" ? "Aristas" : "Caras";
  editCountLabel.textContent = `${currentSet().size} seleccionado${currentSet().size === 1 ? "" : "s"}`;
  if (targetMesh && topology) {
    editTargetLabel.textContent = getMeta(targetMesh)?.name ?? targetMesh.name ?? "Malla";
    editTopologyLabel.textContent = `${topology.vertices.size} vértices · ${[...topology.edges.values()].filter((edge) => edge.feature).length} aristas · ${topology.faces.size} caras`;
  }
}
function canEdit(object: THREE.Object3D | undefined | null): object is THREE.Mesh {
  return object instanceof THREE.Mesh && Boolean(object.geometry?.getAttribute("position"));
}
function setEditMode(active: boolean) {
  if (active === editMode) return;
  if (active) {
    const object = editor.activeObject();
    if (!canEdit(object)) { setStatus("Modo Edición necesita una malla simple. En grupos, elegí el hijo desde Objetos o desagrupá."); return; }
    editMode = true; targetMesh = object; targetId = getMeta(object)?.id ?? null; topology = buildTopology(object); clearComponentSelection();
    document.documentElement.classList.add("tm-edit-mode"); objectModeButton.classList.remove("active"); editModeButton.classList.add("active");
    hideObjectControls(); updateEditInfo(); renderSemanticList(); syncComponentButtons(); setEditTransformMode("translate");
    setStatus("EDIT MODE · 1 vértices · 2 aristas · 3 caras · G/R/S transforma la selección · Tab vuelve a Objeto.");
  } else {
    setBevelOpen(false); editMode = false; document.documentElement.classList.remove("tm-edit-mode"); objectModeButton.classList.add("active"); editModeButton.classList.remove("active");
    clearVisualGroup(hoverGroup); clearVisualGroup(selectionGroup); editTransform.detach(); editTransformHelper.visible = false; restoreObjectControls();
    targetMesh = null; targetId = null; topology = null; selectedVertices.clear(); selectedEdges.clear(); selectedFaces.clear(); hovered = null;
    setStatus("OBJECT MODE · objetos completos.");
  }
}
objectModeButton.addEventListener("click", () => setEditMode(false));
editModeButton.addEventListener("click", () => setEditMode(true));

function setComponentMode(mode: ComponentMode) {
  componentMode = mode; selectedVertices.clear(); selectedEdges.clear(); selectedFaces.clear(); hovered = null; setBevelOpen(false);
  syncComponentButtons(); refreshHighlights(); updateEditInfo(); updateEditPivot();
}
editToolbar.querySelectorAll<HTMLButtonElement>("[data-edit-select]").forEach((button) => button.addEventListener("click", () => setComponentMode(button.dataset.editSelect as ComponentMode)));
editToolbar.querySelectorAll<HTMLButtonElement>("[data-edit-transform]").forEach((button) => button.addEventListener("click", () => setEditTransformMode(button.dataset.editTransform as EditTransformMode)));
editToolbar.querySelector<HTMLButtonElement>("[data-edit-bevel]")!.addEventListener("click", () => setBevelOpen(!bevelOpen));
editSide.querySelector<HTMLButtonElement>("[data-edit-all]")!.addEventListener("click", () => {
  if (!topology) return; currentSet().clear();
  if (componentMode === "vertex") topology.vertices.forEach((_, id) => selectedVertices.add(id));
  else if (componentMode === "edge") topology.edges.forEach((edge, id) => { if (edge.feature) selectedEdges.add(id); });
  else topology.faces.forEach((_, id) => selectedFaces.add(id));
  refreshHighlights(); updateEditInfo(); updateEditPivot();
});
editSide.querySelector<HTMLButtonElement>("[data-edit-none]")!.addEventListener("click", clearComponentSelection);

// Component picking owns left-click on the canvas while editing. RMB/MMB still
// reach OrbitControls for orbit/pan.
canvas.addEventListener("pointermove", (event) => {
  if (!editMode || (editTransform as any).dragging || editTransform.axis) return;
  hovered = componentAt(event.clientX, event.clientY); refreshHighlights();
}, true);
canvas.addEventListener("pointerleave", () => { if (editMode) { hovered = null; refreshHighlights(); } });
canvas.addEventListener("pointerdown", (event) => {
  if (!editMode || event.button !== 0 || (editTransform as any).dragging || editTransform.axis) return;
  const entity = componentAt(event.clientX, event.clientY);
  event.preventDefault(); event.stopImmediatePropagation();
  const set = currentSet();
  if (!entity) { if (!event.shiftKey) clearComponentSelection(); return; }
  if (!event.shiftKey) set.clear();
  if (event.shiftKey && set.has(entity.id)) set.delete(entity.id); else set.add(entity.id);
  hovered = entity; refreshHighlights(); updateEditInfo(); updateEditPivot(); if (bevelOpen) updateBevelPreview();
}, true);

// Keyboard handoff: reuse the early override hooks so legacy Object Mode G/R/S
// cannot start underneath Edit Mode.
const previousScaleKey = window.__tmV064ScaleKeydownOverride;
const previousTransformKey = window.__tmV067TransformKeydownOverride;
function editTransformKey(event: KeyboardEvent) {
  if (!editMode) return false;
  const target = event.target as HTMLElement | null;
  const typing = target?.matches("input,textarea,select") || target?.isContentEditable;
  if (typing) return false;
  const key = event.key.toLowerCase();
  if (key === "g" || key === "m" || key === "r" || key === "s") {
    event.preventDefault(); event.stopImmediatePropagation();
    setEditTransformMode(key === "r" ? "rotate" : key === "s" ? "scale" : "translate"); return true;
  }
  return false;
}
window.__tmV064ScaleKeydownOverride = (event) => editMode ? editTransformKey(event) : previousScaleKey?.(event) ?? false;
window.__tmV067TransformKeydownOverride = (event) => editMode ? editTransformKey(event) : previousTransformKey?.(event) ?? false;
window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const typing = target?.matches("input,textarea,select") || target?.isContentEditable;
  if (typing) return;
  if (event.key === "Tab") { event.preventDefault(); event.stopImmediatePropagation(); setEditMode(!editMode); return; }
  if (!editMode) return;
  if (event.key === "1" || event.key === "2" || event.key === "3") {
    event.preventDefault(); event.stopImmediatePropagation(); setComponentMode(event.key === "1" ? "vertex" : event.key === "2" ? "edge" : "face");
  } else if (event.key.toLowerCase() === "a") {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.altKey) clearComponentSelection(); else editSide.querySelector<HTMLButtonElement>("[data-edit-all]")!.click();
  } else if (event.key === "Escape" && bevelOpen) { event.preventDefault(); event.stopImmediatePropagation(); setBevelOpen(false); }
}, true);

// Undo can replace scene objects. Retarget by semantic object id if necessary.
editor.on("changed", () => {
  if (!editMode || !targetId) return;
  if (!targetMesh?.parent) {
    const replacement = editor.findById(targetId);
    if (replacement instanceof THREE.Mesh) { targetMesh = replacement; topology = buildTopology(replacement); clearComponentSelection(); renderSemanticList(); }
    else setEditMode(false);
  }
});
editor.on("selection", () => {
  if (!editMode) return;
  const active = editor.activeObject();
  if (active !== targetMesh) setEditMode(false);
});

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  getEditMode: () => editMode,
  setEditMode: (active: boolean) => { setEditMode(Boolean(active)); return editMode; },
  getEditSelection: () => ({ mode: componentMode, ids: [...currentSet()] }),
});

setStatus("TinkerMatt v0.7.0 · Object/Edit Mode + selección topológica + transformaciones + bevel redondeado + semánticos re-seleccionables.");
