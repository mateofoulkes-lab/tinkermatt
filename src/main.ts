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
  faFileImage,
  faCube,
  faDatabase,
  faFont,
  faGear,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import "./style.css";
import { TinkerEditor } from "./editor";
import { MATERIAL_PALETTE } from "./geometry";
import { getMeta, type MaterialPreset, type ReferenceKind, type SolidMode } from "./model";

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
  svg: faFileImage,
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
const refsList = qs<HTMLElement>("#refs-list");
const refName = qs<HTMLInputElement>("#ref-name");
const refKind = qs<HTMLSelectElement>("#ref-kind");
const recordButton = qs<HTMLButtonElement>("#record");
const macroPill = qs<HTMLElement>("#macro-pill");
const materialPalette = qs<HTMLElement>("#material-palette");
const outlinerTree = qs<HTMLElement>("#outliner-tree");
const snapEnabled = qs<HTMLInputElement>("#snap-enabled");
const gridSize = qs<HTMLInputElement>("#grid-size");
const snapStatus = qs<HTMLElement>("#snap-status");

const transformButtons = {
  translate: qs<HTMLButtonElement>("#tool-move"),
  rotate: qs<HTMLButtonElement>("#tool-rotate"),
  scale: qs<HTMLButtonElement>("#tool-scale"),
};

let transformShortcutArmed = false;
let inspectorRefreshing = false;

function setStatus(text: string) {
  status.textContent = text;
}

function setRecordButton(active: boolean) {
  recordButton.classList.toggle("active-recording", active);
  const symbol = icon(active ? faStop : faCircle).html.join("");
  recordButton.innerHTML = `<span class="fa-icon">${symbol}</span><span class="record-label">${active ? "Detener" : "Grabar"}</span>`;
}

function setTransformUi(mode: "translate" | "rotate" | "scale", armShortcut = false) {
  Object.values(transformButtons).forEach((button) => button.classList.remove("active"));
  transformButtons[mode].classList.add("active");
  qs<HTMLButtonElement>("#tool-select").classList.remove("active");
  editor.setTransformMode(mode);
  transformShortcutArmed = armShortcut;
}

function num(selector: string) {
  return Number(qs<HTMLInputElement>(selector).value);
}

function renderPalette(activeMaterial?: MaterialPreset) {
  materialPalette.innerHTML = "";
  for (const swatch of MATERIAL_PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `color-swatch${swatch.id === activeMaterial ? " active" : ""}`;
    button.title = swatch.label;
    button.style.background = `#${swatch.color.toString(16).padStart(6, "0")}`;
    button.addEventListener("click", () => {
      editor.checkpoint();
      editor.setMaterial(swatch.id);
    });
    materialPalette.append(button);
  }
}

function refreshInspector() {
  const selected = editor.getSelection();
  const object = editor.activeObject();
  if (!object) {
    inspector.classList.add("hidden");
    return;
  }

  inspectorRefreshing = true;
  inspector.classList.remove("hidden");
  const meta = getMeta(object);
  if (document.activeElement !== objectName) objectName.value = meta?.name ?? object.name ?? "Objeto";

  const setUnlessFocused = (selector: string, value: string) => {
    const input = qs<HTMLInputElement>(selector);
    if (document.activeElement !== input) input.value = value;
  };

  setUnlessFocused("#pos-x", object.position.x.toFixed(2));
  setUnlessFocused("#pos-y", object.position.y.toFixed(2));
  setUnlessFocused("#pos-z", object.position.z.toFixed(2));
  setUnlessFocused("#rot-x", THREE.MathUtils.radToDeg(object.rotation.x).toFixed(1));
  setUnlessFocused("#rot-y", THREE.MathUtils.radToDeg(object.rotation.y).toFixed(1));
  setUnlessFocused("#rot-z", THREE.MathUtils.radToDeg(object.rotation.z).toFixed(1));

  const size = editor.boundsOf(object);
  setUnlessFocused("#size-x", size.x.toFixed(2));
  setUnlessFocused("#size-y", size.y.toFixed(2));
  setUnlessFocused("#size-z", size.z.toFixed(2));
  qs<HTMLElement>("#selection-note").textContent = selected.length > 1 ? `${selected.length} objetos seleccionados · el último es el activo` : "";

  qs("#mode-solid").classList.toggle("active-preview", meta?.mode === "solid");
  qs("#mode-hole").classList.toggle("active-preview", meta?.mode === "hole");
  renderPalette(meta?.material);

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
  inspectorRefreshing = false;
}

