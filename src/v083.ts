import * as THREE from "three";
import "./v082";
import { cloneWithFreshIds, getMeta, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type Vec3Like = Partial<Record<Axis, number>>;
type BatchOperation = { action: string; args?: Record<string, any> };

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.3 no pudo acceder al editor.");
const rawEditor = editor as any;
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
const setStatus = (text: string) => { if (status) status.textContent = text; };

const applyVersion = () => { if (version) version.textContent = "v0.8.3"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

function allObjects() {
  const objects: THREE.Object3D[] = [];
  for (const root of editor.getSceneRoots()) {
    root.traverse((object) => { if (getMeta(object)) objects.push(object); });
  }
  return objects;
}

function findObject(idOrName: string) {
  return editor.findById(idOrName) ?? allObjects().find((object) => getMeta(object)?.name === idOrName) ?? null;
}

function resolveObjects(refs: string[], label = "objeto") {
  const result: THREE.Object3D[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const object = findObject(ref);
    if (object) result.push(object); else missing.push(ref);
  }
  if (missing.length) throw new Error(`No se encontraron ${label}(s): ${missing.join(", ")}`);
  return [...new Set(result)];
}

function worldBox(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function boxInfo(box: THREE.Box3) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    size: { x: size.x, y: size.y, z: size.z },
    center: { x: center.x, y: center.y, z: center.z },
  };
}

function objectInfo(object: THREE.Object3D | null) {
  if (!object) return null;
  const meta = getMeta(object);
  if (!meta) return null;
  const box = worldBox(object);
  return {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    mode: meta.mode,
    material: meta.material,
    visible: object.visible,
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotationDegrees: {
      x: THREE.MathUtils.radToDeg(object.rotation.x),
      y: THREE.MathUtils.radToDeg(object.rotation.y),
      z: THREE.MathUtils.radToDeg(object.rotation.z),
    },
    bounds: boxInfo(box),
    references: structuredClone(meta.references ?? []),
    params: structuredClone(meta.params ?? {}),
  };
}

function emitChanged() {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
}

function setWorldPosition(object: THREE.Object3D, world: THREE.Vector3) {
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    object.position.copy(object.parent.worldToLocal(world.clone()));
  } else object.position.copy(world);
  object.updateMatrixWorld(true);
}

function setWorldQuaternion(object: THREE.Object3D, world: THREE.Quaternion) {
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
    object.quaternion.copy(parentWorld.invert().multiply(world));
  } else object.quaternion.copy(world);
  object.updateMatrixWorld(true);
}

function clearReferences(root: THREE.Object3D) {
  root.traverse((node) => {
    const meta = getMeta(node);
    if (!meta) return;
    meta.references = [];
    setMeta(node, meta);
  });
}

function renameRoot(root: THREE.Object3D, name: string) {
  const meta = getMeta(root);
  if (!meta || !name.trim()) return;
  meta.name = name.trim();
  setMeta(root, meta);
}

function hasAncestorInSet(object: THREE.Object3D, set: Set<THREE.Object3D>) {
  let current = object.parent;
  while (current && current !== editor.scene) {
    if (set.has(current)) return true;
    current = current.parent;
  }
  return false;
}

function canonicalRoots(objects: THREE.Object3D[]) {
  const set = new Set(objects);
  return objects.filter((object) => !hasAncestorInSet(object, set));
}

// -----------------------------------------------------------------------------
// Transactional history for MCP batches.
// Existing editor methods can keep calling checkpoint(); during a transaction
// only the single checkpoint made at beginTransaction survives.
// -----------------------------------------------------------------------------
const originalCheckpoint = editor.checkpoint.bind(editor);
let transactionDepth = 0;
(editor as any).checkpoint = () => {
  if (transactionDepth > 0) return;
  originalCheckpoint();
};

function beginTransaction() {
  if (transactionDepth !== 0) throw new Error("No se permiten transacciones MCP anidadas.");
  originalCheckpoint();
  transactionDepth = 1;
}

function commitTransaction() {
  transactionDepth = 0;
}

