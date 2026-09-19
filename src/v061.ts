import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import helvetikerRegular from "three/examples/fonts/helvetiker_regular.typeface.json";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json";
import optimerRegular from "three/examples/fonts/optimer_regular.typeface.json";
import optimerBold from "three/examples/fonts/optimer_bold.typeface.json";
import gentilisRegular from "three/examples/fonts/gentilis_regular.typeface.json";
import gentilisBold from "three/examples/fonts/gentilis_bold.typeface.json";
import droidSansRegular from "three/examples/fonts/droid/droid_sans_regular.typeface.json";
import droidSansBold from "three/examples/fonts/droid/droid_sans_bold.typeface.json";
import droidSerifRegular from "three/examples/fonts/droid/droid_serif_regular.typeface.json";
import droidSerifBold from "three/examples/fonts/droid/droid_serif_bold.typeface.json";
import droidMonoRegular from "three/examples/fonts/droid/droid_mono_regular.typeface.json";
import { icon } from "@fortawesome/fontawesome-svg-core";
import {
  faBold,
  faCheck,
  faCircleHalfStroke,
  faCube,
  faFont,
  faItalic,
  faObjectUngroup,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import "./v061.css";
import { booleanMeshes, materialFor, normalizeToWorkplane, randomMaterialPreset } from "./geometry";
import { clonePreservingIds, getMeta, makeId, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

type TextMode = "straight" | "banner" | "bottle";
type TextConfig = {
  text: string;
  mode: TextMode;
  font: string;
  bold: boolean;
  italic: boolean;
  height: number;
  depth: number;
  radius: number;
};
type BevelPickMode = "edge" | "vertex";
type BevelEdge = { key: string; aKey: string; bKey: string; a: THREE.Vector3; b: THREE.Vector3; triangles: number[] };
type BevelTopology = {
  vertices: Map<string, THREE.Vector3>;
  triangles: Array<{ normal: THREE.Vector3; keys: [string, string, string] }>;
  edges: Map<string, BevelEdge>;
  featureEdges: Set<string>;
  neighbors: Map<string, Set<string>>;
  epsilon: number;
};
type BevelHover = { kind: "edge"; edge: BevelEdge } | { kind: "vertex"; key: string; point: THREE.Vector3 };

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.6.1 no pudo acceder al editor.");
const rawEditor = editor as any;
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.1";
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvas = editor.renderer.domElement;

// -----------------------------------------------------------------------------
// Groups are atomic from the viewport. Their children remain directly selectable
// from the hierarchy, which is the explicit escape hatch requested for editing.
// -----------------------------------------------------------------------------
const originalSetSelection = editor.setSelection.bind(editor);
const originalSelectById = editor.selectById.bind(editor);
let explicitHierarchySelection = false;

function outerGroupFor(object: THREE.Object3D) {
  let current = object.parent;
  let group: THREE.Object3D | null = null;
  while (current && current !== editor.scene) {
    if (getMeta(current)?.kind === "group") group = current;
    current = current.parent;
  }
  return group;
}

rawEditor.setSelection = (objects: THREE.Object3D[]) => {
  if (explicitHierarchySelection) return originalSetSelection(objects);
  const promoted = objects.map((object) => outerGroupFor(object) ?? object);
  return originalSetSelection([...new Set(promoted)]);
};
rawEditor.selectById = (id: string, additive = false) => {
  explicitHierarchySelection = true;
  try { return originalSelectById(id, additive); }
  finally { explicitHierarchySelection = false; }
};

// -----------------------------------------------------------------------------
// Make the in-scene curved rotation arrows materially easier to hit and see.
// Shorter arc + wider ribbon + larger invisible hit target.
// -----------------------------------------------------------------------------
function rotationArcGeometry(start = THREE.MathUtils.degToRad(28), end = THREE.MathUtils.degToRad(112)) {
  const outer = 1;
  const inner = 0.76;
  const steps = 36;
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i += 1) {
    const a = THREE.MathUtils.lerp(start, end, i / steps);
    const x = Math.cos(a) * outer;
    const y = Math.sin(a) * outer;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const a = THREE.MathUtils.lerp(start, end, i / steps);
    shape.lineTo(Math.cos(a) * inner, Math.sin(a) * inner);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}
function rotationHeadGeometry(angle = THREE.MathUtils.degToRad(112)) {
  const end = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  const tangent = new THREE.Vector2(-Math.sin(angle), Math.cos(angle));
  const radial = end.clone().normalize();
  const tip = end.clone().add(tangent.clone().multiplyScalar(0.22));
  const back = end.clone().add(tangent.clone().multiplyScalar(-0.15));
  const left = back.clone().add(radial.clone().multiplyScalar(0.19));
  const right = back.clone().add(radial.clone().multiplyScalar(-0.19));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    tip.x, tip.y, 0.004,
    left.x, left.y, 0.004,
    right.x, right.y, 0.004,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}
function beefUpRotationControls() {
  const controls = editor.scene.getObjectByName("__tm_tinkercad_controls");
  if (!controls) return;
  for (const axis of ["x", "y", "z"] as const) {
    const root = controls.getObjectByName(`tm_rotate_${axis}`);
    if (!root || root.userData.tmWideRotation === true) continue;
    const meshes = root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const visible = meshes.filter((mesh) => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return !(material instanceof THREE.MeshBasicMaterial) || material.opacity > 0.01;
    });
    if (visible[0]) { visible[0].geometry.dispose(); visible[0].geometry = rotationArcGeometry(); }
    if (visible[1]) { visible[1].geometry.dispose(); visible[1].geometry = rotationHeadGeometry(); }
    const pick = meshes.find((mesh) => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return material instanceof THREE.MeshBasicMaterial && material.opacity <= 0.01;
    });
    if (pick) {
      pick.geometry.dispose();
      pick.geometry = new THREE.TorusGeometry(0.88, 0.25, 8, 52, THREE.MathUtils.degToRad(92));
      pick.rotation.z = THREE.MathUtils.degToRad(26);
    }
    root.userData.tmWideRotation = true;
  }
}
queueMicrotask(beefUpRotationControls);

