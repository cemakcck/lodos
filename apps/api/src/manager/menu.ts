import { serviceDayOf, type AvailabilityInput, type CategoryInput, type MenuItemInput } from "@lodos/shared";
import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import type { Models } from "../db/models/index";
import { ApiError } from "../errors";
import { isOid, notFound } from "../kds/service";

type Loc = { en: string; tr: string };
type Lean<T> = T & { _id: unknown };

export type ItemView = {
  id: string;
  categoryId: string;
  name: Loc;
  description: Loc;
  story: Loc;
  price: number;
  station: "kitchen" | "bar";
  dietary: string[];
  allergens: string[];
  photo: string | null;
  optionGroups: unknown[];
  active: boolean;
  sort: number;
  availability: { soldOut: boolean; remaining: number | null };
};
export type CategoryView = { id: string; name: Loc; sort: number; active: boolean };
export type AvailabilityView = { itemId: string; serviceDay: string; soldOut: boolean; remaining: number | null };

const newId = () => randomBytes(5).toString("hex");
type GroupIn = { id?: string; options: { id?: string }[] };
/** Keeps ids the client sent; entries without one get a short random id. */
function withIds<T extends GroupIn>(groups: T[]): T[] {
  return groups.map((g) => ({ ...g, id: g.id ?? newId(), options: g.options.map((o) => ({ ...o, id: o.id ?? newId() })) }));
}
const isDup = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === 11000;

const loc = (l: Loc): Loc => ({ en: l.en, tr: l.tr });

function itemView(i: Lean<Awaited<ReturnType<Models["MenuItem"]["findOne"]>> & object>, avail?: { soldOut: boolean; remaining?: number | null }): ItemView {
  const d = i as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: String(d._id),
    categoryId: String(d.categoryId),
    name: loc(d.name),
    description: loc(d.description),
    story: loc(d.story ?? { en: "", tr: "" }),
    price: d.price,
    station: d.station,
    dietary: [...d.dietary],
    allergens: [...d.allergens],
    photo: d.photo ?? null,
    optionGroups: JSON.parse(JSON.stringify(d.optionGroups ?? [])) as unknown[],
    active: d.active,
    sort: d.sort,
    availability: { soldOut: avail?.soldOut ?? false, remaining: avail?.remaining ?? null },
  };
}
const categoryView = (c: { _id: unknown; name: Loc; sort: number; active: boolean }): CategoryView => ({
  id: String(c._id),
  name: loc(c.name),
  sort: c.sort,
  active: c.active,
});

/** Must run inside the manager's tenant. */
export async function managerMenu(models: Models, now: Date): Promise<{ categories: CategoryView[]; items: ItemView[] }> {
  const [categories, items, avails] = await Promise.all([
    models.Category.find({}).sort({ sort: 1, _id: 1 }).lean(),
    models.MenuItem.find({}).sort({ sort: 1, _id: 1 }).lean(),
    models.Availability.find({ serviceDay: serviceDayOf(now) }).lean(),
  ]);
  const availOf = new Map(avails.map((a) => [String(a.itemId), a]));
  return {
    categories: categories.map(categoryView),
    items: items.map((i) => itemView(i as never, availOf.get(String(i._id)))),
  };
}

async function requireCategory(models: Models, id: string): Promise<void> {
  if (!isOid(id) || !(await models.Category.exists({ _id: id }))) throw notFound();
}

export async function createCategory(models: Models, body: CategoryInput): Promise<CategoryView> {
  const sort = body.sort ?? ((await models.Category.findOne({}).sort({ sort: -1 }).lean())?.sort ?? -1) + 1;
  const c = await models.Category.create({ name: body.name, sort, active: body.active ?? true });
  return categoryView(c);
}

export async function updateCategory(models: Models, id: string, patch: Partial<CategoryInput>): Promise<CategoryView> {
  if (!isOid(id)) throw notFound();
  const c = await models.Category.findOneAndUpdate({ _id: id }, { $set: patch }, { returnDocument: "after", runValidators: true }).lean();
  if (!c) throw notFound();
  return categoryView(c);
}

export async function deleteCategory(models: Models, id: string): Promise<void> {
  if (!isOid(id) || !(await models.Category.exists({ _id: id }))) throw notFound();
  if (await models.MenuItem.exists({ categoryId: id, active: true })) {
    throw new ApiError(409, "conflict", "Category still has active items");
  }
  await models.Category.deleteOne({ _id: id });
}

/**
 * Storage caps per tenant, applied always (not only in demo mode): a public demo visitor must not be able to fill the
 * database, and a real restaurant never comes near them. They are soft under concurrency (two racing requests can
 * both pass the check), which is fine for their purpose.
 */
