import "./v070";
import "./v071.css";

// Blender monochrome UI icons, sourced from Blender's official icon set
// (release/datafiles/icons_svg), CC BY-SA 4.0. Kept inline so TinkerMatt has no
// runtime dependency on ui.blender.org or raw.githubusercontent.com.
type BlenderIconName =
  | "file_folder"
  | "file_tick"
  | "file_blank"
  | "editmode_hit"
  | "object_datamode"
  | "loop_back"
  | "loop_forward"
  | "duplicate"
  | "select_extend"
  | "select_intersect"
  | "mod_bevel"
  | "face_corner"
  | "edgesel"
  | "facesel";

const BLENDER_ICONS: Record<BlenderIconName, string> = {
  file_folder: `<svg viewBox="0 0 1600 1500"><g fill="currentColor"><g transform="matrix(100 0 0 100 -36200 -9400)"><path d="m363.5 95c-.27613.00003-.49997.22387-.5.5v3.5h14v-1.5c-.00003-.27613-.22387-.49997-.5-.5h-8.5v-1.5c-.00003-.27613-.22387-.49997-.5-.5z"/><path d="m363.5 100c-.27613.00003-.49997.22387-.5.5v7c.00003.27613.22387.49997.5.5h13c.27613-.00003.49997-.22387.5-.5v-7c-.00003-.27613-.22387-.49997-.5-.5z"/></g></g></svg>`,
  file_tick: `<svg viewBox="0 0 1600 1600"><g fill="currentColor"><path d="m30.26575 431.92903c-.27613.00003-.49997.22387-.5.5v13c.00003.27613.22387.49997.5.5h13c.27613-.00003.49997-.22387.5-.5v-9.99219c-.00003-.1326-.0527-.25975-.14648-.35351l-3-3.00782c-.0938-.0938-.22092-.14646-.35352-.14648zm.5 1h2v4.5c.00003.27613.22387.49997.5.5h6c.27613-.00003.49997-.22387.5-.5v-4.5h.29297l2.70703 2.71484v9.28516h-12zm6 0h2v4h-2z" fill-rule="evenodd" transform="matrix(100 0 0 100 -2876.575 -43092.903)"/></g></svg>`,
  file_blank: `<svg viewBox="0 0 1400 1600"><g fill="currentColor"><path d="m158.48048 492.99995c-.15153.004-.29304.0766-.38477.19727l-4.94922 4.94921c-.31479.315-.0918.85335.35352.85352h5c.27613-.00003.49997-.22387.5-.5v-4.5h5v12h-10v-6h-1v6.5c.00003.27613.22387.49997.5.5h11c.27613-.00003.49997-.22387.5-.5v-13c-.00003-.27613-.22387-.49997-.5-.5h-6c-.005-.00006-.009-.00006-.0137 0-.00067.00002-.001-.00002-.002 0-.001.00004-.003-.00005-.004 0z" fill-rule="evenodd" opacity=".6" transform="matrix(100 0 0 100 -15199.958 -49199.9928)"/></g></svg>`,
  editmode_hit: `<svg viewBox="0 0 1600 1600"><g fill="currentColor"><g transform="matrix(0 -100 -100 0 28600.00000000001 -60000)"><g transform="matrix(0 1 -1 0 -317 34)"><path d="m237.5 284c-.27613.00003-.49997.22387-.5.5v4c.00003.27613.22387.49997.5.5h4c.27613-.00003.49997-.22387.5-.5v-4c-.00003-.27613-.22387-.49997-.5-.5z"/></g><path d="m-614.5 272a.50005.50005 0 0 0 -.5.5v3a.50005.50005 0 0 0 .5.5h.50781v5h-.50781a.50005.50005 0 0 0 -.5.5v3a.50005.50005 0 0 0 .5.5h3a.50005.50005 0 0 0 .5-.5v-.5h5v.5a.50005.50005 0 0 0 .5.5h3a.50005.50005 0 0 0 .5-.5v-3a.50005.50005 0 0 0 -.5-.5h-.49219v-3.5a.50005.50005 0 1 0 -1 0v3.5h-1.50781a.50005.50005 0 0 0 -.5.5v1.5h-5v-1.5a.50005.50005 0 0 0 -.5-.5h-1.49219v-5h1.49219a.50005.50005 0 0 0 .5-.5v-1.5h3.5a.50005.50005 0 1 0 0-1h-3.5v-.5a.50005.50005 0 0 0 -.5-.5zm.5 1h2v2h-1.41406a.50005.50005 0 0 0 -.16016 0h-.42578zm0 9h2v2h-2zm9 0h2v2h-2z" opacity=".6"/></g></g></svg>`,
  object_datamode: `<svg viewBox="0 0 1600 1600"><g fill="currentColor"><g transform="matrix(100 0 0 100 -2600 -34600)"><path d="m27.5 347a.50005.50005 0 0 0 -.5.5v3.5h1v-3h3v-1zm9.5 0v1h3v3h1v-3.5a.50005.50005 0 0 0 -.5-.5zm-10 10v3.5a.50005.50005 0 0 0 .5.5h3.5v-1h-3v-3zm13 0v3h-3v1h3.5a.50005.50005 0 0 0 .5-.5v-3.5z" opacity=".6"/><path d="m30.5 350c-.276131.00003-.499972.22387-.5.5v7c.000028.27613.223869.49997.5.5h7c.276131-.00003.499972-.22387.5-.5v-7c-.000028-.27613-.223869-.49997-.5-.5z"/></g></g></svg>`,
  loop_back: `<svg viewBox="0 0 1400 1500"><g fill="currentColor"><path d="m283.51233 53.990463c-.12976.0036-.25303.05754-.34375.15039l-3.00563 3.005631c-.19518.195265-.19518.511767 0 .707032l3.00563 2.983534c.47126.490506 1.19754-.235768.70704-.707032l-2.15212-2.130018h5.28213c2.21506 0 4 1.784939 4 4s-1.78494 4-4 4h-1.5c-.67616-.0096-.67616 1.009563 0 1h1.5c2.7555 0 5-2.244499 5-5s-2.2445-5-5-5h-5.28213l2.15212-2.152115c.32527-.318007.0914-.869901-.36329-.857422z" transform="matrix(100 0 0 100 -27901.11 -5299.516)"/></g></svg>`,
  loop_forward: `<svg viewBox="0 0 1400 1500"><g fill="currentColor"><path d="m309.47936 53.98851c-.44941.000088-.6706.546838-.34766.859375l2.13002 2.152115h-5.26172c-2.7555 0-5 2.244499-5 5s2.2445 5 5 5h1.5c.67616.0096.67616-1.009563 0-1h-1.5c-2.21506 0-4-1.784939-4-4s1.78494-4 4-4h5.26172l-2.13002 2.130018c-.4905.471264.23578 1.197538.70704.707032l2.98353-2.983534c.19518-.195265.19518-.511767 0-.707032l-2.98353-3.005631c-.0942-.09737-.2239-.152345-.35938-.152343z" transform="matrix(100 0 0 100 -29998.433 -5299.429)"/></g></svg>`,
  duplicate: `<svg viewBox="0 0 1600 1600"><g fill="currentColor" transform="matrix(100 0 0 -100 46900.021 30200)"><path d="m-467.5 287c-.27613.00003-.49997.22387-.5.5v10c.00003.27613.22387.49997.5.5h2.5v-1h-2v-9h9v2h1v-2.5c-.00003-.27613-.22387-.49997-.5-.5z" opacity=".7"/><path d="m-463.50002 301c-.27613-.00003-.49997-.22387-.5-.5v-9c.00003-.27613.22387-.49997.5-.5h9c.27613.00003.49997.22387.5.5v4.5h-1v-4h-8v8h5v-2.5c.00003-.27613.22387-.49997.5-.5h2.5 1v.5c-.00002.1326-.0527.25972-.14648.35352l-3 3c-.0938.0938-.22092.14646-.35352.14648z"/></g></svg>`,
  select_extend: `<svg viewBox="0 0 1600 1600"><g fill="currentColor"><path d="m472.49609 325.98633c-.27689.00003-.50105.22506-.5.50195l.006 3.50586-3.49804.002c-.27613.00003-.49997.22387-.5.5v9c.00003.27613.22387.49997.5.5h9c.27613-.00003.49997-.22387.5-.5v-3.5h3.5c.27613-.00003.49997-.22387.5-.5v-9c-.00003-.27613-.22387-.49997-.5-.5z" transform="matrix(100 0 0 100 -46700.405 -32499.124)"/></g></svg>`,
  select_intersect: `<svg viewBox="0 0 1600 1600"><g fill="currentColor"><g transform="matrix(100 0 0 100 -51000.391 -32499.711)"><path d="m515.49805 329.98633c-.27766-.001-.50302.22429-.50196.50195l.008 5.00586c.00003.27613.22387.49997.5.5h5c.27613-.00003.49997-.22387.5-.5v-4.99805c-.00003-.27613-.22387-.49997-.5-.5z"/><path d="m515.00391 325.99609v.00391h-.00391v2h1v-1.00391h1.00391v-1zm4 0v1h2v-1zm3.99609.00391v1h1v1h1.00391v-2.00391zm1.00391 3.99609v2h1v-2zm-13 .002v2h1v-1h1v-1zm13 3.99804v1h-1v1h2v-2zm-13 .002v2h1v-2zm0 4v2h2v-1h-1v-1zm9 0v1h-1v1h2v-2zm-5 1v1h2v-1z"/></g></g></svg>`,
  mod_bevel: `<svg viewBox="0 0 1600 1600"><g fill="currentColor"><g transform="matrix(100 0 0 100 -19399.6 -28300.388)"><path d="m203.5 284a.50005.50005 0 0 0 -.35352.14648l-8 8a.50005.50005 0 0 0 -.14648.35352l-.008 5.00586a.50005.50005 0 0 0 .5.50195l13.008-.00781a.50005.50005 0 0 0 .5-.5v-13a.50005.50005 0 0 0 -.5-.5zm.20703 1h4.29297v12l-12.00781.008.008-4.30078z" fill-rule="evenodd"/><path d="m200.5 284-5.00781.008a.50005.50005 0 0 0 -.5.5v5a.50005.50005 0 1 0 1 0v-4.50195l4.50781-.00605a.50005.50005 0 1 0 0-1z" opacity=".5"/></g></g></svg>`,
  face_corner: `<svg viewBox="0 0 1600 1600"><g fill="currentColor"><g><path d="m52.49219 179.00781c-.1326.00004-.25976.0527-.35352.1465l-2.980087 2.96444c-.12064.11597-.14648.22852-.14648.35352v2.53315h1l.003-2.32915 2.684077-2.66846h8.29297v8.29298l-2.730276 2.69699-2.262334.003v1h2.466854c.11717 0 .23766-.0261.3457-.13867l3.033606-3.00033c.0938-.0938.14646-.22091.14649-.35352v-9c-.00003-.27612-.22387-.49996-.5-.5z" opacity=".6" transform="matrix(100 0 0 100 -4699.174 -17802.6913)"/><path d="m6.4818091 122.96135c-.1592654-.001-.516986.087-.4960937.48465l-.00781 6.03971c.0000276.27613.2238691.49997.5.5h6.0356916c.235331.002.481037-.17264.475555-.49925-.0029-.17416-.0016-1.65682.000316-1.94881.0029-.44725-.236518-.47226-.460246-.47182s-3.5227115-.004-3.5227115-.004-.00434-2.02425.00601-3.62304c.00284-.43846-.2571116-.47024-.5021009-.4681-.6989961.007-1.4515221-.005-2.0286105-.009z" transform="matrix(100 0 0 100 -497.836 -11496.6625)"/></g></g></svg>`,
  edgesel: `<svg viewBox="0 0 1500 1600"><g fill="currentColor"><g transform="matrix(0 -100 -100 0 19302.143 4198.242)"><path d="m27.486328 183.01367c-.276131.00003-.499972.22387-.5.5v2c.000028.27613.223869.49997.5.5h9c.276131-.00003.499972-.22387.5-.5v-2c-.000028-.27613-.223869-.49997-.5-.5z" fill-rule="evenodd"/><path d="m31.478516 179.02148c-.1326.00003-.259761.0527-.353516.14649l-1.992188 1.99219c-.490839.47125.235779 1.19787.707032.70703l1.845703-1.84571h8.292969v8.29297l-2.707032 2.70703h-8.292968l.0072-4.00727-1-.002-.0072 4.50727c-.0011.27689.223106.50192.5.50195h9c.132599-.00002.259759-.0527.353515-.14648l3-3c.09377-.0938.14646-.22092.146485-.35352v-9c-.000028-.27613-.223869-.49997-.5-.5z" opacity=".6"/></g></g></svg>`,
  facesel: `<svg viewBox="0 0 1600 1600"><g fill="currentColor"><g transform="matrix(100 0 0 100 -4699.6095 -17800.391)"><path d="m48.5 183c-.27613.00004-.49997.22388-.5.5v9c.00003.27614.22387.49997.5.5h9c.27613-.00003.49997-.22386.5-.5v-9c-.00003-.27612-.22387-.49996-.5-.5z" fill-rule="evenodd"/><path d="m52.49219 179.00781c-.1326.00004-.25976.0527-.35352.1465l-1.99219 1.99217c-.12064.11597-.14648.22852-.14648.35352v.5h1l.003-.296 1.69618-1.69619h8.29297v8.29298l-1.69667 1.69666-.29548.00255v1h.5c.11717 0 .23766-.0261.3457-.13867l2-2c.0938-.0938.14646-.22091.14649-.35352v-9c-.00003-.27612-.22387-.49996-.5-.5z" opacity=".6"/></g></g></svg>`,
};

