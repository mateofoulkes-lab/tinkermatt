import * as THREE from "three";
import "./v079";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV079PointerDownOverride?: (event: PointerEvent) => boolean;
    __tmV079KeydownOverride?: (event: KeyboardEvent) => boolean;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type TransformKind = "move" | "rotate" | "scale";
type BoundarySegment = { a: THREE.Vector3; b: THREE.Vector3 };
type FaceModal = {
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
if (!editor) throw new Error("TinkerMatt v0.8.0 no pudo acceder al editor.");
const rawEditor = editor as any;
const canvas = editor.renderer.domElement;
const version = document.querySelector<HTMLElement>(".version");
const status = document.querySelector<HTMLElement>("#status");
const modalBadge = document.querySelector<HTMLElement>(".tm-modal-badge");
const inEditMode = () => document.documentElement.classList.contains("tm-edit-mode");
const setStatus = (text: string) => { if (status) status.textContent = text; };
const applyVersion = () => { if (version) version.textContent = "v0.8.0"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

let faceModal: FaceModal | null = null;
let lastPointer = new THREE.Vector2();
let lastPerimeterTolerance = 0;

function rawIndex(geometry: THREE.BufferGeometry, triangle: number, corner: number) {
  const item = triangle * 3 + corner;
  return geometry.index ? geometry.index.getX(item) : item;
}

function faceTriangleIndices(faceIds: string[]) {
  const result = new Set<number>();
  for (const id of faceIds) {
    if (!id.startsWith("f:")) continue;
    for (const part of id.slice(2).split(".")) {
      const value = Number(part);
      if (Number.isInteger(value) && value >= 0) result.add(value);
    }
  }
  return result;
}

function pointAt(position: THREE.BufferAttribute, index: number) {
  return new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
}

function segmentDistance3D(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-18) return point.distanceTo(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lenSq, 0, 1);
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}

function buildFacePerimeterClosure(mesh: THREE.Mesh, faceIds: string[]) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  geometry.computeBoundingBox();
  const diagonal = Math.max(1, geometry.boundingBox?.getSize(new THREE.Vector3()).length() ?? 1);
  const faceWeldTolerance = Math.max(1e-5, diagonal * 2e-5);
  // This tolerance is intentionally larger than the global vertex weld. It only
  // operates around already-confirmed face boundary segments, so it can absorb
  // tiny CSG cracks without merging unrelated interior topology.
  const perimeterTolerance = THREE.MathUtils.clamp(diagonal * 5e-4, 0.002, 0.1);
  lastPerimeterTolerance = perimeterTolerance;
  const triangles = faceTriangleIndices(faceIds);
  const selectedRaw = new Set<number>();

  type Group = { id: number; point: THREE.Vector3; indices: number[] };
  const groups: Group[] = [];
  const rawToGroup = new Map<number, Group>();
  const cell = faceWeldTolerance;
  const buckets = new Map<string, Group[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  const groupRaw = (index: number) => {
    const existing = rawToGroup.get(index);
    if (existing) return existing;
    const point = pointAt(position, index);
    const cx = Math.floor(point.x / cell), cy = Math.floor(point.y / cell), cz = Math.floor(point.z / cell);
    let group: Group | null = null;
    for (let dx = -1; dx <= 1 && !group; dx += 1) {
      for (let dy = -1; dy <= 1 && !group; dy += 1) {
        for (let dz = -1; dz <= 1 && !group; dz += 1) {
          for (const candidate of buckets.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
            if (candidate.point.distanceToSquared(point) <= faceWeldTolerance * faceWeldTolerance) {
              group = candidate;
              break;
            }
          }
        }
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

  const edgeCounts = new Map<string, { a: Group; b: Group; count: number }>();
  for (const tri of triangles) {
    const raw = [rawIndex(geometry, tri, 0), rawIndex(geometry, tri, 1), rawIndex(geometry, tri, 2)] as const;
    raw.forEach((index) => selectedRaw.add(index));
    const grouped = raw.map(groupRaw) as [Group, Group, Group];
    for (let i = 0; i < 3; i += 1) {
      const a = grouped[i], b = grouped[(i + 1) % 3];
      if (a.id === b.id) continue;
      const edgeId = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      const current = edgeCounts.get(edgeId);
      if (current) current.count += 1;
      else edgeCounts.set(edgeId, { a, b, count: 1 });
    }
  }

  // Recompute group centers after all selected triangle vertices have joined.
  for (const group of groups) {
    const average = new THREE.Vector3();
    for (const index of group.indices) average.add(pointAt(position, index));
    if (group.indices.length) group.point.copy(average.multiplyScalar(1 / group.indices.length));
  }

  const boundarySegments: BoundarySegment[] = [];
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue;
    boundarySegments.push({ a: edge.a.point.clone(), b: edge.b.point.clone() });
  }

  const expanded = new Set<number>(selectedRaw);
  if (boundarySegments.length) {
    const toleranceSq = perimeterTolerance * perimeterTolerance;
    for (let index = 0; index < position.count; index += 1) {
      if (expanded.has(index)) continue;
      const point = pointAt(position, index);
      for (const segment of boundarySegments) {
        // Fast endpoint rejection before the exact point-to-segment distance.
        const minX = Math.min(segment.a.x, segment.b.x) - perimeterTolerance;
        const maxX = Math.max(segment.a.x, segment.b.x) + perimeterTolerance;
        const minY = Math.min(segment.a.y, segment.b.y) - perimeterTolerance;
        const maxY = Math.max(segment.a.y, segment.b.y) + perimeterTolerance;
        const minZ = Math.min(segment.a.z, segment.b.z) - perimeterTolerance;
        const maxZ = Math.max(segment.a.z, segment.b.z) + perimeterTolerance;
        if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY || point.z < minZ || point.z > maxZ) continue;
        const distance = segmentDistance3D(point, segment.a, segment.b);
        if (distance * distance <= toleranceSq) {
          expanded.add(index);
          break;
        }
      }
    }
  }

  return { indices: expanded, boundarySegments, perimeterTolerance };
}

function projectWorld(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const projected = point.clone().project(editor.camera);
  return new THREE.Vector2(
    rect.left + (projected.x * .5 + .5) * rect.width,
    rect.top + (-projected.y * .5 + .5) * rect.height,
  );
}

function axisVector(axis: Axis) {
  return axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}

function pointerScalar(dx: number, dy: number, direction: THREE.Vector3, origin: THREE.Vector3) {
  const a = projectWorld(origin);
  const b = projectWorld(origin.clone().add(direction));
  const vector = b.sub(a);
  const lenSq = vector.lengthSq();
  return lenSq < 1e-8 ? 0 : (dx * vector.x + dy * vector.y) / lenSq;
}

function rayToPlane(clientX: number, clientY: number, center: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, editor.camera);
  const normal = editor.camera.getWorldDirection(new THREE.Vector3());
  return ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), new THREE.Vector3());
}

