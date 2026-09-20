import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const WRITE_SECURITY = [{ type: "oauth2", scopes: ["tinkermatt.write"] }];
const READ_SECURITY = [{ type: "oauth2", scopes: ["tinkermatt.read"] }];
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const objectRef = z.string().min(1).describe("Object id or exact object name");

const placementFields = {
  name: z.string().min(1).optional(),
  mode: z.enum(["solid", "hole"]).optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
  posZ: z.number().optional(),
  rotX: z.number().optional().describe("Rotation X in degrees"),
  rotY: z.number().optional().describe("Rotation Y in degrees"),
  rotZ: z.number().optional().describe("Rotation Z in degrees"),
};

const sketchPoint = z.object({
  x: z.number(),
  y: z.number(),
  inX: z.number().optional(),
  inY: z.number().optional(),
  outX: z.number().optional(),
  outY: z.number().optional(),
});

type AliasSpec = {
  name: string;
  title: string;
  description: string;
  schema: any;
  action: string;
  destructive?: boolean;
  readOnly?: boolean;
  mapArgs?: (args: any) => any;
};

function shapeMap(kind: string, parameterKeys: string[]) {
  return (args: any) => {
    const parameters: Record<string, number> = {};
    for (const key of parameterKeys) {
      if (typeof args[key] === "number" && Number.isFinite(args[key])) parameters[key] = args[key];
    }
    return {
      kind,
      parameters,
      name: args.name,
      mode: args.mode,
      posX: args.posX,
      posY: args.posY,
      posZ: args.posZ,
      rotX: args.rotX,
      rotY: args.rotY,
      rotZ: args.rotZ,
    };
  };
}

