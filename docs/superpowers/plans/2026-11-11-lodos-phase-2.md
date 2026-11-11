# Lodos Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 turns Lodos into a system a restaurant could run on. It adds three groups of features:
- **closing the check:** split bills, comps and voids with manager approval, and 80 mm receipts;
- **a Sales dashboard** with 60 days of demo history;
- **running the restaurant:** staff management, a weekly shift schedule with PDF export, and a floor plan editor.

**Architecture:** The plan extends the phase 1 monorepo in place.
- **Money arithmetic** is pure functions in `packages/shared`, unit-tested to the kuruş. The API is the only place that computes amounts.
- **Comps and voids** live in a new `Adjustment` collection. Order snapshots never change; a check's charged amount = order snapshots − active adjustments.
- **Splits** live on the check document. Share amounts are derived on every read, except paid shares, whose amount is frozen in their payment.
- **Sales** reads stored `DailySummary` documents for past service days and computes today live, with the same function.
- **Schedules** are `Shift` documents. PDFs are rendered on the server with pdfkit and an embedded Inter font.
- **The floor editor** saves a whole room in one versioned transaction.

**Tech Stack:** As in phase 1: Node 22, TypeScript strict, React 19 + Vite, Fastify 5, Socket.IO 4, Mongoose, Zod 4, Vitest, Playwright + axe. New: `pdfkit` (API dependency), `pdfjs-dist` (API dev dependency, for PDF text extraction in tests), Inter TTF files (OFL) vendored into `apps/api/assets/fonts/`.

**Spec:** `docs/superpowers/specs/2026-11-10-lodos-phase-2-design.md` (approved 2026-11-11). It extends the phase 1 spec, `docs/superpowers/specs/2026-11-10-lodos-design.md`. Mockups: `docs/design-reference/phase-2-money.html` and `docs/design-reference/phase-2-manage.html`. Read the phase 2 spec fully before any task. Read the phase 1 spec section a task points to.

## Global Constraints

Everything in the phase 1 plan's Global Constraints still holds (`docs/superpowers/plans/2026-11-10-lodos-phase-1.md`): repo and identity, commit trailers, ports, money in kuruş, Istanbul time and the 06:00 service day via `serviceDayOf`, T/B table names, EN + TR copy, the staff design standard, WCAG 2.2 AA, abuse limits, and wall-clock-independent tests. In addition:

- **Branch:** work on `feat/phase-2`, created from `main`. Never push or merge without the owner's go-ahead.
- **Money:**
  - Every amount shown or charged is computed on the server from order snapshots and adjustments.
  - The client never sends an amount except to confirm one. A share payment whose `amount` differs from the server's → `409 amount_changed`.
  - Shares always sum exactly to what they divide. Leftover kuruş go one each to the earliest shares or letters.
- **VAT (KDV):** each rate's VAT is `round(gross × rate / (100 + rate))`, rounding half up to the kuruş. The only rates are `10` and `20`.
- **Approval:** a manager PIN entered on another person's tablet runs the same check as login: the same argon2 verify, the same `pin:<tenant>:<staffId>` lockout (5 failures in 5 min) and the same per-IP limit. It never creates a session.
- **Drag:** everything that can be dragged (tables, shifts) can also be done by tap and by keyboard (WCAG 2.5.7).
- **Thresholds (spec §6.2):**
  - Hard rules: max **16 h** per shift.
  - Warnings, flagged when strictly exceeded: more than **45 h** in a week; more than **11 h** in a service day; less than **11 h** rest between two shifts.
