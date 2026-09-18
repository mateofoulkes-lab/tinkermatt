import * as THREE from "three";
import "./v056.css";
import {
  clonePreservingIds,
  getMeta,
  makeId,
  setMeta,
  type ReferenceKind,
  type SemanticGeometrySelection,
  type SemanticReference,
} from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, unknown>;
  }
}

type ProjectFile = {
  format: "TinkerMatt";
  formatVersion: 1;
  appVersion: string;
  name: string;
  savedAt: string;
  snap: { enabled: boolean; gridSize: number };
  scene: ReturnType<THREE.Object3D["toJSON"]>;
};

type TopologyTriangle = {
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  normal: THREE.Vector3;
  plane: number;
  edges: [string, string, string];
};

type Topology = {
  triangles: TopologyTriangle[];
  edgeTriangles: Map<string, number[]>;
};

type SemanticEntity =
  | { kind: "face"; root: THREE.Object3D; mesh: THREE.Mesh; meshPath: number[]; triangles: number[] }
  | { kind: "edge"; root: THREE.Object3D; mesh: THREE.Mesh; meshPath: number[]; a: THREE.Vector3; b: THREE.Vector3 }
  | { kind: "vertex"; root: THREE.Object3D; mesh: THREE.Mesh; meshPath: number[]; point: THREE.Vector3 }
  | { kind: "object"; root: THREE.Object3D };

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.6 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.6";

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const refKind = document.querySelector<HTMLSelectElement>("#ref-kind");
const refName = document.querySelector<HTMLInputElement>("#ref-name");
const refsList = document.querySelector<HTMLElement>("#refs-list");
const outliner = document.querySelector<HTMLElement>("#outliner-tree");
const projectName = document.querySelector<HTMLInputElement>(".tm-project-name");
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };

// -----------------------------------------------------------------------------
// Autosave: a complete TinkerMatt project is persisted in IndexedDB. This keeps
// large imported STL/SVG projects out of localStorage's very small quota.
// -----------------------------------------------------------------------------
const AUTOSAVE_DB = "tinkermatt-local";
const AUTOSAVE_STORE = "projects";
const AUTOSAVE_KEY = "current";
let restoringAutosave = false;
let autosaveTimer = 0;

const autosaveBadge = document.createElement("span");
autosaveBadge.className = "tm-autosave-badge saved";
autosaveBadge.textContent = "guardado local";
document.querySelector<HTMLElement>(".tm-project-controls")?.append(autosaveBadge);

function cleanProjectName() {
  return projectName?.value.trim() || "Diseño sin nombre";
}

function projectPayload(): ProjectFile {
  const root = new THREE.Group();
  root.name = "TinkerMattProject";
  for (const object of editor.getSceneRoots()) root.add(clonePreservingIds(object));
  return {
    format: "TinkerMatt",
    formatVersion: 1,
    appVersion: "0.5.6",
    name: cleanProjectName(),
    savedAt: new Date().toISOString(),
    snap: editor.getSnap(),
    scene: root.toJSON(),
  };
}

function openAutosaveDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(AUTOSAVE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) db.createObjectStore(AUTOSAVE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

async function putAutosave(payload: ProjectFile) {
  const db = await openAutosaveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, "readwrite");
    tx.objectStore(AUTOSAVE_STORE).put(payload, AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar."));
  });
  db.close();
}

async function getAutosave() {
  const db = await openAutosaveDb();
  const value = await new Promise<ProjectFile | undefined>((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, "readonly");
    const request = tx.objectStore(AUTOSAVE_STORE).get(AUTOSAVE_KEY);
    request.onsuccess = () => resolve(request.result as ProjectFile | undefined);
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer el autoguardado."));
  });
  db.close();
  return value;
}

function scheduleAutosave() {
  if (restoringAutosave) return;
  autosaveBadge.classList.remove("saved");
  autosaveBadge.classList.add("saving");
  autosaveBadge.textContent = "guardando…";
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(async () => {
    try {
      await putAutosave(projectPayload());
      autosaveBadge.classList.remove("saving");
      autosaveBadge.classList.add("saved");
      autosaveBadge.textContent = "guardado local";
    } catch (error) {
      autosaveBadge.classList.remove("saving", "saved");
      autosaveBadge.textContent = "autosave falló";
      console.warn("TinkerMatt autosave", error);
    }
  }, 450);
}

