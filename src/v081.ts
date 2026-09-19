import * as THREE from "three";
import "./v080";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV079PointerDownOverride?: (event: PointerEvent) => boolean;
    __tmV079KeydownOverride?: (event: KeyboardEvent) => boolean;
    __tmV081ToolbarClickOverride?: (event: MouseEvent) => boolean;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type TransformKind = "move" | "rotate" | "scale";
type TransformParams = { move: THREE.Vector3; angle: number; ratio: number };
type WeldGroup = { id: number; indices: number[]; startLocal: THREE.Vector3 };
type TriangleRef = {
  id: number;
  raw: [number, number, number];
  baselineArea2: number;
  baselineBox: THREE.Box3;
};
type SafeFaceModal = {
  kind: TransformKind;
  axis: Axis | null;
  centerWorld: THREE.Vector3;
  centerClient: THREE.Vector2;
  startPointer: THREE.Vector2;
  startAngle: number;
  startRadius: number;
  positions: Float32Array;
  meshWorld: THREE.Matrix4;
  meshWorldInverse: THREE.Matrix4;
  diagonal: number;
  perimeterTolerance: number;
  movedIndices: Set<number>;
  movedGroups: WeldGroup[];
  rawToGroup: Map<number, number>;
  triangles: TriangleRef[];
  affectedTriangles: TriangleRef[];
  staticTriangles: TriangleRef[];
  lastValid: TransformParams;
  lastBlockedReason: string | null;
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.1 no pudo acceder al editor.");
const rawEditor = editor as any;
const canvas = editor.renderer.domElement;
const version = document.querySelector<HTMLElement>(".version");
const status = document.querySelector<HTMLElement>("#status");
const modalBadge = document.querySelector<HTMLElement>(".tm-modal-badge");
const inEditMode = () => document.documentElement.classList.contains("tm-edit-mode");
const setStatus = (text: string) => { if (status) status.textContent = text; };
const applyVersion = () => { if (version) version.textContent = "v0.8.1"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

let safeModal: SafeFaceModal | null = null;
let lastPointer = new THREE.Vector2();
let lastGuardReason = "";

function rawIndex(geometry: THREE.BufferGeometry, triangle: number, corner: number) {
  const item = triangle * 3 + corner;
  return geometry.index ? geometry.index.getX(item) : item;
}

function pointFromArray(array: Float32Array, index: number) {
  return new THREE.Vector3(array[index * 3], array[index * 3 + 1], array[index * 3 + 2]);
}

function currentFaceSelection() {
  const selection = window.tinkerMatt?.getEditSelection?.();
  if (!selection || selection.mode !== "face" || !Array.isArray(selection.ids)) return [] as string[];
  return selection.ids.filter((id: unknown): id is string => typeof id === "string" && id.startsWith("f:"));
}

function faceTriangleIndices(faceIds: string[]) {
  const result = new Set<number>();
  for (const id of faceIds) {
    for (const part of id.slice(2).split(".")) {
      const value = Number(part);
      if (Number.isInteger(value) && value >= 0) result.add(value);
    }
  }
  return result;
}

function segmentDistance3D(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-18) return point.distanceTo(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lenSq, 0, 1);
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}

function buildPerimeterClosure(mesh: THREE.Mesh, faceIds: string[], positions: Float32Array) {
  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const diagonal = Math.max(1, geometry.boundingBox?.getSize(new THREE.Vector3()).length() ?? 1);
  const faceWeldTolerance = THREE.MathUtils.clamp(diagonal * 2e-5, 1e-5, 0.01);
  const perimeterTolerance = THREE.MathUtils.clamp(diagonal * 5e-4, 0.002, 0.1);
  const triangles = faceTriangleIndices(faceIds);
  const selectedRaw = new Set<number>();

  type LocalGroup = { id: number; point: THREE.Vector3; indices: number[] };
  const groups: LocalGroup[] = [];
  const buckets = new Map<string, LocalGroup[]>();
  const rawToGroup = new Map<number, LocalGroup>();
  const cell = faceWeldTolerance;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const groupRaw = (index: number) => {
    const existing = rawToGroup.get(index);
    if (existing) return existing;
    const point = pointFromArray(positions, index);
    const cx = Math.floor(point.x / cell), cy = Math.floor(point.y / cell), cz = Math.floor(point.z / cell);
    let group: LocalGroup | null = null;
    for (let dx = -1; dx <= 1 && !group; dx += 1) for (let dy = -1; dy <= 1 && !group; dy += 1) for (let dz = -1; dz <= 1 && !group; dz += 1) {
      for (const candidate of buckets.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
        if (candidate.point.distanceToSquared(point) <= faceWeldTolerance * faceWeldTolerance) { group = candidate; break; }
      }
    }
    if (!group) {
      group = { id: groups.length, point: point.clone(), indices: [] };
      groups.push(group);
      const bucketKey = key(cx, cy, cz);
      const list = buckets.get(bucketKey) ?? [];
      list.push(group);
      buckets.set(bucketKey, list);
    }
    group.indices.push(index);
    rawToGroup.set(index, group);
    return group;
  };

  const edgeCounts = new Map<string, { a: LocalGroup; b: LocalGroup; count: number }>();
  for (const tri of triangles) {
    const raw = [rawIndex(geometry, tri, 0), rawIndex(geometry, tri, 1), rawIndex(geometry, tri, 2)] as const;
    raw.forEach((index) => selectedRaw.add(index));
    const grouped = raw.map(groupRaw) as [LocalGroup, LocalGroup, LocalGroup];
    for (let i = 0; i < 3; i += 1) {
      const a = grouped[i], b = grouped[(i + 1) % 3];
      if (a.id === b.id) continue;
      const id = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      const existing = edgeCounts.get(id);
      if (existing) existing.count += 1;
      else edgeCounts.set(id, { a, b, count: 1 });
    }
  }

  for (const group of groups) {
    const average = new THREE.Vector3();
    for (const index of group.indices) average.add(pointFromArray(positions, index));
    if (group.indices.length) group.point.copy(average.multiplyScalar(1 / group.indices.length));
  }

  const boundary: Array<{ a: THREE.Vector3; b: THREE.Vector3 }> = [];
  for (const edge of edgeCounts.values()) if (edge.count === 1) boundary.push({ a: edge.a.point.clone(), b: edge.b.point.clone() });

  const expanded = new Set<number>(selectedRaw);
  if (boundary.length) {
    for (let index = 0; index < positions.length / 3; index += 1) {
      if (expanded.has(index)) continue;
      const p = pointFromArray(positions, index);
      for (const segment of boundary) {
        if (p.x < Math.min(segment.a.x, segment.b.x) - perimeterTolerance || p.x > Math.max(segment.a.x, segment.b.x) + perimeterTolerance) continue;
        if (p.y < Math.min(segment.a.y, segment.b.y) - perimeterTolerance || p.y > Math.max(segment.a.y, segment.b.y) + perimeterTolerance) continue;
        if (p.z < Math.min(segment.a.z, segment.b.z) - perimeterTolerance || p.z > Math.max(segment.a.z, segment.b.z) + perimeterTolerance) continue;
        if (segmentDistance3D(p, segment.a, segment.b) <= perimeterTolerance) { expanded.add(index); break; }
      }
    }
  }
  return { indices: expanded, diagonal, perimeterTolerance };
}

function buildStrongWeldGroups(positions: Float32Array, diagonal: number) {
  const tolerance = THREE.MathUtils.clamp(diagonal * 2e-5, 1e-5, 0.01);
  type Group = { id: number; indices: number[]; sum: THREE.Vector3; center: THREE.Vector3 };
  const groups: Group[] = [];
  const rawToGroup = new Map<number, number>();
  const buckets = new Map<string, number[]>();
  const cell = tolerance;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  for (let index = 0; index < positions.length / 3; index += 1) {
    const p = pointFromArray(positions, index);
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    let groupId = -1;
    for (let dx = -1; dx <= 1 && groupId < 0; dx += 1) for (let dy = -1; dy <= 1 && groupId < 0; dy += 1) for (let dz = -1; dz <= 1 && groupId < 0; dz += 1) {
      for (const candidateId of buckets.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
        if (groups[candidateId].center.distanceToSquared(p) <= tolerance * tolerance) { groupId = candidateId; break; }
      }
    }
    if (groupId < 0) {
      groupId = groups.length;
      groups.push({ id: groupId, indices: [], sum: new THREE.Vector3(), center: p.clone() });
      const bucketKey = key(cx, cy, cz);
      const list = buckets.get(bucketKey) ?? [];
      list.push(groupId);
      buckets.set(bucketKey, list);
    }
    const group = groups[groupId];
    group.indices.push(index);
    group.sum.add(p);
    group.center.copy(group.sum).multiplyScalar(1 / group.indices.length);
    rawToGroup.set(index, groupId);
  }

  return { groups, rawToGroup, tolerance };
}

function buildTriangles(mesh: THREE.Mesh, positions: Float32Array) {
  const geometry = mesh.geometry;
  const count = geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(positions.length / 9);
  const triangles: TriangleRef[] = [];
  for (let id = 0; id < count; id += 1) {
    const raw = [rawIndex(geometry, id, 0), rawIndex(geometry, id, 1), rawIndex(geometry, id, 2)] as [number, number, number];
    const a = pointFromArray(positions, raw[0]), b = pointFromArray(positions, raw[1]), c = pointFromArray(positions, raw[2]);
    const cross = b.clone().sub(a).cross(c.clone().sub(a));
    triangles.push({ id, raw, baselineArea2: cross.length(), baselineBox: new THREE.Box3().setFromPoints([a, b, c]) });
  }
  return triangles;
}

function projectWorld(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const projected = point.clone().project(editor.camera);
  return new THREE.Vector2(rect.left + (projected.x * .5 + .5) * rect.width, rect.top + (-projected.y * .5 + .5) * rect.height);
}

function axisVector(axis: Axis) {
  return axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}

function pointerScalar(dx: number, dy: number, direction: THREE.Vector3, origin: THREE.Vector3) {
  const a = projectWorld(origin), b = projectWorld(origin.clone().add(direction)), v = b.sub(a), lenSq = v.lengthSq();
  return lenSq < 1e-8 ? 0 : (dx * v.x + dy * v.y) / lenSq;
}

function rayToPlane(clientX: number, clientY: number, center: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, editor.camera);
  const normal = editor.camera.getWorldDirection(new THREE.Vector3());
  return ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), new THREE.Vector3());
}

