import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { booleanMeshes, materialFor } from "./geometry";
import { cloneWithFreshIds, getMeta, makeId, setMeta, type MaterialPreset } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type Side = "min" | "center" | "max";
type TagValue = string | number | boolean;
type BatchOperation = { action: string; args?: Record<string, any> };

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.4 core no pudo acceder al editor.");
const rawEditor = editor as any;
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };

function allObjects() {
  const result: THREE.Object3D[] = [];
  for (const root of editor.getSceneRoots()) root.traverse((node) => { if (getMeta(node)) result.push(node); });
  return result;
}

function findObject(ref: string) {
  return editor.findById(ref) ?? allObjects().find((object) => getMeta(object)?.name === ref) ?? null;
}

function resolveObjects(refs: string[], label = "objeto") {
  const found: THREE.Object3D[] = [];
  const missing: string[] = [];
  for (const ref of refs ?? []) {
    const object = findObject(String(ref));
    if (object) found.push(object); else missing.push(String(ref));
  }
  if (missing.length) throw new Error(`No se encontraron ${label}(s): ${missing.join(", ")}`);
  return [...new Set(found)];
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
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
  };
}

function tagsOf(object: THREE.Object3D): Record<string, TagValue> {
  return { ...(object.userData.tmTags ?? {}) };
}

function isLocked(object: THREE.Object3D) {
  return object.userData.tmLocked === true;
}

function componentInfo(object: THREE.Object3D) {
  return object.userData.tmComponent ? structuredClone(object.userData.tmComponent) : null;
}

function customMaterialInfo(object: THREE.Object3D) {
  return object.userData.tmCustomMaterial ? structuredClone(object.userData.tmCustomMaterial) : null;
}

function objectInfo(object: THREE.Object3D | null) {
  if (!object) return null;
  const meta = getMeta(object);
  if (!meta) return null;
  object.updateMatrixWorld(true);
  const box = worldBox(object);
  return {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    mode: meta.mode,
    material: meta.material,
    customMaterial: customMaterialInfo(object),
    visible: object.visible,
    locked: isLocked(object),
    tags: tagsOf(object),
    component: componentInfo(object),
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotationDegrees: {
      x: THREE.MathUtils.radToDeg(object.rotation.x),
      y: THREE.MathUtils.radToDeg(object.rotation.y),
      z: THREE.MathUtils.radToDeg(object.rotation.z),
    },
    scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
    bounds: boxInfo(box),
    references: structuredClone(meta.references ?? []),
    params: structuredClone(meta.params ?? {}),
  };
}

function hierarchyInfo(object: THREE.Object3D): any {
  return {
    ...objectInfo(object),
    children: object.children.filter((child) => Boolean(getMeta(child))).map(hierarchyInfo),
  };
}

function emitChanged() {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
}

function ensureUnlocked(objects: THREE.Object3D[], allowLocked = false) {
  if (allowLocked) return;
  const locked = objects.filter(isLocked);
  if (locked.length) throw new Error(`Objeto(s) bloqueado(s): ${locked.map((o) => getMeta(o)?.name ?? o.name).join(", ")}`);
}

function setWorldPosition(object: THREE.Object3D, world: THREE.Vector3) {
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    object.position.copy(object.parent.worldToLocal(world.clone()));
  } else object.position.copy(world);
  object.updateMatrixWorld(true);
}

function moveWorld(object: THREE.Object3D, delta: THREE.Vector3) {
  object.updateMatrixWorld(true);
  setWorldPosition(object, object.getWorldPosition(new THREE.Vector3()).add(delta));
}

function sideValue(box: THREE.Box3, axis: Axis, side: Side) {
  if (side === "min") return box.min[axis];
  if (side === "max") return box.max[axis];
  return (box.min[axis] + box.max[axis]) * 0.5;
}

function refreshGeometry(geometry: THREE.BufferGeometry) {
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const pos = geometry.getAttribute("position");
  if (pos) pos.needsUpdate = true;
}

// -----------------------------------------------------------------------------
// Query / semantic metadata / naming
// -----------------------------------------------------------------------------
function globToRegex(glob: string) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function selectByPattern(args: any = {}) {
  const mode = String(args.mode ?? "glob");
  const pattern = String(args.pattern ?? "*");
  const kind = args.kind ? String(args.kind) : "";
  const material = args.material ? String(args.material) : "";
  const tagKey = args.tagKey ? String(args.tagKey) : "";
  const tagValue = args.tagValue;
  const visible = typeof args.visible === "boolean" ? args.visible : undefined;
  const locked = typeof args.locked === "boolean" ? args.locked : undefined;
  let matcher: (name: string) => boolean;
  if (mode === "exact") matcher = (name) => name === pattern;
  else if (mode === "starts_with") matcher = (name) => name.toLowerCase().startsWith(pattern.toLowerCase());
  else if (mode === "contains") matcher = (name) => name.toLowerCase().includes(pattern.toLowerCase());
  else if (mode === "regex") {
    const regex = new RegExp(pattern, args.caseSensitive ? "" : "i");
    matcher = (name) => regex.test(name);
  } else {
    const regex = globToRegex(pattern);
    matcher = (name) => regex.test(name);
  }

  const matches = allObjects().filter((object) => {
    const meta = getMeta(object);
    if (!meta || !matcher(meta.name)) return false;
    if (kind && meta.kind !== kind) return false;
    if (material && meta.material !== material) return false;
    if (visible !== undefined && object.visible !== visible) return false;
    if (locked !== undefined && isLocked(object) !== locked) return false;
    if (tagKey) {
      const tags = tagsOf(object);
      if (!(tagKey in tags)) return false;
      if (tagValue !== undefined && String(tags[tagKey]) !== String(tagValue)) return false;
    }
    return true;
  });
  if (args.select !== false) editor.setSelection(matches);
  return { count: matches.length, objects: matches.map(objectInfo).filter(Boolean) };
}

