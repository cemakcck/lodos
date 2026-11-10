import { resolve } from "node:path";
import { buildApp } from "./app";
import { loadConfig } from "./config";

// The repo-root .env sits two levels above both src/main.ts and dist/main.js; real env vars win over it.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // no .env file: rely on the environment
}

const config = loadConfig();
const { app, close } = await buildApp({
  mongoUri: config.mongoUri,
  sessionSecret: config.sessionSecret,
  webOrigin: config.webOrigin,
  demoMode: config.demoMode,
  sandboxesPerIpHour: config.sandboxesPerIpHour,
  trustProxy: config.trustProxy,
  cookieSecure: config.cookieSecure,
  startJobs: true,
  logger: true,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
  });
}

await app.listen({ port: config.port, host: config.host });
