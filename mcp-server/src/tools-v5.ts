import * as z from "zod/v4";

type RegisterTool = (name: string, config: any, handler: (args: any) => any) => void;
type CallEditor = (session: string, method: string, args?: unknown, timeoutMs?: number) => Promise<unknown>;

type Context = {
  registerTool: RegisterTool;
  callEditor: CallEditor;
  session: string;
  READ_SECURITY: any[];
  WRITE_SECURITY: any[];
  readOnly: Record<string, unknown>;
  write: Record<string, unknown>;
  toolResult: (value: unknown) => any;
  batchTimeoutMs: number;
};

const objectRef = z.string().min(1).describe("Object id or exact object name");
const objectRefs = z.array(objectRef).min(1);
const axis = z.enum(["x", "y", "z"]);
const side = z.enum(["min", "center", "max"]);

export function registerV5Tools(ctx: Context) {
  const { registerTool, callEditor, session, WRITE_SECURITY, readOnly, write, toolResult, batchTimeoutMs } = ctx;

  registerTool("align_objects", {
    title: "Align objects",
    description: "Align two or more objects by world-space min, center or max on X/Y/Z. Defaults to the first object as target; useful for exact CAD alignment without calculating coordinates.",
    inputSchema: z.object({
      objects: z.array(objectRef).min(2),
      axis,
      side: side.optional(),
      target: objectRef.optional(),
      value: z.number().optional().describe("Optional explicit world coordinate instead of a target object"),
      includeTarget: z.boolean().optional(),
      allowLocked: z.boolean().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "alignObjects", args)));

  registerTool("distribute_objects", {
    title: "Distribute objects",
    description: "Distribute 3+ objects along an axis using equal gaps or equal center spacing. Supply spacing for an exact pitch/gap, or omit it to distribute between the outer objects.",
    inputSchema: z.object({
      objects: z.array(objectRef).min(3),
      axis,
      mode: z.enum(["gaps", "centers"]).optional(),
      spacing: z.number().optional(),
      allowLocked: z.boolean().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "distributeObjects", args)));

  registerTool("snap_object_to_object", {
    title: "Snap object to object",
    description: "Place one object relative to another using semantic relations (above/below/left/right/front/back/center) or custom min/center/max faces. This is preferred over hand-calculating absolute coordinates.",
    inputSchema: z.object({
      object: objectRef,
      target: objectRef,
      relation: z.enum(["above", "below", "left", "right", "front", "back", "center", "custom"]).optional(),
      axis: axis.optional(),
      objectSide: side.optional(),
      targetSide: side.optional(),
      offset: z.number().optional().describe("Exact gap/offset in mm; positive follows the selected relation direction"),
      centerOtherAxes: z.boolean().optional().describe("Also center the two unused axes"),
      allowLocked: z.boolean().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "snapObjectToObject", args)));

  registerTool("copy_properties", {
    title: "Copy object properties",
    description: "Copy selected properties from one object to many targets: position, rotation, scale, dimensions, material, solid/hole mode, params and semantic tags.",
    inputSchema: z.object({
      source: objectRef,
      targets: objectRefs,
      properties: z.array(z.enum(["position", "rotation", "scale", "dimensions", "material", "mode", "params", "tags"])).min(1).optional(),
      allowLocked: z.boolean().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "copyProperties", args)));

  registerTool("clone_transform", {
    title: "Clone transform",
    description: "Convenience alias of copy_properties for copying transform/dimension properties from a source to target objects.",
    inputSchema: z.object({
      source: objectRef,
      targets: objectRefs,
      properties: z.array(z.enum(["position", "rotation", "scale", "dimensions"])).min(1).optional(),
      allowLocked: z.boolean().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "cloneTransform", args)));

  registerTool("set_material", {
    title: "Set material",
    description: "Assign a built-in TinkerMatt material preset or a custom PBR material using hex color, roughness, metalness and opacity to one or many objects.",
    inputSchema: z.object({
      objects: objectRefs.optional(),
      object: objectRef.optional(),
      preset: z.string().optional(),
      hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
      roughness: z.number().min(0).max(1).optional(),
      metalness: z.number().min(0).max(1).optional(),
      opacity: z.number().min(0).max(1).optional(),
      allowLocked: z.boolean().optional(),
    }).refine((v) => Boolean(v.object || v.objects?.length), "Provide object or objects"),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "setMaterialRemote", args)));

  registerTool("set_visibility", {
    title: "Set object visibility",
    description: "Hide or show one or many objects without deleting them.",
    inputSchema: z.object({ objects: objectRefs.optional(), object: objectRef.optional(), visible: z.boolean() }).refine((v) => Boolean(v.object || v.objects?.length), "Provide object or objects"),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "setVisibility", args)));

  registerTool("lock_objects", {
    title: "Lock or unlock objects",
    description: "Protect one or many objects from normal MCP modeling operations. Locked objects stay selectable/inspectable and show a lock in the human outliner.",
    inputSchema: z.object({ objects: objectRefs.optional(), object: objectRef.optional(), locked: z.boolean().optional() }).refine((v) => Boolean(v.object || v.objects?.length), "Provide object or objects"),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "lockObjects", args)));

  registerTool("select_by_name_pattern", {
    title: "Select/query objects by pattern",
    description: "Find objects by exact/starts-with/contains/glob/regex name and optionally filter by kind, material, visibility, lock state or semantic tag. Can return matches without changing selection.",
    inputSchema: z.object({
      pattern: z.string().optional(),
      mode: z.enum(["exact", "starts_with", "contains", "glob", "regex"]).optional(),
      caseSensitive: z.boolean().optional(),
      kind: z.string().optional(),
      material: z.string().optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      tagKey: z.string().optional(),
      tagValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
      select: z.boolean().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: { ...write, destructiveHint: false },
  }, async (args) => toolResult(await callEditor(session, "selectByPattern", args)));

  registerTool("rename_many", {
    title: "Rename many objects",
    description: "Rename many objects with a pattern. Tokens: {n}, {name}, {kind}, {id}. Example: Drawer_{n} with pad=2 -> Drawer_01, Drawer_02.",
    inputSchema: z.object({
      objects: objectRefs.optional(),
      pattern: z.string().min(1),
      start: z.number().int().optional(),
      pad: z.number().int().min(0).max(8).optional(),
      allowLocked: z.boolean().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "renameMany", args)));

  registerTool("set_tags", {
    title: "Set semantic tags",
    description: "Add, replace or remove persistent semantic key/value tags on objects, e.g. role=drawer, class=wizard, gender=female, printPart=true.",
    inputSchema: z.object({
      objects: objectRefs.optional(),
      object: objectRef.optional(),
      tags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      remove: z.array(z.string()).optional(),
      replace: z.boolean().optional(),
    }).refine((v) => Boolean(v.object || v.objects?.length), "Provide object or objects"),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "setTags", args)));

  registerTool("boolean_objects", {
    title: "Boolean objects",
    description: "Explicit boolean union, subtract or intersect. For subtract/intersect, the first object is the base and subsequent objects are applied in order.",
    inputSchema: z.object({ objects: z.array(objectRef).min(2), operation: z.enum(["union", "subtract", "intersect"]), allowLocked: z.boolean().optional() }),
    securitySchemes: WRITE_SECURITY,
    annotations: { ...write, destructiveHint: true },
  }, async (args) => toolResult(await callEditor(session, "booleanObjects", args, batchTimeoutMs)));

  registerTool("mirror_object", {
    title: "Mirror object",
    description: "Mirror geometry across a world X/Y/Z plane while fixing triangle winding. By default creates a mirrored copy; clone=false mirrors in place.",
    inputSchema: z.object({ object: objectRef, axis, plane: z.number().optional(), clone: z.boolean().optional(), name: z.string().optional(), allowLocked: z.boolean().optional() }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "mirrorObject", args)));

  registerTool("create_component", {
    title: "Create linked component",
    description: "Mark an object/group as a component master and optionally create linked instances. Geometry, material, params and master scale synchronize; each instance keeps its own position/rotation/name.",
    inputSchema: z.object({
      object: objectRef,
      componentId: z.string().optional(),
      instances: z.number().int().min(0).max(200).optional(),
      dx: z.number().optional(), dy: z.number().optional(), dz: z.number().optional(),
      name: z.string().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "createComponent", args)));

  registerTool("sync_component", {
    title: "Sync component instances",
    description: "Force all linked instances of a component master to refresh from the master. Normally synchronization is automatic when master geometry/material/scale changes.",
    inputSchema: z.object({ master: objectRef }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "syncComponent", args, batchTimeoutMs)));

  registerTool("macro", {
    title: "Control action macro",
    description: "Start/stop/get/repeat TinkerMatt's action recorder. Useful for sequences like duplicate -> move 34.6 mm repeated many times.",
    inputSchema: z.object({ action: z.enum(["start", "stop", "get", "repeat"]), count: z.number().int().min(1).max(100).optional() }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "macroControl", args)));

  registerTool("repeat_last_action", {
    title: "Repeat last MCP action",
    description: "Repeat the last repeatable standalone MCP modeling action up to 100 times.",
    inputSchema: z.object({ count: z.number().int().min(1).max(100).optional() }),
    securitySchemes: WRITE_SECURITY,
    annotations: write,
  }, async (args) => toolResult(await callEditor(session, "repeatLastAction", args, batchTimeoutMs)));

  registerTool("check_printability", {
    title: "Check printability",
    description: "Heuristic 3D-print check: bed fit, very thin overall parts, open boundaries and non-manifold edges. Supply bed/nozzle settings. This complements, not replaces, a slicer.",
    inputSchema: z.object({
      objects: objectRefs.optional(),
      bedX: z.number().positive().optional(), bedY: z.number().positive().optional(), bedZ: z.number().positive().optional(),
      nozzle: z.number().positive().optional(),
      minFeature: z.number().positive().optional(),
    }),
    securitySchemes: ctx.READ_SECURITY,
    annotations: readOnly,
  }, async (args) => toolResult(await callEditor(session, "checkPrintability", args, batchTimeoutMs)));

  registerTool("split_for_printing", {
    title: "Split object for printing",
    description: "Split a simple mesh at an X/Y/Z world plane into two printable parts. Optionally creates one centered male pin and female socket with configurable diameter, depth and tolerance.",
    inputSchema: z.object({
      object: objectRef,
      axis,
      position: z.number().optional(),
      connector: z.boolean().optional(),
      diameter: z.number().positive().optional(),
      depth: z.number().positive().optional(),
      tolerance: z.number().min(0).optional(),
      keepOriginal: z.boolean().optional(),
      allowLocked: z.boolean().optional(),
    }),
    securitySchemes: WRITE_SECURITY,
    annotations: { ...write, destructiveHint: true },
  }, async (args) => toolResult(await callEditor(session, "splitForPrinting", args, batchTimeoutMs)));

  registerTool("export_objects", {
    title: "Export objects to STL",
    description: "Export specific objects/groups, current selection, or the full scene to one STL file in the connected browser. A browser download is triggered with the semantic filename.",
    inputSchema: z.object({ objects: objectRefs.optional(), filename: z.string().optional() }),
    securitySchemes: WRITE_SECURITY,
    annotations: { ...write, destructiveHint: false },
  }, async (args) => toolResult(await callEditor(session, "exportObjects", args, batchTimeoutMs)));
}
