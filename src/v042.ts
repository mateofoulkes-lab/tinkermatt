import * as THREE from "three";
import "./v042.css";
import { getMeta, makeId, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

type Axis = "x" | "y" | "z";
type ZoneReference = {
  id: string;
  kind: "zone";
  name: string;
  zone: {
    points: [number, number, number][];
  };
};
type SelectedReference = { objectId: string; refId: string } | null;

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, unknown>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.4.2 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const outlinerTree = document.querySelector<HTMLElement>("#outliner-tree")!;
const refsList = document.querySelector<HTMLElement>("#refs-list");
const refNameInput = document.querySelector<HTMLInputElement>("#ref-name");
const refKindSelect = document.querySelector<HTMLSelectElement>("#ref-kind");
const modeSelect = document.querySelector<HTMLSelectElement>(".manipulator-mode-box select");
const overlay = document.querySelector<HTMLElement>(".tm-manipulator");
const topZHandle = document.querySelector<HTMLElement>(".tm-z-handle");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.4.2";

const status = (text: string) => {
  const el = document.querySelector<HTMLElement>("#status");
  if (el) el.textContent = text;
};

const emitChanged = () => {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
};

const project = (world: THREE.Vector3) => {
  const rect = viewport.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return {
    x: (p.x * 0.5 + 0.5) * rect.width,
    y: (-p.y * 0.5 + 0.5) * rect.height,
  };
};

const axisVector = (axis: Axis) =>
  axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

const screenAxis = (axis: Axis, origin: THREE.Vector3) => {
  const a = project(origin);
  const b = project(origin.clone().add(axisVector(axis)));
  return new THREE.Vector2(b.x - a.x, b.y - a.y);
};

const scalarOnAxis = (dx: number, dy: number, axis: Axis, origin: THREE.Vector3) => {
  const v = screenAxis(axis, origin);
  const lengthSq = v.lengthSq();
  return lengthSq < 1e-8 ? 0 : (dx * v.x + dy * v.y) / lengthSq;
};

const snapValue = (value: number, step: number) => step > 0 ? Math.round(value / step) * step : value;

const activeBounds = () => {
  const object = editor.activeObject();
  if (!object || !object.visible) return null;
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return { object, box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
};

// -----------------------------------------------------------------------------
// Legacy gizmo exorcism. In Tinker mode attach() itself becomes a no-op, so the
// old TransformControls cannot flash for even one rendered frame.
// -----------------------------------------------------------------------------
const originalAttach = editor.transform.attach.bind(editor.transform);
const originalDetach = editor.transform.detach.bind(editor.transform);
const helper = editor.transform.getHelper();

function isTinkerOnly() {
  return (modeSelect?.value ?? "tinker") === "tinker";
}

(editor.transform as any).attach = (object: THREE.Object3D) => {
  if (isTinkerOnly()) {
    originalDetach();
    helper.visible = false;
    editor.transform.enabled = false;
    return editor.transform;
  }
  editor.transform.enabled = true;
  helper.visible = true;
  return originalAttach(object);
};

function hardApplyManipulatorMode() {
  const mode = modeSelect?.value ?? "tinker";
  const showGizmo = mode === "gizmo" || mode === "both";
  editor.transform.enabled = showGizmo;
  helper.visible = showGizmo;
  if (!showGizmo) originalDetach();
  else {
    const active = editor.activeObject();
    if (active) originalAttach(active);
  }
}
modeSelect?.addEventListener("change", hardApplyManipulatorMode);
editor.on("selection", hardApplyManipulatorMode);
editor.on("changed", hardApplyManipulatorMode);
hardApplyManipulatorMode();

// -----------------------------------------------------------------------------
// Underside Z scale handle. When the camera goes below the object, the normal
// top height handle is replaced by one attached to the lower face.
// -----------------------------------------------------------------------------
const bottomZHandle = document.createElement("button");
bottomZHandle.type = "button";
bottomZHandle.className = "tm-scale-handle tm-bottom-z-handle hidden";
bottomZHandle.title = "Altura hacia abajo · Shift uniforme · Alt desde el centro";
overlay?.append(bottomZHandle);

type BottomDrag = {
  startX: number;
  startY: number;
  startSize: number;
  startCenter: THREE.Vector3;
  object: THREE.Object3D;
  position: THREE.Vector3;
  scale: THREE.Vector3;
};
let bottomDrag: BottomDrag | null = null;
let bottomPinned: { x: number; y: number } | null = null;

function cameraIsBelow(box: THREE.Box3) {
  const cameraWorld = new THREE.Vector3();
  editor.camera.getWorldPosition(cameraWorld);
  return cameraWorld.z < box.min.z - 0.01;
}

function refreshBottomHandle() {
  const info = activeBounds();
  const visible = Boolean(info) && (modeSelect?.value ?? "tinker") !== "gizmo";
  if (!info || !visible) {
    bottomZHandle.classList.add("hidden");
    if (topZHandle) topZHandle.style.display = "";
    return;
  }
  const below = cameraIsBelow(info.box);
  bottomZHandle.classList.toggle("hidden", !below);
  if (topZHandle) topZHandle.style.display = below ? "none" : "";
  if (!below) return;
  const p = bottomPinned ?? project(new THREE.Vector3(info.center.x, info.center.y, info.box.min.z));
  bottomZHandle.style.left = `${p.x}px`;
  bottomZHandle.style.top = `${p.y}px`;
}

bottomZHandle.addEventListener("pointerdown", (event) => {
  const info = activeBounds();
  if (!info || event.button !== 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  editor.checkpoint();
  bottomDrag = {
    startX: event.clientX,
    startY: event.clientY,
    startSize: info.size.z,
    startCenter: info.center.clone(),
    object: info.object,
    position: info.object.position.clone(),
    scale: info.object.scale.clone(),
  };
  const rect = viewport.getBoundingClientRect();
  bottomPinned = { x: event.clientX - rect.left, y: event.clientY - rect.top };
}, true);

window.addEventListener("pointermove", (event) => {
  if (!bottomDrag) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const rect = viewport.getBoundingClientRect();
  bottomPinned = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const dx = event.clientX - bottomDrag.startX;
  const dy = event.clientY - bottomDrag.startY;
  let faceMotion = scalarOnAxis(dx, dy, "z", bottomDrag.startCenter);
  const snap = editor.getSnap();
  const step = snap.enabled ? snap.gridSize * ((event.ctrlKey || event.metaKey) ? 0.1 : 1) : 0;
  if (step) faceMotion = snapValue(faceMotion, step);
  const fromCenter = event.altKey;
  const sizeDelta = -faceMotion * (fromCenter ? 2 : 1);
  const target = Math.max(0.01, bottomDrag.startSize + sizeDelta);
  const ratio = target / Math.max(0.0001, bottomDrag.startSize);
  bottomDrag.object.scale.copy(bottomDrag.scale);
  bottomDrag.object.position.copy(bottomDrag.position);
  if (event.shiftKey) {
    bottomDrag.object.scale.set(bottomDrag.scale.x * ratio, bottomDrag.scale.y * ratio, bottomDrag.scale.z * ratio);
  } else {
    bottomDrag.object.scale.z = bottomDrag.scale.z * ratio;
  }
  if (!fromCenter) bottomDrag.object.position.z = bottomDrag.position.z + faceMotion / 2;
  emitChanged();
}, true);

window.addEventListener("pointerup", (event) => {
  if (!bottomDrag) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  bottomDrag = null;
  bottomPinned = null;
  emitChanged();
}, true);

// -----------------------------------------------------------------------------
// Semantic zone selector.
// A dragged rectangle is stored in the parent object's LOCAL coordinates, so it
// follows every later move/rotate/scale and remains a stable semantic reference.
// -----------------------------------------------------------------------------
const zonePreview = new THREE.Group();
zonePreview.name = "__tm_zone_preview";
editor.scene.add(zonePreview);
const zoneSelection = new THREE.Group();
zoneSelection.name = "__tm_zone_selection";
editor.scene.add(zoneSelection);

const zoneLabel = document.createElement("div");
zoneLabel.className = "tm-zone-label hidden";
viewport.append(zoneLabel);

let zoneMode = false;
let selectedReference: SelectedReference = null;
let preservingReferenceSelection = false;

const originalSetSelection = editor.setSelection.bind(editor);
(editor as any).setSelection = (objects: THREE.Object3D[]) => {
  if (!preservingReferenceSelection) selectedReference = null;
  const result = originalSetSelection(objects);
  queueMicrotask(() => {
    decorateOutlinerReferences();
    renderSelectedReference();
  });
  return result;
};

function raycastActive(clientX: number, clientY: number) {
  const root = editor.activeObject();
  if (!root) return null;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, editor.camera);
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && node.visible) meshes.push(node);
  });
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? { root, hit } : null;
}

