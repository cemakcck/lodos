import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: true,
    // Seeds and a full app per file make a test take up to ~9 s with every file running in parallel on a loaded
    // machine (2-3 s idle). 15 s keeps a real hang failing while load alone cannot; hooks build apps and seed.
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
