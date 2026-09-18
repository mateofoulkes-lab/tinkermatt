import * as THREE from "three";
import "./v041.css";
import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";

type Axis = "x" | "y" | "z";
type Sign = -1 | 1;

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.4.1 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.4.1";

// -----------------------------------------------------------------------------
// Camera controls: MMB pan, RMB orbit, wheel zoom. LMB stays free for selection.
// -----------------------------------------------------------------------------
(editor.orbit.mouseButtons as any).LEFT = -1;
(editor.orbit.mouseButtons as any).MIDDLE = THREE.MOUSE.PAN;
(editor.orbit.mouseButtons as any).RIGHT = THREE.MOUSE.ROTATE;
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

// -----------------------------------------------------------------------------
// Hole appearance: same shaded solid, dark + transparent; never wireframe.
// -----------------------------------------------------------------------------
const HOLE_VERSION = "0.4.1";
function refreshHoleAppearance() {
  for (const root of editor.getSceneRoots()) {
    const meta = getMeta(root);
    if (!meta) continue;
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (meta.mode !== "hole") {
        delete node.userData.tmHoleStyle;
        return;
      }
      const current = Array.isArray(node.material) ? node.material[0] : node.material;
      const stale = node.userData.tmHoleStyle !== HOLE_VERSION ||
        !(current instanceof THREE.MeshStandardMaterial) ||
        current.wireframe || !current.transparent || current.opacity > 0.5;
      if (!stale) return;
      node.material = new THREE.MeshStandardMaterial({
        color: 0x26343e,
        roughness: 0.7,
        metalness: 0.04,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        side: THREE.DoubleSide,
        wireframe: false,
      });
      node.userData.tmHoleStyle = HOLE_VERSION;
    });
  }
}
editor.on("changed", refreshHoleAppearance);
editor.on("selection", refreshHoleAppearance);
refreshHoleAppearance();

// -----------------------------------------------------------------------------
// Photoshop-like compact tool families.
// Short click = current child. Long press = flyout. Picked child becomes parent.
// -----------------------------------------------------------------------------
const flyout = document.createElement("div");
flyout.className = "tm-tool-flyout hidden";
document.body.append(flyout);

let openFamily: HTMLDetailsElement | null = null;
let activeParent: HTMLElement | null = null;

function closeFlyout() {
  flyout.classList.add("hidden");
  flyout.innerHTML = "";
  openFamily = null;
  activeParent = null;
}

function itemLabel(item: HTMLButtonElement) {
  return item.title || item.textContent?.replace(/\s+/g, " ").trim() || "Herramienta";
}

function itemIconHtml(item: HTMLButtonElement) {
  const icon = item.querySelector<HTMLElement>(".mini-shape");
  return icon?.innerHTML ?? "";
}

function setParentChoice(summary: HTMLElement, item: HTMLButtonElement) {
  summary.dataset.activeToolId = item.id || "";
  summary.dataset.activeToolIndex = String([...item.parentElement!.querySelectorAll(":scope > .library-item")].indexOf(item));
  summary.title = itemLabel(item);
  summary.innerHTML = `<span class="tm-tool-current">${itemIconHtml(item)}</span><span class="tm-tool-corner">◢</span>`;
}

function openToolFlyout(family: HTMLDetailsElement, summary: HTMLElement, items: HTMLButtonElement[]) {
  openFamily = family;
  activeParent = summary;
  flyout.innerHTML = "";
  for (const item of items) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "tm-tool-flyout-item";
    choice.disabled = item.disabled || item.classList.contains("disabled-item");
    choice.title = itemLabel(item);
    choice.innerHTML = `<span class="mini-shape">${itemIconHtml(item)}</span><span>${itemLabel(item)}</span>`;
    choice.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (choice.disabled) return;
      setParentChoice(summary, item);
      closeFlyout();
      item.click();
    });
    flyout.append(choice);
  }
  const rect = summary.getBoundingClientRect();
  flyout.style.left = `${rect.right + 6}px`;
  flyout.style.top = `${Math.max(8, Math.min(window.innerHeight - 70, rect.top))}px`;
  flyout.classList.remove("hidden");
}

for (const family of document.querySelectorAll<HTMLDetailsElement>(".library-family")) {
  const summary = family.querySelector<HTMLElement>(":scope > summary");
  const items = [...family.querySelectorAll<HTMLButtonElement>(":scope > .library-item")];
  if (!summary || !items.length) continue;
  family.open = false;
  family.classList.add("tm-photoshop-family");
  const firstUsable = items.find((item) => !item.disabled && !item.classList.contains("disabled-item")) ?? items[0];
  setParentChoice(summary, firstUsable);

  let timer: number | undefined;
  let longPress = false;
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  summary.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    longPress = false;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      longPress = true;
      openToolFlyout(family, summary, items);
    }, 430);
  });
  summary.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    window.clearTimeout(timer);
    if (longPress) return;
    const index = Number(summary.dataset.activeToolIndex ?? 0);
    const active = items[Math.max(0, Math.min(items.length - 1, index))];
    if (active && !active.disabled && !active.classList.contains("disabled-item")) active.click();
  });
  summary.addEventListener("pointercancel", () => window.clearTimeout(timer));
}

