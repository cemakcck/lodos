import { MongoMemoryReplSet } from "mongodb-memory-server";

/** One single-node replica set for the whole run; each test file uses its own database and random tenants. */
export default async function setup(): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    // The TTL monitor runs on the real clock; tests use fixed dates and must not have sessions deleted mid-run.
    instanceOpts: [{ args: ["--setParameter", "ttlMonitorEnabled=false"] }],
    binary: { version: process.env.MONGOMS_VERSION ?? "8.0.4" },
  });
  process.env.MONGODB_URI = replSet.getUri();
  return async () => {
    await replSet.stop();
  };
}
