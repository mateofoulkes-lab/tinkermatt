import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import helvetikerRegular from "three/examples/fonts/helvetiker_regular.typeface.json";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { getMeta, makeId, setMeta, type MaterialPreset, type ShapeKind, type SolidMode, type TinkerMeta } from "./model";

export const MATERIAL_PALETTE: Array<{ id: MaterialPreset; color: number; label: string; metalness?: number; roughness?: number }> = [
  // Tinkercad-inspired 3 x 12 palette, sampled directly from the reference UI.
  { id: "lightRed", color: 0xe9968c, label: "Rojo claro" },
  { id: "peach", color: 0xfbc59a, label: "Durazno" },
  { id: "cream", color: 0xf8e6b7, label: "Crema" },
  { id: "mint", color: 0xc8e4bd, label: "Verde claro" },
  { id: "paleCyan", color: 0xb0e8ef, label: "Cian claro" },
  { id: "sky", color: 0x85cde6, label: "Celeste" },
  { id: "periwinkle", color: 0xaebeed, label: "Azul claro" },
  { id: "lavender", color: 0xd3bfe5, label: "Lavanda" },
  { id: "palePink", color: 0xefb1d4, label: "Rosa claro" },
  { id: "sand", color: 0xe2c095, label: "Arena" },
  { id: "white", color: 0xfafafa, label: "Blanco" },
  { id: "gray", color: 0xa7adb1, label: "Gris" },

  { id: "red", color: 0xe91d2d, label: "Rojo" },
  { id: "orange", color: 0xf5831f, label: "Naranja" },
  { id: "yellow", color: 0xffdd1a, label: "Amarillo" },
  { id: "green", color: 0x46b749, label: "Verde" },
  { id: "aqua", color: 0x75cedb, label: "Aqua" },
  { id: "cyan", color: 0x009fd7, label: "Cian" },
  { id: "royal", color: 0x3b55a3, label: "Azul" },
  { id: "purple", color: 0x7e3f98, label: "Púrpura" },
  { id: "fuchsia", color: 0xd70b8c, label: "Fucsia" },
  { id: "brown", color: 0xa97b50, label: "Marrón" },
  { id: "lightGray", color: 0xdde2e4, label: "Gris claro" },
  { id: "darkGray", color: 0x61676a, label: "Gris oscuro" },

  { id: "darkRed", color: 0x951a21, label: "Bordó" },
  { id: "vermilion", color: 0xe35b22, label: "Bermellón" },
  { id: "ochre", color: 0xe1ad34, label: "Ocre" },
  { id: "forest", color: 0x126936, label: "Verde bosque" },
  { id: "darkTeal", color: 0x1c505a, label: "Petróleo" },
  { id: "deepCyan", color: 0x0076a9, label: "Cian oscuro" },
  { id: "navy", color: 0x192e62, label: "Azul marino" },
  { id: "deepPurple", color: 0x492e72, label: "Violeta oscuro" },
  { id: "wine", color: 0x901c53, label: "Vino" },
  { id: "darkBrown", color: 0x603913, label: "Marrón oscuro" },
  { id: "silverGray", color: 0xbfc7cc, label: "Gris plata" },
  { id: "black", color: 0x2b2e31, label: "Negro" },
];

const SPECIAL_MATERIALS: Partial<Record<MaterialPreset, { color: number; metalness: number; roughness: number }>> = {
  gold: { color: 0xd4af37, metalness: 1, roughness: 0.18 },
  silver: { color: 0xcbd5e1, metalness: 1, roughness: 0.22 },
};

const RANDOM_PRESETS = MATERIAL_PALETTE.filter(({ id }) => !["white", "gray", "lightGray", "darkGray", "silverGray", "black"].includes(id));

export function randomMaterialPreset(): MaterialPreset {
  return RANDOM_PRESETS[Math.floor(Math.random() * RANDOM_PRESETS.length)]?.id ?? "cyan";
}

export function materialFor(preset: MaterialPreset, mode: SolidMode = "solid") {
  if (mode === "hole") {
    return new THREE.MeshStandardMaterial({
      color: 0x26343e,
      roughness: 0.7,
      metalness: 0.04,
      transparent: true,
      opacity: 0.36,
      wireframe: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  const special = SPECIAL_MATERIALS[preset];
  if (special) {
    return new THREE.MeshStandardMaterial({
      color: special.color,
      roughness: special.roughness,
      metalness: special.metalness,
    });
  }
  const swatch = MATERIAL_PALETTE.find((item) => item.id === preset) ?? MATERIAL_PALETTE[17];
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
  const font = loader.parse(helvetikerRegular as any);
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
  return new Brush(geometry, materialFor("cyan"));
}

export function booleanMeshes(meshes: THREE.Mesh[], operation: "union" | "subtract" | "intersect") {
  if (meshes.length < 2) throw new Error("Seleccioná al menos dos sólidos.");
  const evaluator = new Evaluator();

  let result: Brush;
  let resultName: string;
  let resultMaterial: MaterialPreset | undefined;

  if (operation === "union") {
    const solids = meshes.filter((mesh) => getMeta(mesh)?.mode !== "hole");
    const holes = meshes.filter((mesh) => getMeta(mesh)?.mode === "hole");
    if (!solids.length) throw new Error("Para unir con huecos necesitás al menos un sólido.");

    result = meshToBrush(solids[0]);
    resultMaterial = getMeta(solids[0])?.material;
    for (let i = 1; i < solids.length; i += 1) {
      result = evaluator.evaluate(result, meshToBrush(solids[i]), ADDITION);
    }
    for (const hole of holes) {
      result = evaluator.evaluate(result, meshToBrush(hole), SUBTRACTION);
    }
    resultName = holes.length ? "Unión con huecos" : "Unión";
  } else {
    const op = operation === "subtract" ? SUBTRACTION : INTERSECTION;
    result = meshToBrush(meshes[0]);
    resultMaterial = getMeta(meshes[0])?.material;
    for (let i = 1; i < meshes.length; i += 1) {
      result = evaluator.evaluate(result, meshToBrush(meshes[i]), op);
    }
    resultName = operation === "subtract" ? "Resta" : "Intersección";
  }

  result.geometry.computeVertexNormals();
  const meta = baseMeta("csg", resultName, {}, resultMaterial ?? randomMaterialPreset());
  const output = new THREE.Mesh(result.geometry.clone(), materialFor(meta.material));
  setMeta(output, meta);
  return output;
}
