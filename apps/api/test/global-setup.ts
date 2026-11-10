import { MongoMemoryReplSet } from "mongodb-memory-server";

/** One single-node replica set for the whole run; each test file uses its own database and random tenants. */
export default async function setup(): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: process.env.MONGOMS_VERSION ?? "8.0.4" },
  });
  process.env.MONGODB_URI = replSet.getUri();
  return async () => {
    await replSet.stop();
  };
}