function renameMany(args: any) {
  const objects = args.objects?.length ? resolveObjects(args.objects) : editor.getSelection();
  if (!objects.length) throw new Error("rename_many no tiene objetos para renombrar.");
  ensureUnlocked(objects, Boolean(args.allowLocked));
  const pattern = String(args.pattern ?? "{name}_{n}");
  const start = Math.floor(Number(args.start ?? 1));
  const pad = Math.max(0, Math.min(8, Math.floor(Number(args.pad ?? 2))));
  editor.checkpoint();
  objects.forEach((object, index) => {
    const meta = getMeta(object)!;
    const n = String(start + index).padStart(pad, "0");
    const name = pattern
      .replaceAll("{n}", n)
      .replaceAll("{name}", meta.name)
      .replaceAll("{kind}", meta.kind)
      .replaceAll("{id}", meta.id);
    meta.name = name;
    setMeta(object, meta);
  });
  emitChanged();
  return objects.map(objectInfo).filter(Boolean);
}

function setTags(args: any) {
  const objects = resolveObjects(args.objects?.length ? args.objects : [args.object].filter(Boolean));
  editor.checkpoint();
  for (const object of objects) {
    const current = tagsOf(object);
    const next = args.replace ? {} : current;
    for (const [key, value] of Object.entries(args.tags ?? {})) {
      if (["string", "number", "boolean"].includes(typeof value)) next[key] = value as TagValue;
    }
    for (const key of args.remove ?? []) delete next[String(key)];
    object.userData.tmTags = next;
  }
  emitChanged();
  return objects.map(objectInfo).filter(Boolean);
}

function lockObjects(args: any) {
  const objects = resolveObjects(args.objects?.length ? args.objects : [args.object].filter(Boolean));
  editor.checkpoint();
  for (const object of objects) object.userData.tmLocked = args.locked !== false;
  if (editor.activeObject() && isLocked(editor.activeObject()!)) editor.transform.detach();
  emitChanged();
  return objects.map(objectInfo).filter(Boolean);
}

// Keep locked objects selectable/inspectable, but don't attach the stock transform gizmo.
const setSelectionBeforeLock = editor.setSelection.bind(editor);
(editor as any).setSelection = (objects: THREE.Object3D[]) => {
  setSelectionBeforeLock(objects);
  const active = editor.activeObject();
  if (active && isLocked(active)) editor.transform.detach();
};

// -----------------------------------------------------------------------------
// Visibility and material
// -----------------------------------------------------------------------------
function setVisibility(args: any) {
  const objects = resolveObjects(args.objects?.length ? args.objects : [args.object].filter(Boolean));
  editor.checkpoint();
  for (const object of objects) object.visible = args.visible !== false;
  editor.setSelection(editor.getSelection().filter((object) => object.visible));
  emitChanged();
  return objects.map(objectInfo).filter(Boolean);
}

function setMaterialRemote(args: any) {
  const objects = resolveObjects(args.objects?.length ? args.objects : [args.object].filter(Boolean));
  ensureUnlocked(objects, Boolean(args.allowLocked));
  editor.checkpoint();
  for (const object of objects) {
    const meta = getMeta(object)!;
    if (args.preset) {
      meta.material = args.preset as MaterialPreset;
      setMeta(object, meta);
      delete object.userData.tmCustomMaterial;
      object.traverse((node) => {
        if (node instanceof THREE.Mesh) node.material = materialFor(meta.material, meta.mode);
      });
      continue;
    }
    const hex = String(args.hex ?? "#7ac7e8").replace(/^#/, "");
    const color = Number.parseInt(hex, 16);
    if (!Number.isFinite(color)) throw new Error(`Color hex inválido: ${args.hex}`);
    const custom = {
      hex: `#${hex.padStart(6, "0").slice(-6)}`,
      roughness: Math.max(0, Math.min(1, Number(args.roughness ?? 0.45))),
      metalness: Math.max(0, Math.min(1, Number(args.metalness ?? 0))),
      opacity: Math.max(0, Math.min(1, Number(args.opacity ?? 1))),
    };
    object.userData.tmCustomMaterial = custom;
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.material = new THREE.MeshStandardMaterial({
        color,
        roughness: custom.roughness,
        metalness: custom.metalness,
        opacity: custom.opacity,
        transparent: custom.opacity < 1,
      });
    });
  }
  emitChanged();
  return objects.map(objectInfo).filter(Boolean);
}

