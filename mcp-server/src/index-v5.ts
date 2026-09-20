import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const WRITE_SECURITY = [{ type: "oauth2", scopes: ["tinkermatt.write"] }];
const READ_SECURITY = [{ type: "oauth2", scopes: ["tinkermatt.read"] }];
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const objectRef = z.string().min(1).describe("Object id or exact object name");
const objectRefs = z.array(objectRef).min(1);
const axis = z.enum(["x", "y", "z"]);
const side = z.enum(["min", "center", "max"]);

type ExtraSpec = {
  name: string;
  title: string;
  description: string;
  schema: any;
  action?: string;
  readOnly?: boolean;
  destructive?: boolean;
};

const SPECS: ExtraSpec[] = [
  {
    name: "align_objects", title: "Align objects",
    description: "Align 2+ objects by world-space min/center/max on X/Y/Z. Prefer this over manually calculating coordinates.",
    schema: z.object({ objects: z.array(objectRef).min(2), axis, side: side.optional(), target: objectRef.optional(), value: z.number().optional(), includeTarget: z.boolean().optional(), allowLocked: z.boolean().optional() }),
  },
  {
    name: "distribute_objects", title: "Distribute objects",
    description: "Distribute 3+ objects with equal gaps or center spacing; optional exact spacing in mm.",
    schema: z.object({ objects: z.array(objectRef).min(3), axis, mode: z.enum(["gaps", "centers"]).optional(), spacing: z.number().optional(), allowLocked: z.boolean().optional() }),
  },
  {
    name: "snap_object_to_object", title: "Snap object to object",
    description: "Place an object relative to another using above/below/left/right/front/back/center or explicit min/center/max faces and exact offset.",
    schema: z.object({ object: objectRef, target: objectRef, relation: z.enum(["above", "below", "left", "right", "front", "back", "center", "custom"]).optional(), axis: axis.optional(), objectSide: side.optional(), targetSide: side.optional(), offset: z.number().optional(), centerOtherAxes: z.boolean().optional(), allowLocked: z.boolean().optional() }),
  },
  {
    name: "copy_properties", title: "Copy object properties",
    description: "Copy position, rotation, scale, dimensions, material, solid/hole mode, params or semantic tags from one object to many targets.",
    schema: z.object({ source: objectRef, targets: objectRefs, properties: z.array(z.enum(["position", "rotation", "scale", "dimensions", "material", "mode", "params", "tags"])).optional(), allowLocked: z.boolean().optional() }),
  },
  {
    name: "clone_transform", title: "Clone transform",
    description: "Copy transform/dimension properties from a source object to target objects.",
    action: "clone_transform",
    schema: z.object({ source: objectRef, targets: objectRefs, properties: z.array(z.enum(["position", "rotation", "scale", "dimensions"])).optional(), allowLocked: z.boolean().optional() }),
  },
  {
    name: "set_material", title: "Set material",
    description: "Assign a built-in preset or custom PBR material using hex color, roughness, metalness and opacity.",
    schema: z.object({ objects: objectRefs.optional(), object: objectRef.optional(), preset: z.string().optional(), hex: z.string().optional(), roughness: z.number().min(0).max(1).optional(), metalness: z.number().min(0).max(1).optional(), opacity: z.number().min(0).max(1).optional(), allowLocked: z.boolean().optional() }),
  },
  {
    name: "set_visibility", title: "Set object visibility",
    description: "Hide/show objects without deleting them.",
    schema: z.object({ objects: objectRefs.optional(), object: objectRef.optional(), visible: z.boolean() }),
  },
  {
    name: "lock_objects", title: "Lock objects",
    description: "Lock/unlock objects to protect them from ordinary modeling operations. Lock state is also shown in the human outliner.",
    schema: z.object({ objects: objectRefs.optional(), object: objectRef.optional(), locked: z.boolean().optional() }),
  },
  {
    name: "select_by_name_pattern", title: "Select/query objects by pattern",
    description: "Query/select objects by exact, prefix, contains, glob or regex name plus optional kind/material/visibility/lock/tag filters.",
    schema: z.object({ pattern: z.string().optional(), mode: z.enum(["exact", "starts_with", "contains", "glob", "regex"]).optional(), caseSensitive: z.boolean().optional(), kind: z.string().optional(), material: z.string().optional(), visible: z.boolean().optional(), locked: z.boolean().optional(), tagKey: z.string().optional(), tagValue: z.union([z.string(), z.number(), z.boolean()]).optional(), select: z.boolean().optional() }),
  },
  {
    name: "rename_many", title: "Rename many objects",
    description: "Rename many objects with pattern tokens {n}, {name}, {kind}, {id}. Example Drawer_{n} with pad=2.",
    schema: z.object({ objects: objectRefs.optional(), pattern: z.string().min(1), start: z.number().int().optional(), pad: z.number().int().min(0).max(8).optional(), allowLocked: z.boolean().optional() }),
  },
  {
    name: "set_tags", title: "Set semantic tags",
    description: "Add/replace/remove persistent semantic metadata such as role=drawer, class=wizard or printPart=true.",
    schema: z.object({ objects: objectRefs.optional(), object: objectRef.optional(), tags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), remove: z.array(z.string()).optional(), replace: z.boolean().optional() }),
  },
  {
    name: "boolean_objects", title: "Boolean objects",
    description: "Explicit union/subtract/intersect. For subtract/intersect the first object is the base.",
    schema: z.object({ objects: z.array(objectRef).min(2), operation: z.enum(["union", "subtract", "intersect"]), allowLocked: z.boolean().optional() }),
    destructive: true,
  },
  {
    name: "mirror_object", title: "Mirror object",
    description: "Mirror geometry across a world X/Y/Z plane. Creates a mirrored copy by default and fixes triangle winding.",
    schema: z.object({ object: objectRef, axis, plane: z.number().optional(), clone: z.boolean().optional(), name: z.string().optional(), allowLocked: z.boolean().optional() }),
  },
  {
    name: "create_component", title: "Create linked component",
    description: "Create a component master and linked instances. Geometry/material/params/master scale synchronize while each instance keeps position/rotation/name.",
    schema: z.object({ object: objectRef, componentId: z.string().optional(), instances: z.number().int().min(0).max(200).optional(), dx: z.number().optional(), dy: z.number().optional(), dz: z.number().optional(), name: z.string().optional() }),
  },
  {
    name: "sync_component", title: "Sync component instances",
    description: "Force linked instances to refresh from their component master; synchronization is normally automatic.",
    schema: z.object({ master: objectRef }),
  },
  {
    name: "macro", title: "Control action macro",
    description: "Start/stop/get/repeat the built-in action recorder. Useful for duplicate -> move -> repeat workflows.",
    schema: z.object({ action: z.enum(["start", "stop", "get", "repeat"]), count: z.number().int().min(1).max(100).optional() }),
  },
  {
    name: "repeat_last_action", title: "Repeat last MCP action",
    description: "Repeat the last repeatable MCP modeling action up to 100 times.",
    schema: z.object({ count: z.number().int().min(1).max(100).optional() }),
  },
  {
    name: "check_printability", title: "Check printability",
    description: "Heuristic print check for bed fit, very thin overall parts, open mesh boundaries and non-manifold edges. Complements a slicer.",
    schema: z.object({ objects: objectRefs.optional(), bedX: z.number().positive().optional(), bedY: z.number().positive().optional(), bedZ: z.number().positive().optional(), nozzle: z.number().positive().optional(), minFeature: z.number().positive().optional() }),
    readOnly: true,
  },
  {
    name: "split_for_printing", title: "Split object for printing",
    description: "Split a simple mesh on X/Y/Z into two pieces, optionally adding a centered male pin/female socket with tolerance.",
    schema: z.object({ object: objectRef, axis, position: z.number().optional(), connector: z.boolean().optional(), diameter: z.number().positive().optional(), depth: z.number().positive().optional(), tolerance: z.number().min(0).optional(), keepOriginal: z.boolean().optional(), allowLocked: z.boolean().optional() }),
    destructive: true,
  },
  {
    name: "export_objects", title: "Export objects to STL",
    description: "Export named objects/groups, current selection or the full scene as one STL download in the connected browser.",
    schema: z.object({ objects: objectRefs.optional(), filename: z.string().optional() }),
  },
];

