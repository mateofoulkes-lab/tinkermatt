import * as THREE from "three";
import "./v059.css";
import { getMeta, makeId, setMeta, type ReferenceKind, type SemanticGeometrySelection, type SemanticReference } from "./model";
import type { TinkerEditor } from "./editor";
import {
  buildPrimitiveGeometry,
  PARAMETRIC_KINDS,
  primitiveDefaults,
  type ParametricPrimitiveKind,
  type PrimitiveValues,
} from "./v059-geometry";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.9 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.9";
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };

// -----------------------------------------------------------------------------
// One parametric inspector for every primitive.
// The older box/cylinder panels remain in the source for compatibility, but this
// panel supersedes them so all primitives speak the same parameter language.
// -----------------------------------------------------------------------------
for (const legacy of document.querySelectorAll<HTMLElement>(".tm-box-properties")) legacy.classList.add("tm-legacy-primitive-properties");

const inspector = document.querySelector<HTMLElement>("#inspector");
const paletteTitle = inspector?.querySelector<HTMLElement>(".palette-title");
const primitiveSection = document.createElement("section");
primitiveSection.className = "tm-box-properties tm-primitive-properties hidden";
if (inspector) {
  if (paletteTitle) inspector.insertBefore(primitiveSection, paletteTitle);
  else inspector.append(primitiveSection);
}

type ParamDef = { key: string; label: string; min: number; max: number; step: number; integer?: boolean };
type PrimitiveSpec = { label: string; params: ParamDef[] };

const dim = (key: string, label: string, max = 500): ParamDef => ({ key, label, min: 0.01, max, step: 0.1 });
const count = (key: string, label: string, min: number, max: number): ParamDef => ({ key, label, min, max, step: 1, integer: true });

const SPECS: Record<ParametricPrimitiveKind, PrimitiveSpec> = {
  box: { label: "Cubo", params: [dim("length", "Longitud"), dim("width", "Anchura"), dim("height", "Altura"), { key: "radius", label: "Radio", min: 0, max: 250, step: 0.1 }, count("steps", "Pasos", 1, 20)] },
  cylinder: { label: "Cilindro", params: [dim("diameter", "Diámetro"), dim("height", "Altura"), count("sides", "Lados", 3, 256), { key: "bevel", label: "Bisel", min: 0, max: 250, step: 0.1 }, count("bevelSegments", "Pasos bisel", 1, 32)] },
  sphere: { label: "Esfera", params: [dim("diameter", "Diámetro"), count("segments", "Segmentos", 8, 256), count("rings", "Anillos", 4, 128)] },
  cone: { label: "Cono", params: [dim("bottomDiameter", "Diámetro inferior"), { ...dim("topDiameter", "Diámetro superior"), min: 0 }, dim("height", "Altura"), count("sides", "Lados", 3, 256)] },
  pyramid: { label: "Pirámide", params: [dim("bottomX", "Base X"), dim("bottomY", "Base Y"), { ...dim("topX", "Superior X"), min: 0 }, { ...dim("topY", "Superior Y"), min: 0 }, dim("height", "Altura")] },
  roof: { label: "Techo", params: [dim("width", "Anchura"), dim("depth", "Profundidad"), dim("height", "Altura")] },
  wedge: { label: "Cuña", params: [dim("width", "Anchura"), dim("depth", "Profundidad"), dim("height", "Altura")] },
  halfCylinder: { label: "Bóveda", params: [dim("diameter", "Diámetro"), dim("depth", "Profundidad"), count("segments", "Segmentos", 3, 256)] },
  dome: { label: "Cúpula", params: [dim("diameter", "Diámetro"), dim("height", "Altura"), count("segments", "Segmentos", 8, 256), count("rings", "Anillos", 2, 128)] },
  torus: { label: "Toro", params: [dim("outerDiameter", "Diámetro exterior"), dim("tubeDiameter", "Diámetro tubo"), count("radialSegments", "Segmentos tubo", 3, 128), count("tubularSegments", "Segmentos aro", 8, 512)] },
  washer: { label: "Arandela", params: [dim("outerDiameter", "Diámetro exterior"), { ...dim("innerDiameter", "Diámetro interior"), min: 0 }, dim("height", "Altura"), count("sides", "Lados", 3, 256)] },
  prism: { label: "Prisma", params: [dim("diameter", "Diámetro"), dim("height", "Altura"), count("sides", "Lados", 3, 64)] },
  polyhedron: { label: "Poliedro", params: [dim("diameter", "Diámetro"), count("detail", "Detalle", 0, 4)] },
};