- **Floor grid:** **16 px** snapping; arrow keys move 1 step, Shift + arrow moves 4 steps. Seats per table **1–12**.
- **Isolation:** every task that adds endpoints adds them to `apps/api/test/isolation-http.test.ts` (another tenant's ids → 404, never data), and every new socket event to `isolation-socket.test.ts`.
- **Every new collection** carries `tenantId`, uses `tenantPlugin`, is listed in `TENANT_SCOPED_MODELS` (so sandbox cleanup and the isolation tests cover it) and is seeded where the spec says.
- **Copy:** every new string goes in both `en.json` and `tr.json`. Turkish must read naturally, e.g. "İkram" for Comp, "İptal" for Void, "Hesabı böl" for Split the bill.
- **Receipt footer, verbatim:** "Teşekkürler · Thank you" and "Bilgi fişi — mali değeri yoktur / Not a fiscal receipt".
- **Demo hint, verbatim:** EN "Demo: Selin's PIN is 9999", TR "Demo: Selin'in PIN'i 9999".

## Rulings made while planning (owner can veto)

- **Adjustments are a separate collection, not `orders.items[].adjustment`.** Spec §8 allows this. Reasons:
  - per-unit comps need several adjustments per line;
  - undo needs history;
  - Sales needs a log that survives without scanning orders;
  - order snapshots stay immutable.
- **Units.** Order line `i` of order `o` with quantity `q` has units `o:i:0 … o:i:(q-1)`; its line ref is `o:i`.
  - An adjustment names the exact units it covers. The server picks them: the highest-index units that are neither adjusted nor in a paid share.
  - A comped unit is worth ₺0 but stays visible: it can be assigned to a share and prints with its comp tag.
  - A voided unit disappears from the bill and from the split.
- **"Unassigned" ignores ₺0 units.** An unassigned comped unit never blocks closing a check.
- **Evenly mode is locked once a share is paid.** After any payment, neither the share count nor the mode can change. In By item mode, new letters can still be added after a payment, but a paid letter can't be removed.
- **Check number:** `#` plus a 4-digit number derived from the check id: `parseInt(id.slice(-6), 16) % 10000`, zero-padded. No counter document, so check creation adds no write contention.
- **Card "last 4":** four random digits stored with a card payment at payment time.
- **Even-share receipt:** one line, "¼ of check #0427 (₺13.080,00)", then TOTAL = the share. Each rate's VAT is allocated to the share in proportion to the check's gross at that rate (largest remainder).
- **Sales "Today" comparison:** the hour buckets of the same weekday last week, from the 06:00 bucket up to and including the current hour's bucket.
- **Sales revenue:**
  - Revenue is the sum of payments, bucketed by payment time. Covers and checks are bucketed by the check's close time.
  - Comps and voids are dated by when they were made. "% of sales" = (comps + voids amount) ÷ revenue.
- **Summaries store sums, not averages** (ticket time as `count` + `totalMs` per station and hour), so any range averages correctly.
- **The summary job runs whenever `startJobs` is on** (not only in demo mode). Every 15 minutes it writes any missing summary for the previous service day of every tenant.
- **Staff "protected in demo"** is a stored flag, `demoProtected`, set by the seed on Deniz, Selin, Kitchen and Bar. Mert is not protected.
- **Booth is not a stored shape.** The editor offers Round, Square and Booth. Booth = `rect` named `B<n>`, so switching table ↔ booth renames the table to the next free number in the new prefix.
- **Name sequences count inactive tables**, so a soft-deleted T17 is never reused by "Add".
- **Rooms gain `width` (default 800), `height` (default 480) and `version` (default 0).** 800 matches the phase 1 plan width.
- **New tables' sizes** come from seats and shape, with the same presets as the seed (`64/76/88` diameters for round; `rect` 72×56 for 2 seats, 96×64 for 4, 120×72 for 6+).
- **PDF fonts:** `Inter-Regular.ttf` and `Inter-SemiBold.ttf` from the official Inter release (OFL), vendored with `OFL.txt`. The Dockerfile copies `apps/api/assets`.

## Review Focus

1. **Two tablets take payment for the same share at the same moment.** Exactly one payment is recorded. The other request gets `200` with `changed: false` and the stored payment, and the check is never closed twice. Test: Task 5, "parallel pay of one share records one payment".
2. **A comp, void or share payment arrives just after the check was closed** (by a full close on another tablet). → `409 check_closed`; nothing is written and no portion is returned. Test: Task 6, "adjusting a paid check is rejected and writes nothing".
3. **A check opened at 05:30 and paid at 06:10** counts on the new service day, which is the day its payment falls in. A check paid at 05:59 counts on the previous day. Test: Task 12, "payment time decides the service day".
4. **Turkish names in the CSV export open correctly in Excel:**
   - UTF-8 with a BOM, comma-separated, every text field quoted, `"` doubled;
   - amounts as plain lira with two decimals and a dot, e.g. `1250.50`.

   Test: Task 14, "CSV starts with a BOM and quotes Turkish names".
5. **A waiter is deactivated while signed in on a tablet.** Their next request → `401`. Their open sockets receive `session.ended` and are disconnected. The floor shows their former tables as unassigned. Test: Task 16, "deactivation ends sessions and sockets".

---

## File structure (new and changed)

```
packages/shared/src/
  split.ts          divide, evenShares, allocate, vatOf, vatBreakdown, fractionLabel, unit/line refs
  adjustments.ts    COMP_REASONS, VOID_REASONS, AdjustmentKind
  shifts.ts         shiftSpan, shiftMinutes, scheduleWarnings, weekDays, SHIFT_AREAS, thresholds
  hours.ts          serviceHourIndex, SERVICE_HOURS
  staff.ts          LOGIN_ROLES, SCHEDULE_ROLES, STATION_ROLES, isLoginRole, tableRanges
  schemas.ts        + request schemas for every new endpoint
  events.ts         + "split.updated", "adjustment.changed", "layout.saved", "session.ended"; personRoom()
apps/api/src/
  db/models/adjustment.ts  dailySummary.ts  shift.ts  shiftTemplate.ts   (new)
  db/models/check.ts menuItem.ts order.ts ticket.ts staff.ts room.ts       (changed)
  auth/approval.ts         verifyStaffPin (shared with login), approve, listApprovers
  checks/bill.ts           billOf(): units, charged totals, VAT per rate: the one money reader
  checks/split.ts          splitView, setSplit, payShare
  checks/adjust.ts         addAdjustment, reverseAdjustment
  checks/receipt.ts        receiptView
  checks/routes.ts         all /api/checks/:id/{split,shares,adjustments,receipt}, /api/approvers
  sales/summary.ts         summarizeDay, ensureSummaries, summaryJob
  sales/history.ts         generateHistory (demo seed)
  sales/service.ts sales/routes.ts    salesView, salesCsv
  staff/service.ts staff/routes.ts
  shifts/service.ts shifts/routes.ts shifts/pdf.ts shifts/fonts.ts
  layout/service.ts layout/routes.ts
apps/api/assets/fonts/     Inter-Regular.ttf  Inter-SemiBold.ttf  OFL.txt
apps/web/src/staff/
  close/      CloseView.tsx ModeTabs.tsx EvenSplit.tsx ItemSplit.tsx ShareCard.tsx PayDialog.tsx queries.ts types.ts
  adjust/     AdjustDialog.tsx ApproverPad.tsx
  Receipt.tsx                     (replaces PrintCheck.tsx)
  sales/      Sales.tsx Tiles.tsx HourBars.tsx TicketLines.tsx CompsLog.tsx
  people/     Staff.tsx StaffForm.tsx TableChips.tsx
  schedule/   Schedule.tsx ShiftSheet.tsx Templates.tsx MyShifts.tsx lib.ts
  floorplan/  FloorPlan.tsx Inspector.tsx useLayoutDraft.ts geometry.ts
```

---

# Part A: Closing the check

Part A ends demo-able: in a fresh demo copy a waiter splits T4 by item, takes two payments, comps a dessert with Selin's PIN, and prints an 80 mm receipt.

### Task 1: Shared money helpers

**Files:**
- Create: `packages/shared/src/split.ts`, `packages/shared/src/adjustments.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/split.test.ts`

**Interfaces (Produces):**
- `divide(amount: number, parts: number): number[]`: `parts` integers, each `floor(amount/parts)` plus one extra kuruş for each of the first `amount % parts` parts. It sums exactly to `amount`. Throws on `parts < 1` or a non-integer amount.
- `evenShares(total: number, n: number): number[]`: `divide` with `n` clamped to 2..20 and an assertion (no clamping) that `n` is an integer.
- `allocate(amount: number, weights: number[]): number[]`: largest-remainder proportional split that sums exactly to `amount`; ties go to the earliest index. All-zero weights → `divide(amount, weights.length)`.
- `vatOf(gross: number, rate: 10 | 20): number`: `Math.round(gross * rate / (100 + rate))`.
- `vatBreakdown(grossByRate: Partial<Record<10 | 20, number>>): { rate: 10 | 20; gross: number; vat: number }[]`: rates with gross > 0, ascending.
- `fractionLabel(parts: number): string`: `1→""`, `2→"½"`, `3→"⅓"`, `4→"¼"`, otherwise `` `1/${parts}` ``.
- `lineRef(orderId, index) = "${orderId}:${index}"`, `unitRef(orderId, index, unit) = "${orderId}:${index}:${unit}"`, and `parseUnitRef(ref) → { orderId, index, unit } | null`.
- `SHARE_LABELS = "ABCDEFGHIJKLMNOPQRST".split("")` (20 letters).
- `adjustments.ts`:
  - `AdjustmentKind = "comp" | "void"`;
  - `COMP_REASONS = ["celebration", "complaint", "long_wait", "regular", "other"] as const`;
  - `VOID_REASONS = ["wrong_item", "changed_mind", "duplicate", "other"] as const`.
  - The note is required only for `other`, and is at most 140 characters.

- [ ] **Step 1: Write the failing tests** in `split.test.ts`:
  - `divide(100001, 3)` → `[33334, 33334, 33333]`; its sum is 100001.
  - Property-style loop: for every total in `[1, 7, 99, 100001, 1234567]` and n in 2..20, `evenShares` sums to the total, and max − min ≤ 1.
  - `allocate(1000, [1, 1, 1])` → `[334, 333, 333]`; `allocate(327000, [217500, 109500])` sums to 327000.
  - `vatOf(272000, 10)` → `24727`; `vatOf(110000, 20)` → `18333`.
  - `vatBreakdown({ 20: 0, 10: 1100 })` → `[{ rate: 10, gross: 1100, vat: 100 }]`.
  - `fractionLabel` for 1, 2, 3, 4, 6.
  - `parseUnitRef("abc:2:1")` → `{ orderId: "abc", index: 2, unit: 1 }`; `parseUnitRef("x")` → `null`.
- [ ] **Step 2:** Run `npm test -w @lodos/shared -- split`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `split.ts` and `adjustments.ts`, and re-export them from `index.ts`.
- [ ] **Step 4:** Run `npm test -w @lodos/shared`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(shared): exact split, allocation and VAT helpers`.

### Task 2: VAT rate on menu items and order snapshots

**Files:**
- Modify:
  - `apps/api/src/db/models/menuItem.ts` (+ `vatRate: { type: Number, enum: [10, 20], required: true, default: 10 }`);
  - `apps/api/src/db/models/order.ts` (+ `vatRate` on the line snapshot, same definition);
  - `apps/api/src/orders/place.ts` (copy `item.vatRate` into the line);
  - `packages/shared/src/schemas.ts` (`MenuItemInput.vatRate: z.union([z.literal(10), z.literal(20)]).default(10)`);
  - `apps/api/src/manager/menu.ts` (read and write the field);
  - `apps/api/src/seed/content.ts` + `seed.ts` (cocktails and wine → 20, everything else 10);
  - `apps/web/src/staff/manager/ItemForm.tsx` + `types.ts` (a "VAT" segmented control, 10% / 20%).
- Test: `apps/api/test/menu.test.ts`, `apps/api/test/orders.test.ts`, `apps/web/test/staff/manager/ItemForm.test.tsx`

**Interfaces (Produces):** `MenuItem.vatRate` and `Order.items[].vatRate`, both `10 | 20`. Readers treat a missing value (phase 1 data) as 10.

- [ ] **Step 1: Write the failing tests:**
  - **Seed:** "Lodos Negroni" has `vatRate` 20; "Burrata" and a zero-proof drink have 10.
  - **Order snapshot:** a staff order of a Negroni stores `items[0].vatRate === 20`. Then the manager PATCHes the Negroni to `vatRate: 10`, and the already-placed order still says 20.
  - **Manager API:** PATCH with `vatRate: 18` → 400 `validation`.
  - **ItemForm:** the VAT control shows the item's rate and submits the chosen one.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- menu orders` and `npm test -w @lodos/web -- ItemForm`. Expected: FAIL.
- [ ] **Step 3:** Implement. ItemForm copy: EN "VAT" / "Prices include VAT", TR "KDV" / "Fiyatlara KDV dahil".
- [ ] **Step 4:** Run the same commands. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: per-item VAT rate, snapshotted on orders`.

### Task 3: Adjustment model and the bill reader

**Files:**
- Create:
  - `apps/api/src/db/models/adjustment.ts`;
  - `apps/api/src/checks/bill.ts`.
- Modify:
  - `apps/api/src/db/models/index.ts` (register the model and add it to `TENANT_SCOPED_MODELS`);
  - `apps/api/src/orders/check-lines.ts`, which is built on `billOf`;
  - `apps/api/src/floor/service.ts`: `floorSnapshot.openChecksTotal` and `closeCheck`'s amount;
  - `apps/api/src/manager/tonight.ts`: `openTotal`.
- Test: `apps/api/test/bill.test.ts`, plus the existing `checks.test.ts`, `guest.test.ts`, `sandboxes.test.ts` and `isolation-http.test.ts` still pass.

**Interfaces:**
- **Adjustment document:**
  ```
  { tenantId, checkId|null, orderId|null, itemIndex|null, units: number[], qty, kind: "comp"|"void",
    reason, note|null, amount /* kuruş: unit total × qty, the original price */,
    itemId|null, itemName {en,tr}, tableName, station,
    requestedBy|null, requestedByName, approvedBy|null, approvedByName,
    at: Date, serviceDay: string, reversedAt: Date|null, reversedBy|null }
  ```
  - `checkId`, `orderId` and `itemIndex` are null only for generated history (Task 13).
  - Index `{ tenantId, checkId }` and `{ tenantId, at: -1 }`.
- **`billOf(models, checkId, session?): Promise<Bill>`**, where:
  ```ts
  type BillUnit = { ref: string; lineRef: string; unitAmount: number; /* 0 when comped */ comp: { id: string; reason: string } | null };
  type BillLine = {
    lineRef: string; orderId: string; index: number; itemId: string; name: {en,tr}; options: {en,tr}[];
    note: string|null; seat: number|null; station: "kitchen"|"bar"; vatRate: 10|20;
    qty: number; unitTotal: number; compedQty: number; voidedQty: number;
    lineTotal: number;          // charged: unitTotal × (qty − compedQty − voidedQty)
    originalTotal: number;      // unitTotal × qty
    units: BillUnit[];          // voided units excluded
    adjustments: { id: string; kind; qty; reason; note; approvedByName; at }[];
  };
  type Bill = { lines: BillLine[]; total: number; food: number; drinks: number; grossByRate: {10: number; 20: number}; compsAmount: number; voidsAmount: number };
  ```
  Only adjustments with `reversedAt: null` count.
- **`CheckLine`** (in `check-lines.ts`) gains `lineRef`, `compedQty`, `voidedQty`, `originalTotal` and `adjustments`. Its `lineTotal` becomes the charged amount, so the guest "Your table" view, the waiter detail and Tonight all show charged totals with no other change.

- [ ] **Step 1: Write the failing tests** in `bill.test.ts`. Seed a tenant, seat T7, order Gelato ×3 + Negroni ×1, then insert adjustments directly with the model:
  - No adjustments: `total` = 3 × gelato + negroni; `grossByRate` = `{10: 3×gelato, 20: negroni}`.
  - Comp units `[2]` of the gelato line: `lineTotal` = 2 × gelato; `compedQty` 1; `originalTotal` unchanged; unit `…:2` has `unitAmount` 0 and a `comp`; `compsAmount` = gelato.
  - Void units `[1]` too: `units` has 2 entries (0 and 2); `voidsAmount` = gelato; `total` = gelato + negroni.
  - A reversed adjustment (`reversedAt` set) is ignored.
  - `GET /api/tables/:id/check` and the guest `GET /api/guest/table` both show the charged `lineTotal` and `totals.total`.
  - `sandboxes.test.ts` already iterates `TENANT_SCOPED_MODELS`; it now covers `Adjustment`.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- bill`. Expected: FAIL.
- [ ] **Step 3:** Implement the model and `billOf`. Then rebuild `checkLines` on `billOf`, and replace each `checkTotals(orders.flatMap(...))` money read in `floor/service.ts` and `tonight.ts` with `billOf` (or with a batched `billsOf(models, checkIds)` for the floor; put it in the same file).
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS (all phase 1 tests too).
- [ ] **Step 5:** Commit: `feat(api): adjustments collection and a single bill reader`.

### Task 4: Manager approval

**Files:**
- Create: `apps/api/src/auth/approval.ts`
- Modify: `apps/api/src/auth/routes.ts` (login uses `verifyStaffPin`)
- Test: `apps/api/test/approval.test.ts`

**Interfaces (Produces):**
- **`verifyStaffPin(models, { tenantId, ip, staffId, pin, now }): Promise<StaffDoc>`.** This is the body of today's PIN login, moved:
  - the IP limit, then the `pin:<tenant>:<staffId>` lock, then an active staff member with a matching `pinHash`, then clear the hits;
  - the same errors (`429 rate_limited`, `401 unauthorized "Wrong PIN"`);
  - `POST /api/auth/pin` calls it and keeps its exact behaviour.
- **`approve(models, { tenantId, ip, approval: { managerId, pin } | undefined, requester: AuthStaff, now }): Promise<{ id: string; name: string }>`:**
  - a requester who is a manager → returns the requester, with no PIN needed;
  - no approval → `403 approval_required`;
  - otherwise it calls `verifyStaffPin` first, so a wrong PIN counts toward that manager's lockout whatever their role. Then: the staff member is not a manager → `403 not_a_manager`; `managerId === requester.id` → `403 not_a_manager`.
- **`listApprovers(models): Promise<{ id: string; name: string }[]>`:** active managers sorted by name.
- **`ApprovalBody = z.object({ managerId: oid, pin: PinSchema })`**, exported from `packages/shared/src/schemas.ts`.

- [ ] **Step 1: Write the failing tests** (`approve` is called directly inside `runWithTenant`):
  - **Manager requester:** returns the requester and records no rate events.
  - **Waiter:** with Selin + "9999" → `{ name: "Selin" }`. With Selin + "0000" five times → 401 ×5, then the right PIN → 429. And `POST /api/auth/pin` as Selin is now also 429: the lock is shared with login.
  - **A waiter's own PIN can't approve:** Deniz + "1111" → 403 `not_a_manager`.
  - **Deactivated manager:** Selin deactivated (set `active: false` directly) + "9999" → 401.
  - **Login unchanged:** the existing `auth.test.ts` still passes.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- approval auth`. Expected: FAIL.
- [ ] **Step 3:** Implement. Move the logic; don't duplicate it.
- [ ] **Step 4:** Run `npm test -w @lodos/api -- approval auth`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): manager approval shares login's PIN check and lockout`.

### Task 5: Split the bill and share payments

**Files:**
- Create:
  - `apps/api/src/checks/split.ts`;
  - `apps/api/src/checks/routes.ts` (registered in `app.ts`).
- Modify:
  - `apps/api/src/db/models/check.ts`: `split` and `splitVersion`; `payment.last4`;
  - `apps/api/src/floor/service.ts`: `closeCheck` refuses when a share is paid, and clears an unpaid split; `FloorTable.paying`;
  - `packages/shared/src/schemas.ts`: `SplitBody` and `PayShareBody`;
  - `packages/shared/src/events.ts`: add `"split.updated"`.
- Test: `apps/api/test/split.test.ts`

**Interfaces:**
- **Check document:**
  - `split: { mode: "even"|"items", count: 2..20, shares: [{ label, payment: { method, amount, at, last4|null } | null }], assignments: [{ unit: string, labels: string[] }] } | null`;
  - `splitVersion: number` (default 0);
  - `payment.last4: string|null`.
- **`GET /api/checks/:id/split`** (guard: waiter) → `SplitView`:
  ```ts
  type SplitView = {
    checkId: string; tableName: string; status: "open"|"paid"; total: number; mode: "full"|"even"|"items"; count: number;
    locked: boolean;                 // any share paid
    units: { ref; lineRef; name; options; unitAmount; station; vatRate; comp: {reason}|null; labels: string[]; frozen: boolean }[];
    shares: { label: string; amount: number; units: { ref: string; part: number /* kuruş of this unit for this share */; parts: number }[]; payment: {method, amount, at, last4}|null }[];
    unassigned: { count: number; amount: number };   // units worth > 0 with no label
    paidCount: number; left: number; // total − Σ paid
  };
  ```
- **Share amounts:**
  - `even`: paid shares keep `payment.amount`; the unpaid shares are `divide(total − Σpaid, unpaidCount)` in label order.
  - `items`: each assignment divides `unitAmount` over its labels in label order with `divide`. A share's amount is the sum of its parts; a paid share is frozen at its payment amount.
- **`PUT /api/checks/:id/split`**, body `{ mode: "full" } | { mode: "even", count } | { mode: "items", count, assignments: [{ unit, labels }] }`:
  - `full` deletes the split.
  - Errors → `409 split_locked`:
    - any share is paid and the mode changes, or the count changes in `even`;
    - `items` removes a paid label;
    - `items` changes the labels of a unit that is in a paid share.
  - Unknown, voided or duplicate unit refs, or labels outside `SHARE_LABELS.slice(0, count)` → `400 validation`.
  - Increments `splitVersion`; emits `split.updated` to `floor` and `manager`.
- **`POST /api/checks/:id/shares/:label/pay`**, body `{ method: "card"|"cash", amount }`. It runs in a transaction that writes the check (so it write-conflicts with `placeOrder` and adjustments):
  - share already paid → `200 { changed: false, share }`;
  - `amount` ≠ the computed amount → `409 amount_changed` with `details.amount`;
  - `items` mode and the share has no units → `409 conflict`;
  - otherwise it sets the payment (conditional on `shares.$.payment: null`).
  - **Closing:** if every share is now paid and `unassigned.amount === 0`, the check becomes `paid` with `closedAt` set, and the table's open calls are answered, exactly as `closeCheck` does (extract the shared part into one function).
  - **Emits:** `split.updated`, plus on close `check.updated` to floor, manager and table.
  - **Response:** `{ changed, share, closed: boolean }`.
- **`POST /api/checks/:id/close`** (full) with any paid share → `409 split_locked`.
- **Paid checks:** splitting, paying or adjusting a paid check → `409 check_closed`.
- **`FloorTable.paying: { paid: number; of: number } | null`:** set when the open check has a split with at least one paid share.

- [ ] **Step 1: Write the failing tests** in `split.test.ts`:
  - **Even, total 100001:** a check with an exact total of 100001 kuruş (create items via the manager API with prices that sum to it), split even 3 → amounts `[33334, 33334, 33333]`.
  - **Pay twice, then pay the rest:** pay A → 200, `closed: false`; pay A again → `changed: false`, and only one payment is stored. Pay B and C → the last one has `closed: true`; the check is `paid`; T7 is free on `/api/floor`.
  - **Even recalculation:** after A is paid, a new order of ₺100 is placed. B and C split the remaining amount; A is unchanged; the sum equals the new total.
  - **Even lock:** after a payment, changing to count 4 → `409 split_locked`; switching to `items` → `409 split_locked`; a full close → `409 split_locked`.
  - **By item:** Burrata shared by A and B (`labels: ["A","B"]`), ribeye to A, wine bottle split four ways. The fractions sum exactly, and `unassigned` lists what's left.
  - **Frozen paid share:** after A pays, moving a unit of A to B → `409 split_locked`; moving an unassigned unit to B → 200.
  - **Wrong amount:** paying with the wrong amount → `409 amount_changed` with the right amount in `details.amount`.
  - **Unassigned blocks closing:** with A and B paid but one unit unassigned, the check stays open. Adding share C, assigning the unit to C and paying C closes it.
  - **New items during a split:** a new order lands unassigned (`labels: []`).
  - **Review Focus 1:** "parallel pay of one share records one payment". Two `Promise.all` pays of B → exactly one `changed: true`, and the stored payment count is 1.
  - **Floor:** `/api/floor` shows `paying: { paid: 1, of: 3 }` for the table.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- split`. Expected: FAIL.
- [ ] **Step 3:** Implement `splitView` (pure over `Bill` + `check.split`, with no DB access, so it is unit-testable), `setSplit` and `payShare`, plus the routes.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): split the bill evenly or by item, pay per share`.

### Task 6: Comps and voids

**Files:**
- Create: `apps/api/src/checks/adjust.ts`
- Modify:
  - `apps/api/src/checks/routes.ts`;
  - `apps/api/src/db/models/ticket.ts`: items gain `voidedQty` (default 0); the ticket gains `voidedAt` (default null);
  - `apps/api/src/kds/service.ts`: the active, held and done lists exclude `voidedAt != null`; `TicketView.items[].voidedQty`; the all-day tally subtracts voided units;
  - `packages/shared/src/schemas.ts`: `AdjustBody`;
  - `packages/shared/src/events.ts`: `"adjustment.changed"`.
- Test: `apps/api/test/adjust.test.ts`

**Interfaces:**
- **`GET /api/approvers`** (guard: waiter) → `listApprovers`.
- **`POST /api/checks/:id/adjustments`** (guard: waiter), body `{ lineRef, kind, qty, reason, note?, approval?: ApprovalBody }`:
  1. `approve(...)` runs first, outside the transaction (argon2 is slow).
  2. Then one transaction:
     - the check is open (else `409 check_closed`), and the transaction writes the check (`$inc splitVersion`);
     - the line exists, and `qty` ≤ the line's free units → otherwise `409 conflict`. Free units are those not adjusted and not frozen in a paid share;
     - **Evenly lock:** `even` mode with any paid share → `409 split_locked`;
     - **Void only before ready:** `void` and the line's ticket is `ready`, or the ticket has `servedAt` → `409 void_after_ready`, with the message "Already made: comp it instead";
     - it inserts the adjustment with the chosen units, its amount, `serviceDay = serviceDayOf(now)`, and the names denormalized.
  3. **A void** also:
     - `$inc` the ticket line's `voidedQty`;
     - sets `voidedAt` when every line is fully voided;
     - if the order's `serviceDayOf(placedAt)` equals today and an availability document with `remaining != null` exists for the item, `$inc remaining: +qty` and sets `soldOut: false`.
  4. **Units in By item mode:** a voided unit is removed from `split.assignments`.
  5. **Emits:** `adjustment.changed` to floor, manager, table and the line's station; for a void, `ticket.updated` to the station; `availability.changed` to `all` when a portion came back.
  - **Response:** `201 { adjustment }`.
- **`DELETE /api/checks/:id/adjustments/:adjId`** (guard: manager; check open):
  - sets `reversedAt` and `reversedBy`;
  - for a void, undoes the ticket fields and takes the portion back, floored at 0, without ever erroring for sold out;
  - the same split locks apply;
  - idempotent: an already-reversed adjustment → `200 { changed: false }`.

- [ ] **Step 1: Write the failing tests** in `adjust.test.ts`:
  - **Comp by a waiter with approval:** comp 1 of "Gelato × 3" as Deniz with Selin's approval → 201. The bill line is `lineTotal` 2 × gelato, `compedQty` 1. The adjustment's `amount` is the gelato price, `approvedByName` "Selin", `requestedByName` "Deniz".
  - **No approval:** the same as Deniz without approval → `403 approval_required`. Deniz approving with his own PIN → `403 not_a_manager`.
  - **Manager requester:** as Selin with no approval → 201, `approvedBy` = Selin.
  - **Void before ready:** void 1 of the gelato while the ticket is `new` → the KDS view shows `voidedQty: 1` on the line; the all-day tally drops by 1; a 3-left availability becomes 4.
  - **Fully voided ticket:** voiding every line of a single-item ticket makes it leave the KDS active list.
  - **Void after ready:** the ticket is bumped `ready`, then a void → `409 void_after_ready`.
  - **Too many units:** comp qty 3 when only 2 units are free → `409 conflict`.
  - **Undo:** reversing a void as Selin restores the bill total and the ticket line; a second DELETE → `changed: false`. A waiter calling DELETE → 403.
  - **Split locks:** Evenly with one share paid → comp → `409 split_locked`. By item with the gelato unit in paid share A, comp it → `409 conflict` (no free unit); comping an unassigned unit → 201.
  - **Review Focus 2:** "adjusting a paid check is rejected and writes nothing". Close the check in full, then comp → `409 check_closed`; the adjustment count is unchanged, and so is availability.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- adjust`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS (the kds tests too).
- [ ] **Step 5:** Commit: `feat(api): per-unit comps and voids with manager approval`.

### Task 7: Receipt data

**Files:**
- Create: `apps/api/src/checks/receipt.ts`
- Modify:
  - `apps/api/src/checks/routes.ts`;
  - `apps/api/src/floor/routes.ts`: `GET /api/checks/:id/print` now returns `receiptView(…, { share: null })`. Remove `checkPrint`.
- Test: `apps/api/test/receipt.test.ts`

**Interfaces:**
- **`GET /api/checks/:id/receipt?share=A`** (guard: waiter; `share` optional) → `ReceiptView`:
  ```ts
  type ReceiptLine = { label: string /* "½", "2 ×", "" */; name: {en,tr}; options: {en,tr}[]; amount: number; comp: string|null /* reason key */ };
  type ReceiptView = {
    table: { name: string }; checkNo: string /* "0427" */; serverName: string|null; covers: number|null;
    printedAt: Date; openedAt: Date; closedAt: Date|null;
    share: { label: string; index: number; of: number } | null;
    lines: ReceiptLine[]; total: number; vat: { rate: 10|20; amount: number }[];
    payment: { method: "card"|"cash"; amount: number; at: Date; last4: string|null } | null;
    comps: { count: number; amount: number };   // active comps on the whole check
    paid: boolean;
  };
  ```
- **Lines:**
  - Whole check: one receipt line per bill line. `label` is `"${qty} ×"` when the charged qty is > 1; comped units become their own line at ₺0 with `comp` set; voided units are omitted.
  - `items` share: one line per (bill line, part size) group, with `label` = `fractionLabel(parts)` or `"${n} ×"` for whole units.
  - `even` share: a single line `{ label: fractionLabel(count), name: { en: "of check #0427 (₺X)", tr: "#0427 hesabın (₺X)" } }`, with the amount = the share.
- **VAT:**
  - whole check: `vatBreakdown(bill.grossByRate)`;
  - `items` share: the gross by rate of its parts;
  - `even` share: `allocate(share, [gross10, gross20])`, then `vatOf` per rate.
- **Payment:** the share's payment, or the check's full payment, or null (pre-payment print).
- `printedAt` is the server clock's now.

- [ ] **Step 1: Write the failing tests** in `receipt.test.ts`:
  - **Mixed check, paid in full by card:** the receipt total equals the payment amount; there are two VAT lines, and each equals `vatOf(gross at that rate)`; `payment.last4` is 4 digits.
  - **By item split:** share A with half the Burrata and the ribeye → lines `["½", "Burrata"]` and `["", "Dry-aged ribeye"]`; the total equals share A's paid amount.
  - **Even split of 4:** one line labelled "¼"; VAT amounts are allocated and each is ≤ the share's gross.
  - **A comp** shows as a ₺0 line with `comp: "celebration"`, and `comps.count` is 1.
  - **Pre-payment print:** `/print` on an open check → `payment: null`, `paid: false`.
  - **Unknown share label** → 404.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- receipt`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): receipt data per check or share with KDV per rate`.

### Task 8: Web: the close view

**Files:**
- Create: `apps/web/src/staff/close/*` (see the file structure).
- Modify:
  - `apps/web/src/router.tsx`: `/staff/check/:id/close`, guarded for waiters;
  - `apps/web/src/staff/floor/TableDetail.tsx`: Close check navigates to the close view;
  - `apps/web/src/staff/floor/CloseCheckDialog.tsx`: becomes `close/PayDialog.tsx` (title + amount props) and is deleted from `floor/`;
  - `apps/web/src/staff/floor/TableShape.tsx` / `Floor.tsx`: "Paying · 2 of 4";
  - `apps/web/src/staff/floor/types.ts`;
  - i18n.
- Test: `apps/web/test/staff/CloseView.test.tsx`

**Interfaces:**
- **Data:** consumes the Task 5 endpoints. Query key `["split", checkId]`. Live: refetch on `split.updated`, `adjustment.changed`, `check.updated` and `ticket.created`.
- **Layout:** per `phase-2-money.html`:
  - header "Close check · T4" with the total;
  - `ModeTabs` "In full / Evenly / By item" (a radiogroup with arrow keys; `aria-disabled` with an explanation when `locked`);
  - the mode body;
  - the progress strip "2 of 4 paid · ₺X left".
- **In full:** `PayDialog` → `POST /close`; on success, back to the floor.
- **Evenly:** a stepper for 2–20 (the initial N is the check's covers, or 2), `PUT split` on change (debounced 300 ms), share cards.
- **By item:**
  - a unit list on the left: lines with qty > 1 are expanded; each unit shows its letters;
  - selecting a unit then tapping letters toggles them, and each change is a `PUT split` with the full assignments;
  - "+ Guest" adds a letter;
  - the amber banner "N items not assigned · ₺X".
- **Share cards:** letter, lines with their parts (e.g. "½ Burrata"), amount, and **Take payment** → `PayDialog(amount)` → `POST pay` with that amount.
  - On `409 amount_changed`, the dialog shows "The amount changed to ₺X" and its confirm button takes the new amount.
  - A paid card shows "Paid · card" and a **Receipt** link (`/staff/check/:id/receipt?share=A`).
- **When the check closes:** a "Check closed" confirmation, then back to the floor.

- [ ] **Step 1: Write the failing tests** (use `mockFetch` and fake sockets from the harness):
  - **Evenly:** choosing Evenly with 3 shows three cards whose amounts are those the mock returns, and changing to 4 sends `PUT { mode: "even", count: 4 }`.
  - **By item:** select "Burrata", tap A then B → the PUT body has `{ unit, labels: ["A","B"] }`. The unassigned banner shows the mock's count and amount.
  - **Pay:** Take payment on A, choose Cash, confirm → POST `{ method: "cash", amount: <A's amount> }`. When the mock answers `409 amount_changed`, the dialog shows the new amount.
  - **Locked:** with `locked: true`, the In full and Evenly tabs are `aria-disabled`, and the explanation text is shown.
  - **Floor:** a floor table with `paying: { paid: 2, of: 4 }` has the accessible name containing "Paying · 2 of 4".
- [ ] **Step 2:** Run `npm test -w @lodos/web -- CloseView Floor`. Expected: FAIL.
- [ ] **Step 3:** Implement. Copy: EN "Close check", "In full", "Evenly", "By item", "Take payment", "Paid · {{method}}", "{{paid}} of {{of}} paid · {{left}} left", "Paying · {{paid}} of {{of}}". TR "Hesabı kapat", "Tek ödeme", "Eşit böl", "Ürüne göre", "Ödeme al", "Ödendi · {{method}}", "{{of}} kişiden {{paid}} ödedi · {{left}} kaldı", "Ödeniyor · {{paid}}/{{of}}".
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): close view with full, even and by-item split`.

### Task 9: Web: comps, voids and the approval pad; voids on the KDS

**Files:**
- Create: `apps/web/src/staff/adjust/AdjustDialog.tsx`, `ApproverPad.tsx`
- Modify:
  - `TableDetail.tsx`: tapping a line opens a small menu with Comp and Void, or "Comp only" with the reason when the line is ready or served; lines show the "Comp · reason" tag and a "1 voided" tag; managers get Undo on a tag;
  - `staff/kds/Ticket.tsx` + `types.ts`: voided units are struck through;
  - i18n.
- Test: `apps/web/test/staff/AdjustDialog.test.tsx`, `apps/web/test/staff/Ticket.test.tsx`

**Interfaces:**
- **`AdjustDialog`:**
  - kind radio (Comp: "Made and served, on the house"; Void: "Mistake, never made");
  - quantity stepper (1..free units);
  - reason chips from `COMP_REASONS` / `VOID_REASONS`; the note field appears for `other`;
  - then the approval.
- **Approval:**
  - A manager user sees a plain Confirm button.
  - Anyone else sees `ApproverPad`: manager name tiles from `GET /api/approvers` (preselected when there is exactly one), a 10-key pad with ⌫, and "Approve comp" / "Approve void".
  - In demo mode (`useDemo().isDemo`) the pad shows the demo hint verbatim.
- **Errors:** wrong PIN → "Wrong PIN" and the pad clears; 429 → the API message.
- **KDS:** a line with `voidedQty === qty` renders struck through with the visually-hidden text "voided". A partially voided line shows its quantity as `<s>3</s> 2`.

- [ ] **Step 1: Write the failing tests:**
  - **Waiter flow:** a waiter comps 1 gelato with reason Birthday, picks Selin, types 9999, approves → POST body `{ lineRef, kind: "comp", qty: 1, reason: "celebration", approval: { managerId, pin: "9999" } }`.
  - **Manager user:** no pad is shown.
  - **Demo hint:** with the demo info mock on, the text "Demo: Selin's PIN is 9999" is visible; with it off, it isn't.
  - **Other:** "Other" requires a note before Confirm is enabled.
  - **Ready line:** the menu offers only Comp, plus the text "Already made: comp it instead".
  - **KDS:** a fully voided line has the accessible text "voided" and a `<s>` element.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- AdjustDialog Ticket TableDetail`. Expected: FAIL.
- [ ] **Step 3:** Implement. Reason copy:

  | Key | EN | TR |
  |---|---|---|
  | celebration | Birthday / celebration | Doğum günü / kutlama |
  | complaint | Guest complaint | Misafir şikâyeti |
  | long_wait | Long wait | Uzun bekleme |
  | regular | Regular | Müdavim |
  | wrong_item | Wrong item | Yanlış ürün |
  | changed_mind | Guest changed mind | Misafir vazgeçti |
  | duplicate | Entered twice | İki kez girildi |
  | other | Other… | Diğer… |

- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): comp and void with manager PIN approval; voided lines on the KDS`.

### Task 10: Web: 80 mm receipt

**Files:**
- Create: `apps/web/src/staff/Receipt.tsx` (from `PrintCheck.tsx`; delete the old file and its test after porting the test cases)
- Modify: `router.tsx` (`/staff/check/:id/print` and `/staff/check/:id/receipt` both render `Receipt`), `styles/staff.css` (receipt print styles), i18n
- Test: `apps/web/test/staff/Receipt.test.tsx`

**Interfaces:**
- **Data:** `/print` reads `GET /api/checks/:id/print`; `/receipt?share=A` reads `GET /api/checks/:id/receipt?share=A`.
- **Layout:** follows the mockup's receipt top to bottom:
  - the wordmark, "Kemankeş Mah. · Karaköy, İstanbul" and "Demo restaurant, not real" (the demo notice only in demo mode);
  - "T4 · Guest A of 4";
  - "Check #0427", the date and time (`tr-TR`, Istanbul), the server;
  - the lines (label, name, options on their own line, amount);
  - TOTAL;
  - "incl. KDV 10%" and "incl. KDV 20%" with amounts;
  - the payment ("Card ····4821" or "Cash");
  - "Comps on this check: 1 · ₺260";
  - the footer, verbatim.
- **Print styles:** `@page { size: 80mm auto; margin: 4mm }` inside `@media print`. The receipt column is 72 mm wide, monospace for amounts. The toolbar is hidden when printing.
- **Behaviour:** the language follows the staff UI language. The print dialog opens once, as in phase 1 (`?noprint` skips it).

- [ ] **Step 1: Write the failing tests:**
  - every field above renders from a fixture;
  - the footer strings are verbatim;
  - with the UI in TR, the VAT label reads "KDV %10 dahil";
  - a pre-payment print has no payment line;
  - the print function is called once after load and never with `?noprint`.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- Receipt`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): 80 mm receipt per check or share`.

### Task 11: Part A end-to-end

**Files:**
- Create: `e2e/split-bill.spec.ts`, `e2e/comp-approval.spec.ts`
- Modify:
  - `e2e/close-check.spec.ts`: the close dialog is now the close view's In full mode;
  - `e2e/a11y.spec.ts`: add the close view, the approval pad and the receipt.
- Test: the specs above.

- [ ] **Step 1: Write the specs:**
  - **`split-bill`:** the waiter seats T7, orders Burrata ×1 + Negroni ×2, opens Close check → By item, puts the Burrata on A and B, one Negroni each, and pays A (card) and B (cash). T7 then shows Free on the floor, and the receipt for B shows "½ Burrata" and the footer.
  - **`comp-approval`:** a waiter session comps a dessert on T4 with Selin's PIN from the pad. The table detail shows "Comp · Birthday / celebration" and the line at ₺0.
  - **axe:** no serious or critical violations on the close view (each mode), the approval pad and the receipt.
- [ ] **Step 2:** Run `npm run test:e2e`. Expected: the new specs PASS, and so does every phase 1 spec.
- [ ] **Step 3:** Run `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 4:** Commit: `test(e2e): split by item, comp with manager approval`.

---

# Part B: Sales

Part B ends demo-able: a fresh demo copy opens Sales on 7 days, with full history, comparisons, charts, top dishes and a comps log.

### Task 12: Daily summaries

**Files:**
- Create:
  - `apps/api/src/db/models/dailySummary.ts`;
  - `apps/api/src/sales/summary.ts`;
  - `packages/shared/src/hours.ts`.
- Modify: `apps/api/src/db/models/index.ts`; `apps/api/src/app.ts` (the summary timer when `startJobs`)
- Test: `apps/api/test/summary.test.ts`, `packages/shared/test/hours.test.ts`

**Interfaces:**
- **`hours.ts`:**
  - `serviceHourIndex(hour: number): number` → `(hour − 6 + 24) % 24`;
  - `istanbulHour(at: Date): number`;
  - `SERVICE_HOURS`: `[6..23, 0..5]`.
- **`DailySummary`:**
  ```
  { tenantId, serviceDay: "YYYY-MM-DD" (unique per tenant), revenue, covers, checks,
    comps: {count, amount}, voids: {count, amount},
    byHour: [{ hour: 0..23, revenue, covers, checks, comps /* amount, comps + voids */ }],   // only hours with activity
    ticketTimes: { kitchen: [{ hour, count, totalMs }], bar: [...] },                       // hour = Istanbul hour of sentAt
    items: [{ itemId|null, name {en,tr}, qty, revenue }],                                 // charged qty and amount
    payments: { card: number, cash: number },
    generated: boolean }
  ```
- **`summarizeDay(models, serviceDay): Promise<SummaryData>`** (pure read, the same shape without ids):
  - **Revenue:** every payment (full or share) whose `at` falls in the service day.
  - **Checks and covers:** checks whose `closedAt` falls in it.
  - **Comps and voids:** active adjustments with that `serviceDay`.
  - **Ticket times:** tickets with `readyAt` set and `sentAt` in the day.
  - **Items:** the bill lines of the checks closed that day.
- **`ensureSummaries(models, days: string[], today: string): Promise<Map<string, SummaryData>>`:** reads the stored summaries, then computes and upserts the missing days that are before `today`. It never stores today.
- **`summaryJob(models, now)`:** for each tenant, `ensureSummaries([yesterday])`. The app runs it every 15 min when `startJobs`.

- [ ] **Step 1: Write the failing tests:**
  - **Live equals stored:** seed, place and pay three checks during a fake service day (moving the fixed clock), with one comp and one void. `summarizeDay` revenue = Σ payments, checks 3, covers summed, comps and voids correct, `byHour` buckets by Istanbul hour. `ensureSummaries` stores the same numbers it computed (spec §11: a stored summary equals a live computation of the same day).
  - **Review Focus 3, "payment time decides the service day":** a check opened 05:30 Istanbul and paid 06:10 counts on the new day. One paid at 05:59 counts on the previous day.
  - **Never store today:** `ensureSummaries` with today in the list doesn't store today.
  - **Shared:** `serviceHourIndex(6) === 0`, `serviceHourIndex(5) === 23`.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- summary` and `npm test -w @lodos/shared -- hours`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): daily sales summaries by service day and hour`.

### Task 13: Demo history and tonight's paid checks

**Files:**
- Create: `apps/api/src/sales/history.ts`
- Modify: `apps/api/src/seed/seed.ts` (call it for live-service seeds; add paid checks earlier tonight)
- Test: `apps/api/test/history.test.ts`, `apps/api/test/seed.test.ts`

**Interfaces:**
- **`generateHistory(models, { tenantId, now, items, tables, staff }): Promise<void>`:**
  - writes 60 `DailySummary` documents (`generated: true`) for the 60 service days before today;
  - writes 10–16 past `Adjustment` log entries spread over the last 30 days (`checkId: null`). Each generated day's comp and void totals include exactly the entries dated that day.
- **Deterministic:** a `mulberry32` PRNG seeded with `now.getTime() % 2**32`. The same `now` gives identical documents.
- **Shape:**
  - Mondays closed (zero revenue, summary still stored);
  - Fri/Sat about 1.6× Tue/Wed;
  - 45–110 covers a night (60 seats, some turns);
  - average per cover ₺700–1,000;
  - revenue hours 17:00–00:00, peaking 20:00–21:00;
  - kitchen ticket times 9–14 min, peaking 20:00–21:00, at most one hour a week above 15 min; bar 4–7 min;
  - item quantities drawn from the seeded menu, weighted toward signatures (ribeye, burrata, Negroni);
  - payments about 80% card.
  - The day's revenue = Σ `byHour` revenue = Σ item revenue (allocate the remainder to the top item).
- **Live seed:** 3–5 checks closed earlier tonight (between 17:30 and `now`, real `Check` + `Order` + `Ticket` documents, `status: "paid"`), on tables not used by the live-service tables. One of them has a comp. Skipped when `now` is before 18:00 Istanbul (nothing could have closed yet).

- [ ] **Step 1: Write the failing tests:**
  - 60 summaries; generating twice with the same `now` gives identical numbers;
  - every day reconciles (Σ byHour = revenue = Σ items revenue);
  - average per cover on non-zero days is within ₺700–1,000;
  - Monday revenue is 0;
  - the comps total of a generated day equals the adjustment entries dated that day;
  - a live seed at 21:00 Istanbul has ≥ 3 paid checks today, and `summarizeDay(today)` revenue > 0;
  - the seed test's existing live-service assertions (one calling, one bill, one ready) still hold.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- history seed`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS. Also check the sandbox creation time in `sandboxes.test.ts` stays under 1.5 s with history (one `insertMany` per collection).