function iconMarkup(name: BlenderIconName) {
  return BLENDER_ICONS[name].replace("<svg ", `<svg class="tm-blender-icon" aria-hidden="true" focusable="false" `);
}

function iconOnly(button: HTMLButtonElement | null, iconName: BlenderIconName, title?: string) {
  if (!button) return;
  button.innerHTML = iconMarkup(iconName);
  if (title) {
    button.title = title;
    button.setAttribute("aria-label", title);
  } else if (!button.getAttribute("aria-label") && button.title) {
    button.setAttribute("aria-label", button.title);
  }
  button.classList.add("tm-blender-icon-button");
}

function patchModeSwitch() {
  const toolbar = document.querySelector<HTMLElement>(".toolbar-shell");
  const logo = toolbar?.querySelector<HTMLElement>(".logo-wrap");
  const modeSwitch = toolbar?.querySelector<HTMLElement>(".tm-mode-switch");
  const editToolbar = toolbar?.querySelector<HTMLElement>(".tm-edit-toolbar");
  if (!toolbar || !logo || !modeSwitch) return;

  // TinkerMatt logo is always the first item, then the Object/Edit toggle.
  if (toolbar.firstElementChild !== logo) toolbar.prepend(logo);
  logo.insertAdjacentElement("afterend", modeSwitch);
  if (editToolbar) modeSwitch.insertAdjacentElement("afterend", editToolbar);

  const objectButton = modeSwitch.querySelector<HTMLButtonElement>("[data-tm-mode=object]");
  const editButton = modeSwitch.querySelector<HTMLButtonElement>("[data-tm-mode=edit]");
  if (objectButton) objectButton.innerHTML = `${iconMarkup("object_datamode")}<span>Objeto</span>`;
  if (editButton) editButton.innerHTML = `${iconMarkup("editmode_hit")}<span>Edición</span>`;
}

