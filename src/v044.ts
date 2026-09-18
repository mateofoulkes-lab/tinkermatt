import * as THREE from "three";
import { icon } from "@fortawesome/fontawesome-svg-core";
import { faGear, faDownload } from "@fortawesome/free-solid-svg-icons";
import "./v044.css";
import type { TinkerEditor } from "./editor";

type Axis = "x" | "y" | "z";
type ControlKind = "move" | "rotate";
type ControlInfo = { kind: ControlKind; axis: Axis };
type ObjectState = { object: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Euler };

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.4.4 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const toolbar = document.querySelector<HTMLElement>(".toolbar-shell") ?? document.body;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.4.4";

const modeBox = document.querySelector<HTMLElement>(".manipulator-mode-box");
const modeSelect = modeBox?.querySelector<HTMLSelectElement>("select") ?? null;

// -----------------------------------------------------------------------------
// Kill v0.4.3 controls; v0.4.4 replaces them with smaller camera-aware controls.
// -----------------------------------------------------------------------------
const legacyControls = editor.scene.getObjectByName("__tm_tinkercad_controls");
if (legacyControls) legacyControls.visible = false;

const controls = new THREE.Group();
controls.name = "__tm_tinkercad_controls_v044";
editor.scene.add(controls);

const normalColor = new THREE.Color(0x4d555a);
const hoverColor = new THREE.Color(0x0698d1);
const axisVector = (axis: Axis) => axis === "x"
  ? new THREE.Vector3(1, 0, 0)
  : axis === "y"
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

