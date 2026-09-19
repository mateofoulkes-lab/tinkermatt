import * as THREE from "three";
import "./v063.css";
import { createAdvancedPrimitive, type AdvancedPrimitiveKind } from "./v050-geometry";
import { createBox, createCylinder, createSphere, materialFor } from "./geometry";
import { getMeta, setMeta, type SolidMode } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

type Axis = "x" | "y" | "z";
type DragPrimitive = {
  pointerId: number;
  source: HTMLElement;
  startX: number;
  startY: number;
  dragging: boolean;
  descriptor: PrimitiveDescriptor;
  preview: THREE.Object3D | null;
};
type PrimitiveDescriptor =
  | { family: "basic"; kind: "box" | "cylinder" | "sphere"; mode: SolidMode }
  | { family: "advanced"; kind: AdvancedPrimitiveKind };

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.3 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.3";
const setStatus = (text: string) => { if (status) status.textContent = text; };
const axisVector = (axis: Axis) => axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

// -----------------------------------------------------------------------------
// World-facing dimensions.
// Inspector and in-scene dimensions display the CURRENT world AABB. Previously
// setActiveDimension blindly scaled object.scale.z, etc., so after a 90° rotation
// the number labelled Z changed the object's former local Z instead of current Z.
// Probe the three local scale axes and choose the one that actually controls the
// requested world dimension most strongly. This is exact for orthogonal CAD
// rotations and remains useful for arbitrary orientations.
// -----------------------------------------------------------------------------
function worldSize(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
}

rawEditor.setActiveDimension = (axis: Axis, value: number) => {
  const object = editor.activeObject();
  if (!object || !Number.isFinite(value) || value <= 0) return;
  const baseSize = worldSize(object);
  const current = baseSize[axis];
  if (!(current > 1e-8)) return;

  const localAxes: Axis[] = ["x", "y", "z"];
  const sensitivity = new Map<Axis, number>();
  const probe = 1.01;
  for (const local of localAxes) {
    const original = object.scale[local];
    object.scale[local] = original * probe;
    const changed = worldSize(object)[axis];
    object.scale[local] = original;
    object.updateMatrixWorld(true);
    sensitivity.set(local, (changed - current) / (probe - 1));
  }

  let localAxis = localAxes[0];
  for (const candidate of localAxes) {
    if (Math.abs(sensitivity.get(candidate) ?? 0) > Math.abs(sensitivity.get(localAxis) ?? 0)) localAxis = candidate;
  }
  const derivative = sensitivity.get(localAxis) ?? 0;
  let factor = Math.abs(derivative) > 1e-7 ? 1 + (value - current) / derivative : value / current;
  if (!Number.isFinite(factor) || factor <= 0.0001) factor = Math.max(0.0001, value / current);
  object.scale[localAxis] *= factor;
  object.updateMatrixWorld(true);
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
};

// -----------------------------------------------------------------------------
// Rotation visuals. v0.6.0 restored the snapping behavior but the guide was too
// subtle and the visible arrows were still fussy. Thicken/shorten the 3D arrows;
// CSS below makes the three translucent bands and graduations unmistakable.
// -----------------------------------------------------------------------------
function rotationArcGeometry(start = THREE.MathUtils.degToRad(34), end = THREE.MathUtils.degToRad(104)) {
  const outer = 1;
  const inner = 0.59;
  const steps = 32;
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i += 1) {
    const a = THREE.MathUtils.lerp(start, end, i / steps);
    const p = new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(outer);
    if (!i) shape.moveTo(p.x, p.y); else shape.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const a = THREE.MathUtils.lerp(start, end, i / steps);
    shape.lineTo(Math.cos(a) * inner, Math.sin(a) * inner);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}
function rotationHeadGeometry(angle = THREE.MathUtils.degToRad(104)) {
  const end = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  const tangent = new THREE.Vector2(-Math.sin(angle), Math.cos(angle));
  const radial = end.clone().normalize();
  const tip = end.clone().add(tangent.clone().multiplyScalar(0.30));
  const back = end.clone().add(tangent.clone().multiplyScalar(-0.14));
  const left = back.clone().add(radial.clone().multiplyScalar(0.27));
  const right = back.clone().add(radial.clone().multiplyScalar(-0.27));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    tip.x, tip.y, 0.006,
    left.x, left.y, 0.006,
    right.x, right.y, 0.006,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}
