import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import {
  booleanMeshes,
  createBox,
  createCylinder,
  createFromStl,
  createFromSvg,
  createSphere,
  createText,
  materialFor,
} from "./geometry";
import {
  clonePreservingIds,
  cloneWithFreshIds,
  getMeta,
  makeId,
  setMeta,
  snapshotTransform,
  type MaterialPreset,
  type RecordedAction,
  type ReferenceKind,
  type SolidMode,
  type TransformSnapshot,
} from "./model";

export type EditorEvents = {
  selection: (objects: THREE.Object3D[]) => void;
  status: (text: string) => void;
  recording: (active: boolean, count: number) => void;
  changed: () => void;
};

type EventKey = keyof EditorEvents;
type Axis = "x" | "y" | "z";
type TransformMode = "translate" | "rotate" | "scale";

type HistorySnapshot = {
  roots: THREE.Object3D[];
  selectionIds: string[];
};

export class TinkerEditor {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  readonly orbit: OrbitControls;
  readonly transform: TransformControls;

  private readonly viewport: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selectionHelpers = new THREE.Group();
  private readonly listeners = new Map<EventKey, Set<(...args: any[]) => void>>();
  private selection: THREE.Object3D[] = [];
  private clipboard: THREE.Object3D[] = [];
  private recording = false;
  private replaying = false;
  private macro: RecordedAction[] = [];
  private transformStart?: TransformSnapshot;
  private transformStarts = new Map<THREE.Object3D, TransformSnapshot>();
  private history: HistorySnapshot[] = [];
  private restoringHistory = false;
  private snapEnabled = true;
  private gridSize = 1;
  private modifiers = { shift: false, ctrl: false, alt: false };
  private axisConstraint: Axis | null = null;

  constructor(viewport: HTMLElement) {
    this.viewport = viewport;
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    viewport.prepend(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xf7f9fb);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera.position.set(150, -180, 135);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 15);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.target.set(0, 0, 10);
    this.orbit.minDistance = 20;
    this.orbit.maxDistance = 1200;

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.transform.setSpace("world");
    this.updateSnapSettings();
    this.scene.add(this.transform.getHelper());

    this.transform.addEventListener("dragging-changed", (event: any) => {
      this.orbit.enabled = !event.value;
    });
    this.transform.addEventListener("mouseDown", () => {
      const active = this.activeObject();
      if (!active) return;
      this.checkpoint();
      this.transformStart = snapshotTransform(active);
      this.transformStarts.clear();
      for (const object of this.selection) this.transformStarts.set(object, snapshotTransform(object));
    });
    this.transform.addEventListener("mouseUp", () => {
      this.finishTransformAction();
      this.transformStarts.clear();
    });
    this.transform.addEventListener("objectChange", () => {
      this.syncMultiSelectionTransform();
      this.refreshSelectionHelpers();
      this.emit("changed");
    });

    this.addLightsAndGrid();
    this.scene.add(this.selectionHelpers);

