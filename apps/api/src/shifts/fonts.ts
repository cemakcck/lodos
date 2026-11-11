import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The directory holding the API's package.json: found by walking up from this module, so it works from src/ and dist/. */
function apiRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("apps/api/package.json not found above " + import.meta.url);
    dir = parent;
  }
}

/** Absolute path of a vendored font, `apps/api/assets/fonts/<file>` (Inter, SIL OFL). */
export const fontPath = (file: string): string => join(apiRoot(), "assets", "fonts", file);
