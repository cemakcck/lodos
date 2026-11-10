export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

/** A controllable clock for tests: time only moves when told to. */
export function fixedClock(at: Date): Clock & { set(d: Date): void; advance(ms: number): void } {
  let t = at.getTime();
  return {
    now: () => new Date(t),
    set: (d) => {
      t = d.getTime();
    },
    advance: (ms) => {
      t += ms;
    },
  };
}
