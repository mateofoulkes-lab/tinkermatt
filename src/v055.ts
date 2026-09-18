import * as THREE from "three";
import { icon } from "@fortawesome/fontawesome-svg-core";
import { faFloppyDisk, faFolderOpen, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import "./v055.css";
import { clonePreservingIds, getMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, unknown>;
  }
}

type ProjectFile = {
  format: "TinkerMatt";
  formatVersion: 1;
  appVersion: string;
  name: string;
  savedAt: string;
  snap: { enabled: boolean; gridSize: number };
  scene: ReturnType<THREE.Object3D["toJSON"]>;
};

type ObjectMoveState = {
  object: THREE.Object3D;
  position: THREE.Vector3;
};

type Gesture =
  | {
      kind: "object";
      pointerId: number;
      startX: number;
      startY: number;
      hit: THREE.Object3D;
      wasSelected: boolean;
      shiftAtStart: boolean;
      moving: boolean;
      checkpointed: boolean;
      startWorld: THREE.Vector3 | null;
      planeZ: number;
      states: ObjectMoveState[];
    }
  | {
      kind: "marquee";
      pointerId: number;
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
      dragging: boolean;
      additive: boolean;
      baseSelection: THREE.Object3D[];
    };

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.5 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.5";

const toolbar = document.querySelector<HTMLElement>(".toolbar-shell")!;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => {
  if (status) status.textContent = text;
};

// -----------------------------------------------------------------------------
// Project name + native TinkerMatt project format.
// -----------------------------------------------------------------------------
const projectControls = document.createElement("div");
projectControls.className = "tm-project-controls";

const projectName = document.createElement("input");
projectName.className = "tm-project-name";
projectName.type = "text";
projectName.maxLength = 120;
projectName.spellcheck = false;
projectName.title = "Nombre del proyecto";
projectName.value = localStorage.getItem("tinkermatt-project-name") || "Diseño sin nombre";
projectName.setAttribute("aria-label", "Nombre del proyecto");

function projectButton(title: string, html: string, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `tm-project-button ${extraClass}`.trim();
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = html;
  return button;
}

const openButton = projectButton("Abrir proyecto .tinkermatt", icon(faFolderOpen).html.join(""));
const saveButton = projectButton("Guardar proyecto .tinkermatt", icon(faFloppyDisk).html.join(""));
const clearButton = projectButton("Clear · borrar todos los objetos", `${icon(faTrashCan).html.join("")}<span>Clear</span>`, "tm-clear");
const openInput = document.createElement("input");
openInput.type = "file";
openInput.accept = ".tinkermatt,application/json";
openInput.hidden = true;

projectControls.append(projectName, openButton, saveButton, clearButton, openInput);
const logo = toolbar.querySelector<HTMLElement>(".logo-wrap");
if (logo) logo.insertAdjacentElement("afterend", projectControls);
else toolbar.prepend(projectControls);

function cleanProjectName() {
  return projectName.value.trim() || "Diseño sin nombre";
}

function safeFilename(name: string) {
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 100);
  return clean || "tinkermatt";
}

projectName.addEventListener("input", () => {
  const name = cleanProjectName();
  localStorage.setItem("tinkermatt-project-name", name);
  document.title = `${name} · TinkerMatt`;
});
document.title = `${cleanProjectName()} · TinkerMatt`;

function projectPayload(): ProjectFile {
  const root = new THREE.Group();
  root.name = "TinkerMattProject";
  for (const object of editor.getSceneRoots()) root.add(clonePreservingIds(object));
  return {
    format: "TinkerMatt",
    formatVersion: 1,
    appVersion: "0.5.5",
    name: cleanProjectName(),
    savedAt: new Date().toISOString(),
    snap: editor.getSnap(),
    scene: root.toJSON(),
  };
}

