import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const runId = process.env.TEMPO_PLAYWRIGHT_RUN_ID ?? globalThis.crypto.randomUUID();
process.env.TEMPO_PLAYWRIGHT_RUN_ID = runId;
const testRoot = resolve(import.meta.dirname, "..", ".tempo-test", runId);
const databasePath = resolve(testRoot, "tempo.db");
const dataDirectory = resolve(testRoot, "data");
const port = 8100 + Number.parseInt(runId.replace(/-/g, "").slice(0, 4), 16) % 800;
const baseURL = `http://127.0.0.1:${port}`;
mkdirSync(dirname(databasePath), { recursive: true });
process.env.TEMPO_PLAYWRIGHT_DATABASE_PATH = databasePath;

export default defineConfig({
  testDir: "./tests",
  outputDir: resolve(testRoot, "artifacts"),
  reporter: [
    ["list"],
    [resolve(import.meta.dirname, "cleanup-playwright-run.mjs")],
  ],
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `npm run build && ../.venv/bin/alembic -c ../alembic.ini upgrade head && ../.venv/bin/uvicorn tempo.main:app --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      TEMPO_DATABASE_URL: `sqlite:///${databasePath}`,
      TEMPO_DATA_DIR: dataDirectory,
    },
  },
});
