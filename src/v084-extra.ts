import * as THREE from "three";
import { booleanMeshes } from "./geometry";
import { getMeta, setMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.4 extra no pudo acceder al editor.");
const rawEditor = editor as any;

function allObjects() {
  const result: THREE.Object3D[] = [];
  for (const root of editor.getSceneRoots()) root.traverse((node) => { if (getMeta(node)) result.push(node); });
  return result;
}

function findObject(ref: string) {
  return editor.findById(ref) ?? allObjects().find((object) => getMeta(object)?.name === ref) ?? null;
}

function objectInfo(object: THREE.Object3D | null) {
  if (!object) return null;
  const meta = getMeta(object);
  if (!meta) return null;
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    mode: meta.mode,
    size: { x: size.x, y: size.y, z: size.z },
    center: { x: center.x, y: center.y, z: center.z },
  };
}

function emitChanged() {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
}

function splitObjects(args: any) {
  const base = findObject(String(args.base ?? args.object ?? ""));
  const cutter = findObject(String(args.cutter ?? ""));
  if (!(base instanceof THREE.Mesh) || !(cutter instanceof THREE.Mesh)) {
    throw new Error("split_objects requiere base y cutter como Mesh simples.");
  }
  if ((base.userData.tmLocked || cutter.userData.tmLocked) && args.allowLocked !== true) {
    throw new Error("Base o cortante está bloqueado. Desbloquealo o usá allowLocked=true deliberadamente.");
  }
  editor.checkpoint();
  const outside = booleanMeshes([base, cutter], "subtract");
  const inside = booleanMeshes([base, cutter], "intersect");
  const baseName = getMeta(base)?.name ?? "Pieza";
  const outsideMeta = getMeta(outside)!;
  outsideMeta.name = String(args.outsideName ?? `${baseName}_exterior`);
  setMeta(outside, outsideMeta);
  const insideMeta = getMeta(inside)!;
  insideMeta.name = String(args.insideName ?? `${baseName}_interior`);
  setMeta(inside, insideMeta);

  base.removeFromParent();
  if (args.keepCutter !== true) cutter.removeFromParent();
  editor.addObject(outside, false, false);
  editor.addObject(inside, false, false);
  editor.setSelection([outside, inside]);
  emitChanged();
  return { outside: objectInfo(outside), inside: objectInfo(inside), cutterKept: args.keepCutter === true };
}

function qpoint(position: THREE.BufferAttribute, index: number, eps = 1e-4) {
  return `${Math.round(position.getX(index) / eps)},${Math.round(position.getY(index) / eps)},${Math.round(position.getZ(index) / eps)}`;
}

function meshAnalysis(mesh: THREE.Mesh, overhangDeg: number) {
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return { triangles: 0, boundaryEdges: 0, nonManifoldEdges: 0, disconnectedShells: 0, steepDownwardTriangles: 0 };
  const index = geometry.index;
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  const vi = (flat: number) => index ? index.getX(flat) : flat;
  const edgeMap = new Map<string, number[]>();
  const neighbors: number[][] = Array.from({ length: triangleCount }, () => []);
  let steepDownwardTriangles = 0;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const thresholdZ = -Math.sin(THREE.MathUtils.degToRad(Math.max(0, Math.min(89.9, overhangDeg))));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  for (let t = 0; t < triangleCount; t += 1) {
    const ids = [vi(t * 3), vi(t * 3 + 1), vi(t * 3 + 2)];
    a.fromBufferAttribute(pos, ids[0]); b.fromBufferAttribute(pos, ids[1]); c.fromBufferAttribute(pos, ids[2]);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize().applyMatrix3(normalMatrix).normalize();
    if (normal.z < thresholdZ) steepDownwardTriangles += 1;
    for (const [ia, ib] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const pa = qpoint(pos, ia), pb = qpoint(pos, ib);
      const key = pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
      const list = edgeMap.get(key) ?? [];
      list.push(t);
      edgeMap.set(key, list);
    }
  }

  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const tris of edgeMap.values()) {
    if (tris.length === 1) boundaryEdges += 1;
    else if (tris.length > 2) nonManifoldEdges += 1;
    for (let i = 0; i < tris.length; i += 1) for (let j = i + 1; j < tris.length; j += 1) {
      neighbors[tris[i]].push(tris[j]); neighbors[tris[j]].push(tris[i]);
    }
  }

  const seen = new Uint8Array(triangleCount);
  let disconnectedShells = 0;
  for (let start = 0; start < triangleCount; start += 1) {
    if (seen[start]) continue;
    disconnectedShells += 1;
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const current = stack.pop()!;
      for (const next of neighbors[current]) if (!seen[next]) { seen[next] = 1; stack.push(next); }
    }
  }
  return { triangles: triangleCount, boundaryEdges, nonManifoldEdges, disconnectedShells, steepDownwardTriangles };
}

