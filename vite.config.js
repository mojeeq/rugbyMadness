import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, "client"),
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
  build: {
    outDir: path.join(rootDir, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
