import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    minify: true,
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: "app/mcp-app.html",
      output: {
        entryFileNames: "mcp-app.js",
        assetFileNames: "mcp-app.[ext]",
      },
    },
  },
});