const ALIASES: AliasSpec[] = [
  {
    name: "list_shape_kinds",
    title: "List available 3D shape kinds",
    description: "Discover every parametric body currently supported by the connected TinkerMatt editor, including its exact kind name and default parameters. Use this before create_shape for future shape types.",
    action: "list_shape_kinds",
    readOnly: true,
    schema: z.object({}),
  },
  {
    name: "create_shape",
    title: "Create any parametric TinkerMatt shape",
    description: "Future-proof parametric primitive creator. Pass a kind returned by list_shape_kinds plus its numeric parameters. Supports current and future parametric bodies without needing a new MCP tool name.",
    action: "create_shape",
    schema: z.object({
      kind: z.string().min(1),
      parameters: z.record(z.string(), z.number()).optional(),
      ...placementFields,
    }),
  },
  {
    name: "create_advanced_primitive",
    title: "Create advanced parametric primitive",
    description: "Alias of create_shape for advanced TinkerMatt bodies. Prefer list_shape_kinds first when unsure about parameters.",
    action: "create_advanced_primitive",
    schema: z.object({
      kind: z.string().min(1),
      parameters: z.record(z.string(), z.number()).optional(),
      ...placementFields,
    }),
  },
  {
    name: "create_cone",
    title: "Create cone or frustum",
    description: "Create a parametric cone/frustum with independent bottom/top diameters, height and side count.",
    action: "create_shape",
    schema: z.object({ ...placementFields, bottomDiameter: z.number().nonnegative().optional(), topDiameter: z.number().nonnegative().optional(), height: z.number().positive().optional(), sides: z.number().int().min(3).max(256).optional() }),
    mapArgs: shapeMap("cone", ["bottomDiameter", "topDiameter", "height", "sides"]),
  },
  {
    name: "create_pyramid",
    title: "Create pyramid or rectangular frustum",
    description: "Create a pyramid/frustum with independent rectangular bottom and top dimensions plus height.",
    action: "create_shape",
    schema: z.object({ ...placementFields, bottomX: z.number().positive().optional(), bottomY: z.number().positive().optional(), topX: z.number().nonnegative().optional(), topY: z.number().nonnegative().optional(), height: z.number().positive().optional() }),
    mapArgs: shapeMap("pyramid", ["bottomX", "bottomY", "topX", "topY", "height"]),
  },
  {
    name: "create_roof",
    title: "Create roof prism",
    description: "Create a gable-roof triangular prism using width, depth and height.",
    action: "create_shape",
    schema: z.object({ ...placementFields, width: z.number().positive().optional(), depth: z.number().positive().optional(), height: z.number().positive().optional() }),
    mapArgs: shapeMap("roof", ["width", "depth", "height"]),
  },
  {
    name: "create_wedge",
    title: "Create wedge",
    description: "Create a right wedge/ramp using width, depth and height.",
    action: "create_shape",
    schema: z.object({ ...placementFields, width: z.number().positive().optional(), depth: z.number().positive().optional(), height: z.number().positive().optional() }),
    mapArgs: shapeMap("wedge", ["width", "depth", "height"]),
  },
  {
    name: "create_half_cylinder",
    title: "Create half cylinder / vault",
    description: "Create a half-cylinder vault using diameter, depth and arc segments.",
    action: "create_shape",
    schema: z.object({ ...placementFields, diameter: z.number().positive().optional(), depth: z.number().positive().optional(), segments: z.number().int().min(3).max(256).optional() }),
    mapArgs: shapeMap("halfCylinder", ["diameter", "depth", "segments"]),
  },
  {
    name: "create_dome",
    title: "Create dome",
    description: "Create a parametric dome/hemisphere with diameter, height, segments and rings.",
    action: "create_shape",
    schema: z.object({ ...placementFields, diameter: z.number().positive().optional(), height: z.number().positive().optional(), segments: z.number().int().min(8).max(256).optional(), rings: z.number().int().min(2).max(128).optional() }),
    mapArgs: shapeMap("dome", ["diameter", "height", "segments", "rings"]),
  },
  {
    name: "create_torus",
    title: "Create torus",
    description: "Create a torus with exact outer diameter, tube diameter and mesh segment counts.",
    action: "create_shape",
    schema: z.object({ ...placementFields, outerDiameter: z.number().positive().optional(), tubeDiameter: z.number().positive().optional(), radialSegments: z.number().int().min(3).max(128).optional(), tubularSegments: z.number().int().min(8).max(512).optional() }),
    mapArgs: shapeMap("torus", ["outerDiameter", "tubeDiameter", "radialSegments", "tubularSegments"]),
  },
  {
    name: "create_washer",
    title: "Create washer / hollow ring",
    description: "Create a short hollow cylinder with independent outer diameter, inner diameter, height and side count.",
    action: "create_shape",
    schema: z.object({ ...placementFields, outerDiameter: z.number().positive().optional(), innerDiameter: z.number().nonnegative().optional(), height: z.number().positive().optional(), sides: z.number().int().min(3).max(256).optional() }),
    mapArgs: shapeMap("washer", ["outerDiameter", "innerDiameter", "height", "sides"]),
  },
  {
    name: "create_prism",
    title: "Create polygonal prism",
    description: "Create a regular polygonal prism; sides=6 gives the default hexagonal prism.",
    action: "create_shape",
    schema: z.object({ ...placementFields, diameter: z.number().positive().optional(), height: z.number().positive().optional(), sides: z.number().int().min(3).max(256).optional() }),
    mapArgs: shapeMap("prism", ["diameter", "height", "sides"]),
  },
  {
    name: "create_polyhedron",
    title: "Create polyhedron",
    description: "Create TinkerMatt's rounded regular polyhedron with diameter and subdivision detail.",
    action: "create_shape",
    schema: z.object({ ...placementFields, diameter: z.number().positive().optional(), detail: z.number().int().min(0).max(5).optional() }),
    mapArgs: shapeMap("polyhedron", ["diameter", "detail"]),
  },
  {
    name: "create_sketch_extrude",
    title: "Extrude 2D profile",
    description: "Create a solid by extruding a closed XY profile. Points may optionally include Bezier in/out handles; plain x/y points create straight edges.",
    action: "create_sketch_extrude",
    schema: z.object({ ...placementFields, points: z.array(sketchPoint).min(3).max(1000), depth: z.number().positive() }),
  },
  {
    name: "create_sketch_revolve",
    title: "Revolve 2D profile",
    description: "Create a solid of revolution from an XY profile around the profile's local Y axis. Plain x/y points create straight profile segments.",
    action: "create_sketch_revolve",
    schema: z.object({ ...placementFields, points: z.array(sketchPoint).min(3).max(1000), angle: z.number().gt(0).max(360).optional(), segments: z.number().int().min(3).max(256).optional() }),
  },
  {
    name: "get_primitive_parameters",
    title: "Get parametric primitive parameters",
    description: "Read the exact editable parametric values of an existing TinkerMatt primitive.",
    action: "get_primitive_parameters",
    readOnly: true,
    schema: z.object({ object: objectRef }),
  },
  {
    name: "set_primitive_parameters",
    title: "Set parametric primitive parameters",
    description: "Change one or more native parametric values of an existing TinkerMatt primitive while preserving its identity and transform.",
    action: "set_primitive_parameters",
    schema: z.object({ object: objectRef, parameters: z.record(z.string(), z.number()) }),
  },
  {
    name: "create_box_array",
    title: "Create box array",
    description: "Create up to 1000 boxes in a rectangular X/Y/Z array in one operation, with exact dimensions, base position, spacing and automatic naming.",
    action: "create_box_array",
    schema: z.object({
      name: z.string().optional(),
      pad: z.number().int().min(0).max(8).optional(),
      mode: z.enum(["solid", "hole"]).optional(),
      x: z.number().positive(), y: z.number().positive(), z: z.number().positive(),
      posX: z.number().optional(), posY: z.number().optional(), posZ: z.number().optional(),
      countX: z.number().int().min(1).max(100).optional(),
      countY: z.number().int().min(1).max(100).optional(),
      countZ: z.number().int().min(1).max(100).optional(),
      spacingX: z.number().optional(), spacingY: z.number().optional(), spacingZ: z.number().optional(),
    }),
  },
  {
    name: "split_objects",
    title: "Split object with cutter",
    description: "Split a simple base mesh with a simple cutter mesh into two new objects: the portion inside the cutter and the portion outside it.",
    action: "split_objects",
    destructive: true,
    schema: z.object({
      base: objectRef,
      cutter: objectRef,
      insideName: z.string().optional(),
      outsideName: z.string().optional(),
      keepCutter: z.boolean().optional(),
      allowLocked: z.boolean().optional(),
    }),
  },
  {
    name: "export_object",
    title: "Export object to STL",
    description: "Export one specific object as an STL download in the connected TinkerMatt browser.",
    action: "export_objects",
    schema: z.object({ object: objectRef, filename: z.string().optional() }),
    mapArgs: (args) => ({ objects: [args.object], filename: args.filename }),
  },
  {
    name: "export_group",
    title: "Export group to STL",
    description: "Export one hierarchy group/assembly as an STL download in the connected TinkerMatt browser.",
    action: "export_objects",
    schema: z.object({ group: objectRef, filename: z.string().optional() }),
    mapArgs: (args) => ({ objects: [args.group], filename: args.filename }),
  },
  {
    name: "lock_object",
    title: "Lock object",
    description: "Lock or unlock one object. Locked objects remain selectable and inspectable but are protected from normal edits until explicitly unlocked.",
    action: "lock_objects",
    schema: z.object({ object: objectRef, locked: z.boolean().optional() }),
  },
];

