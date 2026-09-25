// TinkerMatt v0.8.9
// Hardcode the production MCP relay so users never have to type infrastructure URLs.

const VERSION = "0.8.9";
const MCP_EDITOR_WS = "wss://tinkermatt-mcp.onrender.com/editor";
const MCP_SERVER_STORAGE_KEY = "tinkermatt-mcp-editor-url";

const serverInput = document.querySelector<HTMLInputElement>(".tm-mcp-server");
const mcpSection = document.querySelector<HTMLElement>(".tm-mcp-settings");
const mcpTitle = mcpSection?.querySelector<HTMLElement>(".tm-mcp-title") ?? null;

if (serverInput) {
  // Keep the legacy bridge's existing connection logic intact, but make its
  // server value a product constant instead of a user-configurable setting.
  serverInput.value = MCP_EDITOR_WS;
  localStorage.setItem(MCP_SERVER_STORAGE_KEY, MCP_EDITOR_WS);

  // Reuse the old input listener once so the read-only client endpoint is
  // immediately regenerated from the hardcoded host and current session key.
  serverInput.dispatchEvent(new Event("input", { bubbles: true }));

  // The bridge keeps a direct reference to this node, so it is safe to remove
  // the visible field while connect/reconnect continue reading its fixed value.
  serverInput.closest("label")?.remove();
}

if (mcpTitle && !mcpTitle.querySelector(".tm-mcp-server-name")) {
  const serverName = document.createElement("small");
  serverName.className = "tm-mcp-server-name";
  serverName.textContent = "TinkerMatt MCP";
  serverName.title = MCP_EDITOR_WS;
  mcpTitle.insertBefore(serverName, mcpTitle.querySelector(".tm-mcp-state"));
}

const style = document.createElement("style");
style.textContent = `
.tm-mcp-title{gap:7px}.tm-mcp-server-name{margin-left:auto;color:#77858e;font-weight:500;white-space:nowrap}.tm-mcp-state{margin-left:2px}
`;
document.head.append(style);

window.__tmAppVersion = VERSION;
window.tinkerMatt ??= {};
window.tinkerMatt.version = VERSION;

const applyVersion = () => {
  document.querySelectorAll<HTMLElement>("[data-version], .version, .app-version").forEach((node) => {
    if (/^v?0\.8\./i.test(node.textContent?.trim() ?? "")) node.textContent = `v${VERSION}`;
  });
};
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);
