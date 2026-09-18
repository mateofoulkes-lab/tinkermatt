import * as THREE from "three";
import { materialFor, normalizeToWorkplane, randomMaterialPreset } from "./geometry";
import { makeId, setMeta, type MaterialPreset, type ShapeKind, type TinkerMeta } from "./model";

export type AdvancedPrimitiveKind =
  | "cone"
  | "pyramid"
  | "roof"
  | "wedge"
  | "halfCylinder"
  | "dome"
  | "torus"
  | "washer"
  | "prism"
  | "polyhedron";

export type SketchPoint = {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
};

export type SketchData = {
  points: SketchPoint[];
  closed: boolean;
  referenceDataUrl?: string;
  referenceOpacity?: number;
  referenceName?: string;
};

export type SketchOperation =
  | { mode: "extrude"; depth: number }
  | { mode: "revolve"; angle: number; segments: number };

function meta(kind: ShapeKind, name: string, material = randomMaterialPreset(), params: Record<string, number | string | boolean> = {}): TinkerMeta {
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

function meshFromGeometry(geometry: THREE.BufferGeometry, kind: ShapeKind, name: string) {
  geometry.computeVertexNormals();
  const m = meta(kind, name);
  const mesh = new THREE.Mesh(geometry, materialFor(m.material));
  setMeta(mesh, m);
  normalizeToWorkplane(mesh);
  return mesh;
}

function centerSketchGeometry(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    -box.min.z,
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function extrudedProfile(points: Array<[number, number]>, depth: number) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 12,
  });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function createAdvancedPrimitive(kind: AdvancedPrimitiveKind) {
  if (kind === "cone") {
    const geometry = new THREE.CylinderGeometry(10, 0, 20, 64);
    geometry.rotateX(Math.PI / 2);
    return meshFromGeometry(geometry, kind, "Cono");
  }

  if (kind === "pyramid") {
    const geometry = new THREE.CylinderGeometry(12, 0, 20, 4);
    geometry.rotateX(Math.PI / 2);
    geometry.rotateZ(Math.PI / 4);
    return meshFromGeometry(geometry, kind, "Pirámide");
  }

  if (kind === "roof") {
    const geometry = extrudedProfile([[-12, 0], [12, 0], [0, 14]], 24);
    return meshFromGeometry(geometry, kind, "Techo");
  }

  if (kind === "wedge") {
    const geometry = extrudedProfile([[-12, 0], [12, 0], [12, 18]], 24);
    return meshFromGeometry(geometry, kind, "Cuña");
  }

  if (kind === "halfCylinder") {
    const shape = new THREE.Shape();
    const radius = 10;
    shape.moveTo(-radius, 0);
    for (let i = 0; i <= 32; i += 1) {
      const a = Math.PI - (Math.PI * i) / 32;
      shape.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
    }
    shape.lineTo(radius, 0);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 24, bevelEnabled: false, curveSegments: 16 });
    geometry.rotateX(Math.PI / 2);
    return meshFromGeometry(geometry, kind, "Bóveda");
  }

  if (kind === "dome") {
    const geometry = new THREE.SphereGeometry(10, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    geometry.rotateX(Math.PI / 2);
    return meshFromGeometry(geometry, kind, "Cúpula");
  }

  if (kind === "torus") {
    const geometry = new THREE.TorusGeometry(9, 3, 24, 72);
    return meshFromGeometry(geometry, kind, "Toro");
  }

  if (kind === "washer") {
    const geometry = new THREE.TorusGeometry(7.5, 4.2, 28, 72);
    return meshFromGeometry(geometry, kind, "Anillo");
  }

  if (kind === "prism") {
    const geometry = new THREE.CylinderGeometry(10, 10, 20, 6);
    geometry.rotateX(Math.PI / 2);
    return meshFromGeometry(geometry, kind, "Prisma hexagonal");
  }

  const geometry = new THREE.IcosahedronGeometry(11, 0);
  return meshFromGeometry(geometry, "polyhedron", "Poliedro");
}

