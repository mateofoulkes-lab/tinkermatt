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

function stampProjectButtonRoles(projectControls: HTMLElement) {
  if (projectControls.dataset.tmRolesStamped === "1") return;

  // v0.5.5 creates these nodes in the stable order:
  // projectName, OPEN, SAVE, CLEAR, fileInput.
  // Bind our layout roles to those exact original nodes once, before moving any.
  const clear = projectControls.querySelector<HTMLButtonElement>(".tm-project-button.tm-clear");
  const regular = [...projectControls.querySelectorAll<HTMLButtonElement>(".tm-project-button:not(.tm-clear)")];
  const open = regular[0] ?? null;
  const save = regular[1] ?? null;

  clear?.setAttribute("data-tm-project-role", "new");
  open?.setAttribute("data-tm-project-role", "open");
  save?.setAttribute("data-tm-project-role", "save");

  if (clear) {
    clear.title = "Nuevo / limpiar proyecto";
    clear.setAttribute("aria-label", "Nuevo / limpiar proyecto");
  }
  if (open) {
    open.title = "Abrir proyecto .tinkermatt";
    open.setAttribute("aria-label", "Abrir proyecto .tinkermatt");
  }
  if (save) {
    save.title = "Guardar proyecto .tinkermatt";
    save.setAttribute("aria-label", "Guardar proyecto .tinkermatt");
  }

  projectControls.dataset.tmRolesStamped = "1";
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

  if (projectControls) {
    projectControls.classList.remove("tm-object-toolbar-node");
    projectControls.classList.add("tm-v082-project-controls", "tm-v082-file-cluster");
    stampProjectButtonRoles(projectControls);

    const name = projectControls.querySelector<HTMLElement>(".tm-project-name");
    const fresh = projectControls.querySelector<HTMLButtonElement>('[data-tm-project-role="new"]');
    const open = projectControls.querySelector<HTMLButtonElement>('[data-tm-project-role="open"]');
    const save = projectControls.querySelector<HTMLButtonElement>('[data-tm-project-role="save"]');
    const fileInput = projectControls.querySelector<HTMLInputElement>('input[type="file"]');
    const autosave = projectControls.querySelector<HTMLElement>(".tm-autosave-badge");

    // Exact requested order. These are the ORIGINAL nodes, so their original
    // click listeners remain attached to the correct action.
    if (name) projectControls.append(name);
    if (fresh) projectControls.append(fresh);
    if (open) projectControls.append(open);
    if (save) projectControls.append(save);
    if (fileInput) projectControls.append(fileInput);
    if (autosave) projectControls.append(autosave);

    if (logo) logo.insertAdjacentElement("afterend", projectControls);
  }

  legacyDesignName?.classList.add("tm-v082-hidden");

  // The in-scene Tinker controls + keyboard shortcuts own transforms; the old
  // top-bar Select/Move/Rotate/Scale group is redundant in this layout.
  const transformGroup = toolbar.querySelector<HTMLElement>("#tool-select")?.closest<HTMLElement>(".tool-group") ?? null;
  if (transformGroup) {
    transformGroup.classList.add("tm-v082-hidden");
    markDividerAfter(transformGroup, "tm-v082-hidden");
  }

  const modeAnchor = spacer ?? macroControls;
  if (modeSwitch && modeAnchor) toolbar.insertBefore(modeSwitch, modeAnchor);
  if (editToolbar && modeAnchor) toolbar.insertBefore(editToolbar, modeAnchor);

  if (snapControls) {
    snapControls.classList.add("tm-v082-snap-floating");
    viewport.append(snapControls);
  }

  const record = toolbar.querySelector<HTMLButtonElement>("#record");
  const repeat = toolbar.querySelector<HTMLButtonElement>("#repeat");
  if (record) record.title = "Grabar / detener acciones";
  if (repeat) repeat.title = "Repetir acciones";

  for (const divider of toolbar.querySelectorAll<HTMLElement>(":scope > .toolbar-divider")) {
    const previous = divider.previousElementSibling as HTMLElement | null;
    const next = divider.nextElementSibling as HTMLElement | null;
    const previousGone = !previous || previous.classList.contains("tm-v082-hidden");
    const nextGone = !next || next.classList.contains("tm-v082-hidden");
    if (previousGone || nextGone) divider.classList.add("tm-v082-hidden");
  }
}

arrangeToolbar();
queueMicrotask(arrangeToolbar);
requestAnimationFrame(() => {
  arrangeToolbar();
  applyVersion();
});

if (status) status.textContent = "TinkerMatt v0.8.2 · interfaz superior simplificada.";
