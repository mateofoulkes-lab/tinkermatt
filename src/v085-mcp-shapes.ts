import * as THREE from "three";
import { createSketchObject, type SketchData, type SketchPoint } from "./v050-geometry";
import {
  buildPrimitiveGeometry,
  PARAMETRIC_KINDS,
  primitiveDefaults,
  type ParametricPrimitiveKind,
  type PrimitiveValues,
} from "./v059-geometry";
import { materialFor, normalizeToWorkplane, randomMaterialPreset } from "./geometry";
import { getMeta, makeId, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor?: TinkerEditor;
    tinkerMatt?: Record<string, any>;
  }
}

const editor = window.__tinkerEditor as any;
const api = (window.tinkerMatt ??= {});

const LABELS: Record<string, string> = {
  box: "Cubo",
  cylinder: "Cilindro",
  sphere: "Esfera",
  cone: "Cono",
  pyramid: "Pirámide",
  roof: "Techo",
  wedge: "Cuña",
  halfCylinder: "Bóveda",
  dome: "Cúpula",
  torus: "Toro",
  washer: "Arandela",
  prism: "Prisma",
  polyhedron: "Poliedro",
};

const KIND_ALIASES: Record<string, string> = {
  cube: "box", cubo: "box",
  cilindro: "cylinder",
  esfera: "sphere",
  cono: "cone",
  piramide: "pyramid", "pirámide": "pyramid",
  techo: "roof",
  cuna: "wedge", "cuña": "wedge",
  half_cylinder: "halfCylinder", "half-cylinder": "halfCylinder", halfcylinder: "halfCylinder", vault: "halfCylinder", boveda: "halfCylinder", "bóveda": "halfCylinder",
  cupula: "dome", "cúpula": "dome",
  toro: "torus",
  ring: "washer", anillo: "washer", arandela: "washer",
  prisma: "prism",
  poliedro: "polyhedron",
};

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeKind(value: unknown): ParametricPrimitiveKind {
  const raw = String(value ?? "").trim();
  const alias = KIND_ALIASES[raw.toLowerCase()] ?? raw;
  if (!PARAMETRIC_KINDS.has(alias as any)) {
    throw new Error(`Forma paramétrica no soportada: ${raw || "(vacía)"}. Usá list_shape_kinds para ver las disponibles.`);
  }
  return alias as ParametricPrimitiveKind;
}

function boundsOf(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    size: { x: size.x, y: size.y, z: size.z },
    center: { x: center.x, y: center.y, z: center.z },
  };
}

function objectInfo(object: THREE.Object3D) {
  const meta = getMeta(object);
  return {
    id: meta?.id ?? null,
    name: meta?.name ?? object.name,
    kind: meta?.kind ?? null,
    mode: meta?.mode ?? "solid",
    params: meta?.params ?? {},
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotationDegrees: {
      x: THREE.MathUtils.radToDeg(object.rotation.x),
      y: THREE.MathUtils.radToDeg(object.rotation.y),
      z: THREE.MathUtils.radToDeg(object.rotation.z),
    },
    bounds: boundsOf(object),
  };
}

function applyPlacement(id: string, args: any) {
  if (finite(args.posX) || finite(args.posY) || finite(args.posZ)) {
    api.moveObject?.({
      object: id,
      position: {
        x: finite(args.posX) ? args.posX : undefined,
        y: finite(args.posY) ? args.posY : undefined,
        z: finite(args.posZ) ? args.posZ : undefined,
      },
    });
  }
  if (finite(args.rotX) || finite(args.rotY) || finite(args.rotZ)) {
    api.rotateObject?.({
      object: id,
      rotationDegrees: {
        x: finite(args.rotX) ? args.rotX : undefined,
        y: finite(args.rotY) ? args.rotY : undefined,
        z: finite(args.rotZ) ? args.rotZ : undefined,
      },
    });
  }
  if (args.mode === "hole") api.setSolidMode?.({ object: id, mode: "hole" });
}

function listShapeKinds() {
  return {
    parametric: [...PARAMETRIC_KINDS].map((kind) => ({
      kind,
      label: LABELS[kind] ?? kind,
      defaultParameters: primitiveDefaults(kind as ParametricPrimitiveKind),
    })),
    profileFeatures: [
      {
        kind: "sketchExtrude",
        tool: "create_sketch_extrude",
        description: "Extruye un perfil 2D cerrado definido por puntos XY.",
      },
      {
        kind: "revolve",
        tool: "create_sketch_revolve",
        description: "Revoluciona un perfil 2D alrededor del eje Y local.",
      },
    ],
    genericTool: "create_shape",
    note: "create_shape usa este catálogo dinámico. Las tools específicas son atajos; para formas futuras preferí list_shape_kinds + create_shape.",
  };
}

function createShape(args: any = {}) {
  const kind = normalizeKind(args.kind);
  const defaults = primitiveDefaults(kind);
  const requested = args.parameters && typeof args.parameters === "object" ? args.parameters as PrimitiveValues : {};
  const material = randomMaterialPreset();
  const geometry = buildPrimitiveGeometry(kind, defaults);
  const mesh = new THREE.Mesh(geometry, materialFor(material));
  const id = makeId(kind);
  setMeta(mesh, {
    id,
    name: String(args.name ?? "").trim() || LABELS[kind] || kind,
    kind,
    mode: "solid",
    material,
    references: [],
    params: { ...defaults, primitiveVersion: 2 },
  });
  normalizeToWorkplane(mesh);
  editor.addObject(mesh);
  if (Object.keys(requested).length) {
    api.setPrimitiveParameters?.({ object: id, parameters: requested });
  }
  applyPlacement(id, args);
  const created = editor.findById?.(id) ?? mesh;
  return objectInfo(created);
}