function kindIcon(object: THREE.Object3D) {
  const kind = getMeta(object)?.kind;
  if (kind === "cylinder") return faDatabase;
  if (kind === "sphere") return faCircle;
  if (kind === "text") return faFont;
  if (kind === "svg") return faFileImage;
  if (kind === "group") return faObjectGroup;
  return faCube;
}

function renderOutliner() {
  const roots = editor.getSceneRoots();
  const selected = new Set(editor.getSelection());
  outlinerTree.innerHTML = "";

  if (!roots.length) {
    const empty = document.createElement("div");
    empty.className = "outliner-empty";
    empty.textContent = "La escena está vacía.";
    outlinerTree.append(empty);
    return;
  }

  const addObjectRow = (object: THREE.Object3D, depth: number) => {
    const meta = getMeta(object);
    if (!meta) return;
    const row = document.createElement("div");
    row.className = `outliner-row${selected.has(object) ? " selected" : ""}${object.visible ? "" : " hidden-object"}`;
    row.style.paddingLeft = `${4 + depth * 13}px`;
    row.dataset.id = meta.id;

    const kind = document.createElement("span");
    kind.className = "outliner-kind";
    kind.innerHTML = icon(kindIcon(object)).html.join("");

    const name = document.createElement("span");
    name.className = "outliner-name";
    name.textContent = meta.name;
    name.title = "Doble click para renombrar";

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "eye-button";
    eye.title = object.visible ? "Ocultar" : "Mostrar";
    eye.innerHTML = `<span class="fa-icon">${icon(object.visible ? faEye : faEyeSlash).html.join("")}</span>`;
    eye.addEventListener("click", (event) => {
      event.stopPropagation();
      editor.setVisibilityById(meta.id, !object.visible);
    });

    row.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button") || name.contentEditable === "true") return;
      editor.selectById(meta.id, (event as MouseEvent).shiftKey);
    });

    name.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      name.contentEditable = "true";
      name.focus();
      const range = document.createRange();
      range.selectNodeContents(name);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    const commitName = () => {
      if (name.contentEditable !== "true") return;
      name.contentEditable = "false";
      editor.renameById(meta.id, name.textContent?.trim() || meta.name);
    };
    name.addEventListener("blur", commitName);
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        name.blur();
      } else if (event.key === "Escape") {
        name.textContent = meta.name;
        name.contentEditable = "false";
        name.blur();
      }
    });

    row.append(kind, name, eye);
    outlinerTree.append(row);
    for (const child of object.children) if (getMeta(child)) addObjectRow(child, depth + 1);
  };

  roots.forEach((object) => addObjectRow(object, 0));
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-shape]")) {
  button.addEventListener("click", () => {
    const kind = button.dataset.shape as "box" | "cylinder" | "sphere";
    const mode = (button.dataset.mode ?? "solid") as SolidMode;
    editor.addPrimitive(kind, mode);
  });
}

qs("#tool-select").addEventListener("click", () => {
  editor.transform.detach();
  editor.clearAxisConstraint();
  qs("#tool-select").classList.add("active");
  Object.values(transformButtons).forEach((button) => button.classList.remove("active"));
  transformShortcutArmed = false;
  setStatus("Seleccionar. Shift + click agrega o quita de la selección.");
});
transformButtons.translate.addEventListener("click", () => setTransformUi("translate"));
transformButtons.rotate.addEventListener("click", () => setTransformUi("rotate"));
transformButtons.scale.addEventListener("click", () => setTransformUi("scale"));

qs("#undo").addEventListener("click", () => editor.undo());
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