function primitiveKind(object: THREE.Object3D | null): ParametricPrimitiveKind | null {
  const kind = object ? getMeta(object)?.kind : undefined;
  return kind && PARAMETRIC_KINDS.has(kind) ? kind as ParametricPrimitiveKind : null;
}

function activePrimitive() {
  const object = editor.activeObject();
  return object instanceof THREE.Mesh && primitiveKind(object) ? object : null;
}

function localSize(object: THREE.Mesh) {
  object.geometry.computeBoundingBox();
  const size = object.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(20, 20, 20);
  return new THREE.Vector3(size.x * Math.abs(object.scale.x), size.y * Math.abs(object.scale.y), size.z * Math.abs(object.scale.z));
}

function numberParam(params: Record<string, any>, key: string, fallback: number) {
  const value = Number(params[key]);
  return Number.isFinite(value) ? value : fallback;
}

function inferPrimitiveValues(object: THREE.Mesh, kind: ParametricPrimitiveKind): PrimitiveValues {
  const meta = getMeta(object)!;
  const params = meta.params ?? {};
  const defaults = primitiveDefaults(kind);
  if (Number(params.primitiveVersion) >= 2) {
    const result = { ...defaults };
    for (const key of Object.keys(result)) result[key] = numberParam(params, key, result[key]);
    return result;
  }

  const size = localSize(object);
  const sx = Math.abs(object.scale.x) || 1;
  const sy = Math.abs(object.scale.y) || 1;
  const sz = Math.abs(object.scale.z) || 1;
  const minScale = Math.min(sx, sy, sz);

  switch (kind) {
    case "box": return {
      length: size.x,
      width: size.y,
      height: size.z,
      radius: numberParam(params, "radius", 0) * minScale,
      steps: numberParam(params, "steps", 1),
    };
    case "cylinder": return {
      diameter: size.x,
      height: size.z,
      sides: numberParam(params, "sides", 64),
      bevel: numberParam(params, "bevel", 0) * minScale,
      bevelSegments: numberParam(params, "segments", 1),
    };
    case "sphere": return {
      diameter: Math.max(size.x, size.y, size.z),
      segments: numberParam(params, "segments", 48),
      rings: Math.max(4, Math.round(numberParam(params, "segments", 48) / 2)),
    };
    case "cone": return { ...defaults, bottomDiameter: size.x, topDiameter: 0, height: size.z, sides: 64 };
    case "pyramid": return { ...defaults, bottomX: size.x, bottomY: size.y, height: size.z };
    case "roof": return { ...defaults, width: size.x, depth: size.y, height: size.z };
    case "wedge": return { ...defaults, width: size.x, depth: size.y, height: size.z };
    case "halfCylinder": return { ...defaults, diameter: size.x, depth: size.y, segments: 32 };
    case "dome": return { ...defaults, diameter: Math.max(size.x, size.y), height: size.z };
    case "torus": return { ...defaults, outerDiameter: Math.max(size.x, size.y), tubeDiameter: size.z };
    case "washer": return { ...defaults, outerDiameter: Math.max(size.x, size.y), height: Math.max(0.01, size.z) };
    case "prism": return { ...defaults, diameter: Math.max(size.x, size.y), height: size.z, sides: 6 };
    case "polyhedron": return { ...defaults, diameter: Math.max(size.x, size.y, size.z), detail: 0 };
  }
}

function sanitizedValues(kind: ParametricPrimitiveKind, values: PrimitiveValues) {
  const spec = SPECS[kind];
  const result = { ...primitiveDefaults(kind), ...values };
  for (const def of spec.params) {
    let value = Number(result[def.key]);
    if (!Number.isFinite(value)) value = primitiveDefaults(kind)[def.key];
    value = Math.max(def.min, Math.min(def.max, value));
    if (def.integer) value = Math.round(value);
    result[def.key] = value;
  }
  if (kind === "box") result.radius = Math.min(result.radius, Math.min(result.length, result.width, result.height) / 2 - 0.0001);
  if (kind === "cylinder") result.bevel = Math.min(result.bevel, result.diameter / 2 - 0.0001, result.height / 2 - 0.0001);
  if (kind === "torus") result.tubeDiameter = Math.min(result.tubeDiameter, result.outerDiameter - 0.01);
  if (kind === "washer") result.innerDiameter = Math.min(result.innerDiameter, result.outerDiameter - 0.01);
  return result;
}

