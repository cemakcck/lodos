import argon2 from "argon2";
import { PinSchema } from "@lodos/shared";

export { PinSchema };

/** OWASP-minimum argon2id parameters. */
export const hashPin = (pin: string): Promise<string> =>
  argon2.hash(pin, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

/** False for a missing hash (schedule-only staff have none) or a malformed one; never throws. */
export async function verifyPin(hash: string | null | undefined, pin: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}