function rollbackTransaction() {
  transactionDepth = 0;
  editor.undo();
}

// -----------------------------------------------------------------------------
// Delete / clear
// -----------------------------------------------------------------------------
function deleteObjects(args: { objects?: string[]; selected?: boolean }) {
  let targets: THREE.Object3D[] = [];
  if (args.selected) targets.push(...editor.getSelection());
  if (args.objects?.length) targets.push(...resolveObjects(args.objects));
  targets = canonicalRoots([...new Set(targets)]);
  if (!targets.length) return { deleted: [], count: 0 };

  editor.checkpoint();
  const before = targets.map(objectInfo).filter(Boolean);
  const targetSet = new Set(targets);
  const remainingSelection = editor.getSelection().filter((object) => !targetSet.has(object) && !hasAncestorInSet(object, targetSet));
  editor.setSelection(remainingSelection);
  targets.forEach((object) => object.removeFromParent());
  emitChanged();
  setStatus(`${targets.length} objeto(s) eliminado(s).`);
  return { deleted: before, count: targets.length };
}

function deleteSelectedRemote() {
  return deleteObjects({ selected: true });
}

function clearScene(args: { except?: string[] } = {}) {
  const keep = canonicalRoots(args.except?.length ? resolveObjects(args.except, "excepción") : []);
  editor.checkpoint();

  // If an explicitly preserved object lives inside a group that is NOT preserved,
  // detach it to scene first while keeping its world transform.
  const keepSet = new Set(keep);
  for (const object of keep) {
    let parent = object.parent;
    let parentKept = false;
    while (parent && parent !== editor.scene) {
      if (keepSet.has(parent)) { parentKept = true; break; }
      parent = parent.parent;
    }
    if (!parentKept && object.parent !== editor.scene) editor.scene.attach(object);
  }

  const rootsToDelete = editor.getSceneRoots().filter((root) => !keepSet.has(root));
  editor.setSelection([]);
  rootsToDelete.forEach((root) => root.removeFromParent());
  emitChanged();
  setStatus(keep.length ? `Escena limpiada; ${keep.length} objeto(s) preservado(s).` : "Escena limpiada.");
  return { deletedRoots: rootsToDelete.length, kept: keep.map(objectInfo).filter(Boolean) };
}

// -----------------------------------------------------------------------------
// Duplication and arrays
// -----------------------------------------------------------------------------
function cloneOne(source: THREE.Object3D, preserveReferences = true) {
  const copy = cloneWithFreshIds(source);
  if (!preserveReferences) clearReferences(copy);
  const parent = source.parent ?? editor.scene;
  parent.add(copy);
  copy.updateMatrixWorld(true);
  return copy;
}

function duplicateObjects(args: {
  objects: string[];
  count?: number;
  offset?: Vec3Like;
  name?: string;
  preserveReferences?: boolean;
}) {
  const sources = resolveObjects(args.objects);
  const count = Math.max(1, Math.min(500, Math.floor(Number(args.count ?? 1))));
  const offset = new THREE.Vector3(Number(args.offset?.x ?? 0), Number(args.offset?.y ?? 0), Number(args.offset?.z ?? 0));
  const preserveReferences = args.preserveReferences !== false;
  editor.checkpoint();

  const created: THREE.Object3D[] = [];
  for (const source of sources) {
    source.updateMatrixWorld(true);
    const sourceWorld = source.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < count; i += 1) {
      const copy = cloneOne(source, preserveReferences);
      setWorldPosition(copy, sourceWorld.clone().addScaledVector(offset, i + 1));
      if (args.name && sources.length === 1) renameRoot(copy, count === 1 ? args.name : `${args.name}_${i + 1}`);
      created.push(copy);
    }
  }
  editor.setSelection(created);
  emitChanged();
  setStatus(`${created.length} copia(s) creada(s).`);
  return created.map(objectInfo).filter(Boolean);
}

