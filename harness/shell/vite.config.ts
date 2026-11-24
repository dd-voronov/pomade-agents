import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Serves the fake Pomade's shell page. The app it hosts is served separately, on another origin,
// as Pomade serves an app on its own `pomade-app://` origin. Its dependency cache is its own: in
// `dev:fake` the app's dev server runs beside it, and one shared cache has each server's
// optimizer outdate the other's, failing the app's dependency requests.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../../node_modules/.vite-shell", import.meta.url)),
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