const baseRegisterTool = (McpServer.prototype as any).registerTool;
(McpServer.prototype as any).registerTool = function aliasAwareRegisterTool(name: string, config: any, handler: (args: any) => any) {
  const result = baseRegisterTool.call(this, name, config, handler);
  if (name !== "batch" || (this as any).__tmV51AliasesInstalled) return result;
  (this as any).__tmV51AliasesInstalled = true;

  const server = this as any;
  const descriptors: any[] = [];
  for (const spec of ALIASES) {
    const securitySchemes = spec.readOnly ? READ_SECURITY : WRITE_SECURITY;
    const annotations = spec.readOnly ? readOnly : { ...write, destructiveHint: Boolean(spec.destructive) };
    const meta = { securitySchemes };
    baseRegisterTool.call(server, spec.name, {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.schema,
      annotations,
      _meta: meta,
    }, async (args: any) => {
      const mapped = spec.mapArgs ? spec.mapArgs(args) : args;
      return await handler({ operations: [{ action: spec.action, args: mapped }], rollbackOnError: true });
    });
    descriptors.push({
      name: spec.name,
      title: spec.title,
      description: spec.description,
      inputSchema: z.toJSONSchema(spec.schema),
      annotations,
      securitySchemes,
      _meta: meta,
    });
  }

  const protocolServer = server.server;
  const previousSetRequestHandler = protocolServer.setRequestHandler.bind(protocolServer);
  protocolServer.setRequestHandler = (schema: any, requestHandler: any) => {
    if (schema === "tools/list") {
      return previousSetRequestHandler(schema, async (...args: any[]) => {
        const response = await requestHandler(...args);
        return { ...response, tools: [...(response?.tools ?? []), ...descriptors] };
      });
    }
    return previousSetRequestHandler(schema, requestHandler);
  };
  return result;
};

// Patch first; v0.5 then installs the advanced tools and dynamically starts v0.4.
await import("./index-v5.js");