document.addEventListener("pointerdown", (event) => {
  if (flyout.classList.contains("hidden")) return;
  const target = event.target as Node;
  if (!flyout.contains(target) && !(activeParent?.contains(target))) closeFlyout();
});
window.addEventListener("resize", closeFlyout);

// -----------------------------------------------------------------------------
// Tinker widget refinements.
// -----------------------------------------------------------------------------
const overlay = document.querySelector<HTMLElement>(".tm-manipulator");
const modeSelect = document.querySelector<HTMLSelectElement>(".manipulator-mode-box select");
const transformHelper = editor.transform.getHelper();

function enforceManipulatorMode() {
  const mode = modeSelect?.value ?? "tinker";
  const showGizmo = mode === "gizmo" || mode === "both";
  transformHelper.visible = showGizmo;
  editor.transform.enabled = showGizmo;
}
modeSelect?.addEventListener("change", enforceManipulatorMode);

const edgeHandles: Record<string, HTMLButtonElement> = {};
if (overlay) {
  for (const [axis, sign] of [["x", -1], ["x", 1], ["y", -1], ["y", 1]] as const) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `tm-scale-handle tm-edge-handle tm-edge-${axis}-${sign < 0 ? "min" : "max"}`;
    handle.dataset.axis = axis;
    handle.dataset.sign = String(sign);
    handle.title = `Escalar sólo ${axis.toUpperCase()} · Shift uniforme · Alt desde el centro`;
    overlay.append(handle);
    edgeHandles[`${axis}${sign}`] = handle;
  }
}

const project = (world: THREE.Vector3) => {
  const rect = viewport.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height };
};