function duplicateObject(args: {
  object: string;
  count?: number;
  dx?: number; dy?: number; dz?: number;
  name?: string;
  preserveReferences?: boolean;
}) {
  return duplicateObjects({
    objects: [args.object],
    count: args.count,
    offset: { x: args.dx, y: args.dy, z: args.dz },
    name: args.name,
    preserveReferences: args.preserveReferences,
  });
}

function axisVector(axis: Axis) {
  return axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}

function arrayObject(args: any) {
  const source = findObject(String(args.object ?? ""));
  if (!source) throw new Error(`No existe el objeto “${String(args.object ?? "")}”.`);
  const type = String(args.type ?? "linear");
  const includeOriginal = args.includeOriginal !== false;
  const preserveReferences = args.preserveReferences !== false;
  editor.checkpoint();
  source.updateMatrixWorld(true);

  const created: THREE.Object3D[] = [];
  const result: THREE.Object3D[] = includeOriginal ? [source] : [];
  const sourceWorldPosition = source.getWorldPosition(new THREE.Vector3());
  const sourceWorldQuaternion = source.getWorldQuaternion(new THREE.Quaternion());

  const addCloneAt = (worldPosition: THREE.Vector3, worldQuaternion = sourceWorldQuaternion, suffix?: string) => {
    const copy = cloneOne(source, preserveReferences);
    setWorldPosition(copy, worldPosition);
    setWorldQuaternion(copy, worldQuaternion);
    if (suffix) {
      const base = getMeta(source)?.name ?? "Objeto";
      renameRoot(copy, `${base}_${suffix}`);
    }
    created.push(copy);
    result.push(copy);
  };

  if (type === "linear") {
    const count = Math.max(1, Math.min(500, Math.floor(Number(args.count ?? 2))));
    const step = new THREE.Vector3(Number(args.dx ?? 0), Number(args.dy ?? 0), Number(args.dz ?? 0));
    const start = includeOriginal ? 1 : 0;
    for (let i = start; i < count; i += 1) addCloneAt(sourceWorldPosition.clone().addScaledVector(step, i), sourceWorldQuaternion, String(i + 1));
  } else if (type === "rectangular") {
    const nx = Math.max(1, Math.min(100, Math.floor(Number(args.countX ?? 1))));
    const ny = Math.max(1, Math.min(100, Math.floor(Number(args.countY ?? 1))));
    const nz = Math.max(1, Math.min(100, Math.floor(Number(args.countZ ?? 1))));
    const total = nx * ny * nz;
    if (total > 1000) throw new Error("El array rectangular no puede superar 1000 elementos.");
    const sx = Number(args.spacingX ?? 0), sy = Number(args.spacingY ?? 0), sz = Number(args.spacingZ ?? 0);
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          if (includeOriginal && ix === 0 && iy === 0 && iz === 0) continue;
          addCloneAt(sourceWorldPosition.clone().add(new THREE.Vector3(ix * sx, iy * sy, iz * sz)), sourceWorldQuaternion, `${ix + 1}_${iy + 1}_${iz + 1}`);
        }
      }
    }
  } else if (type === "circular") {
    const count = Math.max(1, Math.min(500, Math.floor(Number(args.count ?? 8))));
    const axis = (["x", "y", "z"].includes(args.axis) ? args.axis : "z") as Axis;
    const center = new THREE.Vector3(Number(args.centerX ?? 0), Number(args.centerY ?? 0), Number(args.centerZ ?? 0));
    const stepDegrees = Number.isFinite(Number(args.stepDegrees)) ? Number(args.stepDegrees) : 360 / count;
    const rotateCopies = args.rotateCopies !== false;
    const start = includeOriginal ? 1 : 0;
    for (let i = start; i < count; i += 1) {
      const q = new THREE.Quaternion().setFromAxisAngle(axisVector(axis), THREE.MathUtils.degToRad(stepDegrees * i));
      const position = sourceWorldPosition.clone().sub(center).applyQuaternion(q).add(center);
      const orientation = rotateCopies ? q.clone().multiply(sourceWorldQuaternion) : sourceWorldQuaternion.clone();
      addCloneAt(position, orientation, String(i + 1));
    }
  } else {
    throw new Error(`Tipo de array desconocido: ${type}. Usá linear, rectangular o circular.`);
  }

  editor.setSelection(created.length ? created : result);
  emitChanged();
  setStatus(`Array ${type}: ${result.length} elemento(s).`);
  return {
    type,
    total: result.length,
    originalIncluded: includeOriginal,
    objects: result.map(objectInfo).filter(Boolean),
  };
}

