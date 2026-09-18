import * as THREE from "three";
import "./v043.css";
import type { TinkerEditor } from "./editor";

type Axis = "x" | "y" | "z";
type ControlKind = "move" | "rotate";
type ControlInfo = { kind: ControlKind; axis: Axis };

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.4.3 no pudo acceder al editor.");
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const modeSelect = document.querySelector<HTMLSelectElement>(".manipulator-mode-box select");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.4.3";

// -----------------------------------------------------------------------------
// PWA/offline base. The service worker caches Vite's generated assets as they
// are used, so after the first online visit the editor can reopen offline.
// -----------------------------------------------------------------------------
if (!document.querySelector('link[rel="manifest"]')) {
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = "./manifest.webmanifest";
  document.head.append(manifest);
}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => undefined);
  });
}

// -----------------------------------------------------------------------------
// Tinkercad-style in-scene controls.
// Scale handles remain the precise square DOM handles. Move and rotate controls
// become actual 3D geometry: cones for translation and flat curved arrows for
// rotation. They proxy into the existing transform engine, so behavior stays
// consistent with snap/modifier logic already implemented.
// -----------------------------------------------------------------------------
const controls = new THREE.Group();
controls.name = "__tm_tinkercad_controls";
editor.scene.add(controls);

const normalColor = new THREE.Color(0x50575c);
const hoverColor = new THREE.Color(0x0b95c7);
const axisVector = (axis: Axis) =>
  axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

function tagControl(root: THREE.Object3D, info: ControlInfo) {
  root.userData.tmControl = info;
  root.traverse((child) => {
    child.userData.tmControl = info;
  });
}

function controlMaterial(opacity = 0.92) {
  return new THREE.MeshBasicMaterial({
    color: normalColor,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function makeMoveControl(axis: Axis) {
  const root = new THREE.Group();
  root.name = `tm_move_${axis}`;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1, 24), controlMaterial());
  cone.renderOrder = 2200;
  root.add(cone);
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisVector(axis));
  tagControl(root, { kind: "move", axis });
  controls.add(root);
  return root;
}

function makeFlatArcGeometry(start = THREE.MathUtils.degToRad(18), end = THREE.MathUtils.degToRad(132)) {
  const outer = 1;
  const inner = 0.91;
  const steps = 40;
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i += 1) {
    const a = THREE.MathUtils.lerp(start, end, i / steps);
    const x = Math.cos(a) * outer;
    const y = Math.sin(a) * outer;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const a = THREE.MathUtils.lerp(start, end, i / steps);
    shape.lineTo(Math.cos(a) * inner, Math.sin(a) * inner);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function makeArrowHeadGeometry(angle = THREE.MathUtils.degToRad(132)) {
  const end = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  const tangent = new THREE.Vector2(-Math.sin(angle), Math.cos(angle));
  const radial = end.clone().normalize();
  const tip = end.clone().add(tangent.clone().multiplyScalar(0.15));
  const back = end.clone().add(tangent.clone().multiplyScalar(-0.11));
  const left = back.clone().add(radial.clone().multiplyScalar(0.14));
  const right = back.clone().add(radial.clone().multiplyScalar(-0.14));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    tip.x, tip.y, 0.002,
    left.x, left.y, 0.002,
    right.x, right.y, 0.002,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeRotationControl(axis: Axis) {
  const root = new THREE.Group();
  root.name = `tm_rotate_${axis}`;
  const material = controlMaterial(0.72);
  const arc = new THREE.Mesh(makeFlatArcGeometry(), material);
  const head = new THREE.Mesh(makeArrowHeadGeometry(), material.clone());
  arc.renderOrder = 2190;
  head.renderOrder = 2191;
  root.add(arc, head);

  // Wide invisible torus improves hit-testing without making the arrow visually fat.
  const pick = new THREE.Mesh(
    new THREE.TorusGeometry(0.955, 0.14, 8, 56, THREE.MathUtils.degToRad(116)),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false }),
  );
  pick.rotation.z = THREE.MathUtils.degToRad(18);
  root.add(pick);

  if (axis === "x") root.rotation.y = Math.PI / 2;
  else if (axis === "y") root.rotation.x = -Math.PI / 2;
  tagControl(root, { kind: "rotate", axis });
  controls.add(root);
  return root;
}

