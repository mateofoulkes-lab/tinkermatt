import * as THREE from "three";
import { getMeta } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
    tinkerMatt: Record<string, any>;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.7 no pudo acceder al editor.");
const rawEditor = editor as any;

// -----------------------------------------------------------------------------
// Small UI cleanup requested before MCP work.
// -----------------------------------------------------------------------------
document.querySelector<HTMLElement>(".design-name")?.remove();
const clearButton = document.querySelector<HTMLButtonElement>(".tm-clear");
if (clearButton) {
  const label = clearButton.querySelector("span");
  if (label) label.textContent = "Limpiar";
  clearButton.title = "Limpiar · borrar todos los objetos";
  clearButton.setAttribute("aria-label", "Limpiar proyecto");
}
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.7";

const projectNameInput = document.querySelector<HTMLInputElement>(".tm-project-name");
const status = document.querySelector<HTMLElement>("#status");
const setStatus = (text: string) => { if (status) status.textContent = text; };

function allObjects() {
  const objects: THREE.Object3D[] = [];
  for (const root of editor.getSceneRoots()) {
    root.traverse((object) => {
      if (getMeta(object)) objects.push(object);
    });
  }
  return objects;
}

function findObject(idOrName: string) {
  return editor.findById(idOrName) ?? allObjects().find((object) => getMeta(object)?.name === idOrName) ?? null;
}

function objectInfo(object: THREE.Object3D | null) {
  if (!object) return null;
  const meta = getMeta(object);
  if (!meta) return null;
  const size = editor.boundsOf(object);
  return {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    mode: meta.mode,
    material: meta.material,
    visible: object.visible,
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotationDegrees: {
      x: THREE.MathUtils.radToDeg(object.rotation.x),
      y: THREE.MathUtils.radToDeg(object.rotation.y),
      z: THREE.MathUtils.radToDeg(object.rotation.z),
    },
    size,
    references: structuredClone(meta.references ?? []),
    params: structuredClone(meta.params ?? {}),
  };
}

function emitChanged() {
  rawEditor.refreshSelectionHelpers?.();
  rawEditor.emit?.("changed");
  rawEditor.emit?.("selection", editor.getSelection());
}

function selectObject(idOrName: string, additive = false) {
  const object = findObject(idOrName);
  if (!object) throw new Error(`No existe el objeto “${idOrName}”.`);
  if (additive) editor.setSelection([...editor.getSelection(), object]);
  else editor.setSelection([object]);
  return objectInfo(object);
}

function createPrimitive(kind: "box" | "cylinder" | "sphere", args: any = {}) {
  const object = editor.addPrimitive(kind, args.mode === "hole" ? "hole" : "solid");
  const meta = getMeta(object)!;
  if (typeof args.name === "string" && args.name.trim()) {
    meta.name = args.name.trim();
    object.name = meta.name;
  }
  if (args.position) {
    object.position.set(
      Number(args.position.x ?? object.position.x),
      Number(args.position.y ?? object.position.y),
      Number(args.position.z ?? object.position.z),
    );
  }
  if (args.size) {
    if (Number(args.size.x) > 0) editor.setActiveDimension("x", Number(args.size.x));
    if (Number(args.size.y) > 0) editor.setActiveDimension("y", Number(args.size.y));
    if (Number(args.size.z) > 0) editor.setActiveDimension("z", Number(args.size.z));
  }
  emitChanged();
  return objectInfo(object);
}

