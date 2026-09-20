import { defineConfig } from "@playwright/test";

const databasePath = `/tmp/tempo-playwright-${globalThis.crypto.randomUUID()}.db`;
const dataDirectory = `/tmp/tempo-playwright-${globalThis.crypto.randomUUID()}`;

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:8001", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && ../.venv/bin/alembic -c ../alembic.ini upgrade head && ../.venv/bin/uvicorn tempo.main:app --host 127.0.0.1 --port 8001",
    url: "http://127.0.0.1:8001",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      TEMPO_DATABASE_URL: `sqlite:///${databasePath}`,
      TEMPO_DATA_DIR: dataDirectory,
    },
  },
});