// -----------------------------------------------------------------------------
// Alignment / distribution / snapping
// -----------------------------------------------------------------------------
function alignObjects(args: any) {
  const objects = canonicalRoots(resolveObjects(args.objects ?? []));
  if (objects.length < 2) throw new Error("align_objects necesita al menos dos objetos.");
  ensureUnlocked(objects, Boolean(args.allowLocked));
  const axis = (["x", "y", "z"].includes(args.axis) ? args.axis : "x") as Axis;
  const side = (["min", "center", "max"].includes(args.side) ? args.side : "center") as Side;
  const targetObject = args.target ? findObject(String(args.target)) : objects[0];
  if (!targetObject) throw new Error("No se encontró el objeto objetivo para alinear.");
  const targetValue = Number.isFinite(Number(args.value)) ? Number(args.value) : sideValue(worldBox(targetObject), axis, side);
  editor.checkpoint();
  for (const object of objects) {
    if (object === targetObject && args.includeTarget !== true) continue;
    const delta = targetValue - sideValue(worldBox(object), axis, side);
    moveWorld(object, new THREE.Vector3(axis === "x" ? delta : 0, axis === "y" ? delta : 0, axis === "z" ? delta : 0));
  }
  emitChanged();
  return objects.map(objectInfo).filter(Boolean);
}

function distributeObjects(args: any) {
  const objects = canonicalRoots(resolveObjects(args.objects ?? []));
  if (objects.length < 3) throw new Error("distribute_objects necesita al menos tres objetos.");
  ensureUnlocked(objects, Boolean(args.allowLocked));
  const axis = (["x", "y", "z"].includes(args.axis) ? args.axis : "x") as Axis;
  const mode = String(args.mode ?? "gaps");
  const sorted = [...objects].sort((a, b) => sideValue(worldBox(a), axis, "center") - sideValue(worldBox(b), axis, "center"));
  editor.checkpoint();

  if (mode === "centers") {
    const first = sideValue(worldBox(sorted[0]), axis, "center");
    const last = sideValue(worldBox(sorted[sorted.length - 1]), axis, "center");
    const spacing = Number.isFinite(Number(args.spacing)) ? Number(args.spacing) : (last - first) / (sorted.length - 1);
    for (let i = 1; i < sorted.length - (args.spacing === undefined ? 1 : 0); i += 1) {
      const current = sideValue(worldBox(sorted[i]), axis, "center");
      const target = first + spacing * i;
      const delta = target - current;
      moveWorld(sorted[i], new THREE.Vector3(axis === "x" ? delta : 0, axis === "y" ? delta : 0, axis === "z" ? delta : 0));
    }
  } else {
    const boxes = sorted.map(worldBox);
    let gap: number;
    if (Number.isFinite(Number(args.spacing))) gap = Number(args.spacing);
    else {
      const outerSpan = boxes[boxes.length - 1].max[axis] - boxes[0].min[axis];
      const occupied = boxes.reduce((sum, box) => sum + (box.max[axis] - box.min[axis]), 0);
      gap = (outerSpan - occupied) / (boxes.length - 1);
    }
    let cursor = boxes[0].max[axis];
    const end = Number.isFinite(Number(args.spacing)) ? sorted.length : sorted.length - 1;
    for (let i = 1; i < end; i += 1) {
      const box = worldBox(sorted[i]);
      const targetMin = cursor + gap;
      const delta = targetMin - box.min[axis];
      moveWorld(sorted[i], new THREE.Vector3(axis === "x" ? delta : 0, axis === "y" ? delta : 0, axis === "z" ? delta : 0));
      cursor = worldBox(sorted[i]).max[axis];
    }
  }
  emitChanged();
  return { axis, mode, objects: sorted.map(objectInfo).filter(Boolean) };
}