- [ ] **Step 5:** Commit: `feat(seed): 60 days of believable sales history per sandbox`.

### Task 14: Sales API and CSV export

**Files:**
- Create: `apps/api/src/sales/service.ts`, `apps/api/src/sales/routes.ts`
- Modify: `apps/api/src/app.ts`; remove `/api/manager/tonight` and `manager/tonight.ts`, moving their test cases that still apply
- Test: `apps/api/test/sales.test.ts`

**Interfaces:**
- **`GET /api/sales?range=today|7d|30d`** (guard: manager) → `SalesView`:
  ```ts
  type Totals = { revenue; covers; checks; avgPerCover; avgPerCheck; comps: {count, amount}; voids: {count, amount}; compsPct: number /* one decimal */ };
  type SalesView = {
    range; from: string; to: string;                 // service days, inclusive
    current: Totals; previous: Totals;               // previous = the same-length period before (today: same weekday last week, up to this hour)
    byHour: { hour: number; revenue: number }[];     // average per night over days with checks > 0, in SERVICE_HOURS order, hours with any revenue
    ticketTimes: { kitchen: { hour; avgMin }[]; bar: { hour; avgMin }[] }; thresholdMin: number;  // from settings.lateMin
    topItems: { name; qty; revenue }[];              // top 5 by qty
    log: { at; kind; itemName; tableName; reason; note; requestedByName; approvedByName; amount; reversed: boolean }[]; // newest first, max 50
  };
  ```
  - Today is always computed live with `summarizeDay`; past days come from `ensureSummaries`.