async function restoreAutosave() {
  if (editor.getSceneRoots().length) return;
  try {
    const payload = await getAutosave();
    if (!payload || payload.format !== "TinkerMatt" || payload.formatVersion !== 1 || !payload.scene) return;
    restoringAutosave = true;
    const parsed = new THREE.ObjectLoader().parse(payload.scene as any);
    editor.setSelection([]);
    for (const root of editor.getSceneRoots()) root.removeFromParent();
    for (const child of [...parsed.children]) {
      parsed.remove(child);
      rawEditor.prepareObject?.(child);
      editor.scene.add(child);
    }
    if (projectName) projectName.value = payload.name?.trim() || "Diseño sin nombre";
    document.title = `${cleanProjectName()} · TinkerMatt`;
    if (payload.snap) editor.setSnap(Boolean(payload.snap.enabled), Number(payload.snap.gridSize) || 1);
    rawEditor.emit?.("changed");
    rawEditor.emit?.("selection", []);
    autosaveBadge.textContent = "recuperado";
    setStatus(`Autoguardado recuperado: “${cleanProjectName()}”.`);
    window.setTimeout(() => { autosaveBadge.textContent = "guardado local"; }, 1600);
  } catch (error) {
    console.warn("No se pudo restaurar TinkerMatt", error);
  } finally {
    restoringAutosave = false;
  }
}

editor.on("changed", scheduleAutosave);
projectName?.addEventListener("input", scheduleAutosave);
window.setTimeout(() => void restoreAutosave(), 60);

// -----------------------------------------------------------------------------
// Semantic topology picker.
// The old rectangular-on-face tool is removed. A semantic reference now stores
// actual mesh topology (coplanar connected faces, real boundary edges, vertices)
// or whole object ids. This is the representation the future MCP will consume.
// -----------------------------------------------------------------------------
document.querySelector(".tm-zone-tool-row")?.remove();
const legacyAddRef = document.querySelector<HTMLElement>("#add-ref");
if (legacyAddRef) legacyAddRef.style.display = "none";

if (refKind) {
  refKind.innerHTML = `
    <option value="face">Cara</option>
    <option value="edge">Arista</option>
    <option value="vertex">Vértice</option>
    <option value="object">Objeto</option>
  `;
}

const semanticToolbar = document.createElement("div");
semanticToolbar.className = "tm-semantic-toolbar";
const markButton = document.createElement("button");
markButton.type = "button";
markButton.className = "tm-semantic-mark";
markButton.textContent = "Marcar zona";
markButton.title = "Elegí entidades geométricas; Shift agrega varias. Luego guardá la referencia.";
const semanticCount = document.createElement("span");
semanticCount.className = "tm-semantic-count";
semanticCount.textContent = "";
semanticToolbar.append(markButton, semanticCount);
if (refsList?.parentElement) refsList.parentElement.insertBefore(semanticToolbar, refsList);

const pickLayer = document.createElement("div");
pickLayer.className = "tm-semantic-pick-layer";
viewport.append(pickLayer);

const hoverHighlight = new THREE.Group();
hoverHighlight.name = "__tm_semantic_hover";
const pendingHighlight = new THREE.Group();
pendingHighlight.name = "__tm_semantic_pending";
const referenceHighlight = new THREE.Group();
referenceHighlight.name = "__tm_semantic_reference";
editor.scene.add(hoverHighlight, pendingHighlight, referenceHighlight);

const topologyCache = new WeakMap<THREE.BufferGeometry, Topology>();
const pending = new Map<string, SemanticEntity>();
let hovered: SemanticEntity | null = null;
let semanticMode = false;
let pinnedReferenceId: string | null = null;

function clearHighlight(group: THREE.Group) {
  for (const child of [...group.children]) {
    child.removeFromParent();
    const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material) (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
    if (child.userData.tmOwnGeometry === true) (child as THREE.Mesh).geometry?.dispose?.();
  }
}

function entityRoot(object: THREE.Object3D | null) {
  let node = object;
  while (node && node !== editor.scene) {
    if (getMeta(node)) return node;
    node = node.parent;
  }
  return null;
}

function nodePath(root: THREE.Object3D, node: THREE.Object3D) {
  const path: number[] = [];
  let current: THREE.Object3D | null = node;
  while (current && current !== root) {
    const parent = current.parent;
    if (!parent) return [];
    path.unshift(parent.children.indexOf(current));
    current = parent;
  }
  return path;
}

