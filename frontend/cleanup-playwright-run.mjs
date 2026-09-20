import { rmSync } from "node:fs";
import { resolve } from "node:path";

export default class CleanupPlaywrightRun {
  onEnd(result) {
    if (result.status !== "passed") return;

    const runId = process.env.TEMPO_PLAYWRIGHT_RUN_ID;
    if (!runId) return;

    rmSync(resolve(import.meta.dirname, "..", ".tempo-test", runId), {
      recursive: true,
      force: true,
    });
  }
}
