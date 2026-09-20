import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const WRITE_SECURITY = [{ type: "oauth2", scopes: ["tinkermatt.write"] }];
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const objectRef = z.string().min(1).describe("Object id or exact object name");

type AliasSpec = {
  name: string;
  title: string;
  description: string;
  schema: any;
  action: string;
  destructive?: boolean;
  mapArgs?: (args: any) => any;
};

const ALIASES: AliasSpec[] = [
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
    const annotations = { ...write, destructiveHint: Boolean(spec.destructive) };
    const meta = { securitySchemes: WRITE_SECURITY };
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
      securitySchemes: WRITE_SECURITY,
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
