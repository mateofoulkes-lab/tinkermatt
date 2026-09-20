import "./v083";
import "./v084-core";
import "./v084-extra";
import "./v084-batch";
import "./v084-guards";
import "./v084-lock-edit";
import "./v084-ui";

const version = document.querySelector<HTMLElement>(".version");
const applyVersion = () => { if (version) version.textContent = "v0.8.4"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.8.4 listo · MCP avanzado + renombrado desde jerarquía.";
