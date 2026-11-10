import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** Single-container deploy: with `webDist` set, the API serves the built web app on the same origin. */
let dir: string;
let t: TestApp;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lodos-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Lodos</title>");
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(dir, "sw.js"), "self.x=1");
  t = await makeTestApp({ webDist: dir });
});
afterAll(async () => {
  await t.close();
  rmSync(dir, { recursive: true, force: true });
});

it("serves index.html at /", async () => {
  const res = await t.inject("/");
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toMatch(/text\/html/);
  expect(res.body).toContain("<title>Lodos</title>");
  expect(res.headers["cache-control"]).toBe("no-cache");
});

it("client-side routes fall back to index.html", async () => {
  const res = await t.inject("/t/abc123token");
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("<title>Lodos</title>");
});

it("hashed assets are cached for a year; the service worker is not cached", async () => {
  const js = await t.inject("/assets/app-abc123.js");
  expect(js.statusCode).toBe(200);
  expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  const sw = await t.inject("/sw.js");
  expect(sw.statusCode).toBe(200);
  expect(sw.headers["cache-control"]).toBe("no-cache");
});

it("unknown /api routes and missing asset files still 404 as JSON", async () => {
  for (const url of ["/api/nope", "/assets/missing.js"]) {
    const res = await t.inject(url);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  }
});

it("a POST to an unknown path is not answered with the app shell", async () => {
  const res = await t.inject({ method: "POST", url: "/somewhere" });
  expect(res.statusCode).toBe(404);
});

it("without webDist, / is a JSON 404 (dev: Vite serves the web app)", async () => {
  const plain = await makeTestApp();
  try {
    const res = await plain.inject("/");
    expect(res.statusCode).toBe(404);
  } finally {
    await plain.close();
  }
});