// -----------------------------------------------------------------------------
// Text family: straight, curved banner, and cylindrical/bottle wrap.
// -----------------------------------------------------------------------------
const textButton = document.querySelector<HTMLButtonElement>("#add-text");
const textFamily = textButton?.closest<HTMLDetailsElement>(".library-family") ?? null;
function cloneTextChoice(id: string, label: string, title: string) {
  if (!textButton || document.getElementById(id)) return document.getElementById(id) as HTMLButtonElement | null;
  const button = textButton.cloneNode(true) as HTMLButtonElement;
  button.id = id;
  button.title = title;
  const labelNode = [...button.children].find((child) => !child.classList.contains("mini-shape"));
  if (labelNode) labelNode.textContent = label;
  textButton.insertAdjacentElement("afterend", button);
  return button;
}
const bannerTextButton = cloneTextChoice("add-text-banner", "Texto curvo · banner", "Texto curvado sobre un arco plano");
const bottleTextButton = cloneTextChoice("add-text-bottle", "Texto curvo · frasco", "Texto envuelto alrededor de un cilindro");

// v0.4.1 captured the family's child list before these buttons existed. Replace
// only this summary so its long-press flyout is rebuilt with all current children.
if (textFamily) {
  const oldSummary = textFamily.querySelector<HTMLElement>(":scope > summary");
  if (oldSummary) {
    const summary = oldSummary.cloneNode(true) as HTMLElement;
    oldSummary.replaceWith(summary);
    const items = [...textFamily.querySelectorAll<HTMLButtonElement>(":scope > .library-item")];
    let active = textButton ?? items[0];
    const flyout = document.createElement("div");
    flyout.className = "tm-tool-flyout hidden tm-v061-text-flyout";
    document.body.append(flyout);
    const currentIcon = (item: HTMLButtonElement) => item.querySelector<HTMLElement>(".mini-shape")?.innerHTML ?? icon(faFont).html.join("");
    const renderSummary = () => {
      summary.innerHTML = `<span class="tm-tool-current">${currentIcon(active)}</span><span class="tm-tool-corner">◢</span>`;
      summary.title = active.title || active.textContent?.trim() || "Texto";
    };
    renderSummary();
    let timer = 0;
    let long = false;
    const close = () => flyout.classList.add("hidden");
    const open = () => {
      flyout.replaceChildren();
      for (const item of items) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "tm-tool-flyout-item";
        choice.innerHTML = `<span class="mini-shape">${currentIcon(item)}</span><span>${item.title || item.textContent?.trim() || "Herramienta"}</span>`;
        choice.addEventListener("click", (event) => {
          event.preventDefault(); event.stopPropagation();
          active = item; renderSummary(); close(); item.click();
        });
        flyout.append(choice);
      }
      const rect = summary.getBoundingClientRect();
      flyout.style.left = `${rect.right + 6}px`;
      flyout.style.top = `${Math.max(8, Math.min(innerHeight - 80, rect.top))}px`;
      flyout.classList.remove("hidden");
    };
    summary.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); long = false; clearTimeout(timer);
      timer = window.setTimeout(() => { long = true; open(); }, 430);
    });
    summary.addEventListener("pointerup", (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); clearTimeout(timer);
      if (!long) active?.click();
    });
    summary.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
    document.addEventListener("pointerdown", (event) => {
      if (flyout.classList.contains("hidden")) return;
      const target = event.target as Node;
      if (!flyout.contains(target) && !summary.contains(target)) close();
    });
  }
}

type FontPreset = { id: string; label: string; regular: any; bold?: any; scaleX?: number };
const FONT_PRESETS: FontPreset[] = [
  { id: "helvetiker", label: "Helvetiker", regular: helvetikerRegular, bold: helvetikerBold },
  { id: "helvetiker-condensed", label: "Helvetiker Condensed", regular: helvetikerRegular, bold: helvetikerBold, scaleX: 0.78 },
  { id: "helvetiker-wide", label: "Helvetiker Wide", regular: helvetikerRegular, bold: helvetikerBold, scaleX: 1.22 },
  { id: "optimer", label: "Optimer", regular: optimerRegular, bold: optimerBold },
  { id: "optimer-condensed", label: "Optimer Condensed", regular: optimerRegular, bold: optimerBold, scaleX: 0.8 },
  { id: "optimer-wide", label: "Optimer Wide", regular: optimerRegular, bold: optimerBold, scaleX: 1.2 },
  { id: "gentilis", label: "Gentilis", regular: gentilisRegular, bold: gentilisBold },
  { id: "gentilis-wide", label: "Gentilis Wide", regular: gentilisRegular, bold: gentilisBold, scaleX: 1.18 },
  { id: "droid-sans", label: "Droid Sans", regular: droidSansRegular, bold: droidSansBold },
  { id: "droid-sans-condensed", label: "Droid Sans Condensed", regular: droidSansRegular, bold: droidSansBold, scaleX: 0.8 },
  { id: "droid-serif", label: "Droid Serif", regular: droidSerifRegular, bold: droidSerifBold },
  { id: "droid-mono", label: "Droid Mono", regular: droidMonoRegular, scaleX: 0.96 },
];
const fontLoader = new FontLoader();
const parsedFonts = new Map<string, any>();
function fontFor(preset: FontPreset, bold: boolean) {
  const key = `${preset.id}:${bold && preset.bold ? "bold" : "regular"}`;
  if (!parsedFonts.has(key)) parsedFonts.set(key, fontLoader.parse((bold && preset.bold ? preset.bold : preset.regular) as any));
  return parsedFonts.get(key);
}