- **`GET /api/sales/export.csv?range=…`** (guard: manager):
  - `text/csv; charset=utf-8`, with `Content-Disposition: attachment; filename="lodos-sales-<from>-<to>.csv"`;
  - BOM first, then the header `service_day,closed_at,table,covers,server,gross,comps,voids,total,payment_methods`;
  - one row per paid check whose last payment is in the range;
  - every text field quoted; amounts in lira with a dot and two decimals; `closed_at` as Istanbul `YYYY-MM-DD HH:MM`;
  - `payment_methods` like `card+cash`.
  - Generated history has no checks, so CSV rows exist only for real checks (the export says so in the README, not in the file).

- [ ] **Step 1: Write the failing tests:**
  - **Periods:** `7d` → `from`..`to` is 7 service days ending today; `previous` covers the 7 before, and the test counts the days used.
  - **Today:** at 21:30, the previous period sums last week's same weekday buckets for hours 6..21 only.
  - **Service-day boundary:** a payment at 05:59 on day D+1 is in D (the range respects 06:00).
  - **CSV rows:** match the paid checks (count and totals).
  - **Review Focus 4, "CSV starts with a BOM and quotes Turkish names":** a server named "Şule Çınar" round-trips quoted, and the file starts with `﻿`.
  - **Guard:** a waiter → 403.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- sales`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): sales ranges with comparisons, CSV export`.

