import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

/**
 * `npm test` at the root: one Vitest run over every workspace, so shared, api and web files share one worker pool
 * instead of running workspace after workspace. Each project keeps its own config (environment, globalSetup,
 * timeouts); `npm test -w <workspace>` still runs one workspace with that same config.
 *
 * Workers: one per core but one (measured on 8 cores: 4 workers 175 s, 6 → 154 s, 7 → 139 s, 8 → 157 s), capped at
 * 8 because every api file shares one in-memory MongoDB. `VITEST_MAX_WORKERS` overrides it.
 */
export default defineConfig({
  test: {
    projects: ["packages/shared", "apps/api", "apps/web"],
    maxWorkers: Math.min(8, Math.max(1, availableParallelism() - 1)),
  },
});