function makeRotationArrowsChunkier() {
  const controls = editor.scene.getObjectByName("__tm_tinkercad_controls");
  if (!controls) return;
  for (const axis of ["x", "y", "z"] as const) {
    const root = controls.getObjectByName(`tm_rotate_${axis}`);
    if (!root || root.userData.tmWideRotationV3) continue;
    const meshes = root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const visible = meshes.filter((mesh) => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return !(material instanceof THREE.MeshBasicMaterial) || material.opacity > 0.01;
    });
    if (visible[0]) { visible[0].geometry.dispose(); visible[0].geometry = rotationArcGeometry(); }
    if (visible[1]) { visible[1].geometry.dispose(); visible[1].geometry = rotationHeadGeometry(); }
    const pick = meshes.find((mesh) => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return material instanceof THREE.MeshBasicMaterial && material.opacity <= 0.01;
    });
    if (pick) {
      pick.geometry.dispose();
      pick.geometry = new THREE.TorusGeometry(0.82, 0.34, 10, 44, THREE.MathUtils.degToRad(78));
      pick.rotation.z = THREE.MathUtils.degToRad(30);
    }
    root.userData.tmWideRotationV3 = true;
  }
}
queueMicrotask(makeRotationArrowsChunkier);

// -----------------------------------------------------------------------------
// Alignment box replaces the permanent shortcut hint. It only exists visually
// for a multi-selection. Hover = non-destructive ghost preview; click = commit.
// -----------------------------------------------------------------------------
document.querySelector<HTMLElement>(".viewport-chip")?.remove();
const oldAlignGroup = document.querySelector<HTMLElement>(".align-group");
if (oldAlignGroup) oldAlignGroup.style.display = "none";

const alignBox = document.createElement("div");
alignBox.className = "tm-align-box hidden";
alignBox.innerHTML = `<div class="tm-align-title">Alinear</div><div class="tm-align-buttons"><button type="button" data-axis="x">X</button><button type="button" data-axis="y">Y</button><button type="button" data-axis="z">Z</button></div>`;
viewport.append(alignBox);

const alignGhost = new THREE.Group();
alignGhost.name = "__tm_align_preview";
alignGhost.visible = false;
editor.scene.add(alignGhost);

function clearAlignGhost() {
  for (const child of [...alignGhost.children]) {
    child.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach((material) => material.dispose());
      }
    });
    child.removeFromParent();
  }
  alignGhost.visible = false;
}
function ghostMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x0b9ed0, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
}
function previewAlign(axis: Axis) {
  clearAlignGhost();
  const selected = editor.getSelection();
  if (selected.length < 2) return;
  selected.forEach((object) => object.updateMatrixWorld(true));
  const target = new THREE.Box3().setFromObject(selected[0]).getCenter(new THREE.Vector3())[axis];
  for (const object of selected) {
    const current = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3())[axis];
    const clone = object.clone(true);
    clone.traverse((node) => {
      delete node.userData.tinker;
      if (node instanceof THREE.Mesh) node.material = ghostMaterial();
    });
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(object.matrixWorld);
    const position = new THREE.Vector3().setFromMatrixPosition(clone.matrix);
    position[axis] += target - current;
    clone.matrix.setPosition(position);
    clone.renderOrder = 3000;
    alignGhost.add(clone);
  }
  alignGhost.visible = true;
}

function worldAlign(axis: Axis) {
  const selected = editor.getSelection();
  if (selected.length < 2) return;
  editor.checkpoint();
  selected.forEach((object) => object.updateMatrixWorld(true));
  const target = new THREE.Box3().setFromObject(selected[0]).getCenter(new THREE.Vector3())[axis];
  for (let i = 1; i < selected.length; i += 1) {
    const object = selected[i];
    const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    worldPosition[axis] += target - center[axis];
    if (object.parent) object.position.copy(object.parent.worldToLocal(worldPosition));
    else object.position.copy(worldPosition);
  }
  clearAlignGhost();
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(`Alineado en ${axis.toUpperCase()}.`);
}

for (const button of alignBox.querySelectorAll<HTMLButtonElement>("button[data-axis]")) {
  const axis = button.dataset.axis as Axis;
  button.addEventListener("pointerenter", () => previewAlign(axis));
  button.addEventListener("pointerleave", clearAlignGhost);
  button.addEventListener("focus", () => previewAlign(axis));
  button.addEventListener("blur", clearAlignGhost);
  button.addEventListener("click", () => worldAlign(axis));
}
function refreshAlignBox() {
  const multi = editor.getSelection().length > 1;
  alignBox.classList.toggle("hidden", !multi);
  if (!multi) clearAlignGhost();
}
editor.on("selection", refreshAlignBox);
editor.on("changed", () => { if (alignGhost.visible) clearAlignGhost(); refreshAlignBox(); });
refreshAlignBox();

// Keep the old toolbar commands consistent if keyboard/legacy UI invokes them.
rawEditor.align = worldAlign;

// -----------------------------------------------------------------------------
// Drag primitives from the library onto the workplane. We use a real 3D ghost
// during the drag, then create the actual semantic object only on drop, so a
// cancelled drag creates no history/autosave noise.
// -----------------------------------------------------------------------------
const advancedByLabel: Record<string, AdvancedPrimitiveKind> = {
  "Cono": "cone",
  "Pirámide": "pyramid",
  "Techo": "roof",
  "Cuña": "wedge",
  "Bóveda": "halfCylinder",
  "Cúpula": "dome",
  "Toro": "torus",
  "Anillo": "washer",
  "Prisma": "prism",
  "Poliedro": "polyhedron",
};

