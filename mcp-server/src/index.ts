import { createServer, type IncomingMessage } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
};

type AccessGrant = {
  clientId: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
};

const PORT = Number(process.env.PORT || 8787);
const CALL_TIMEOUT_MS = Number(process.env.EDITOR_CALL_TIMEOUT_MS || 15000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://tinkermatt-mcp.onrender.com").replace(/\/$/, "");
const RESOURCE_ID = PUBLIC_BASE_URL;
const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const READ_SCOPE = "tinkermatt.read";
const WRITE_SCOPE = "tinkermatt.write";
const SUPPORTED_SCOPES = [READ_SCOPE, WRITE_SCOPE];
const READ_SECURITY = [{ type: "oauth2" as const, scopes: [READ_SCOPE] }];
const WRITE_SECURITY = [{ type: "oauth2" as const, scopes: [WRITE_SCOPE] }];

const sessions = new Map<string, EditorSession>();
const authorizationCodes = new Map<string, AuthorizationCode>();
const accessTokens = new Map<string, AccessGrant>();
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

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] || char);
}

function randomToken() {
  return randomBytes(32).toString("base64url");
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
    version: "0.2.0",
    websiteUrl: "https://mateofoulkes-lab.github.io/tinkermatt/",
  });

  server.registerTool(
    "editor_status",
    {
      title: "TinkerMatt editor status",
      description: "Check whether the TinkerMatt browser editor for this MCP session is connected.",
      inputSchema: z.object({}),
      securitySchemes: READ_SECURITY,
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
      securitySchemes: READ_SECURITY,
    },
    async () => toolResult(await callEditor(session, "getProject")),
  );

  server.registerTool(
    "get_scene",
    {
      title: "Get scene",
      description: "Read the semantic scene tree with object ids, names, types, transforms, params and references.",
      inputSchema: z.object({}),
      securitySchemes: READ_SECURITY,
    },
    async () => toolResult(await callEditor(session, "getScene")),
  );

  server.registerTool(
    "list_objects",
    {
      title: "List objects",
      description: "List all model objects with ids, names, dimensions, transforms, mode and references.",
      inputSchema: z.object({}),
      securitySchemes: READ_SECURITY,
    },
    async () => toolResult(await callEditor(session, "listObjects")),
  );

  server.registerTool(
    "list_references",
    {
      title: "List semantic references",
      description: "List named semantic face, edge, vertex and object references in the TinkerMatt scene.",
      inputSchema: z.object({}),
      securitySchemes: READ_SECURITY,
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
        securitySchemes: WRITE_SECURITY,
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
      securitySchemes: WRITE_SECURITY,
    },
    async ({ object, additive }) => toolResult(await callEditor(session, "selectObject", [object, Boolean(additive)])),
  );

  server.registerTool(
    "rename_object",
    {
      title: "Rename object",
      description: "Rename an object by id or exact current name.",
      inputSchema: z.object({ object: z.string().min(1), name: z.string().min(1) }),
      securitySchemes: WRITE_SECURITY,
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
      securitySchemes: WRITE_SECURITY,
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
      securitySchemes: WRITE_SECURITY,
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
      securitySchemes: WRITE_SECURITY,
    },
    async (args) => toolResult(await callEditor(session, "setDimensions", args)),
  );

  server.registerTool(
    "set_solid_mode",
    {
      title: "Set solid or hole",
      description: "Mark an object as solid or hole. Holes subtract when unioned with solids.",
      inputSchema: z.object({ object: z.string().min(1), mode: z.enum(["solid", "hole"]) }),
      securitySchemes: WRITE_SECURITY,
    },
    async (args) => toolResult(await callEditor(session, "setSolidMode", args)),
  );

  server.registerTool(
    "union_objects",
    {
      title: "Union objects",
      description: "Union selected solids; objects marked as holes are subtracted automatically.",
      inputSchema: z.object({ objects: z.array(z.string().min(1)).min(2) }),
      securitySchemes: WRITE_SECURITY,
    },
    async (args) => toolResult(await callEditor(session, "unionObjects", args)),
  );

  server.registerTool(
    "select_reference",
    {
      title: "Select semantic reference",
      description: "Highlight a named semantic reference by its reference id.",
      inputSchema: z.object({ referenceId: z.string().min(1) }),
      securitySchemes: WRITE_SECURITY,
    },
    async (args) => toolResult(await callEditor(session, "selectReference", args)),
  );

  server.registerTool(
    "undo",
    {
      title: "Undo",
      description: "Undo the most recent TinkerMatt edit.",
      inputSchema: z.object({}),
      securitySchemes: WRITE_SECURITY,
    },
    async () => toolResult(await callEditor(session, "undo")),
  );

  server.registerTool(
    "redo",
    {
      title: "Redo",
      description: "Redo the most recently undone TinkerMatt edit.",
      inputSchema: z.object({}),
      securitySchemes: WRITE_SECURITY,
    },
    async () => toolResult(await callEditor(session, "redo")),
  );

  return server;
}

