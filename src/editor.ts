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
  cloneWithFreshIds,
  getMeta,
  makeId,
  setMeta,
  snapshotTransform,
  type MaterialPreset,
  type RecordedAction,
  type ReferenceKind,
  type TransformSnapshot,
} from "./model";

export type EditorEvents = {
  selection: (objects: THREE.Object3D[]) => void;
  status: (text: string) => void;
  recording: (active: boolean, count: number) => void;
  changed: () => void;
};

type EventKey = keyof EditorEvents;

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

    this.scene.background = new THREE.Color(0xf4f7f9);
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
    this.transform.setTranslationSnap(1);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(1));
    this.scene.add(this.transform.getHelper());

    this.transform.addEventListener("dragging-changed", (event: any) => {
      this.orbit.enabled = !event.value;
    });
    this.transform.addEventListener("mouseDown", () => {
      const active = this.activeObject();
      if (active) this.transformStart = snapshotTransform(active);
    });
    this.transform.addEventListener("mouseUp", () => this.finishTransformAction());
    this.transform.addEventListener("objectChange", () => {
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

    const grid = new THREE.GridHelper(400, 40, 0x8aa0ae, 0xd4dce1);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.72;
    this.scene.add(grid);

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: 0.12 }),
    );
    plane.receiveShadow = true;
    plane.position.z = -0.02;
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
      if (object instanceof THREE.Mesh && this.entityRoot(object)) candidates.push(object);
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
    this.selection = [...new Set(objects)].filter((object) => object.parent !== null);
    const active = this.activeObject();
    if (active) this.transform.attach(active);
    else this.transform.detach();
    this.refreshSelectionHelpers();
    this.emit("selection", [...this.selection]);
  }

  getSelection() {
    return [...this.selection];
  }

  activeObject() {
    return this.selection[this.selection.length - 1];
  }

  private refreshSelectionHelpers() {
    this.selectionHelpers.clear();
    for (const object of this.selection) {
      const helper = new THREE.BoxHelper(object, 0x1d7dbe);
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

  addObject(object: THREE.Object3D, select = true) {
    this.prepareObject(object);
    this.scene.add(object);
    if (select) this.setSelection([object]);
    this.emit("changed");
    return object;
  }

  addPrimitive(kind: "box" | "cylinder" | "sphere") {
    const object = kind === "box" ? createBox() : kind === "cylinder" ? createCylinder() : createSphere();
    this.addObject(object);
    this.emit("status", `${getMeta(object)?.name} creada.`);
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

  setTransformMode(mode: "translate" | "rotate" | "scale") {
    this.transform.setMode(mode);
    this.emit("status", mode === "translate" ? "Mover" : mode === "rotate" ? "Rotar" : "Escalar");
  }

  duplicateSelected(record = true) {
    if (!this.selection.length) return [];
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
    const pasted = this.clipboard.map((object) => cloneWithFreshIds(object));
    pasted.forEach((object) => this.addObject(object, false));
    this.setSelection(pasted);
    this.emit("status", "Pegado exactamente en la posición original.");
  }

  deleteSelected() {
    const doomed = [...this.selection];
    this.setSelection([]);
    doomed.forEach((object) => object.removeFromParent());
    this.emit("status", `${doomed.length} objeto(s) eliminado(s).`);
    this.emit("changed");
  }

  groupSelected() {
    if (this.selection.length < 2) return;
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
      material: "blue",
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
    const released: THREE.Object3D[] = [];
    for (const group of groups) {
      const children = [...group.children];
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

  toggleHole(record = true) {
    for (const object of this.selection) {
      const meta = getMeta(object);
      if (!meta) continue;
      meta.mode = meta.mode === "solid" ? "hole" : "solid";
      setMeta(object, meta);
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = materialFor(meta.material, meta.mode);
      });
    }
    if (record) this.recordAction({ type: "toggleHole" });
    this.emit("status", "Modo sólido/hueco actualizado.");
    this.emit("changed");
  }

  applyBoolean(operation: "union" | "subtract" | "intersect") {
    const meshes = this.selection.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
    if (meshes.length !== this.selection.length || meshes.length < 2) {
      this.emit("status", "Para booleanas seleccioná dos o más sólidos simples (no grupos)." );
      return;
    }
    try {
      const result = booleanMeshes(meshes, operation);
      this.setSelection([]);
      meshes.forEach((mesh) => mesh.removeFromParent());
      this.addObject(result);
      this.emit("status", `Booleana ${operation} aplicada.`);
    } catch (error) {
      this.emit("status", error instanceof Error ? error.message : String(error));
    }
  }

  align(axis: "x" | "y" | "z") {
    if (this.selection.length < 2) return;
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
  }

  setMaterial(preset: MaterialPreset) {
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

  setActivePosition(axis: "x" | "y" | "z", value: number) {
    const object = this.activeObject();
    if (!object || !Number.isFinite(value)) return;
    object.position[axis] = value;
    this.refreshSelectionHelpers();
    this.emit("changed");
  }

  setActiveRotation(axis: "x" | "y" | "z", degrees: number) {
    const object = this.activeObject();
    if (!object || !Number.isFinite(degrees)) return;
    object.rotation[axis] = THREE.MathUtils.degToRad(degrees);
    this.refreshSelectionHelpers();
    this.emit("changed");
  }

  addReference(kind: ReferenceKind, name: string) {
    const object = this.activeObject();
    const meta = object && getMeta(object);
    if (!object || !meta || !name.trim()) return;
    meta.references.push({ id: makeId("ref"), kind, name: name.trim() });
    setMeta(object, meta);
    this.emit("selection", [...this.selection]);
  }

  removeReference(id: string) {
    const object = this.activeObject();
    const meta = object && getMeta(object);
    if (!object || !meta) return;
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
      this.duplicateSelected(false);
      return;
    }
    if (action.type === "toggleHole") {
      this.toggleHole(false);
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

    const mode = this.transform.getMode();
    if (mode === "translate") {
      this.recordAction({
        type: "translate",
        delta: [
          after.position[0] - before.position[0],
          after.position[1] - before.position[1],
          after.position[2] - before.position[2],
        ],
      });
    } else if (mode === "rotate") {
      this.recordAction({
        type: "rotate",
        delta: [
          after.rotation[0] - before.rotation[0],
          after.rotation[1] - before.rotation[1],
          after.rotation[2] - before.rotation[2],
        ],
      });
    } else if (mode === "scale") {
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
    const selected = this.selection.length ? this.selection : this.scene.children.filter((object) => getMeta(object));
    if (!selected.length) {
      this.emit("status", "No hay geometría para exportar.");
      return;
    }
    const exportRoot = new THREE.Group();
    selected.forEach((object) => exportRoot.add(object.clone(true)));
    const data = new STLExporter().parse(exportRoot, { binary: true }) as ArrayBuffer;
    const blob = new Blob([data], { type: "model/stl" });
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
        params: meta.params ?? {},
        references: meta.references,
        transform: snapshotTransform(object),
        children: object.children.map(walk).filter(Boolean),
      };
    };
    return this.scene.children.map(walk).filter(Boolean);
  }
}
