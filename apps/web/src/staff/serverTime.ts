import { useEffect, useState } from "react";

/** Offsets this close to the held one are network noise; a bigger jump is a real clock change. */
const OFFSET_JUMP_MS = 2000;

/**
 * A screen's server-time offset, smoothed. Each snapshot measures `server now - local receive time`; latency
 * only makes that smaller than the truth, so a larger sample is always accepted, and a smaller one only when it
 * differs by more than 2 s (the device or server clock really moved). Timers therefore never step backwards on a
 * refetch.
 */
export function nextOffset(held: number | null, sample: number): number {
  if (held === null || sample > held || held - sample > OFFSET_JUMP_MS) return sample;
  return held;
}

/** One shared re-render per screen (default every second). The time itself is read at render: `clock() + offset`. */
export function useServerNow(offsetMs: number, clock: () => number, everyMs = 1000): Date {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return new Date(clock() + offsetMs);
}
