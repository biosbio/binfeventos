import { defineConfig, devices } from "@playwright/test";

// ============================================================
// Playwright — suíte E2E do BINF EVENTOS
// Pré-requisitos (uma vez): npm run db:seed && npm run build
// Correr: npm run test:e2e (arranca o servidor dev em :3000)
// ============================================================

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // fluxos partilham estado na base — sequencial
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
