import mongoose, { type Connection } from "mongoose";
import { registerModels, type Models } from "./models/index";

/**
 * Opens a dedicated connection (never the mongoose default one), compiles the models on it and builds
 * every index, so unique / partial / TTL indexes exist before the first request.
 */
export async function connectDb(uri: string, opts: { dbName?: string } = {}): Promise<{ conn: Connection; models: Models }> {
  const conn = mongoose.createConnection(uri, { dbName: opts.dbName, autoIndex: false, autoCreate: true });
  await conn.asPromise();
  const models = registerModels(conn);
  // Each collection builds its own indexes; independent, so they run concurrently.
  await Promise.all(Object.values(models).map((model) => model.syncIndexes()));
  return { conn, models };
}
