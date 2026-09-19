import { defineConfig, type Plugin } from "vite";

function tinkermattV04Bridge(): Plugin {
  return {
    name: "tinkermatt-v04-bridge",
    enforce: "post",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.endsWith("/src/main.ts")) return null;
      return {
        code: `${code}\nObject.assign(window, { __tinkerEditor: editor });\nimport(\"./v04\")\n  .then(() => import(\"./v041\"))\n  .then(() => import(\"./v042\"))\n  .then(() => import(\"./v043\"))\n  .then(() => import(\"./v044\"))\n  .then(() => import(\"./v050\"))\n  .then(() => import(\"./v051\"))\n  .then(() => import(\"./v052\"))\n  .then(() => import(\"./v053\"))\n  .then(() => import(\"./v054\"))\n  .then(() => import(\"./v055\"))\n  .then(() => import(\"./v056\"))\n  .then(() => import(\"./v057\"))\n  .then(() => import(\"./v058\"))\n  .then(() => import(\"./v059\"))\n  .then(() => import(\"./v060\"));\n`,
        map: null,
      };
    },
    transformIndexHtml(html) {
      if (html.includes("manifest.webmanifest")) return html;
      return html.replace("</head>", '    <link rel="manifest" href="./manifest.webmanifest" />\n  </head>');
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [tinkermattV04Bridge()],
});