const mcpHandler = createMcpHandler(({ requestInfo }) => {
  const session = sessionFromRequest(requestInfo);
  return buildMcp(session);
}, { responseMode: "json" });
const nodeMcpHandler = toNodeHandler(mcpHandler);

function cleanupOAuth() {
  const now = Date.now();
  for (const [code, record] of authorizationCodes) if (record.expiresAt <= now) authorizationCodes.delete(code);
  for (const [token, record] of accessTokens) if (record.expiresAt <= now) accessTokens.delete(token);
}

const cleanupTimer = setInterval(cleanupOAuth, 60_000);
cleanupTimer.unref();

function oauthMetadata() {
  return {
    issuer: PUBLIC_BASE_URL,
    authorization_endpoint: `${PUBLIC_BASE_URL}/oauth/authorize`,
    token_endpoint: `${PUBLIC_BASE_URL}/oauth/token`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SUPPORTED_SCOPES,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: false,
  };
}

function protectedResourceMetadata() {
  return {
    resource: RESOURCE_ID,
    authorization_servers: [PUBLIC_BASE_URL],
    scopes_supported: SUPPORTED_SCOPES,
    resource_documentation: "https://mateofoulkes-lab.github.io/tinkermatt/",
  };
}

function validChatGptClientId(clientId: string) {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.hostname === "chatgpt.com" &&
      (/^\/oauth\/client\.json$/.test(url.pathname) || /^\/oauth\/[^/]+\/client\.json$/.test(url.pathname));
  } catch {
    return false;
  }
}

function validChatGptRedirect(redirectUri: string) {
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" && url.hostname === "chatgpt.com" &&
      (url.pathname === "/connector_platform_oauth_redirect" || /^\/connector\/oauth\/[^/]+$/.test(url.pathname));
  } catch {
    return false;
  }
}

function normalizeScopes(value: string | null) {
  const requested = (value || SUPPORTED_SCOPES.join(" ")).split(/\s+/).filter(Boolean);
  return [...new Set(requested.filter((scope) => SUPPORTED_SCOPES.includes(scope)))];
}

function authorizeParams(params: URLSearchParams) {
  const responseType = params.get("response_type") || "";
  const clientId = params.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const state = params.get("state") || "";
  const codeChallenge = params.get("code_challenge") || "";
  const codeChallengeMethod = params.get("code_challenge_method") || "";
  const resource = params.get("resource") || "";
  const scopes = normalizeScopes(params.get("scope"));

  if (responseType !== "code") throw new Error("response_type debe ser code");
  if (!validChatGptClientId(clientId)) throw new Error("client_id de ChatGPT no reconocido");
  if (!validChatGptRedirect(redirectUri)) throw new Error("redirect_uri de ChatGPT no reconocido");
  if (codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    throw new Error("PKCE S256 es obligatorio");
  }
  if (resource !== RESOURCE_ID) throw new Error("resource OAuth inválido");
  if (!scopes.length) throw new Error("No se solicitaron scopes compatibles");

  return { clientId, redirectUri, state, codeChallenge, resource, scopes };
}

