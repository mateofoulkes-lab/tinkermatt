import type { TinkerEditor } from "./editor";

const VERSION = "0.8.8";
const editor = (window as any).__tinkerEditor as TinkerEditor | undefined;
if (!editor) throw new Error("TinkerMatt v0.8.8 no pudo acceder al editor.");

// Permanently retire the v0.4.3 Tinker controls. They were superseded by the
// camera-aware v0.4.4 controls, but the historical v0.4.3 RAF loop still owns a
// reference to this group and can mark it visible again while an object is being
// dragged. Those old rotation arcs scale from the object's world bounds, which
// is why they briefly reappeared as huge thick wedges during translation.
//
// Removing the group from the scene is not enough because v0.4.3 also raycasts
// its retained group reference directly. Clearing its children makes every old
// render/raycast path harmless while preserving the compatibility layer itself.
const legacyControls = editor.scene.getObjectByName("__tm_tinkercad_controls");
if (legacyControls) {
  legacyControls.visible = false;
  legacyControls.clear();
  legacyControls.removeFromParent();
  legacyControls.userData.tmRetired = true;
}

const currentControls = editor.scene.getObjectByName("__tm_tinkercad_controls_v044");
if (currentControls) currentControls.userData.tmCanonicalTinkerControls = true;

const anyWindow = window as any;
anyWindow.__tmAppVersion = VERSION;
anyWindow.tinkerMatt ??= {};
anyWindow.tinkerMatt.version = VERSION;