function rebuildPrimitive(object: THREE.Mesh, values: PrimitiveValues, checkpoint = false) {
  const kind = primitiveKind(object);
  const meta = getMeta(object);
  if (!kind || !meta) return null;
  if (checkpoint) editor.checkpoint();
  const next = sanitizedValues(kind, values);

  object.geometry.computeBoundingBox();
  const oldBox = object.geometry.boundingBox;
  const oldMinZ = oldBox ? Math.min(oldBox.min.z * object.scale.z, oldBox.max.z * object.scale.z) : 0;
  const axisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).normalize();

  const geometry = buildPrimitiveGeometry(kind, next);
  geometry.computeBoundingBox();
  const newMinZ = geometry.boundingBox?.min.z ?? 0;
  const previous = object.geometry;
  object.geometry = geometry;
  object.scale.set(1, 1, 1);
  object.position.addScaledVector(axisZ, oldMinZ - newMinZ);
  previous.dispose();

  meta.params = { ...(meta.params ?? {}), ...next, primitiveVersion: 2 };
  setMeta(object, meta);
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  return next;
}

let primitiveEditing = false;
let primitiveCheckpointed = false;

function refreshPrimitivePanel() {
  const object = activePrimitive();
  const kind = primitiveKind(object);
  primitiveSection.classList.toggle("hidden", !object || !kind);
  if (!object || !kind) return;
  const values = inferPrimitiveValues(object, kind);
  const spec = SPECS[kind];
  primitiveSection.innerHTML = `<div class="tm-shape-properties-title"><span>Propiedades de ${spec.label.toLowerCase()}</span><span class="tm-primitive-badge">paramétrico</span></div>`;

  for (const def of spec.params) {
    const row = document.createElement("div");
    row.className = "tm-param-row";
    row.dataset.param = def.key;
    const label = document.createElement("label");
    label.textContent = def.label;
    const controls = document.createElement("div");
    controls.className = "tm-param-control";
    const range = document.createElement("input");
    range.className = "tm-param-range";
    range.type = "range";
    range.min = String(def.min); range.max = String(def.max); range.step = String(def.step); range.value = String(values[def.key]);
    const number = document.createElement("input");
    number.className = "tm-param-number";
    number.type = "number";
    number.min = String(def.min); number.max = String(def.max); number.step = String(def.step); number.value = formatParam(values[def.key], def.integer);
    controls.append(range, number);
    row.append(label, controls);
    primitiveSection.append(row);

    const apply = (source: HTMLInputElement) => {
      const current = activePrimitive();
      const currentKind = primitiveKind(current);
      if (!current || currentKind !== kind) return;
      const raw = Number(source.value);
      if (!Number.isFinite(raw)) return;
      if (!primitiveCheckpointed) {
        editor.checkpoint();
        primitiveCheckpointed = true;
      }
      primitiveEditing = true;
      const next = inferPrimitiveValues(current, kind);
      next[def.key] = def.integer ? Math.round(raw) : raw;
      const rebuilt = rebuildPrimitive(current, next, false);
      const value = rebuilt?.[def.key] ?? raw;
      const other = source === range ? number : range;
      other.value = formatParam(value, def.integer);
      source.value = formatParam(value, def.integer);
    };
    range.addEventListener("pointerdown", () => { primitiveCheckpointed = false; primitiveEditing = true; });
    number.addEventListener("focus", () => { primitiveCheckpointed = false; primitiveEditing = true; });
    range.addEventListener("input", () => apply(range));
    number.addEventListener("input", () => apply(number));
    range.addEventListener("change", () => { primitiveEditing = false; primitiveCheckpointed = false; refreshPrimitivePanel(); });
    number.addEventListener("change", () => { primitiveEditing = false; primitiveCheckpointed = false; refreshPrimitivePanel(); });
    number.addEventListener("blur", () => { primitiveEditing = false; primitiveCheckpointed = false; refreshPrimitivePanel(); });
  }
}

function formatParam(value: number, integer = false) {
  return integer ? String(Math.round(value)) : Number(value.toFixed(3)).toString();
}

editor.on("selection", refreshPrimitivePanel);
editor.on("changed", () => { if (!primitiveEditing) refreshPrimitivePanel(); });
refreshPrimitivePanel();

function allSemanticObjects() {
  const result: THREE.Object3D[] = [];
  for (const root of editor.getSceneRoots()) root.traverse((node) => { if (getMeta(node)) result.push(node); });
  return result;
}