// -----------------------------------------------------------------------------
// Groups
// -----------------------------------------------------------------------------
function groupObjects(args: { objects: string[]; name?: string }) {
  const objects = resolveObjects(args.objects);
  if (objects.length < 2) throw new Error("group_objects necesita al menos dos objetos.");
  editor.setSelection(objects);
  editor.groupSelected();
  const group = editor.activeObject();
  if (!group || getMeta(group)?.kind !== "group") throw new Error("No se pudo crear el grupo.");
  if (args.name) renameRoot(group, args.name);
  emitChanged();
  return objectInfo(group);
}

function ungroupObjects(args: { groups: string[] }) {
  const groups = resolveObjects(args.groups, "grupo");
  const invalid = groups.filter((group) => getMeta(group)?.kind !== "group");
  if (invalid.length) throw new Error(`No son grupos: ${invalid.map((o) => getMeta(o)?.name ?? o.name).join(", ")}`);
  editor.setSelection(groups);
  editor.ungroupSelected();
  emitChanged();
  return editor.getSelection().map(objectInfo).filter(Boolean);
}

// -----------------------------------------------------------------------------
// Measurements / bounds
// -----------------------------------------------------------------------------
function getBounds(args: {
  objects?: string[];
  useSelection?: boolean;
  bedX?: number; bedY?: number; bedZ?: number;
} = {}) {
  let objects: THREE.Object3D[];
  if (args.objects?.length) objects = resolveObjects(args.objects);
  else if (args.useSelection) objects = editor.getSelection();
  else objects = editor.getSceneRoots();
  if (!objects.length) return { objects: [], combined: null, fits: null };

  const entries = objects.map((object) => {
    const meta = getMeta(object);
    const box = worldBox(object);
    return { id: meta?.id, name: meta?.name ?? object.name, ...boxInfo(box) };
  });
  const combined = new THREE.Box3();
  objects.forEach((object) => combined.union(worldBox(object)));
  const combinedInfo = boxInfo(combined);

  let fit: any = null;
  const bed = new THREE.Vector3(Number(args.bedX ?? 0), Number(args.bedY ?? 0), Number(args.bedZ ?? 0));
  if (bed.x > 0 && bed.y > 0 && bed.z > 0) {
    const size = combined.getSize(new THREE.Vector3());
    fit = {
      bed: { x: bed.x, y: bed.y, z: bed.z },
      fits: size.x <= bed.x && size.y <= bed.y && size.z <= bed.z,
      overBy: {
        x: Math.max(0, size.x - bed.x),
        y: Math.max(0, size.y - bed.y),
        z: Math.max(0, size.z - bed.z),
      },
      remaining: {
        x: Math.max(0, bed.x - size.x),
        y: Math.max(0, bed.y - size.y),
        z: Math.max(0, bed.z - size.z),
      },
    };
  }
  return { objects: entries, combined: combinedInfo, fit };
}

// -----------------------------------------------------------------------------
// Batch: one network call + one Undo checkpoint. Rollback is atomic by default.
// -----------------------------------------------------------------------------
function normalizeBatchAction(action: string) {
  return action.trim().toLowerCase().replace(/-/g, "_");
}

