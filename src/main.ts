import * as THREE from "three";
import { icon, type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowPointer,
  faArrowsUpDownLeftRight,
  faRotate,
  faExpand,
  faCopy,
  faObjectGroup,
  faObjectUngroup,
  faCircleHalfStroke,
  faShapes,
  faMinus,
  faCrosshairs,
  faCircle,
  faStop,
  faRepeat,
  faFileImport,
  faFileExport,
  faCube,
  faDatabase,
  faFont,
  faVectorSquare,
  faGear,
} from "@fortawesome/free-solid-svg-icons";
import "./style.css";
import { TinkerEditor } from "./editor";
import { getMeta, type MaterialPreset, type ReferenceKind } from "./model";

const qs = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const faIcons: Record<string, IconDefinition> = {
  select: faArrowPointer,
  move: faArrowsUpDownLeftRight,
  rotate: faRotate,
  scale: faExpand,
  duplicate: faCopy,
  group: faObjectGroup,
  ungroup: faObjectUngroup,
  hole: faCircleHalfStroke,
  union: faShapes,
  subtract: faMinus,
  intersect: faCrosshairs,
  record: faCircle,
  repeat: faRepeat,
  import: faFileImport,
  export: faFileExport,
  box: faCube,
  cylinder: faDatabase,
  sphere: faCircle,
  text: faFont,
  svg: faVectorSquare,
  thread: faGear,
  bevel: faCube,
};

function mountFaIcons() {
  document.querySelectorAll<HTMLElement>("[data-fa]").forEach((element) => {
    const definition = faIcons[element.dataset.fa ?? ""];
    if (definition) element.innerHTML = icon(definition).html.join("");
  });
}

mountFaIcons();

const viewport = qs<HTMLElement>("#viewport");
const editor = new TinkerEditor(viewport);
const status = qs<HTMLSpanElement>("#status");
const inspector = qs<HTMLElement>("#inspector");
const objectName = qs<HTMLInputElement>("#object-name");
const dimensions = qs<HTMLElement>("#dimensions");
const materialSelect = qs<HTMLSelectElement>("#material-select");
const refsList = qs<HTMLElement>("#refs-list");
const refName = qs<HTMLInputElement>("#ref-name");
const refKind = qs<HTMLSelectElement>("#ref-kind");
const recordButton = qs<HTMLButtonElement>("#record");
const macroPill = qs<HTMLElement>("#macro-pill");

const transformButtons = {
  translate: qs<HTMLButtonElement>("#tool-move"),
  rotate: qs<HTMLButtonElement>("#tool-rotate"),
  scale: qs<HTMLButtonElement>("#tool-scale"),
};

function setStatus(text: string) {
  status.textContent = text;
}

function setRecordButton(active: boolean) {
  recordButton.classList.toggle("active-recording", active);
  const symbol = icon(active ? faStop : faCircle).html.join("");
  recordButton.innerHTML = `<span class="fa-icon">${symbol}</span><span class="record-label">${active ? "Detener" : "Grabar"}</span>`;
}

function setTransformUi(mode: "translate" | "rotate" | "scale") {
  Object.values(transformButtons).forEach((button) => button.classList.remove("active"));
  transformButtons[mode].classList.add("active");
  qs<HTMLButtonElement>("#tool-select").classList.remove("active");
  editor.setTransformMode(mode);
}

function num(selector: string) {
  return Number(qs<HTMLInputElement>(selector).value);
}

function refreshInspector() {
  const selected = editor.getSelection();
  const object = editor.activeObject();
  if (!object) {
    inspector.classList.add("hidden");
    return;
  }
  inspector.classList.remove("hidden");
  const meta = getMeta(object);
  objectName.value = meta?.name ?? object.name ?? "Objeto";

  qs<HTMLInputElement>("#pos-x").value = object.position.x.toFixed(2);
  qs<HTMLInputElement>("#pos-y").value = object.position.y.toFixed(2);
  qs<HTMLInputElement>("#pos-z").value = object.position.z.toFixed(2);
  qs<HTMLInputElement>("#rot-x").value = THREE.MathUtils.radToDeg(object.rotation.x).toFixed(1);
  qs<HTMLInputElement>("#rot-y").value = THREE.MathUtils.radToDeg(object.rotation.y).toFixed(1);
  qs<HTMLInputElement>("#rot-z").value = THREE.MathUtils.radToDeg(object.rotation.z).toFixed(1);

  const size = editor.boundsOf(object);
  dimensions.textContent = `Tamaño: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm${selected.length > 1 ? ` · ${selected.length} seleccionados` : ""}`;
  if (meta) materialSelect.value = meta.material;

  refsList.innerHTML = "";
  for (const reference of meta?.references ?? []) {
    const row = document.createElement("div");
    row.className = "ref-row";
    const label = document.createElement("span");
    label.textContent = `${reference.kind}: ${reference.name}`;
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.title = "Eliminar referencia";
    remove.addEventListener("click", () => editor.removeReference(reference.id));
    row.append(label, remove);
    refsList.append(row);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-shape]")) {
  button.addEventListener("click", () => editor.addPrimitive(button.dataset.shape as "box" | "cylinder" | "sphere"));
}