function worldNormalFromHit(hit: THREE.Intersection) {
  if (!hit.face) return new THREE.Vector3(0, 0, 1);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  return hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
}

function tangentBasis(root: THREE.Object3D, normal: THREE.Vector3) {
  root.updateMatrixWorld(true);
  const candidates = [
    new THREE.Vector3(1, 0, 0).transformDirection(root.matrixWorld),
    new THREE.Vector3(0, 1, 0).transformDirection(root.matrixWorld),
    new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld),
  ];
  let u = candidates
    .map((axis) => axis.clone().addScaledVector(normal, -axis.dot(normal)))
    .sort((a, b) => b.lengthSq() - a.lengthSq())[0];
  if (!u || u.lengthSq() < 1e-8) u = new THREE.Vector3(1, 0, 0);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

function rayToPlane(clientX: number, clientY: number, plane: THREE.Plane) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, editor.camera);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

type ZoneDraft = {
  pointerId: number;
  object: THREE.Object3D;
  start: THREE.Vector3;
  normal: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  plane: THREE.Plane;
  points: THREE.Vector3[];
};
let zoneDraft: ZoneDraft | null = null;

function clearGroup(group: THREE.Group) {
  while (group.children.length) {
    const child = group.children.pop()!;
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineLoop) {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material?.dispose?.());
    }
  }
}

