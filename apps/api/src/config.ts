import { isIP } from "node:net";
import { z } from "zod";

const bool = z
  .enum(["1", "0", "true", "false", ""])
  .default("0")
  .transform((v) => v === "1" || v === "true");

/** Fastify `trustProxy`: false, true, a hop count, or the proxies' addresses (IPs / CIDRs). */
export type TrustProxy = boolean | number | string[];

const isIpOrCidr = (s: string): boolean => {
  const [ip, bits, ...rest] = s.split("/");
  if (rest.length || !ip) return false;
  const v = isIP(ip);
  if (!v) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (v === 4 ? 32 : 128);
};

const trustProxy = z
  .string()
  .default("false")
  .transform((raw, ctx): TrustProxy => {
    const v = raw.trim();
    if (v === "" || v === "false") return false;
    if (v === "true") return true;
    if (/^\d+$/.test(v)) return Number(v);
    const list = v.split(",").map((x) => x.trim());
    if (list.every(isIpOrCidr)) return list;
    ctx.addIssue({ code: "custom", message: 'use "false", "true", a hop count, or a comma-separated list of IPs / CIDRs' });
    return z.NEVER;
  });

const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  DEMO_MODE: bool,
  WEB_ORIGIN: z.url().default("http://localhost:5180"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DEMO_SANDBOXES_PER_IP_HOUR: z.coerce.number().int().min(1).default(5),
  HOST: z.string().default("0.0.0.0"),
  TRUST_PROXY: trustProxy,
  NODE_ENV: z.string().optional(),
  COOKIE_SECURE: z.enum(["1", "0", "true", "false", ""]).optional(),
  WEB_DIST: z.string().optional(),
});

export type Config = {
  mongoUri: string;
  sessionSecret: string;
  demoMode: boolean;
  webOrigin: string;
  port: number;
  host: string;
  sandboxesPerIpHour: number;
  /** Behind a reverse proxy, which hops to trust for the client address (`req.ip`, per-IP limits). */
  trustProxy: TrustProxy;
  /** Session and sandbox cookies carry `Secure` (HTTPS only). */
  cookieSecure: boolean;
  /** Absolute path of the built web app to serve (single-container deploy); unset in dev. */
  webDist?: string;
};

/** Validates the environment; throws a readable error listing every bad variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    mongoUri: e.MONGODB_URI,
    sessionSecret: e.SESSION_SECRET,
    demoMode: e.DEMO_MODE,
    webOrigin: e.WEB_ORIGIN,
    port: e.PORT,
    host: e.HOST,
    sandboxesPerIpHour: e.DEMO_SANDBOXES_PER_IP_HOUR,
    trustProxy: e.TRUST_PROXY,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === "1" || e.COOKIE_SECURE === "true" : e.NODE_ENV === "production",
    webDist: e.WEB_DIST || undefined,
  };
}