function objectByIdOrName(idOrName?: string) {
  if (!idOrName) return activePrimitive();
  return editor.findById(idOrName) ?? allSemanticObjects().find((node) => getMeta(node)?.name === idOrName) ?? null;
}

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  getPrimitiveParameters: (object?: string) => {
    const target = objectByIdOrName(object);
    if (!(target instanceof THREE.Mesh)) return null;
    const kind = primitiveKind(target);
    return kind ? { kind, ...inferPrimitiveValues(target, kind) } : null;
  },
  setPrimitiveParameters: (args: { object?: string; parameters?: PrimitiveValues } & PrimitiveValues) => {
    const target = objectByIdOrName(args.object);
    if (!(target instanceof THREE.Mesh)) throw new Error("No se encontró una primitiva editable.");
    const kind = primitiveKind(target);
    if (!kind) throw new Error("El objeto no es una primitiva paramétrica.");
    const parameters = args.parameters ?? Object.fromEntries(Object.entries(args).filter(([key]) => key !== "object" && key !== "parameters"));
    const values = { ...inferPrimitiveValues(target, kind), ...parameters };
    const result = rebuildPrimitive(target, values, true);
    refreshPrimitivePanel();
    return { kind, ...result };
  },
});

// Fix legacy cones as soon as v0.5.9 sees them. Older TinkerMatt generated
// CylinderGeometry(radiusTop=10, radiusBottom=0), which put the point on the
// workplane after the Y->Z rotation. Rebuilding with bottomDiameter/topDiameter
// makes the base sit on the workplane and the point face upward.
let normalizingCones = false;
function normalizeLegacyCones() {
  if (normalizingCones) return;
  const cones = allSemanticObjects().filter((node): node is THREE.Mesh => node instanceof THREE.Mesh && getMeta(node)?.kind === "cone" && Number(getMeta(node)?.params?.primitiveVersion ?? 0) < 2);
  if (!cones.length) return;
  normalizingCones = true;
  try {
    for (const cone of cones) rebuildPrimitive(cone, inferPrimitiveValues(cone, "cone"), false);
  } finally {
    normalizingCones = false;
  }
}
editor.on("changed", normalizeLegacyCones);
queueMicrotask(normalizeLegacyCones);

// -----------------------------------------------------------------------------
// Semantic picker v2: select logical faces, not individual triangles.
// A face is a connected coplanar region. Adjacency is geometric (quantized edge
// endpoints), so duplicated/non-indexed vertices still belong to the same face.
// -----------------------------------------------------------------------------
type TopologyTriangle = { vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3]; normal: THREE.Vector3; plane: number; edges: [string, string, string] };
type Topology = { triangles: TopologyTriangle[]; edgeTriangles: Map<string, number[]>; epsilon: number; planeTolerance: number };
type SemanticEntity =
  | { kind: "face"; root: THREE.Object3D; mesh: THREE.Mesh; meshPath: number[]; triangles: number[] }
  | { kind: "edge"; root: THREE.Object3D; mesh: THREE.Mesh; meshPath: number[]; a: THREE.Vector3; b: THREE.Vector3 }
  | { kind: "vertex"; root: THREE.Object3D; mesh: THREE.Mesh; meshPath: number[]; point: THREE.Vector3 }
  | { kind: "object"; root: THREE.Object3D };

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const refKind = document.querySelector<HTMLSelectElement>("#ref-kind");
const refName = document.querySelector<HTMLInputElement>("#ref-name");
const refsList = document.querySelector<HTMLElement>("#refs-list");
const outliner = document.querySelector<HTMLElement>("#outliner-tree");
const semanticCount = document.querySelector<HTMLElement>(".tm-semantic-count");

// Detach v0.5.6's triangle picker and its highlight groups. Its saved data stays
// compatible; only the interaction layer is replaced.
document.querySelectorAll<HTMLElement>(".tm-semantic-pick-layer").forEach((node) => node.remove());
for (const name of ["__tm_semantic_hover", "__tm_semantic_pending", "__tm_semantic_reference"]) editor.scene.getObjectByName(name)?.removeFromParent();
const oldMark = document.querySelector<HTMLButtonElement>(".tm-semantic-mark");
const markButton = oldMark ? oldMark.cloneNode(true) as HTMLButtonElement : document.createElement("button");
if (oldMark) oldMark.replaceWith(markButton);
else refsList?.parentElement?.prepend(markButton);
markButton.classList.add("tm-semantic-mark");
markButton.textContent = "Marcar zona";

