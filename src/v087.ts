import * as THREE from "three";
import type { TinkerEditor } from "./editor";

const VERSION = "0.8.7";
const editor = (window as any).__tinkerEditor as TinkerEditor | undefined;
if (!editor) throw new Error("TinkerMatt v0.8.7 no pudo acceder al editor.");

const viewport = document.querySelector<HTMLElement>("#viewport");
const controls = editor.scene.getObjectByName("__tm_tinkercad_controls_v044");

type Axis = "x" | "y" | "z";
type ControlInfo = { kind: "move" | "rotate"; axis: Axis };

const axisVector = (axis: Axis) => axis === "x"
  ? new THREE.Vector3(1, 0, 0)
  : axis === "y"
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

function activeBounds() {
  const object = editor.activeObject();
  if (!object || !object.visible) return null;
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return {
    box,
    center: box.getCenter(new THREE.Vector3()),
    size: box.getSize(new THREE.Vector3()),
  };
}

// Perspective size is controlled by camera-space DEPTH, not by the full
// Euclidean camera-to-object distance. Using the latter made the Tinker widget
// grow dramatically when an object was moved sideways across the workplane.
function worldPerPixel(point: THREE.Vector3) {
  if (!viewport) return 0.01;
  const cameraPosition = editor.camera.getWorldPosition(new THREE.Vector3());
  const cameraForward = editor.camera.getWorldDirection(new THREE.Vector3());
  const depth = Math.max(0.001, point.clone().sub(cameraPosition).dot(cameraForward));
  const effectiveFov = THREE.MathUtils.degToRad(editor.camera.getEffectiveFOV());
  return (2 * Math.tan(effectiveFov / 2) * depth) / Math.max(1, viewport.clientHeight);
}

function cameraSide(axis: Axis, center: THREE.Vector3) {
  const cameraPosition = editor.camera.getWorldPosition(new THREE.Vector3());
  return cameraPosition.sub(center).dot(axisVector(axis)) >= 0 ? 1 : -1;
}

function orientMoveControl(root: THREE.Object3D, axis: Axis, sign: number) {
  root.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    axisVector(axis).multiplyScalar(sign),
  );
}

// v0.4.4 used an arc band from radius 0.89 to 1.00. Make the visible rotation
// ribbon only a little stronger (0.865 -> 1.00), while leaving the overall
// on-screen radius unchanged.
function thickenRotationArcs() {
  if (!controls) return;
  for (const root of controls.children) {
    const info = root.userData.tmControl as ControlInfo | undefined;
    if (info?.kind !== "rotate" || root.userData.tmV087ArcFixed) continue;
    const arc = root.children[0];
    if (!(arc instanceof THREE.Mesh) || !(arc.geometry instanceof THREE.BufferGeometry)) continue;

    const geometry = arc.geometry.clone();
    const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!position) continue;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const radius = Math.hypot(x, y);
      if (radius > 0.80 && radius < 0.95) {
        const targetRadius = 0.865;
        const factor = targetRadius / Math.max(radius, 1e-6);
        position.setXY(i, x * factor, y * factor);
      }
    }
    position.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    arc.geometry = geometry;
    root.userData.tmV087ArcFixed = true;
  }
}

function stabilizeTinkerControls() {
  if (!controls || !viewport || !controls.visible) return;
  const info = activeBounds();
  if (!info) return;

  const { center, size } = info;
  const wpp = worldPerPixel(center);
  const moveScale = 11 * wpp;
  const rotateScale = 28 * wpp;
  const gap = 10 * wpp;

  for (const root of controls.children) {
    const control = root.userData.tmControl as ControlInfo | undefined;
    if (!control) continue;

    const direction = axisVector(control.axis);
    const sign = cameraSide(control.axis, center);
    const half = size[control.axis] / 2;

    if (control.kind === "move") {
      root.position.copy(center).addScaledVector(direction, sign * (half + gap + moveScale * 0.38));
      root.scale.setScalar(moveScale);
      orientMoveControl(root, control.axis, sign);
    } else {
      root.position.copy(center).addScaledVector(direction, sign * (half + gap * 0.55));
      root.scale.setScalar(rotateScale);
    }
  }
}

thickenRotationArcs();
requestAnimationFrame(function stableControlLoop() {
  stabilizeTinkerControls();
  requestAnimationFrame(stableControlLoop);
});

const anyWindow = window as any;
anyWindow.__tmAppVersion = VERSION;
anyWindow.tinkerMatt ??= {};
anyWindow.tinkerMatt.version = VERSION;
