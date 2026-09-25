import { App } from "@modelcontextprotocol/ext-apps";

type Status = {
  connected?: boolean;
  appVersion?: string | null;
  projectName?: string | null;
  connectedAt?: string | null;
};

const statusPill = document.getElementById("statusPill")!;
const statusText = document.getElementById("statusText")!;
const project = document.getElementById("project")!;
const version = document.getElementById("version")!;
const editor = document.getElementById("editor")!;
const connectedAt = document.getElementById("connectedAt")!;
const refresh = document.getElementById("refresh") as HTMLButtonElement;
const scene = document.getElementById("scene") as HTMLButtonElement;
const message = document.getElementById("message")!;

const app = new App({ name: "TinkerMatt Dashboard", version: "0.1.0" });

function textFromResult(result: any) {
  return result?.content?.find((item: any) => item?.type === "text")?.text ?? "";
}

function parseStatus(result: any): Status | null {
  const text = textFromResult(result);
  if (!text) return null;
  try {
    return JSON.parse(text) as Status;
  } catch {
    return null;
  }
}

function renderStatus(data: Status | null) {
  const online = Boolean(data?.connected);
  statusPill.classList.toggle("online", online);
  statusPill.classList.toggle("offline", !online);
  statusText.textContent = online ? "Online" : "Offline";
  project.textContent = data?.projectName || "Sin proyecto";
  version.textContent = data?.appVersion || "—";
  editor.textContent = online ? "Conectado" : "No conectado";
  connectedAt.textContent = data?.connectedAt ? new Date(data.connectedAt).toLocaleString() : "—";
  scene.disabled = !online;
}

async function refreshStatus() {
  refresh.disabled = true;
  message.textContent = "Actualizando…";
  try {
    const result = await app.callServerTool({ name: "editor_status", arguments: {} });
    renderStatus(parseStatus(result));
    message.textContent = "Estado actualizado.";
  } catch (error) {
    renderStatus(null);
    message.textContent = error instanceof Error ? error.message : "No se pudo consultar el estado.";
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", refreshStatus);
scene.addEventListener("click", async () => {
  scene.disabled = true;
  message.textContent = "Leyendo escena…";
  try {
    const result = await app.callServerTool({ name: "get_project", arguments: {} });
    const text = textFromResult(result);
    message.textContent = text ? `Proyecto leído correctamente (${text.length} caracteres).` : "Proyecto leído.";
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "No se pudo leer el proyecto.";
  } finally {
    scene.disabled = false;
  }
});

app.ontoolresult = (result) => {
  const parsed = parseStatus(result);
  if (parsed) {
    renderStatus(parsed);
    message.textContent = parsed.connected ? "TinkerMatt está listo." : "Abrí TinkerMatt y conectá la sesión MCP.";
  }
};

app.connect();
