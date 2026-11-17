import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Serves the fake Pomade's shell page. The app it hosts is served separately, on another origin,
// as Pomade serves an app on its own `pomade-app://` origin.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
