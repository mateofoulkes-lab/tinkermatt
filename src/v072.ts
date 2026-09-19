import "./v071-hotfix";
import "./v072.css";

// v0.7.2 keeps Edit Mode as direct mesh editing: the transform gizmo in v0.7.0
// is attached to the component pivot and writes only the selected raw vertices.
// This layer is intentionally UI-only so that behavior is not duplicated by a
// second transform implementation.
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.7.2";

const editPanel = document.querySelector<HTMLElement>(".tm-edit-side-panel");
editPanel?.setAttribute("aria-label", "Propiedades de edición de malla");

const semanticSave = editPanel?.querySelector<HTMLButtonElement>("[data-edit-semantic-save]");
if (semanticSave) {
  semanticSave.title = "Asignar nombre semántico a la selección actual";
  semanticSave.setAttribute("aria-label", semanticSave.title);
}

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.7.2 listo.";