function identityParams(): TransformParams {
  return { move: new THREE.Vector3(), angle: 0, ratio: 1 };
}

function interpolateParams(a: TransformParams, b: TransformParams, t: number): TransformParams {
  return { move: a.move.clone().lerp(b.move, t), angle: THREE.MathUtils.lerp(a.angle, b.angle, t), ratio: THREE.MathUtils.lerp(a.ratio, b.ratio, t) };
}

function paramsForPointer(modal: SafeFaceModal, clientX: number, clientY: number, shift: boolean, alt: boolean) {
  const result = identityParams();
  const snap = editor.getSnap();
  const snapStep = snap.enabled ? snap.gridSize * (alt ? .1 : shift ? 10 : 1) : 0;
  if (modal.kind === "move") {
    if (modal.axis) {
      let amount = pointerScalar(clientX - modal.startPointer.x, clientY - modal.startPointer.y, axisVector(modal.axis), modal.centerWorld);
      if (snapStep > 0) amount = Math.round(amount / snapStep) * snapStep;
      result.move.copy(axisVector(modal.axis)).multiplyScalar(amount);
    } else {
      const a = rayToPlane(modal.startPointer.x, modal.startPointer.y, modal.centerWorld);
      const b = rayToPlane(clientX, clientY, modal.centerWorld);
      if (a && b) result.move.copy(b).sub(a);
    }
  } else if (modal.kind === "rotate") {
    const current = Math.atan2(clientY - modal.centerClient.y, clientX - modal.centerClient.x);
    result.angle = current - modal.startAngle;
    const step = shift ? 15 : alt ? .5 : 1;
    result.angle = THREE.MathUtils.degToRad(Math.round(THREE.MathUtils.radToDeg(result.angle) / step) * step);
  } else {
    result.ratio = Math.max(.01, new THREE.Vector2(clientX, clientY).distanceTo(modal.centerClient) / modal.startRadius);
    if (shift) result.ratio = Math.round(result.ratio * 10) / 10;
  }
  return result;
}