export const MAX_ITEMS_PER_TENANT = 120;
export const MAX_PHOTO_BYTES_PER_TENANT = 20 * 1024 * 1024;
const limitExceeded = (message: string) => new ApiError(409, "limit_exceeded", message);

export async function createItem(models: Models, body: MenuItemInput & { dietary: string[]; allergens: string[]; optionGroups: unknown[]; active: boolean }): Promise<ItemView> {
  await requireCategory(models, body.categoryId);
  if ((await models.MenuItem.countDocuments({})) >= MAX_ITEMS_PER_TENANT) {
    throw limitExceeded(`A menu holds at most ${MAX_ITEMS_PER_TENANT} dishes`);
  }
  const sort = body.sort ?? ((await models.MenuItem.findOne({ categoryId: body.categoryId }).sort({ sort: -1 }).lean())?.sort ?? -1) + 1;
  const doc = await models.MenuItem.create({ ...body, optionGroups: withIds(body.optionGroups as GroupIn[]), story: body.story ?? { en: "", tr: "" }, sort });
  return itemView(doc as never);
}

export async function updateItem(models: Models, id: string, patch: Record<string, unknown>): Promise<ItemView> {
  if (!isOid(id)) throw notFound();
  if (typeof patch.categoryId === "string") await requireCategory(models, patch.categoryId);
  if (Array.isArray(patch.optionGroups)) patch = { ...patch, optionGroups: withIds(patch.optionGroups as GroupIn[]) };
  const doc = await models.MenuItem.findOneAndUpdate({ _id: id }, { $set: patch }, { returnDocument: "after", runValidators: true }).lean();
  if (!doc) throw notFound();
  return itemView(doc as never);
}

export async function deactivateItem(models: Models, id: string): Promise<void> {
  if (!isOid(id)) throw notFound();
  const r = await models.MenuItem.updateOne({ _id: id }, { $set: { active: false } });
  if (r.matchedCount === 0) throw notFound();
}

export async function setAvailability(models: Models, itemId: string, body: AvailabilityInput, now: Date): Promise<AvailabilityView> {
  if (!isOid(itemId) || !(await models.MenuItem.exists({ _id: itemId }))) throw notFound();
  const serviceDay = serviceDayOf(now);
  const cur = await models.Availability.findOne({ serviceDay, itemId }).lean();
  const remaining = body.remaining !== undefined ? body.remaining : body.soldOut === false ? null : (cur?.remaining ?? null);
  const soldOut = remaining === 0 ? true : (body.soldOut ?? cur?.soldOut ?? false);
  const write = () => models.Availability.updateOne({ serviceDay, itemId }, { $set: { soldOut, remaining } }, { upsert: true });
  try {
    await write();
  } catch (e) {
    if (!isDup(e)) throw e;
    await write(); // a concurrent upsert created the row first; the retry updates it
  }
  return { itemId, serviceDay, soldOut, remaining };
}

const PHOTO_URL = /^\/api\/photos\/([0-9a-f]{24})$/;

const MAGIC: { type: string; test: (b: Buffer) => boolean }[] = [
  { type: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/webp", test: (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
];
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** The image type by magic bytes, or null when it is not a jpeg, png or webp. */
export const sniffImage = (b: Buffer): string | null => MAGIC.find((m) => m.test(b))?.type ?? null;

export async function setItemPhoto(models: Models, itemId: string, data: Buffer): Promise<string> {
  if (!isOid(itemId)) throw notFound();
  const item = await models.MenuItem.findOne({ _id: itemId }).lean();
  if (!item) throw notFound();
  const contentType = sniffImage(data);
  if (!contentType) throw new ApiError(400, "validation", "Photo must be a jpeg, png or webp image");
  if (data.length > MAX_PHOTO_BYTES) throw new ApiError(400, "validation", "Photo must be at most 2 MB");
  // The photo being replaced is freed first: it does not count against the cap. (It is deleted only after the swap,
  // so a failed upload never leaves the item pointing at a missing photo.)
  const prev = item.photo ? PHOTO_URL.exec(item.photo) : null;
  const [used] = await models.Photo.aggregate<{ bytes: number }>([
    ...(prev ? [{ $match: { _id: { $ne: new Types.ObjectId(prev[1]) } } }] : []),
    { $group: { _id: null, bytes: { $sum: { $binarySize: "$data" } } } },
  ]);
  if ((used?.bytes ?? 0) + data.length > MAX_PHOTO_BYTES_PER_TENANT) {
    throw limitExceeded("Photo storage is full (20 MB); replace or remove a photo first");
  }
  const photo = await models.Photo.create({ data, contentType });
  const url = `/api/photos/${String(photo._id)}`;
  await models.MenuItem.updateOne({ _id: itemId }, { $set: { photo: url } });
  if (prev) await models.Photo.deleteOne({ _id: prev[1] });
  return url;
}