qs("#mode-solid").addEventListener("click", () => editor.setSolidMode("solid"));
qs("#mode-hole").addEventListener("click", () => editor.setSolidMode("hole"));

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

const beginContinuousEdit = (input: HTMLInputElement) => {
  if (input.dataset.historyOpen === "1") return;
  editor.checkpoint();
  input.dataset.historyOpen = "1";
};
const endContinuousEdit = (input: HTMLInputElement) => {
  delete input.dataset.historyOpen;
};

objectName.addEventListener("focus", () => beginContinuousEdit(objectName));
objectName.addEventListener("blur", () => endContinuousEdit(objectName));
objectName.addEventListener("input", () => {
  if (!inspectorRefreshing) editor.setObjectName(objectName.value);
});

qs("#close-inspector").addEventListener("click", () => editor.setSelection([]));
qs("#add-ref").addEventListener("click", () => {
  editor.addReference(refKind.value as ReferenceKind, refName.value);
  refName.value = "";
});
refName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") qs<HTMLButtonElement>("#add-ref").click();
});

for (const [selector, axis] of [["#pos-x", "x"], ["#pos-y", "y"], ["#pos-z", "z"]] as const) {
  const input = qs<HTMLInputElement>(selector);
  input.addEventListener("focus", () => beginContinuousEdit(input));
  input.addEventListener("blur", () => endContinuousEdit(input));
  input.addEventListener("input", () => {
    if (!inspectorRefreshing) editor.setActivePosition(axis, num(selector));
  });
}
for (const [selector, axis] of [["#rot-x", "x"], ["#rot-y", "y"], ["#rot-z", "z"]] as const) {
  const input = qs<HTMLInputElement>(selector);
  input.addEventListener("focus", () => beginContinuousEdit(input));
  input.addEventListener("blur", () => endContinuousEdit(input));
  input.addEventListener("input", () => {
    if (!inspectorRefreshing) editor.setActiveRotation(axis, num(selector));
  });
}
for (const [selector, axis] of [["#size-x", "x"], ["#size-y", "y"], ["#size-z", "z"]] as const) {
  const input = qs<HTMLInputElement>(selector);
  input.addEventListener("focus", () => beginContinuousEdit(input));
  input.addEventListener("blur", () => endContinuousEdit(input));
  input.addEventListener("input", () => {
    if (!inspectorRefreshing) editor.setActiveDimension(axis, num(selector));
  });
}

for (const label of document.querySelectorAll<HTMLElement>(".scrub-label")) {
  label.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const input = qs<HTMLInputElement>(`#${label.dataset.input}`);
    const kind = label.dataset.kind as "position" | "rotation" | "size";
    const startX = event.clientX;
    const startValue = Number(input.value);
    const startSizes = {
      x: num("#size-x"),
      y: num("#size-y"),
      z: num("#size-z"),
    };
    editor.checkpoint();
    label.setPointerCapture(event.pointerId);

    const move = (pointer: PointerEvent) => {
      const deltaPx = pointer.clientX - startX;
      const multiplier = pointer.ctrlKey ? 10 : pointer.shiftKey ? 0.1 : 1;
      const perPixel = kind === "rotation" ? 0.5 : 0.1;
      const value = Math.max(kind === "size" ? 0.01 : -Infinity, startValue + deltaPx * perPixel * multiplier);
      input.value = value.toFixed(kind === "rotation" ? 1 : 2);
      const axis = label.dataset.input?.endsWith("x") ? "x" : label.dataset.input?.endsWith("y") ? "y" : "z";
      if (kind === "position") editor.setActivePosition(axis, value);
      else if (kind === "rotation") editor.setActiveRotation(axis, value);
      else if (pointer.altKey && startValue > 0) {
        const ratio = value / startValue;
        editor.setActiveDimension("x", Math.max(0.01, startSizes.x * ratio));
        editor.setActiveDimension("y", Math.max(0.01, startSizes.y * ratio));
        editor.setActiveDimension("z", Math.max(0.01, startSizes.z * ratio));
      } else editor.setActiveDimension(axis, value);
    };
    const up = () => {
      label.removeEventListener("pointermove", move);
      label.removeEventListener("pointerup", up);
      label.removeEventListener("pointercancel", up);
    };
    label.addEventListener("pointermove", move);
    label.addEventListener("pointerup", up);
    label.addEventListener("pointercancel", up);
  });
}

