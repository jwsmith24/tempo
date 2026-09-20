import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:8000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run tempo",
    url: "http://127.0.0.1:8000",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { TEMPO_DATABASE_URL: "sqlite:///browser-test.db" },
  },
});