function buildCandidate(modal: SafeFaceModal, params: TransformParams) {
  const candidate = new Map<number, THREE.Vector3>();
  const rotation = new THREE.Quaternion().setFromAxisAngle(axisVector(modal.axis ?? "z"), params.angle);
  for (const group of modal.movedGroups) {
    const world = group.startLocal.clone().applyMatrix4(modal.meshWorld);
    if (modal.kind === "move") world.add(params.move);
    else if (modal.kind === "rotate") world.sub(modal.centerWorld).applyQuaternion(rotation).add(modal.centerWorld);
    else {
      const relative = world.sub(modal.centerWorld);
      if (modal.axis) relative[modal.axis] *= params.ratio;
      else relative.multiplyScalar(params.ratio);
      world.copy(relative.add(modal.centerWorld));
    }
    const local = world.applyMatrix4(modal.meshWorldInverse);
    for (const index of group.indices) candidate.set(index, local.clone());
  }
  return candidate;
}

function candidatePoint(modal: SafeFaceModal, candidate: Map<number, THREE.Vector3>, index: number) {
  return candidate.get(index)?.clone() ?? pointFromArray(modal.positions, index);
}

function boxesIntersect(a: THREE.Box3, b: THREE.Box3, epsilon: number) {
  return a.max.x + epsilon >= b.min.x && a.min.x - epsilon <= b.max.x && a.max.y + epsilon >= b.min.y && a.min.y - epsilon <= b.max.y && a.max.z + epsilon >= b.min.z && a.min.z - epsilon <= b.max.z;
}

