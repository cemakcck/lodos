// `npm run dev`: the API (:4100) and the web app (:5180), with a throwaway MongoDB when none is configured.
//
// With a repo-root .env (or MONGODB_URI in the environment) this only starts the two dev servers, exactly as before.
// Without one, it first starts an in-memory single-node replica set (mongodb-memory-server, the same one the tests
// use) on a free port, and runs the API against it in demo mode with a dev-only session secret. Its data is gone
// when you stop the dev servers; every visitor gets a freshly seeded sandbox anyway.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
const hasEnvFile = existsSync(envFile);
// Real environment variables win over the file, as in the API itself.
if (hasEnvFile) process.loadEnvFile(envFile);

let replSet;
if (!process.env.MONGODB_URI) {
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  console.log("[dev] No .env and no MONGODB_URI: starting a throwaway in-memory MongoDB (data is lost on exit).");
  replSet = await MongoMemoryReplSet.create({ replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGODB_URI = replSet.getUri("lodos");
  console.log(`[dev] MongoDB ready at ${process.env.MONGODB_URI}`);
}
if (!hasEnvFile) {
  // The same dev-only defaults as .env.example.
  process.env.SESSION_SECRET ??= "dev-only-insecure-secret-change-me-0123456789";
  process.env.DEMO_MODE ??= "1";
}

// concurrently runs directly under node (no shell in between), so a signal sent to this process reaches it.
const require = createRequire(import.meta.url);
const concurrentlyPkg = require.resolve("concurrently/package.json");
const concurrentlyBin = resolve(dirname(concurrentlyPkg), require(concurrentlyPkg).bin.concurrently);
const child = spawn(
  process.execPath,
  [concurrentlyBin, "-n", "api,web", "-c", "blue,green", "npm run dev -w @lodos/api", "npm run dev -w @lodos/web"],
  { cwd: root, stdio: "inherit", env: process.env },
);

/** Resolves when the process has exited, or after `ms`. */
const exited = (proc, ms) =>
  new Promise((done) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return done();
    proc.once("exit", done);
    setTimeout(done, ms).unref();
  });

let signalled = false;
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  try {
    if (replSet) {
      // Ctrl-C also reached mongod, which is already shutting down: let it finish rather than connect to it.
      if (signalled) await Promise.all(replSet.servers.map((s) => exited(s.instanceInfo?.instance.mongodProcess, 3000)));
      await replSet.stop();
    }
  } catch {
    // best effort: the data was throwaway anyway
  } finally {
    process.exit(code);
  }
}
child.on("exit", (code, signal) => void stop(code ?? (signal ? 1 : 0)));
// Ctrl-C reaches the whole process group; a plain kill reaches only this process, so pass it on.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (signal !== "SIGTERM") signalled = true; // a terminal's Ctrl-C or hangup reaches mongod too
    if (!child.killed) child.kill(signal);
  });
}