function currentFaceSelection() {
  const selection = window.tinkerMatt?.getEditSelection?.();
  if (!selection || selection.mode !== "face" || !Array.isArray(selection.ids)) return [] as string[];
  return selection.ids.filter((id: unknown): id is string => typeof id === "string");
}

function beginFaceModal(kind: TransformKind) {
  if (!inEditMode() || faceModal) return false;
  const faceIds = currentFaceSelection();
  const mesh = editor.activeObject();
  if (!(mesh instanceof THREE.Mesh) || !faceIds.length || !mesh.geometry?.getAttribute("position")) return false;

  const closure = buildFacePerimeterClosure(mesh, faceIds);
  if (!closure.indices.size) return false;
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const index of closure.indices) box.expandByPoint(pointAt(position, index).applyMatrix4(mesh.matrixWorld));
  if (box.isEmpty()) return false;
  const centerWorld = box.getCenter(new THREE.Vector3());
  const centerClient = projectWorld(centerWorld);
  const pointer = lastPointer.lengthSq() ? lastPointer.clone() : centerClient.clone().add(new THREE.Vector2(90, 0));

  editor.checkpoint();
  faceModal = {
    kind,
    axis: null,
    centerWorld,
    centerClient,
    startPointer: pointer,
    startAngle: Math.atan2(pointer.y - centerClient.y, pointer.x - centerClient.x),
    startRadius: Math.max(12, pointer.distanceTo(centerClient)),
    positions: new Float32Array(position.array as ArrayLike<number>),
    rawIndices: closure.indices,
    meshWorld: mesh.matrixWorld.clone(),
    meshWorldInverse: mesh.matrixWorld.clone().invert(),
  };
  modalBadge?.classList.remove("hidden");
  setStatus(`Cara: ${closure.indices.size} índices incluidos · corona de perímetro ${closure.perimeterTolerance.toFixed(4)} mm.`);
  updateFaceModal(pointer.x, pointer.y, false, false);
  return true;
}