const mcpApi = {
  getProject: () => ({
    name: projectNameInput?.value.trim() || "Diseño sin nombre",
    snap: editor.getSnap(),
    selection: editor.getSelection().map(objectInfo).filter(Boolean),
    objectCount: allObjects().length,
  }),
  getScene: () => editor.snapshotSemanticScene(),
  listObjects: () => allObjects().map(objectInfo).filter(Boolean),
  listReferences: () => {
    const fn = window.tinkerMatt.getSemanticReferences;
    return typeof fn === "function" ? fn() : allObjects().map((object) => ({
      objectId: getMeta(object)?.id,
      objectName: getMeta(object)?.name,
      references: structuredClone(getMeta(object)?.references ?? []),
    }));
  },
  createBox: (args?: any) => createPrimitive("box", args),
  createCylinder: (args?: any) => createPrimitive("cylinder", args),
  createSphere: (args?: any) => createPrimitive("sphere", args),
  selectObject,
  renameObject: (args: { object: string; name: string }) => {
    const object = findObject(args.object);
    if (!object) throw new Error(`No existe el objeto “${args.object}”.`);
    editor.checkpoint();
    const meta = getMeta(object)!;
    meta.name = args.name.trim() || meta.name;
    object.name = meta.name;
    emitChanged();
    return objectInfo(object);
  },
  moveObject: (args: { object: string; delta?: Partial<Record<"x" | "y" | "z", number>>; position?: Partial<Record<"x" | "y" | "z", number>> }) => {
    const object = findObject(args.object);
    if (!object) throw new Error(`No existe el objeto “${args.object}”.`);
    editor.checkpoint();
    if (args.position) {
      for (const axis of ["x", "y", "z"] as const) {
        const value = args.position[axis];
        if (Number.isFinite(value)) object.position[axis] = Number(value);
      }
    }
    if (args.delta) {
      for (const axis of ["x", "y", "z"] as const) {
        const value = args.delta[axis];
        if (Number.isFinite(value)) object.position[axis] += Number(value);
      }
    }
    emitChanged();
    return objectInfo(object);
  },
  rotateObject: (args: { object: string; deltaDegrees?: Partial<Record<"x" | "y" | "z", number>>; rotationDegrees?: Partial<Record<"x" | "y" | "z", number>> }) => {
    const object = findObject(args.object);
    if (!object) throw new Error(`No existe el objeto “${args.object}”.`);
    editor.checkpoint();
    if (args.rotationDegrees) {
      for (const axis of ["x", "y", "z"] as const) {
        const value = args.rotationDegrees[axis];
        if (Number.isFinite(value)) object.rotation[axis] = THREE.MathUtils.degToRad(Number(value));
      }
    }
    if (args.deltaDegrees) {
      for (const axis of ["x", "y", "z"] as const) {
        const value = args.deltaDegrees[axis];
        if (Number.isFinite(value)) object.rotation[axis] += THREE.MathUtils.degToRad(Number(value));
      }
    }
    emitChanged();
    return objectInfo(object);
  },
  setDimensions: (args: { object: string; x?: number; y?: number; z?: number }) => {
    selectObject(args.object);
    editor.checkpoint();
    if (Number(args.x) > 0) editor.setActiveDimension("x", Number(args.x));
    if (Number(args.y) > 0) editor.setActiveDimension("y", Number(args.y));
    if (Number(args.z) > 0) editor.setActiveDimension("z", Number(args.z));
    emitChanged();
    return objectInfo(editor.activeObject());
  },
  setSolidMode: (args: { object: string; mode: "solid" | "hole" }) => {
    selectObject(args.object);
    editor.setSolidMode(args.mode);
    return objectInfo(editor.activeObject());
  },
  unionObjects: (args: { objects: string[] }) => {
    const objects = args.objects.map(findObject).filter((object): object is THREE.Object3D => Boolean(object));
    if (objects.length !== args.objects.length) throw new Error("No se encontraron todos los objetos indicados.");
    editor.setSelection(objects);
    editor.applyBoolean("union");
    return objectInfo(editor.activeObject());
  },
  selectReference: (args: { referenceId: string }) => {
    const fn = window.tinkerMatt.selectSemanticReference;
    if (typeof fn !== "function") throw new Error("El selector de referencias todavía no está disponible.");
    return fn(args.referenceId);
  },
  undo: () => { editor.undo(); return true; },
  redo: () => {
    const fn = window.tinkerMatt.redo;
    if (typeof fn !== "function") throw new Error("Rehacer no está disponible.");
    fn();
    return true;
  },
};
Object.assign(window.tinkerMatt, mcpApi);

// -----------------------------------------------------------------------------
// Browser <-> MCP relay bridge. The session key is intentionally long and secret:
// possession of it grants control of the current editor session.
// -----------------------------------------------------------------------------
const settings = document.querySelector<HTMLElement>(".tm-settings-menu");
const sessionStorageKey = "tinkermatt-mcp-session";
const serverStorageKey = "tinkermatt-mcp-editor-url";

function randomSessionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let sessionKey = localStorage.getItem(sessionStorageKey) || randomSessionKey();
localStorage.setItem(sessionStorageKey, sessionKey);
let socket: WebSocket | null = null;
let reconnectTimer = 0;
let intentionalDisconnect = false;

const mcpSection = document.createElement("div");
mcpSection.className = "tm-mcp-settings";
mcpSection.innerHTML = `
  <div class="tm-mcp-title"><b>MCP</b><span class="tm-mcp-state">desconectado</span></div>
  <label>Servidor WebSocket
    <input class="tm-mcp-server" type="url" placeholder="wss://tu-servidor/editor" />
  </label>
  <label>Clave de sesión
    <div class="tm-mcp-copyrow"><input class="tm-mcp-session" readonly /><button type="button" class="tm-mcp-new">Nueva</button></div>
  </label>
  <label>Endpoint para el cliente MCP
    <div class="tm-mcp-copyrow"><input class="tm-mcp-endpoint" readonly /><button type="button" class="tm-mcp-copy">Copiar</button></div>
  </label>
  <button type="button" class="tm-mcp-connect">Conectar</button>
  <small class="tm-mcp-note">La clave funciona como contraseña de esta sesión. No la publiques.</small>
`;
settings?.append(mcpSection);

