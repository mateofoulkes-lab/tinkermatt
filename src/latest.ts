// Atomic TinkerMatt bootstrap.
//
// Historical versions are compatibility layers, not separate applications. They
// are imported statically here so Vite can fetch/bundle them as one dependency
// graph and the browser does not visibly "walk" through every old UI revision.
// window.__tinkerEditor is assigned by the Vite bridge before this module loads.
import "./v064-pre";
import "./v04";
import "./v041";
import "./v042";
import "./v043";
import "./v044";
import "./v050";
import "./v051";
import "./v052";
import "./v053";
import "./v054";
import "./v055";
import "./v056";
import "./v057";
import "./v058";
import "./v059";
import "./v060";
import "./v061";
import "./v066-drag-pre";
import "./v063";
import "./v066-drag-post";
import "./v064";
import "./v065";
import "./v066";
import "./v067";

const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.7";

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.6.7 listo.";

// Reveal only after every compatibility layer has finished evaluating. This
// makes startup atomic: the first editor frame the user sees is the current UI.
document.documentElement.classList.remove("tm-booting");
document.getElementById("tm-atomic-boot-style")?.remove();
