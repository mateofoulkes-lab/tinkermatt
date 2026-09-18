import * as THREE from "three";

export type ShapeKind =
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
  | "polyhedron"
  | "sketch"
  | "sketchExtrude"
  | "revolve"
  | "text"
  | "svg"
  | "stl"
  | "group"
  | "csg"
  | "thread";
export type SolidMode = "solid" | "hole";
export type ReferenceKind = "face" | "edge" | "vertex" | "object" | "zone" | "axis" | "plane";

export type SemanticFaceSelection = {
  meshPath: number[];
  triangles: number[];
};

export type SemanticEdgeSelection = {
  meshPath: number[];
  a: [number, number, number];
  b: [number, number, number];
};

export type SemanticVertexSelection = {
  meshPath: number[];
  point: [number, number, number];
};

export type SemanticGeometrySelection = {
  faces?: SemanticFaceSelection[];
  edges?: SemanticEdgeSelection[];
  vertices?: SemanticVertexSelection[];
  objectIds?: string[];
};

export interface SemanticReference {
  id: string;
  kind: ReferenceKind;
  name: string;
  note?: string;
  selection?: SemanticGeometrySelection;
  zone?: {
    points: [number, number, number][];
  };
}

export type MaterialPreset =
  | "lightRed"
  | "peach"
  | "cream"
  | "mint"
  | "paleCyan"
  | "sky"
  | "periwinkle"
  | "lavender"
  | "palePink"
  | "sand"
  | "white"
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "aqua"
  | "cyan"
  | "royal"
  | "purple"
  | "fuchsia"
  | "brown"
  | "lightGray"
  | "darkGray"
  | "darkRed"
  | "vermilion"
  | "ochre"
  | "forest"
  | "darkTeal"
  | "deepCyan"
  | "navy"
  | "deepPurple"
  | "wine"
  | "darkBrown"
  | "silverGray"
  | "black"
  | "gold"
  | "silver";

export interface TinkerMeta {
  id: string;
  name: string;
  kind: ShapeKind;
  mode: SolidMode;
  material: MaterialPreset;
  references: SemanticReference[];
  params?: Record<string, number | string | boolean>;
}

export type TransformSnapshot = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

export type RecordedAction =
  | { type: "duplicate" }
  | { type: "translate"; delta: [number, number, number] }
  | { type: "rotate"; delta: [number, number, number] }
  | { type: "scale"; ratio: [number, number, number] }
  | { type: "toggleHole" };

export function makeId(prefix = "obj") {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function getMeta(object: THREE.Object3D): TinkerMeta | undefined {
  return object.userData.tinker as TinkerMeta | undefined;
}

export function setMeta(object: THREE.Object3D, meta: TinkerMeta) {
  object.userData.tinker = meta;
  object.name = meta.name;
}

export function snapshotTransform(object: THREE.Object3D): TransformSnapshot {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

function cloneMaterialsAndGeometry(object: THREE.Object3D) {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry = node.geometry.clone();
      if (Array.isArray(node.material)) node.material = node.material.map((material) => material.clone());
      else node.material = node.material.clone();
    }
  });
}

export function clonePreservingIds<T extends THREE.Object3D>(source: T): T {
  const copy = source.clone(true) as T;
  cloneMaterialsAndGeometry(copy);
  return copy;
}

export function cloneWithFreshIds<T extends THREE.Object3D>(source: T): T {
  const copy = source.clone(true) as T;
  copy.traverse((node) => {
    const meta = getMeta(node);
    if (meta) {
      setMeta(node, {
        ...structuredClone(meta),
        id: makeId(meta.kind),
        name: `${meta.name} copia`,
        references: meta.references.map((ref) => ({ ...structuredClone(ref), id: makeId("ref") })),
      });
    }
  });
  cloneMaterialsAndGeometry(copy);
  return copy;
}