function primitiveDescriptorFor(target: EventTarget | null): { source: HTMLElement; descriptor: PrimitiveDescriptor } | null {
  const element = (target as HTMLElement | null)?.closest<HTMLElement>(".library-item[data-shape], .tm-v050-parent, .tm-v050-choice");
  if (!element) return null;
  if (element.matches(".library-item[data-shape]")) {
    const kind = element.dataset.shape;
    if (kind !== "box" && kind !== "cylinder" && kind !== "sphere") return null;
    return { source: element, descriptor: { family: "basic", kind, mode: (element.dataset.mode ?? "solid") as SolidMode } };
  }
  const label = element.title?.trim() || element.textContent?.replace(/\s+/g, " ").trim() || "";
  const kind = advancedByLabel[label];
  return kind ? { source: element, descriptor: { family: "advanced", kind } } : null;
}

function makePrimitive(descriptor: PrimitiveDescriptor) {
  if (descriptor.family === "advanced") return createAdvancedPrimitive(descriptor.kind);
  const object = descriptor.kind === "box" ? createBox() : descriptor.kind === "cylinder" ? createCylinder() : createSphere();
  if (descriptor.mode === "hole") {
    const meta = getMeta(object);
    if (meta) {
      meta.mode = "hole";
      setMeta(object, meta);
      object.traverse((node) => { if (node instanceof THREE.Mesh) node.material = materialFor(meta.material, "hole"); });
    }
  }
  return object;
}
function makePreview(descriptor: PrimitiveDescriptor) {
  const preview = makePrimitive(descriptor);
  preview.traverse((node) => {
    delete node.userData.tinker;
    if (node instanceof THREE.Mesh) {
      node.material = new THREE.MeshBasicMaterial({ color: 0x079bd0, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    }
  });
  preview.name = "__tm_drag_primitive_preview";
  return preview;
}
function pointerOnWorkplane(clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, editor.camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
}
function insideViewport(clientX: number, clientY: number) {
  const rect = viewport.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}
function placeOnPointer(object: THREE.Object3D, clientX: number, clientY: number) {
  const point = pointerOnWorkplane(clientX, clientY);
  if (!point) return false;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x += point.x - center.x;
  object.position.y += point.y - center.y;
  object.updateMatrixWorld(true);
  const adjusted = new THREE.Box3().setFromObject(object);
  object.position.z -= adjusted.min.z;
  object.updateMatrixWorld(true);
  return true;
}
function disposePreview(preview: THREE.Object3D | null) {
  if (!preview) return;
  preview.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((material) => material.dispose());
    }
  });
  preview.removeFromParent();
}

let primitiveDrag: DragPrimitive | null = null;
document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || primitiveDrag) return;
  const found = primitiveDescriptorFor(event.target);
  if (!found) return;
  primitiveDrag = {
    pointerId: event.pointerId,
    source: found.source,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    descriptor: found.descriptor,
    preview: null,
  };
}, true);

window.addEventListener("pointermove", (event) => {
  const drag = primitiveDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6) {
    drag.dragging = true;
    drag.source.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: event.pointerId, pointerType: event.pointerType }));
    drag.preview = makePreview(drag.descriptor);
    editor.scene.add(drag.preview);
    viewport.classList.add("tm-primitive-dragging");
  }
  if (!drag.dragging || !drag.preview) return;
  drag.preview.visible = insideViewport(event.clientX, event.clientY);
  if (drag.preview.visible) placeOnPointer(drag.preview, event.clientX, event.clientY);
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function finishPrimitiveDrag(event: PointerEvent, cancelled = false) {
  const drag = primitiveDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  primitiveDrag = null;
  viewport.classList.remove("tm-primitive-dragging");
  if (!drag.dragging) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const canDrop = !cancelled && insideViewport(event.clientX, event.clientY);
  disposePreview(drag.preview);
  if (!canDrop) {
    setStatus("Arrastre de primitiva cancelado.");
    return;
  }
  const object = makePrimitive(drag.descriptor);
  if (!placeOnPointer(object, event.clientX, event.clientY)) return;
  editor.addObject(object);
  setStatus(`${getMeta(object)?.name ?? "Primitiva"} colocada en el plano de trabajo.`);
}
window.addEventListener("pointerup", (event) => finishPrimitiveDrag(event, false), true);
window.addEventListener("pointercancel", (event) => finishPrimitiveDrag(event, true), true);

Object.assign(window.tinkerMatt, {
  alignSelection: (axis: Axis) => worldAlign(axis),
  setWorldDimension: (axis: Axis, value: number) => rawEditor.setActiveDimension(axis, value),
});

setStatus("TinkerMatt v0.6.3 · dimensiones mundiales + guía de rotación + alineación preview + drag de primitivas.");
