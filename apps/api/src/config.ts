import { z } from "zod";

const bool = z
  .enum(["1", "0", "true", "false", ""])
  .default("0")
  .transform((v) => v === "1" || v === "true");

const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  DEMO_MODE: bool,
  WEB_ORIGIN: z.url().default("http://localhost:5180"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DEMO_SANDBOXES_PER_IP_HOUR: z.coerce.number().int().min(1).default(5),
  HOST: z.string().default("0.0.0.0"),
});

export type Config = {
  mongoUri: string;
  sessionSecret: string;
  demoMode: boolean;
  webOrigin: string;
  port: number;
  host: string;
  sandboxesPerIpHour: number;
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
  };
}