function styledGeometry(text: string, config: TextConfig) {
  const preset = FONT_PRESETS.find((item) => item.id === config.font) ?? FONT_PRESETS[0];
  const geometry = new TextGeometry(text, {
    font: fontFor(preset, config.bold),
    size: config.height,
    depth: config.depth,
    curveSegments: 10,
    bevelEnabled: false,
  });
  const sx = preset.scaleX ?? 1;
  if (sx !== 1) geometry.scale(sx, 1, 1);
  if (config.italic) geometry.applyMatrix4(new THREE.Matrix4().set(
    1, 0.22, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function centeredGlyphGeometry(char: string, config: TextConfig) {
  const geometry = styledGeometry(char, config);
  const box = geometry.boundingBox;
  if (!box) return { geometry, width: config.height * 0.5 };
  const width = Math.max(0.01, box.max.x - box.min.x);
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -box.min.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, width };
}

function textMeta(config: TextConfig, material: ReturnType<typeof randomMaterialPreset>) {
  return {
    id: makeId("text"),
    name: `Texto: ${config.text}`,
    kind: "text" as const,
    mode: "solid" as const,
    material,
    references: [],
    params: {
      text: config.text,
      textMode: config.mode,
      font: config.font,
      bold: config.bold,
      italic: config.italic,
      height: config.height,
      depth: config.depth,
      radius: config.radius,
    },
  };
}

function createAdvancedText(config: TextConfig): THREE.Object3D {
  const materialPreset = randomMaterialPreset();
  const meta = textMeta(config, materialPreset);
  if (config.mode === "straight") {
    const geometry = styledGeometry(config.text || "Texto", config);
    const box = geometry.boundingBox;
    if (box) geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
    const mesh = new THREE.Mesh(geometry, materialFor(materialPreset));
    setMeta(mesh, meta);
    normalizeToWorkplane(mesh);
    return mesh;
  }

  const group = new THREE.Group();
  setMeta(group, meta);
  const chars = [...(config.text || "Texto")];
  const spacing = config.height * 0.08;
  const glyphs = chars.map((char) => {
    if (/\s/.test(char)) return { char, geometry: null as THREE.BufferGeometry | null, width: config.height * 0.42 };
    const glyph = centeredGlyphGeometry(char, config);
    return { char, geometry: glyph.geometry as THREE.BufferGeometry | null, width: glyph.width };
  });
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0) + Math.max(0, glyphs.length - 1) * spacing;
  const radius = Math.max(config.height, config.radius);
  let cursor = -total / 2;
  const sharedMaterial = materialFor(materialPreset);

  for (const glyph of glyphs) {
    const center = cursor + glyph.width / 2;
    cursor += glyph.width + spacing;
    if (!glyph.geometry) continue;
    const angle = center / radius;
    const mesh = new THREE.Mesh(glyph.geometry, sharedMaterial);
    if (config.mode === "banner") {
      mesh.position.set(Math.sin(angle) * radius, (Math.cos(angle) - 1) * radius, 0);
      mesh.rotation.z = -angle;
    } else {
      const radial = new THREE.Vector3(Math.sin(angle), -Math.cos(angle), 0);
      const tangent = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      const up = new THREE.Vector3(0, 0, 1);
      const basis = new THREE.Matrix4().makeBasis(tangent, up, radial);
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.position.copy(radial.multiplyScalar(radius));
    }
    group.add(mesh);
  }
  normalizeToWorkplane(group);
  return group;
}

const textDialog = document.createElement("div");
textDialog.className = "tm-text-dialog-backdrop hidden";
textDialog.innerHTML = `
  <div class="tm-text-dialog" role="dialog" aria-modal="true">
    <div class="tm-text-dialog-title"><span>Texto</span><button type="button" data-text-close title="Cancelar">${icon(faXmark).html.join("")}</button></div>
    <label class="tm-text-wide"><span>Contenido</span><input data-text-value type="text" value="TINKERMATT" /></label>
    <label><span>Tipografía</span><select data-text-font>${FONT_PRESETS.map((font) => `<option value="${font.id}">${font.label}</option>`).join("")}</select></label>
    <div class="tm-text-style-buttons">
      <button type="button" data-text-bold title="Negrita">${icon(faBold).html.join("")}</button>
      <button type="button" data-text-italic title="Cursiva">${icon(faItalic).html.join("")}</button>
    </div>
    <label><span>Altura</span><input data-text-height type="number" min="0.5" step="0.5" value="12" /><b>mm</b></label>
    <label><span>Extrusión</span><input data-text-depth type="number" min="0.1" step="0.1" value="2" /><b>mm</b></label>
    <label data-text-radius-row><span>Radio</span><input data-text-radius type="number" min="1" step="1" value="50" /><b>mm</b></label>
    <div class="tm-text-dialog-note" data-text-note></div>
    <div class="tm-text-dialog-actions"><button type="button" data-text-cancel>Cancelar</button><button type="button" class="primary" data-text-create>${icon(faCheck).html.join("")} Crear</button></div>
  </div>`;
document.body.append(textDialog);
const textValue = textDialog.querySelector<HTMLInputElement>("[data-text-value]")!;
const textFont = textDialog.querySelector<HTMLSelectElement>("[data-text-font]")!;
const textHeight = textDialog.querySelector<HTMLInputElement>("[data-text-height]")!;
const textDepth = textDialog.querySelector<HTMLInputElement>("[data-text-depth]")!;
const textRadius = textDialog.querySelector<HTMLInputElement>("[data-text-radius]")!;
const textRadiusRow = textDialog.querySelector<HTMLElement>("[data-text-radius-row]")!;
const textNote = textDialog.querySelector<HTMLElement>("[data-text-note]")!;
const textBold = textDialog.querySelector<HTMLButtonElement>("[data-text-bold]")!;
const textItalic = textDialog.querySelector<HTMLButtonElement>("[data-text-italic]")!;
let textMode: TextMode = "straight";
let bold = false;
let italic = false;
function openTextDialog(mode: TextMode) {
  textMode = mode;
  textDialog.classList.remove("hidden");
  textRadiusRow.classList.toggle("hidden", mode === "straight");
  textNote.textContent = mode === "straight" ? "Texto extruido plano." : mode === "banner" ? "Curva la línea base sobre un arco plano." : "Envuelve el texto alrededor de un cilindro vertical.";
  textValue.focus(); textValue.select();
}
function closeTextDialog() { textDialog.classList.add("hidden"); }
textBold.addEventListener("click", () => { bold = !bold; textBold.classList.toggle("active", bold); });
textItalic.addEventListener("click", () => { italic = !italic; textItalic.classList.toggle("active", italic); });
textDialog.querySelectorAll<HTMLElement>("[data-text-close],[data-text-cancel]").forEach((button) => button.addEventListener("click", closeTextDialog));
textDialog.querySelector<HTMLElement>("[data-text-create]")!.addEventListener("click", () => {
  const config: TextConfig = {
    text: textValue.value || "Texto",
    mode: textMode,
    font: textFont.value,
    bold,
    italic,
    height: Math.max(0.5, Number(textHeight.value) || 12),
    depth: Math.max(0.1, Number(textDepth.value) || 2),
    radius: Math.max(1, Number(textRadius.value) || 50),
  };
  const object = createAdvancedText(config);
  editor.addObject(object);
  closeTextDialog();
  setStatus(config.mode === "straight" ? "Texto extruido creado." : config.mode === "banner" ? "Texto curvo tipo banner creado." : "Texto curvo para frasco creado.");
});
textDialog.addEventListener("pointerdown", (event) => { if (event.target === textDialog) closeTextDialog(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && !textDialog.classList.contains("hidden")) closeTextDialog(); }, true);

document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("#add-text,#add-text-banner,#add-text-bottle");
  if (!button) return;
  event.preventDefault(); event.stopImmediatePropagation();
  openTextDialog(button.id === "add-text-banner" ? "banner" : button.id === "add-text-bottle" ? "bottle" : "straight");
}, true);