function drawZone(group: THREE.Group, points: THREE.Vector3[], selected = false) {
  clearGroup(group);
  if (points.length !== 4) return;
  const normal = new THREE.Vector3().crossVectors(
    points[1].clone().sub(points[0]),
    points[3].clone().sub(points[0]),
  ).normalize();
  const lifted = points.map((point) => point.clone().addScaledVector(normal, 0.08));
  const geometry = new THREE.BufferGeometry().setFromPoints(lifted);
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: selected ? 0x00a9e0 : 0x42b8dd,
      transparent: true,
      opacity: selected ? 0.2 : 0.12,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  fill.renderOrder = 1800;
  const loopGeometry = new THREE.BufferGeometry().setFromPoints([...lifted, lifted[0]]);
  const line = new THREE.Line(
    loopGeometry,
    new THREE.LineBasicMaterial({ color: selected ? 0x0087b8 : 0x2ca7d0, depthTest: false }),
  );
  line.renderOrder = 1801;
  group.add(fill, line);
}

function updateDraft(point: THREE.Vector3) {
  if (!zoneDraft) return;
  const delta = point.clone().sub(zoneDraft.start);
  const du = delta.dot(zoneDraft.u);
  const dv = delta.dot(zoneDraft.v);
  const p0 = zoneDraft.start.clone();
  const p1 = p0.clone().addScaledVector(zoneDraft.u, du);
  const p2 = p1.clone().addScaledVector(zoneDraft.v, dv);
  const p3 = p0.clone().addScaledVector(zoneDraft.v, dv);
  zoneDraft.points = [p0, p1, p2, p3];
  drawZone(zonePreview, zoneDraft.points);
}

function nextZoneName(object: THREE.Object3D) {
  const typed = refNameInput?.value.trim();
  if (typed) return typed;
  const count = getMeta(object)?.references.filter((ref) => ref.kind === "zone").length ?? 0;
  return `Zona ${count + 1}`;
}

function finishZoneDraft() {
  const draft = zoneDraft;
  zoneDraft = null;
  clearGroup(zonePreview);
  if (!draft || draft.points.length !== 4) return;
  const width = draft.points[0].distanceTo(draft.points[1]);
  const height = draft.points[1].distanceTo(draft.points[2]);
  if (width < 0.2 || height < 0.2) {
    status("Zona demasiado pequeña. Arrastrá un área sobre la cara.");
    return;
  }
  editor.checkpoint();
  draft.object.updateMatrixWorld(true);
  const localPoints = draft.points.map((point) => {
    const local = draft.object.worldToLocal(point.clone());
    return [local.x, local.y, local.z] as [number, number, number];
  });
  const meta = getMeta(draft.object);
  if (!meta) return;
  const reference: ZoneReference = {
    id: makeId("ref"),
    kind: "zone",
    name: nextZoneName(draft.object),
    zone: { points: localPoints },
  };
  meta.references.push(reference as any);
  setMeta(draft.object, meta);
  if (refNameInput) refNameInput.value = "";
  selectedReference = { objectId: meta.id, refId: reference.id };
  zoneMode = false;
  viewport.classList.remove("tm-zone-mode");
  emitChanged();
  status(`Zona semántica “${reference.name}” creada.`);
}