const pickLayer = document.createElement("div");
pickLayer.className = "tm-semantic-pick-layer tm-v059-semantic-layer";
viewport.append(pickLayer);
const hoverHighlight = new THREE.Group(); hoverHighlight.name = "__tm059_semantic_hover";
const pendingHighlight = new THREE.Group(); pendingHighlight.name = "__tm059_semantic_pending";
const savedHighlight = new THREE.Group(); savedHighlight.name = "__tm059_semantic_saved";
editor.scene.add(hoverHighlight, pendingHighlight, savedHighlight);

const topologyCache = new WeakMap<THREE.BufferGeometry, Topology>();
const pending = new Map<string, SemanticEntity>();
let semanticMode = false;
let hovered: SemanticEntity | null = null;
let pinnedReferenceId: string | null = null;

function clearHighlight(group: THREE.Group) {
  for (const child of [...group.children]) {
    child.removeFromParent();
    const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material) (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
    if (child.userData.tmOwnGeometry) (child as THREE.Mesh).geometry?.dispose?.();
  }
}

function semanticRoot(object: THREE.Object3D | null) {
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
    const child = node.children[index];
    if (!child) return null;
    node = child;
  }
  return node;
}

function topologyFor(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const cached = topologyCache.get(geometry);
  if (cached) return cached;
  geometry.computeBoundingBox();
  const diagonal = geometry.boundingBox?.getSize(new THREE.Vector3()).length() || 1;
  const epsilon = Math.max(1e-6, diagonal * 1e-6);
  const planeTolerance = Math.max(1e-5, diagonal * 2e-6);
  const pointKey = (point: THREE.Vector3) => `${Math.round(point.x / epsilon)},${Math.round(point.y / epsilon)},${Math.round(point.z / epsilon)}`;
  const edgeKey = (a: THREE.Vector3, b: THREE.Vector3) => [pointKey(a), pointKey(b)].sort().join("|");
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
    const a = vertexAt(tri, 0), b = vertexAt(tri, 1), c = vertexAt(tri, 2);
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const edges = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)] as [string, string, string];
    triangles.push({ vertices: [a, b, c], normal, plane: normal.dot(a), edges });
    for (const key of edges) {
      const list = edgeTriangles.get(key) ?? [];
      list.push(tri);
      edgeTriangles.set(key, list);
    }
  }
  const topology = { triangles, edgeTriangles, epsilon, planeTolerance };
  topologyCache.set(geometry, topology);
  return topology;
}

function coplanar(a: TopologyTriangle, b: TopologyTriangle, tolerance: number) {
  const dot = a.normal.dot(b.normal);
  if (Math.abs(dot) < 0.999995) return false;
  return dot >= 0 ? Math.abs(a.plane - b.plane) <= tolerance : Math.abs(a.plane + b.plane) <= tolerance;
}

function logicalFace(mesh: THREE.Mesh, start: number) {
  const topology = topologyFor(mesh);
  const seed = topology.triangles[start];
  if (!seed) return [];
  const result: number[] = [];
  const queue = [start];
  const visited = new Set<number>();
  while (queue.length) {
    const index = queue.pop()!;
    if (visited.has(index)) continue;
    visited.add(index);
    const tri = topology.triangles[index];
    if (!tri || !coplanar(seed, tri, topology.planeTolerance)) continue;
    result.push(index);
    for (const edge of tri.edges) {
      for (const neighbor of topology.edgeTriangles.get(edge) ?? []) if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return result.sort((a, b) => a - b);
}

const raycaster = new THREE.Raycaster();
function surfaceHit(clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, editor.camera);
  const meshes: THREE.Mesh[] = [];
  for (const root of editor.getSceneRoots()) if (root.visible) root.traverse((node) => { if (node instanceof THREE.Mesh && node.visible) meshes.push(node); });
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit || !(hit.object instanceof THREE.Mesh)) return null;
  const root = semanticRoot(hit.object);
  return root ? { hit, mesh: hit.object, root } : null;
}

function projectClient(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const p = point.clone().project(editor.camera);
  return new THREE.Vector2(rect.left + (p.x * 0.5 + 0.5) * rect.width, rect.top + (-p.y * 0.5 + 0.5) * rect.height);
}

function segmentDistance(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a);
  const len = ab.lengthSq();
  if (len < 1e-8) return point.distanceTo(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / len, 0, 1);
  return point.distanceTo(a.add(ab.multiplyScalar(t)));
}

