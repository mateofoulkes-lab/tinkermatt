import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { WebSocketServer, WebSocket } from "ws";
import * as z from "zod/v4";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type EditorSession = {
  socket: WebSocket;
  session: string;
  appVersion?: string;
  projectName?: string;
  connectedAt: string;
  pending: Map<string, PendingCall>;
};

type EditorResponse = {
  type: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

const PORT = Number(process.env.PORT || 8787);
const CALL_TIMEOUT_MS = Number(process.env.EDITOR_CALL_TIMEOUT_MS || 15000);
const sessions = new Map<string, EditorSession>();
const allowedOrigins = new Set(
  (process.env.ALLOWED_EDITOR_ORIGINS || "https://mateofoulkes-lab.github.io,http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

function validSession(value: string | null | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{32,128}$/i.test(value));
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof value === "string" ? value : json(value) }],
  };
}

function sessionFromRequest(request?: Request) {
  if (!request) return "";
  try {
    return new URL(request.url).searchParams.get("session") ?? "";
  } catch {
    return "";
  }
}

function requireEditor(session: string) {
  if (!validSession(session)) throw new Error("Falta una clave de sesión MCP válida en ?session=...");
  const editor = sessions.get(session);
  if (!editor || editor.socket.readyState !== WebSocket.OPEN) {
    throw new Error("No hay una pestaña de TinkerMatt conectada para esta sesión. Abrí TinkerMatt y conectá MCP desde Opciones.");
  }
  return editor;
}

function callEditor(session: string, method: string, args: unknown = {}) {
  const editor = requireEditor(session);
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      editor.pending.delete(id);
      reject(new Error(`TinkerMatt no respondió a ${method} dentro de ${CALL_TIMEOUT_MS} ms.`));
    }, CALL_TIMEOUT_MS);
    editor.pending.set(id, { resolve, reject, timer });
    editor.socket.send(JSON.stringify({ type: "request", id, method, args }));
  });
}

function commonPrimitiveArgs() {
  return z.object({
    name: z.string().min(1).optional(),
    mode: z.enum(["solid", "hole"]).optional(),
    x: z.number().positive().optional().describe("Tamaño X en milímetros"),
    y: z.number().positive().optional().describe("Tamaño Y en milímetros"),
    z: z.number().positive().optional().describe("Tamaño Z en milímetros"),
    posX: z.number().optional(),
    posY: z.number().optional(),
    posZ: z.number().optional(),
  });
}

function buildMcp(session: string) {
  const server = new McpServer({
    name: "TinkerMatt",
    version: "0.1.0",
    websiteUrl: "https://mateofoulkes-lab.github.io/tinkermatt/",
  });

  server.registerTool(
    "editor_status",
    {
      title: "TinkerMatt editor status",
      description: "Check whether the TinkerMatt browser editor for this MCP session is connected.",
      inputSchema: z.object({}),
    },
    async () => {
      const editor = sessions.get(session);
      return toolResult({
        connected: Boolean(editor && editor.socket.readyState === WebSocket.OPEN),
        appVersion: editor?.appVersion ?? null,
        projectName: editor?.projectName ?? null,
        connectedAt: editor?.connectedAt ?? null,
      });
    },
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Read the current TinkerMatt project name, snap settings, selection, and object count.",
      inputSchema: z.object({}),
    },
    async () => toolResult(await callEditor(session, "getProject")),
  );

  server.registerTool(
    "get_scene",
    {
      title: "Get scene",
      description: "Read the semantic scene tree with object ids, names, types, transforms, params and references.",
      inputSchema: z.object({}),
    },
    async () => toolResult(await callEditor(session, "getScene")),
  );

  server.registerTool(
    "list_objects",
    {
      title: "List objects",
      description: "List all model objects with ids, names, dimensions, transforms, mode and references.",
      inputSchema: z.object({}),
    },
    async () => toolResult(await callEditor(session, "listObjects")),
  );

  server.registerTool(
    "list_references",
    {
      title: "List semantic references",
      description: "List named semantic face, edge, vertex and object references in the TinkerMatt scene.",
      inputSchema: z.object({}),
    },
    async () => toolResult(await callEditor(session, "listReferences")),
  );

  const registerPrimitive = (toolName: string, title: string, method: string) => {
    server.registerTool(
      toolName,
      {
        title,
        description: `Create a ${title.toLowerCase()} in TinkerMatt. Dimensions and positions are millimetres.`,
        inputSchema: commonPrimitiveArgs(),
      },
      async (args) => toolResult(await callEditor(session, method, {
        name: args.name,
        mode: args.mode,
        size: { x: args.x, y: args.y, z: args.z },
        position: { x: args.posX, y: args.posY, z: args.posZ },
      })),
    );
  };

  registerPrimitive("create_box", "Box", "createBox");
  registerPrimitive("create_cylinder", "Cylinder", "createCylinder");
  registerPrimitive("create_sphere", "Sphere", "createSphere");

  server.registerTool(
    "select_object",
    {
      title: "Select object",
      description: "Select a TinkerMatt object by id or exact name.",
      inputSchema: z.object({ object: z.string().min(1), additive: z.boolean().optional() }),
    },
    async ({ object, additive }) => toolResult(await callEditor(session, "selectObject", [object, Boolean(additive)])),
  );

  server.registerTool(
    "rename_object",
    {
      title: "Rename object",
      description: "Rename an object by id or exact current name.",
      inputSchema: z.object({ object: z.string().min(1), name: z.string().min(1) }),
    },
    async (args) => toolResult(await callEditor(session, "renameObject", args)),
  );

  server.registerTool(
    "move_object",
    {
      title: "Move object",
      description: "Move an object. Use dx/dy/dz for relative movement or x/y/z for absolute position, in millimetres.",
      inputSchema: z.object({
        object: z.string().min(1),
        dx: z.number().optional(), dy: z.number().optional(), dz: z.number().optional(),
        x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
      }),
    },
    async (args) => toolResult(await callEditor(session, "moveObject", {
      object: args.object,
      delta: { x: args.dx, y: args.dy, z: args.dz },
      position: { x: args.x, y: args.y, z: args.z },
    })),
  );

  server.registerTool(
    "rotate_object",
    {
      title: "Rotate object",
      description: "Rotate an object in degrees. Use dx/dy/dz for relative rotation or x/y/z for absolute Euler angles.",
      inputSchema: z.object({
        object: z.string().min(1),
        dx: z.number().optional(), dy: z.number().optional(), dz: z.number().optional(),
        x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
      }),
    },
    async (args) => toolResult(await callEditor(session, "rotateObject", {
      object: args.object,
      deltaDegrees: { x: args.dx, y: args.dy, z: args.dz },
      rotationDegrees: { x: args.x, y: args.y, z: args.z },
    })),
  );

  server.registerTool(
    "set_dimensions",
    {
      title: "Set dimensions",
      description: "Set one or more object dimensions in millimetres.",
      inputSchema: z.object({
        object: z.string().min(1),
        x: z.number().positive().optional(),
        y: z.number().positive().optional(),
        z: z.number().positive().optional(),
      }),
    },
    async (args) => toolResult(await callEditor(session, "setDimensions", args)),
  );

  server.registerTool(
    "set_solid_mode",
    {
      title: "Set solid or hole",
      description: "Mark an object as solid or hole. Holes subtract when unioned with solids.",
      inputSchema: z.object({ object: z.string().min(1), mode: z.enum(["solid", "hole"]) }),
    },
    async (args) => toolResult(await callEditor(session, "setSolidMode", args)),
  );

  server.registerTool(
    "union_objects",
    {
      title: "Union objects",
      description: "Union selected solids; objects marked as holes are subtracted automatically.",
      inputSchema: z.object({ objects: z.array(z.string().min(1)).min(2) }),
    },
    async (args) => toolResult(await callEditor(session, "unionObjects", args)),
  );

  server.registerTool(
    "select_reference",
    {
      title: "Select semantic reference",
      description: "Highlight a named semantic reference by its reference id.",
      inputSchema: z.object({ referenceId: z.string().min(1) }),
    },
    async (args) => toolResult(await callEditor(session, "selectReference", args)),
  );

  server.registerTool(
    "undo",
    { title: "Undo", description: "Undo the most recent TinkerMatt edit.", inputSchema: z.object({}) },
    async () => toolResult(await callEditor(session, "undo")),
  );

  server.registerTool(
    "redo",
    { title: "Redo", description: "Redo the most recently undone TinkerMatt edit.", inputSchema: z.object({}) },
    async () => toolResult(await callEditor(session, "redo")),
  );

  return server;
}