function saveProject() {
  const payload = projectPayload();
  const blob = new Blob([JSON.stringify(payload)], { type: "application/x-tinkermatt+json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFilename(payload.name)}.tinkermatt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`Proyecto “${payload.name}” guardado.`);
}

function replaceSceneFromProject(payload: ProjectFile) {
  if (payload.format !== "TinkerMatt" || payload.formatVersion !== 1 || !payload.scene) {
    throw new Error("El archivo no es un proyecto TinkerMatt compatible.");
  }

  const parsed = new THREE.ObjectLoader().parse(payload.scene as any);
  editor.checkpoint();
  editor.setSelection([]);
  for (const object of editor.getSceneRoots()) object.removeFromParent();

  const children = [...parsed.children];
  for (const child of children) {
    parsed.remove(child);
    rawEditor.prepareObject?.(child);
    editor.scene.add(child);
  }

  projectName.value = payload.name?.trim() || "Diseño sin nombre";
  localStorage.setItem("tinkermatt-project-name", cleanProjectName());
  document.title = `${cleanProjectName()} · TinkerMatt`;
  if (payload.snap) editor.setSnap(Boolean(payload.snap.enabled), Number(payload.snap.gridSize) || 1);
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
  setStatus(`Proyecto “${cleanProjectName()}” abierto.`);
}

openButton.addEventListener("click", () => openInput.click());
saveButton.addEventListener("click", saveProject);
openInput.addEventListener("change", async () => {
  const file = openInput.files?.[0];
  openInput.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text()) as ProjectFile;
    replaceSceneFromProject(payload);
  } catch (error) {
    setStatus(`No se pudo abrir el proyecto: ${error instanceof Error ? error.message : String(error)}`);
  }
});

function clearScene(confirmFirst = true) {
  const roots = editor.getSceneRoots();
  if (!roots.length) {
    setStatus("La escena ya está vacía.");
    return;
  }
  if (confirmFirst && !window.confirm(`¿Borrar los ${roots.length} objeto(s) del proyecto?`)) return;
  editor.checkpoint();
  editor.setSelection([]);
  for (const object of roots) object.removeFromParent();
  rawEditor.emit?.("changed");
  setStatus("Escena vaciada. Podés deshacerlo con Ctrl+Z.");
}
clearButton.addEventListener("click", () => clearScene(true));

// -----------------------------------------------------------------------------
// Direct object drag (LMB) + drag-box selection on empty space.
// LMB drag on an object mirrors M/G in its default XY-plane translation mode.
// -----------------------------------------------------------------------------
const marquee = document.createElement("div");
marquee.className = "tm-marquee";
viewport.append(marquee);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let gesture: Gesture | null = null;
const DRAG_THRESHOLD = 4;

function entityRoot(object: THREE.Object3D | null) {
  let node = object;
  while (node && node !== editor.scene) {
    if (getMeta(node)) return node;
    node = node.parent;
  }
  return null;
}

function hitEntity(clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, editor.camera);
  const meshes: THREE.Mesh[] = [];
  for (const root of editor.getSceneRoots()) {
    if (!root.visible) continue;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.visible) meshes.push(node);
    });
  }
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? entityRoot(hit.object) : null;
}

function rayToHorizontalPlane(clientX: number, clientY: number, z: number) {
  const rect = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(p, editor.camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3());
}

function snapScalar(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}

function updateMarquee(startX: number, startY: number, endX: number, endY: number) {
  const rect = viewport.getBoundingClientRect();
  const left = Math.min(startX, endX) - rect.left;
  const top = Math.min(startY, endY) - rect.top;
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  marquee.style.left = `${left}px`;
  marquee.style.top = `${top}px`;
  marquee.style.width = `${width}px`;
  marquee.style.height = `${height}px`;
}

function projectClient(world: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const p = world.clone().project(editor.camera);
  return {
    x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
    z: p.z,
  };
}

