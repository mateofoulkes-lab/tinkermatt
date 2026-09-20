import "./v084";
import "./v085-mcp-shapes";

declare global {
  interface Window {
    __tmAppVersion?: string;
    tinkerMatt?: Record<string, any>;
  }
}

const VERSION = "0.8.5";
window.__tmAppVersion = VERSION;
window.tinkerMatt ??= {};
window.tinkerMatt.version = VERSION;
window.tinkerMatt.shapeToolsVersion = VERSION;

const versionNodes = document.querySelectorAll<HTMLElement>("[data-version], .version, .app-version");
for (const node of versionNodes) {
  if (/^v?0\.8\./i.test(node.textContent?.trim() ?? "")) node.textContent = `v${VERSION}`;
}
