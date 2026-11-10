type Name = { en: string; tr: string };

export type OptionGroup = {
  id: string;
  name: Name;
  type: "single" | "multi";
  required: boolean;
  options: { id: string; name: Name; priceDelta: number }[];
};
export type OptionSelection = { groupId: string; optionIds: string[] };

export type ResolvedOptions =
  | { ok: true; chosen: { groupId: string; optionId: string; name: Name; priceDelta: number }[] }
  | { ok: false; errors: string[] };

export function resolveOptions(groups: OptionGroup[], sel: OptionSelection[]): ResolvedOptions {
  const errors: string[] = [];
  const chosen: { groupId: string; optionId: string; name: Name; priceDelta: number }[] = [];
  const known = new Set(groups.map((g) => g.id));

  for (const s of sel) {
    if (!known.has(s.groupId)) errors.push(`Unknown option group: ${s.groupId}`);
  }

  for (const g of groups) {
    const ids = sel.filter((s) => s.groupId === g.id).flatMap((s) => s.optionIds);
    if (ids.length === 0) {
      if (g.required) errors.push(`Option group ${g.id} requires a selection`);
      continue;
    }
    if (g.type === "single" && ids.length > 1) {
      errors.push(`Option group ${g.id} allows only one selection`);
      continue;
    }
    if (new Set(ids).size !== ids.length) {
      errors.push(`Option group ${g.id} has duplicate selections`);
      continue;
    }
    for (const id of ids) {
      const opt = g.options.find((o) => o.id === id);
      if (!opt) errors.push(`Option ${id} does not belong to group ${g.id}`);
      else chosen.push({ groupId: g.id, optionId: opt.id, name: opt.name, priceDelta: opt.priceDelta });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, chosen };
}
