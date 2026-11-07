import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e/constants";

/**
 * One phone project (chromium). The server is started by a wrapper that owns its own in-memory
 * Mongo, port and build dir, so the run never touches a dev server the owner has open.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // Specs share one server and one database.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx e2e/serve.ts",
    url: `${E2E_BASE_URL}/sign-in`,
    // First start boots Mongo and compiles with Turbopack.
    timeout: 180_000,
    reuseExistingServer: false,
    // stdout defaults to "ignore", which would hide why a server failed to start.
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["iPhone 15"], defaultBrowserType: "chromium" },
    },
  ],
});