function snapObjectToObject(args: any) {
  const object = findObject(String(args.object ?? ""));
  const target = findObject(String(args.target ?? ""));
  if (!object || !target) throw new Error("snap_object_to_object necesita object y target válidos.");
  ensureUnlocked([object], Boolean(args.allowLocked));
  editor.checkpoint();
  const relation = String(args.relation ?? "custom");
  let axis = (["x", "y", "z"].includes(args.axis) ? args.axis : "z") as Axis;
  let objectSide = (["min", "center", "max"].includes(args.objectSide) ? args.objectSide : "min") as Side;
  let targetSide = (["min", "center", "max"].includes(args.targetSide) ? args.targetSide : "max") as Side;
  if (relation === "above") { axis = "z"; objectSide = "min"; targetSide = "max"; }
  else if (relation === "below") { axis = "z"; objectSide = "max"; targetSide = "min"; }
  else if (relation === "right") { axis = "x"; objectSide = "min"; targetSide = "max"; }
  else if (relation === "left") { axis = "x"; objectSide = "max"; targetSide = "min"; }
  else if (relation === "front") { axis = "y"; objectSide = "min"; targetSide = "max"; }
  else if (relation === "back") { axis = "y"; objectSide = "max"; targetSide = "min"; }
  else if (relation === "center") {
    const a = worldBox(object).getCenter(new THREE.Vector3());
    const b = worldBox(target).getCenter(new THREE.Vector3());
    moveWorld(object, b.sub(a));
    emitChanged();
    return objectInfo(object);
  }
  const boxA = worldBox(object);
  const boxB = worldBox(target);
  const offset = Number(args.offset ?? 0);
  const delta = sideValue(boxB, axis, targetSide) + offset - sideValue(boxA, axis, objectSide);
  moveWorld(object, new THREE.Vector3(axis === "x" ? delta : 0, axis === "y" ? delta : 0, axis === "z" ? delta : 0));
  if (args.centerOtherAxes) {
    const moved = worldBox(object).getCenter(new THREE.Vector3());
    const targetCenter = worldBox(target).getCenter(new THREE.Vector3());
    const d = targetCenter.sub(moved);
    d[axis] = 0;
    moveWorld(object, d);
  }
  emitChanged();
  return objectInfo(object);
}

// -----------------------------------------------------------------------------
// Copy transforms/properties
// -----------------------------------------------------------------------------
function copyProperties(args: any) {
  const source = findObject(String(args.source ?? ""));
  const targets = resolveObjects(args.targets ?? []);
  if (!source || !targets.length) throw new Error("copy_properties necesita source y targets.");
  ensureUnlocked(targets, Boolean(args.allowLocked));
  const properties = new Set<string>(args.properties?.length ? args.properties.map(String) : ["rotation", "dimensions", "material"]);
  const sourceMeta = getMeta(source)!;
  const sourceBox = worldBox(source);
  const sourceSize = sourceBox.getSize(new THREE.Vector3());
  editor.checkpoint();
  source.updateMatrixWorld(true);
  const worldPos = source.getWorldPosition(new THREE.Vector3());
  const worldQuat = source.getWorldQuaternion(new THREE.Quaternion());
  for (const target of targets) {
    if (properties.has("position")) setWorldPosition(target, worldPos);
    if (properties.has("rotation")) {
      if (target.parent) {
        target.parent.updateMatrixWorld(true);
        const pq = target.parent.getWorldQuaternion(new THREE.Quaternion());
        target.quaternion.copy(pq.invert().multiply(worldQuat));
      } else target.quaternion.copy(worldQuat);
    }
    if (properties.has("scale")) target.scale.copy(source.scale);
    if (properties.has("dimensions")) {
      editor.setSelection([target]);
      if (sourceSize.x > 0) editor.setActiveDimension("x", sourceSize.x);
      if (sourceSize.y > 0) editor.setActiveDimension("y", sourceSize.y);
      if (sourceSize.z > 0) editor.setActiveDimension("z", sourceSize.z);
    }
    if (properties.has("material")) {
      const custom = customMaterialInfo(source);
      if (custom) setMaterialRemote({ objects: [getMeta(target)!.id], ...custom });
      else {
        const meta = getMeta(target)!;
        meta.material = sourceMeta.material;
        setMeta(target, meta);
        target.traverse((node) => { if (node instanceof THREE.Mesh) node.material = materialFor(meta.material, meta.mode); });
      }
    }
    if (properties.has("mode")) {
      const meta = getMeta(target)!;
      meta.mode = sourceMeta.mode;
      setMeta(target, meta);
    }
    if (properties.has("params")) {
      const meta = getMeta(target)!;
      meta.params = structuredClone(sourceMeta.params ?? {});
      setMeta(target, meta);
    }
    if (properties.has("tags")) target.userData.tmTags = tagsOf(source);
  }
  editor.setSelection(targets);
  emitChanged();
  return targets.map(objectInfo).filter(Boolean);
}

// -----------------------------------------------------------------------------
// Explicit booleans / mirror
// -----------------------------------------------------------------------------
function booleanObjects(args: any) {
  const objects = resolveObjects(args.objects ?? []);
  ensureUnlocked(objects, Boolean(args.allowLocked));
  if (objects.length < 2 || objects.some((object) => !(object instanceof THREE.Mesh))) throw new Error("boolean_objects requiere dos o más Mesh simples.");
  const operation = String(args.operation ?? "union");
  if (!["union", "subtract", "intersect"].includes(operation)) throw new Error("Operación booleana válida: union, subtract o intersect.");
  editor.setSelection(objects);
  editor.applyBoolean(operation as "union" | "subtract" | "intersect");
  return objectInfo(editor.activeObject());
}

