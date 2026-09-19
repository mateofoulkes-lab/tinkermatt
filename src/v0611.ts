import * as THREE from "three";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    __tmV068PointerdownOverride?: (event: PointerEvent) => boolean;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.11 no pudo acceder al editor.");
const status = document.querySelector<HTMLElement>("#status");
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.11";
const setStatus = (text: string) => { if (status) status.textContent = text; };

// -----------------------------------------------------------------------------
// Precise selected-object bounds.
//
// WORLD-axis scaling of a rotated object creates a perfectly valid affine/shear
// deformation in the object's local geometry. THREE.Box3.setFromObject() is
// approximate by default: it transforms each mesh's LOCAL bounding box instead
// of transforming every vertex. Once the local geometry is sheared, that fast
// approximation can report a larger Y while only WORLD Z actually changed. It
// can also make a shrinking Z appear to stop at its old size.
//
// Only selected / explicitly-marked roots opt into precise vertex bounds so STL
// and dense scenes do not pay the precise traversal cost unless the user is
// actively editing them.
// -----------------------------------------------------------------------------
const boxProto = THREE.Box3.prototype as THREE.Box3 & {
  __tmPreciseSelectedBoundsV0611?: boolean;
  __tmOriginalSetFromObjectV0611?: (object: THREE.Object3D, precise?: boolean) => THREE.Box3;
};

if (!boxProto.__tmPreciseSelectedBoundsV0611) {
  const original = THREE.Box3.prototype.setFromObject;
  (boxProto as any).__tmOriginalSetFromObjectV0611 = original;
  (THREE.Box3.prototype as any).setFromObject = function (object: THREE.Object3D, precise = false) {
    const forcePrecise = object?.userData?.tmPreciseWorldBounds === true;
    return original.call(this, object, precise || forcePrecise);
  };
  boxProto.__tmPreciseSelectedBoundsV0611 = true;
}

function markPrecise(object: THREE.Object3D | null | undefined) {
  if (object) object.userData.tmPreciseWorldBounds = true;
}
function markSelectionPrecise() {
  for (const object of editor.getSelection()) markPrecise(object);
}

// Any selected object may subsequently receive a WORLD deformation from the
// widget, inspector or Blender-style shortcuts. Marking selection is cheap; the
// expensive path only runs when somebody actually asks for its bounds.
editor.on("selection", (objects) => objects.forEach(markPrecise));
markSelectionPrecise();

// The early v0.6.8 gate owns widget pointerdown before legacy handlers. Wrap it
// so the precise-bound flag is present BEFORE v0.6.10 captures the drag box.
const previousPointerdownOverride = window.__tmV068PointerdownOverride;
window.__tmV068PointerdownOverride = (event: PointerEvent) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".tm-scale-handle, .tm-measure")) markSelectionPrecise();
  return previousPointerdownOverride?.(event) ?? false;
};

// Inspector dimension edits and S-modal scaling use the same exact bounds.
window.addEventListener("input", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches("#size-x, #size-y, #size-z, .tm-measure")) markSelectionPrecise();
}, true);
window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const typing = target?.matches("input, textarea, select") || target?.isContentEditable;
  if (!typing && event.key.toLowerCase() === "s") markSelectionPrecise();
}, true);

// Force an immediate helper/readout refresh after the patch is live. The old
// widget animation loop will now receive precise bounds automatically.
const rawEditor = editor as any;
rawEditor.refreshSelectionHelpers?.();
rawEditor.emit?.("selection", editor.getSelection());

// -----------------------------------------------------------------------------
// Rotation ring visual polish.
// Keep v0.6.10's finally-working interaction untouched. Make the whole guide
// softer and mask a slightly larger central hole so it starts farther away from
// the object/widget and does not visually swamp it.
// -----------------------------------------------------------------------------
const rotationCanvas = document.querySelector<HTMLCanvasElement>("#tm-rotation-ring-v0610");
if (rotationCanvas) {
  rotationCanvas.style.setProperty(
    "filter",
    "opacity(0.70) drop-shadow(0 4px 10px rgba(20,40,52,.12))",
    "important",
  );
  const mask = "radial-gradient(circle at 50% 50%, transparent 0 56px, rgba(0,0,0,0) 60px, #000 68px)";
  rotationCanvas.style.setProperty("mask-image", mask, "important");
  rotationCanvas.style.setProperty("-webkit-mask-image", mask, "important");
}

setStatus("TinkerMatt v0.6.11 · bounding WORLD preciso + anillo más liviano.");