function updateFaceModal(clientX: number, clientY: number, shift: boolean, alt: boolean) {
  const modal = faceModal;
  const mesh = editor.activeObject();
  if (!modal || !(mesh instanceof THREE.Mesh)) return;
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const snap = editor.getSnap();
  const snapStep = snap.enabled ? snap.gridSize * (alt ? .1 : shift ? 10 : 1) : 0;
  let moveDelta = new THREE.Vector3();
  let angle = 0;
  let ratio = 1;

  if (modal.kind === "move") {
    if (modal.axis) {
      let amount = pointerScalar(clientX - modal.startPointer.x, clientY - modal.startPointer.y, axisVector(modal.axis), modal.centerWorld);
      if (snapStep > 0) amount = Math.round(amount / snapStep) * snapStep;
      moveDelta.copy(axisVector(modal.axis)).multiplyScalar(amount);
    } else {
      const a = rayToPlane(modal.startPointer.x, modal.startPointer.y, modal.centerWorld);
      const b = rayToPlane(clientX, clientY, modal.centerWorld);
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
    const local = new THREE.Vector3(
      modal.positions[index * 3],
      modal.positions[index * 3 + 1],
      modal.positions[index * 3 + 2],
    );
    const world = local.applyMatrix4(modal.meshWorld);
    if (modal.kind === "move") world.add(moveDelta);
    else if (modal.kind === "rotate") world.sub(modal.centerWorld).applyQuaternion(rotation).add(modal.centerWorld);
    else {
      const relative = world.sub(modal.centerWorld);
      if (modal.axis) relative[modal.axis] *= ratio;
      else relative.multiplyScalar(ratio);
      world.copy(relative.add(modal.centerWorld));
    }
    const nextLocal = world.applyMatrix4(modal.meshWorldInverse);
    position.setXYZ(index, nextLocal.x, nextLocal.y, nextLocal.z);
  }

  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  window.tinkerMatt?.rebuildEditTopology?.();
  if (modalBadge) {
    const label = modal.kind === "move" ? "MOVER CARA" : modal.kind === "rotate" ? "ROTAR CARA" : "ESCALAR CARA";
    modalBadge.textContent = `${label}${modal.axis ? ` · ${modal.axis.toUpperCase()}` : ""} · perímetro tolerante · click/Enter confirma · Esc cancela`;
  }
}

function restoreFaceModal() {
  const modal = faceModal;
  const mesh = editor.activeObject();
  if (!modal || !(mesh instanceof THREE.Mesh)) return;
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (const index of modal.rawIndices) {
    position.setXYZ(index, modal.positions[index * 3], modal.positions[index * 3 + 1], modal.positions[index * 3 + 2]);
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

function finishFaceModal(cancel: boolean) {
  if (!faceModal) return;
  if (cancel) restoreFaceModal();
  faceModal = null;
  modalBadge?.classList.add("hidden");
  rawEditor.emit?.("changed");
  queueMicrotask(() => window.tinkerMatt?.rebuildEditTopology?.());
  setStatus(cancel ? "Transformación de cara cancelada." : `Cara transformada con cierre completo de perímetro (${lastPerimeterTolerance.toFixed(4)} mm).`);
}

const previousPointerOverride = window.__tmV079PointerDownOverride;
window.__tmV079PointerDownOverride = (event) => {
  if (faceModal && inEditMode() && event.button === 0) {
    finishFaceModal(false);
    return true;
  }
  return previousPointerOverride?.(event) ?? false;
};

const previousKeyOverride = window.__tmV079KeydownOverride;
window.__tmV079KeydownOverride = (event) => {
  if (!inEditMode()) return previousKeyOverride?.(event) ?? false;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,textarea,select") || target?.isContentEditable) return previousKeyOverride?.(event) ?? false;
  const key = event.key.toLowerCase();

  if (faceModal) {
    if (key === "x" || key === "y" || key === "z") {
      faceModal.axis = faceModal.axis === key ? null : key;
      updateFaceModal(lastPointer.x, lastPointer.y, event.shiftKey, event.altKey);
      return true;
    }
    if (event.key === "Escape") { finishFaceModal(true); return true; }
    if (event.key === "Enter") { finishFaceModal(false); return true; }
    if (key === "m" || key === "g" || key === "r" || key === "s") return true;
    return previousKeyOverride?.(event) ?? false;
  }

  const faceIds = currentFaceSelection();
  if (faceIds.length && (key === "m" || key === "g" || key === "r" || key === "s")) {
    beginFaceModal(key === "r" ? "rotate" : key === "s" ? "scale" : "move");
    return true;
  }
  return previousKeyOverride?.(event) ?? false;
};

window.addEventListener("pointermove", (event) => {
  lastPointer.set(event.clientX, event.clientY);
  if (faceModal) updateFaceModal(event.clientX, event.clientY, event.shiftKey, event.altKey);
}, true);

// Toolbar transform buttons would otherwise call the v0.7.9 modal directly.
// Capture them first only for face mode so vertex/edge editing remains untouched.
window.addEventListener("click", (event) => {
  if (!inEditMode() || faceModal) return;
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>(".tm-edit-toolbar [data-edit-transform]");
  if (!button || !currentFaceSelection().length) return;
  const value = button.dataset.editTransform;
  event.preventDefault();
  event.stopImmediatePropagation();
  beginFaceModal(value === "rotate" ? "rotate" : value === "scale" ? "scale" : "move");
}, true);

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  facePerimeterClosureVersion: "0.8.0",
  getFacePerimeterTolerance: () => lastPerimeterTolerance,
});

setStatus("TinkerMatt v0.8.0 · caras con cierre tolerante de todos los vértices del perímetro.");
