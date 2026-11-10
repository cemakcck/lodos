// A throwaway single-node MongoDB replica set for the end-to-end run, on a fixed port (27019).
// Playwright's webServer starts this script and stops it when the run ends; the data lives in a temp dir.
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PORT = 27019;

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: "lodos-e2e", count: 1, storageEngine: "wiredTiger" },
  // Same as the API integration tests: the TTL monitor runs on the real clock and must not delete sessions mid-run.
  instanceOpts: [{ port: PORT, args: ["--setParameter", "ttlMonitorEnabled=false"] }],
  binary: { version: process.env.MONGOMS_VERSION ?? "8.0.4" },
});
console.log(`[mem-mongo] ready at ${replSet.getUri()}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await replSet.stop();
  } finally {
    process.exit(0);
  }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => void stop());