function patchProjectButtons() {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".tm-project-controls .tm-project-button")];
  const [openButton, saveButton, clearButton] = buttons;
  iconOnly(openButton ?? null, "file_folder", "Abrir proyecto .tinkermatt");
  iconOnly(saveButton ?? null, "file_tick", "Guardar proyecto .tinkermatt");
  iconOnly(clearButton ?? null, "file_blank", "Limpiar proyecto");
  clearButton?.classList.add("tm-clear-icon-only");
}

function patchObjectToolbar() {
  iconOnly(document.querySelector<HTMLButtonElement>("#undo"), "loop_back");
  iconOnly(document.querySelector<HTMLButtonElement>("#redo"), "loop_forward");
  iconOnly(document.querySelector<HTMLButtonElement>("#duplicate"), "duplicate");
  iconOnly(document.querySelector<HTMLButtonElement>("#bool-union"), "select_extend");
  iconOnly(document.querySelector<HTMLButtonElement>("#bool-intersect"), "select_intersect");

  // Solid/Hole lives in Properties now. Bevel belongs exclusively to Edit Mode.
  const hole = document.querySelector<HTMLElement>("#hole");
  if (hole) hole.style.display = "none";
  const objectBevel = document.querySelector<HTMLElement>(".tm-bevel-tool");
  if (objectBevel) objectBevel.style.display = "none";
}

