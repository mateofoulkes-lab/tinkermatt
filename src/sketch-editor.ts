import type { SketchData, SketchOperation, SketchPoint } from "./v050-geometry";

export type SketchEditorResult = {
  data: SketchData;
  operation: SketchOperation;
};

type DragState =
  | { type: "anchor"; index: number; startX: number; startY: number; point: SketchPoint }
  | { type: "in" | "out"; index: number }
  | { type: "placing"; index: number };

const SVG_NS = "http://www.w3.org/2000/svg";

const emptySketch = (): SketchData => ({
  points: [],
  closed: false,
  referenceOpacity: 0.38,
});

function cloneData(data: SketchData) {
  return structuredClone(data);
}

function defaultOperation(mode: "extrude" | "revolve" = "extrude"): SketchOperation {
  return mode === "extrude"
    ? { mode: "extrude", depth: 10 }
    : { mode: "revolve", angle: 360, segments: 64 };
}

function makePoint(x: number, y: number): SketchPoint {
  return { x, y, inX: x, inY: y, outX: x, outY: y };
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

class SketchEditor {
  private readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly path: SVGPathElement;
  private readonly handles: SVGGElement;
  private readonly reference: SVGImageElement;
  private readonly status: HTMLElement;
  private readonly closeProfile: HTMLButtonElement;
  private readonly operationSelect: HTMLSelectElement;
  private readonly depthInput: HTMLInputElement;
  private readonly angleInput: HTMLInputElement;
  private readonly segmentsInput: HTMLInputElement;
  private readonly extrudeFields: HTMLElement;
  private readonly revolveFields: HTMLElement;
  private readonly refOpacity: HTMLInputElement;
  private readonly refName: HTMLElement;
  private readonly refInput: HTMLInputElement;

  private data = emptySketch();
  private operation: SketchOperation = defaultOperation();
  private drag: DragState | null = null;
  private selectedIndex = -1;
  private history: SketchData[] = [];
  private resolve: ((value: SketchEditorResult | null) => void) | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "tm-sketch-modal hidden";
    this.root.innerHTML = `
      <div class="tm-sketch-shell" role="dialog" aria-modal="true" aria-label="Sketch">
        <header class="tm-sketch-header">
          <div class="tm-sketch-title"><b>Sketch</b><span>Plano XY · unidades en mm</span></div>
          <div class="tm-sketch-header-actions">
            <button type="button" data-action="reference">Imagen de referencia</button>
            <label class="tm-sketch-opacity">Opacidad <input type="range" min="0" max="1" step="0.05" value="0.38" /></label>
            <span class="tm-sketch-ref-name"></span>
            <input class="tm-sketch-ref-input" type="file" accept="image/*" hidden />
          </div>
        </header>
        <main class="tm-sketch-stage-wrap">
          <svg class="tm-sketch-stage" viewBox="-200 -150 400 300" preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id="tmSketchMinor" width="5" height="5" patternUnits="userSpaceOnUse">
                <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#dceff6" stroke-width="0.35" />
              </pattern>
              <pattern id="tmSketchMajor" width="25" height="25" patternUnits="userSpaceOnUse">
                <rect width="25" height="25" fill="url(#tmSketchMinor)" />
                <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#a9d8e9" stroke-width="0.6" />
              </pattern>
            </defs>
            <rect class="tm-sketch-hit-area" x="-200" y="-150" width="400" height="300" fill="url(#tmSketchMajor)" />
            <image class="tm-sketch-reference-image" x="-200" y="-150" width="400" height="300" preserveAspectRatio="xMidYMid meet" opacity="0.38" pointer-events="none" />
            <line x1="-200" y1="0" x2="200" y2="0" class="tm-sketch-axis tm-sketch-axis-x" />
            <line x1="0" y1="-150" x2="0" y2="150" class="tm-sketch-axis tm-sketch-axis-y" />
            <text x="4" y="-136" class="tm-sketch-axis-label">EJE REVOLVE</text>
            <path class="tm-sketch-path" />
            <g class="tm-sketch-handles"></g>
          </svg>
          <div class="tm-sketch-help">Click: punto · click y arrastrar: tangente Bézier · arrastrá puntos o manejadores para editar · Supr elimina el punto seleccionado</div>
        </main>
        <footer class="tm-sketch-footer">
          <div class="tm-sketch-edit-tools">
            <button type="button" data-action="close-profile">Cerrar perfil</button>
            <button type="button" data-action="delete-point">Eliminar punto</button>
            <button type="button" data-action="undo">Deshacer</button>
            <button type="button" data-action="clear">Limpiar</button>
          </div>
          <div class="tm-sketch-operation">
            <label>Operación
              <select class="tm-sketch-operation-select">
                <option value="extrude">Extrude</option>
                <option value="revolve">Revolve</option>
              </select>
            </label>
            <label class="tm-sketch-extrude-fields">Profundidad <input class="tm-sketch-depth" type="number" min="0.01" step="0.5" value="10" /> mm</label>
            <span class="tm-sketch-revolve-fields hidden">
              <label>Ángulo <input class="tm-sketch-angle" type="number" min="1" max="360" step="1" value="360" />°</label>
              <label>Pasos <input class="tm-sketch-segments" type="number" min="8" max="128" step="1" value="64" /></label>
            </span>
          </div>
          <div class="tm-sketch-confirm">
            <span class="tm-sketch-status"></span>
            <button type="button" data-action="cancel">Cancelar</button>
            <button type="button" class="primary" data-action="accept">Crear sólido</button>
          </div>
        </footer>
      </div>
    `;
    document.body.append(this.root);

    this.svg = this.root.querySelector<SVGSVGElement>(".tm-sketch-stage")!;
    this.path = this.root.querySelector<SVGPathElement>(".tm-sketch-path")!;
    this.handles = this.root.querySelector<SVGGElement>(".tm-sketch-handles")!;
    this.reference = this.root.querySelector<SVGImageElement>(".tm-sketch-reference-image")!;
    this.status = this.root.querySelector<HTMLElement>(".tm-sketch-status")!;
    this.closeProfile = this.root.querySelector<HTMLButtonElement>('[data-action="close-profile"]')!;
    this.operationSelect = this.root.querySelector<HTMLSelectElement>(".tm-sketch-operation-select")!;
    this.depthInput = this.root.querySelector<HTMLInputElement>(".tm-sketch-depth")!;
    this.angleInput = this.root.querySelector<HTMLInputElement>(".tm-sketch-angle")!;
    this.segmentsInput = this.root.querySelector<HTMLInputElement>(".tm-sketch-segments")!;
    this.extrudeFields = this.root.querySelector<HTMLElement>(".tm-sketch-extrude-fields")!;
    this.revolveFields = this.root.querySelector<HTMLElement>(".tm-sketch-revolve-fields")!;
    this.refOpacity = this.root.querySelector<HTMLInputElement>(".tm-sketch-opacity input")!;
    this.refName = this.root.querySelector<HTMLElement>(".tm-sketch-ref-name")!;
    this.refInput = this.root.querySelector<HTMLInputElement>(".tm-sketch-ref-input")!;

    this.bind();
  }

  private bind() {
    this.root.querySelector<HTMLButtonElement>('[data-action="reference"]')!.addEventListener("click", () => this.refInput.click());
    this.refInput.addEventListener("change", () => void this.loadReference());
    this.refOpacity.addEventListener("input", () => {
      this.data.referenceOpacity = Number(this.refOpacity.value);
      this.reference.setAttribute("opacity", this.refOpacity.value);
    });

    this.root.querySelector<HTMLButtonElement>('[data-action="close-profile"]')!.addEventListener("click", () => {
      if (this.data.points.length < 3) return this.setStatus("Necesitás al menos 3 puntos.");
      this.checkpoint();
      this.data.closed = !this.data.closed;
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="delete-point"]')!.addEventListener("click", () => this.deleteSelected());
    this.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.addEventListener("click", () => this.undo());
    this.root.querySelector<HTMLButtonElement>('[data-action="clear"]')!.addEventListener("click", () => {
      this.checkpoint();
      this.data.points = [];
      this.data.closed = false;
      this.selectedIndex = -1;
      this.render();
    });

    this.operationSelect.addEventListener("change", () => {
      const mode = this.operationSelect.value as "extrude" | "revolve";
      this.operation = mode === "extrude"
        ? { mode, depth: Math.max(0.01, Number(this.depthInput.value) || 10) }
        : { mode, angle: Math.max(1, Math.min(360, Number(this.angleInput.value) || 360)), segments: Math.max(8, Number(this.segmentsInput.value) || 64) };
      this.refreshOperationUi();
    });

    this.root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.addEventListener("click", () => this.finish(null));
    this.root.querySelector<HTMLButtonElement>('[data-action="accept"]')!.addEventListener("click", () => this.accept());

    this.svg.addEventListener("pointerdown", (event) => this.pointerDown(event));
    window.addEventListener("pointermove", (event) => this.pointerMove(event));
    window.addEventListener("pointerup", () => { this.drag = null; });
    window.addEventListener("keydown", (event) => {
      if (this.root.classList.contains("hidden")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undo();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if ((event.target as HTMLElement)?.matches("input, textarea")) return;
        event.preventDefault();
        this.deleteSelected();
      } else if (event.key === "Escape") {
        this.finish(null);
      }
    });
  }

  open(initial?: SketchData, operation?: SketchOperation) {
    if (this.resolve) this.finish(null);
    this.data = cloneData(initial ?? emptySketch());
    this.operation = structuredClone(operation ?? defaultOperation());
    this.history = [];
    this.drag = null;
    this.selectedIndex = -1;
    this.root.classList.remove("hidden");
    this.refOpacity.value = String(this.data.referenceOpacity ?? 0.38);
    this.operationSelect.value = this.operation.mode;
    if (this.operation.mode === "extrude") this.depthInput.value = String(this.operation.depth);
    else {
      this.angleInput.value = String(this.operation.angle);
      this.segmentsInput.value = String(this.operation.segments);
    }
    this.refreshOperationUi();
    this.render();
    return new Promise<SketchEditorResult | null>((resolve) => { this.resolve = resolve; });
  }

  private finish(value: SketchEditorResult | null) {
    if (!this.resolve) return;
    const resolve = this.resolve;
    this.resolve = null;
    this.root.classList.add("hidden");
    resolve(value);
  }

  private accept() {
    if (!this.data.closed || this.data.points.length < 3) {
      this.setStatus("Cerrá un perfil de al menos 3 puntos antes de crear el sólido.");
      return;
    }
    const mode = this.operationSelect.value as "extrude" | "revolve";
    const operation: SketchOperation = mode === "extrude"
      ? { mode, depth: Math.max(0.01, Number(this.depthInput.value) || 10) }
      : {
          mode,
          angle: Math.max(1, Math.min(360, Number(this.angleInput.value) || 360)),
          segments: Math.max(8, Math.min(128, Math.round(Number(this.segmentsInput.value) || 64))),
        };
    this.finish({ data: cloneData(this.data), operation });
  }

  private refreshOperationUi() {
    const revolve = this.operationSelect.value === "revolve";
    this.extrudeFields.classList.toggle("hidden", revolve);
    this.revolveFields.classList.toggle("hidden", !revolve);
    this.setStatus(revolve ? "El eje vertical azul (X=0) es el eje de revolución." : "El perfil se extruye perpendicular al plano.");
  }

  private checkpoint() {
    this.history.push(cloneData(this.data));
    if (this.history.length > 50) this.history.shift();
  }

  private undo() {
    const previous = this.history.pop();
    if (!previous) return this.setStatus("No hay más cambios para deshacer.");
    this.data = previous;
    this.selectedIndex = -1;
    this.render();
  }

  private deleteSelected() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.data.points.length) return;
    this.checkpoint();
    this.data.points.splice(this.selectedIndex, 1);
    if (this.data.points.length < 3) this.data.closed = false;
    this.selectedIndex = Math.min(this.selectedIndex, this.data.points.length - 1);
    this.render();
  }

  private async loadReference() {
    const file = this.refInput.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    this.data.referenceDataUrl = dataUrl;
    this.data.referenceName = file.name;
    this.refInput.value = "";
    this.renderReference();
  }

  private toSvg(clientX: number, clientY: number) {
    const point = this.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = this.svg.getScreenCTM()?.inverse();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  }

  private pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    const role = target.getAttribute("data-role");
    const index = Number(target.getAttribute("data-index"));
    const pos = this.toSvg(event.clientX, event.clientY);

    if (role === "anchor" && Number.isInteger(index)) {
      event.preventDefault();
      this.checkpoint();
      this.selectedIndex = index;
      this.drag = { type: "anchor", index, startX: pos.x, startY: pos.y, point: structuredClone(this.data.points[index]) };
      this.render();
      return;
    }
    if ((role === "in" || role === "out") && Number.isInteger(index)) {
      event.preventDefault();
      this.checkpoint();
      this.selectedIndex = index;
      this.drag = { type: role, index };
      this.render();
      return;
    }
    if (!target.classList.contains("tm-sketch-hit-area") || this.data.closed) return;

    this.checkpoint();
    const point = makePoint(pos.x, pos.y);
    this.data.points.push(point);
    this.selectedIndex = this.data.points.length - 1;
    this.drag = { type: "placing", index: this.selectedIndex };
    this.render();
  }

  private pointerMove(event: PointerEvent) {
    if (!this.drag || this.root.classList.contains("hidden")) return;
    const pos = this.toSvg(event.clientX, event.clientY);
    const point = this.data.points[this.drag.index];
    if (!point) return;

    if (this.drag.type === "anchor") {
      const dx = pos.x - this.drag.startX;
      const dy = pos.y - this.drag.startY;
      const base = this.drag.point;
      Object.assign(point, {
        x: base.x + dx,
        y: base.y + dy,
        inX: base.inX + dx,
        inY: base.inY + dy,
        outX: base.outX + dx,
        outY: base.outY + dy,
      });
    } else if (this.drag.type === "placing") {
      const dx = pos.x - point.x;
      const dy = pos.y - point.y;
      point.outX = pos.x;
      point.outY = pos.y;
      point.inX = point.x - dx;
      point.inY = point.y - dy;
    } else if (this.drag.type === "in") {
      point.inX = pos.x;
      point.inY = pos.y;
      if (!event.altKey) {
        point.outX = point.x * 2 - pos.x;
        point.outY = point.y * 2 - pos.y;
      }
    } else {
      point.outX = pos.x;
      point.outY = pos.y;
      if (!event.altKey) {
        point.inX = point.x * 2 - pos.x;
        point.inY = point.y * 2 - pos.y;
      }
    }
    this.render(false);
  }

  private pathD() {
    const points = this.data.points;
    if (!points.length) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    const segmentCount = this.data.closed ? points.length : points.length - 1;
    for (let i = 0; i < segmentCount; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      d += ` C ${current.outX} ${current.outY}, ${next.inX} ${next.inY}, ${next.x} ${next.y}`;
    }
    if (this.data.closed) d += " Z";
    return d;
  }

  private render(resetStatus = true) {
    this.path.setAttribute("d", this.pathD());
    this.path.classList.toggle("closed", this.data.closed);
    this.handles.replaceChildren();

    this.data.points.forEach((point, index) => {
      const selected = index === this.selectedIndex;
      const lineIn = svgEl("line", { x1: point.x, y1: point.y, x2: point.inX, y2: point.inY, class: "tm-sketch-tangent" });
      const lineOut = svgEl("line", { x1: point.x, y1: point.y, x2: point.outX, y2: point.outY, class: "tm-sketch-tangent" });
      const inHandle = svgEl("circle", { cx: point.inX, cy: point.inY, r: 2.8, class: "tm-sketch-bezier-handle", "data-role": "in", "data-index": index });
      const outHandle = svgEl("circle", { cx: point.outX, cy: point.outY, r: 2.8, class: "tm-sketch-bezier-handle", "data-role": "out", "data-index": index });
      const anchor = svgEl("circle", { cx: point.x, cy: point.y, r: selected ? 4.2 : 3.5, class: `tm-sketch-anchor${selected ? " selected" : ""}`, "data-role": "anchor", "data-index": index });
      this.handles.append(lineIn, lineOut, inHandle, outHandle, anchor);
    });

    this.closeProfile.textContent = this.data.closed ? "Abrir perfil" : "Cerrar perfil";
    this.renderReference();
    if (resetStatus) this.setStatus(this.data.closed ? "Perfil cerrado." : `${this.data.points.length} punto(s).`);
  }

  private renderReference() {
    const href = this.data.referenceDataUrl ?? "";
    this.reference.setAttribute("href", href);
    this.reference.setAttribute("opacity", String(this.data.referenceOpacity ?? 0.38));
    this.refName.textContent = this.data.referenceName ?? "";
  }

  private setStatus(text: string) {
    this.status.textContent = text;
  }
}

let singleton: SketchEditor | null = null;

export function openSketchEditor(initial?: SketchData, operation?: SketchOperation) {
  singleton ??= new SketchEditor();
  return singleton.open(initial, operation);
}