### Task 15: Web: Sales page

**Files:**
- Create: `apps/web/src/staff/sales/*`
- Modify: `router.tsx` (`/staff/sales`; `/staff/tonight` redirects to it), `Shell.tsx` rail ("Sales" replaces "Tonight"), i18n; delete `manager/Tonight.tsx` and its tests
- Test: `apps/web/test/staff/Sales.test.tsx`; `e2e/sales.spec.ts`

**Interfaces:**
- **Layout:** per `phase-2-manage.html`:
  - range tabs Today / 7 days / 30 days (default 7 days);
  - four tiles with the change vs the previous period (▲/▼ + % in text, never colour alone);
  - "Revenue by hour" as hand-rolled SVG bars, with the peak hour bar red and labelled "Peak";
  - "Ticket times by hour", two SVG lines (kitchen, bar) with a dashed threshold line labelled "15 min";
  - Top dishes;
  - Comps & voids log;
  - **Export CSV**, a plain download link.
- **Accessibility:** each chart has a `<figure>` with a `figcaption`, and a visually-hidden table with the same numbers.

- [ ] **Step 1: Write the failing tests:**
  - **Component:** with a fixture, the tiles show the formatted amounts and "▲ 12%"; the peak bar has the accessible name with "Peak"; the hidden table lists every hour; the CSV link points at `/api/sales/export.csv?range=7d`; switching to Today requests `range=today`.
  - **e2e (`sales.spec.ts`):** a fresh demo copy as manager → Sales shows a non-zero 7-day revenue, at least 5 revenue bars, and at least one log row. axe on the page.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- Sales`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web && npm run test:e2e -- sales`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): Sales dashboard replaces Tonight`.

---

# Part C: Staff, shifts and floor plan

Part C ends demo-able: a fresh demo copy has a full team, two weeks of shifts with one 47 h warning, downloadable PDFs, and an editable floor plan.

### Task 16: Staff model and API

**Files:**
- Create: `packages/shared/src/staff.ts`, `apps/api/src/staff/service.ts`, `apps/api/src/staff/routes.ts`
- Modify:
  - `packages/shared/src/schemas.ts`: `StaffRole` gains `cook | bartender | host | dishwasher`;
  - `apps/api/src/db/models/staff.ts`: `pinHash` optional; `lastSignInAt`; `demoProtected` (default false);
  - `auth/routes.ts`: a successful `POST /api/auth/pin` sets `lastSignInAt` (approvals don't);
  - `auth/routes.ts`: the login picker lists login and station roles only;
  - `auth/guard.ts`;
  - `realtime/io.ts`: every staff socket also joins `personRoom(tenantId, staffId)`; schedule-only roles have no rooms;
  - `realtime/emit.ts`: a `"person"` audience resolves to `personRoom` for each id in `payload.ids`;
  - `packages/shared/src/events.ts`: `personRoom`, `"session.ended"`;
  - `seed/content.ts` + `seed.ts`: the team, below.
- Test: `apps/api/test/staff.test.ts`

**Interfaces:**
- **`staff.ts` (shared):**
  - `LOGIN_ROLES = ["waiter", "manager"]`, `STATION_ROLES = ["kitchen", "bar"]`, `SCHEDULE_ROLES = ["cook", "bartender", "host", "dishwasher"]`;
  - `isLoginRole(role)` (login or station);
  - `tableRanges(names: string[]): string` → e.g. `"B1–B3, T5–T10"`: sorted by prefix then number, consecutive numbers collapsed, en dash.
- **`GET /api/staff`** (guard: manager) → `{ people: StaffRow[], stations: StaffRow[] }`. People are active first by name, then inactive. `StaffRow`:
  ```
  { id, name, role, active, lastSignInAt, tables: { id, name, roomId }[], tableRanges, demoProtected, canDeactivate: boolean, whyNot: string|null }
  ```
- **`POST /api/staff`** `{ name, role, pin?, tableIds? }`:
  - `pin` is required for waiter and manager and refused for schedule roles;
  - station roles → 400 (stations are fixed);
  - the name must be unique among active staff (case-insensitive, `tr` locale) → `409 name_taken`.
- **`PATCH /api/staff/:id`** `{ name?, role?, pin?, tableIds? }`:
  - changing from a schedule role to waiter or manager requires `pin` → `400 pin_required`;
  - changing to a schedule role removes `pinHash` and ends their sessions;
  - `tableIds` moves those tables' `sectionStaffId` to this person, taking them from whoever had them;
  - a station account accepts nothing but `pin` (via the PIN route);
  - the last active manager can't become a non-manager → `409 last_manager`.
- **`POST /api/staff/:id/pin`** `{ pin }`: a manager resets anyone's PIN, stations included.
- **`POST /api/staff/:id/deactivate`:**
  - errors: self → `409 self`; the last active manager → `409 last_manager`; a station → `409 station`; demo mode and `demoProtected` → `409 demo_protected`;
  - otherwise it deletes their sessions, sets `sectionStaffId: null` on their tables, emits `session.ended` to `person` [id] and `tables.changed` to floor and manager, and disconnects their sockets (`io.in(personRoom).disconnectSockets(true)`);
  - the response includes `unassignedTables: string[]`.
- **`POST /api/staff/:id/reactivate`:** name uniqueness is re-checked.
- **Seed team:**

  | Name | Role |
  |---|---|
  | Deniz (protected) | waiter |
  | Mert | waiter |
  | Selin (protected) | manager |
  | Kitchen (protected) | station |
  | Bar (protected) | station |
  | Emre Yıldız, Zeynep Arslan, Burak Şahin | cook |
  | Ece Demir, Can Özkan | bartender |
  | İpek Aydın | host |
  | Hasan Kılıç | dishwasher |

  All names are fictional.

- [ ] **Step 1: Write the failing tests:**
  - **Picker:** the login picker has no cooks.
  - **Schedule-only roles can't sign in:** `POST /api/auth/pin` for a cook → 401, and the attempt counts toward the lockout like any wrong PIN.
  - **Add:** a waiter "Ayla" with PIN and tables T1 and T2 takes T1 and T2 from Deniz; `/api/staff` shows `tableRanges` "T1–T2" for Ayla.
  - **Escalation needs a PIN:** a cook → waiter without a PIN → `400 pin_required`; with a PIN → they can sign in.
  - **Deactivation rules:** deactivating yourself → `409 self`; the last manager → `409 last_manager`; in demo mode Deniz → `409 demo_protected` while Mert → 200.
  - **Names:** a duplicate active name ("deniz") → `409 name_taken`.
  - **Review Focus 5, "deactivation ends sessions and sockets":** Mert signed in with a socket connected; deactivate Mert → his next `GET /api/floor` → 401; the socket received `session.ended` and was disconnected; his tables have `sectionStaffId: null`.
  - **Last sign-in:** `lastSignInAt` is set on login.
  - **Shared:** `tableRanges(["T10", "B2", "T5", "B1", "B3", "T6"])` → `"B1–B3, T5–T6, T10"`.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- staff` and `npm test -w @lodos/shared`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api && npm test -w @lodos/shared`. Expected: PASS (isolation and auth tests included).
- [ ] **Step 5:** Commit: `feat(api): staff management, schedule-only roles, deactivation`.

### Task 17: Web: Staff screen

**Files:**
- Create: `apps/web/src/staff/people/*`
- Modify:
  - `router.tsx`: `/staff/people`, manager only;
  - `Shell.tsx`: a "Staff" rail item;
  - `lib/socket.ts` (or the staff shell): on `session.ended`, clear the auth cache and go to `/staff/login?ended=1`, which shows "You were signed out by a manager";
  - i18n.
- Test: `apps/web/test/staff/People.test.tsx`

**Interfaces:**
- **List:** per `phase-2-manage.html`. Columns: name, role, tables (ranges), last sign-in (relative), status. Inactive rows come last, muted. A "Stations" section has Reset PIN only.
- **Add/Edit (`StaffForm`):**
  - name;
  - the role segmented control: Waiter, Manager, Cook, Bartender, Host, Dishwasher;
  - PIN + confirm (shown when required);
  - `TableChips`: chips grouped by room. Another waiter's tables are dashed with their initials; tapping one moves it over.
- **Deactivate:**
  - opens a confirm dialog that lists the tables that will be unassigned;
  - when `canDeactivate` is false, the button is disabled with `whyNot` shown as text;
  - after success, the screen says "T5–T10 are now unassigned".

- [ ] **Step 1: Write the failing tests:**
  - rows render ranges and roles;
  - choosing Cook hides the PIN fields;
  - Cook → Waiter shows them and requires them;
  - a dashed chip moves to the edited waiter in the PATCH body;
  - Deactivate shows `whyNot` for a protected account;
  - a `session.ended` socket event navigates to login with the message.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- People`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): staff screen`.

### Task 18: Shifts core

**Files:**
- Create:
  - `packages/shared/src/shifts.ts`;
  - `apps/api/src/db/models/shift.ts`, `shiftTemplate.ts`;
  - `apps/api/src/shifts/service.ts`, `routes.ts`.
- Modify: `models/index.ts`, `seed/seed.ts` (templates + two weeks of shifts), `schemas.ts`
- Test: `packages/shared/test/shifts.test.ts`, `apps/api/test/shifts.test.ts`

**Interfaces:**
- **`shifts.ts` (shared):**
  - `SHIFT_AREAS = ["salon", "bar", "terrace", "kitchen", "bar_station"]`;
  - `SHIFT_LIMITS = { maxShiftH: 16, weekH: 45, dayH: 11, restH: 11 }`;
  - `weekDays(monday: string): string[]` (7 service days);
  - `mondayOf(serviceDay: string): string`.
  - **`shiftSpan(serviceDay, start "HH:MM", end "HH:MM"): { start: Date; end: Date }`:**
    - a start hour < 6 is on the next calendar day;
    - an end ≤ start is on the following day;
    - Istanbul is UTC+3 all year (same as `serviceDayStart`).
  - `shiftMinutes(s)`.
  - **`scheduleWarnings(shifts: { id, staffId, serviceDay, start: Date, end: Date }[], opts: { week: string[]; inactive: Set<string> }): Warning[]`**, where `Warning = { kind: "week_hours"|"day_hours"|"rest"|"inactive"; staffId; shiftIds: string[]; minutes?: number }`. Each limit is flagged only when strictly exceeded (rest: when strictly under).
- **Shift document:** `{ tenantId, staffId, serviceDay, start, end, area, note|null }`, index `{ tenantId, serviceDay }`.
- **ShiftTemplate document:** `{ tenantId, name, start, end, area, sort }`. Seeded: "Dinner 17:00–01:00 Salon", "Prep 12:00–17:00 Kitchen", "Double 12:00–01:00 Salon", "Bar 18:00–02:00 Bar".
- **`GET /api/shifts?week=<monday>`** (manager) → `{ week, days, people: { id, name, role, group: "floor"|"kitchen"|"bar"|"managers", active }[], shifts: ShiftRow[], totals: { byPerson: Record<id, minutes>, byDay: Record<day, minutes> }, warnings: Warning[] }`.
  - Groups: waiter and host → floor; cook and dishwasher → kitchen; bartender → bar; manager → managers.
  - People = active non-station staff, plus inactive people who have shifts that week.
- **Writes:**
  - `POST /api/shifts` `{ staffId, serviceDay, start, end, area, note? }` and `PATCH /api/shifts/:id` (any subset, including a move to another person or day);
  - errors: end ≤ start after the span rule can't happen; > 16 h → `400 shift_too_long`; overlap with the same person → `409 shift_overlap` with the other shift's id; station staff → 400;
  - `DELETE /api/shifts/:id`.
- **`POST /api/shifts/copy-last-week`** `{ week }` → `{ copied, skipped }`. It copies week−7 shifts (+7 days) for active people and skips overlaps.
- **Templates:** CRUD at `/api/shift-templates`.
- **`GET /api/me/shifts`** (any login role) → `{ weeks: [{ week, shifts, minutes }] }` for this week and next, own shifts only.
- **Seed:** this week and next (relative to `now`). Every person has 4–5 shifts. Ece Demir reaches 47 h this week (one warning). Nobody else triggers a warning.

- [ ] **Step 1: Write the failing tests:**
  - **Shared:**
    - `shiftSpan("2026-11-10", "17:00", "01:00")` → 17:00 Nov 10 to 01:00 Nov 11 Istanbul, 480 min;
    - `shiftSpan("2026-11-10", "02:00", "04:00")` starts Nov 11 02:00 and belongs to the 10th;
    - week hours: 45 h exactly → no warning; 45 h 1 min → `week_hours`;
    - day hours: 11 h → none; 11 h 30 → `day_hours`;
    - rest: 11 h between shifts → none; 10 h 59 → `rest`;
    - an inactive person's shift → `inactive`.
  - **API:**
    - overlap → 409;
    - 17 h → 400;
    - cross-midnight daily totals count on the start day;
    - copy-last-week with one clashing shift → `{ copied: n-1, skipped: 1 }`;
    - `GET /api/me/shifts` as Deniz returns only Deniz's;
    - a waiter calling `GET /api/shifts` → 403;
    - the seeded week has exactly one `week_hours` warning, for Ece Demir.
- [ ] **Step 2:** Run `npm test -w @lodos/shared -- shifts` and `npm test -w @lodos/api -- shifts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both test commands. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): weekly shifts, templates, warnings, copy last week`.

### Task 19: Shift PDFs

**Files:**
- Create:
  - `apps/api/src/shifts/pdf.ts`, `fonts.ts`;
  - `apps/api/assets/fonts/{Inter-Regular.ttf, Inter-SemiBold.ttf, OFL.txt}`.
- Modify:
  - `apps/api/package.json`: `pdfkit` dependency; `pdfjs-dist` dev dependency;
  - `shifts/routes.ts`;
  - `Dockerfile`: `COPY --from=build /app/apps/api/assets ./apps/api/assets`.
- Test: `apps/api/test/shifts.pdf.test.ts`

**Interfaces:**
- **`fontPath(file)`:** resolves `apps/api/assets/fonts/<file>` by walking up from `import.meta.url` to the directory that holds the API's `package.json`. It works from `src/` (tests) and `dist/` (production).
- **`weekRosterPdf(data, lang): Promise<Buffer>`:**
  - A4 landscape;
  - the title "Lodos · Week of 9–15 Nov 2026" (TR "Lodos · 9–15 Kasım 2026 haftası");
  - the grid: groups and people down the side, Mon–Sun across;
  - cells "17:00–01:00 Salon"; amber-outlined cells for warnings, plus a legend;
  - person totals and day totals.
- **`personalPdf(data, lang)`:** A4 portrait. The person's name, the week, rows of date · day name · start–end · area · note, and the total hours.
- **`allPersonalPdf`:** one page per person who has shifts.
- **Day names:** come from `Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", { weekday: "long" })`.
- **Routes** (all `application/pdf` with an attachment filename):
  - `GET /api/shifts/pdf/week?week=&lang=`;
  - `GET /api/shifts/pdf/person/:staffId?week=&lang=`;
  - `GET /api/shifts/pdf/people?week=&lang=` (manager);
  - `GET /api/me/shifts/pdf?week=&lang=` (self).

- [ ] **Step 1: Write the failing tests.** Extract the text with `pdfjs-dist/legacy/build/pdf.mjs`:
  - the TR week roster for the seeded week contains "Çarşamba", "Kasım" and "İpek Aydın";
  - the EN personal PDF for Deniz contains each of his shift times and his total hours, and no other person's name;
  - the people PDF page count = the number of people with shifts;
  - responses have `content-type: application/pdf` and `content-disposition` with `.pdf`;
  - a waiter fetching another person's PDF → 403.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- shifts.pdf`. Expected: FAIL.
- [ ] **Step 3:** Vendor the fonts (download the official Inter release zip, copy the two static TTFs and `OFL.txt`), then implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Then build the Docker image and fetch a week PDF from the container. Expected: tests PASS; the container returns a PDF.
- [ ] **Step 5:** Commit: `feat(api): week roster and personal shift PDFs with Turkish glyphs`.

### Task 20: Web: Schedule and My shifts

**Files:**
- Create: `apps/web/src/staff/schedule/*`
- Modify: `router.tsx` (`/staff/schedule` manager; `/staff/my-shifts` any login role), `Shell.tsx` rail, i18n
- Test: `apps/web/test/staff/Schedule.test.tsx`, `apps/web/test/staff/MyShifts.test.tsx`

**Interfaces:**
- **Header:** the week picker (previous / next / "This week"), Copy last week (reports "Copied 12 · skipped 1"), Templates, and the PDF menu (Week roster / All personal PDFs).
- **Grid:** people grouped Floor / Kitchen / Bar / Managers down the side, days across; person totals on the right and day totals at the foot. A warning summary sits above the grid ("Ece Demir: 47 h this week (limit 45)").
- **Blocks:** start–end + area. Warning blocks have an amber outline and an icon, with the warning in their accessible name.
- **Adding:** tapping an empty cell opens `ShiftSheet` with the person and day prefilled: template chips or start/end times, area, note, Save/Delete.
- **Dragging:** pointer events move a block to another cell; on drop, PATCH `{ staffId, serviceDay }`.
- **Non-drag equivalent:** focus a block, then press `M` (or the "Move" button in the sheet). Arrow keys pick the target cell, Enter confirms, Esc cancels. A live region announces the target.
- **Per-person PDF:** a download icon on each person row.
- **My shifts:** this week and next as lists, with hours and a "Download PDF" link.

- [ ] **Step 1: Write the failing tests:**
  - the grid renders the fixture's totals;
  - the warning summary text renders;
  - tapping an empty cell opens the sheet prefilled; choosing a template and saving POSTs the template's times;
  - a keyboard move (M, ArrowRight, Enter) PATCHes `serviceDay` + 1;
  - a `409 shift_overlap` shows "Overlaps another shift for Deniz";
  - My shifts lists both weeks and links the PDF.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- Schedule MyShifts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): weekly schedule with drag and keyboard moves; My shifts`.

### Task 21: Floor plan API

**Files:**
- Create: `apps/api/src/layout/service.ts`, `routes.ts`
- Modify:
  - `db/models/room.ts`: `width`, `height`, `version`;
  - `seed/seed.ts`: room sizes;
  - `schemas.ts`;
  - `packages/shared/src/events.ts`: `"layout.saved"`.
- Test: `apps/api/test/layout.test.ts`

**Interfaces:**
- **`GET /api/rooms/:id/layout`** (manager) → `{ room: { id, name, width, height, version }, tables: [{ id, name, shape, x, y, w, h, capacity, sectionStaffId, openCheck: boolean }], nextNames: { T: string, B: string } }`.
- **`PUT /api/rooms/:id/layout`** `{ version, tables: [{ id?: string, key: string, name, shape: "round"|"rect", x, y, w, h, capacity, sectionStaffId|null }] }`. Active tables of the room that are missing from the list are soft-deleted.
  - **Validation**, all problems at once → `400 layout_invalid` with `details.problems: [{ key, code }]`:
    - `name_invalid`: does not match `TABLE_NAME_RE`;
    - `name_taken`: across the tenant, inactive tables included, excluding itself;
    - `out_of_bounds`: not within `0..width/height`;
    - `overlap`: rectangles intersect (round uses its bounding box);
    - `capacity`: outside 1..12;
    - `open_check_rename`: renamed while it has an open check, including a prefix change;
    - `open_check_delete`: deleted while it has an open check.
  - **One transaction:** `Room.updateOne({ _id, version }, { $inc: { version: 1 } })`; zero matched → `409 version_conflict`. Then the inserts (new 32-byte base64url tokens), updates and soft deletes.
  - **Emits:** `layout.saved` + `tables.changed` to floor and manager.
  - **Response:** the new layout.
- **Rooms:**
  - `POST /api/rooms { name }`; `PATCH /api/rooms/:id { name }`;
  - `DELETE /api/rooms/:id`: any active table → `409 room_not_empty`; deleted rooms are removed (rooms have no history).

- [ ] **Step 1: Write the failing tests:**
  - **Move:** moving T7 saves and bumps `version`.
  - **Concurrent saves:** two saves with the same version → the second gets `409 version_conflict`.
  - **Overlap:** two overlapping tables → 400 with both keys reported.
  - **Bounds:** out of bounds → 400.
  - **Open checks:** a table with an open check can be moved, but renaming it → `open_check_rename` and deleting it → `open_check_delete`.
  - **Soft delete:** a deleted table becomes `active: false`, and its past checks still resolve its name on `/print`.
  - **New tables:** a new table gets a token and `nextNames.T` advances past the inactive T17.
  - **Rooms:** deleting a room with tables → 409.
  - **Events:** a waiter socket receives `tables.changed` after a save.
  - **Isolation:** the tests cover the new routes.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- layout`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): versioned room layouts with validation`.

### Task 22: Web: Floor plan editor

**Files:**
- Create: `apps/web/src/staff/floorplan/*`
- Modify:
  - `router.tsx`: `/staff/floor-plan`, manager only;
  - `Shell.tsx`: rail item;
  - `staff/manager/QrSheet.tsx`: accepts `?table=<id>` to print one table;
  - `staff/floor/Floor.tsx`: refetches on `layout.saved`;
  - i18n.
- Test: `apps/web/test/staff/FloorPlan.test.tsx`, `apps/web/test/staff/geometry.test.ts`

**Interfaces:**
- **`geometry.ts`:** `snap(v, grid = 16)`, `clampInto(rect, room)`, `overlaps(a, b)`, `guidesFor(moving, others): { x?: number; y?: number }[]` (aligned edges and centres within 4 px).
- **`useLayoutDraft(roomId)`:** holds the server layout plus local edits. It exposes `changes` (a count), `move`, `add(shape)`, `update`, `duplicate`, `remove`, `discard` and `save()`.
  - On `409 version_conflict`: it shows "Someone else saved this room. Reloading their version." and reloads.
  - On `400 layout_invalid`: it highlights the problem tables and lists the problems.
- **Canvas:** an SVG at the room size with a 16 px dot grid. Drag uses pointer events with pointer capture, snapping; an x/y readout and guides show while dragging.
- **Keyboard:** each table is a focusable button. Tab moves through them; arrows move 16 px; Shift+arrows 64 px; Delete removes. Moves are announced in a live region.
- **Toolbar:** Add Round / Square / Booth; room tabs; "+ Room" and Rename; "2 unsaved changes"; Discard; Save layout.
- **Inspector:**
  - name, shape (Round / Square / Booth), seats (1–12), waiter;
  - Duplicate, Delete, "QR code for this table" (link to `/staff/tables/qr?table=<id>`);
  - for a table with an open check, the disabled fields carry the reason: "Has an open check: it can move, but not be renamed or removed".
- **Leaving with unsaved changes** asks for confirmation (React Router `useBlocker`).

- [ ] **Step 1: Write the failing tests:**
  - **`geometry.test`:** `snap(23)` → 16, `snap(25)` → 32; overlap edge cases (touching is not overlapping); guides found within 4 px.
  - **`FloorPlan.test`:**
    - ArrowRight on a focused table moves it 16 and the counter shows "1 unsaved change";
    - Save sends the PUT with the version;
    - a mocked 409 shows the reload message and refetches;
    - a mocked `layout_invalid` marks the named table `aria-invalid`;
    - Add Booth creates "B6" from `nextNames.B`;
    - Shape → Booth on an open-check table is disabled with the reason.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- FloorPlan geometry`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): floor plan editor with drag, keyboard and versioned save`.

### Task 23: Part C end-to-end, docs

**Files:**
- Create: `e2e/schedule.spec.ts`, `e2e/floor-plan.spec.ts`
- Modify: `e2e/a11y.spec.ts` (Staff, Schedule, My shifts, Floor plan); `README.md` (phase 2 features, the receipt note, CSV note, fonts licence); new screenshots `docs/screenshots/{close-check,sales,schedule}.png`
- Test: the specs above.

- [ ] **Step 1: Write the specs:**
  - **`schedule`:** the manager adds a Dinner shift for Mert on Thursday from a template, sees his total change, and downloads the week PDF (`page.waitForEvent("download")`; the file starts with `%PDF`).
  - **`floor-plan`:** the manager moves T7 two grid steps right with the keyboard and saves; a second (waiter) context in the same sandbox sees T7's position change without reloading.
  - **axe:** no serious or critical violations on the four new screens.
- [ ] **Step 2:** Run `npm run test:e2e`. Expected: all specs PASS.
- [ ] **Step 3:** Run `npm run lint && npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 4:** Update the README and take the screenshots (dev ports 4100/5180 only).
- [ ] **Step 5:** Commit: `test(e2e): schedule and floor plan; docs for phase 2`.