    this.renderer.domElement.addEventListener("pointerdown", (event) => this.pick(event));
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.animate();
  }

  on<K extends EventKey>(name: K, handler: EditorEvents[K]) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(handler as (...args: any[]) => void);
    return () => this.listeners.get(name)?.delete(handler as (...args: any[]) => void);
  }

  private emit<K extends EventKey>(name: K, ...args: Parameters<EditorEvents[K]>) {
    for (const listener of this.listeners.get(name) ?? []) listener(...args);
  }

  private addLightsAndGrid() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0xaab1b8, 2.1);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-120, -80, 220);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key);

    const grid = new THREE.GridHelper(400, 80, 0x78bddc, 0xd8edf5);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.64;
    this.scene.add(grid);

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0xf8fcfe, roughness: 1, metalness: 0, transparent: true, opacity: 0.88 }),
    );
    plane.receiveShadow = true;
    plane.position.z = -0.04;
    this.scene.add(plane);

    const axes = new THREE.AxesHelper(35);
    axes.position.set(-190, -190, 0.1);
    this.scene.add(axes);
  }

  private resize() {
    const width = Math.max(1, this.viewport.clientWidth);
    const height = Math.max(1, this.viewport.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };

  private entityRoot(object: THREE.Object3D | null): THREE.Object3D | null {
    let current = object;
    while (current && current !== this.scene) {
      if (getMeta(current)) return current;
      current = current.parent;
    }
    return null;
  }

  private pick(event: PointerEvent) {
    if ((this.transform as any).dragging || this.transform.axis) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const candidates: THREE.Object3D[] = [];
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.visible && this.entityRoot(object)) candidates.push(object);
    });
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    const root = hit ? this.entityRoot(hit.object) : null;
    if (!root) {
      if (!event.shiftKey) this.setSelection([]);
      return;
    }

    if (event.shiftKey) {
      if (this.selection.includes(root)) this.setSelection(this.selection.filter((item) => item !== root));
      else this.setSelection([...this.selection, root]);
    } else {
      this.setSelection([root]);
    }
  }

  setSelection(objects: THREE.Object3D[]) {
    this.selection = [...new Set(objects)].filter((object) => object.parent !== null && object.visible);
    const active = this.activeObject();
    if (active) this.transform.attach(active);
    else this.transform.detach();
    this.refreshSelectionHelpers();
    this.emit("selection", [...this.selection]);
  }

  selectById(id: string, additive = false) {
    const object = this.findById(id);
    if (!object) return;
    if (additive) {
      if (this.selection.includes(object)) this.setSelection(this.selection.filter((item) => item !== object));
      else this.setSelection([...this.selection, object]);
    } else this.setSelection([object]);
  }

  getSelection() {
    return [...this.selection];
  }

  activeObject() {
    return this.selection[this.selection.length - 1];
  }

  getSceneRoots() {
    return this.scene.children.filter((object) => Boolean(getMeta(object)));
  }

  findById(id: string) {
    let found: THREE.Object3D | undefined;
    for (const root of this.getSceneRoots()) {
      root.traverse((object) => {
        if (!found && getMeta(object)?.id === id) found = object;
      });
      if (found) break;
    }
    return found;
  }

  private refreshSelectionHelpers() {
    this.selectionHelpers.clear();
    for (const object of this.selection) {
      if (!object.visible) continue;
      const helper = new THREE.BoxHelper(object, 0x087bb5);
      helper.material.depthTest = false;
      helper.renderOrder = 1000;
      this.selectionHelpers.add(helper);
    }
  }

  private prepareObject(object: THREE.Object3D) {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return object;
  }

  private snapshotHistory(): HistorySnapshot {
    return {
      roots: this.getSceneRoots().map((object) => clonePreservingIds(object)),
      selectionIds: this.selection.map((object) => getMeta(object)?.id).filter((id): id is string => Boolean(id)),
    };
  }

  checkpoint() {
    if (this.restoringHistory) return;
    this.history.push(this.snapshotHistory());
    if (this.history.length > 60) this.history.shift();
  }

  undo() {
    const snapshot = this.history.pop();
    if (!snapshot) {
      this.emit("status", "No hay nada más para deshacer.");
      return;
    }
    this.restoringHistory = true;
    try {
      this.setSelection([]);
      for (const root of this.getSceneRoots()) root.removeFromParent();
      for (const saved of snapshot.roots) {
        const restored = clonePreservingIds(saved);
        this.prepareObject(restored);
        this.scene.add(restored);
      }
      const selection = snapshot.selectionIds.map((id) => this.findById(id)).filter((object): object is THREE.Object3D => Boolean(object));
      this.setSelection(selection);
      this.emit("changed");
      this.emit("status", "Deshacer.");
    } finally {
      this.restoringHistory = false;
    }
  }

  addObject(object: THREE.Object3D, select = true, history = true) {
    if (history) this.checkpoint();
    this.prepareObject(object);
    this.scene.add(object);
    if (select) this.setSelection([object]);
    this.emit("changed");
    return object;
  }

  addPrimitive(kind: "box" | "cylinder" | "sphere", mode: SolidMode = "solid") {
    const object = kind === "box" ? createBox() : kind === "cylinder" ? createCylinder() : createSphere();
    if (mode === "hole") this.applySolidMode(object, "hole");
    this.addObject(object);
    this.emit("status", `${getMeta(object)?.name} creado.`);
    return object;
  }

  async addText(text: string) {
    const mesh = await createText(text || "Texto");
    this.addObject(mesh);
    this.emit("status", "Texto extruido creado.");
    return mesh;
  }

  addSvg(svgText: string, name = "SVG") {
    const object = createFromSvg(svgText);
    const meta = getMeta(object)!;
    meta.name = name;
    setMeta(object, meta);
    this.addObject(object);
    this.emit("status", "SVG importado y extruido a 2 mm.");
    return object;
  }

  addStl(buffer: ArrayBuffer, name = "STL importado") {
    const mesh = createFromStl(buffer);
    const meta = getMeta(mesh)!;
    meta.name = name;
    setMeta(mesh, meta);
    this.addObject(mesh);
    this.emit("status", "STL importado.");
    return mesh;
  }

  setTransformMode(mode: TransformMode) {
    this.transform.setMode(mode);
    this.clearAxisConstraint();
    this.emit("status", mode === "translate" ? "Mover" : mode === "rotate" ? "Rotar" : "Escalar");
  }

  getTransformMode() {
    return this.transform.getMode() as TransformMode;
  }

  constrainAxis(axis: Axis | null) {
    this.axisConstraint = axis;
    this.transform.showX = !axis || axis === "x";
    this.transform.showY = !axis || axis === "y";
    this.transform.showZ = !axis || axis === "z";
    if (axis) this.emit("status", `${this.getTransformMode()} restringido a ${axis.toUpperCase()}. Esc para liberar.`);
  }

  clearAxisConstraint() {
    this.axisConstraint = null;
    this.transform.showX = true;
    this.transform.showY = true;
    this.transform.showZ = true;
  }

  setSnap(enabled: boolean, gridSize = this.gridSize) {
    this.snapEnabled = enabled;
    this.gridSize = Math.max(0.01, Number.isFinite(gridSize) ? gridSize : 1);
    this.updateSnapSettings();
    this.emit("status", enabled ? `Snap ${this.gridSize:g} mm`.replace(":g", "") : "Snap desactivado.");
  }

  getSnap() {
    return { enabled: this.snapEnabled, gridSize: this.gridSize };
  }

  setModifiers(modifiers: Partial<{ shift: boolean; ctrl: boolean; alt: boolean }>) {
    Object.assign(this.modifiers, modifiers);
    this.updateSnapSettings();
  }

  private updateSnapSettings() {
    const multiplier = this.modifiers.ctrl ? 10 : this.modifiers.shift ? 0.1 : 1;
    this.transform.setTranslationSnap(this.snapEnabled ? this.gridSize * multiplier : null);
    const rotationDegrees = this.modifiers.ctrl ? 15 : this.modifiers.shift ? 1 : 5;
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(rotationDegrees));
    this.transform.setScaleSnap(this.modifiers.ctrl ? 0.25 : this.modifiers.shift ? 0.01 : 0.05);
  }

  private syncMultiSelectionTransform() {
    const active = this.activeObject();
    const activeStart = active && this.transformStarts.get(active);
    if (!active || !activeStart || !this.transformStarts.size) return;
    const current = snapshotTransform(active);
    const mode = this.getTransformMode();

    if (mode === "scale" && this.modifiers.alt) {
      const axis = (this.transform.axis?.toLowerCase().match(/[xyz]/)?.[0] ?? this.axisConstraint ?? "x") as Axis;
      const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      const base = activeStart.scale[index] || 1;
      const ratio = current.scale[index] / base;
      active.scale.set(activeStart.scale[0] * ratio, activeStart.scale[1] * ratio, activeStart.scale[2] * ratio);
    }

    const activeNow = snapshotTransform(active);
    for (const object of this.selection) {
      if (object === active) continue;
      const before = this.transformStarts.get(object);
      if (!before) continue;
      if (mode === "translate") {
        object.position.set(
          before.position[0] + activeNow.position[0] - activeStart.position[0],
          before.position[1] + activeNow.position[1] - activeStart.position[1],
          before.position[2] + activeNow.position[2] - activeStart.position[2],
        );
      } else if (mode === "rotate") {
        object.rotation.set(
          before.rotation[0] + activeNow.rotation[0] - activeStart.rotation[0],
          before.rotation[1] + activeNow.rotation[1] - activeStart.rotation[1],
          before.rotation[2] + activeNow.rotation[2] - activeStart.rotation[2],
        );
      } else {
        const rx = activeStart.scale[0] ? activeNow.scale[0] / activeStart.scale[0] : 1;
        const ry = activeStart.scale[1] ? activeNow.scale[1] / activeStart.scale[1] : 1;
        const rz = activeStart.scale[2] ? activeNow.scale[2] / activeStart.scale[2] : 1;
        object.scale.set(before.scale[0] * rx, before.scale[1] * ry, before.scale[2] * rz);
      }
    }
  }

  duplicateSelected(record = true) {
    if (!this.selection.length) return [];
    this.checkpoint();
    const copies = this.selection.map((object) => {
      const copy = cloneWithFreshIds(object);
      this.prepareObject(copy);
      this.scene.add(copy);
      return copy;
    });
    this.setSelection(copies);
    if (record) this.recordAction({ type: "duplicate" });
    this.emit("status", `${copies.length} objeto(s) duplicado(s) en la misma posición.`);
    this.emit("changed");
    return copies;
  }

  copySelected() {
    this.clipboard = this.selection.map((object) => cloneWithFreshIds(object));
    this.emit("status", `${this.clipboard.length} objeto(s) copiado(s).`);
  }

  paste() {
    if (!this.clipboard.length) return;
    this.checkpoint();
    const pasted = this.clipboard.map((object) => cloneWithFreshIds(object));
    pasted.forEach((object) => this.addObject(object, false, false));
    this.setSelection(pasted);
    this.emit("status", "Pegado exactamente en la posición original.");
  }

  deleteSelected() {
    if (!this.selection.length) return;
    this.checkpoint();
    const doomed = [...this.selection];
    this.setSelection([]);
    doomed.forEach((object) => object.removeFromParent());
    this.emit("status", `${doomed.length} objeto(s) eliminado(s).`);
    this.emit("changed");
  }

  groupSelected() {
    if (this.selection.length < 2) return;
    this.checkpoint();
    const box = new THREE.Box3();
    this.selection.forEach((object) => box.expandByObject(object));
    const center = box.getCenter(new THREE.Vector3());
    const group = new THREE.Group();
    group.position.copy(center);
    setMeta(group, {
      id: makeId("group"),
      name: "Grupo",
      kind: "group",
      mode: "solid",
      material: getMeta(this.activeObject())?.material ?? "blue",
      references: [],
    });
    this.scene.add(group);
    for (const object of this.selection) group.attach(object);
    this.setSelection([group]);
    this.emit("status", "Objetos agrupados sin alterar su geometría.");
    this.emit("changed");
  }

  ungroupSelected() {
    const groups = this.selection.filter((object) => getMeta(object)?.kind === "group");
    if (!groups.length) return;
    this.checkpoint();
    const released: THREE.Object3D[] = [];
    for (const group of groups) {
      const children = [...group.children].filter((child) => Boolean(getMeta(child)));
      children.forEach((child) => {
        this.scene.attach(child);
        released.push(child);
      });
      group.removeFromParent();
    }
    this.setSelection(released);
    this.emit("status", "Grupo desarmado.");
    this.emit("changed");
  }

  private applySolidMode(object: THREE.Object3D, mode: SolidMode) {
    const meta = getMeta(object);
    if (!meta) return;
    meta.mode = mode;
    setMeta(object, meta);
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) child.material = materialFor(meta.material, meta.mode);
    });
  }

  setSolidMode(mode: SolidMode, record = true) {
    if (!this.selection.length) return;
    this.checkpoint();
    for (const object of this.selection) this.applySolidMode(object, mode);
    if (record) this.recordAction({ type: "toggleHole" });
    this.emit("status", mode === "hole" ? "Convertido en hueco." : "Convertido en sólido.");
    this.emit("changed");
  }

  toggleHole(record = true) {
    if (!this.selection.length) return;
    const targetMode: SolidMode = getMeta(this.activeObject())?.mode === "hole" ? "solid" : "hole";
    this.setSolidMode(targetMode, record);
  }

  applyBoolean(operation: "union" | "subtract" | "intersect") {
    const meshes = this.selection.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
    if (meshes.length !== this.selection.length || meshes.length < 2) {
      this.emit("status", "Para booleanas seleccioná dos o más sólidos simples (no grupos)." );
      return;
    }
    this.checkpoint();
    try {
      const result = booleanMeshes(meshes, operation);
      this.setSelection([]);
      meshes.forEach((mesh) => mesh.removeFromParent());
      this.addObject(result, true, false);
      this.emit("status", `Booleana ${operation} aplicada.`);
    } catch (error) {
      this.emit("status", error instanceof Error ? error.message : String(error));
    }
  }

  align(axis: Axis) {
    if (this.selection.length < 2) return;
    this.checkpoint();
    const bounds = this.selection.map((object) => new THREE.Box3().setFromObject(object));
    const target = bounds[0].getCenter(new THREE.Vector3())[axis];
    for (let i = 1; i < this.selection.length; i += 1) {
      const current = bounds[i].getCenter(new THREE.Vector3())[axis];
      this.selection[i].position[axis] += target - current;
    }
    this.refreshSelectionHelpers();
    this.emit("status", `Centros alineados en ${axis.toUpperCase()}.`);
    this.emit("changed");
  }

  setObjectName(name: string) {
    const object = this.activeObject();
    const meta = object && getMeta(object);
    if (!object || !meta) return;
    meta.name = name.trim() || meta.name;
    setMeta(object, meta);
    this.emit("selection", [...this.selection]);
    this.emit("changed");
  }

  renameById(id: string, name: string) {
    const object = this.findById(id);
    const meta = object && getMeta(object);
    if (!object || !meta || !name.trim()) return;
    this.checkpoint();
    meta.name = name.trim();
    setMeta(object, meta);
    this.emit("changed");
    this.emit("selection", [...this.selection]);
  }

  setVisibilityById(id: string, visible: boolean) {
    const object = this.findById(id);
    if (!object) return;
    this.checkpoint();
    object.visible = visible;
    if (!visible && this.selection.includes(object)) this.setSelection(this.selection.filter((item) => item !== object));
    this.emit("changed");
  }

  setMaterial(preset: MaterialPreset) {
    if (!this.selection.length) return;
    for (const object of this.selection) {
      const meta = getMeta(object);
      if (!meta) continue;
      meta.material = preset;
      setMeta(object, meta);
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = materialFor(preset, meta.mode);
      });
    }
    this.emit("changed");
  }

  setActivePosition(axis: Axis, value: number) {
    const object = this.activeObject();
    if (!object || !Number.isFinite(value)) return;
    object.position[axis] = value;
    this.refreshSelectionHelpers();
    this.emit("changed");
  }

  setActiveRotation(axis: Axis, degrees: number) {
    const object = this.activeObject();
    if (!object || !Number.isFinite(degrees)) return;
    object.rotation[axis] = THREE.MathUtils.degToRad(degrees);
    this.refreshSelectionHelpers();
    this.emit("changed");
  }

  setActiveDimension(axis: Axis, value: number) {
    const object = this.activeObject();
    if (!object || !Number.isFinite(value) || value <= 0) return;
    const current = this.boundsOf(object)[axis];
    if (current <= 0) return;
    object.scale[axis] *= value / current;
    this.refreshSelectionHelpers();
    this.emit("changed");
  }

  addReference(kind: ReferenceKind, name: string) {
    const object = this.activeObject();
    const meta = object && getMeta(object);
    if (!object || !meta || !name.trim()) return;
    this.checkpoint();
    meta.references.push({ id: makeId("ref"), kind, name: name.trim() });
    setMeta(object, meta);
    this.emit("selection", [...this.selection]);
  }

  removeReference(id: string) {
    const object = this.activeObject();
    const meta = object && getMeta(object);
    if (!object || !meta) return;
    this.checkpoint();
    meta.references = meta.references.filter((reference) => reference.id !== id);
    setMeta(object, meta);
    this.emit("selection", [...this.selection]);
  }

  boundsOf(object: THREE.Object3D) {
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    return { x: size.x, y: size.y, z: size.z };
  }

  startRecording() {
    this.recording = true;
    this.macro = [];
    this.emit("recording", true, 0);
    this.emit("status", "Grabando acciones…");
  }

  stopRecording() {
    this.recording = false;
    this.emit("recording", false, this.macro.length);
    this.emit("status", `Macro guardada: ${this.macro.length} acción(es).`);
  }

  toggleRecording() {
    if (this.recording) this.stopRecording();
    else this.startRecording();
  }

  getMacro() {
    return [...this.macro];
  }

  repeatMacro(times = 1) {
    if (!this.macro.length || !this.selection.length) {
      this.emit("status", "No hay macro grabada o no hay selección.");
      return;
    }
    this.checkpoint();
    this.replaying = true;
    try {
      for (let i = 0; i < Math.max(1, Math.min(100, times)); i += 1) {
        for (const action of this.macro) this.executeRecordedAction(action);
      }
      this.emit("status", `Macro repetida ${times} vez/veces.`);
    } finally {
      this.replaying = false;
      this.emit("changed");
    }
  }

  private executeRecordedAction(action: RecordedAction) {
    if (action.type === "duplicate") {
      const copies = this.selection.map((object) => {
        const copy = cloneWithFreshIds(object);
        this.prepareObject(copy);
        this.scene.add(copy);
        return copy;
      });
      this.setSelection(copies);
      return;
    }
    if (action.type === "toggleHole") {
      const targetMode: SolidMode = getMeta(this.activeObject())?.mode === "hole" ? "solid" : "hole";
      for (const object of this.selection) this.applySolidMode(object, targetMode);
      return;
    }
    for (const object of this.selection) {
      if (action.type === "translate") {
        object.position.x += action.delta[0];
        object.position.y += action.delta[1];
        object.position.z += action.delta[2];
      } else if (action.type === "rotate") {
        object.rotation.x += action.delta[0];
        object.rotation.y += action.delta[1];
        object.rotation.z += action.delta[2];
      } else if (action.type === "scale") {
        object.scale.x *= action.ratio[0];
        object.scale.y *= action.ratio[1];
        object.scale.z *= action.ratio[2];
      }
    }
    this.refreshSelectionHelpers();
  }

  private recordAction(action: RecordedAction) {
    if (!this.recording || this.replaying) return;
    this.macro.push(action);
    this.emit("recording", true, this.macro.length);
  }

  private finishTransformAction() {
    const active = this.activeObject();
    if (!active || !this.transformStart) return;
    const before = this.transformStart;
    const after = snapshotTransform(active);
    this.transformStart = undefined;

    const mode = this.getTransformMode();
    if (mode === "translate") {
      this.recordAction({
        type: "translate",
        delta: [after.position[0] - before.position[0], after.position[1] - before.position[1], after.position[2] - before.position[2]],
      });
    } else if (mode === "rotate") {
      this.recordAction({
        type: "rotate",
        delta: [after.rotation[0] - before.rotation[0], after.rotation[1] - before.rotation[1], after.rotation[2] - before.rotation[2]],
      });
    } else {
      this.recordAction({
        type: "scale",
        ratio: [
          before.scale[0] ? after.scale[0] / before.scale[0] : 1,
          before.scale[1] ? after.scale[1] / before.scale[1] : 1,
          before.scale[2] ? after.scale[2] / before.scale[2] : 1,
        ],
      });
    }
    this.emit("changed");
  }

  exportStl() {
    const selected = this.selection.length ? this.selection : this.getSceneRoots();
    if (!selected.length) {
      this.emit("status", "No hay geometría para exportar.");
      return;
    }
    const exportRoot = new THREE.Group();
    selected.forEach((object) => exportRoot.add(object.clone(true)));
    const data = new STLExporter().parse(exportRoot, { binary: true });
    const bytes = data instanceof DataView ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
    const blob = new Blob([bytes], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tinkermatt.stl";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.emit("status", "STL exportado. Los materiales visuales no forman parte del formato STL.");
  }

  snapshotSemanticScene() {
    const walk = (object: THREE.Object3D): unknown => {
      const meta = getMeta(object);
      if (!meta) return null;
      return {
        id: meta.id,
        name: meta.name,
        kind: meta.kind,
        mode: meta.mode,
        material: meta.material,
        visible: object.visible,
        params: meta.params ?? {},
        references: meta.references,
        transform: snapshotTransform(object),
        children: object.children.map(walk).filter(Boolean),
      };
    };
    return this.getSceneRoots().map(walk).filter(Boolean);
  }
}
