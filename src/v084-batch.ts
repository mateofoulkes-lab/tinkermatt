import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

type BatchOperation = { action: string; args?: Record<string, any> };

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.8.4 batch no pudo acceder al editor.");
const rawEditor = editor as any;
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };

function normalize(action: string) {
  return String(action ?? "").trim().toLowerCase().replace(/-/g, "_");
}

let batchDepth = 0;
let lastRepeatableOperation: BatchOperation | null = null;
const notRepeatable = new Set([
  "batch", "undo", "redo", "repeat_last_action", "get_bounds", "measure",
  "check_printability", "select_object", "select_by_name_pattern", "macro",
  "export_object", "export_group", "export_objects",
]);

function rememberOperation(operation: BatchOperation) {
  const action = normalize(operation.action);
  if (!action || notRepeatable.has(action)) return;
  lastRepeatableOperation = { action, args: structuredClone(operation.args ?? {}) };
}

async function createBoxArray(args: any) {
  const countX = Math.max(1, Math.min(100, Math.floor(Number(args.countX ?? 1))));
  const countY = Math.max(1, Math.min(100, Math.floor(Number(args.countY ?? 1))));
  const countZ = Math.max(1, Math.min(100, Math.floor(Number(args.countZ ?? 1))));
  const total = countX * countY * countZ;
  if (total > 1000) throw new Error("create_box_array admite hasta 1000 cajas.");
  const result: any[] = [];
  for (let iz = 0; iz < countZ; iz += 1) {
    for (let iy = 0; iy < countY; iy += 1) {
      for (let ix = 0; ix < countX; ix += 1) {
        const index = iz * countX * countY + iy * countX + ix + 1;
        result.push(await window.tinkerMatt.createBox?.({
          name: args.name ? `${args.name}_${String(index).padStart(Number(args.pad ?? 2), "0")}` : undefined,
          mode: args.mode,
          size: { x: args.x, y: args.y, z: args.z },
          position: {
            x: Number(args.posX ?? 0) + ix * Number(args.spacingX ?? 0),
            y: Number(args.posY ?? 0) + iy * Number(args.spacingY ?? 0),
            z: Number(args.posZ ?? 0) + iz * Number(args.spacingZ ?? 0),
          },
        }));
      }
    }
  }
  return { count: result.length, objects: result };
}

async function repeatLastActionRemote(args: any = {}) {
  if (!lastRepeatableOperation) throw new Error("Todavía no hay una acción MCP repetible.");
  const count = Math.max(1, Math.min(100, Math.floor(Number(args.count ?? 1))));
  if (batchDepth > 0) {
    const results = [];
    for (let i = 0; i < count; i += 1) results.push(await dispatch(lastRepeatableOperation));
    return { repeated: count, action: lastRepeatableOperation.action, results };
  }
  const operation = structuredClone(lastRepeatableOperation);
  return await batchSingleUndo({ operations: Array.from({ length: count }, () => structuredClone(operation)), rollbackOnError: true });
}