function screenBounds(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  const points = corners.map(projectClient);
  if (points.every((point) => point.z < -1 || point.z > 1)) return null;
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function enclosedObjects(startX: number, startY: number, endX: number, endY: number) {
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  return editor.getSceneRoots().filter((object) => {
    if (!object.visible) return false;
    const bounds = screenBounds(object);
    if (!bounds) return false;
    return bounds.left >= left && bounds.right <= right && bounds.top >= top && bounds.bottom <= bottom;
  });
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || gesture) return;
  const hit = hitEntity(event.clientX, event.clientY);

  if (hit) {
    const before = editor.getSelection();
    const wasSelected = before.includes(hit);
    if (!wasSelected) {
      editor.setSelection(event.shiftKey ? [...before, hit] : [hit]);
    } else if (!event.shiftKey && editor.activeObject() !== hit) {
      editor.setSelection([...before.filter((object) => object !== hit), hit]);
    }

    const selection = editor.getSelection();
    const bounds = new THREE.Box3().setFromObject(hit);
    const center = bounds.getCenter(new THREE.Vector3());
    gesture = {
      kind: "object",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      hit,
      wasSelected,
      shiftAtStart: event.shiftKey,
      moving: false,
      checkpointed: false,
      planeZ: center.z,
      startWorld: rayToHorizontalPlane(event.clientX, event.clientY, center.z),
      states: selection.map((object) => ({ object, position: object.position.clone() })),
    };
  } else {
    gesture = {
      kind: "marquee",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      dragging: false,
      additive: event.shiftKey,
      baseSelection: editor.getSelection(),
    };
  }

  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener("pointermove", (event) => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;

  if (gesture.kind === "object") {
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (!gesture.moving && distance >= DRAG_THRESHOLD && gesture.startWorld) {
      gesture.moving = true;
      if (!gesture.checkpointed) {
        editor.checkpoint();
        gesture.checkpointed = true;
      }
      editor.orbit.enabled = false;
      viewport.classList.add("tm-direct-dragging");
    }
    if (!gesture.moving || !gesture.startWorld) return;

    const current = rayToHorizontalPlane(event.clientX, event.clientY, gesture.planeZ);
    if (!current) return;
    const delta = current.sub(gesture.startWorld);
    const snap = editor.getSnap();
    if (snap.enabled) {
      const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      const step = snap.gridSize * multiplier;
      delta.x = snapScalar(delta.x, step);
      delta.y = snapScalar(delta.y, step);
    }
    delta.z = 0;
    for (const state of gesture.states) state.object.position.copy(state.position).add(delta);
    rawEditor.refreshSelectionHelpers?.();
    rawEditor.emit?.("changed");
    setStatus(`Mover XY: ${delta.x.toFixed(2)}, ${delta.y.toFixed(2)} mm`);
  } else {
    gesture.currentX = event.clientX;
    gesture.currentY = event.clientY;
    const distance = Math.hypot(gesture.currentX - gesture.startX, gesture.currentY - gesture.startY);
    if (!gesture.dragging && distance >= DRAG_THRESHOLD) {
      gesture.dragging = true;
      marquee.classList.add("visible");
      viewport.classList.add("tm-marquee-dragging");
    }
    if (gesture.dragging) updateMarquee(gesture.startX, gesture.startY, gesture.currentX, gesture.currentY);
  }

  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function endGesture(event: PointerEvent, cancelled = false) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const ended = gesture;
  gesture = null;
  marquee.classList.remove("visible");
  viewport.classList.remove("tm-direct-dragging", "tm-marquee-dragging");
  editor.orbit.enabled = true;

  if (!cancelled && ended.kind === "object") {
    if (!ended.moving && ended.shiftAtStart && ended.wasSelected) {
      editor.setSelection(editor.getSelection().filter((object) => object !== ended.hit));
    } else if (ended.moving) {
      rawEditor.refreshSelectionHelpers?.();
      rawEditor.emit?.("changed");
      setStatus("Objeto(s) movido(s). Ctrl+Z para deshacer.");
    }
  } else if (!cancelled && ended.kind === "marquee") {
    if (ended.dragging) {
      const enclosed = enclosedObjects(ended.startX, ended.startY, ended.currentX, ended.currentY);
      if (ended.additive) editor.setSelection([...new Set([...ended.baseSelection, ...enclosed])]);
      else editor.setSelection(enclosed);
      setStatus(`${enclosed.length} objeto(s) encerrado(s) en la selección.`);
    } else if (!ended.additive) {
      editor.setSelection([]);
    }
  }

  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* no-op */ }
}

window.addEventListener("pointerup", (event) => endGesture(event, false), true);
window.addEventListener("pointercancel", (event) => endGesture(event, true), true);

window.tinkerMatt ??= {};
Object.assign(window.tinkerMatt, {
  clear: () => clearScene(false),
  saveProject: () => projectPayload(),
  loadProject: (payload: ProjectFile) => replaceSceneFromProject(payload),
  projectName: () => cleanProjectName(),
  setProjectName: (name: string) => {
    projectName.value = name.trim() || "Diseño sin nombre";
    projectName.dispatchEvent(new Event("input"));
  },
});

setStatus("TinkerMatt v0.5.5 · proyecto .tinkermatt + arrastre directo + selección por recuadro.");
