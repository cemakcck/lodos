import { useMemo, useState } from "react";
import { resolveOptions, type OptionGroup, type OptionSelection } from "@lodos/shared";

/**
 * Option-group picking shared by the guest DishSheet and the waiter OptionsSheet. Validation is the shared
 * `resolveOptions`, the same rules the API applies.
 */
export function useOptionPicks(groups: OptionGroup[]) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const selection: OptionSelection[] = useMemo(
    () => groups.map((g) => ({ groupId: g.id, optionIds: picked[g.id] ?? [] })).filter((s) => s.optionIds.length > 0),
    [groups, picked],
  );
  const resolved = resolveOptions(groups, selection);
  /** Required groups with nothing chosen yet. */
  const missing = groups.filter((g) => g.required && !picked[g.id]?.length);
  /** The sum of the chosen options' price deltas (kuruş). */
  const delta = groups.flatMap((g) => g.options.filter((o) => picked[g.id]?.includes(o.id)).map((o) => o.priceDelta)).reduce((a, b) => a + b, 0);

  const isOn = (groupId: string, optionId: string) => picked[groupId]?.includes(optionId) ?? false;
  const toggle = (groupId: string, optionId: string, single: boolean) =>
    setPicked((p) => {
      const cur = p[groupId] ?? [];
      if (single) return { ...p, [groupId]: [optionId] };
      return { ...p, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
    });

  return { selection, valid: resolved.ok, missing, delta, isOn, toggle };
}