function reverseWinding(geometry: THREE.BufferGeometry) {
  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
  } else {
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 3) {
      const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, bx, by, bz);
    }
    pos.needsUpdate = true;
  }
}

function mirrorObject(args: any) {
  const source = findObject(String(args.object ?? ""));
  if (!source) throw new Error("mirror_object: objeto no encontrado.");
  ensureUnlocked([source], Boolean(args.allowLocked));
  const axis = (["x", "y", "z"].includes(args.axis) ? args.axis : "x") as Axis;
  const plane = Number(args.plane ?? 0);
  editor.checkpoint();
  const result = args.clone === false ? source : cloneWithFreshIds(source);
  if (args.clone !== false) (source.parent ?? editor.scene).add(result);
  result.updateMatrixWorld(true);
  const reflect = new THREE.Matrix4();
  const scale = new THREE.Vector3(1, 1, 1); scale[axis] = -1;
  const t1 = new THREE.Matrix4().makeTranslation(axis === "x" ? plane : 0, axis === "y" ? plane : 0, axis === "z" ? plane : 0);
  const t2 = new THREE.Matrix4().makeTranslation(axis === "x" ? -plane : 0, axis === "y" ? -plane : 0, axis === "z" ? -plane : 0);
  reflect.copy(t1).multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z)).multiply(t2);
  result.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.updateMatrixWorld(true);
    const localDelta = node.matrixWorld.clone().invert().multiply(reflect).multiply(node.matrixWorld);
    node.geometry.applyMatrix4(localDelta);
    reverseWinding(node.geometry);
    refreshGeometry(node.geometry);
  });
  if (args.name) {
    const meta = getMeta(result); if (meta) { meta.name = String(args.name); setMeta(result, meta); }
  }
  editor.setSelection([result]);
  emitChanged();
  return objectInfo(result);
}

// -----------------------------------------------------------------------------
// Linked components (master + instances). Geometry/material/scale are linked;
// position and rotation remain per-instance.
// -----------------------------------------------------------------------------
function componentFingerprint(object: THREE.Object3D) {
  const meta = getMeta(object);
  const meshes: any[] = [];
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.computeBoundingBox();
    const b = node.geometry.boundingBox;
    const pos = node.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    meshes.push({ uuid: node.geometry.uuid, version: pos?.version ?? 0, count: pos?.count ?? 0, min: b ? b.min.toArray() : [], max: b ? b.max.toArray() : [] });
  });
  return JSON.stringify({ scale: object.scale.toArray(), mode: meta?.mode, material: meta?.material, params: meta?.params ?? {}, custom: customMaterialInfo(object), meshes });
}

function markComponent(object: THREE.Object3D, data: any) {
  object.userData.tmComponent = { ...data };
}

function replaceInstance(master: THREE.Object3D, instance: THREE.Object3D) {
  const parent = instance.parent ?? editor.scene;
  const oldMeta = getMeta(instance)!;
  const oldPos = instance.position.clone();
  const oldQuat = instance.quaternion.clone();
  const oldTags = tagsOf(instance);
  const oldLocked = isLocked(instance);
  const info = componentInfo(instance);
  const selected = editor.getSelection().includes(instance);
  const fresh = cloneWithFreshIds(master);
  fresh.position.copy(oldPos);
  fresh.quaternion.copy(oldQuat);
  fresh.scale.copy(master.scale);
  const freshMeta = getMeta(fresh)!;
  freshMeta.id = oldMeta.id;
  freshMeta.name = oldMeta.name;
  setMeta(fresh, freshMeta);
  fresh.userData.tmTags = oldTags;
  fresh.userData.tmLocked = oldLocked;
  markComponent(fresh, info);
  parent.add(fresh);
  instance.removeFromParent();
  if (selected) editor.setSelection(editor.getSelection().map((o) => o === instance ? fresh : o));
  return fresh;
}

function syncComponent(args: any) {
  const master = findObject(String(args.master ?? args.object ?? ""));
  if (!master) throw new Error("sync_component: master no encontrado.");
  const ci = componentInfo(master);
  if (!ci || ci.role !== "master") throw new Error("El objeto indicado no es un componente maestro.");
  const instances = allObjects().filter((object) => componentInfo(object)?.role === "instance" && componentInfo(object)?.masterId === getMeta(master)?.id);
  const updated = instances.map((instance) => replaceInstance(master, instance));
  master.userData.tmComponentFingerprint = componentFingerprint(master);
  emitChanged();
  return { master: objectInfo(master), instances: updated.map(objectInfo).filter(Boolean), count: updated.length };
}