const moveControls = {
  x: makeMoveControl("x"),
  y: makeMoveControl("y"),
  z: makeMoveControl("z"),
};
const rotateControls = {
  x: makeRotationControl("x"),
  y: makeRotationControl("y"),
  z: makeRotationControl("z"),
};

const proxyMove = {
  x: document.querySelector<HTMLElement>(".tm-move-x"),
  y: document.querySelector<HTMLElement>(".tm-move-y"),
  z: document.querySelector<HTMLElement>(".tm-move-z"),
};
const proxyRotate = {
  x: document.querySelector<HTMLElement>(".tm-rotate-x"),
  y: document.querySelector<HTMLElement>(".tm-rotate-y"),
  z: document.querySelector<HTMLElement>(".tm-rotate-z"),
};

function activeBounds() {
  const object = editor.activeObject();
  if (!object || !object.visible) return null;
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return { box, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
}

function worldPerPixel(point: THREE.Vector3) {
  const distance = editor.camera.position.distanceTo(point);
  const fov = THREE.MathUtils.degToRad(editor.camera.fov);
  return (2 * Math.tan(fov / 2) * distance) / Math.max(1, viewport.clientHeight);
}

function tinkerControlsVisible() {
  return (modeSelect?.value ?? "tinker") !== "gizmo" && Boolean(editor.activeObject());
}

function refreshControls() {
  const info = activeBounds();
  controls.visible = Boolean(info) && tinkerControlsVisible();
  if (!info || !controls.visible) return;
  const { box, center, size } = info;
  const wpp = worldPerPixel(center);
  const gap = 13 * wpp;
  const coneScale = 13 * wpp;

  for (const axis of ["x", "y", "z"] as const) {
    const half = size[axis] / 2;
    const direction = axisVector(axis);
    const move = moveControls[axis];
    move.position.copy(center).addScaledVector(direction, half + gap + coneScale * 0.35);
    move.scale.setScalar(coneScale);
  }

  const radius = Math.max(size.x, size.y, size.z) * 0.5 + 24 * wpp;
  for (const axis of ["x", "y", "z"] as const) {
    rotateControls[axis].position.copy(center);
    rotateControls[axis].scale.setScalar(radius);
  }
}
requestAnimationFrame(function controlLoop() {
  refreshControls();
  requestAnimationFrame(controlLoop);
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
raycaster.params.Line = { threshold: 0.2 };

function controlAt(clientX: number, clientY: number) {
  if (!controls.visible) return null;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, editor.camera);
  const hit = raycaster.intersectObject(controls, true)[0]?.object;
  if (!hit) return null;
  let current: THREE.Object3D | null = hit;
  while (current && current !== controls) {
    if (current.userData.tmControl) return current.userData.tmControl as ControlInfo;
    current = current.parent;
  }
  return null;
}

function proxyPointerDown(target: HTMLElement | null, source: PointerEvent) {
  if (!target) return;
  target.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    pointerId: source.pointerId,
    pointerType: source.pointerType,
    clientX: source.clientX,
    clientY: source.clientY,
    button: 0,
    buttons: 1,
    shiftKey: source.shiftKey,
    altKey: source.altKey,
    ctrlKey: source.ctrlKey,
    metaKey: source.metaKey,
  }));
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const info = controlAt(event.clientX, event.clientY);
  if (!info) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (info.kind === "move") proxyPointerDown(proxyMove[info.axis], event);
  else proxyPointerDown(proxyRotate[info.axis], event);
}, true);

let hovered: ControlInfo | null = null;
function recolorControls() {
  controls.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const info = object.userData.tmControl as ControlInfo | undefined;
    const material = object.material;
    if (!info || !(material instanceof THREE.MeshBasicMaterial) || material.opacity < 0.01) return;
    const active = hovered && hovered.kind === info.kind && hovered.axis === info.axis;
    material.color.copy(active ? hoverColor : normalColor);
  });
}
canvas.addEventListener("pointermove", (event) => {
  const next = controlAt(event.clientX, event.clientY);
  const changed = next?.kind !== hovered?.kind || next?.axis !== hovered?.axis;
  hovered = next;
  if (changed) recolorControls();
  canvas.style.cursor = "default";
}, true);
canvas.addEventListener("pointerleave", () => {
  hovered = null;
  recolorControls();
  canvas.style.cursor = "default";
});

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.4.3 · controles Tinker 3D + base offline lista.";