function oauthRedirect(redirectUri: string, values: Record<string, string>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

function consentPage(params: ReturnType<typeof authorizeParams>) {
  const scopes = params.scopes.map((scope) => `<li>${scope === READ_SCOPE ? "Leer el proyecto y la escena" : "Crear y modificar objetos"}</li>`).join("");
  const fields = [
    ["response_type", "code"],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["state", params.state],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", "S256"],
    ["resource", params.resource],
    ["scope", params.scopes.join(" ")],
  ].map(([name, value]) => `<input type="hidden" name="${name}" value="${htmlEscape(value)}">`).join("");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autorizar TinkerMatt</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#eef4f7;color:#20313a;margin:0;min-height:100vh;display:grid;place-items:center}.card{width:min(480px,calc(100vw - 32px));background:white;border:1px solid #d6e1e7;border-radius:18px;box-shadow:0 16px 50px #17303d20;padding:28px;box-sizing:border-box}h1{margin:0 0 8px;font-size:24px}.sub{color:#61727c;margin:0 0 20px}.app{font-weight:700;color:#078ac2}ul{line-height:1.8;padding-left:22px}.buttons{display:flex;gap:10px;margin-top:22px}.buttons button{flex:1;border-radius:10px;padding:11px 14px;font:inherit;font-weight:650;cursor:pointer}.deny{background:#fff;border:1px solid #c9d5db;color:#485961}.allow{background:#078ac2;border:1px solid #078ac2;color:#fff}.note{font-size:12px;color:#788891;line-height:1.4;margin-top:18px}
</style></head><body><main class="card"><h1>Autorizar TinkerMatt</h1><p class="sub"><span class="app">ChatGPT</span> solicita acceso a tu editor TinkerMatt.</p><p>Permisos solicitados:</p><ul>${scopes}</ul><form method="post" action="/oauth/authorize">${fields}<div class="buttons"><button class="deny" name="decision" value="deny">Cancelar</button><button class="allow" name="decision" value="allow">Autorizar</button></div></form><p class="note">Esta autorización es para la versión de desarrollo de TinkerMatt. La clave secreta de sesión sigue determinando qué pestaña puede controlarse.</p></main></body></html>`;
}

async function readForm(req: IncomingMessage) {
  return await new Promise<URLSearchParams>((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("Solicitud demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

function bearerToken(value: string | undefined) {
  if (!value) return "";
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] || "";
}

function validAccessToken(value: string | undefined) {
  cleanupOAuth();
  const token = bearerToken(value);
  if (!token) return null;
  const grant = accessTokens.get(token);
  if (!grant || grant.expiresAt <= Date.now() || grant.resource !== RESOURCE_ID) return null;
  return grant;
}

function oauthChallenge() {
  return `Bearer resource_metadata="${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource", scope="${SUPPORTED_SCOPES.join(" ")}"`;
}

function sendJson(res: Parameters<Parameters<typeof createServer>[0]>[1], status: number, value: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(json(value));
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "TinkerMatt MCP", version: "0.2.0", editors: sessions.size, oauth: true });
    return;
  }

  if (url.pathname === "/") {
    sendJson(res, 200, {
      name: "TinkerMatt MCP",
      version: "0.2.0",
      oauth: true,
      mcp: "/mcp?session=<secret-session-key>",
      editorWebSocket: "/editor?session=<secret-session-key>",
      connectedEditors: sessions.size,
    });
    return;
  }

  if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
    sendJson(res, 200, protectedResourceMetadata());
    return;
  }

  if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") {
    sendJson(res, 200, oauthMetadata());
    return;
  }

  if (url.pathname === "/oauth/authorize" && req.method === "GET") {
    try {
      const params = authorizeParams(url.searchParams);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(consentPage(params));
    } catch (error) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(`<h1>OAuth inválido</h1><p>${htmlEscape(error instanceof Error ? error.message : String(error))}</p>`);
    }
    return;
  }

  if (url.pathname === "/oauth/authorize" && req.method === "POST") {
    try {
      const form = await readForm(req);
      const params = authorizeParams(form);
      if (form.get("decision") !== "allow") {
        res.writeHead(302, { location: oauthRedirect(params.redirectUri, { error: "access_denied", error_description: "El usuario canceló la autorización.", state: params.state }), "cache-control": "no-store" });
        res.end();
        return;
      }
      const code = randomToken();
      authorizationCodes.set(code, {
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        resource: params.resource,
        scopes: params.scopes,
        expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
      });
      res.writeHead(302, { location: oauthRedirect(params.redirectUri, { code, state: params.state }), "cache-control": "no-store" });
      res.end();
    } catch (error) {
      sendJson(res, 400, { error: "invalid_request", error_description: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (url.pathname === "/oauth/token" && req.method === "POST") {
    try {
      cleanupOAuth();
      const form = await readForm(req);
      if (form.get("grant_type") !== "authorization_code") throw new Error("grant_type no soportado");
      const code = form.get("code") || "";
      const clientId = form.get("client_id") || "";
      const redirectUri = form.get("redirect_uri") || "";
      const verifier = form.get("code_verifier") || "";
      const resource = form.get("resource") || "";
      const record = authorizationCodes.get(code);
      if (!record || record.expiresAt <= Date.now()) throw new Error("Código de autorización inválido o vencido");
      authorizationCodes.delete(code);
      if (record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource || resource !== RESOURCE_ID) {
        throw new Error("El intercambio OAuth no coincide con la autorización original");
      }
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error("code_verifier PKCE inválido");
      const computed = createHash("sha256").update(verifier).digest("base64url");
      if (computed !== record.codeChallenge) throw new Error("Verificación PKCE fallida");

      const accessToken = randomToken();
      accessTokens.set(accessToken, {
        clientId,
        resource,
        scopes: record.scopes,
        expiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      });
      sendJson(res, 200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        scope: record.scopes.join(" "),
      });
    } catch (error) {
      sendJson(res, 400, { error: "invalid_grant", error_description: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (url.pathname === "/mcp") {
    const session = url.searchParams.get("session");
    if (!validSession(session)) {
      sendJson(res, 400, { error: "invalid_session", error_description: "Falta una clave de sesión TinkerMatt válida." });
      return;
    }
    const grant = validAccessToken(req.headers.authorization);
    if (!grant) {
      sendJson(res, 401, { error: "unauthorized", error_description: "OAuth requerido para usar TinkerMatt MCP." }, { "www-authenticate": oauthChallenge() });
      return;
    }
    await nodeMcpHandler(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
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
        socket.send(JSON.stringify({ type: "hello", ok: true, serverVersion: "0.2.0" }));
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
  console.log(`TinkerMatt MCP v0.2.0 listening on :${PORT}`);
});

process.on("SIGTERM", async () => {
  clearInterval(cleanupTimer);
  for (const [, session] of sessions) session.socket.close(1001, "Server shutdown");
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
});