// -----------------------------------------------------------------------------
// Blender-like bevel tool: top toolbar tool, topology picking, depth + steps.
// It currently works on convex polygonal meshes; unlike the old primitive radius
// it operates only on the selected feature edges/vertices.
// -----------------------------------------------------------------------------
document.querySelector<HTMLElement>("#bevel-placeholder")?.closest<HTMLElement>(".library-family")?.remove();
const toolbar = document.querySelector<HTMLElement>(".toolbar-shell");
const scaleTool = document.querySelector<HTMLButtonElement>("#tool-scale");
const bevelTool = document.createElement("button");
bevelTool.type = "button";
bevelTool.className = "icon-button tm-bevel-tool";
bevelTool.title = "Bevel · biselar aristas o vértices seleccionados";
bevelTool.setAttribute("aria-label", "Bevel");
bevelTool.innerHTML = icon(faCube).html.join("");
if (scaleTool) scaleTool.insertAdjacentElement("afterend", bevelTool); else toolbar?.append(bevelTool);

const bevelPanel = document.createElement("div");
bevelPanel.className = "tm-bevel-panel hidden";
bevelPanel.innerHTML = `
  <div class="tm-bevel-title"><span>Bevel</span><button type="button" data-bevel-close title="Cerrar">${icon(faXmark).html.join("")}</button></div>
  <div class="tm-bevel-kind"><button type="button" class="active" data-bevel-kind="edge">Aristas</button><button type="button" data-bevel-kind="vertex">Vértices</button></div>
  <div class="tm-bevel-help">Click selecciona · Shift agrega/quita.</div>
  <div class="tm-bevel-count">0 seleccionados</div>
  <label><span>Profundidad</span><div><input data-bevel-depth-range type="range" min="0.1" max="10" step="0.1" value="1"/><input data-bevel-depth type="number" min="0.01" step="0.1" value="1"/></div></label>
  <label><span>Pasos</span><div><input data-bevel-steps-range type="range" min="1" max="8" step="1" value="1"/><input data-bevel-steps type="number" min="1" max="8" step="1" value="1"/></div></label>
  <div class="tm-bevel-warning"></div>
  <div class="tm-bevel-actions"><button type="button" data-bevel-cancel>Cancelar</button><button type="button" class="primary" data-bevel-apply>Aplicar</button></div>`;
document.body.append(bevelPanel);
const bevelLayer = document.createElement("div");
bevelLayer.className = "tm-bevel-pick-layer";
viewport.append(bevelLayer);
const bevelHoverGroup = new THREE.Group(); bevelHoverGroup.name = "__tm061_bevel_hover";
const bevelSelectedGroup = new THREE.Group(); bevelSelectedGroup.name = "__tm061_bevel_selected";
const bevelPreviewGroup = new THREE.Group(); bevelPreviewGroup.name = "__tm061_bevel_preview";
editor.scene.add(bevelHoverGroup, bevelSelectedGroup, bevelPreviewGroup);