function createComponent(args: any) {
  const master = findObject(String(args.object ?? ""));
  if (!master) throw new Error("create_component: objeto no encontrado.");
  const componentId = String(args.componentId ?? makeId("component"));
  markComponent(master, { id: componentId, role: "master" });
  master.userData.tmComponentFingerprint = componentFingerprint(master);
  const count = Math.max(0, Math.min(200, Math.floor(Number(args.instances ?? 0))));
  const offset = new THREE.Vector3(Number(args.dx ?? 0), Number(args.dy ?? 0), Number(args.dz ?? 0));
  editor.checkpoint();
  master.updateMatrixWorld(true);
  const baseWorld = master.getWorldPosition(new THREE.Vector3());
  const created: THREE.Object3D[] = [];
  for (let i = 0; i < count; i += 1) {
    const copy = cloneWithFreshIds(master);
    const meta = getMeta(copy)!;
    meta.name = args.name ? `${String(args.name)}_${i + 1}` : `${getMeta(master)?.name ?? "Componente"}_${i + 1}`;
    setMeta(copy, meta);
    markComponent(copy, { id: componentId, role: "instance", masterId: getMeta(master)?.id });
    (master.parent ?? editor.scene).add(copy);
    setWorldPosition(copy, baseWorld.clone().addScaledVector(offset, i + 1));
    created.push(copy);
  }
  emitChanged();
  return { componentId, master: objectInfo(master), instances: created.map(objectInfo).filter(Boolean) };
}

let syncingComponents = false;
function autoSyncComponents() {
  if (syncingComponents) return;
  syncingComponents = true;
  try {
    for (const master of allObjects().filter((object) => componentInfo(object)?.role === "master")) {
      const fingerprint = componentFingerprint(master);
      if (master.userData.tmComponentFingerprint && master.userData.tmComponentFingerprint !== fingerprint) syncComponent({ master: getMeta(master)?.id });
      else if (!master.userData.tmComponentFingerprint) master.userData.tmComponentFingerprint = fingerprint;
    }
  } finally { syncingComponents = false; }
}
editor.on("changed", () => queueMicrotask(autoSyncComponents));

// -----------------------------------------------------------------------------
// Macro / last action helpers
// -----------------------------------------------------------------------------
let lastRemoteAction: BatchOperation | null = null;
function remember(action: string, args: any) {
  if (!["repeat_last_action", "undo", "redo", "measure", "get_bounds", "check_printability"].includes(action)) lastRemoteAction = { action, args: structuredClone(args ?? {}) };
}

async function repeatLastAction(args: any = {}) {
  if (!lastRemoteAction) throw new Error("Todavía no hay una acción MCP repetible.");
  const count = Math.max(1, Math.min(100, Math.floor(Number(args.count ?? 1))));
  const results = [];
  for (let i = 0; i < count; i += 1) results.push(await runExtendedBatchOperation(lastRemoteAction));
  return { repeated: count, action: lastRemoteAction.action, results };
}

function macroControl(args: any) {
  const action = String(args.action ?? "repeat");
  if (action === "start") editor.startRecording();
  else if (action === "stop") editor.stopRecording();
  else if (action === "repeat") editor.repeatMacro(Math.max(1, Math.min(100, Math.floor(Number(args.count ?? 1)))));
  else if (action === "get") return { actions: editor.getMacro() };
  else throw new Error("macro action: start, stop, repeat o get.");
  return { action, actions: editor.getMacro() };
}

// -----------------------------------------------------------------------------
// Printability + split for printing + export
// -----------------------------------------------------------------------------
function quantizedPoint(position: THREE.BufferAttribute, index: number, eps = 1e-4) {
  return `${Math.round(position.getX(index) / eps)},${Math.round(position.getY(index) / eps)},${Math.round(position.getZ(index) / eps)}`;
}

function meshTopologyStats(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return { triangles: 0, boundaryEdges: 0, nonManifoldEdges: 0 };
  const index = geometry.index;
  const edgeCount = new Map<string, number>();
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  const vertexAt = (i: number) => index ? index.getX(i) : i;
  for (let t = 0; t < triCount; t += 1) {
    const ids = [vertexAt(t * 3), vertexAt(t * 3 + 1), vertexAt(t * 3 + 2)];
    for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const pa = quantizedPoint(pos, a), pb = quantizedPoint(pos, b);
      const key = pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const count of edgeCount.values()) { if (count === 1) boundaryEdges += 1; else if (count > 2) nonManifoldEdges += 1; }
  return { triangles: triCount, boundaryEdges, nonManifoldEdges };
}

