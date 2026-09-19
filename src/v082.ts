import "./v081";
import "./v082.css";

const toolbar = document.querySelector<HTMLElement>(".toolbar-shell");
const viewport = document.querySelector<HTMLElement>("#viewport");
const version = document.querySelector<HTMLElement>(".version");
const status = document.querySelector<HTMLElement>("#status");

const applyVersion = () => { if (version) version.textContent = "v0.8.2"; };
applyVersion();
queueMicrotask(applyVersion);
requestAnimationFrame(applyVersion);

function markDividerAfter(element: Element | null, className: string) {
  if (!element) return;
  let next = element.nextElementSibling;
  while (next && next.classList.contains("hidden")) next = next.nextElementSibling;
  if (next?.classList.contains("toolbar-divider")) next.classList.add(className);
}

function arrangeToolbar() {
  if (!toolbar || !viewport) return;
  toolbar.classList.add("tm-toolbar-v082");

  const logo = toolbar.querySelector<HTMLElement>(":scope > .logo-wrap");
  const legacyDesignName = toolbar.querySelector<HTMLElement>(":scope > .design-name");
  const projectControls = toolbar.querySelector<HTMLElement>(":scope > .tm-project-controls");
  const modeSwitch = toolbar.querySelector<HTMLElement>(":scope > .tm-mode-switch");
  const editToolbar = toolbar.querySelector<HTMLElement>(":scope > .tm-edit-toolbar");
  const macroControls = toolbar.querySelector<HTMLElement>(":scope > .macro-controls");
  const spacer = toolbar.querySelector<HTMLElement>(":scope > .toolbar-spacer");
  const snapControls = toolbar.querySelector<HTMLElement>(":scope > .snap-controls");

  // v0.5.5 project controls already own all real listeners. Reorder those same
  // nodes rather than making cosmetic clones.
  if (projectControls) {
    projectControls.classList.remove("tm-object-toolbar-node");
    projectControls.classList.add("tm-v082-project-controls");

    const name = projectControls.querySelector<HTMLElement>(".tm-project-name");
    const buttons = [...projectControls.querySelectorAll<HTMLButtonElement>(".tm-project-button")];
    const fresh = buttons.find((button) => button.classList.contains("tm-clear") || /clear|borrar|nuevo/i.test(button.title));
    const open = buttons.find((button) => /abrir|open/i.test(button.title));
    const save = buttons.find((button) => /guardar|save/i.test(button.title));
    const fileInput = projectControls.querySelector<HTMLInputElement>('input[type="file"]');

    if (name) projectControls.append(name);
    if (fresh) {
      fresh.title = "Nuevo proyecto";
      fresh.setAttribute("aria-label", "Nuevo proyecto");
      projectControls.append(fresh);
    }
    if (open) projectControls.append(open);
    if (save) projectControls.append(save);
    if (fileInput) projectControls.append(fileInput);

    // Anything added later (for example the autosave indicator) remains intact.
    if (logo) logo.insertAdjacentElement("afterend", projectControls);
  }

  legacyDesignName?.classList.add("tm-v082-hidden");

  // The in-scene Tinker controls + keyboard shortcuts already own transforms;
  // the four old top-bar transform buttons are redundant in the cleaned UI.
  const transformGroup = toolbar.querySelector<HTMLElement>("#tool-select")?.closest<HTMLElement>(".tool-group") ?? null;
  if (transformGroup) {
    transformGroup.classList.add("tm-v082-hidden");
    markDividerAfter(transformGroup, "tm-v082-hidden");
  }

  // Put Object/Edit near the centre, immediately before the flexible spacer.
  // Edit-specific component controls continue to live directly beside it.
  const modeAnchor = spacer ?? macroControls;
  if (modeSwitch && modeAnchor) toolbar.insertBefore(modeSwitch, modeAnchor);
  if (editToolbar && modeAnchor) toolbar.insertBefore(editToolbar, modeAnchor);

  // Snap is a workspace setting, not a top-level command. Move the actual
  // controls (same inputs/listeners) beside the workplane badge.
  if (snapControls) {
    snapControls.classList.add("tm-v082-snap-floating");
    viewport.append(snapControls);
  }

  // Compact macro controls: behavior is unchanged; CSS hides only their labels.
  const record = toolbar.querySelector<HTMLButtonElement>("#record");
  const repeat = toolbar.querySelector<HTMLButtonElement>("#repeat");
  if (record) record.title = "Grabar / detener acciones";
  if (repeat) repeat.title = "Repetir acciones";

  // Remove separators left orphaned by controls that no longer occupy the bar.
  for (const divider of toolbar.querySelectorAll<HTMLElement>(":scope > .toolbar-divider")) {
    const previous = divider.previousElementSibling as HTMLElement | null;
    const next = divider.nextElementSibling as HTMLElement | null;
    const previousGone = !previous || previous.classList.contains("tm-v082-hidden");
    const nextGone = !next || next.classList.contains("tm-v082-hidden");
    if (previousGone || nextGone) divider.classList.add("tm-v082-hidden");
  }

  // File controls get their own subtle separator without requiring another DOM
  // node, which keeps the layout stable on narrow screens.
  projectControls?.classList.add("tm-v082-file-cluster");
}

arrangeToolbar();

// Historical layers can touch toolbar state from queued microtasks. Re-assert the
// final DOM order once after they settle; moving a node preserves all listeners.
queueMicrotask(arrangeToolbar);
requestAnimationFrame(() => {
  arrangeToolbar();
  applyVersion();
});

if (status) status.textContent = "TinkerMatt v0.8.2 · interfaz superior simplificada.";