const bevelDepthRange = bevelPanel.querySelector<HTMLInputElement>("[data-bevel-depth-range]")!;
const bevelDepthNumber = bevelPanel.querySelector<HTMLInputElement>("[data-bevel-depth]")!;
const bevelStepsRange = bevelPanel.querySelector<HTMLInputElement>("[data-bevel-steps-range]")!;
const bevelStepsNumber = bevelPanel.querySelector<HTMLInputElement>("[data-bevel-steps]")!;
const bevelCount = bevelPanel.querySelector<HTMLElement>(".tm-bevel-count")!;
const bevelWarning = bevelPanel.querySelector<HTMLElement>(".tm-bevel-warning")!;
let bevelActive = false;
let bevelMode: BevelPickMode = "edge";
let bevelTarget: THREE.Mesh | null = null;
let bevelTopology: BevelTopology | null = null;
let bevelHovered: BevelHover | null = null;
const selectedBevelEdges = new Set<string>();
const selectedBevelVertices = new Set<string>();
let previewTarget: THREE.Mesh | null = null;
let previewOriginalVisible = true;

function clear3dGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    child.removeFromParent();
    if ((child as THREE.Mesh).geometry && child.userData.tmOwnGeometry) (child as THREE.Mesh).geometry.dispose();
    const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material) (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
  }
}
function bevelPointKey(point: THREE.Vector3, epsilon: number) {
  return `${Math.round(point.x / epsilon)},${Math.round(point.y / epsilon)},${Math.round(point.z / epsilon)}`;
}
function bevelPairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
function buildBevelTopology(mesh: THREE.Mesh): BevelTopology {
  mesh.geometry.computeBoundingBox();
  const diagonal = mesh.geometry.boundingBox?.getSize(new THREE.Vector3()).length() || 1;
  const epsilon = Math.max(1e-6, diagonal * 1e-6);
  const vertices = new Map<string, THREE.Vector3>();
  const triangles: BevelTopology["triangles"] = [];
  const edges = new Map<string, BevelEdge>();
  const position = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.index;
  const count = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  const vertexAt = (tri: number, corner: number) => {
    const item = tri * 3 + corner;
    const idx = index ? index.getX(item) : item;
    return new THREE.Vector3().fromBufferAttribute(position, idx);
  };
  for (let tri = 0; tri < count; tri += 1) {
    const points = [vertexAt(tri, 0), vertexAt(tri, 1), vertexAt(tri, 2)] as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const keys = points.map((point) => {
      const key = bevelPointKey(point, epsilon);
      if (!vertices.has(key)) vertices.set(key, point.clone());
      return key;
    }) as [string, string, string];
    const normal = new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0])).normalize();
    triangles.push({ normal, keys });
    for (const [ia, ib] of [[0, 1], [1, 2], [2, 0]] as const) {
      const key = bevelPairKey(keys[ia], keys[ib]);
      const current = edges.get(key) ?? { key, aKey: keys[ia], bKey: keys[ib], a: points[ia].clone(), b: points[ib].clone(), triangles: [] };
      current.triangles.push(tri); edges.set(key, current);
    }
  }
  const featureEdges = new Set<string>();
  const neighbors = new Map<string, Set<string>>();
  const addNeighbor = (a: string, b: string) => {
    const set = neighbors.get(a) ?? new Set<string>(); set.add(b); neighbors.set(a, set);
  };
  for (const edge of edges.values()) {
    const normals = edge.triangles.map((tri) => triangles[tri]?.normal).filter(Boolean);
    const dot = normals.length >= 2 ? Math.abs(normals[0].dot(normals[1])) : -1;
    const structural = normals.length < 2 || dot < 0.99999;
    const feature = normals.length < 2 || dot < 0.985;
    if (structural) { addNeighbor(edge.aKey, edge.bKey); addNeighbor(edge.bKey, edge.aKey); }
    if (feature) featureEdges.add(edge.key);
  }
  return { vertices, triangles, edges, featureEdges, neighbors, epsilon };
}

