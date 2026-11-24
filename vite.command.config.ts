import { defineConfig } from "vite";

// The `pomade-agents` command's half of the build folder: one self-contained ES module at the path
// the manifest's `commands` names. Like the backend, an installed copy has no node_modules, so
// every import — pomade-kit included — is bundled into the entry.
export default defineConfig({
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: "src/command/main.ts",
    outDir: "dist/cli",
    emptyOutDir: false,
    target: "node22",
    minify: false,
    rollupOptions: {
      output: { format: "es", entryFileNames: "pomade-agents.mjs", inlineDynamicImports: true },
    },
  },
});