function checkPrintability(args: any = {}) {
  const objects = args.objects?.length ? resolveObjects(args.objects) : editor.getSceneRoots();
  const bed = new THREE.Vector3(Number(args.bedX ?? 220), Number(args.bedY ?? 220), Number(args.bedZ ?? 250));
  const nozzle = Math.max(0.1, Number(args.nozzle ?? 0.4));
  const minFeature = Math.max(0.1, Number(args.minFeature ?? nozzle * 2));
  const warnings: any[] = [];
  const results = objects.map((object) => {
    const box = worldBox(object); const size = box.getSize(new THREE.Vector3());
    const fits = size.x <= bed.x && size.y <= bed.y && size.z <= bed.z;
    if (!fits) warnings.push({ object: getMeta(object)?.name, type: "bed", message: "Excede la cama configurada", overBy: { x: Math.max(0, size.x-bed.x), y: Math.max(0,size.y-bed.y), z: Math.max(0,size.z-bed.z) } });
    if (Math.min(size.x, size.y, size.z) < minFeature) warnings.push({ object: getMeta(object)?.name, type: "thin", message: `Dimensión global menor a ${minFeature.toFixed(2)} mm` });
    let triangles = 0, boundaryEdges = 0, nonManifoldEdges = 0;
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const stats = meshTopologyStats(node); triangles += stats.triangles; boundaryEdges += stats.boundaryEdges; nonManifoldEdges += stats.nonManifoldEdges;
    });
    if (boundaryEdges) warnings.push({ object: getMeta(object)?.name, type: "open_mesh", message: `${boundaryEdges} borde(s) abiertos detectados` });
    if (nonManifoldEdges) warnings.push({ object: getMeta(object)?.name, type: "non_manifold", message: `${nonManifoldEdges} borde(s) no-manifold detectados` });
    return { ...objectInfo(object), fitsBed: fits, topology: { triangles, boundaryEdges, nonManifoldEdges } };
  });
  return { bed: { x: bed.x, y: bed.y, z: bed.z }, nozzle, minFeature, printableHeuristic: warnings.length === 0, warnings, objects: results, note: "Chequeo heurístico; no sustituye un slicer para espesor local y soportes." };
}

function clipBox(min: THREE.Vector3, max: THREE.Vector3) {
  const size = max.clone().sub(min);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshStandardMaterial());
  mesh.position.copy(min.clone().add(max).multiplyScalar(0.5));
  mesh.updateMatrixWorld(true);
  return mesh;
}

function connectorCylinder(axis: Axis, center: THREE.Vector3, diameter: number, length: number) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(diameter * 0.5, diameter * 0.5, length, 32), new THREE.MeshStandardMaterial());
  if (axis === "x") mesh.rotation.z = -Math.PI / 2;
  else if (axis === "z") mesh.rotation.x = Math.PI / 2;
  mesh.position.copy(center);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function splitForPrinting(args: any) {
  const source = findObject(String(args.object ?? ""));
  if (!(source instanceof THREE.Mesh)) throw new Error("split_for_printing por ahora requiere un Mesh simple.");
  ensureUnlocked([source], Boolean(args.allowLocked));
  const axis = (["x", "y", "z"].includes(args.axis) ? args.axis : "x") as Axis;
  const box = worldBox(source); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
  const cut = Number.isFinite(Number(args.position)) ? Number(args.position) : center[axis];
  const pad = Math.max(size.x, size.y, size.z) + 20;
  const minA = box.min.clone().addScalar(-pad), maxA = box.max.clone().addScalar(pad);
  const minB = minA.clone(), maxB = maxA.clone();
  maxA[axis] = cut; minB[axis] = cut;
  editor.checkpoint();
  let a = booleanMeshes([source, clipBox(minA, maxA)], "intersect");
  let b = booleanMeshes([source, clipBox(minB, maxB)], "intersect");
  if (args.connector !== false) {
    const diameter = Math.max(1, Number(args.diameter ?? 5));
    const depth = Math.max(1, Number(args.depth ?? 5));
    const tolerance = Math.max(0, Number(args.tolerance ?? 0.25));
    const c = center.clone(); c[axis] = cut;
    a = booleanMeshes([a, connectorCylinder(axis, c, diameter, depth * 2)], "union");
    b = booleanMeshes([b, connectorCylinder(axis, c, diameter + tolerance * 2, depth * 2 + tolerance * 2)], "subtract");
  }
  const base = getMeta(source)?.name ?? "Pieza";
  const ma = getMeta(a)!; ma.name = `${base}_A`; setMeta(a, ma);
  const mb = getMeta(b)!; mb.name = `${base}_B`; setMeta(b, mb);
  if (args.keepOriginal !== true) source.removeFromParent();
  editor.addObject(a, false, false); editor.addObject(b, false, false);
  editor.setSelection([a, b]); emitChanged();
  return { axis, position: cut, parts: [objectInfo(a), objectInfo(b)], connector: args.connector !== false };
}

