import Fastify from "fastify";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { ApiError, registerErrorHandling } from "../src/errors";

describe("loadConfig", () => {
  const env = { MONGODB_URI: "mongodb://localhost:27018/lodos", SESSION_SECRET: "x".repeat(32) };

  it("parses a valid env with defaults", () => {
    expect(loadConfig({ ...env, DEMO_MODE: "1" })).toEqual({
      mongoUri: env.MONGODB_URI,
      sessionSecret: env.SESSION_SECRET,
      demoMode: true,
      webOrigin: "http://localhost:5180",
      port: 4100,
      host: "0.0.0.0",
      sandboxesPerIpHour: 5,
      trustProxy: false,
      cookieSecure: false,
    });
  });

  it("TRUST_PROXY: false by default; true, a hop count, or a list of IPs / CIDRs; anything else is refused", () => {
    expect(loadConfig(env).trustProxy).toBe(false);
    expect(loadConfig({ ...env, TRUST_PROXY: "false" }).trustProxy).toBe(false);
    expect(loadConfig({ ...env, TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ ...env, TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ ...env, TRUST_PROXY: "10.0.0.0/8, 127.0.0.1, ::1/128" }).trustProxy).toEqual(["10.0.0.0/8", "127.0.0.1", "::1/128"]);
    for (const bad of ["yes", "10.0.0.0/33", "300.1.1.1", "-1", "10.0.0.0/8,"]) {
      expect(() => loadConfig({ ...env, TRUST_PROXY: bad }), bad).toThrow("TRUST_PROXY");
    }
  });

  it("COOKIE_SECURE defaults to NODE_ENV === production and can be set either way", () => {
    expect(loadConfig({ ...env, NODE_ENV: "production" }).cookieSecure).toBe(true);
    expect(loadConfig({ ...env, NODE_ENV: "development" }).cookieSecure).toBe(false);
    expect(loadConfig({ ...env, NODE_ENV: "production", COOKIE_SECURE: "0" }).cookieSecure).toBe(false);
    expect(loadConfig({ ...env, COOKIE_SECURE: "1" }).cookieSecure).toBe(true);
  });

  it("refuses a SESSION_SECRET shorter than 32 chars", () => {
    expect(() => loadConfig({ ...env, SESSION_SECRET: "x".repeat(31) })).toThrow("SESSION_SECRET");
  });
});

describe("error handler", () => {
  const app = Fastify();
  registerErrorHandling(app);
  app.get("/api-error", async () => {
    throw new ApiError(409, "sold_out", "Just sold out", { itemId: "i1" });
  });
  app.get("/zod", async () => z.object({ n: z.number() }).parse({ n: "x" }));
  app.get("/boom", async () => {
    throw new Error("secret internals");
  });

  it("ApiError → its status and { error: { code, message, details } }", async () => {
    const res = await app.inject("/api-error");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: "sold_out", message: "Just sold out", details: { itemId: "i1" } } });
  });

  it("ZodError → 400 validation", async () => {
    const res = await app.inject("/zod");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation");
  });

  it("unknown errors → 500 without leaking the message", async () => {
    const res = await app.inject("/boom");
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "internal", message: "Internal server error" } });
  });
});