function patchEditToolbar() {
  const editToolbar = document.querySelector<HTMLElement>(".tm-edit-toolbar");
  if (!editToolbar) return;

  iconOnly(editToolbar.querySelector<HTMLButtonElement>("[data-edit-select=vertex]"), "face_corner");
  iconOnly(editToolbar.querySelector<HTMLButtonElement>("[data-edit-select=edge]"), "edgesel");
  iconOnly(editToolbar.querySelector<HTMLButtonElement>("[data-edit-select=face]"), "facesel");
  iconOnly(editToolbar.querySelector<HTMLButtonElement>("[data-edit-bevel]"), "mod_bevel");

  // Reuse the exact same TinkerMatt move/rotate/scale artwork as Object Mode.
  const transformPairs: Array<[string, string]> = [
    ["translate", "#tool-move"],
    ["rotate", "#tool-rotate"],
    ["scale", "#tool-scale"],
  ];
  for (const [mode, sourceSelector] of transformPairs) {
    const source = document.querySelector<HTMLButtonElement>(sourceSelector);
    const target = editToolbar.querySelector<HTMLButtonElement>(`[data-edit-transform=${mode}]`);
    if (source && target) target.innerHTML = source.innerHTML;
  }
}

function patchAutosaveStatus() {
  const badge = document.querySelector<HTMLElement>(".tm-autosave-badge");
  const statusRight = document.querySelector<HTMLElement>(".status-right");
  if (!badge || !statusRight) return;

  if (badge.parentElement !== statusRight) statusRight.prepend(badge);
  const normalize = () => {
    const text = badge.textContent?.trim().toLowerCase();
    if (text === "guardado local") badge.textContent = "autoguardado local";
  };
  normalize();
  const observer = new MutationObserver(normalize);
  observer.observe(badge, { childList: true, characterData: true, subtree: true });
}

function patchToolbarCosmetics() {
  patchModeSwitch();
  patchProjectButtons();
  patchObjectToolbar();
  patchEditToolbar();
  patchAutosaveStatus();

  const version = document.querySelector<HTMLElement>(".version");
  if (version) version.textContent = "v0.7.1";
}

patchToolbarCosmetics();
queueMicrotask(patchToolbarCosmetics);