function cancelZoneMode() {
  zoneMode = false;
  zoneDraft = null;
  clearGroup(zonePreview);
  viewport.classList.remove("tm-zone-mode");
  zoneButton.classList.remove("active");
}

const zoneToolRow = document.createElement("div");
zoneToolRow.className = "tm-zone-tool-row";
const zoneButton = document.createElement("button");
zoneButton.type = "button";
zoneButton.className = "tm-zone-tool";
zoneButton.textContent = "Marcar zona en cara";
zoneButton.title = "Arrastrá un rectángulo sobre una cara. Usa el nombre escrito arriba o crea Zona N.";
const zoneHelp = document.createElement("span");
zoneHelp.className = "tm-zone-help";
zoneHelp.textContent = "Esc cancela";
zoneToolRow.append(zoneButton, zoneHelp);
if (refsList?.parentElement) refsList.parentElement.insertBefore(zoneToolRow, refsList);

zoneButton.addEventListener("click", () => {
  if (!editor.activeObject()) {
    status("Seleccioná primero el objeto al que pertenece la zona.");
    return;
  }
  zoneMode = !zoneMode;
  zoneButton.classList.toggle("active", zoneMode);
  viewport.classList.toggle("tm-zone-mode", zoneMode);
  if (refKindSelect && zoneMode) refKindSelect.value = "zone";
  status(zoneMode ? "Arrastrá sobre una cara para marcar la zona semántica." : "Selector de zona cancelado.");
});

canvas.addEventListener("pointerdown", (event) => {
  if (!zoneMode || event.button !== 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const result = raycastActive(event.clientX, event.clientY);
  if (!result || !result.hit.face) {
    status("Empezá el arrastre sobre una cara visible del objeto seleccionado.");
    return;
  }
  const normal = worldNormalFromHit(result.hit);
  const { u, v } = tangentBasis(result.root, normal);
  const start = result.hit.point.clone();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start);
  zoneDraft = {
    pointerId: event.pointerId,
    object: result.root,
    start,
    normal,
    u,
    v,
    plane,
    points: [start.clone(), start.clone(), start.clone(), start.clone()],
  };
  canvas.setPointerCapture?.(event.pointerId);
}, true);

window.addEventListener("pointermove", (event) => {
  if (!zoneDraft || event.pointerId !== zoneDraft.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const point = rayToPlane(event.clientX, event.clientY, zoneDraft.plane);
  if (point) updateDraft(point);
}, true);

window.addEventListener("pointerup", (event) => {
  if (!zoneDraft || event.pointerId !== zoneDraft.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishZoneDraft();
  zoneButton.classList.remove("active");
}, true);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && zoneMode) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelZoneMode();
    status("Selector de zona cancelado.");
  }
}, true);

// -----------------------------------------------------------------------------
// References in the Blender-like outliner. They are children of their object,
// selectable and renameable. Selected zones are highlighted on the 3D model.
// -----------------------------------------------------------------------------
function referenceBySelection() {
  if (!selectedReference) return null;
  const object = editor.findById(selectedReference.objectId);
  const meta = object && getMeta(object);
  const reference = meta?.references.find((ref) => ref.id === selectedReference?.refId);
  return object && reference ? { object, reference } : null;
}

function renderSelectedReference() {
  clearGroup(zoneSelection);
  zoneLabel.classList.add("hidden");
  const selected = referenceBySelection();
  if (!selected || selected.reference.kind !== "zone") return;
  const zone = (selected.reference as any).zone as { points?: [number, number, number][] } | undefined;
  if (!zone?.points || zone.points.length !== 4) return;
  selected.object.updateMatrixWorld(true);
  const points = zone.points.map(([x, y, z]) => selected.object.localToWorld(new THREE.Vector3(x, y, z)));
  drawZone(zoneSelection, points, true);
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const p = project(center);
  zoneLabel.style.left = `${p.x}px`;
  zoneLabel.style.top = `${p.y}px`;
  zoneLabel.textContent = selected.reference.name;
  zoneLabel.classList.remove("hidden");
}

