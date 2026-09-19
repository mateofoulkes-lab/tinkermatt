import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import type { ShapeKind } from "./model";

export type ParametricPrimitiveKind =
  | "box"
  | "cylinder"
  | "sphere"
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

export type PrimitiveValues = Record<string, number>;

const DEFAULTS: Record<ParametricPrimitiveKind, PrimitiveValues> = {
  box: { length: 20, width: 20, height: 20, radius: 0, steps: 1 },
  cylinder: { diameter: 20, height: 20, sides: 64, bevel: 0, bevelSegments: 1 },
  sphere: { diameter: 20, segments: 48, rings: 24 },
  cone: { bottomDiameter: 20, topDiameter: 0, height: 20, sides: 64 },
  pyramid: { bottomX: 24, bottomY: 24, topX: 0, topY: 0, height: 20 },
  roof: { width: 24, depth: 24, height: 14 },
  wedge: { width: 24, depth: 24, height: 18 },
  halfCylinder: { diameter: 20, depth: 24, segments: 32 },
  dome: { diameter: 20, height: 10, segments: 48, rings: 24 },
  torus: { outerDiameter: 24, tubeDiameter: 6, radialSegments: 24, tubularSegments: 72 },
  washer: { outerDiameter: 24, innerDiameter: 10, height: 4, sides: 64 },
  prism: { diameter: 20, height: 20, sides: 6 },
  polyhedron: { diameter: 22, detail: 0 },
};

export const PARAMETRIC_KINDS = new Set<ShapeKind>(Object.keys(DEFAULTS) as ParametricPrimitiveKind[]);

export function primitiveDefaults(kind: ParametricPrimitiveKind) {
  return { ...DEFAULTS[kind] };
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}

function flatGeometry(geometry: THREE.BufferGeometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.computeVertexNormals();
  flat.computeBoundingBox();
  flat.computeBoundingSphere();
  return flat;
}

function centerGeometry(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) {
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function geometryFromIndexed(positions: number[], indices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return flatGeometry(geometry);
}

function chamferedBox(length: number, width: number, height: number, radius: number) {
  const hx = length / 2;
  const hy = width / 2;
  const hz = height / 2;
  const r = Math.min(radius, hx - 1e-5, hy - 1e-5, hz - 1e-5);
  if (r <= 1e-5) return new THREE.BoxGeometry(length, width, height);

  // Bevel ALL twelve edges, not only the eight corners. At each original corner
  // the new triangular corner is bounded by three points, each one offset along
  // two axes. The previous implementation offset only one axis per point, which
  // merely truncated vertices and left the original edges untouched.
  const points: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    points.push(new THREE.Vector3(sx * (hx - r), sy * (hy - r), sz * hz));
    points.push(new THREE.Vector3(sx * (hx - r), sy * hy, sz * (hz - r)));
    points.push(new THREE.Vector3(sx * hx, sy * (hy - r), sz * (hz - r)));
  }
  return flatGeometry(new ConvexGeometry(points));
}

function boxGeometry(values: PrimitiveValues) {
  const length = clamp(values.length, 0.01, 10000, 20);
  const width = clamp(values.width, 0.01, 10000, 20);
  const height = clamp(values.height, 0.01, 10000, 20);
  const maxRadius = Math.max(0, Math.min(length, width, height) / 2 - 1e-5);
  const radius = clamp(values.radius, 0, maxRadius, 0);
  const steps = Math.round(clamp(values.steps, 1, 20, 1));
  if (radius <= 1e-5) return new THREE.BoxGeometry(length, width, height);
  if (steps === 1) return chamferedBox(length, width, height, radius);

  // Tinkercad-style Steps are actual visible bevel bands. RoundedBoxGeometry
  // uses smooth interpolated normals by default, which made Steps=2 look like a
  // polished blob instead of two geometric steps. Flat normals preserve every
  // band while coplanar triangles remain visually continuous.
  return flatGeometry(new RoundedBoxGeometry(length, width, height, steps, radius));
}