function semanticEntityAt(clientX: number, clientY: number): SemanticEntity | null {
  const result = surfaceHit(clientX, clientY);
  if (!result) return null;
  const kind = (refKind?.value ?? "face") as "face" | "edge" | "vertex" | "object";
  if (kind === "object") return { kind, root: result.root };
  const faceIndex = result.hit.faceIndex ?? -1;
  if (faceIndex < 0) return null;
  const topology = topologyFor(result.mesh);
  const triangle = topology.triangles[faceIndex];
  if (!triangle) return null;
  const meshPath = nodePath(result.root, result.mesh);
  if (kind === "face") return { kind, root: result.root, mesh: result.mesh, meshPath, triangles: logicalFace(result.mesh, faceIndex) };

  result.mesh.updateMatrixWorld(true);
  const cursor = new THREE.Vector2(clientX, clientY);
  if (kind === "vertex") {
    let best: { point: THREE.Vector3; distance: number } | null = null;
    for (const point of triangle.vertices) {
      const distance = projectClient(point.clone().applyMatrix4(result.mesh.matrixWorld)).distanceTo(cursor);
      if (!best || distance < best.distance) best = { point: point.clone(), distance };
    }
    return best && best.distance <= 16 ? { kind, root: result.root, mesh: result.mesh, meshPath, point: best.point } : null;
  }

  const candidates: Array<[THREE.Vector3, THREE.Vector3, string]> = [
    [triangle.vertices[0], triangle.vertices[1], triangle.edges[0]],
    [triangle.vertices[1], triangle.vertices[2], triangle.edges[1]],
    [triangle.vertices[2], triangle.vertices[0], triangle.edges[2]],
  ];
  let best: { a: THREE.Vector3; b: THREE.Vector3; distance: number } | null = null;
  for (const [a, b, key] of candidates) {
    const adjacent = topology.edgeTriangles.get(key) ?? [];
    if (adjacent.length === 2 && coplanar(topology.triangles[adjacent[0]], topology.triangles[adjacent[1]], topology.planeTolerance)) continue;
    const distance = segmentDistance(cursor, projectClient(a.clone().applyMatrix4(result.mesh.matrixWorld)), projectClient(b.clone().applyMatrix4(result.mesh.matrixWorld)));
    if (!best || distance < best.distance) best = { a: a.clone(), b: b.clone(), distance };
  }
  return best && best.distance <= 18 ? { kind: "edge", root: result.root, mesh: result.mesh, meshPath, a: best.a, b: best.b } : null;
}

function pointKey(point: THREE.Vector3) { return `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`; }
function edgeEntityKey(a: THREE.Vector3, b: THREE.Vector3) { return [pointKey(a), pointKey(b)].sort().join("|"); }
function entityKey(entity: SemanticEntity) {
  const rootId = getMeta(entity.root)?.id ?? "root";
  if (entity.kind === "object") return `object:${rootId}`;
  const path = entity.meshPath.join(".");
  if (entity.kind === "face") return `face:${rootId}:${path}:${entity.triangles.join(",")}`;
  if (entity.kind === "edge") return `edge:${rootId}:${path}:${edgeEntityKey(entity.a, entity.b)}`;
  return `vertex:${rootId}:${path}:${pointKey(entity.point)}`;
}

function addFaceOverlay(group: THREE.Group, mesh: THREE.Mesh, triangles: number[], color: number, opacity: number) {
  const topology = topologyFor(mesh);
  mesh.updateMatrixWorld(true);
  const points: number[] = [];
  for (const index of triangles) {
    const tri = topology.triangles[index];
    if (!tri) continue;
    for (const local of tri.vertices) {
      const world = local.clone().applyMatrix4(mesh.matrixWorld);
      points.push(world.x, world.y, world.z);
    }
  }
  if (!points.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const overlay = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  overlay.renderOrder = 2600; overlay.userData.tmOwnGeometry = true; group.add(overlay);
}

function renderEntity(entity: SemanticEntity, group: THREE.Group, color: number, opacity = 0.4) {
  if (entity.kind === "face") return addFaceOverlay(group, entity.mesh, entity.triangles, color, opacity);
  if (entity.kind === "edge") {
    entity.mesh.updateMatrixWorld(true);
    const geometry = new THREE.BufferGeometry().setFromPoints([entity.a.clone().applyMatrix4(entity.mesh.matrixWorld), entity.b.clone().applyMatrix4(entity.mesh.matrixWorld)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
    line.renderOrder = 2601; line.userData.tmOwnGeometry = true; group.add(line); return;
  }
  if (entity.kind === "vertex") {
    entity.mesh.updateMatrixWorld(true);
    const geometry = new THREE.BufferGeometry().setFromPoints([entity.point.clone().applyMatrix4(entity.mesh.matrixWorld)]);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 11, sizeAttenuation: false, depthTest: false }));
    points.renderOrder = 2602; points.userData.tmOwnGeometry = true; group.add(points); return;
  }
  entity.root.updateMatrixWorld(true);
  entity.root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.visible) return;
    const overlay = new THREE.Mesh(node.geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    overlay.matrix.copy(node.matrixWorld); overlay.matrixAutoUpdate = false; overlay.renderOrder = 2599; group.add(overlay);
  });
}