function normalizePoint(value: any): SketchPoint {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Cada punto del perfil necesita x e y numéricos.");
  return {
    x,
    y,
    inX: finite(value?.inX) ? value.inX : x,
    inY: finite(value?.inY) ? value.inY : y,
    outX: finite(value?.outX) ? value.outX : x,
    outY: finite(value?.outY) ? value.outY : y,
  };
}

function sketchData(args: any): SketchData {
  if (!Array.isArray(args.points) || args.points.length < 3) throw new Error("El perfil necesita al menos 3 puntos.");
  return { points: args.points.map(normalizePoint), closed: true };
}

function finishSketchObject(mesh: THREE.Mesh, args: any) {
  const meta = getMeta(mesh);
  if (!meta) throw new Error("No se pudo crear metadata para el sólido de perfil.");
  if (String(args.name ?? "").trim()) {
    setMeta(mesh, { ...meta, name: String(args.name).trim() });
  }
  editor.addObject(mesh);
  applyPlacement(meta.id, args);
  return objectInfo(editor.findById?.(meta.id) ?? mesh);
}

function createSketchExtrudeRemote(args: any = {}) {
  const depth = Number(args.depth ?? 10);
  if (!Number.isFinite(depth) || depth <= 0) throw new Error("depth debe ser mayor que 0.");
  const mesh = createSketchObject(sketchData(args), { mode: "extrude", depth });
  return finishSketchObject(mesh, args);
}

function createSketchRevolveRemote(args: any = {}) {
  const angle = Math.min(360, Math.max(0.1, Number(args.angle ?? 360)));
  const segments = Math.round(Math.min(256, Math.max(3, Number(args.segments ?? 64))));
  const mesh = createSketchObject(sketchData(args), { mode: "revolve", angle, segments });
  return finishSketchObject(mesh, args);
}

api.listShapeKinds = listShapeKinds;
api.createShape = createShape;
api.createAdvancedPrimitive = createShape;
api.createSketchExtrudeRemote = createSketchExtrudeRemote;
api.createSketchRevolveRemote = createSketchRevolveRemote;
api.getPrimitiveParametersRemote = (args: any = {}) => api.getPrimitiveParameters?.(args.object);
api.setPrimitiveParametersRemote = (args: any = {}) => api.setPrimitiveParameters?.({ object: args.object, parameters: args.parameters ?? {} });

// Extend the existing v0.8.4 transactional dispatcher without duplicating its
// implementation. Old actions are delegated to the proven batch engine; the
// new shape actions share the same outer checkpoint and rollback semantics.
const previousBatch = typeof api.batch === "function" ? api.batch.bind(api) : null;
const NEW_ACTIONS = new Set([
  "list_shape_kinds",
  "create_shape",
  "create_advanced_primitive",
  "create_sketch_extrude",
  "create_sketch_revolve",
  "get_primitive_parameters",
  "set_primitive_parameters",
]);
const READ_ONLY_NEW = new Set(["list_shape_kinds", "get_primitive_parameters"]);

function actionName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function dispatchNew(action: string, args: any) {
  switch (action) {
    case "list_shape_kinds": return listShapeKinds();
    case "create_shape":
    case "create_advanced_primitive": return createShape(args);
    case "create_sketch_extrude": return createSketchExtrudeRemote(args);
    case "create_sketch_revolve": return createSketchRevolveRemote(args);
    case "get_primitive_parameters": return api.getPrimitiveParametersRemote(args);
    case "set_primitive_parameters": return api.setPrimitiveParametersRemote(args);
    default: throw new Error(`Acción de forma desconocida: ${action}`);
  }
}

if (previousBatch) {
  api.batch = async (input: any = {}) => {
    const operations = Array.isArray(input.operations) ? input.operations : [];
    if (!operations.some((op: any) => NEW_ACTIONS.has(actionName(op?.action)))) {
      return await previousBatch(input);
    }
    if (!operations.length || operations.length > 500) throw new Error("batch requiere entre 1 y 500 operaciones.");

    const rollbackOnError = input.rollbackOnError !== false;
    const mutating = operations.some((op: any) => {
      const name = actionName(op?.action);
      return NEW_ACTIONS.has(name) ? !READ_ONLY_NEW.has(name) : true;
    });
    const realCheckpoint = editor.checkpoint?.bind(editor);
    if (mutating) realCheckpoint?.();
    const previousCheckpoint = editor.checkpoint;
    editor.checkpoint = () => {};
    const results: any[] = [];

    try {
      for (let index = 0; index < operations.length; index += 1) {
        const op = operations[index] ?? {};
        const action = actionName(op.action);
        const args = op.args ?? {};
        let result: any;
        if (NEW_ACTIONS.has(action)) {
          result = await dispatchNew(action, args);
          if (!READ_ONLY_NEW.has(action)) api.__rememberOperation?.({ action, args });
        } else {
          const delegated = await previousBatch({ operations: [op], rollbackOnError: false });
          result = delegated?.results?.[0]?.result ?? delegated?.results?.[0] ?? delegated;
        }
        results.push({ index, action, ok: true, result });
      }
      return { ok: true, operations: operations.length, results };
    } catch (error) {
      if (mutating && rollbackOnError) {
        editor.checkpoint = previousCheckpoint;
        editor.undo?.();
      }
      throw error;
    } finally {
      editor.checkpoint = previousCheckpoint;
      if (mutating) {
        editor.emit?.("changed");
        editor.emit?.("selection", editor.selection ?? []);
      }
    }
  };
}

api.shapeToolsVersion = "0.8.5";