function resolvePath(root: THREE.Object3D, path: number[]) {
  let node: THREE.Object3D = root;
  for (const index of path) {
    const next = node.children[index];
    if (!next) return null;
    node = next;
  }
  return node;
}

const pointKey = (point: THREE.Vector3) => `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`;
const edgeKey = (a: THREE.Vector3, b: THREE.Vector3) => [pointKey(a), pointKey(b)].sort().join("|");

function topologyFor(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const cached = topologyCache.get(geometry);
  if (cached) return cached;
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  const triangles: TopologyTriangle[] = [];
  const edgeTriangles = new Map<string, number[]>();
  const vertexAt = (tri: number, corner: number) => {
    const item = tri * 3 + corner;
    const vertexIndex = index ? index.getX(item) : item;
    return new THREE.Vector3().fromBufferAttribute(position, vertexIndex);
  };
  for (let tri = 0; tri < triangleCount; tri += 1) {
    const a = vertexAt(tri, 0);
    const b = vertexAt(tri, 1);
    const c = vertexAt(tri, 2);
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const edges: [string, string, string] = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)];
    triangles.push({ vertices: [a, b, c], normal, plane: normal.dot(a), edges });
    for (const key of edges) {
      const list = edgeTriangles.get(key) ?? [];
      list.push(tri);
      edgeTriangles.set(key, list);
    }
  }
  const topology = { triangles, edgeTriangles };
  topologyCache.set(geometry, topology);
  return topology;
}

function coplanarFace(mesh: THREE.Mesh, start: number) {
  const topology = topologyFor(mesh);
  const seed = topology.triangles[start];
  if (!seed) return [];
  const result: number[] = [];
  const queue = [start];
  const visited = new Set<number>();
  while (queue.length) {
    const triIndex = queue.pop()!;
    if (visited.has(triIndex)) continue;
    visited.add(triIndex);
    const tri = topology.triangles[triIndex];
    if (!tri || tri.normal.dot(seed.normal) < 0.9995 || Math.abs(tri.plane - seed.plane) > 0.0005) continue;
    result.push(triIndex);
    for (const key of tri.edges) {
      for (const neighbor of topology.edgeTriangles.get(key) ?? []) if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return result.sort((a, b) => a - b);
}

function projectClient(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const projected = point.clone().project(editor.camera);
  return new THREE.Vector2(
    rect.left + (projected.x * 0.5 + 0.5) * rect.width,
    rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
  );
}

function screenSegmentDistance(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a);
  const lengthSq = ab.lengthSq();
  if (lengthSq < 1e-8) return point.distanceTo(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lengthSq, 0, 1);
  return point.distanceTo(a.add(ab.multiplyScalar(t)));
}

const pickerRaycaster = new THREE.Raycaster();
function surfaceHit(clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  pickerRaycaster.setFromCamera(pointer, editor.camera);
  const meshes: THREE.Mesh[] = [];
  for (const root of editor.getSceneRoots()) {
    if (!root.visible) continue;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.visible) meshes.push(node);
    });
  }
  const hit = pickerRaycaster.intersectObjects(meshes, false)[0];
  if (!hit || !(hit.object instanceof THREE.Mesh)) return null;
  const root = entityRoot(hit.object);
  return root ? { hit, mesh: hit.object, root } : null;
}