const bevelRaycaster = new THREE.Raycaster();
function bevelHit(clientX: number, clientY: number) {
  if (!bevelTarget || !bevelTopology) return null;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  bevelRaycaster.setFromCamera(pointer, editor.camera);
  return bevelRaycaster.intersectObject(bevelTarget, false)[0] ?? null;
}
function projectClient(point: THREE.Vector3) {
  const rect = canvas.getBoundingClientRect();
  const p = point.clone().project(editor.camera);
  return new THREE.Vector2(rect.left + (p.x * 0.5 + 0.5) * rect.width, rect.top + (-p.y * 0.5 + 0.5) * rect.height);
}
function segmentDistance(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a); const len = ab.lengthSq();
  if (len < 1e-8) return p.distanceTo(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len, 0, 1);
  return p.distanceTo(a.add(ab.multiplyScalar(t)));
}
function bevelEntityAt(clientX: number, clientY: number): BevelHover | null {
  const hit = bevelHit(clientX, clientY);
  if (!hit || !bevelTarget || !bevelTopology || hit.faceIndex == null) return null;
  const tri = bevelTopology.triangles[hit.faceIndex];
  if (!tri) return null;
  bevelTarget.updateMatrixWorld(true);
  const cursor = new THREE.Vector2(clientX, clientY);
  if (bevelMode === "vertex") {
    let best: { key: string; point: THREE.Vector3; distance: number } | null = null;
    for (const key of tri.keys) {
      if (!(bevelTopology.neighbors.get(key)?.size)) continue;
      const point = bevelTopology.vertices.get(key)!;
      const distance = projectClient(point.clone().applyMatrix4(bevelTarget.matrixWorld)).distanceTo(cursor);
      if (!best || distance < best.distance) best = { key, point, distance };
    }
    return best && best.distance <= 18 ? { kind: "vertex", key: best.key, point: best.point } : null;
  }
  let best: { edge: BevelEdge; distance: number } | null = null;
  for (const [a, b] of [[tri.keys[0], tri.keys[1]], [tri.keys[1], tri.keys[2]], [tri.keys[2], tri.keys[0]]] as const) {
    const edge = bevelTopology.edges.get(bevelPairKey(a, b));
    if (!edge || !bevelTopology.featureEdges.has(edge.key)) continue;
    const aw = edge.a.clone().applyMatrix4(bevelTarget.matrixWorld);
    const bw = edge.b.clone().applyMatrix4(bevelTarget.matrixWorld);
    const distance = segmentDistance(cursor, projectClient(aw), projectClient(bw));
    if (!best || distance < best.distance) best = { edge, distance };
  }
  return best && best.distance <= 22 ? { kind: "edge", edge: best.edge } : null;
}
function addBevelHighlight(entity: BevelHover, group: THREE.Group, color: number) {
  if (!bevelTarget) return;
  bevelTarget.updateMatrixWorld(true);
  if (entity.kind === "vertex") {
    const geometry = new THREE.BufferGeometry().setFromPoints([entity.point.clone().applyMatrix4(bevelTarget.matrixWorld)]);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 13, sizeAttenuation: false, depthTest: false }));
    points.renderOrder = 2802; points.userData.tmOwnGeometry = true; group.add(points);
  } else {
    const geometry = new THREE.BufferGeometry().setFromPoints([entity.edge.a.clone().applyMatrix4(bevelTarget.matrixWorld), entity.edge.b.clone().applyMatrix4(bevelTarget.matrixWorld)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 }));
    line.renderOrder = 2801; line.userData.tmOwnGeometry = true; group.add(line);
  }
}
function refreshBevelHighlights() {
  clear3dGroup(bevelHoverGroup); clear3dGroup(bevelSelectedGroup);
  if (bevelHovered) addBevelHighlight(bevelHovered, bevelHoverGroup, 0xffa000);
  if (bevelTopology) {
    for (const key of selectedBevelEdges) {
      const edge = bevelTopology.edges.get(key); if (edge) addBevelHighlight({ kind: "edge", edge }, bevelSelectedGroup, 0x00aee8);
    }
    for (const key of selectedBevelVertices) {
      const point = bevelTopology.vertices.get(key); if (point) addBevelHighlight({ kind: "vertex", key, point }, bevelSelectedGroup, 0x00aee8);
    }
  }
  const count = bevelMode === "edge" ? selectedBevelEdges.size : selectedBevelVertices.size;
  bevelCount.textContent = `${count} seleccionado${count === 1 ? "" : "s"}`;
}
function normalizedLerp(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const vector = a.clone().multiplyScalar(1 - t).addScaledVector(b, t);
  return vector.lengthSq() < 1e-10 ? a.clone() : vector.normalize();
}
function bevelGeometry(mesh: THREE.Mesh, depth: number, steps: number) {
  const topology = buildBevelTopology(mesh);
  const out: THREE.Vector3[] = [];
  for (const [key, point] of topology.vertices) {
    const neighbors = [...(topology.neighbors.get(key) ?? [])];
    const selectedEdgeNeighbors = neighbors.filter((neighbor) => selectedBevelEdges.has(bevelPairKey(key, neighbor)));
    const affected = selectedBevelVertices.has(key) || selectedEdgeNeighbors.length > 0;
    if (!affected) { out.push(point.clone()); continue; }
    let useNeighbors = selectedBevelVertices.has(key) ? neighbors : neighbors.filter((neighbor) => !selectedEdgeNeighbors.includes(neighbor));
    if (useNeighbors.length < 2) useNeighbors = neighbors;
    if (useNeighbors.length < 2) { out.push(point.clone()); continue; }
    const distances = useNeighbors.map((neighbor) => point.distanceTo(topology.vertices.get(neighbor)!)).filter((value) => value > 1e-6);
    const localDepth = Math.min(depth, (Math.min(...distances) || depth) * 0.45);
    const dirs = useNeighbors.map((neighbor) => topology.vertices.get(neighbor)!.clone().sub(point).normalize());
    if (dirs.length === 2) {
      for (let i = 0; i <= steps; i += 1) out.push(point.clone().addScaledVector(normalizedLerp(dirs[0], dirs[1], i / steps), localDepth));
      continue;
    }
    const axis = dirs.reduce((sum, dir) => sum.add(dir), new THREE.Vector3()).normalize();
    let u = dirs[0].clone().addScaledVector(axis, -dirs[0].dot(axis));
    if (u.lengthSq() < 1e-8) u = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const ordered = dirs.slice().sort((a, b) => {
      const aa = Math.atan2(a.dot(v), a.dot(u));
      const bb = Math.atan2(b.dot(v), b.dot(u));
      return aa - bb;
    });
    for (let d = 0; d < ordered.length; d += 1) {
      const a = ordered[d]; const b = ordered[(d + 1) % ordered.length];
      for (let i = 0; i < steps; i += 1) out.push(point.clone().addScaledVector(normalizedLerp(a, b, i / steps), localDepth));
    }
  }
  const unique = new Map<string, THREE.Vector3>();
  for (const point of out) unique.set(`${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`, point);
  if (unique.size < 4) throw new Error("No hay suficientes vértices para aplicar el bevel.");
  const geometry = new ConvexGeometry([...unique.values()]);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
function clearBevelPreview() {
  if (previewTarget) previewTarget.visible = previewOriginalVisible;
  previewTarget = null;
  clear3dGroup(bevelPreviewGroup);
}
function currentBevelDepth() { return Math.max(0.01, Number(bevelDepthNumber.value) || 1); }
function currentBevelSteps() { return Math.max(1, Math.min(8, Math.round(Number(bevelStepsNumber.value) || 1))); }
function updateBevelPreview() {
  clearBevelPreview();
  if (!bevelTarget || (!selectedBevelEdges.size && !selectedBevelVertices.size)) return;
  try {
    const geometry = bevelGeometry(bevelTarget, currentBevelDepth(), currentBevelSteps());
    const material = new THREE.MeshStandardMaterial({ color: 0x52bce5, roughness: 0.45, metalness: 0.03, transparent: true, opacity: 0.76, depthWrite: false });
    const preview = new THREE.Mesh(geometry, material);
    bevelTarget.updateMatrixWorld(true);
    preview.matrix.copy(bevelTarget.matrixWorld); preview.matrixAutoUpdate = false; preview.renderOrder = 2700; preview.userData.tmOwnGeometry = true;
    previewOriginalVisible = bevelTarget.visible; previewTarget = bevelTarget; bevelTarget.visible = false;
    bevelPreviewGroup.add(preview);
    bevelWarning.textContent = "Vista previa · bevel geométrico sobre aristas/vértices seleccionados.";
  } catch (error) {
    bevelWarning.textContent = error instanceof Error ? error.message : String(error);
  }
}
function prepareBevelTarget() {
  clearBevelPreview();
  const active = editor.activeObject();
  if (!(active instanceof THREE.Mesh) || getMeta(active)?.kind === "group") {
    bevelTarget = null; bevelTopology = null;
    bevelWarning.textContent = "Seleccioná un sólido simple. Si está agrupado, elegí el hijo desde Objetos o desagrupá.";
    return false;
  }
  const kind = getMeta(active)?.kind;
  if (["torus", "washer", "text", "svg", "stl", "csg"].includes(kind ?? "")) {
    bevelTarget = null; bevelTopology = null;
    bevelWarning.textContent = "Esta primera versión del bevel por topología trabaja sobre mallas convexas/poligonales.";
    return false;
  }
  bevelTarget = active; bevelTopology = buildBevelTopology(active);
  const box = new THREE.Box3().setFromObject(active);
  const size = box.getSize(new THREE.Vector3());
  const max = Math.max(0.1, Math.min(size.x, size.y, size.z) * 0.45);
  bevelDepthRange.max = String(max); bevelDepthNumber.max = String(max);
  bevelWarning.textContent = "Elegí aristas o vértices sobre el modelo.";
  return true;
}
function setBevelActive(active: boolean) {
  bevelActive = active;
  bevelTool.classList.toggle("active", active);
  bevelPanel.classList.toggle("hidden", !active);
  bevelLayer.classList.toggle("active", active);
  if (active) {
    selectedBevelEdges.clear(); selectedBevelVertices.clear(); bevelHovered = null;
    prepareBevelTarget(); refreshBevelHighlights();
  } else {
    clearBevelPreview(); bevelHovered = null; selectedBevelEdges.clear(); selectedBevelVertices.clear(); refreshBevelHighlights();
  }
}
bevelTool.addEventListener("click", () => setBevelActive(!bevelActive));
bevelPanel.querySelectorAll<HTMLButtonElement>("[data-bevel-kind]").forEach((button) => button.addEventListener("click", () => {
  bevelMode = button.dataset.bevelKind as BevelPickMode;
  bevelPanel.querySelectorAll("[data-bevel-kind]").forEach((item) => item.classList.toggle("active", item === button));
  selectedBevelEdges.clear(); selectedBevelVertices.clear(); bevelHovered = null; clearBevelPreview(); refreshBevelHighlights();
  bevelWarning.textContent = bevelMode === "edge" ? "Elegí una o más aristas. Shift agrega/quita." : "Elegí uno o más vértices. Shift agrega/quita.";
}));
bevelLayer.addEventListener("pointermove", (event) => { if (bevelActive) { bevelHovered = bevelEntityAt(event.clientX, event.clientY); refreshBevelHighlights(); } });
bevelLayer.addEventListener("pointerleave", () => { bevelHovered = null; refreshBevelHighlights(); });
bevelLayer.addEventListener("click", (event) => {
  if (!bevelActive) return;
  event.preventDefault(); event.stopPropagation();
  const entity = bevelEntityAt(event.clientX, event.clientY); if (!entity) return;
  const set = entity.kind === "edge" ? selectedBevelEdges : selectedBevelVertices;
  const key = entity.kind === "edge" ? entity.edge.key : entity.key;
  if (!event.shiftKey) set.clear();
  if (event.shiftKey && set.has(key)) set.delete(key); else set.add(key);
  bevelHovered = entity; refreshBevelHighlights(); updateBevelPreview();
});
function syncBevelDepth(source: HTMLInputElement) {
  const value = Math.max(0.01, Number(source.value) || 1);
  bevelDepthRange.value = String(value); bevelDepthNumber.value = String(value); updateBevelPreview();
}
function syncBevelSteps(source: HTMLInputElement) {
  const value = Math.max(1, Math.min(8, Math.round(Number(source.value) || 1)));
  bevelStepsRange.value = String(value); bevelStepsNumber.value = String(value); updateBevelPreview();
}
bevelDepthRange.addEventListener("input", () => syncBevelDepth(bevelDepthRange));
bevelDepthNumber.addEventListener("input", () => syncBevelDepth(bevelDepthNumber));
bevelStepsRange.addEventListener("input", () => syncBevelSteps(bevelStepsRange));
bevelStepsNumber.addEventListener("input", () => syncBevelSteps(bevelStepsNumber));
bevelPanel.querySelectorAll<HTMLElement>("[data-bevel-close],[data-bevel-cancel]").forEach((button) => button.addEventListener("click", () => setBevelActive(false)));
bevelPanel.querySelector<HTMLElement>("[data-bevel-apply]")!.addEventListener("click", () => {
  if (!bevelTarget || (!selectedBevelEdges.size && !selectedBevelVertices.size)) { setStatus("Seleccioná al menos una arista o vértice."); return; }
  try {
    const geometry = bevelGeometry(bevelTarget, currentBevelDepth(), currentBevelSteps());
    editor.checkpoint(); clearBevelPreview();
    const old = bevelTarget.geometry; bevelTarget.geometry = geometry; old.dispose();
    const meta = getMeta(bevelTarget);
    if (meta) {
      (meta as any).kind = "beveled";
      meta.params = { ...(meta.params ?? {}), sourceKind: String(meta.kind), bevelDepth: currentBevelDepth(), bevelSteps: currentBevelSteps() };
      setMeta(bevelTarget, meta);
    }
    rawEditor.refreshSelectionHelpers?.(); rawEditor.emit?.("changed"); rawEditor.emit?.("selection", editor.getSelection());
    setStatus(`Bevel aplicado · ${currentBevelDepth().toFixed(2)} mm · ${currentBevelSteps()} paso(s).`);
    setBevelActive(false);
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
});
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && bevelActive) setBevelActive(false); }, true);
editor.on("selection", () => { if (bevelActive) { selectedBevelEdges.clear(); selectedBevelVertices.clear(); prepareBevelTarget(); refreshBevelHighlights(); } });

