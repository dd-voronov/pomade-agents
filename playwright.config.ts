import { defineConfig, devices } from "@playwright/test";

import { APP_PORT, SHELL_PORT } from "./e2e/ports.ts";

// The app's e2e against the fake Pomade. The built app is served on one origin and the fake
// Pomade's shell page on another; each test starts its own fake host, sandbox and backend
// (e2e/fixtures.ts), so tests run in parallel. The Pomade smoke spec has its own config.
export default defineConfig({
  testDir: "e2e",
  testIgnore: "pomade/**",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: { ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}/manifest.json`,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --config harness/shell/vite.config.ts --port ${SHELL_PORT} --strictPort`,
      url: `http://localhost:${SHELL_PORT}/index.html`,
      reuseExistingServer: false,
    },
  ],
});