function refreshHover() {
  clearHighlight(hoverHighlight);
  if (hovered && !pending.has(entityKey(hovered))) renderEntity(hovered, hoverHighlight, 0xffb000, 0.46);
}
function refreshPending() {
  clearHighlight(pendingHighlight);
  for (const entity of pending.values()) renderEntity(entity, pendingHighlight, 0x0ba8e0, 0.4);
  if (semanticCount) semanticCount.textContent = pending.size ? `${pending.size} sel.` : "";
}
function setSemanticMode(active: boolean) {
  semanticMode = active;
  pickLayer.classList.toggle("active", active);
  markButton.classList.toggle("v059-active", active);
  if (!active) {
    pending.clear(); hovered = null; refreshPending(); refreshHover();
  }
}
function activateSemanticMode() {
  pending.clear(); hovered = null; refreshPending(); refreshHover(); setSemanticMode(true);
  setStatus(`Selector semántico: ${refKind?.selectedOptions[0]?.textContent ?? "Cara"}. Shift agrega varias.`);
}
refKind?.addEventListener("change", activateSemanticMode);
refKind?.addEventListener("pointerdown", () => { if (!semanticMode) queueMicrotask(activateSemanticMode); });

pickLayer.addEventListener("pointermove", (event) => { if (semanticMode) { hovered = semanticEntityAt(event.clientX, event.clientY); refreshHover(); } });
pickLayer.addEventListener("pointerleave", () => { hovered = null; refreshHover(); });
pickLayer.addEventListener("click", (event) => {
  if (!semanticMode) return;
  event.preventDefault(); event.stopPropagation();
  const entity = semanticEntityAt(event.clientX, event.clientY);
  if (!entity) return;
  const key = entityKey(entity);
  if (!event.shiftKey) pending.clear();
  if (event.shiftKey && pending.has(key)) pending.delete(key); else pending.set(key, entity);
  hovered = entity; refreshPending(); refreshHover();
});

function nextReferenceName(owner: THREE.Object3D, kind: ReferenceKind) {
  const typed = refName?.value.trim();
  if (typed) return typed;
  const label = kind === "face" ? "Cara" : kind === "edge" ? "Arista" : kind === "vertex" ? "Vértice" : "Objeto";
  const count = getMeta(owner)?.references.filter((ref) => ref.kind === kind).length ?? 0;
  return `${label} ${count + 1}`;
}