function semanticEntityAt(clientX: number, clientY: number): SemanticEntity | null {
  const result = surfaceHit(clientX, clientY);
  if (!result) return null;
  const kind = (refKind?.value ?? "face") as "face" | "edge" | "vertex" | "object";
  if (kind === "object") return { kind, root: result.root };
  const faceIndex = result.hit.faceIndex ?? -1;
  if (faceIndex < 0) return null;
  const meshPath = nodePath(result.root, result.mesh);
  const topology = topologyFor(result.mesh);
  const triangle = topology.triangles[faceIndex];
  if (!triangle) return null;
  if (kind === "face") return { kind, root: result.root, mesh: result.mesh, meshPath, triangles: coplanarFace(result.mesh, faceIndex) };

  result.mesh.updateMatrixWorld(true);
  const cursor = new THREE.Vector2(clientX, clientY);
  if (kind === "vertex") {
    let best: { point: THREE.Vector3; distance: number } | null = null;
    for (const local of triangle.vertices) {
      const world = local.clone().applyMatrix4(result.mesh.matrixWorld);
      const distance = projectClient(world).distanceTo(cursor);
      if (!best || distance < best.distance) best = { point: local.clone(), distance };
    }
    return best && best.distance <= 16 ? { kind, root: result.root, mesh: result.mesh, meshPath, point: best.point } : null;
  }

  const edges: Array<[THREE.Vector3, THREE.Vector3, string]> = [
    [triangle.vertices[0], triangle.vertices[1], triangle.edges[0]],
    [triangle.vertices[1], triangle.vertices[2], triangle.edges[1]],
    [triangle.vertices[2], triangle.vertices[0], triangle.edges[2]],
  ];
  let best: { a: THREE.Vector3; b: THREE.Vector3; distance: number } | null = null;
  for (const [a, b, key] of edges) {
    const adjacent = topology.edgeTriangles.get(key) ?? [];
    const internalCoplanar = adjacent.length === 2 && topology.triangles[adjacent[0]].normal.dot(topology.triangles[adjacent[1]].normal) > 0.9995;
    if (internalCoplanar) continue;
    const aw = a.clone().applyMatrix4(result.mesh.matrixWorld);
    const bw = b.clone().applyMatrix4(result.mesh.matrixWorld);
    const distance = screenSegmentDistance(cursor, projectClient(aw), projectClient(bw));
    if (!best || distance < best.distance) best = { a: a.clone(), b: b.clone(), distance };
  }
  return best && best.distance <= 18 ? { kind: "edge", root: result.root, mesh: result.mesh, meshPath, a: best.a, b: best.b } : null;
}

function entityKey(entity: SemanticEntity) {
  const rootId = getMeta(entity.root)?.id ?? "root";
  if (entity.kind === "object") return `object:${rootId}`;
  const path = entity.meshPath.join(".");
  if (entity.kind === "face") return `face:${rootId}:${path}:${entity.triangles.join(",")}`;
  if (entity.kind === "edge") return `edge:${rootId}:${path}:${edgeKey(entity.a, entity.b)}`;
  return `vertex:${rootId}:${path}:${pointKey(entity.point)}`;
}

function addFaceGeometry(group: THREE.Group, mesh: THREE.Mesh, triangles: number[], color: number, opacity: number) {
  const topology = topologyFor(mesh);
  mesh.updateMatrixWorld(true);
  const points: number[] = [];
  for (const index of triangles) {
    const triangle = topology.triangles[index];
    if (!triangle) continue;
    for (const local of triangle.vertices) {
      const world = local.clone().applyMatrix4(mesh.matrixWorld);
      points.push(world.x, world.y, world.z);
    }
  }
  if (!points.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  const overlay = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  overlay.renderOrder = 2500;
  overlay.userData.tmOwnGeometry = true;
  group.add(overlay);
}

function renderEntity(entity: SemanticEntity, group: THREE.Group, color: number, opacity = 0.34) {
  if (entity.kind === "face") {
    addFaceGeometry(group, entity.mesh, entity.triangles, color, opacity);
    return;
  }
  if (entity.kind === "edge") {
    entity.mesh.updateMatrixWorld(true);
    const a = entity.a.clone().applyMatrix4(entity.mesh.matrixWorld);
    const b = entity.b.clone().applyMatrix4(entity.mesh.matrixWorld);
    const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    line.renderOrder = 2501;
    line.userData.tmOwnGeometry = true;
    group.add(line);
    return;
  }
  if (entity.kind === "vertex") {
    entity.mesh.updateMatrixWorld(true);
    const world = entity.point.clone().applyMatrix4(entity.mesh.matrixWorld);
    const geometry = new THREE.BufferGeometry().setFromPoints([world]);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 11, sizeAttenuation: false, depthTest: false }));
    points.renderOrder = 2502;
    points.userData.tmOwnGeometry = true;
    group.add(points);
    return;
  }
  entity.root.updateMatrixWorld(true);
  entity.root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.visible) return;
    const overlay = new THREE.Mesh(node.geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    overlay.matrix.copy(node.matrixWorld);
    overlay.matrixAutoUpdate = false;
    overlay.renderOrder = 2499;
    group.add(overlay);
  });
}