qs("#tool-select").addEventListener("click", () => {
  editor.transform.detach();
  qs("#tool-select").classList.add("active");
  Object.values(transformButtons).forEach((button) => button.classList.remove("active"));
  setStatus("Seleccionar. Hacé click sobre un objeto.");
});
transformButtons.translate.addEventListener("click", () => setTransformUi("translate"));
transformButtons.rotate.addEventListener("click", () => setTransformUi("rotate"));
transformButtons.scale.addEventListener("click", () => setTransformUi("scale"));

qs("#duplicate").addEventListener("click", () => editor.duplicateSelected());
qs("#group").addEventListener("click", () => editor.groupSelected());
qs("#ungroup").addEventListener("click", () => editor.ungroupSelected());
qs("#hole").addEventListener("click", () => editor.toggleHole());
qs("#bool-union").addEventListener("click", () => editor.applyBoolean("union"));
qs("#bool-subtract").addEventListener("click", () => editor.applyBoolean("subtract"));
qs("#bool-intersect").addEventListener("click", () => editor.applyBoolean("intersect"));
qs("#align-x").addEventListener("click", () => editor.align("x"));
qs("#align-y").addEventListener("click", () => editor.align("y"));
qs("#align-z").addEventListener("click", () => editor.align("z"));

qs("#record").addEventListener("click", () => editor.toggleRecording());
qs("#repeat").addEventListener("click", () => {
  const times = Number(qs<HTMLInputElement>("#repeat-count").value) || 1;
  editor.repeatMacro(times);
});
qs("#export-stl").addEventListener("click", () => editor.exportStl());

qs("#add-text").addEventListener("click", async () => {
  const text = window.prompt("Texto a extruir", "TINKERMATT");
  if (text === null) return;
  setStatus("Generando texto…");
  try {
    await editor.addText(text);
  } catch (error) {
    setStatus(`No se pudo cargar la fuente: ${error instanceof Error ? error.message : String(error)}`);
  }
});

const svgInput = qs<HTMLInputElement>("#svg-file");
qs("#import-svg").addEventListener("click", () => svgInput.click());
svgInput.addEventListener("change", async () => {
  const file = svgInput.files?.[0];
  if (!file) return;
  editor.addSvg(await file.text(), file.name.replace(/\.svg$/i, ""));
  svgInput.value = "";
});

const stlInput = qs<HTMLInputElement>("#stl-file");
qs("#import-stl").addEventListener("click", () => stlInput.click());
qs("#import-stl-top").addEventListener("click", () => stlInput.click());
stlInput.addEventListener("change", async () => {
  const file = stlInput.files?.[0];
  if (!file) return;
  editor.addStl(await file.arrayBuffer(), file.name.replace(/\.stl$/i, ""));
  stlInput.value = "";
});

objectName.addEventListener("change", () => editor.setObjectName(objectName.value));
materialSelect.addEventListener("change", () => editor.setMaterial(materialSelect.value as MaterialPreset));
qs("#close-inspector").addEventListener("click", () => editor.setSelection([]));
qs("#add-ref").addEventListener("click", () => {
  editor.addReference(refKind.value as ReferenceKind, refName.value);
  refName.value = "";
});
refName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") qs<HTMLButtonElement>("#add-ref").click();
});

for (const [selector, axis] of [["#pos-x", "x"], ["#pos-y", "y"], ["#pos-z", "z"]] as const) {
  qs<HTMLInputElement>(selector).addEventListener("change", () => editor.setActivePosition(axis, num(selector)));
}
for (const [selector, axis] of [["#rot-x", "x"], ["#rot-y", "y"], ["#rot-z", "z"]] as const) {
  qs<HTMLInputElement>(selector).addEventListener("change", () => editor.setActiveRotation(axis, num(selector)));
}

editor.on("selection", refreshInspector);
editor.on("changed", refreshInspector);
editor.on("status", setStatus);
editor.on("recording", (active, count) => {
  setRecordButton(active);
  macroPill.classList.toggle("hidden", !active && count === 0);
  macroPill.textContent = active ? `Grabando · ${count} acción(es)` : `Macro · ${count} acción(es)`;
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
  if (typing) return;

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    editor.deleteSelected();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    event.preventDefault();
    editor.duplicateSelected();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    event.preventDefault();
    editor.copySelected();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    event.preventDefault();
    editor.paste();
  } else if (event.key === "2") {
    setTransformUi("translate");
  } else if (event.key === "3") {
    setTransformUi("rotate");
  } else if (event.key === "4") {
    setTransformUi("scale");
  }
});

const semanticApi = {
  createBox: () => editor.addPrimitive("box"),
  createCylinder: () => editor.addPrimitive("cylinder"),
  createSphere: () => editor.addPrimitive("sphere"),
  createText: (text: string) => editor.addText(text),
  duplicate: () => editor.duplicateSelected(),
  group: () => editor.groupSelected(),
  ungroup: () => editor.ungroupSelected(),
  toggleHole: () => editor.toggleHole(),
  union: () => editor.applyBoolean("union"),
  subtract: () => editor.applyBoolean("subtract"),
  intersect: () => editor.applyBoolean("intersect"),
  repeat: (times = 1) => editor.repeatMacro(times),
  scene: () => editor.snapshotSemanticScene(),
};

Object.assign(window, { tinkerMatt: semanticApi });

declare global {
  interface Window {
    tinkerMatt: typeof semanticApi;
  }
}

setRecordButton(false);
setStatus("TinkerMatt listo. Creá una forma desde el panel derecho.");
