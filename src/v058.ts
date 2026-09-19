import * as THREE from "three";
import { getMeta, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.8 no pudo acceder al editor.");
const rawEditor = editor as any;

const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.8";

/**
 * Native extruded text for semantic/MCP callers.
 * TinkerMatt's existing text primitive is 12 mm high and 2 mm deep; this layer
 * keeps using that same primitive, then applies parametric scale so the MCP can
 * request useful dimensions without drawing letters out of boxes.
 */
async function createText(args: {
  text: string;
  name?: string;
  height?: number;
  depth?: number;
  mode?: "solid" | "hole";
  position?: Partial<Record<"x" | "y" | "z", number>>;
  rotationDegrees?: Partial<Record<"x" | "y" | "z", number>>;
} = { text: "Texto" }) {
  const text = String(args.text ?? "").trim();
  if (!text) throw new Error("El texto no puede estar vacío.");

  const height = Number(args.height ?? 12);
  const depth = Number(args.depth ?? 2);
  if (!Number.isFinite(height) || height <= 0) throw new Error("La altura del texto debe ser mayor que cero.");
  if (!Number.isFinite(depth) || depth <= 0) throw new Error("La profundidad del texto debe ser mayor que cero.");

  const object = await editor.addText(text);
  const meta = getMeta(object)!;

  // Existing native text primitive defaults: height 12 mm, depth 2 mm.
  const xyScale = height / 12;
  object.scale.x *= xyScale;
  object.scale.y *= xyScale;
  object.scale.z *= depth / 2;

  meta.params = { ...(meta.params ?? {}), text, height, depth };
  if (typeof args.name === "string" && args.name.trim()) meta.name = args.name.trim();
  object.name = meta.name;
  setMeta(object, meta);

  if (args.position) {
    for (const axis of ["x", "y", "z"] as const) {
      const value = args.position[axis];
      if (Number.isFinite(value)) object.position[axis] = Number(value);
    }
  }

  if (args.rotationDegrees) {
    for (const axis of ["x", "y", "z"] as const) {
      const value = args.rotationDegrees[axis];
      if (Number.isFinite(value)) object.rotation[axis] = THREE.MathUtils.degToRad(Number(value));
    }
  }

  if (args.mode === "hole") rawEditor.applySolidMode?.(object, "hole");

  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());

  const size = editor.boundsOf(object);
  return {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    mode: getMeta(object)?.mode,
    text,
    height,
    depth,
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotationDegrees: {
      x: THREE.MathUtils.radToDeg(object.rotation.x),
      y: THREE.MathUtils.radToDeg(object.rotation.y),
      z: THREE.MathUtils.radToDeg(object.rotation.z),
    },
    size,
  };
}

Object.assign(window.tinkerMatt, { createText });