const activeBounds = () => {
  const object = editor.activeObject();
  if (!object || !object.visible) return null;
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return { object, box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
};

const axisVector = (axis: Axis) => axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
const screenAxis = (axis: Axis, origin: THREE.Vector3) => {
  const a = project(origin);
  const b = project(origin.clone().add(axisVector(axis)));
  return new THREE.Vector2(b.x - a.x, b.y - a.y);
};
const scalarOnAxis = (dx: number, dy: number, axis: Axis, origin: THREE.Vector3) => {
  const v = screenAxis(axis, origin);
  const lenSq = v.lengthSq();
  return lenSq < 1e-8 ? 0 : (dx * v.x + dy * v.y) / lenSq;
};

function decomposeXY(dx: number, dy: number, origin: THREE.Vector3) {
  const vx = screenAxis("x", origin);
  const vy = screenAxis("y", origin);
  const det = vx.x * vy.y - vx.y * vy.x;
  if (Math.abs(det) < 1e-8) return { x: scalarOnAxis(dx, dy, "x", origin), y: scalarOnAxis(dx, dy, "y", origin) };
  return {
    x: (dx * vy.y - dy * vy.x) / det,
    y: (dy * vx.x - dx * vx.y) / det,
  };
}

function place(el: HTMLElement, p: { x: number; y: number }) {
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
}

let pinnedHandle: { el: HTMLElement; x: number; y: number } | null = null;
function refreshEdgeHandles() {
  enforceManipulatorMode();
  const info = activeBounds();
  const tinkerVisible = Boolean(info) && (modeSelect?.value ?? "tinker") !== "gizmo";
  for (const handle of Object.values(edgeHandles)) handle.classList.toggle("hidden", !tinkerVisible);
  if (!info || !tinkerVisible) return;
  const { box, center } = info;
  const z = box.min.z;
  place(edgeHandles["x-1"], project(new THREE.Vector3(box.min.x, center.y, z)));
  place(edgeHandles["x1"], project(new THREE.Vector3(box.max.x, center.y, z)));
  place(edgeHandles["y-1"], project(new THREE.Vector3(center.x, box.min.y, z)));
  place(edgeHandles["y1"], project(new THREE.Vector3(center.x, box.max.y, z)));
  if (pinnedHandle) place(pinnedHandle.el, { x: pinnedHandle.x, y: pinnedHandle.y });
}
requestAnimationFrame(function refineLoop() {
  refreshEdgeHandles();
  requestAnimationFrame(refineLoop);
});

const allScaleHandles = () => [...document.querySelectorAll<HTMLButtonElement>(".tm-scale-handle")];

type ScaleDrag = {
  handle: HTMLButtonElement;
  startX: number;
  startY: number;
  signs: Partial<Record<Axis, Sign>>;
  startSize: THREE.Vector3;
  startCenter: THREE.Vector3;
  object: THREE.Object3D;
  startPosition: THREE.Vector3;
  startScale: THREE.Vector3;
};
let scaleDrag: ScaleDrag | null = null;

function parseSigns(handle: HTMLButtonElement): Partial<Record<Axis, Sign>> {
  if (handle.classList.contains("tm-edge-handle")) {
    const axis = handle.dataset.axis as Axis;
    return { [axis]: Number(handle.dataset.sign) as Sign };
  }
  if (handle.classList.contains("tm-z-handle")) return { z: 1 };
  const sx = Number(handle.dataset.sx);
  const sy = Number(handle.dataset.sy);
  const signs: Partial<Record<Axis, Sign>> = {};
  if (sx === -1 || sx === 1) signs.x = sx;
  if (sy === -1 || sy === 1) signs.y = sy;
  return signs;
}

function beginScale(event: PointerEvent, handle: HTMLButtonElement) {
  const info = activeBounds();
  if (!info) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  editor.checkpoint();
  scaleDrag = {
    handle,
    startX: event.clientX,
    startY: event.clientY,
    signs: parseSigns(handle),
    startSize: info.size.clone(),
    startCenter: info.center.clone(),
    object: info.object,
    startPosition: info.object.position.clone(),
    startScale: info.object.scale.clone(),
  };
  const rect = viewport.getBoundingClientRect();
  pinnedHandle = { el: handle, x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function installScaleInterceptors() {
  for (const handle of allScaleHandles()) {
    if (handle.dataset.v041Bound === "1") continue;
    handle.dataset.v041Bound = "1";
    handle.addEventListener("pointerdown", (event) => beginScale(event, handle), true);
  }
}
installScaleInterceptors();

const snapValue = (value: number, step: number) => step > 0 ? Math.round(value / step) * step : value;

window.addEventListener("pointermove", (event) => {
  if (!scaleDrag) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const rect = viewport.getBoundingClientRect();
  pinnedHandle = { el: scaleDrag.handle, x: event.clientX - rect.left, y: event.clientY - rect.top };

  const dx = event.clientX - scaleDrag.startX;
  const dy = event.clientY - scaleDrag.startY;
  const axes = Object.keys(scaleDrag.signs) as Axis[];
  const raw: Partial<Record<Axis, number>> = {};
  if (axes.includes("x") && axes.includes("y")) {
    const xy = decomposeXY(dx, dy, scaleDrag.startCenter);
    raw.x = xy.x;
    raw.y = xy.y;
  } else {
    for (const axis of axes) raw[axis] = scalarOnAxis(dx, dy, axis, scaleDrag.startCenter);
  }

  const snap = editor.getSnap();
  const fine = event.ctrlKey || event.metaKey ? 0.1 : 1;
  const fromCenter = event.altKey;
  const uniform = event.shiftKey;
  const object = scaleDrag.object;
  object.position.copy(scaleDrag.startPosition);
  object.scale.copy(scaleDrag.startScale);

  const sizeDeltas: Partial<Record<Axis, number>> = {};
  for (const axis of axes) {
    const sign = scaleDrag.signs[axis]!;
    let faceMotion = raw[axis] ?? 0;
    if (snap.enabled) faceMotion = snapValue(faceMotion, snap.gridSize * fine);
    sizeDeltas[axis] = faceMotion * sign * (fromCenter ? 2 : 1);
  }

  if (uniform) {
    const axis = axes[0] ?? "x";
    const base = scaleDrag.startSize[axis] || 1;
    const ratio = Math.max(0.01, (base + (sizeDeltas[axis] ?? 0)) / base);
    object.scale.set(scaleDrag.startScale.x * ratio, scaleDrag.startScale.y * ratio, scaleDrag.startScale.z * ratio);
    if (!fromCenter) {
      for (const affected of axes) {
        const faceMotion = raw[affected] ?? 0;
        object.position[affected] = scaleDrag.startPosition[affected] + faceMotion / 2;
      }
    }
  } else {
    for (const axis of axes) {
      const base = Math.max(0.0001, scaleDrag.startSize[axis]);
      const target = Math.max(0.01, base + (sizeDeltas[axis] ?? 0));
      object.scale[axis] = scaleDrag.startScale[axis] * (target / base);
      if (!fromCenter) object.position[axis] = scaleDrag.startPosition[axis] + (raw[axis] ?? 0) / 2;
    }
  }
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}, true);

window.addEventListener("pointerup", (event) => {
  if (!scaleDrag) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  scaleDrag = null;
  pinnedHandle = null;
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}, true);

// New handles are added after v0.4's initial binding pass, so bind them now too.
installScaleInterceptors();

// Keep all manipulation controls visually using the normal arrow cursor.
document.documentElement.classList.add("tm-arrow-controls");

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.4.1 · MMB desplaza cámara · RMB rota · rueda hace zoom.";