const mcpHandler = createMcpHandler(({ requestInfo }) => {
  const session = sessionFromRequest(requestInfo);
  return buildMcp(session);
}, { responseMode: "json" });
const nodeMcpHandler = toNodeHandler(mcpHandler);

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(json({ ok: true, service: "TinkerMatt MCP", editors: sessions.size }));
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(json({
      name: "TinkerMatt MCP",
      version: "0.1.0",
      mcp: "/mcp?session=<secret-session-key>",
      editorWebSocket: "/editor?session=<secret-session-key>",
      connectedEditors: sessions.size,
    }));
    return;
  }

  if (url.pathname === "/mcp") {
    await nodeMcpHandler(req, res);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(json({ error: "Not found" }));
});

const websocketServer = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/editor") {
    socket.destroy();
    return;
  }
  const origin = String(req.headers.origin || "");
  if (origin && !allowedOrigins.has(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  const session = url.searchParams.get("session");
  if (!validSession(session)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(req, socket, head, (ws) => {
    websocketServer.emit("connection", ws, req, session);
  });
});

websocketServer.on("connection", (socket: WebSocket, _req, sessionArg?: unknown) => {
  const session = String(sessionArg || "");
  if (!validSession(session)) {
    socket.close(1008, "Invalid session");
    return;
  }

  const previous = sessions.get(session);
  if (previous && previous.socket !== socket) previous.socket.close(1012, "Replaced by a newer TinkerMatt tab");

  const editorSession: EditorSession = {
    socket,
    session,
    connectedAt: new Date().toISOString(),
    pending: new Map(),
  };
  sessions.set(session, editorSession);

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw));
      if (message?.type === "hello") {
        editorSession.appVersion = typeof message.appVersion === "string" ? message.appVersion : undefined;
        editorSession.projectName = typeof message.projectName === "string" ? message.projectName : undefined;
        socket.send(JSON.stringify({ type: "hello", ok: true, serverVersion: "0.1.0" }));
        return;
      }
      if (message?.type === "response") {
        const response = message as EditorResponse;
        const pending = editorSession.pending.get(response.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        editorSession.pending.delete(response.id);
        if (response.ok) pending.resolve(response.result);
        else pending.reject(new Error(response.error || "TinkerMatt devolvió un error."));
      }
    } catch (error) {
      console.warn("Invalid editor WebSocket message", error);
    }
  });

  const close = () => {
    if (sessions.get(session)?.socket === socket) sessions.delete(session);
    for (const [, pending] of editorSession.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("La pestaña TinkerMatt se desconectó."));
    }
    editorSession.pending.clear();
  };
  socket.on("close", close);
  socket.on("error", close);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`TinkerMatt MCP listening on :${PORT}`);
});

process.on("SIGTERM", async () => {
  for (const [, session] of sessions) session.socket.close(1001, "Server shutdown");
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
});