function refreshPendingHighlight() {
  clearHighlight(pendingHighlight);
  for (const entity of pending.values()) renderEntity(entity, pendingHighlight, 0x0ba8e0, 0.38);
  semanticCount.textContent = pending.size ? `${pending.size} sel.` : "";
}

function refreshHover() {
  clearHighlight(hoverHighlight);
  if (hovered && !pending.has(entityKey(hovered))) renderEntity(hovered, hoverHighlight, 0xffb000, 0.45);
}

function setSemanticMode(active: boolean) {
  semanticMode = active;
  pickLayer.classList.toggle("active", active);
  markButton.classList.toggle("active", active);
  if (!active) {
    hovered = null;
    pending.clear();
    clearHighlight(hoverHighlight);
    clearHighlight(pendingHighlight);
    semanticCount.textContent = "";
  }
}

refKind?.addEventListener("change", () => {
  pending.clear();
  hovered = null;
  clearHighlight(hoverHighlight);
  refreshPendingHighlight();
  setSemanticMode(true);
  setStatus(`Selector semántico: ${refKind.selectedOptions[0]?.textContent ?? refKind.value}. Shift agrega varias.`);
});

pickLayer.addEventListener("pointermove", (event) => {
  if (!semanticMode) return;
  hovered = semanticEntityAt(event.clientX, event.clientY);
  refreshHover();
});
pickLayer.addEventListener("pointerleave", () => {
  hovered = null;
  refreshHover();
});
pickLayer.addEventListener("click", (event) => {
  if (!semanticMode) return;
  event.preventDefault();
  event.stopPropagation();
  const entity = semanticEntityAt(event.clientX, event.clientY);
  if (!entity) return;
  const key = entityKey(entity);
  if (!event.shiftKey) pending.clear();
  if (pending.has(key) && event.shiftKey) pending.delete(key);
  else pending.set(key, entity);
  hovered = entity;
  refreshPendingHighlight();
  refreshHover();
});

function nextReferenceName(owner: THREE.Object3D, kind: ReferenceKind) {
  const typed = refName?.value.trim();
  if (typed) return typed;
  const label = kind === "face" ? "Cara" : kind === "edge" ? "Arista" : kind === "vertex" ? "Vértice" : "Objeto";
  const count = getMeta(owner)?.references.filter((reference) => reference.kind === kind).length ?? 0;
  return `${label} ${count + 1}`;
}

function saveSemanticReference() {
  if (!pending.size) {
    if (!semanticMode) {
      setSemanticMode(true);
      setStatus(`Elegí ${refKind?.selectedOptions[0]?.textContent?.toLowerCase() ?? "entidades"}. Shift permite seleccionar varias.`);
    } else setStatus("Seleccioná al menos una entidad antes de marcar la zona.");
    return;
  }
  const entities = [...pending.values()];
  const kind = (refKind?.value ?? "face") as "face" | "edge" | "vertex" | "object";
  let owner = entities[0].root;
  if (kind !== "object" && entities.some((entity) => entity.root !== owner)) {
    setStatus("Una referencia de caras/aristas/vértices debe pertenecer a un solo objeto.");
    return;
  }
  if (kind === "object") owner = editor.activeObject() ?? entities[0].root;
  const meta = getMeta(owner);
  if (!meta) return;

  const selection: SemanticGeometrySelection = {};
  if (kind === "face") {
    const byPath = new Map<string, { path: number[]; triangles: Set<number> }>();
    for (const entity of entities) {
      if (entity.kind !== "face") continue;
      const key = entity.meshPath.join(".");
      const entry = byPath.get(key) ?? { path: entity.meshPath, triangles: new Set<number>() };
      entity.triangles.forEach((triangle) => entry.triangles.add(triangle));
      byPath.set(key, entry);
    }
    selection.faces = [...byPath.values()].map((entry) => ({ meshPath: entry.path, triangles: [...entry.triangles].sort((a, b) => a - b) }));
  } else if (kind === "edge") {
    selection.edges = entities.filter((entity): entity is Extract<SemanticEntity, { kind: "edge" }> => entity.kind === "edge").map((entity) => ({
      meshPath: entity.meshPath,
      a: [entity.a.x, entity.a.y, entity.a.z],
      b: [entity.b.x, entity.b.y, entity.b.z],
    }));
  } else if (kind === "vertex") {
    selection.vertices = entities.filter((entity): entity is Extract<SemanticEntity, { kind: "vertex" }> => entity.kind === "vertex").map((entity) => ({
      meshPath: entity.meshPath,
      point: [entity.point.x, entity.point.y, entity.point.z],
    }));
  } else {
    selection.objectIds = [...new Set(entities.map((entity) => getMeta(entity.root)?.id).filter((id): id is string => Boolean(id)))];
  }

  const reference: SemanticReference = {
    id: makeId("ref"),
    kind,
    name: nextReferenceName(owner, kind),
    selection,
  };
  editor.checkpoint();
  meta.references.push(reference);
  setMeta(owner, meta);
  if (refName) refName.value = "";
  pinnedReferenceId = reference.id;
  setSemanticMode(false);
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  renderReference(reference.id);
  setStatus(`Zona semántica “${reference.name}” guardada (${kind}).`);
}
markButton.addEventListener("click", saveSemanticReference);

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !semanticMode) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setSemanticMode(false);
  setStatus("Selector semántico cancelado.");
}, true);

