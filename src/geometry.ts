import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { makeId, setMeta, type MaterialPreset, type ShapeKind, type SolidMode, type TinkerMeta } from "./model";

export const MATERIAL_PALETTE: Array<{ id: MaterialPreset; color: number; label: string; metalness?: number; roughness?: number }> = [
  { id: "red", color: 0xe74c3c, label: "Rojo" },
  { id: "orange", color: 0xf97316, label: "Naranja" },
  { id: "amber", color: 0xf59e0b, label: "Ámbar" },
  { id: "yellow", color: 0xfacc15, label: "Amarillo" },
  { id: "lime", color: 0x84cc16, label: "Lima" },
  { id: "green", color: 0x22c55e, label: "Verde" },
  { id: "emerald", color: 0x10b981, label: "Esmeralda" },
  { id: "teal", color: 0x14b8a6, label: "Turquesa" },
  { id: "cyan", color: 0x06b6d4, label: "Cian" },
  { id: "sky", color: 0x38bdf8, label: "Celeste" },
  { id: "blue", color: 0x3b82f6, label: "Azul" },
  { id: "indigo", color: 0x6366f1, label: "Índigo" },
  { id: "violet", color: 0x8b5cf6, label: "Violeta" },
  { id: "purple", color: 0xa855f7, label: "Púrpura" },
  { id: "fuchsia", color: 0xd946ef, label: "Fucsia" },
  { id: "pink", color: 0xec4899, label: "Rosa" },
  { id: "rose", color: 0xf43f5e, label: "Rosado" },
  { id: "brown", color: 0x8b5a3c, label: "Marrón" },
  { id: "tan", color: 0xd2a679, label: "Arena" },
  { id: "gray", color: 0x9ca3af, label: "Gris" },
  { id: "slate", color: 0x64748b, label: "Pizarra" },
  { id: "black", color: 0x1f2937, label: "Negro" },
  { id: "white", color: 0xf8fafc, label: "Blanco" },
  { id: "gold", color: 0xd4af37, label: "Oro", metalness: 1, roughness: 0.18 },
  { id: "silver", color: 0xcbd5e1, label: "Plata", metalness: 1, roughness: 0.22 },
];

const RANDOM_PRESETS = MATERIAL_PALETTE.filter(({ id }) => !["black", "white", "gray", "slate", "gold", "silver"].includes(id));

export function randomMaterialPreset(): MaterialPreset {
  return RANDOM_PRESETS[Math.floor(Math.random() * RANDOM_PRESETS.length)]?.id ?? "blue";
}

export function materialFor(preset: MaterialPreset, mode: SolidMode = "solid") {
  if (mode === "hole") {
    return new THREE.MeshStandardMaterial({
      color: 0x7d8790,
      roughness: 0.85,
      metalness: 0,
      transparent: true,
      opacity: 0.28,
      wireframe: true,
      depthWrite: false,
    });
  }
  const swatch = MATERIAL_PALETTE.find((item) => item.id === preset) ?? MATERIAL_PALETTE[10];
  return new THREE.MeshStandardMaterial({
    color: swatch.color,
    roughness: swatch.roughness ?? 0.42,
    metalness: swatch.metalness ?? 0.08,
  });
}

function baseMeta(kind: ShapeKind, name: string, params: Record<string, number | string | boolean> = {}, material = randomMaterialPreset()): TinkerMeta {
  return {
    id: makeId(kind),
    name,
    kind,
    mode: "solid",
    material,
    references: [],
    params,
  };
}

export function createBox(width = 20, depth = 20, height = 20) {
  const meta = baseMeta("box", "Cubo", { width, depth, height });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, depth, height), materialFor(meta.material));
  setMeta(mesh, meta);
  mesh.position.z = height / 2;
  return mesh;
}

export function createCylinder(radius = 10, height = 20, sides = 64) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, sides);
  geometry.rotateX(Math.PI / 2);
  const meta = baseMeta("cylinder", "Cilindro", { radius, height, sides });
  const mesh = new THREE.Mesh(geometry, materialFor(meta.material));
  setMeta(mesh, meta);
  mesh.position.z = height / 2;
  return mesh;
}

export function createSphere(radius = 10, segments = 48) {
  const meta = baseMeta("sphere", "Esfera", { radius, segments });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(24, segments / 2)), materialFor(meta.material));
  setMeta(mesh, meta);
  mesh.position.z = radius;
  return mesh;
}

export async function createText(text: string, depth = 2, height = 12) {
  const loader = new FontLoader();
  const font = await loader.loadAsync("https://threejs.org/examples/fonts/helvetiker_regular.typeface.json");
  const geometry = new TextGeometry(text, {
    font,
    size: height,
    depth,
    curveSegments: 8,
    bevelEnabled: false,
  });
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (bb) geometry.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -bb.min.z);
  const meta = baseMeta("text", `Texto: ${text}`, { text, depth, height });
  const mesh = new THREE.Mesh(geometry, materialFor(meta.material));
  setMeta(mesh, meta);
  return mesh;
}

export function createFromSvg(svgText: string, depth = 2) {
  const data = new SVGLoader().parse(svgText);
  const group = new THREE.Group();
  const meta = baseMeta("svg", "SVG", { depth });
  setMeta(group, meta);

  for (const path of data.paths) {
    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
      geometry.scale(0.264583, -0.264583, 1);
      group.add(new THREE.Mesh(geometry, materialFor(meta.material)));
    }
  }

  normalizeToWorkplane(group);
  return group;
}

export function createFromStl(buffer: ArrayBuffer) {
  const geometry = new STLLoader().parse(buffer);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, materialFor("gray"));
  setMeta(mesh, { ...baseMeta("stl", "STL importado", {}, "gray"), material: "gray" });
  normalizeToWorkplane(mesh);
  return mesh;
}

export function normalizeToWorkplane(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= center.y;
  object.position.z -= box.min.z;
  object.updateMatrixWorld(true);
}

function meshToBrush(mesh: THREE.Mesh) {
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  return new Brush(geometry, materialFor("blue"));
}

export function booleanMeshes(meshes: THREE.Mesh[], operation: "union" | "subtract" | "intersect") {
  if (meshes.length < 2) throw new Error("Seleccioná al menos dos sólidos.");
  const evaluator = new Evaluator();
  const op = operation === "union" ? ADDITION : operation === "subtract" ? SUBTRACTION : INTERSECTION;
  let result = meshToBrush(meshes[0]);
  for (let i = 1; i < meshes.length; i += 1) {
    const next = meshToBrush(meshes[i]);
    result = evaluator.evaluate(result, next, op);
  }
  result.geometry.computeVertexNormals();
  const meta = baseMeta("csg", operation === "union" ? "Unión" : operation === "subtract" ? "Resta" : "Intersección");
  const output = new THREE.Mesh(result.geometry.clone(), materialFor(meta.material));
  setMeta(output, meta);
  return output;
}