function exportObjects(args: any) {
  const objects = args.objects?.length ? resolveObjects(args.objects) : editor.getSelection().length ? editor.getSelection() : editor.getSceneRoots();
  if (!objects.length) throw new Error("No hay objetos para exportar.");
  const root = new THREE.Group();
  objects.forEach((object) => root.add(object.clone(true)));
  const data = new STLExporter().parse(root, { binary: true });
  const bytes = data instanceof DataView ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
  const blob = new Blob([bytes], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const filename = String(args.filename ?? (objects.length === 1 ? `${getMeta(objects[0])?.name ?? "pieza"}.stl` : "tinkermatt-export.stl")).replace(/[^\w.\- áéíóúñ]/gi, "_");
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { filename, objects: objects.map((object) => getMeta(object)?.name), format: "stl" };
}

// -----------------------------------------------------------------------------
// Extended batch. v0.8.3 owns transaction checkpointing; this dispatcher calls
// current window APIs so new actions remain one Undo as well.
// -----------------------------------------------------------------------------
const previousBatch = window.tinkerMatt.batch as ((args: any) => Promise<any>) | undefined;
async function runExtendedBatchOperation(operation: BatchOperation) {
  const args = operation.args ?? {};
  const action = String(operation.action ?? "").trim().toLowerCase().replace(/-/g, "_");
  const api = window.tinkerMatt;
  switch (action) {
    case "align_objects": return alignObjects(args);
    case "distribute_objects": return distributeObjects(args);
    case "snap_object_to_object": return snapObjectToObject(args);
    case "copy_properties":
    case "clone_transform": return copyProperties(args);
    case "set_material": return setMaterialRemote(args);
    case "set_visibility": return setVisibility(args);
    case "lock_object":
    case "lock_objects": return lockObjects(args);
    case "select_by_name_pattern": return selectByPattern(args);
    case "rename_many": return renameMany(args);
    case "set_tags": return setTags(args);
    case "boolean_objects": return booleanObjects(args);
    case "mirror_object": return mirrorObject(args);
    case "create_component": return createComponent(args);
    case "sync_component": return syncComponent(args);
    case "macro": return macroControl(args);
    case "repeat_last_action": return repeatLastAction(args);
    case "check_printability": return checkPrintability(args);
    case "split_for_printing": return splitForPrinting(args);
    case "export_object":
    case "export_group":
    case "export_objects": return exportObjects(args);
    default: {
      if (!previousBatch) throw new Error(`Operación batch desconocida: ${operation.action}`);
      const result = await previousBatch({ operations: [operation], rollbackOnError: true });
      return result?.results?.[0]?.result ?? result;
    }
  }
}

async function extendedBatch(args: any) {
  const operations = Array.isArray(args.operations) ? args.operations : [];
  const hasNewAction = operations.some((op: BatchOperation) => [
    "align_objects","distribute_objects","snap_object_to_object","copy_properties","clone_transform","set_material","set_visibility","lock_object","lock_objects","select_by_name_pattern","rename_many","set_tags","boolean_objects","mirror_object","create_component","sync_component","macro","repeat_last_action","check_printability","split_for_printing","export_object","export_group","export_objects",
  ].includes(String(op.action ?? "").trim().toLowerCase().replace(/-/g, "_")));
  if (!hasNewAction && previousBatch) return previousBatch(args);
  if (!operations.length) throw new Error("batch necesita al menos una operación.");
  if (operations.length > 500) throw new Error("batch admite hasta 500 operaciones.");

  // Use v0.8.3's transaction machinery by wrapping all operations into a single
  // synthetic batch when possible is not enough for new actions, so take one
  // explicit checkpoint and temporarily suppress nested checkpoints.
  const originalCheckpoint = (editor as any).checkpoint.bind(editor);
  let open = true;
  originalCheckpoint();
  (editor as any).checkpoint = () => {};
  const results: any[] = [];
  try {
    for (let i = 0; i < operations.length; i += 1) {
      const op = operations[i];
      const result = await runExtendedBatchOperation(op);
      remember(String(op.action), op.args ?? {});
      results.push({ index: i, action: op.action, ok: true, result });
    }
    open = false;
    return { ok: true, operations: results.length, results };
  } catch (error) {
    if (args.rollbackOnError !== false) {
      (editor as any).checkpoint = originalCheckpoint;
      editor.undo();
      open = false;
    }
    throw error;
  } finally {
    (editor as any).checkpoint = originalCheckpoint;
    if (open) emitChanged();
  }
}

const api = {
  listObjects: () => allObjects().map(objectInfo).filter(Boolean),
  getScene: () => editor.getSceneRoots().map(hierarchyInfo),
  selectByPattern,
  renameMany,
  setTags,
  lockObjects,
  setVisibility,
  setMaterialRemote,
  alignObjects,
  distributeObjects,
  snapObjectToObject,
  copyProperties,
  cloneTransform: copyProperties,
  booleanObjects,
  mirrorObject,
  createComponent,
  syncComponent,
  repeatLastAction,
  macroControl,
  checkPrintability,
  splitForPrinting,
  exportObjects,
  batch: extendedBatch,
};
Object.assign(window.tinkerMatt, api);

// Remember standalone remote calls too when they come through these public APIs.
for (const [name, fn] of Object.entries(api)) {
  if (["listObjects", "getScene", "batch", "repeatLastAction"].includes(name) || typeof fn !== "function") continue;
  (window.tinkerMatt as any)[name] = async (...args: any[]) => {
    const result = await (fn as any)(...args);
    remember(name, args[0] ?? {});
    return result;
  };
}

setStatus("TinkerMatt v0.8.4 · MCP avanzado cargado.");
