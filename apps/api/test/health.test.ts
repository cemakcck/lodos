import { afterAll, beforeAll, expect, it } from "vitest";
import { makeTestApp } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.close());

it("GET /api/health → 200 {ok:true}", async () => {
  const res = await t.inject("/api/health");
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});

it("unknown routes → 404 in the error envelope", async () => {
  const res = await t.inject("/api/nope");
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: { code: "not_found", message: expect.any(String) } });
});