const originalRegisterTool = (McpServer.prototype as any).registerTool;

(McpServer.prototype as any).registerTool = function patchedRegisterTool(name: string, config: any, handler: (args: any) => any) {
  const result = originalRegisterTool.call(this, name, config, handler);
  if (name !== "batch" || (this as any).__tmV5ToolsInstalled) return result;
  (this as any).__tmV5ToolsInstalled = true;

  const server = this as any;
  const extraDescriptors: any[] = [];

  for (const spec of SPECS) {
    const securitySchemes = spec.readOnly ? READ_SECURITY : WRITE_SECURITY;
    const annotations = spec.readOnly ? readOnly : { ...write, destructiveHint: Boolean(spec.destructive) };
    const meta = { securitySchemes };
    const sdkConfig = {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.schema,
      annotations,
      _meta: meta,
    };
    const action = spec.action ?? spec.name;
    originalRegisterTool.call(server, spec.name, sdkConfig, async (args: any) => {
      // Reuse the proven authenticated batch bridge from v0.4. The browser-side
      // v0.8.4 dispatcher owns the new operations and transaction behavior.
      return await handler({ operations: [{ action, args }], rollbackOnError: true });
    });
    extraDescriptors.push({
      name: spec.name,
      title: spec.title,
      description: spec.description,
      inputSchema: z.toJSONSchema(spec.schema),
      annotations,
      securitySchemes,
      _meta: meta,
    });
  }

  // v0.4 replaces tools/list with its own descriptor array for OpenAI root-level
  // securitySchemes. Wrap that future handler so v0.5 descriptors are appended.
  const protocolServer = server.server;
  const originalSetRequestHandler = protocolServer.setRequestHandler.bind(protocolServer);
  protocolServer.setRequestHandler = (schema: any, requestHandler: any) => {
    if (schema === "tools/list") {
      return originalSetRequestHandler(schema, async (...args: any[]) => {
        const response = await requestHandler(...args);
        return { ...response, tools: [...(response?.tools ?? []), ...extraDescriptors] };
      });
    }
    return originalSetRequestHandler(schema, requestHandler);
  };
  return result;
};

// Dynamic import is deliberate: the prototype patch must exist before v0.4 creates
// its McpServer instances and registers the batch tool.
await import("./index-v4.js");