function findReference(refId: string) {
  for (const root of editor.getSceneRoots()) {
    const reference = getMeta(root)?.references.find((item) => item.id === refId);
    if (reference) return { owner: root, reference };
  }
  return null;
}

function renderReference(refId: string | null) {
  clearHighlight(referenceHighlight);
  if (!refId) return;
  const found = findReference(refId);
  if (!found) return;
  const { owner, reference } = found;
  const selection = reference.selection;
  if (!selection) return;
  for (const item of selection.faces ?? []) {
    const mesh = resolvePath(owner, item.meshPath);
    if (mesh instanceof THREE.Mesh) renderEntity({ kind: "face", root: owner, mesh, meshPath: item.meshPath, triangles: item.triangles }, referenceHighlight, 0xe91e8f, 0.42);
  }
  for (const item of selection.edges ?? []) {
    const mesh = resolvePath(owner, item.meshPath);
    if (mesh instanceof THREE.Mesh) renderEntity({ kind: "edge", root: owner, mesh, meshPath: item.meshPath, a: new THREE.Vector3(...item.a), b: new THREE.Vector3(...item.b) }, referenceHighlight, 0xe91e8f, 0.9);
  }
  for (const item of selection.vertices ?? []) {
    const mesh = resolvePath(owner, item.meshPath);
    if (mesh instanceof THREE.Mesh) renderEntity({ kind: "vertex", root: owner, mesh, meshPath: item.meshPath, point: new THREE.Vector3(...item.point) }, referenceHighlight, 0xe91e8f, 1);
  }
  for (const id of selection.objectIds ?? []) {
    const object = editor.findById(id);
    if (object) renderEntity({ kind: "object", root: object }, referenceHighlight, 0xe91e8f, 0.28);
  }
}

function refIdFromRow(target: EventTarget | null) {
  const row = (target as HTMLElement | null)?.closest<HTMLElement>(".tm-ref-row");
  return row?.dataset.refId ?? null;
}

outliner?.addEventListener("pointerover", (event) => {
  const id = refIdFromRow(event.target);
  if (id) renderReference(id);
});
outliner?.addEventListener("pointerout", (event) => {
  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(".tm-ref-row");
  if (!row) return;
  const related = event.relatedTarget as Node | null;
  if (related && row.contains(related)) return;
  renderReference(pinnedReferenceId);
});
outliner?.addEventListener("click", (event) => {
  const id = refIdFromRow(event.target);
  if (!id) return;
  pinnedReferenceId = id;
  renderReference(id);
});

editor.on("changed", () => {
  if (pinnedReferenceId) renderReference(pinnedReferenceId);
});

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  getSemanticReferences: () => editor.getSceneRoots().map((root) => ({
    objectId: getMeta(root)?.id,
    objectName: getMeta(root)?.name,
    references: structuredClone(getMeta(root)?.references ?? []),
  })),
  selectSemanticReference: (id: string) => {
    pinnedReferenceId = id;
    renderReference(id);
    return findReference(id)?.reference ?? null;
  },
  saveLocalNow: async () => {
    await putAutosave(projectPayload());
    return true;
  },
});

setStatus("TinkerMatt v0.5.6 · autoguardado + referencias semánticas topológicas.");
