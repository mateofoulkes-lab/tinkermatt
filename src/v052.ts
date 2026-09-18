import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import "./v052.css";
import { getMeta, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, unknown>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.2 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.2";

const inspector = document.querySelector<HTMLElement>("#inspector");
const paletteTitle = inspector?.querySelector<HTMLElement>(".palette-title");

const section = document.createElement("section");
section.className = "tm-box-properties hidden";
section.innerHTML = `
  <div class="tm-shape-properties-title">Propiedades del cubo</div>
  <div class="tm-param-row" data-param="radius">
    <label>Radio</label>
    <div class="tm-param-control">
      <input class="tm-param-range" type="range" min="0" max="10" step="0.01" />
      <input class="tm-param-number" type="number" min="0" step="0.01" />
    </div>
  </div>
  <div class="tm-param-row" data-param="steps">
    <label>Pasos</label>
    <div class="tm-param-control">
      <input class="tm-param-range" type="range" min="1" max="20" step="1" />
      <input class="tm-param-number" type="number" min="1" max="20" step="1" />
    </div>
  </div>
  <div class="tm-param-row" data-param="length">
    <label>Longitud</label>
    <div class="tm-param-control">
      <input class="tm-param-range" type="range" min="0.1" max="200" step="0.1" />
      <input class="tm-param-number" type="number" min="0.01" step="0.1" />
    </div>
  </div>
  <div class="tm-param-row" data-param="width">
    <label>Anchura</label>
    <div class="tm-param-control">
      <input class="tm-param-range" type="range" min="0.1" max="200" step="0.1" />
      <input class="tm-param-number" type="number" min="0.01" step="0.1" />
    </div>
  </div>
  <div class="tm-param-row" data-param="height">
    <label>Altura</label>
    <div class="tm-param-control">
      <input class="tm-param-range" type="range" min="0.1" max="200" step="0.1" />
      <input class="tm-param-number" type="number" min="0.01" step="0.1" />
    </div>
  </div>
`;

if (inspector) {
  if (paletteTitle) inspector.insertBefore(section, paletteTitle);
  else inspector.append(section);
}

type BoxValues = {
  length: number;
  width: number;
  height: number;
  radius: number;
  steps: number;
};

type ParamName = keyof BoxValues;

function activeBox(): THREE.Mesh | null {
  const object = editor.activeObject();
  if (!(object instanceof THREE.Mesh)) return null;
  return getMeta(object)?.kind === "box" ? object : null;
}

function finite(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function currentBoxValues(object: THREE.Mesh): BoxValues {
  const meta = getMeta(object)!;
  const params = meta.params ?? {};
  const baseLength = finite(params.width, 20);
  const baseWidth = finite(params.depth, 20);
  const baseHeight = finite(params.height, 20);
  return {
    length: Math.max(0.01, baseLength * Math.abs(object.scale.x)),
    width: Math.max(0.01, baseWidth * Math.abs(object.scale.y)),
    height: Math.max(0.01, baseHeight * Math.abs(object.scale.z)),
    radius: Math.max(0, finite(params.radius, 0) * Math.min(Math.abs(object.scale.x), Math.abs(object.scale.y), Math.abs(object.scale.z))),
    steps: Math.max(1, Math.min(20, Math.round(finite(params.steps, 1)))),
  };
}

function roundedGeometry(values: BoxValues) {
  const maxRadius = Math.max(0, Math.min(values.length, values.width, values.height) / 2 - 0.0001);
  const radius = Math.min(Math.max(0, values.radius), maxRadius);
  if (radius <= 0.0001) return new THREE.BoxGeometry(values.length, values.width, values.height);

  const geometry = new RoundedBoxGeometry(values.length, values.width, values.height, values.steps, radius);

  // Tinkercad semantics: one step is a straight chamfer. RoundedBoxGeometry's
  // generated normals smooth even its lowest segment count, which makes the
  // bevel look curved. Recompute face normals on the non-indexed geometry so
  // step 1 is visibly planar; step 2+ keeps the smooth rounded interpolation.
  if (values.steps === 1) {
    geometry.deleteAttribute("normal");
    geometry.computeVertexNormals();
  }

  return geometry;
}

function rebuildBox(object: THREE.Mesh, next: BoxValues, preserveBottomForHeight = false) {
  const meta = getMeta(object);
  if (!meta) return;

  const previous = currentBoxValues(object);
  const maxRadius = Math.max(0, Math.min(next.length, next.width, next.height) / 2 - 0.0001);
  next.radius = Math.min(Math.max(0, next.radius), maxRadius);
  next.steps = Math.max(1, Math.min(20, Math.round(next.steps)));

  if (preserveBottomForHeight) {
    const delta = next.height - previous.height;
    const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).normalize();
    object.position.addScaledVector(localZ, delta / 2);
  }

  const geometry = roundedGeometry(next);
  object.geometry.dispose();
  object.geometry = geometry;
  object.scale.set(1, 1, 1);

  meta.params = {
    ...(meta.params ?? {}),
    width: next.length,
    depth: next.width,
    height: next.height,
    radius: next.radius,
    steps: next.steps,
  };
  setMeta(object, meta);

  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
}

const rows = new Map<ParamName, { row: HTMLElement; range: HTMLInputElement; number: HTMLInputElement }>();
for (const row of section.querySelectorAll<HTMLElement>(".tm-param-row")) {
  const name = row.dataset.param as ParamName;
  const range = row.querySelector<HTMLInputElement>(".tm-param-range")!;
  const number = row.querySelector<HTMLInputElement>(".tm-param-number")!;
  rows.set(name, { row, range, number });
}

let updatingUi = false;
let editCheckpointed = false;

function setUiValue(name: ParamName, value: number) {
  const controls = rows.get(name);
  if (!controls) return;
  const text = name === "steps" ? String(Math.round(value)) : Number(value.toFixed(2)).toString();
  if (document.activeElement !== controls.number) controls.number.value = text;
  if (document.activeElement !== controls.range) controls.range.value = String(value);
}

function refresh() {
  const object = activeBox();
  section.classList.toggle("hidden", !object);
  if (!object) return;
  const values = currentBoxValues(object);
  const maxRadius = Math.max(0, Math.min(values.length, values.width, values.height) / 2);
  const radiusControls = rows.get("radius")!;
  radiusControls.range.max = String(maxRadius);
  radiusControls.number.max = String(maxRadius);
  for (const [name, value] of Object.entries(values) as Array<[ParamName, number]>) setUiValue(name, value);
}

function apply(name: ParamName, rawValue: number) {
  if (updatingUi || !Number.isFinite(rawValue)) return;
  const object = activeBox();
  if (!object) return;
  if (!editCheckpointed) {
    editor.checkpoint();
    editCheckpointed = true;
  }
  const values = currentBoxValues(object);
  if (name === "steps") values.steps = Math.max(1, Math.min(20, Math.round(rawValue)));
  else if (name === "radius") values.radius = Math.max(0, rawValue);
  else values[name] = Math.max(0.01, rawValue);
  rebuildBox(object, values, name === "height");
  refresh();
}

for (const [name, controls] of rows) {
  const syncFrom = (source: HTMLInputElement) => {
    const value = Number(source.value);
    if (!Number.isFinite(value)) return;
    if (source === controls.range) controls.number.value = name === "steps" ? String(Math.round(value)) : Number(value.toFixed(2)).toString();
    else controls.range.value = String(value);
    apply(name, value);
  };
  controls.range.addEventListener("pointerdown", () => { editCheckpointed = false; });
  controls.number.addEventListener("focus", () => { editCheckpointed = false; });
  controls.range.addEventListener("input", () => syncFrom(controls.range));
  controls.number.addEventListener("input", () => syncFrom(controls.number));
  controls.range.addEventListener("change", () => { editCheckpointed = false; });
  controls.number.addEventListener("change", () => { editCheckpointed = false; });
}

editor.on("selection", refresh);
editor.on("changed", () => {
  if (!editCheckpointed) refresh();
});
refresh();

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  setBoxParameters: (parameters: Partial<BoxValues>) => {
    const object = activeBox();
    if (!object) throw new Error("Seleccioná un cubo.");
    const values = { ...currentBoxValues(object), ...parameters };
    editor.checkpoint();
    rebuildBox(object, values, parameters.height !== undefined);
    refresh();
    return getMeta(object);
  },
  getBoxParameters: () => {
    const object = activeBox();
    return object ? currentBoxValues(object) : null;
  },
});

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.5.2 · Cubo paramétrico: radio, pasos y dimensiones.";