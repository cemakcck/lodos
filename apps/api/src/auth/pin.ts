import argon2 from "argon2";
import { z } from "zod";

/** 4 to 6 digits. */
export const PinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

/** OWASP-minimum argon2id parameters. */
export const hashPin = (pin: string): Promise<string> =>
  argon2.hash(pin, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}
