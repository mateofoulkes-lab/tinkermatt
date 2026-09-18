import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { makeId, setMeta, type MaterialPreset, type ShapeKind, type SolidMode, type TinkerMeta } from "./model";

export function materialFor(preset: MaterialPreset, mode: SolidMode = "solid") {
  if (mode === "hole") {
    return new THREE.MeshStandardMaterial({
      color: 0x75808a,
      roughness: 0.85,
      metalness: 0,
      transparent: true,
      opacity: 0.32,
      wireframe: true,
      depthWrite: false,
    });
  }
  const options: Record<MaterialPreset, THREE.MeshStandardMaterialParameters> = {
    blue: { color: 0x39a9db, roughness: 0.45, metalness: 0.08 },
    gray: { color: 0x9aa3aa, roughness: 0.62, metalness: 0.12 },
    gold: { color: 0xd3a62a, roughness: 0.18, metalness: 1 },
    red: { color: 0xe5534b, roughness: 0.42, metalness: 0.08 },
  };
  return new THREE.MeshStandardMaterial(options[preset]);
}

function baseMeta(kind: ShapeKind, name: string, params: Record<string, number | string | boolean> = {}): TinkerMeta {
  return {
    id: makeId(kind),
    name,
    kind,
    mode: "solid",
    material: "blue",
    references: [],
    params,
  };
}

export function createBox(width = 20, depth = 20, height = 20) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, depth, height), materialFor("blue"));
  setMeta(mesh, baseMeta("box", "Caja", { width, depth, height }));
  mesh.position.z = height / 2;
  return mesh;
}

export function createCylinder(radius = 10, height = 20, sides = 64) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, sides);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, materialFor("blue"));
  setMeta(mesh, baseMeta("cylinder", "Cilindro", { radius, height, sides }));
  mesh.position.z = height / 2;
  return mesh;
}

export function createSphere(radius = 10, segments = 48) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(24, segments / 2)), materialFor("blue"));
  setMeta(mesh, baseMeta("sphere", "Esfera", { radius, segments }));
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
  const mesh = new THREE.Mesh(geometry, materialFor("blue"));
  setMeta(mesh, baseMeta("text", `Texto: ${text}`, { text, depth, height }));
  return mesh;
}

export function createFromSvg(svgText: string, depth = 2) {
  const data = new SVGLoader().parse(svgText);
  const group = new THREE.Group();
  setMeta(group, baseMeta("svg", "SVG", { depth }));

  for (const path of data.paths) {
    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
      geometry.scale(0.264583, -0.264583, 1);
      group.add(new THREE.Mesh(geometry, materialFor("blue")));
    }
  }

  normalizeToWorkplane(group);
  return group;
}

export function createFromStl(buffer: ArrayBuffer) {
  const geometry = new STLLoader().parse(buffer);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, materialFor("gray"));
  setMeta(mesh, { ...baseMeta("stl", "STL importado"), material: "gray" });
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
  const output = new THREE.Mesh(result.geometry.clone(), materialFor("blue"));
  setMeta(output, baseMeta("csg", operation === "union" ? "Unión" : operation === "subtract" ? "Resta" : "Intersección"));
  return output;
}
