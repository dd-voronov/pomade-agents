import { defineConfig } from "@playwright/test";

// The smoke spec against a real, built Pomade with this app's build folder dev-linked
// (`npm run e2e:pomade` builds the app first). One Electron app at a time.
export default defineConfig({
  testDir: "e2e/pomade",
  outputDir: "test-results/pomade",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
});