function segmentTriangleHit(p0: THREE.Vector3, p1: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, epsilon: number) {
  const dir = p1.clone().sub(p0);
  const e1 = b.clone().sub(a), e2 = c.clone().sub(a);
  const h = dir.clone().cross(e2);
  const det = e1.dot(h);
  if (Math.abs(det) <= epsilon) return false;
  const inv = 1 / det;
  const s = p0.clone().sub(a);
  const u = inv * s.dot(h);
  if (u < -epsilon || u > 1 + epsilon) return false;
  const q = s.clone().cross(e1);
  const v = inv * dir.dot(q);
  if (v < -epsilon || u + v > 1 + epsilon) return false;
  const t = inv * e2.dot(q);
  return t > epsilon && t < 1 - epsilon;
}

function project2D(p: THREE.Vector3, drop: 0 | 1 | 2) {
  return drop === 0 ? new THREE.Vector2(p.y, p.z) : drop === 1 ? new THREE.Vector2(p.x, p.z) : new THREE.Vector2(p.x, p.y);
}

function orient2D(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect2D(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, d: THREE.Vector2, epsilon: number) {
  const o1 = orient2D(a, b, c), o2 = orient2D(a, b, d), o3 = orient2D(c, d, a), o4 = orient2D(c, d, b);
  return ((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon)) && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon));
}

