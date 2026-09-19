import "./v071";

// v0.6.1 recreates the reversible intersection button as #bool-intersect-v061.
// Keep the v0.7.1 Blender icon pass aimed at the live button, not the retired
// index.html placeholder removed by v0.5.4.
const intersectButton = document.querySelector<HTMLButtonElement>("#bool-intersect-v061");
if (intersectButton) {
  intersectButton.innerHTML = `<svg class="tm-blender-icon" aria-hidden="true" focusable="false" viewBox="0 0 1600 1600"><g fill="currentColor"><g transform="matrix(100 0 0 100 -51000.391 -32499.711)"><path d="m515.49805 329.98633c-.27766-.001-.50302.22429-.50196.50195l.008 5.00586c.00003.27613.22387.49997.5.5h5c.27613-.00003.49997-.22387.5-.5v-4.99805c-.00003-.27613-.22387-.49997-.5-.5z"/><path d="m515.00391 325.99609v.00391h-.00391v2h1v-1.00391h1.00391v-1zm4 0v1h2v-1zm3.99609.00391v1h1v1h1.00391v-2.00391zm1.00391 3.99609v2h1v-2zm-13 .002v2h1v-1h1v-1zm13 3.99804v1h-1v1h2v-2zm-13 .002v2h1v-2zm0 4v2h2v-1h-1v-1zm9 0v1h-1v1h2v-2zm-5 1v1h2v-1z"/></g></g></svg>`;
  intersectButton.classList.add("tm-blender-icon-button");
  intersectButton.title = "Intersección booleana";
  intersectButton.setAttribute("aria-label", "Intersección booleana");
}
