import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The UI half of the build folder Pomade hosts: index.html, assets and everything in public/
// (manifest.json, the strip icon), all on relative URLs. Asset names carry no hash — Pomade
// serves an app with `cache-control: no-store`, and stable names keep a watch build from piling
// up old files. `npm run build` empties dist/ first; the backend build adds dist/backend/.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2022",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