const style = document.createElement("style");
style.textContent = `
.tm-mcp-settings{border-top:1px solid #dce5eb;margin-top:10px;padding-top:10px;display:grid;gap:8px;font-size:12px}.tm-mcp-title{display:flex;justify-content:space-between;align-items:center;font-size:13px}.tm-mcp-state{color:#7a8790}.tm-mcp-state.connected{color:#17834b}.tm-mcp-settings label{display:grid;gap:4px;color:#52616b}.tm-mcp-settings input{width:100%;box-sizing:border-box;border:1px solid #cbd8e0;border-radius:7px;padding:6px 8px;background:#fff;color:#243640;font:inherit}.tm-mcp-copyrow{display:flex;gap:5px}.tm-mcp-copyrow button,.tm-mcp-connect{border:1px solid #b8cbd6;border-radius:7px;background:#fff;padding:5px 9px;cursor:pointer}.tm-mcp-connect{background:#078ac2;color:#fff;border-color:#078ac2}.tm-mcp-note{color:#77858e;line-height:1.3}
`;
document.head.append(style);

const serverInput = mcpSection.querySelector<HTMLInputElement>(".tm-mcp-server")!;
const sessionInput = mcpSection.querySelector<HTMLInputElement>(".tm-mcp-session")!;
const endpointInput = mcpSection.querySelector<HTMLInputElement>(".tm-mcp-endpoint")!;
const stateLabel = mcpSection.querySelector<HTMLElement>(".tm-mcp-state")!;
const connectButton = mcpSection.querySelector<HTMLButtonElement>(".tm-mcp-connect")!;
const copyButton = mcpSection.querySelector<HTMLButtonElement>(".tm-mcp-copy")!;
const newButton = mcpSection.querySelector<HTMLButtonElement>(".tm-mcp-new")!;

serverInput.value = localStorage.getItem(serverStorageKey) || "";
sessionInput.value = sessionKey;

function mcpEndpoint() {
  const value = serverInput.value.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
    url.pathname = "/mcp";
    url.search = "";
    url.searchParams.set("session", sessionKey);
    return url.toString();
  } catch {
    return "";
  }
}

function refreshMcpUi() {
  sessionInput.value = sessionKey;
  endpointInput.value = mcpEndpoint();
  const connected = socket?.readyState === WebSocket.OPEN;
  stateLabel.textContent = connected ? "conectado" : socket?.readyState === WebSocket.CONNECTING ? "conectando…" : "desconectado";
  stateLabel.classList.toggle("connected", Boolean(connected));
  connectButton.textContent = connected ? "Desconectar" : "Conectar";
}

function bridgeResult(id: string, ok: boolean, result?: unknown, error?: string) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "response", id, ok, result, error }));
}

async function executeBridgeMethod(method: string, args: any) {
  const fn = (mcpApi as Record<string, any>)[method] ?? window.tinkerMatt[method];
  if (typeof fn !== "function") throw new Error(`Comando MCP desconocido: ${method}`);
  return await fn(args ?? {});
}

function connectMcp() {
  const base = serverInput.value.trim();
  if (!base) {
    setStatus("Configurá primero la URL del servidor MCP en Opciones.");
    return;
  }
  intentionalDisconnect = false;
  localStorage.setItem(serverStorageKey, base);
  try {
    const url = new URL(base);
    url.searchParams.set("session", sessionKey);
    socket?.close();
    socket = new WebSocket(url);
  } catch (error) {
    setStatus(`URL MCP inválida: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  refreshMcpUi();
  socket.addEventListener("open", () => {
    socket?.send(JSON.stringify({
      type: "hello",
      role: "editor",
      session: sessionKey,
      appVersion: "0.5.7",
      projectName: projectNameInput?.value.trim() || "Diseño sin nombre",
    }));
    refreshMcpUi();
    setStatus("MCP conectado. La pestaña ya puede recibir herramientas remotas.");
  });
  socket.addEventListener("message", async (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message?.type !== "request" || typeof message.id !== "string" || typeof message.method !== "string") return;
      try {
        const result = await executeBridgeMethod(message.method, message.args);
        bridgeResult(message.id, true, result);
      } catch (error) {
        bridgeResult(message.id, false, undefined, error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      console.warn("TinkerMatt MCP message", error);
    }
  });
  socket.addEventListener("close", () => {
    refreshMcpUi();
    if (!intentionalDisconnect && serverInput.value.trim()) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connectMcp, 2500);
    }
  });
  socket.addEventListener("error", () => refreshMcpUi());
}

connectButton.addEventListener("click", () => {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    intentionalDisconnect = true;
    window.clearTimeout(reconnectTimer);
    socket.close();
    socket = null;
    refreshMcpUi();
  } else connectMcp();
});
serverInput.addEventListener("input", () => {
  localStorage.setItem(serverStorageKey, serverInput.value.trim());
  refreshMcpUi();
});
copyButton.addEventListener("click", async () => {
  if (!endpointInput.value) return;
  await navigator.clipboard.writeText(endpointInput.value);
  setStatus("Endpoint MCP copiado.");
});
newButton.addEventListener("click", () => {
  intentionalDisconnect = true;
  socket?.close();
  socket = null;
  sessionKey = randomSessionKey();
  localStorage.setItem(sessionStorageKey, sessionKey);
  intentionalDisconnect = false;
  refreshMcpUi();
  setStatus("Nueva clave MCP generada. La anterior dejó de identificar esta pestaña.");
});
refreshMcpUi();

setStatus("TinkerMatt v0.5.7 · título limpio + base MCP preparada.");
