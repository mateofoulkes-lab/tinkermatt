import { getMeta, snapshotTransform, type RecordedAction, type TransformSnapshot } from "./model";
import type { TinkerEditor } from "./editor";

declare global {
  interface Window {
    __tinkerEditor: TinkerEditor;
  }
}

const editor = window.__tinkerEditor;
if (!editor) throw new Error("TinkerMatt v0.5.3 no pudo acceder al editor.");
const rawEditor = editor as any;

const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.3";

type Captured = {
  ids: string[];
  transforms: Map<string, TransformSnapshot>;
};

let pending: Captured | null = null;
const EPS = 1e-7;

function wrapAngle(value: number) {
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function captureSelection(): Captured | null {
  if (!rawEditor.recording || rawEditor.replaying) return null;

  // TransformControls already records its own delta in editor.ts. Do not
  // duplicate that native recording path when the legacy gizmo is active.
  if (editor.transform.axis) return null;

  const objects = editor.getSelection();
  if (!objects.length) return null;
  const ids: string[] = [];
  const transforms = new Map<string, TransformSnapshot>();
  for (const object of objects) {
    const id = getMeta(object)?.id;
    if (!id) return null;
    ids.push(id);
    transforms.set(id, snapshotTransform(object));
  }
  return { ids, transforms };
}

function near(a: number, b: number, tolerance = 1e-5) {
  return Math.abs(a - b) <= tolerance;
}

function sameTuple(a: [number, number, number], b: [number, number, number], tolerance = 1e-5) {
  return near(a[0], b[0], tolerance) && near(a[1], b[1], tolerance) && near(a[2], b[2], tolerance);
}

function flushPending() {
  const beforeCapture = pending;
  pending = null;
  if (!beforeCapture || !rawEditor.recording || rawEditor.replaying) return;

  const objects = editor.getSelection();
  if (objects.length !== beforeCapture.ids.length) return;
  const currentIds = objects.map((object) => getMeta(object)?.id ?? "");
  if (currentIds.some((id, index) => id !== beforeCapture.ids[index])) return;

  const deltas = objects.map((object) => {
    const id = getMeta(object)!.id;
    const before = beforeCapture.transforms.get(id)!;
    const after = snapshotTransform(object);
    const translate: [number, number, number] = [
      after.position[0] - before.position[0],
      after.position[1] - before.position[1],
      after.position[2] - before.position[2],
    ];
    const rotate: [number, number, number] = [
      wrapAngle(after.rotation[0] - before.rotation[0]),
      wrapAngle(after.rotation[1] - before.rotation[1]),
      wrapAngle(after.rotation[2] - before.rotation[2]),
    ];
    const scale: [number, number, number] = [
      Math.abs(before.scale[0]) > EPS ? after.scale[0] / before.scale[0] : 1,
      Math.abs(before.scale[1]) > EPS ? after.scale[1] / before.scale[1] : 1,
      Math.abs(before.scale[2]) > EPS ? after.scale[2] / before.scale[2] : 1,
    ];
    return { translate, rotate, scale };
  });

  const reference = deltas[deltas.length - 1];
  if (!reference) return;

  // Recorded actions are intentionally relative. Only emit a multi-selection
  // action when every selected object received the same relative transform.
  const sameTranslate = deltas.every((item) => sameTuple(item.translate, reference.translate));
  const sameRotate = deltas.every((item) => sameTuple(item.rotate, reference.rotate));
  const sameScale = deltas.every((item) => sameTuple(item.scale, reference.scale));

  const actions: RecordedAction[] = [];
  if (sameScale && reference.scale.some((value) => !near(value, 1))) {
    actions.push({ type: "scale", ratio: reference.scale });
  }
  if (sameRotate && reference.rotate.some((value) => Math.abs(value) > EPS)) {
    actions.push({ type: "rotate", delta: reference.rotate });
  }
  if (sameTranslate && reference.translate.some((value) => Math.abs(value) > EPS)) {
    actions.push({ type: "translate", delta: reference.translate });
  }

  for (const action of actions) rawEditor.recordAction(action);
}

// Every manipulation path in TinkerMatt starts an undo checkpoint. Hook that
// single chokepoint so widget drags, G/R/S, arrow nudges and inspector edits all
// enter the recorder consistently.
const originalCheckpoint = editor.checkpoint.bind(editor);
rawEditor.checkpoint = (...args: unknown[]) => {
  flushPending();
  const result = originalCheckpoint(...args);
  pending = captureSelection();
  return result;
};

// The last recorded gesture has no following checkpoint, so flush it before
// recording is stopped.
const originalStopRecording = editor.stopRecording.bind(editor);
rawEditor.stopRecording = () => {
  flushPending();
  return originalStopRecording();
};

// Also flush before playback in case the user presses Repetir while recording
// state was just ended by another UI path.
const originalRepeatMacro = editor.repeatMacro.bind(editor);
rawEditor.repeatMacro = (times = 1) => {
  flushPending();
  return originalRepeatMacro(times);
};

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.5.3 · macros relativas + chaflán plano con 1 paso.";