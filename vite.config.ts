import { defineConfig, type Plugin } from "vite";

function tinkermattV04Bridge(): Plugin {
  return {
    name: "tinkermatt-v04-bridge",
    enforce: "post",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.endsWith("/src/main.ts")) return null;
      return {
        code: `${code}\nObject.assign(window, { __tinkerEditor: editor });\nimport(\"./v04\");\n`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [tinkermattV04Bridge()],
});