function checkPrintabilityV2(args: any = {}) {
  const refs: string[] | undefined = args.objects;
  const objects = refs?.length ? refs.map((ref) => findObject(String(ref))) : editor.getSceneRoots();
  if (objects.some((object) => !object)) throw new Error("check_printability: no se encontraron todos los objetos indicados.");
  const valid = objects.filter(Boolean) as THREE.Object3D[];
  const bed = new THREE.Vector3(Number(args.bedX ?? 220), Number(args.bedY ?? 220), Number(args.bedZ ?? 250));
  const nozzle = Math.max(0.1, Number(args.nozzle ?? 0.4));
  const minFeature = Math.max(0.1, Number(args.minFeature ?? nozzle * 2));
  const overhang = Math.max(0, Math.min(89.9, Number(args.overhangDegrees ?? 45)));
  const warnings: any[] = [];

  const results = valid.map((object) => {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const fits = size.x <= bed.x && size.y <= bed.y && size.z <= bed.z;
    if (!fits) warnings.push({ object: getMeta(object)?.name, type: "bed", message: "Excede la cama configurada", overBy: { x: Math.max(0,size.x-bed.x), y: Math.max(0,size.y-bed.y), z: Math.max(0,size.z-bed.z) } });
    if (Math.min(size.x,size.y,size.z) < minFeature) warnings.push({ object: getMeta(object)?.name, type: "thin_overall", message: `Alguna dimensión global es menor a ${minFeature.toFixed(2)} mm` });

    let triangles = 0, boundaryEdges = 0, nonManifoldEdges = 0, shells = 0, steep = 0;
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.updateMatrixWorld(true);
      const stats = meshAnalysis(node, overhang);
      triangles += stats.triangles;
      boundaryEdges += stats.boundaryEdges;
      nonManifoldEdges += stats.nonManifoldEdges;
      shells += stats.disconnectedShells;
      steep += stats.steepDownwardTriangles;
    });
    if (boundaryEdges) warnings.push({ object: getMeta(object)?.name, type: "open_mesh", message: `${boundaryEdges} borde(s) abiertos` });
    if (nonManifoldEdges) warnings.push({ object: getMeta(object)?.name, type: "non_manifold", message: `${nonManifoldEdges} borde(s) no-manifold` });
    if (shells > 1) warnings.push({ object: getMeta(object)?.name, type: "disconnected_shells", message: `${shells} islas/shells desconectadas en la geometría` });
    if (steep) warnings.push({ object: getMeta(object)?.name, type: "overhang", message: `${steep} triángulo(s) inferiores superan el umbral heurístico de ${overhang}°` });
    return { ...objectInfo(object), fitsBed: fits, topology: { triangles, boundaryEdges, nonManifoldEdges, disconnectedShells: shells }, overhang: { thresholdDegrees: overhang, steepDownwardTriangles: steep } };
  });

  return {
    bed: { x: bed.x, y: bed.y, z: bed.z }, nozzle, minFeature, overhangDegrees: overhang,
    printableHeuristic: warnings.length === 0,
    warnings,
    objects: results,
    note: "Chequeo geométrico heurístico. Espesor local real, orientación óptima, puentes y soportes finales deben validarse en un slicer.",
  };
}

window.tinkerMatt.splitObjects = splitObjects;
window.tinkerMatt.checkPrintability = checkPrintabilityV2;
