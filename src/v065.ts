import * as THREE from "three";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
  }
}

type Axis = "x" | "y" | "z";
type WidgetDrag = {
  pointerId: number;
  source: HTMLElement;
  startX: number;
  startY: number;
  object: THREE.Object3D;
  startBox: THREE.Box3;
  startSize: THREE.Vector3;
  startCenter: THREE.Vector3;
  signs: Partial<Record<Axis, -1 | 1>>;
};

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.5 no pudo acceder al editor.");
const rawEditor = editor as any;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const deltaBadge = document.querySelector<HTMLElement>(".tm-delta-badge");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.5";

const axisVector = (axis: Axis) => axis === "x"
  ? new THREE.Vector3(1, 0, 0)
  : axis === "y"
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

function project(world: THREE.Vector3) {
  const rect = viewport.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return {
    x: (p.x * 0.5 + 0.5) * rect.width,
    y: (-p.y * 0.5 + 0.5) * rect.height,
  };
}

function pointerScalarOnAxis(dx: number, dy: number, axis: Axis, origin: THREE.Vector3) {
  const a = project(origin);
  const b = project(origin.clone().add(axisVector(axis)));
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 0.0001) return 0;
  return (dx * vx + dy * vy) / lenSq;
}

function snapScalar(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}

function worldBox(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function translateWorld(object: THREE.Object3D, delta: THREE.Vector3) {
  if (delta.lengthSq() < 1e-16) return;
  object.updateMatrixWorld(true);
  const world = object.getWorldPosition(new THREE.Vector3()).add(delta);
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    object.position.copy(object.parent.worldToLocal(world));
  } else {
    object.position.copy(world);
  }
  object.updateMatrixWorld(true);
}

function axisForMeasure(input: HTMLElement): Axis | null {
  if (input.classList.contains("tm-measure-x")) return "x";
  if (input.classList.contains("tm-measure-y")) return "y";
  if (input.classList.contains("tm-measure-z")) return "z";
  return null;
}

// Numeric fields in the floating Tinker widget are handled in capture phase so
// the original v0.4 local-axis handler never gets a chance to run as well.
window.addEventListener("input", (event) => {
  const input = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(".tm-measure");
  if (!input) return;
  const axis = axisForMeasure(input);
  const value = Number(input.value);
  if (!axis || !Number.isFinite(value) || value <= 0) return;
  event.stopImmediatePropagation();
  rawEditor.setActiveDimension(axis, value);
}, true);

let drag: WidgetDrag | null = null;

// Intercept BEFORE the pointer reaches the historical scale handles. This is the
// important difference from v0.6.4: there is now exactly one scale drag engine.
window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const source = (event.target as HTMLElement | null)?.closest<HTMLElement>(".tm-corner-handle, .tm-z-handle");
  if (!source) return;
  const object = editor.activeObject();
  if (!object) return;

  const signs: Partial<Record<Axis, -1 | 1>> = {};
  if (source.classList.contains("tm-z-handle")) signs.z = 1;
  else {
    signs.x = Number(source.dataset.sx) < 0 ? -1 : 1;
    signs.y = Number(source.dataset.sy) < 0 ? -1 : 1;
  }

  editor.checkpoint();
  const box = worldBox(object);
  drag = {
    pointerId: event.pointerId,
    source,
    startX: event.clientX,
    startY: event.clientY,
    object,
    startBox: box.clone(),
    startSize: box.getSize(new THREE.Vector3()),
    startCenter: box.getCenter(new THREE.Vector3()),
    signs,
  };
  try { source.setPointerCapture(event.pointerId); } catch { /* optional */ }
  deltaBadge?.classList.remove("hidden");
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener("pointermove", (event) => {
  const current = drag;
  if (!current || current.pointerId !== event.pointerId) return;

  const dx = event.clientX - current.startX;
  const dy = event.clientY - current.startY;
  const axes = Object.keys(current.signs) as Axis[];
  const snap = editor.getSnap();
  const targets = new Map<Axis, number>();

  for (const axis of axes) {
    const sign = current.signs[axis]!;
    let amount = pointerScalarOnAxis(dx, dy, axis, current.startCenter) * sign;
    if (snap.enabled) amount = snapScalar(amount, snap.gridSize * (event.altKey ? 0.1 : 1));
    targets.set(axis, Math.max(0.01, current.startSize[axis] + amount));
  }

  if (event.shiftKey) {
    const driver = axes[0] ?? "x";
    const ratio = (targets.get(driver) ?? current.startSize[driver]) / Math.max(0.0001, current.startSize[driver]);
    for (const axis of ["x", "y", "z"] as const) {
      rawEditor.setActiveDimension(axis, Math.max(0.01, current.startSize[axis] * ratio));
    }
  } else {
    for (const axis of axes) rawEditor.setActiveDimension(axis, targets.get(axis)!);
  }

  // Unless Alt is held, keep the face opposite the dragged handle fixed in
  // WORLD coordinates. The deformation itself is still produced by the same
  // absolute-axis setActiveDimension path used by the numeric widget fields.
  if (!event.altKey) {
    const box = worldBox(current.object);
    const correction = new THREE.Vector3();
    for (const axis of axes) {
      const sign = current.signs[axis]!;
      correction[axis] = sign > 0
        ? current.startBox.min[axis] - box.min[axis]
        : current.startBox.max[axis] - box.max[axis];
    }
    translateWorld(current.object, correction);
  }

  const size = worldBox(current.object).getSize(new THREE.Vector3());
  if (deltaBadge) deltaBadge.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm · GLOBAL`;
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function finish(event: PointerEvent) {
  const current = drag;
  if (!current || current.pointerId !== event.pointerId) return;
  drag = null;
  deltaBadge?.classList.add("hidden");
  try { current.source.releasePointerCapture(event.pointerId); } catch { /* optional */ }
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  event.preventDefault();
  event.stopImmediatePropagation();
}
window.addEventListener("pointerup", finish, true);
window.addEventListener("pointercancel", finish, true);