function buildShape(data: SketchData) {
  if (!data.closed || data.points.length < 3) throw new Error("El sketch necesita un contorno cerrado de al menos 3 puntos.");
  const shape = new THREE.Shape();
  const first = data.points[0];
  shape.moveTo(first.x, -first.y);
  for (let i = 0; i < data.points.length; i += 1) {
    const current = data.points[i];
    const next = data.points[(i + 1) % data.points.length];
    shape.bezierCurveTo(current.outX, -current.outY, next.inX, -next.inY, next.x, -next.y);
  }
  return shape;
}

function sampleSketch(data: SketchData, perSegment = 12) {
  if (!data.closed || data.points.length < 2) return [] as THREE.Vector2[];
  const sampled: THREE.Vector2[] = [];
  for (let i = 0; i < data.points.length; i += 1) {
    const current = data.points[i];
    const next = data.points[(i + 1) % data.points.length];
    const curve = new THREE.CubicBezierCurve(
      new THREE.Vector2(current.x, -current.y),
      new THREE.Vector2(current.outX, -current.outY),
      new THREE.Vector2(next.inX, -next.inY),
      new THREE.Vector2(next.x, -next.y),
    );
    const segment = curve.getPoints(perSegment);
    if (i > 0) segment.shift();
    sampled.push(...segment);
  }
  return sampled;
}

function sketchParams(data: SketchData, operation: SketchOperation) {
  return {
    featureType: operation.mode,
    sketchJson: JSON.stringify(data),
    ...(operation.mode === "extrude" ? { depth: operation.depth } : { angle: operation.angle, segments: operation.segments }),
  };
}

function sketchGeometry(data: SketchData, operation: SketchOperation) {
  let geometry: THREE.BufferGeometry;
  if (operation.mode === "extrude") {
    const shape = buildShape(data);
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.01, operation.depth),
      bevelEnabled: false,
      curveSegments: 16,
    });
  } else {
    const sampled = sampleSketch(data, 14).map((point) => new THREE.Vector2(Math.max(0.001, Math.abs(point.x)), point.y));
    if (sampled.length < 3) throw new Error("El perfil no tiene suficientes puntos para Revolve.");
    geometry = new THREE.LatheGeometry(
      sampled,
      Math.max(8, Math.min(128, Math.round(operation.segments))),
      0,
      THREE.MathUtils.degToRad(Math.max(1, Math.min(360, operation.angle))),
    );
    geometry.rotateX(Math.PI / 2);
  }
  geometry.computeVertexNormals();
  return centerSketchGeometry(geometry);
}

export function createSketchObject(data: SketchData, operation: SketchOperation, material?: MaterialPreset) {
  const chosenMaterial = material ?? randomMaterialPreset();
  const kind: ShapeKind = operation.mode === "extrude" ? "sketchExtrude" : "revolve";
  const name = operation.mode === "extrude" ? "Extrusión de sketch" : "Revolve";
  const geometry = sketchGeometry(data, operation);
  const m = meta(kind, name, chosenMaterial, sketchParams(data, operation));
  const mesh = new THREE.Mesh(geometry, materialFor(m.material));
  setMeta(mesh, m);
  return mesh;
}

export function replaceSketchGeometry(object: THREE.Mesh, data: SketchData, operation: SketchOperation) {
  const currentMeta = object.userData.tinker as TinkerMeta | undefined;
  const geometry = sketchGeometry(data, operation);
  object.geometry.dispose();
  object.geometry = geometry;
  if (currentMeta) {
    currentMeta.kind = operation.mode === "extrude" ? "sketchExtrude" : "revolve";
    currentMeta.name = operation.mode === "extrude" ? "Extrusión de sketch" : "Revolve";
    currentMeta.params = sketchParams(data, operation);
    setMeta(object, currentMeta);
  }
}