async function dispatch(operation: BatchOperation) {
  const args = operation.args ?? {};
  const api = window.tinkerMatt;
  switch (normalize(operation.action)) {
    case "create_box": return api.createBox?.({ name: args.name, mode: args.mode, size: { x: args.x, y: args.y, z: args.z }, position: { x: args.posX, y: args.posY, z: args.posZ } });
    case "create_cylinder": return api.createCylinder?.({ name: args.name, mode: args.mode, size: { x: args.x, y: args.y, z: args.z }, position: { x: args.posX, y: args.posY, z: args.posZ } });
    case "create_sphere": return api.createSphere?.({ name: args.name, mode: args.mode, size: { x: args.x, y: args.y, z: args.z }, position: { x: args.posX, y: args.posY, z: args.posZ } });
    case "create_text": return api.createText?.({ text: args.text, name: args.name, height: args.height, depth: args.depth, mode: args.mode, position: { x: args.posX, y: args.posY, z: args.posZ }, rotationDegrees: { x: args.rotX, y: args.rotY, z: args.rotZ } });
    case "create_box_array": return createBoxArray(args);
    case "select_object": return api.selectObject?.(args.object, Boolean(args.additive));
    case "rename_object": return api.renameObject?.({ object: args.object, name: args.name, allowLocked: args.allowLocked });
    case "rename_many": return api.renameMany?.(args);
    case "move_object": return api.moveObject?.({ object: args.object, delta: { x: args.dx, y: args.dy, z: args.dz }, position: { x: args.x, y: args.y, z: args.z }, allowLocked: args.allowLocked });
    case "rotate_object": return api.rotateObject?.({ object: args.object, deltaDegrees: { x: args.dx, y: args.dy, z: args.dz }, rotationDegrees: { x: args.x, y: args.y, z: args.z }, allowLocked: args.allowLocked });
    case "set_dimensions": return api.setDimensions?.({ object: args.object, x: args.x, y: args.y, z: args.z, allowLocked: args.allowLocked });
    case "set_solid_mode": return api.setSolidMode?.({ object: args.object, mode: args.mode, allowLocked: args.allowLocked });
    case "union_objects": return api.unionObjects?.({ objects: args.objects, allowLocked: args.allowLocked });
    case "boolean_objects": return api.booleanObjects?.(args);
    case "split_objects": return api.splitObjects?.(args);
    case "delete_objects": return api.deleteObjects?.(args);
    case "delete_selected": return api.deleteSelectedRemote?.();
    case "clear_scene": return api.clearScene?.(args);
    case "duplicate_object": return api.duplicateObject?.(args);
    case "duplicate_objects": return api.duplicateObjects?.(args);
    case "array_object": return api.arrayObject?.(args);
    case "group_objects": return api.groupObjects?.(args);
    case "ungroup_objects": return api.ungroupObjects?.(args);
    case "get_bounds": return api.getBounds?.(args);
    case "measure": return api.measure?.(args);
    case "align_objects": return api.alignObjects?.(args);
    case "distribute_objects": return api.distributeObjects?.(args);
    case "snap_object_to_object": return api.snapObjectToObject?.(args);
    case "copy_properties": return api.copyProperties?.(args);
    case "clone_transform": return api.cloneTransform?.(args);
    case "set_material": return api.setMaterialRemote?.(args);
    case "set_visibility": return api.setVisibility?.(args);
    case "lock_object":
    case "lock_objects": return api.lockObjects?.(args);
    case "select_by_name_pattern": return api.selectByPattern?.(args);
    case "set_tags": return api.setTags?.(args);
    case "mirror_object": return api.mirrorObject?.(args);
    case "create_component": return api.createComponent?.(args);
    case "sync_component": return api.syncComponent?.(args);
    case "macro": return api.macroControl?.(args);
    case "repeat_last_action": return repeatLastActionRemote(args);
    case "check_printability": return api.checkPrintability?.(args);
    case "split_for_printing": return api.splitForPrinting?.(args);
    case "export_object":
    case "export_group":
    case "export_objects": return api.exportObjects?.(args);
    case "batch": throw new Error("No se permite batch dentro de batch.");
    case "undo":
    case "redo": throw new Error("Undo/redo no están permitidos dentro de una transacción batch.");
    default: throw new Error(`Operación batch desconocida: ${operation.action}`);
  }
}

async function batchSingleUndo(args: any) {
  const operations = Array.isArray(args.operations) ? args.operations as BatchOperation[] : [];
  if (!operations.length) throw new Error("batch necesita al menos una operación.");
  if (operations.length > 500) throw new Error("batch admite hasta 500 operaciones.");

  const checkpoint = editor.checkpoint.bind(editor);
  checkpoint();
  (editor as any).checkpoint = () => {};
  batchDepth += 1;
  const results: any[] = [];
  try {
    for (let i = 0; i < operations.length; i += 1) {
      const operation = operations[i];
      try {
        const result = await dispatch(operation);
        results.push({ index: i, action: operation.action, ok: true, result });
        rememberOperation(operation);
      } catch (error) {
        throw new Error(`Operación ${i + 1}/${operations.length} (${operation.action}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setStatus(`Batch MCP: ${results.length} operación(es) · un solo Undo.`);
    return { ok: true, operations: results.length, results };
  } catch (error) {
    if (args.rollbackOnError !== false) {
      (editor as any).checkpoint = checkpoint;
      editor.undo();
    }
    throw error;
  } finally {
    batchDepth = Math.max(0, batchDepth - 1);
    (editor as any).checkpoint = checkpoint;
    rawEditor.refreshSelectionHelpers?.();
    rawEditor.emit?.("changed");
    rawEditor.emit?.("selection", editor.getSelection());
  }
}

window.tinkerMatt.createBoxArray = createBoxArray;
window.tinkerMatt.repeatLastAction = repeatLastActionRemote;
window.tinkerMatt.__rememberOperation = rememberOperation;
window.tinkerMatt.batch = batchSingleUndo;

setStatus("TinkerMatt v0.8.4 · batch mixto y repetir última acción = una sola transacción/Undo.");