function controlMaterial(opacity = 0.88) {
  return new THREE.MeshBasicMaterial({
    color: normalColor,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function tag(root: THREE.Object3D, info: ControlInfo) {
  root.userData.tmControl = info;
  root.traverse((child) => { child.userData.tmControl = info; });
}

function makeMove(axis: Axis) {
  const root = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.92, 24), controlMaterial());
  cone.renderOrder = 2500;
  root.add(cone);
  tag(root, { kind: "move", axis });
  controls.add(root);
  return root;
}

function makeArcGeometry() {
  const start = THREE.MathUtils.degToRad(20);
  const end = THREE.MathUtils.degToRad(126);
  const outer = 1;
  const inner = 0.89;
  const steps = 32;
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

function makeArrowHeadGeometry() {
  const angle = THREE.MathUtils.degToRad(126);
  const end = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  const tangent = new THREE.Vector2(-Math.sin(angle), Math.cos(angle));
  const radial = end.clone().normalize();
  const tip = end.clone().add(tangent.clone().multiplyScalar(0.12));
  const back = end.clone().add(tangent.clone().multiplyScalar(-0.10));
  const a = back.clone().add(radial.clone().multiplyScalar(0.12));
  const b = back.clone().add(radial.clone().multiplyScalar(-0.12));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    tip.x, tip.y, 0.003,
    a.x, a.y, 0.003,
    b.x, b.y, 0.003,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeRotate(axis: Axis) {
  const root = new THREE.Group();
  const mat = controlMaterial(0.72);
  const arc = new THREE.Mesh(makeArcGeometry(), mat);
  const head = new THREE.Mesh(makeArrowHeadGeometry(), mat.clone());
  arc.renderOrder = 2490;
  head.renderOrder = 2491;
  root.add(arc, head);
  if (axis === "x") root.rotation.y = Math.PI / 2;
  else if (axis === "y") root.rotation.x = -Math.PI / 2;
  tag(root, { kind: "rotate", axis });
  controls.add(root);
  return root;
}

const moveControls = { x: makeMove("x"), y: makeMove("y"), z: makeMove("z") };
const rotateControls = { x: makeRotate("x"), y: makeRotate("y"), z: makeRotate("z") };

function boundsInfo() {
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

function manipulatorVisible() {
  return (modeSelect?.value ?? "tinker") !== "gizmo" && Boolean(editor.activeObject());
}

function cameraSide(axis: Axis, center: THREE.Vector3) {
  const toCamera = editor.camera.position.clone().sub(center);
  const dot = toCamera.dot(axisVector(axis));
  return dot >= 0 ? 1 : -1;
}

function orientCone(root: THREE.Object3D, axis: Axis, sign: number) {
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisVector(axis).multiplyScalar(sign));
}

function refreshControls() {
  if (legacyControls) legacyControls.visible = false;
  const info = boundsInfo();
  controls.visible = Boolean(info) && manipulatorVisible();
  if (!info || !controls.visible) return;

  const { center, size } = info;
  const wpp = worldPerPixel(center);
  const moveScale = 11 * wpp;
  const rotateScale = 28 * wpp; // fixed screen size: no giant arcs on large objects
  const gap = 10 * wpp;

  for (const axis of ["x", "y", "z"] as const) {
    const direction = axisVector(axis);
    const sign = cameraSide(axis, center);
    const half = size[axis] / 2;

    const move = moveControls[axis];
    move.position.copy(center).addScaledVector(direction, sign * (half + gap + moveScale * 0.38));
    move.scale.setScalar(moveScale);
    orientCone(move, axis, sign);

    const rotate = rotateControls[axis];
    rotate.position.copy(center).addScaledVector(direction, sign * (half + gap * 0.55));
    rotate.scale.setScalar(rotateScale);
  }
}
requestAnimationFrame(function loop() {
  refreshControls();
  requestAnimationFrame(loop);
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function controlAt(clientX: number, clientY: number) {
  if (!controls.visible) return null;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, editor.camera);
  const hit = raycaster.intersectObject(controls, true)[0]?.object;
  if (!hit) return null;
  let node: THREE.Object3D | null = hit;
  while (node && node !== controls) {
    if (node.userData.tmControl) return node.userData.tmControl as ControlInfo;
    node = node.parent;
  }
  return null;
}

function project(world: THREE.Vector3) {
  const rect = viewport.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return { x: (p.x * .5 + .5) * rect.width, y: (-p.y * .5 + .5) * rect.height };
}

function screenAxis(axis: Axis, origin: THREE.Vector3) {
  const a = project(origin);
  const b = project(origin.clone().add(axisVector(axis)));
  return new THREE.Vector2(b.x - a.x, b.y - a.y);
}

function scalarOnAxis(dx: number, dy: number, axis: Axis, origin: THREE.Vector3) {
  const v = screenAxis(axis, origin);
  const lenSq = v.lengthSq();
  return lenSq < 1e-8 ? 0 : (dx * v.x + dy * v.y) / lenSq;
}

function snap(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}

let drag: null | {
  kind: ControlKind;
  axis: Axis;
  startX: number;
  startY: number;
  center: THREE.Vector3;
  startAngle: number;
  facing: number;
  states: ObjectState[];
} = null;

function capture(): ObjectState[] {
  return editor.getSelection().map((object) => ({
    object,
    position: object.position.clone(),
    rotation: object.rotation.clone(),
  }));
}

function emitChanged() {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const info = controlAt(event.clientX, event.clientY);
  if (!info) return;
  const bounds = boundsInfo();
  if (!bounds) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  editor.checkpoint();
  const rect = viewport.getBoundingClientRect();
  const centerScreen = project(bounds.center);
  drag = {
    kind: info.kind,
    axis: info.axis,
    startX: event.clientX,
    startY: event.clientY,
    center: bounds.center.clone(),
    startAngle: Math.atan2(event.clientY - rect.top - centerScreen.y, event.clientX - rect.left - centerScreen.x),
    facing: cameraSide(info.axis, bounds.center),
    states: capture(),
  };
  editor.orbit.enabled = false;
}, true);

window.addEventListener("pointermove", (event) => {
  if (!drag) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  if (drag.kind === "move") {
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    let amount = scalarOnAxis(dx, dy, drag.axis, drag.center);
    const snapCfg = editor.getSnap();
    const mult = event.shiftKey ? 10 : event.altKey ? .1 : 1;
    if (snapCfg.enabled) amount = snap(amount, snapCfg.gridSize * mult);
    for (const state of drag.states) {
      state.object.position.copy(state.position);
      state.object.position[drag.axis] += amount;
    }
  } else {
    const rect = viewport.getBoundingClientRect();
    const c = project(drag.center);
    const angle = Math.atan2(event.clientY - rect.top - c.y, event.clientX - rect.left - c.x);
    let delta = THREE.MathUtils.radToDeg(angle - drag.startAngle);
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;

    // Screen atan2 grows clockwise because Y points down. Flip it, and flip again
    // when the camera sees the negative side of the rotation plane.
    delta *= -drag.facing;

    const radius = Math.hypot(event.clientX - rect.left - c.x, event.clientY - rect.top - c.y);
    const snapDeg = radius < 72 ? 45 : radius < 130 ? 15 : 0;
    if (snapDeg) delta = snap(delta, snapDeg);
    const radians = THREE.MathUtils.degToRad(delta);
    for (const state of drag.states) {
      state.object.rotation.copy(state.rotation);
      state.object.rotation[drag.axis] += radians;
    }
  }
  emitChanged();
}, true);

window.addEventListener("pointerup", () => {
  if (!drag) return;
  drag = null;
  editor.orbit.enabled = true;
  emitChanged();
}, true);

let hovered: ControlInfo | null = null;
function recolor() {
  controls.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const info = object.userData.tmControl as ControlInfo | undefined;
    const material = object.material;
    if (!info || !(material instanceof THREE.MeshBasicMaterial) || material.opacity < .01) return;
    const active = hovered?.kind === info.kind && hovered.axis === info.axis;
    material.color.copy(active ? hoverColor : normalColor);
  });
}
canvas.addEventListener("pointermove", (event) => {
  if (drag) return;
  const next = controlAt(event.clientX, event.clientY);
  const changed = next?.kind !== hovered?.kind || next?.axis !== hovered?.axis;
  hovered = next;
  if (changed) recolor();
  canvas.style.cursor = "default";
}, true);

// -----------------------------------------------------------------------------
// Settings menu: manipulator selector + PWA installation.
// -----------------------------------------------------------------------------
const settingsButton = document.createElement("button");
settingsButton.type = "button";
settingsButton.className = "tm-settings-button";
settingsButton.title = "Opciones";
settingsButton.setAttribute("aria-label", "Opciones");
settingsButton.innerHTML = icon(faGear).html.join("");

toolbar.append(settingsButton);

const settings = document.createElement("div");
settings.className = "tm-settings-menu hidden";
settings.innerHTML = `
  <div class="tm-settings-title">Opciones</div>
  <div class="tm-settings-section tm-widget-slot"></div>
  <button type="button" class="tm-install-pwa">
    <span class="tm-install-icon">${icon(faDownload).html.join("")}</span>
    <span><b>Instalar TinkerMatt</b><small>Usarlo como aplicación offline</small></span>
  </button>
  <div class="tm-install-note"></div>
`;
document.body.append(settings);

const widgetSlot = settings.querySelector<HTMLElement>(".tm-widget-slot")!;
if (modeBox) {
  modeBox.classList.add("tm-settings-widget-choice");
  const label = modeBox.querySelector("span");
  if (label) label.textContent = "Manipulador";
  widgetSlot.append(modeBox);
}

function positionSettings() {
  const rect = settingsButton.getBoundingClientRect();
  settings.style.top = `${rect.bottom + 6}px`;
  settings.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
}
settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  settings.classList.toggle("hidden");
  if (!settings.classList.contains("hidden")) positionSettings();
});
document.addEventListener("pointerdown", (event) => {
  if (settings.classList.contains("hidden")) return;
  const target = event.target as Node;
  if (!settings.contains(target) && !settingsButton.contains(target)) settings.classList.add("hidden");
});
window.addEventListener("resize", () => {
  if (!settings.classList.contains("hidden")) positionSettings();
});

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
let installPrompt: InstallPromptEvent | null = null;
const installButton = settings.querySelector<HTMLButtonElement>(".tm-install-pwa")!;
const installNote = settings.querySelector<HTMLElement>(".tm-install-note")!;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

