import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

const YEAR = "public, max-age=31536000, immutable";

/**
 * Serves the built web app (`apps/web/dist`) from the API, so one container is one origin: the client's relative
 * `/api` and `/socket.io` URLs need no proxy. Hashed files under /assets are immutable; everything else (index.html,
 * the service worker, the manifest) is revalidated so a deploy reaches clients on their next load.
 * GET/HEAD requests for unknown non-API, non-file paths get index.html (client-side routes such as /t/:token).
 */
export async function registerWeb(app: FastifyInstance, dist: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: dist,
    wildcard: false,
    index: ["index.html"],
    cacheControl: false,
    setHeaders(res, path) {
      res.setHeader("cache-control", path.startsWith(join(dist, "assets")) ? YEAR : "no-cache");
    },
  });
}

/** True when a not-found request should get the SPA shell instead of the JSON 404. */
export function wantsAppShell(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const path = url.split("?")[0] ?? "";
  if (path.startsWith("/api/") || path === "/api" || path.startsWith("/socket.io")) return false;
  // A path with a file extension in its last segment is a missing file, not a route.
  return !/\.[a-z0-9]+$/i.test(path.split("/").pop() ?? "");
}
