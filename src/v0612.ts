// v0.6.12 visual polish: keep the now-working rotation interaction untouched
// and make only the guide itself a little lighter.
const version = document.querySelector<HTMLElement>(".version");
if (version) version.textContent = "v0.6.12";

const ring = document.querySelector<HTMLCanvasElement>("#tm-rotation-ring-v0610");
if (ring) {
  ring.style.setProperty(
    "filter",
    "opacity(0.58) drop-shadow(0 4px 10px rgba(20,40,52,.10))",
    "important",
  );
}

const status = document.querySelector<HTMLElement>("#status");
if (status) status.textContent = "TinkerMatt v0.6.12 listo.";