function refreshInstallUi() {
  if (isStandalone()) {
    installButton.disabled = true;
    installButton.querySelector("b")!.textContent = "TinkerMatt instalado";
    installNote.textContent = "Ya está ejecutándose como aplicación.";
  } else if (installPrompt) {
    installButton.disabled = false;
    installButton.querySelector("b")!.textContent = "Instalar TinkerMatt";
    installNote.textContent = "Se instalará como PWA y podrá abrirse sin conexión.";
  } else {
    installButton.disabled = false;
    installButton.querySelector("b")!.textContent = "Instalar TinkerMatt";
    installNote.textContent = "Si el navegador todavía no ofrece instalación, abrí esta opción de nuevo tras recargar una vez.";
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as InstallPromptEvent;
  refreshInstallUi();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  refreshInstallUi();
});
installButton.addEventListener("click", async () => {
  if (isStandalone()) return;
  if (!installPrompt) {
    installNote.textContent = "El navegador todavía no entregó el diálogo de instalación. Recargá la app una vez y volvé a Opciones.";
    return;
  }
  await installPrompt.prompt();
  const result = await installPrompt.userChoice;
  installNote.textContent = result.outcome === "accepted" ? "Instalación iniciada." : "Instalación cancelada.";
  if (result.outcome === "accepted") installPrompt = null;
  refreshInstallUi();
});
refreshInstallUi();

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.4.4 · controles compactos + menú de opciones.";
