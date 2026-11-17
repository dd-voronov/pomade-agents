import { defineConfig } from "vite";

// The backend half of the build folder: one self-contained ES module. An installed copy of the
// app has no node_modules, so every import — pomade-kit included — is bundled into the entry.
export default defineConfig({
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: "src/backend/main.ts",
    outDir: "dist/backend",
    emptyOutDir: false,
    target: "node22",
    minify: false,
    rollupOptions: {
      output: { format: "es", entryFileNames: "main.mjs", inlineDynamicImports: true },
    },
  },
});
