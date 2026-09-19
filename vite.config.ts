import { defineConfig, type Plugin } from "vite";

function tinkermattV04Bridge(): Plugin {
  return {
    name: "tinkermatt-v04-bridge",
    enforce: "post",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.endsWith("/src/main.ts")) return null;
      return {
        code: `${code}\nObject.assign(window, { __tinkerEditor: editor });\nimport(\"./latest\").catch((error) => {\n  console.error(\"TinkerMatt bootstrap failed\", error);\n  document.documentElement.classList.remove(\"tm-booting\");\n  document.getElementById(\"tm-atomic-boot-style\")?.remove();\n});\n`,
        map: null,
      };
    },
    transformIndexHtml(html) {
      const manifest = html.includes("manifest.webmanifest") ? "" : '    <link rel="manifest" href="./manifest.webmanifest" />\n';
      const boot = html.includes("tm-atomic-boot-style") ? "" : `    <style id="tm-atomic-boot-style">
      html.tm-booting body { opacity: 0; }
      html.tm-booting::after {
        content: "TinkerMatt";
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        background: #f7f9fb;
        color: #345d75;
        font: 700 15px/1.2 system-ui, sans-serif;
        letter-spacing: .02em;
      }
    </style>
    <script>document.documentElement.classList.add("tm-booting");</script>
`;
      return html.replace("</head>", `${manifest}${boot}  </head>`);
    },
  };
}

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "three/examples/fonts/droid/droid_mono_regular.typeface.json": "three/examples/fonts/droid/droid_sans_mono_regular.typeface.json",
    },
  },
  plugins: [tinkermattV04Bridge()],
});