function pointInTri2D(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, epsilon: number) {
  const o1 = orient2D(a, b, p), o2 = orient2D(b, c, p), o3 = orient2D(c, a, p);
  const neg = o1 < -epsilon || o2 < -epsilon || o3 < -epsilon;
  const pos = o1 > epsilon || o2 > epsilon || o3 > epsilon;
  return !(neg && pos);
}

function coplanarTrianglesOverlap(a: [THREE.Vector3, THREE.Vector3, THREE.Vector3], b: [THREE.Vector3, THREE.Vector3, THREE.Vector3], epsilon: number) {
  const normal = a[1].clone().sub(a[0]).cross(a[2].clone().sub(a[0]));
  const abs = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const drop = (abs[0] > abs[1] && abs[0] > abs[2] ? 0 : abs[1] > abs[2] ? 1 : 2) as 0 | 1 | 2;
  const aa = a.map((p) => project2D(p, drop)) as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
  const bb = b.map((p) => project2D(p, drop)) as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) if (segmentsIntersect2D(aa[i], aa[(i + 1) % 3], bb[j], bb[(j + 1) % 3], epsilon)) return true;
  return pointInTri2D(aa[0], bb[0], bb[1], bb[2], epsilon) || pointInTri2D(bb[0], aa[0], aa[1], aa[2], epsilon);
}

function trianglesIntersect(a: [THREE.Vector3, THREE.Vector3, THREE.Vector3], b: [THREE.Vector3, THREE.Vector3, THREE.Vector3], epsilon: number) {
  for (let i = 0; i < 3; i += 1) if (segmentTriangleHit(a[i], a[(i + 1) % 3], b[0], b[1], b[2], epsilon)) return true;
  for (let i = 0; i < 3; i += 1) if (segmentTriangleHit(b[i], b[(i + 1) % 3], a[0], a[1], a[2], epsilon)) return true;
  const na = a[1].clone().sub(a[0]).cross(a[2].clone().sub(a[0]));
  const nb = b[1].clone().sub(b[0]).cross(b[2].clone().sub(b[0]));
  if (na.lengthSq() < epsilon * epsilon || nb.lengthSq() < epsilon * epsilon) return false;
  na.normalize(); nb.normalize();
  if (Math.abs(na.dot(nb)) > .99999 && Math.abs(na.dot(b[0].clone().sub(a[0]))) <= epsilon * 4) return coplanarTrianglesOverlap(a, b, epsilon);
  return false;
}