async function runBatchOperation(operation: BatchOperation) {
  const args = operation.args ?? {};
  const action = normalizeBatchAction(operation.action);
  const api = window.tinkerMatt;
  switch (action) {
    case "create_box": return await api.createBox?.({ name: args.name, mode: args.mode, size: { x: args.x, y: args.y, z: args.z }, position: { x: args.posX, y: args.posY, z: args.posZ } });
    case "create_cylinder": return await api.createCylinder?.({ name: args.name, mode: args.mode, size: { x: args.x, y: args.y, z: args.z }, position: { x: args.posX, y: args.posY, z: args.posZ } });
    case "create_sphere": return await api.createSphere?.({ name: args.name, mode: args.mode, size: { x: args.x, y: args.y, z: args.z }, position: { x: args.posX, y: args.posY, z: args.posZ } });
    case "create_text": return await api.createText?.({ text: args.text, name: args.name, height: args.height, depth: args.depth, mode: args.mode, position: { x: args.posX, y: args.posY, z: args.posZ }, rotationDegrees: { x: args.rotX, y: args.rotY, z: args.rotZ } });
    case "select_object": return api.selectObject?.(args.object, Boolean(args.additive));
    case "rename_object": return api.renameObject?.({ object: args.object, name: args.name });
    case "move_object": return api.moveObject?.({ object: args.object, delta: { x: args.dx, y: args.dy, z: args.dz }, position: { x: args.x, y: args.y, z: args.z } });
    case "rotate_object": return api.rotateObject?.({ object: args.object, deltaDegrees: { x: args.dx, y: args.dy, z: args.dz }, rotationDegrees: { x: args.x, y: args.y, z: args.z } });
    case "set_dimensions": return api.setDimensions?.({ object: args.object, x: args.x, y: args.y, z: args.z });
    case "set_solid_mode": return api.setSolidMode?.({ object: args.object, mode: args.mode });
    case "union_objects": return api.unionObjects?.({ objects: args.objects });
    case "delete_objects": return deleteObjects(args);
    case "delete_selected": return deleteSelectedRemote();
    case "clear_scene": return clearScene(args);
    case "duplicate_object": return duplicateObject(args);
    case "duplicate_objects": return duplicateObjects(args);
    case "array_object": return arrayObject(args);
    case "group_objects": return groupObjects(args);
    case "ungroup_objects": return ungroupObjects(args);
    case "get_bounds":
    case "measure": return getBounds(args);
    case "batch": throw new Error("No se permite batch dentro de batch.");
    case "undo":
    case "redo": throw new Error("Undo/redo no están permitidos dentro de una transacción batch.");
    default: throw new Error(`Operación batch desconocida: ${operation.action}`);
  }
}

async function batch(args: { operations: BatchOperation[]; rollbackOnError?: boolean }) {
  if (!Array.isArray(args.operations) || !args.operations.length) throw new Error("batch necesita al menos una operación.");
  if (args.operations.length > 500) throw new Error("batch admite hasta 500 operaciones por llamada.");
  const rollbackOnError = args.rollbackOnError !== false;
  beginTransaction();
  const results: any[] = [];
  try {
    for (let i = 0; i < args.operations.length; i += 1) {
      const operation = args.operations[i];
      try {
        const result = await runBatchOperation(operation);
        results.push({ index: i, action: operation.action, ok: true, result });
      } catch (error) {
        throw new Error(`Operación ${i + 1}/${args.operations.length} (${operation.action}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    commitTransaction();
    emitChanged();
    setStatus(`Batch MCP completado: ${results.length} operación(es) · un solo Undo.`);
    return { ok: true, operations: results.length, results };
  } catch (error) {
    if (rollbackOnError) rollbackTransaction(); else commitTransaction();
    throw error;
  }
}

function undoMany(args: { count?: number } = {}) {
  const count = Math.max(1, Math.min(60, Math.floor(Number(args.count ?? 1))));
  for (let i = 0; i < count; i += 1) editor.undo();
  return { requested: count };
}

Object.assign(window.tinkerMatt, {
  deleteObjects,
  deleteSelectedRemote,
  clearScene,
  duplicateObject,
  duplicateObjects,
  arrayObject,
  groupObjects,
  ungroupObjects,
  getBounds,
  measure: getBounds,
  batch,
  undoMany,
});

setStatus("TinkerMatt v0.8.3 · MCP: delete + batch + duplicate + arrays + groups + bounds.");
