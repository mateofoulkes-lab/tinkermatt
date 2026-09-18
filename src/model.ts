import * as THREE from "three";

export type ShapeKind = "box" | "cylinder" | "sphere" | "text" | "svg" | "stl" | "group" | "csg";
export type SolidMode = "solid" | "hole";
export type ReferenceKind = "face" | "edge" | "vertex" | "zone" | "axis" | "plane";

export interface SemanticReference {
  id: string;
  kind: ReferenceKind;
  name: string;
  note?: string;
}

export interface TinkerMeta {
  id: string;
  name: string;
  kind: ShapeKind;
  mode: SolidMode;
  material: MaterialPreset;
  references: SemanticReference[];
  params?: Record<string, number | string | boolean>;
}

export type MaterialPreset = "blue" | "gray" | "gold" | "red";

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

export function cloneWithFreshIds<T extends THREE.Object3D>(source: T): T {
  const copy = source.clone(true) as T;
  copy.traverse((node) => {
    const meta = getMeta(node);
    if (meta) {
      setMeta(node, {
        ...structuredClone(meta),
        id: makeId(meta.kind),
        name: `${meta.name} copia`,
        references: meta.references.map((ref) => ({ ...ref, id: makeId("ref") })),
      });
    }
    if (node instanceof THREE.Mesh) {
      node.geometry = node.geometry.clone();
      if (Array.isArray(node.material)) node.material = node.material.map((m) => m.clone());
      else node.material = node.material.clone();
    }
  });
  return copy;
}