function selectReference(objectId: string, refId: string) {
  const object = editor.findById(objectId);
  const meta = object && getMeta(object);
  const reference = meta?.references.find((ref) => ref.id === refId);
  if (!object || !reference) return;
  preservingReferenceSelection = true;
  editor.setSelection([object]);
  preservingReferenceSelection = false;
  selectedReference = { objectId, refId };
  decorateOutlinerReferences();
  renderSelectedReference();
  status(`${reference.kind}: ${reference.name}`);
}

function renameReference(object: THREE.Object3D, refId: string, name: string) {
  const meta = getMeta(object);
  const reference = meta?.references.find((ref) => ref.id === refId);
  const clean = name.trim();
  if (!meta || !reference || !clean || reference.name === clean) return;
  editor.checkpoint();
  reference.name = clean;
  setMeta(object, meta);
  emitChanged();
}

function decorateOutlinerReferences() {
  outlinerTree.querySelectorAll(".tm-ref-row").forEach((row) => row.remove());
  const objectRows = [...outlinerTree.querySelectorAll<HTMLElement>(".outliner-row[data-id]")];
  for (const objectRow of objectRows.reverse()) {
    const objectId = objectRow.dataset.id;
    if (!objectId) continue;
    const object = editor.findById(objectId);
    const meta = object && getMeta(object);
    if (!object || !meta?.references.length) continue;
    const basePadding = Number.parseFloat(objectRow.style.paddingLeft || "4") || 4;
    for (const reference of [...meta.references].reverse()) {
      const row = document.createElement("div");
      row.className = `tm-ref-row${selectedReference?.objectId === objectId && selectedReference.refId === reference.id ? " selected" : ""}`;
      row.dataset.kind = reference.kind;
      row.dataset.refId = reference.id;
      row.style.paddingLeft = `${basePadding + 22}px`;
      const icon = document.createElement("span");
      icon.className = "tm-ref-icon";
      icon.textContent = reference.kind === "zone" ? "▣" : reference.kind.slice(0, 1).toUpperCase();
      const name = document.createElement("span");
      name.className = "tm-ref-name";
      name.textContent = reference.name;
      name.title = `${reference.kind}: ${reference.name} · doble click para renombrar`;
      row.append(icon, name);
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectReference(objectId, reference.id);
      });
      name.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        name.contentEditable = "true";
        name.focus();
        const range = document.createRange();
        range.selectNodeContents(name);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      const finishRename = () => {
        if (name.contentEditable !== "true") return;
        name.contentEditable = "false";
        renameReference(object, reference.id, name.textContent ?? reference.name);
      };
      name.addEventListener("blur", finishRename);
      name.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          name.blur();
        } else if (event.key === "Escape") {
          name.textContent = reference.name;
          name.contentEditable = "false";
          name.blur();
        }
      });
      objectRow.insertAdjacentElement("afterend", row);
    }
  }
}

editor.on("selection", () => {
  decorateOutlinerReferences();
  renderSelectedReference();
});
editor.on("changed", () => {
  decorateOutlinerReferences();
  renderSelectedReference();
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".tm-ref-row")) return;
  if (target?.closest(".outliner-row") || target === canvas) {
    selectedReference = null;
    renderSelectedReference();
  }
}, true);

requestAnimationFrame(function v042Loop() {
  hardApplyManipulatorMode();
  refreshBottomHandle();
  if (selectedReference) renderSelectedReference();
  requestAnimationFrame(v042Loop);
});

decorateOutlinerReferences();
renderSelectedReference();

Object.assign(window.tinkerMatt ?? {}, {
  selectReference,
  selectedReference: () => selectedReference ? { ...selectedReference } : null,
  references: () => editor.getSceneRoots().map((object) => ({
    objectId: getMeta(object)?.id,
    objectName: getMeta(object)?.name,
    references: structuredClone(getMeta(object)?.references ?? []),
  })),
});

status("TinkerMatt v0.4.2 · gizmo fantasma exorcizado · zonas semánticas activas.");