function cylinderGeometry(values: PrimitiveValues) {
  const radius = clamp(values.diameter, 0.02, 10000, 20) / 2;
  const height = clamp(values.height, 0.01, 10000, 20);
  const sides = Math.round(clamp(values.sides, 3, 256, 64));
  const bevelSegments = Math.round(clamp(values.bevelSegments, 1, 32, 1));
  const bevel = clamp(values.bevel, 0, Math.min(radius, height / 2) - 1e-5, 0);
  const points: THREE.Vector2[] = [];

  if (bevel <= 1e-5) {
    points.push(new THREE.Vector2(0, -height / 2), new THREE.Vector2(radius, -height / 2));
    points.push(new THREE.Vector2(radius, height / 2), new THREE.Vector2(0, height / 2));
  } else {
    points.push(new THREE.Vector2(0, -height / 2));
    const bottomCenter = new THREE.Vector2(radius - bevel, -height / 2 + bevel);
    for (let i = 0; i <= bevelSegments; i += 1) {
      const a = -Math.PI / 2 + (i / bevelSegments) * Math.PI / 2;
      points.push(new THREE.Vector2(bottomCenter.x + Math.cos(a) * bevel, bottomCenter.y + Math.sin(a) * bevel));
    }
    const topCenter = new THREE.Vector2(radius - bevel, height / 2 - bevel);
    for (let i = 0; i <= bevelSegments; i += 1) {
      const a = (i / bevelSegments) * Math.PI / 2;
      points.push(new THREE.Vector2(topCenter.x + Math.cos(a) * bevel, topCenter.y + Math.sin(a) * bevel));
    }
    points.push(new THREE.Vector2(0, height / 2));
  }

  let geometry: THREE.BufferGeometry = new THREE.LatheGeometry(points, sides, 0, Math.PI * 2);
  geometry.rotateX(Math.PI / 2);
  if (bevel > 1e-5) geometry = flatGeometry(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function sphereGeometry(values: PrimitiveValues) {
  const radius = clamp(values.diameter, 0.02, 10000, 20) / 2;
  const segments = Math.round(clamp(values.segments, 8, 256, 48));
  const rings = Math.round(clamp(values.rings, 4, 128, 24));
  return new THREE.SphereGeometry(radius, segments, rings);
}

function coneGeometry(values: PrimitiveValues) {
  const bottomRadius = clamp(values.bottomDiameter, 0, 10000, 20) / 2;
  const topRadius = clamp(values.topDiameter, 0, 10000, 0) / 2;
  const height = clamp(values.height, 0.01, 10000, 20);
  const sides = Math.round(clamp(values.sides, 3, 256, 64));
  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, height, sides, 1, false);
  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function pyramidGeometry(values: PrimitiveValues) {
  const bx = clamp(values.bottomX, 0.01, 10000, 24) / 2;
  const by = clamp(values.bottomY, 0.01, 10000, 24) / 2;
  const tx = clamp(values.topX, 0, 10000, 0) / 2;
  const ty = clamp(values.topY, 0, 10000, 0) / 2;
  const h = clamp(values.height, 0.01, 10000, 20) / 2;
  const positions = [
    -bx, -by, -h,  bx, -by, -h,  bx, by, -h,  -bx, by, -h,
  ];
  const indices = [0, 2, 1, 0, 3, 2];
  if (tx <= 1e-5 || ty <= 1e-5) {
    positions.push(0, 0, h);
    indices.push(0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4);
  } else {
    positions.push(-tx, -ty, h, tx, -ty, h, tx, ty, h, -tx, ty, h);
    indices.push(
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
      3, 0, 4, 3, 4, 7,
    );
  }
  return geometryFromIndexed(positions, indices);
}

function roofGeometry(values: PrimitiveValues) {
  const w = clamp(values.width, 0.01, 10000, 24) / 2;
  const d = clamp(values.depth, 0.01, 10000, 24) / 2;
  const h = clamp(values.height, 0.01, 10000, 14) / 2;
  const p = [
    -w, -d, -h, w, -d, -h, 0, -d, h,
    -w, d, -h, w, d, -h, 0, d, h,
  ];
  const i = [
    0, 2, 1, 3, 4, 5,
    0, 1, 4, 0, 4, 3,
    0, 3, 5, 0, 5, 2,
    1, 2, 5, 1, 5, 4,
  ];
  return geometryFromIndexed(p, i);
}

function wedgeGeometry(values: PrimitiveValues) {
  const w = clamp(values.width, 0.01, 10000, 24) / 2;
  const d = clamp(values.depth, 0.01, 10000, 24) / 2;
  const h = clamp(values.height, 0.01, 10000, 18) / 2;
  const p = [
    -w, -d, -h, w, -d, -h, w, -d, h,
    -w, d, -h, w, d, -h, w, d, h,
  ];
  const i = [
    0, 2, 1, 3, 4, 5,
    0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4,
    2, 0, 3, 2, 3, 5,
  ];
  return geometryFromIndexed(p, i);
}

function halfCylinderGeometry(values: PrimitiveValues) {
  const radius = clamp(values.diameter, 0.02, 10000, 20) / 2;
  const depth = clamp(values.depth, 0.01, 10000, 24);
  const segments = Math.round(clamp(values.segments, 3, 256, 32));
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  for (let i = 0; i <= segments; i += 1) {
    const a = Math.PI - (Math.PI * i) / segments;
    shape.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  shape.lineTo(radius, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
  geometry.rotateX(Math.PI / 2);
  return centerGeometry(geometry);
}

function domeGeometry(values: PrimitiveValues) {
  const radius = clamp(values.diameter, 0.02, 10000, 20) / 2;
  const height = clamp(values.height, 0.01, 10000, radius);
  const segments = Math.round(clamp(values.segments, 8, 256, 48));
  const rings = Math.round(clamp(values.rings, 2, 128, 24));
  const geometry = new THREE.SphereGeometry(radius, segments, rings, 0, Math.PI * 2, 0, Math.PI / 2);
  geometry.rotateX(Math.PI / 2);
  geometry.scale(1, 1, height / radius);
  return centerGeometry(geometry);
}

function torusGeometry(values: PrimitiveValues) {
  const outerRadius = clamp(values.outerDiameter, 0.02, 10000, 24) / 2;
  const tubeRadius = clamp(values.tubeDiameter, 0.01, outerRadius * 2, 6) / 2;
  const majorRadius = Math.max(0.001, outerRadius - tubeRadius);
  const radialSegments = Math.round(clamp(values.radialSegments, 3, 128, 24));
  const tubularSegments = Math.round(clamp(values.tubularSegments, 8, 512, 72));
  return new THREE.TorusGeometry(majorRadius, tubeRadius, radialSegments, tubularSegments);
}

function washerGeometry(values: PrimitiveValues) {
  // "Anillo" is intentionally NOT a torus: it is a short hollow cylinder / tube.
  const outerRadius = clamp(values.outerDiameter, 0.02, 10000, 24) / 2;
  const innerRadius = clamp(values.innerDiameter, 0, outerRadius * 2 - 0.02, 10) / 2;
  const height = clamp(values.height, 0.01, 10000, 4);
  const sides = Math.round(clamp(values.sides, 3, 256, 64));
  const shape = new THREE.Shape();
  for (let i = 0; i <= sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * outerRadius;
    const y = Math.sin(a) * outerRadius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  if (innerRadius > 1e-5) {
    const hole = new THREE.Path();
    for (let i = sides; i >= 0; i -= 1) {
      const a = (i / sides) * Math.PI * 2;
      const x = Math.cos(a) * innerRadius;
      const y = Math.sin(a) * innerRadius;
      if (i === sides) hole.moveTo(x, y); else hole.lineTo(x, y);
    }
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  return centerGeometry(geometry);
}

function prismGeometry(values: PrimitiveValues) {
  const radius = clamp(values.diameter, 0.02, 10000, 20) / 2;
  const height = clamp(values.height, 0.01, 10000, 20);
  const sides = Math.round(clamp(values.sides, 3, 64, 6));
  const geometry = new THREE.CylinderGeometry(radius, radius, height, sides, 1, false);
  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return flatGeometry(geometry);
}

function polyhedronGeometry(values: PrimitiveValues) {
  const radius = clamp(values.diameter, 0.02, 10000, 22) / 2;
  const detail = Math.round(clamp(values.detail, 0, 4, 0));
  return new THREE.IcosahedronGeometry(radius, detail);
}

export function buildPrimitiveGeometry(kind: ParametricPrimitiveKind, values: PrimitiveValues): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  switch (kind) {
    case "box": geometry = boxGeometry(values); break;
    case "cylinder": geometry = cylinderGeometry(values); break;
    case "sphere": geometry = sphereGeometry(values); break;
    case "cone": geometry = coneGeometry(values); break;
    case "pyramid": geometry = pyramidGeometry(values); break;
    case "roof": geometry = roofGeometry(values); break;
    case "wedge": geometry = wedgeGeometry(values); break;
    case "halfCylinder": geometry = halfCylinderGeometry(values); break;
    case "dome": geometry = domeGeometry(values); break;
    case "torus": geometry = torusGeometry(values); break;
    case "washer": geometry = washerGeometry(values); break;
    case "prism": geometry = prismGeometry(values); break;
    case "polyhedron": geometry = polyhedronGeometry(values); break;
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