function trianglePoints(modal: SafeFaceModal, triangle: TriangleRef, candidate: Map<number, THREE.Vector3>) {
  return triangle.raw.map((index) => candidatePoint(modal, candidate, index)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

function baselineTrianglePoints(modal: SafeFaceModal, triangle: TriangleRef) {
  return triangle.raw.map((index) => pointFromArray(modal.positions, index)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

function trianglesAreNeighbors(modal: SafeFaceModal, a: TriangleRef, b: TriangleRef) {
  for (const ia of a.raw) for (const ib of b.raw) {
    if (ia === ib) return true;
    const ga = modal.rawToGroup.get(ia), gb = modal.rawToGroup.get(ib);
    if (ga != null && ga === gb) return true;
    if (pointFromArray(modal.positions, ia).distanceTo(pointFromArray(modal.positions, ib)) <= modal.perimeterTolerance) return true;
  }
  return false;
}

function validateCandidate(modal: SafeFaceModal, candidate: Map<number, THREE.Vector3>) {
  const areaFloor = Math.max(1e-10, modal.diagonal * modal.diagonal * 1e-10);
  for (const tri of modal.affectedTriangles) {
    const [a, b, c] = trianglePoints(modal, tri, candidate);
    const area2 = b.clone().sub(a).cross(c.clone().sub(a)).length();
    const minimum = Math.max(areaFloor, tri.baselineArea2 * 1e-4);
    if (!Number.isFinite(area2) || area2 <= minimum) return { ok: false, reason: "triángulo degenerado / normal a punto de invertirse" };
  }

  const epsilon = Math.max(1e-7, modal.diagonal * 1e-8);
  for (const moving of modal.affectedTriangles) {
    const movingPoints = trianglePoints(modal, moving, candidate);
    const movingBox = new THREE.Box3().setFromPoints(movingPoints);
    for (const fixed of modal.staticTriangles) {
      if (trianglesAreNeighbors(modal, moving, fixed)) continue;
      if (!boxesIntersect(movingBox, fixed.baselineBox, epsilon)) continue;
      const fixedPoints = baselineTrianglePoints(modal, fixed);
      if (!trianglesIntersect(movingPoints, fixedPoints, epsilon)) continue;
      const baselineMoving = baselineTrianglePoints(modal, moving);
      if (trianglesIntersect(baselineMoving, fixedPoints, epsilon)) continue;
      return { ok: false, reason: "auto-colisión" };
    }
  }

  const affected = modal.affectedTriangles;
  for (let i = 0; i < affected.length; i += 1) {
    const aRef = affected[i], aPoints = trianglePoints(modal, aRef, candidate), aBox = new THREE.Box3().setFromPoints(aPoints);
    for (let j = i + 1; j < affected.length; j += 1) {
      const bRef = affected[j];
      if (trianglesAreNeighbors(modal, aRef, bRef)) continue;
      const bPoints = trianglePoints(modal, bRef, candidate), bBox = new THREE.Box3().setFromPoints(bPoints);
      if (!boxesIntersect(aBox, bBox, epsilon) || !trianglesIntersect(aPoints, bPoints, epsilon)) continue;
      const baseA = baselineTrianglePoints(modal, aRef), baseB = baselineTrianglePoints(modal, bRef);
      if (trianglesIntersect(baseA, baseB, epsilon)) continue;
      return { ok: false, reason: "auto-colisión interna" };
    }
  }
  return { ok: true, reason: "" };
}

function writeCandidate(mesh: THREE.Mesh, candidate: Map<number, THREE.Vector3>) {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (const [index, p] of candidate) position.setXYZ(index, p.x, p.y, p.z);
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

function restoreStart(mesh: THREE.Mesh, modal: SafeFaceModal) {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (const index of modal.movedIndices) {
    position.setXYZ(index, modal.positions[index * 3], modal.positions[index * 3 + 1], modal.positions[index * 3 + 2]);
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

function stepCount(modal: SafeFaceModal, a: TransformParams, b: TransformParams) {
  if (modal.kind === "move") return THREE.MathUtils.clamp(Math.ceil(a.move.distanceTo(b.move) / Math.max(.05, modal.diagonal * .01)), 1, 24);
  if (modal.kind === "rotate") return THREE.MathUtils.clamp(Math.ceil(Math.abs(a.angle - b.angle) / THREE.MathUtils.degToRad(3)), 1, 24);
  return THREE.MathUtils.clamp(Math.ceil(Math.abs(a.ratio - b.ratio) / .03), 1, 24);
}

function applySafely(mesh: THREE.Mesh, modal: SafeFaceModal, requested: TransformParams) {
  const start = modal.lastValid;
  const steps = stepCount(modal, start, requested);
  let best = start;
  let bestCandidate = buildCandidate(modal, start);
  let blocked: string | null = null;

  for (let step = 1; step <= steps; step += 1) {
    const trial = interpolateParams(start, requested, step / steps);
    const candidate = buildCandidate(modal, trial);
    const validation = validateCandidate(modal, candidate);
    if (validation.ok) {
      best = trial;
      bestCandidate = candidate;
      continue;
    }
    blocked = validation.reason;
    const previous = best;
    let low = previous, high = trial;
    for (let i = 0; i < 7; i += 1) {
      const middle = interpolateParams(low, high, .5);
      const middleCandidate = buildCandidate(modal, middle);
      if (validateCandidate(modal, middleCandidate).ok) { low = middle; best = middle; bestCandidate = middleCandidate; }
      else high = middle;
    }
    break;
  }

  modal.lastValid = best;
  modal.lastBlockedReason = blocked;
  writeCandidate(mesh, bestCandidate);
  return blocked;
}

function beginSafeFaceModal(kind: TransformKind) {
  if (!inEditMode() || safeModal) return false;
  const faceIds = currentFaceSelection();
  const mesh = editor.activeObject();
  if (!(mesh instanceof THREE.Mesh) || !faceIds.length || !mesh.geometry?.getAttribute("position")) return false;

  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const positions = new Float32Array(position.array as ArrayLike<number>);
  const closure = buildPerimeterClosure(mesh, faceIds, positions);
  const weld = buildStrongWeldGroups(positions, closure.diagonal);
  const movedGroupIds = new Set<number>();
  closure.indices.forEach((index) => { const group = weld.rawToGroup.get(index); if (group != null) movedGroupIds.add(group); });
  const movedGroups: WeldGroup[] = [];
  const movedIndices = new Set<number>();
  for (const groupId of movedGroupIds) {
    const source = weld.groups[groupId];
    source.indices.forEach((index) => movedIndices.add(index));
    movedGroups.push({ id: groupId, indices: [...source.indices], startLocal: source.center.clone() });
  }
  if (!movedIndices.size) return false;

  mesh.updateMatrixWorld(true);
  const worldBox = new THREE.Box3();
  for (const group of movedGroups) worldBox.expandByPoint(group.startLocal.clone().applyMatrix4(mesh.matrixWorld));
  if (worldBox.isEmpty()) return false;
  const centerWorld = worldBox.getCenter(new THREE.Vector3());
  const centerClient = projectWorld(centerWorld);
  const pointer = lastPointer.lengthSq() ? lastPointer.clone() : centerClient.clone().add(new THREE.Vector2(90, 0));
  const triangles = buildTriangles(mesh, positions);
  const affectedTriangles = triangles.filter((tri) => tri.raw.some((index) => movedIndices.has(index)));
  const affectedIds = new Set(affectedTriangles.map((tri) => tri.id));
  const staticTriangles = triangles.filter((tri) => !affectedIds.has(tri.id));

  editor.checkpoint();
  safeModal = {
    kind,
    axis: null,
    centerWorld,
    centerClient,
    startPointer: pointer,
    startAngle: Math.atan2(pointer.y - centerClient.y, pointer.x - centerClient.x),
    startRadius: Math.max(12, pointer.distanceTo(centerClient)),
    positions,
    meshWorld: mesh.matrixWorld.clone(),
    meshWorldInverse: mesh.matrixWorld.clone().invert(),
    diagonal: closure.diagonal,
    perimeterTolerance: closure.perimeterTolerance,
    movedIndices,
    movedGroups,
    rawToGroup: weld.rawToGroup,
    triangles,
    affectedTriangles,
    staticTriangles,
    lastValid: identityParams(),
    lastBlockedReason: null,
  };
  modalBadge?.classList.remove("hidden");
  setStatus(`Edición protegida · ${movedGroups.length} vértices soldados · ${affectedTriangles.length} triángulos vigilados.`);
  updateSafeModal(pointer.x, pointer.y, false, false);
  return true;
}

function updateSafeModal(clientX: number, clientY: number, shift: boolean, alt: boolean) {
  const modal = safeModal;
  const mesh = editor.activeObject();
  if (!modal || !(mesh instanceof THREE.Mesh)) return;
  const requested = paramsForPointer(modal, clientX, clientY, shift, alt);
  const blocked = applySafely(mesh, modal, requested);
  if (blocked) {
    lastGuardReason = blocked;
    setStatus(`Límite geométrico: ${blocked}. No se permite romper el sólido.`);
  }
  if (modalBadge) {
    const label = modal.kind === "move" ? "MOVER CARA" : modal.kind === "rotate" ? "ROTAR CARA" : "ESCALAR CARA";
    modalBadge.textContent = blocked
      ? `${label}${modal.axis ? ` · ${modal.axis.toUpperCase()}` : ""} · ⛔ ${blocked.toUpperCase()} · límite alcanzado`
      : `${label}${modal.axis ? ` · ${modal.axis.toUpperCase()}` : ""} · malla protegida · click/Enter confirma · Esc cancela`;
  }
}

function finishSafeModal(cancel: boolean) {
  const modal = safeModal;
  const mesh = editor.activeObject();
  if (!modal) return;
  if (cancel && mesh instanceof THREE.Mesh) restoreStart(mesh, modal);
  safeModal = null;
  modalBadge?.classList.add("hidden");
  rawEditor.emit?.("changed");
  queueMicrotask(() => window.tinkerMatt?.rebuildEditTopology?.());
  setStatus(cancel ? "Transformación protegida cancelada." : `Transformación válida confirmada${lastGuardReason ? ` · se frenó antes de ${lastGuardReason}` : ""}.`);
  lastGuardReason = "";
}

const previousPointerOverride = window.__tmV079PointerDownOverride;
window.__tmV079PointerDownOverride = (event) => {
  if (safeModal && inEditMode() && event.button === 0) { finishSafeModal(false); return true; }
  return previousPointerOverride?.(event) ?? false;
};

const previousKeyOverride = window.__tmV079KeydownOverride;
window.__tmV079KeydownOverride = (event) => {
  if (!inEditMode()) return previousKeyOverride?.(event) ?? false;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return previousKeyOverride?.(event) ?? false;
  const key = event.key.toLowerCase();
  if (safeModal) {
    if (key === "x" || key === "y" || key === "z") {
      const mesh = editor.activeObject();
      if (mesh instanceof THREE.Mesh) restoreStart(mesh, safeModal);
      safeModal.axis = safeModal.axis === key ? null : key;
      safeModal.lastValid = identityParams();
      safeModal.lastBlockedReason = null;
      updateSafeModal(lastPointer.x, lastPointer.y, event.shiftKey, event.altKey);
      return true;
    }
    if (event.key === "Escape") { finishSafeModal(true); return true; }
    if (event.key === "Enter") { finishSafeModal(false); return true; }
    if (key === "m" || key === "g" || key === "r" || key === "s") return true;
    return previousKeyOverride?.(event) ?? false;
  }
  if (currentFaceSelection().length && (key === "m" || key === "g" || key === "r" || key === "s")) {
    beginSafeFaceModal(key === "r" ? "rotate" : key === "s" ? "scale" : "move");
    return true;
  }
  return previousKeyOverride?.(event) ?? false;
};

window.__tmV081ToolbarClickOverride = (event) => {
  if (!inEditMode() || safeModal || !currentFaceSelection().length) return false;
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>(".tm-edit-toolbar [data-edit-transform]");
  if (!button) return false;
  const value = button.dataset.editTransform;
  beginSafeFaceModal(value === "rotate" ? "rotate" : value === "scale" ? "scale" : "move");
  return true;
};

window.addEventListener("pointermove", (event) => {
  lastPointer.set(event.clientX, event.clientY);
  if (safeModal) updateSafeModal(event.clientX, event.clientY, event.shiftKey, event.altKey);
}, true);

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  topologyGuardVersion: "0.8.1",
  isGeometryGuardActive: () => Boolean(safeModal),
  getGeometryGuardReason: () => safeModal?.lastBlockedReason ?? null,
});

setStatus("TinkerMatt v0.8.1 · caras soldadas + límite por degeneración y auto-colisión.");
