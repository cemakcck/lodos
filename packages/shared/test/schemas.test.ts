import { describe, expect, it } from "vitest";
import { ALLERGENS, DemoRole, EVENTS, OrderItemRequest, OrderRequest, StaffRole, room, tableRoom } from "../src/index";

const key = "123e4567-e89b-42d3-a456-426614174000";
const item = (qty: number) => ({ itemId: "i1", qty, options: [] });

describe("schemas", () => {
  it("accepts a valid order", () => {
    expect(OrderRequest.safeParse({ idempotencyKey: key, items: [item(2)] }).success).toBe(true);
  });
  it("rejects total qty above 20", () => {
    expect(OrderRequest.safeParse({ idempotencyKey: key, items: [item(11), item(10)] }).success).toBe(false);
    expect(OrderRequest.safeParse({ idempotencyKey: key, items: [item(10), item(10)] }).success).toBe(true);
  });
  it("rejects empty items and bad key", () => {
    expect(OrderRequest.safeParse({ idempotencyKey: key, items: [] }).success).toBe(false);
    expect(OrderRequest.safeParse({ idempotencyKey: "x", items: [item(1)] }).success).toBe(false);
  });
  it("accepts an optional expectedCheckId (the visit the guest page belongs to)", () => {
    expect(OrderRequest.parse({ idempotencyKey: key, items: [item(1)], expectedCheckId: "665f0c0c0c0c0c0c0c0c0c0c" }).expectedCheckId).toBe(
      "665f0c0c0c0c0c0c0c0c0c0c",
    );
    expect(OrderRequest.parse({ idempotencyKey: key, items: [item(1)] }).expectedCheckId).toBeUndefined();
    expect(OrderRequest.safeParse({ idempotencyKey: key, items: [item(1)], expectedCheckId: 7 }).success).toBe(false);
  });
  it("validates item fields", () => {
    expect(OrderItemRequest.safeParse({ ...item(1), note: "a".repeat(140) }).success).toBe(true);
    expect(OrderItemRequest.safeParse({ ...item(1), note: "a".repeat(141) }).success).toBe(false);
    expect(OrderItemRequest.safeParse(item(1.5)).success).toBe(false);
    expect(OrderItemRequest.safeParse(item(0)).success).toBe(false);
    expect(OrderItemRequest.safeParse({ ...item(1), seat: 21 }).success).toBe(false);
    expect(OrderItemRequest.safeParse({ ...item(1), seat: 3 }).success).toBe(true);
  });
  it("roles", () => {
    expect(StaffRole.safeParse("guest").success).toBe(false);
    expect(DemoRole.safeParse("guest").success).toBe(true);
  });
  it("constants and rooms", () => {
    expect(ALLERGENS).toHaveLength(14);
    expect(EVENTS).toContain("ticket.created");
    expect(room("t1", "kitchen")).toBe("t1:station:kitchen");
    expect(room("t1", "bar")).toBe("t1:station:bar");
    expect(room("t1", "floor")).toBe("t1:floor");
    expect(room("t1", "manager")).toBe("t1:manager");
    expect(tableRoom("t1", "x")).toBe("t1:table:x");
  });
});