// -----------------------------------------------------------------------------
// Reversible CSG. Sources are serialized into the result so Separar can restore
// the exact pre-boolean objects after save/load, not only during this undo stack.
// -----------------------------------------------------------------------------
function serializeBooleanSources(meshes: THREE.Mesh[]) {
  const root = new THREE.Group();
  root.name = "TinkerMattBooleanSources";
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const clone = clonePreservingIds(mesh);
    const position = new THREE.Vector3(); const quaternion = new THREE.Quaternion(); const scale = new THREE.Vector3();
    mesh.matrixWorld.decompose(position, quaternion, scale);
    clone.position.copy(position); clone.quaternion.copy(quaternion); clone.scale.copy(scale);
    root.add(clone);
  }
  return JSON.stringify(root.toJSON());
}
rawEditor.applyBoolean = (operation: "union" | "subtract" | "intersect") => {
  const meshes = editor.getSelection().filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
  if (meshes.length !== editor.getSelection().length || meshes.length < 2) {
    setStatus("Para booleanas seleccioná dos o más sólidos simples (no grupos)."); return;
  }
  editor.checkpoint();
  try {
    const sources = serializeBooleanSources(meshes);
    const result = booleanMeshes(meshes, operation);
    const meta = getMeta(result)!;
    meta.params = { ...(meta.params ?? {}), booleanOperation: operation, booleanSources: sources };
    setMeta(result, meta);
    editor.setSelection([]); meshes.forEach((mesh) => mesh.removeFromParent()); editor.addObject(result, true, false);
    setStatus(operation === "union" ? "Unión booleana reversible aplicada." : operation === "intersect" ? "Intersección booleana reversible aplicada." : "Resta booleana reversible aplicada.");
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
};
function separateBoolean() {
  const targets = editor.getSelection().filter((object) => getMeta(object)?.kind === "csg" && typeof getMeta(object)?.params?.booleanSources === "string");
  if (!targets.length) { setStatus("Seleccioná una booleana reversible para separar sus objetos."); return false; }
  editor.checkpoint();
  const restored: THREE.Object3D[] = [];
  editor.setSelection([]);
  for (const target of targets) {
    const sourceText = String(getMeta(target)?.params?.booleanSources ?? "");
    try {
      const source = new THREE.ObjectLoader().parse(JSON.parse(sourceText));
      target.removeFromParent();
      for (const child of [...source.children]) {
        source.remove(child); rawEditor.prepareObject?.(child); editor.scene.add(child); restored.push(child);
      }
    } catch (error) { console.warn("TinkerMatt separar booleana", error); }
  }
  editor.setSelection(restored); rawEditor.emit?.("changed");
  setStatus(`${restored.length} objeto(s) restaurado(s) desde la booleana.`);
  return true;
}

const unionButton = document.querySelector<HTMLButtonElement>("#bool-union");
function boolButton(title: string, html: string) {
  const button = document.createElement("button"); button.type = "button"; button.className = unionButton?.className || "icon-button"; button.title = title; button.innerHTML = html; return button;
}
const intersectButton = boolButton("Intersección booleana", icon(faCircleHalfStroke).html.join(""));
intersectButton.id = "bool-intersect-v061";
const separateButton = boolButton("Separar booleana · recuperar los objetos originales", icon(faObjectUngroup).html.join(""));
separateButton.id = "bool-separate";
if (unionButton) {
  unionButton.insertAdjacentElement("afterend", intersectButton);
  intersectButton.insertAdjacentElement("afterend", separateButton);
} else toolbar?.append(intersectButton, separateButton);
intersectButton.addEventListener("click", () => rawEditor.applyBoolean("intersect"));
separateButton.addEventListener("click", separateBoolean);

Object.assign(window.tinkerMatt, {
  createStyledText: (config: Partial<TextConfig> & { text: string }) => {
    const object = createAdvancedText({
      text: config.text,
      mode: config.mode ?? "straight",
      font: config.font ?? "helvetiker",
      bold: Boolean(config.bold),
      italic: Boolean(config.italic),
      height: Math.max(0.5, Number(config.height) || 12),
      depth: Math.max(0.1, Number(config.depth) || 2),
      radius: Math.max(1, Number(config.radius) || 50),
    });
    editor.addObject(object); return getMeta(object);
  },
  separateBoolean,
});

setStatus("TinkerMatt v0.6.1 · grupos atómicos + texto avanzado + bevel por topología + booleanas reversibles.");