function updateSnap() {
  const size = Math.max(0.01, Number(gridSize.value) || 1);
  editor.setSnap(snapEnabled.checked, size);
  snapStatus.textContent = snapEnabled.checked ? `Snap ${size} mm` : "Snap off";
}
snapEnabled.addEventListener("change", updateSnap);
gridSize.addEventListener("input", updateSnap);

editor.on("selection", () => {
  refreshInspector();
  renderOutliner();
});
editor.on("changed", () => {
  refreshInspector();
  renderOutliner();
});
editor.on("status", setStatus);
editor.on("recording", (active, count) => {
  setRecordButton(active);
  macroPill.classList.toggle("hidden", !active && count === 0);
  macroPill.textContent = active ? `Grabando · ${count} acción(es)` : `Macro · ${count} acción(es)`;
});

function syncModifiers(event: KeyboardEvent) {
  editor.setModifiers({
    shift: event.shiftKey,
    ctrl: event.ctrlKey || event.metaKey,
    alt: event.altKey,
  });
}

window.addEventListener("keydown", (event) => {
  syncModifiers(event);
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;

  if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    editor.undo();
    return;
  }
  if (typing) return;

  const key = event.key.toLowerCase();
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    editor.deleteSelected();
  } else if ((event.ctrlKey || event.metaKey) && key === "d") {
    event.preventDefault();
    editor.duplicateSelected();
  } else if ((event.ctrlKey || event.metaKey) && key === "c") {
    event.preventDefault();
    editor.copySelected();
  } else if ((event.ctrlKey || event.metaKey) && key === "v") {
    event.preventDefault();
    editor.paste();
  } else if (key === "g" || key === "m") {
    event.preventDefault();
    setTransformUi("translate", true);
  } else if (key === "r") {
    event.preventDefault();
    setTransformUi("rotate", true);
  } else if (key === "s") {
    event.preventDefault();
    setTransformUi("scale", true);
  } else if (transformShortcutArmed && (key === "x" || key === "y" || key === "z")) {
    event.preventDefault();
    editor.constrainAxis(key);
  } else if (event.key === "Escape") {
    editor.clearAxisConstraint();
    transformShortcutArmed = false;
  }
});
window.addEventListener("keyup", syncModifiers);
window.addEventListener("blur", () => editor.setModifiers({ shift: false, ctrl: false, alt: false }));

const semanticApi = {
  createBox: (mode: SolidMode = "solid") => editor.addPrimitive("box", mode),
  createCylinder: (mode: SolidMode = "solid") => editor.addPrimitive("cylinder", mode),
  createSphere: (mode: SolidMode = "solid") => editor.addPrimitive("sphere", mode),
  createText: (text: string) => editor.addText(text),
  duplicate: () => editor.duplicateSelected(),
  group: () => editor.groupSelected(),
  ungroup: () => editor.ungroupSelected(),
  setHole: () => editor.setSolidMode("hole"),
  setSolid: () => editor.setSolidMode("solid"),
  union: () => editor.applyBoolean("union"),
  subtract: () => editor.applyBoolean("subtract"),
  intersect: () => editor.applyBoolean("intersect"),
  repeat: (times = 1) => editor.repeatMacro(times),
  undo: () => editor.undo(),
  setSnap: (enabled: boolean, size = 1) => editor.setSnap(enabled, size),
  scene: () => editor.snapshotSemanticScene(),
};

Object.assign(window, { tinkerMatt: semanticApi });

declare global {
  interface Window {
    tinkerMatt: typeof semanticApi;
  }
}

setRecordButton(false);
renderPalette();
renderOutliner();
updateSnap();
setStatus("TinkerMatt listo. Formas a la izquierda; objetos de la escena a la derecha.");
