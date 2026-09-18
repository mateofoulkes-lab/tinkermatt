import "./v051.css";

const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.5.1";

function iconBox(hole = false) {
  if (hole) return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 15 24 7l15 8v18L24 41 9 33Z" fill="#59666e" opacity=".46"/><path d="M9 15 24 23l15-8" fill="none" stroke="#39464e" stroke-width="1.7"/><path d="M24 23v18" stroke="#39464e" stroke-width="1.7"/></svg>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 15 24 7l15 8v18L24 41 9 33Z" fill="#e91d2d"/><path d="M9 15 24 23l15-8-15-8Z" fill="#f24956"/><path d="M24 23 39 15v18L24 41Z" fill="#bd1423"/></svg>`;
}

function iconCylinder(hole = false) {
  if (hole) return `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="13" rx="13" ry="6" fill="#6a747a" opacity=".52"/><path d="M11 13v21c0 4 6 7 13 7s13-3 13-7V13" fill="#59666e" opacity=".42" stroke="#3b474e" stroke-width="1.4"/><ellipse cx="24" cy="34" rx="13" ry="7" fill="#4c5960" opacity=".35"/></svg>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="13" rx="13" ry="6" fill="#ff9f32"/><path d="M11 13v21c0 4 6 7 13 7s13-3 13-7V13" fill="#f5831f"/><ellipse cx="24" cy="34" rx="13" ry="7" fill="#ce6210"/><ellipse cx="24" cy="13" rx="13" ry="6" fill="#ffa846"/></svg>`;
}

function iconSphere(hole = false) {
  if (hole) return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="#59666e" opacity=".42" stroke="#3b474e" stroke-width="1.4"/><ellipse cx="19" cy="18" rx="6" ry="8" fill="#fff" opacity=".16"/></svg>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><radialGradient id="tmsp" cx="34%" cy="28%"><stop offset="0" stop-color="#74d5f0"/><stop offset=".45" stop-color="#16a9da"/><stop offset="1" stop-color="#0075a5"/></radialGradient></defs><circle cx="24" cy="24" r="15" fill="url(#tmsp)"/></svg>`;
}

function iconText() {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 39 22 8h5l12 31h-7l-2.7-7.5H19.2L16.6 39Zm11.2-13.4h6.2L24.3 16Z" fill="#d70b8c"/><path d="M27 8 39 39h-4.4L23.8 10.3Z" fill="#9e0869" opacity=".7"/></svg>`;
}

function iconSvg() {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 9h30v30H9Z" rx="3" fill="#46b749"/><path d="M13 33 21 23l6 6 4-5 5 9Z" fill="#dff3dc"/><circle cx="29" cy="17" r="4" fill="#ffe16d"/><path d="M9 35h30v4H9Z" fill="#2b8d35"/></svg>`;
}

function iconStl() {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 6 15 9 3 17-13 10-17-4-6-15 8-13Z" fill="#3b55a3"/><path d="m24 6 2 17 13-8Z" fill="#6577be"/><path d="m26 23 16 9-13 10Z" fill="#263d82"/><path d="m6 23 20 0-14 15Z" fill="#314991"/></svg>`;
}

function iconThread() {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 10h22l-3 5 3 5-3 5 3 5-3 8H16l-3-8 3-5-3-5 3-5Z" fill="#d47b1e"/><path d="M16 15h16M15 20h18M16 25h16M15 30h18" stroke="#7f450f" stroke-width="2"/></svg>`;
}

function iconBevel() {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 16 20 7h17l4 4v21L31 41H14l-5-5Z" fill="#75cedb"/><path d="m9 16 11-9v9H9ZM31 41l10-9H31Z" fill="#3f9dad"/><path d="M20 16h11v16H14V21Z" fill="#9ce0e8" opacity=".75"/></svg>`;
}

function coloredIconFor(item: HTMLButtonElement): string | null {
  const shape = item.dataset.shape;
  const mode = item.dataset.mode ?? "solid";
  const hole = mode === "hole";
  if (shape === "box") return iconBox(hole);
  if (shape === "cylinder") return iconCylinder(hole);
  if (shape === "sphere") return iconSphere(hole);
  if (item.id === "add-text") return iconText();
  if (item.id === "import-svg") return iconSvg();
  if (item.id === "import-stl") return iconStl();
  if (item.id.includes("thread")) return iconThread();
  if (item.id.includes("bevel")) return iconBevel();
  return null;
}

function refreshLegacyFamilies() {
  for (const family of document.querySelectorAll<HTMLDetailsElement>(".library-family")) {
    const summary = family.querySelector<HTMLElement>(":scope > summary");
    const items = [...family.querySelectorAll<HTMLButtonElement>(":scope > .library-item")];
    if (!summary || !items.length) continue;

    for (const item of items) {
      const html = coloredIconFor(item);
      const slot = item.querySelector<HTMLElement>(".mini-shape");
      if (html && slot) slot.innerHTML = html;
    }

    const index = Number(summary.dataset.activeToolIndex ?? 0);
    const active = items[Math.max(0, Math.min(items.length - 1, Number.isFinite(index) ? index : 0))];
    const iconSlot = active?.querySelector<HTMLElement>(".mini-shape");
    if (active && iconSlot) {
      summary.innerHTML = `<span class="tm-tool-current">${iconSlot.innerHTML}</span><span class="tm-tool-corner">◢</span>`;
      summary.title = active.title || active.textContent?.trim() || "Herramienta";
    }
  }
}

refreshLegacyFamilies();

// v0.4.1 already swaps parent icons when a child is picked. Re-run our coloring
// immediately after a flyout choice is clicked so every parent always mirrors
// the exact colorful child icon currently active.
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest(".tm-tool-flyout-item")) queueMicrotask(refreshLegacyFamilies);
});

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.5.1 · biblioteca visual mejorada.";