function saveReference() {
  if (!pending.size) {
    if (!semanticMode) activateSemanticMode(); else setStatus("Seleccioná al menos una entidad antes de marcar la zona.");
    return;
  }
  const entities = [...pending.values()];
  const kind = (refKind?.value ?? "face") as "face" | "edge" | "vertex" | "object";
  let owner = entities[0].root;
  if (kind !== "object" && entities.some((entity) => entity.root !== owner)) {
    setStatus("Una referencia de caras/aristas/vértices debe pertenecer a un solo objeto."); return;
  }
  if (kind === "object") owner = editor.activeObject() ?? owner;
  const meta = getMeta(owner); if (!meta) return;
  const selection: SemanticGeometrySelection = {};
  if (kind === "face") {
    const byPath = new Map<string, { path: number[]; triangles: Set<number> }>();
    for (const entity of entities) if (entity.kind === "face") {
      const key = entity.meshPath.join(".");
      const entry = byPath.get(key) ?? { path: entity.meshPath, triangles: new Set<number>() };
      entity.triangles.forEach((tri) => entry.triangles.add(tri)); byPath.set(key, entry);
    }
    selection.faces = [...byPath.values()].map((entry) => ({ meshPath: entry.path, triangles: [...entry.triangles].sort((a, b) => a - b) }));
  } else if (kind === "edge") selection.edges = entities.filter((e): e is Extract<SemanticEntity, { kind: "edge" }> => e.kind === "edge").map((e) => ({ meshPath: e.meshPath, a: [e.a.x, e.a.y, e.a.z], b: [e.b.x, e.b.y, e.b.z] }));
  else if (kind === "vertex") selection.vertices = entities.filter((e): e is Extract<SemanticEntity, { kind: "vertex" }> => e.kind === "vertex").map((e) => ({ meshPath: e.meshPath, point: [e.point.x, e.point.y, e.point.z] }));
  else selection.objectIds = [...new Set(entities.map((e) => getMeta(e.root)?.id).filter((id): id is string => Boolean(id)))];

  const reference: SemanticReference = { id: makeId("ref"), kind, name: nextReferenceName(owner, kind), selection };
  editor.checkpoint(); meta.references.push(reference); setMeta(owner, meta);
  if (refName) refName.value = "";
  pinnedReferenceId = reference.id;
  setSemanticMode(false);
  rawEditor.emit?.("changed"); rawEditor.emit?.("selection", editor.getSelection());
  renderReference(reference.id);
  setStatus(`Referencia semántica “${reference.name}” guardada como ${kind === "face" ? "cara lógica" : kind}.`);
}
markButton.addEventListener("click", saveReference);
window.addEventListener("keyup", (event) => { if (event.key === "Escape" && semanticMode) { setSemanticMode(false); setStatus("Selector semántico cancelado."); } }, true);

function findReference(refId: string) {
  for (const node of allSemanticObjects()) {
    const reference = getMeta(node)?.references.find((item) => item.id === refId);
    if (reference) return { owner: node, reference };
  }
  return null;
}

function renderReference(refId: string | null) {
  clearHighlight(savedHighlight);
  if (!refId) return;
  const found = findReference(refId); if (!found?.reference.selection) return;
  const { owner, reference } = found;
  for (const item of reference.selection.faces ?? []) {
    const mesh = resolvePath(owner, item.meshPath);
    if (mesh instanceof THREE.Mesh) renderEntity({ kind: "face", root: owner, mesh, meshPath: item.meshPath, triangles: item.triangles }, savedHighlight, 0xe91e8f, 0.44);
  }
  for (const item of reference.selection.edges ?? []) {
    const mesh = resolvePath(owner, item.meshPath);
    if (mesh instanceof THREE.Mesh) renderEntity({ kind: "edge", root: owner, mesh, meshPath: item.meshPath, a: new THREE.Vector3(...item.a), b: new THREE.Vector3(...item.b) }, savedHighlight, 0xe91e8f, 0.95);
  }
  for (const item of reference.selection.vertices ?? []) {
    const mesh = resolvePath(owner, item.meshPath);
    if (mesh instanceof THREE.Mesh) renderEntity({ kind: "vertex", root: owner, mesh, meshPath: item.meshPath, point: new THREE.Vector3(...item.point) }, savedHighlight, 0xe91e8f, 1);
  }
  for (const id of reference.selection.objectIds ?? []) { const object = editor.findById(id); if (object) renderEntity({ kind: "object", root: object }, savedHighlight, 0xe91e8f, 0.3); }
}

function referenceIdFromRow(target: EventTarget | null) { return (target as HTMLElement | null)?.closest<HTMLElement>(".tm-ref-row")?.dataset.refId ?? null; }
outliner?.addEventListener("pointerover", (event) => { const id = referenceIdFromRow(event.target); if (id) renderReference(id); });
outliner?.addEventListener("pointerout", (event) => {
  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(".tm-ref-row");
  if (!row) return;
  const related = event.relatedTarget as Node | null;
  if (!related || !row.contains(related)) renderReference(pinnedReferenceId);
});
outliner?.addEventListener("click", (event) => { const id = referenceIdFromRow(event.target); if (id) { pinnedReferenceId = id; renderReference(id); } });
editor.on("changed", () => { if (pinnedReferenceId) renderReference(pinnedReferenceId); });

Object.assign(window.tinkerMatt, {
  getSemanticReferences: () => allSemanticObjects().map((node) => ({ objectId: getMeta(node)?.id, objectName: getMeta(node)?.name, references: structuredClone(getMeta(node)?.references ?? []) })).filter((entry) => entry.references.length),
  selectSemanticReference: (id: string) => { pinnedReferenceId = id; renderReference(id); return findReference(id)?.reference ?? null; },
});

setStatus("TinkerMatt v0.5.9 · primitivas paramétricas completas + caras semánticas coplanares.");
