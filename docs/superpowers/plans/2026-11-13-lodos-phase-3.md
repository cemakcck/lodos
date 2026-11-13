# Lodos Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 turns Lodos into a management system. It adds:
- guest ratings for the waiter, each dish, and the restaurant (food, cleanliness, atmosphere);
- a PIN time clock with hourly wages and labour cost;
- staff performance and rankings;
- expenses and budgets;
- a "Today first" manager overview;
- a monthly business dashboard with PDF and CSV export;
- about 4 months of demo history behind all of it.

**Architecture:** The plan extends the phase 2 monorepo in place.
- **Pure arithmetic in `packages/shared`:** labour cost and overtime, attendance status, the score formula and the menu quadrant are pure functions, unit-tested to the kuruş and the minute.
- **Three new raw collections:** `Rating`, `ClockEntry` and `Expense` (plus `ExpenseCategory`).
- **Two sources per day:**
  - Generated demo history stores *aggregates* on the existing `DailySummary` (new fields).
  - Live days are computed from raw documents.
  - One reader, `opsForDays`, merges the two, so every dashboard reads seeded and live data the same way (spec §13.1).
- **Sales facts that never change after payment** (per-server checks, covers and sales; on-time tickets) are computed by `summarizeDay` and stored like phase 2's.
- **Ratings and labour are always read live from raw documents**, because they can arrive or change after a day closes. The exception is `generated` summaries, which hold them as aggregates.
- **The P&L is one function, `monthlyPnl`.** The overview strip and the monthly page both call it, so they cannot disagree.

**Tech Stack:** As in phase 2: Node 22, TypeScript strict, React 19 + Vite, Fastify 5, Socket.IO 4, Mongoose, Zod 4, Vitest, Playwright + axe, pdfkit with the vendored Inter fonts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-lodos-phase-3-design.md`. Read it fully before any task, including §13 (clarifications). It extends the phase 1 and phase 2 specs in the same folder. Mockups: `docs/design-reference/phase-3-overview.html` (layout **A** only) and `docs/design-reference/phase-3-monthly.html`.

## Global Constraints

Everything in the phase 1 and phase 2 plans' Global Constraints still holds: repo and identity, commit trailers, money in kuruş, Istanbul time and the 06:00 service day via `serviceDayOf`, EN + TR copy in `en.json` and `tr.json`, the staff design standard, WCAG 2.2 AA, isolation tests for every new endpoint and event, every new collection in `TENANT_SCOPED_MODELS` with `tenantPlugin`, and wall-clock-independent tests (fixed clock). In addition:

- **Branch:** work on `feat/phase-3`, created from `main`. Never push or merge without the owner's go-ahead.
- **Ports:** never use 3000 or 3100. Dev runs on 4100 (API) and 5180 (web). e2e uses the ports in `e2e/playwright.config.ts`.
- **Commit trailers:**
  - `Co-Authored-By: <your model name> <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_01G1gUztbjonzCYopjxcu6K3`
- **Ratings:**
  - Integers **1–5**.
  - The restaurant categories are exactly `food`, `cleanliness` and `atmosphere`. The **restaurant rating** = the mean of the three category averages.
  - Comment max **500** characters.
  - One rating per check, enforced by a unique index.
  - Accepted only for a **paid** check of the requesting table, within **24 h** of `closedAt`.
- **Time clock:**
  - Late = in more than **5 min** after the shift start.
  - Missing = shift started, still not in after **15 min**.
  - An open entry older than **16 h** = "forgot to clock out?", excluded from hours until fixed.
  - Overtime = clocked hours beyond **45** in a Monday–Sunday week (by service day), paid at **1.5×**.
- **Wages:**
  - Hourly rate in kuruş.
  - Rate history on the staff document; a rate applies from the moment it is saved.
  - An entry is priced at the rate in force at its clock-in.
  - Labour cost of an entry = `round(minutes × rate / 60)`, plus `round(overtimeMinutes × rate / 120)` for the 0.5× premium, each rounded half up to the kuruş.
- **Money reconciles:** profit = sales − food and drink cost − labour − other costs, exactly, in kuruş. Food and drink cost is the expense categories of kind `food_drink`.
- **Privacy:**
  - Hourly rates and other people's performance never reach a non-manager.
  - `/api/me/performance` returns only the caller's data. Its rank is `{ position, of }` with no names.
- **Copy (verbatim):**
  - Restaurant categories: EN "Food", "Cleanliness", "Atmosphere"; TR "Yemek", "Temizlik", "Atmosfer".
  - Rating card title: EN "How was your visit?", TR "Ziyaretiniz nasıldı?".
  - Thanks: EN "Thanks for your rating!", TR "Değerlendirmeniz için teşekkürler!".
  - Menu groups: EN "Stars", "Hidden gems", "Fix", "Rethink"; TR "Yıldızlar", "Gizli hazineler", "Düzeltilmeli", "Gözden geçir".
  - Not enough data: EN "Not enough data yet", TR "Henüz yeterli veri yok".

## Rulings made while planning (owner can veto)

- **Rollup storage.** `DailySummary` gains four fields:
  - `byServer: [{ staffId, checks, covers, sales }]`, computed live like the rest.
  - `ticketTimes.*[].onTime`: tickets ready within the late threshold.
  - `ratings`: the aggregate shape below.
  - `people: [{ staffId, minutes, overtimeMinutes, labourCost, shifts, lateShifts, stationTickets, stationOnTime, dishRatingSum, dishRatingCount }]`.

  `ratings` and `people` are filled **only on generated days**. On live days, `opsForDays` computes them from raw `Rating` and `ClockEntry` documents. Summaries stored before phase 3 read the new fields as empty.
- **Rating aggregate shape:**
  ```
  { waiter: [{ staffId, sum, count, dist: [n1..n5] }],
    dishes: [{ itemId|null, name {en,tr}, sum, count, dist }],
    food | cleanliness | atmosphere: { sum, count, dist } }
  ```
- **Raw seed windows:** ratings for the last **14** days and clock entries for the last **35** days are raw documents. Older days are aggregates on generated summaries. A day never has both.
- **History length:** `HISTORY_DAYS` goes from 60 to **120**.
- **Budgets:** one `monthlyBudget` (kuruş) per category. It applies to every month and is changed by editing the category.
- **"Month":** the service days whose date is in that calendar month (`YYYY-MM`). The current month is "so far". It compares with the previous month's days **1 … the same day number**, capped at that month's length.
- **Station attribution (spec §13.4):** each kitchen or bar ticket is credited to the cooks (or bartenders) clocked in at its `sentAt`, split equally. Each dish rating is credited the same way, at the paying check's `closedAt`, to the station that makes the dish.
- **Score formula (spec §5 leaves it to the builder). All points are on a 0–100 scale:**
  - **Waiters:**
    - rating: `50 × (avg − 1) / 4`;
    - workload: `35 × coversPerHour / bestCoversPerHourInGroup`;
    - reliability: `15 × (1 − lateShifts / shifts)`.
  - **Kitchen and bar:**
    - dish rating: `50 × (avg − 1) / 4`;
    - throughput: `20 × ticketsPerHour / bestInGroup`;
    - on time: `15 × onTime / tickets`;
    - reliability: `15 × (1 − lateShifts / shifts)`.
  - **Rounding:** each component is rounded to 1 decimal. Score = the sum of the rounded components, displayed to 1 decimal.
  - **Minimums to be ranked:** waiters need **5** waiter ratings and **2** shifts; kitchen and bar need **10** dish ratings and **2** shifts.
  - **Ties** break by name.
- **Manager landing:** `/staff` sends a manager to `/staff/overview`, which becomes the first rail item for managers. P2's Sales stays.
- **Routes (web):**
  - `/staff/overview`
  - `/staff/business` (monthly)
  - `/staff/performance` and `/staff/performance/:staffId`
  - `/staff/expenses`
  - `/staff/timesheets` (manager clock-entry editing)
  - `/staff/my-performance` (any login role)
  - `/staff/clock`: the time clock. No session needed; it is linked from the login screen.
- **New socket events:**
  - `clock.changed` → `manager`;
  - `rating.created` → `manager`;
  - `expense.changed` → `manager`.

## Review Focus

1. **A guest rates while a second phone at the table rates the same check.** Exactly one rating is stored. The other gets `409 already_rated` and the card shows "Thanks". Test: Task 2, "parallel rating submissions store one".
2. **A shift crosses midnight and the person clocks out at 01:10.** The entry stays on the service day it started, overtime counts in that week, and the overview shows them "finished", not "missing". Test: Task 4, "a cross-midnight entry belongs to its start's service day".
3. **A manager changes someone's hourly rate on the 15th.** Earlier entries keep the old rate. The month's labour = Σ entries at their own rates. An edit of an earlier entry reprices it at the rate in force at its new start. Test: Task 4, "rate change mid-month prices each entry at its clock-in rate".
4. **A waiter opens `/api/me/performance` or `/api/performance/ranking`.** The first returns only their own numbers, `rank: { position, of }`, and no names. The second returns `403`. Hourly rates never appear in any non-manager response. Test: Task 10, "staff only ever see their own performance".
5. **It's the 1st of the month at 08:00.** The monthly page and the overview strip show "so far" numbers compared with the previous month's day 1. They show a ₺0-ish profit, not a crash or a divide by zero. The margin shows "—" when sales are 0. Test: Task 12, "first day of the month compares with day 1 and handles zero sales".

---

## File structure (new and changed)

```
packages/shared/src/
  ratings.ts        RATING_CATEGORIES, RatingAgg type, mergeAgg, avgOf, restaurantRating
  labour.ts         entryCost, allocateOvertime, rateAt, attendanceStatus, TIME_CLOCK limits
  performance.ts    scoreWaiter, scoreStation, rankGroup, SCORE_MINIMUMS
  business.ts       menuQuadrant, pctChange, monthDays, comparisonDays
  schemas.ts        + request schemas for every new endpoint
  events.ts         + "clock.changed", "rating.created", "expense.changed"
apps/api/src/
  db/models/rating.ts clockEntry.ts expense.ts expenseCategory.ts          (new)
  db/models/dailySummary.ts staff.ts index.ts                             (changed)
  ratings/service.ts ratings/routes.ts       guest rating card + submit, manager hide/unhide
  timeclock/service.ts timeclock/routes.ts   clock in/out, clock PIN, manager entries, rates
  ops/daily.ts                               opsForDays: generated aggregates + raw docs, per day
  sales/summary.ts sales/history.ts          byServer, onTime; 120 days; ratings/people aggregates
  expenses/service.ts expenses/routes.ts
  performance/service.ts performance/routes.ts
  business/pnl.ts business/monthly.ts business/overview.ts business/pdf.ts business/routes.ts
  seed/ops-seed.ts                           raw ratings, clock entries, expenses, rates, today's states
apps/web/src/
  guest/RateVisit.tsx                        (shown on VisitEnded for the visit this page adopted)
  staff/timeclock/   TimeClock.tsx Timesheets.tsx queries.ts
  staff/expenses/    Expenses.tsx ExpenseForm.tsx Categories.tsx queries.ts
  staff/performance/ Ranking.tsx Person.tsx MyPerformance.tsx Breakdown.tsx queries.ts
  staff/business/    Overview.tsx Monthly.tsx sections/*.tsx queries.ts
  staff/people/      StaffForm.tsx (+ hourly rate, clock PIN)
  router.tsx Shell.tsx i18n/en.json i18n/tr.json                          (changed)
```

---

# Part A: Guest ratings

Part A ends demo-able: a guest pays and rates T4's waiter, two dishes and the restaurant. The rating is stored once.

### Task 1: Data model and shared rating helpers

**Files:**
- Create:
  - `packages/shared/src/ratings.ts`;
  - `apps/api/src/db/models/{rating,clockEntry,expense,expenseCategory}.ts`.
- Modify:
  - `apps/api/src/db/models/{dailySummary,staff,index}.ts`;
  - `packages/shared/src/{events,index}.ts`.
- Test: `packages/shared/test/ratings.test.ts`, `apps/api/test/tenancy.test.ts` (extend)

**Interfaces:**
- **Produces, shared:**
  - `RATING_CATEGORIES = ["food","cleanliness","atmosphere"] as const`
  - `type Agg = { sum: number; count: number; dist: [number,number,number,number,number] }`
  - `type RatingAgg` (the shape in Rulings)
  - `emptyAgg(): Agg`
  - `addStar(a: Agg, stars: 1|2|3|4|5): Agg`
  - `mergeAgg(a: Agg, b: Agg): Agg`
  - `mergeRatingAgg(a: RatingAgg, b: RatingAgg): RatingAgg`, merging waiter and dish rows by id (dishes by `itemId`, falling back to `name.en`)
  - `avgOf(a: Agg): number | null` (null when count 0)
  - `restaurantRating(r: RatingAgg): number | null`, the mean of the non-null category averages
- **`Rating` model:**
  ```
  { tenantId, checkId: ObjectId|null, tableId|null, serviceDay, paidAt: Date, submittedAt: Date,
    serverStaffId|null, waiter: 1..5|null, dishes: [{ itemId|null, name{en,tr}, station, stars }],
    food|cleanliness|atmosphere: 1..5|null, comment: string|null, commentHidden: boolean, generated: boolean }
  ```
  Indexes: unique `{tenantId, checkId}` with `partialFilterExpression: { checkId: { $type: "objectId" } }`; `{tenantId, serviceDay}`.
- **`ClockEntry` model:**
  ```
  { tenantId, staffId, serviceDay, in: Date, out: Date|null, rate: number /* kuruş/h at clock-in */,
    edits: [{ at, byStaffId, reason, before: {in,out} }], generated: boolean }
  ```
  Indexes: `{tenantId, staffId, in}`; a unique partial index `{tenantId, staffId}` where `out: null`, so a person can't have two open entries.
- **`ExpenseCategory`:** `{ tenantId, name {en,tr}, kind: "food_drink"|"other", monthlyBudget: number, sort, archived: boolean }`.
- **`Expense`:** `{ tenantId, categoryId, amount (kuruş, >0), date: "YYYY-MM-DD", payee: string|null, note: string|null, createdBy }`. Index `{tenantId, date}`.
- **`Staff` gains:**
  - `rates: [{ from: Date, kurusPerHour: number }]` (default `[]`);
  - `clockPinHash?: string`.
- **`DailySummary` gains:** `byServer`, `ratings` and `people` (Rulings shapes, defaults empty), and `onTime: Number` (default 0) on each ticket-hour row.
- **Events:** add `"clock.changed"`, `"rating.created"` and `"expense.changed"` to `EVENTS`.

- [ ] **Step 1: Write the failing tests:**
  - **Shared:** `restaurantRating` of food 4.0, cleanliness 5.0 and atmosphere with no ratings = 4.5. `avgOf(emptyAgg())` = null. `mergeRatingAgg` sums the same waiter across two days.
  - **Tenancy:** the four new models appear in `TENANT_SCOPED_MODELS`, and a query without a tenant context throws.
  - **Indexes:** a second `Rating` with the same `checkId` → duplicate key. Two seeded ratings with `checkId: null` are both accepted. A second open `ClockEntry` for one person → duplicate key.
- [ ] **Step 2:** Run `npm test -w @lodos/shared -- ratings` and `npm test -w @lodos/api -- tenancy`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS (the existing suites included).
- [ ] **Step 5:** Commit: `feat(db): ratings, clock entries, expenses and rollup fields`.

### Task 2: Guest rating API and comment moderation

**Files:**
- Create: `apps/api/src/ratings/{service,routes}.ts`
- Modify: `apps/api/src/app.ts` (register), `packages/shared/src/schemas.ts`, `apps/api/test/isolation-http.test.ts`, `isolation-socket.test.ts`
- Test: `apps/api/test/ratings.test.ts`

**Interfaces:**
- **`GET /api/guest/rating?checkId=` (guestRoute)** → `{ state: "open"|"done"|"closed", waiter: { name } | null, dishes: [{ itemId, name }] }`:
  - `closed`: the check is not this table's, not paid, or more than 24 h past `closedAt`.
  - `done`: a rating exists.
  - Dishes are the distinct items with units still on the bill after voids (comped units count). Use `billOf`.
- **`POST /api/guest/ratings` (guestRoute)**, body `GuestRatingBody`:
  ```
  { checkId, waiter?: 1..5, dishes?: [{ itemId, stars }], food?, cleanliness?, atmosphere?, comment?: ≤500 }
  ```
  - At least one star value is required, else `400`.
  - A dish not on the bill → `400 invalid_dish`.
  - A closed check → `409 rating_closed`. An existing rating → `409 already_rated`.
  - Stores `serverStaffId` = the check's `serverStaffId` at payment time, `serviceDay = serviceDayOf(closedAt)`, `paidAt = closedAt`, and each dish's `station`.
  - Emits `rating.created` to `manager`.
  - Rate limit: `hit(models, "rating-ip:<ip>", 20, 10 min)`.
- **`POST /api/ratings/:id/hide` and `/unhide` (staffRoute `[]`, so manager only)** toggle `commentHidden`, then return `{ id, commentHidden }`.
- **`ratingAggForDays(models, days: string[]): Promise<Map<string, RatingAgg>>`** in `ratings/service.ts` reads raw ratings only. Task 7 consumes it.

- [ ] **Step 1: Write the failing tests** (seed a tenant, seat, order two dishes, void one unit of a third, close):
  - The card for an open check → `closed`. After payment → `open`, with the two dishes and not the fully voided one.
  - Submitting `{waiter:5, dishes:[…4], food:5, cleanliness:4, atmosphere:5, comment:"Lovely"}` → `201`, and the stored fields match.
  - **Review Focus 1, "parallel rating submissions store one":** `Promise.all` of two posts → one `201`, one `409 already_rated`, one document.
  - 24 h + 1 min after `closedAt` → `409 rating_closed`. Another table's token → `closed` / `409`.
  - An empty body → `400`. A dish not on the bill → `400`.
  - Hide sets `commentHidden: true`, and a waiter session gets `403`.
  - Isolation entries for the new routes and the `rating.created` event.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- ratings`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): guest ratings for waiter, dishes and the restaurant`.

### Task 3: Web: the guest rating card

**Files:**
- Create: `apps/web/src/guest/RateVisit.tsx`
- Modify: `apps/web/src/guest/VisitEnded.tsx` (render `RateVisit` when the ended visit was paid), `apps/web/src/i18n/{en,tr}.json`
- Test: `apps/web/test/guest/RateVisit.test.tsx`

**Interfaces:**
- **Consumes:** Task 2's endpoints.
- **`RateVisit({ checkId }: { checkId: string })`:**
  - Star inputs: radio groups of 5 with visible labels; arrow keys move between stars.
  - One group each for: waiter (with their name), each dish, and Food, Cleanliness and Atmosphere.
  - An optional comment, with a character counter out of 500.
  - Submit is disabled until one star is set.
  - States: `open` → the form; `done` or after submit → "Thanks for your rating!"; `closed` → nothing.

- [ ] **Step 1: Write the failing tests:**
  - It renders the title "How was your visit?".
  - Arrow keys change the selected star.
  - Submit posts the selected values only.
  - A `409 already_rated` shows the thanks message.
  - In TR, the labels are "Yemek", "Temizlik" and "Atmosfer".
  - No axe violations (the existing web axe helper).
- [ ] **Step 2:** Run `npm test -w @lodos/web -- RateVisit`. Expected: FAIL.
- [ ] **Step 3:** Implement in the guest "Plum Salon" style.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): rating card after the visit is paid`.

# Part B: Time clock, wages, expenses

Part B ends demo-able:
- Mert clocks in late with his PIN.
- The manager sets hourly rates, fixes a forgotten clock-out and enters an expense.

### Task 4: Shared labour arithmetic

**Files:**
- Create: `packages/shared/src/labour.ts`
- Test: `packages/shared/test/labour.test.ts`

**Interfaces (all pure, minutes are integers):**
- **Constants:** `TIME_CLOCK = { lateGraceMin: 5, missingAfterMin: 15, forgotOutH: 16, weekH: 45, overtimeFactor: 1.5 } as const`.
- **`rateAt(rates: {from: Date; kurusPerHour: number}[], at: Date): number`:** the latest `from ≤ at`, or 0.
- **`entryMinutes(e: {in: Date; out: Date|null}, now: Date): number | null`:**
  - an open entry → null;
  - an open entry older than `forgotOutH` → null as well (the caller flags it);
  - otherwise `round((out − in) / 60000)`.
- **`allocateOvertime(entries: {id: string; staffId: string; serviceDay: string; minutes: number; in: Date}[]): Map<string, number>`:** per staff and per Monday–Sunday week (`mondayOf(serviceDay)`), it walks the entries in `in` order. Minutes beyond 2700 (45 h) are overtime and are allocated to the entries that cross the line. Returns overtime minutes per entry id.
- **`entryCost(minutes: number, overtimeMinutes: number, rate: number): number`:** `round(minutes × rate / 60) + round(overtimeMinutes × rate / 120)`.
- **`type Attendance = "on_shift"|"late"|"missing"|"later"|"finished"|"unscheduled"|"forgot_out"`**
- **`attendanceStatus(shift: {start: Date; end: Date} | null, entries: {in: Date; out: Date|null}[], now: Date): { status: Attendance; lateMin?: number }`:**
  - `late` while clocked in after `start + 5 min`, i.e. arrived late but present. The minutes late = `in − start`.
  - `missing` when `now > start + 15 min` and there is no entry.
  - `later` when `now < start`.
  - `finished` after the last entry is closed.
  - `forgot_out` when an entry is open past 16 h.
  - `unscheduled` when there is an entry but no shift.

- [ ] **Step 1: Write the failing tests:**
  - Edges: clock-in at `start + 5:00` is `on_shift`; at `start + 5:01` it is `late` with `lateMin: 5`. With no entry, `now = start − 1 min` is `later`; `now = start + 15:00` is not yet `missing`; `now = start + 15:01` is `missing`.
  - **Review Focus 2, "a cross-midnight entry belongs to its start's service day":** 17:00–01:10 → 490 min, and `finished` at 02:00.
  - **Overtime:** six 8 h entries in one week → the sixth has 300 overtime minutes. A week whose Monday is 30 Sept and that ends in October allocates overtime to the October entries in time order.
  - **Review Focus 3, "rate change mid-month prices each entry at its clock-in rate":** `rateAt` before and after a `from`; `entryCost(480, 0, 20000)` = 160000; `entryCost(480, 60, 20000)` = 170000.
  - `forgot_out` at 16 h + 1 min.
- [ ] **Step 2:** Run `npm test -w @lodos/shared -- labour`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(shared): labour cost, overtime and attendance status`.

### Task 5: Time clock API, clock PINs and hourly rates

**Files:**
- Create: `apps/api/src/timeclock/{service,routes}.ts`
- Modify:
  - `apps/api/src/staff/{service,routes}.ts` (rate and clock PIN);
  - `apps/api/src/app.ts`;
  - `packages/shared/src/schemas.ts`;
  - the isolation tests.
- Test: `apps/api/test/timeclock.test.ts`, `apps/api/test/staff.test.ts` (extend)

**Interfaces:**
- **Consumes:** Task 4's functions, `loginTenant`, `verifyPin`, `hit`/`clearHits`.
- **`GET /api/clock/people` (no session; tenant from `loginTenant`)** → `[{ id, name, clockedIn: boolean }]`:
  - everyone active who is on the schedule (`scheduleGroupOf(role) !== null`);
  - station accounts are excluded.
- **`POST /api/clock/punch` `{ staffId, pin }` (no session)** → `{ action: "in"|"out", at, minutesToday }`:
  - PIN check: `pinHash` for login roles, `clockPinHash` for schedule-only roles.
  - Lockout: the same `pin:<tenant>:<staffId>` key and limits as login, plus a per-IP limit.
  - Toggles: with no open entry it creates one with `rate = rateAt(rates, now)` and `serviceDay = serviceDayOf(now)`; otherwise it closes the open one.
  - An open entry past 16 h is not closed by a punch. It returns `409 forgot_clock_out` ("ask your manager").
  - It never creates a session. It emits `clock.changed` to `manager`.
- **Manager routes (staffRoute `[]`):**
  - `GET /api/timesheets?week=` → per person: entries with minutes, overtime minutes, cost, an `edited` flag and their shift.
  - `POST /api/timesheets/entries` `{ staffId, in, out, reason }`.
  - `PUT /api/timesheets/entries/:id` `{ in, out, reason }`: pushes `{at, byStaffId, reason, before}` to `edits`, re-derives `serviceDay`, and **reprices `rate = rateAt(rates, newIn)`**.
  - `DELETE` is not offered.
- **Staff:**
  - `PUT /api/staff/:id/rate` `{ kurusPerHour }` pushes `{from: now, kurusPerHour}`.
  - `POST /api/staff/:id/clock-pin` `{ pin }` is for schedule-only roles; a login role gets `400`.
  - `listStaff` rows gain `hourlyRate` (current) and `hasClockPin`. Rows only go to managers (already true).
- **`labourForDays(models, days: string[], now: Date): Promise<Map<string, PersonDay[]>>`** in `timeclock/service.ts`:
  - `PersonDay = { staffId, minutes, overtimeMinutes, labourCost, shifts, lateShifts }`;
  - computed from raw entries;
  - overtime allocated over the whole weeks touching `days`;
  - late per shift via `attendanceStatus`.

  Task 7 consumes it.

- [ ] **Step 1: Write the failing tests:**
  - A punch in, then a punch out → one closed entry with the minutes.
  - A wrong PIN 5 times → locked, the same as login.
  - A cook with a clock PIN can punch, and `POST /api/auth/pin` for the cook still fails.
  - A punch on an entry open > 16 h → `409 forgot_clock_out`.
  - A manager edit records history and reprices at the new start's rate.
  - `labourForDays` over a week with a mid-week rate change sums to the per-entry costs (Review Focus 3 at the API level).
  - `GET /api/clock/people` excludes the Kitchen and Bar station accounts.
  - Isolation: another tenant's staff id → `404`.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- timeclock staff`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): PIN time clock, clock PINs, hourly rates and timesheets`.

### Task 6: Web: time clock, timesheets, and rate and clock PIN on the Staff screen

**Files:**
- Create: `apps/web/src/staff/timeclock/{TimeClock,Timesheets,queries}.tsx`
- Modify:
  - `apps/web/src/staff/Login.tsx` (a "Clock in / out" link);
  - `apps/web/src/staff/people/StaffForm.tsx` (hourly rate and, for schedule-only roles, a clock PIN via `PinFields`);
  - `router.tsx`, `Shell.tsx` (a "Timesheets" rail item, manager);
  - i18n.
- Test: `apps/web/test/staff/TimeClock.test.tsx`, `Timesheets.test.tsx`, `People.test.tsx` (extend)

**Interfaces:**
- **Consumes:** Task 5's endpoints.
- **`/staff/clock`:**
  - Pick a name, then enter the PIN on the same keypad as login.
  - Result: "Clocked in 10:58" or "Clocked out, 7 h 12 min today".
  - A `409 forgot_clock_out` shows "You were never clocked out. Ask your manager to fix your last shift."
  - It returns to the picker after 5 s.
- **`/staff/timesheets`:**
  - A week picker (the same component as Schedule).
  - A row per person: entries against the planned shift, an "edited" badge, overtime, and cost.
  - "Add entry" and "Edit" open a dialog with a required reason.

- [ ] **Step 1: Write the failing tests:** the picker lists names from `/api/clock/people`, the punch result text, the forgot-out message, the edit dialog requiring a reason, the StaffForm showing a clock PIN only for schedule-only roles, and axe clean.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- TimeClock Timesheets People`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): time clock, timesheets, hourly rates and clock PINs`.

### Task 7: Rollup fields and the daily ops reader

**Files:**
- Create: `apps/api/src/ops/daily.ts`
- Modify: `apps/api/src/sales/summary.ts` (`byServer`, `onTime`)
- Test: `apps/api/test/summary.test.ts` (extend), `apps/api/test/ops-daily.test.ts`

**Interfaces:**
- **`summarizeDay`:**
  - `byServer` comes from the checks closed that day, keyed by `serverStaffId`. `sales` = the payments on those checks.
  - Each ticket-hour row gains `onTime` = tickets with `readyAt − sentAt ≤ lateMin` (from settings).
- **`type DayOps = { serviceDay; ratings: RatingAgg; people: PersonDay[]; byServer; ticketTimes; generated }`**.
- **`opsForDays(models, days: string[], now: Date): Promise<Map<string, DayOps>>`:**
  - **Generated summary:** use its stored `ratings` and `people`, then merge in any raw ratings and entries for that day. By construction there are none (Rulings), but merging keeps it correct.
  - **Live day:** `ratingAggForDays` (Task 2) and `labourForDays` (Task 5), plus station attribution. Every ticket in the day is split among the station's people clocked in at `sentAt`; dish ratings are split among those clocked in at the rating's `paidAt` for that dish's station. Fill `stationTickets`, `stationOnTime`, `dishRatingSum` and `dishRatingCount`.
  - Sales fields come from `ensureSummaries`.

- [ ] **Step 1: Write the failing tests:**
  - `byServer` sums equal the day's checks, covers and revenue.
  - `onTime` counts a ticket at exactly `lateMin` as on time.
  - Two cooks overlapping for one hour each get half of that hour's tickets; a cook alone gets all of them.
  - A rating submitted the day after payment counts on the payment's service day.
  - A generated summary's aggregates come back unchanged.
  - "Counts match": on a day with raw ratings, `DayOps.ratings` counts equal the documents.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- summary ops-daily`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): per-server and on-time rollups, daily ops reader`.

### Task 8: Expenses and budgets API

**Files:**
- Create: `apps/api/src/expenses/{service,routes}.ts`
- Modify: `apps/api/src/app.ts`, `packages/shared/src/schemas.ts`, the isolation tests
- Test: `apps/api/test/expenses.test.ts`

**Interfaces (all staffRoute `[]`, manager only):**
- **Expenses:**
  - `GET /api/expenses?month=YYYY-MM&categoryId=` → `{ expenses: [...], byCategory: [{ categoryId, name, kind, spent, budget }], total, budgetTotal }`.
  - `POST /api/expenses` and `PUT|DELETE /api/expenses/:id`. Amount is an integer > 0 in kuruş, and the date must be a valid `YYYY-MM-DD` that is not in the future.
  - `GET /api/expenses.csv?month=` uses phase 2's CSV conventions (BOM, `csvField`, plain lira).
- **Categories:**
  - `GET|POST /api/expense-categories` and `PUT /api/expense-categories/:id` `{ name, kind, monthlyBudget, archived }`.
  - Archive instead of delete. A category in use can't change `kind` (`409`).
- **Seed hook:** `seedExpenseCategories(models)` creates the 7 categories in spec §6:
  - `food_drink`: Suppliers – food, Suppliers – drinks;
  - `other`: Rent, Utilities, Repairs and maintenance, Marketing, Other.
- **`expensesForMonth(models, month): Promise<{ foodDrink: number; other: number; byCategory: … }>`** is consumed by Task 12.
- Every write emits `expense.changed` to `manager`.

- [ ] **Step 1: Write the failing tests:** CRUD; a future date → `400`; `byCategory` sums; CSV with a BOM and a Turkish category name quoted; a waiter → `403`; isolation.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- expenses`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/api`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): expenses, categories and monthly budgets`.

### Task 9: Web: Expenses screen

**Files:**
- Create: `apps/web/src/staff/expenses/{Expenses,ExpenseForm,Categories,queries}.tsx`
- Modify: `router.tsx`, `Shell.tsx` (an "Expenses" rail item, manager), i18n
- Test: `apps/web/test/staff/Expenses.test.tsx`

**Interfaces:**
- **Consumes:** Task 8.
- **Page contents:**
  - a month picker;
  - spending against budget per category (bars with visible numbers);
  - the expense list with a category filter;
  - "Add expense" (amount in lira, converted to kuruş with the existing `price.ts` helpers), category, date, payee and note;
  - a Categories dialog (name EN/TR, kind, monthly budget);
  - CSV export.

- [ ] **Step 1: Write the failing tests:** adding an expense posts kuruş, an over-budget category is flagged with text (not colour only), and axe clean.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- Expenses`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): expenses and budgets screen`.

# Part C: Performance, overview, monthly dashboard

Part C ends demo-able: in a fresh demo copy the manager lands on the overview, opens the ranking and a person's breakdown, then reads last month on the monthly page and exports it as PDF. Deniz sees only "My performance".

### Task 10: Performance scoring and API

**Files:**
- Create:
  - `packages/shared/src/performance.ts`;
  - `apps/api/src/performance/{service,routes}.ts`.
- Modify: `apps/api/src/app.ts`, the isolation tests
- Test: `packages/shared/test/performance.test.ts`, `apps/api/test/performance.test.ts`

**Interfaces:**
- **Shared:**
  - `SCORE_MINIMUMS = { waiter: { ratings: 5, shifts: 2 }, station: { ratings: 10, shifts: 2 } }`.
  - `type Breakdown = { key: "rating"|"workload"|"reliability"|"throughput"|"onTime"; points: number; max: number; value: number }[]`.
  - `scoreWaiter(input: { ratingAvg; ratingCount; covers; minutes; shifts; lateShifts }, bestCoversPerHour: number): { score: number; breakdown: Breakdown } | { score: null; reason: "not_enough_data" }`.
  - `scoreStation(input: { dishAvg; dishCount; tickets; onTime; minutes; shifts; lateShifts }, bestTicketsPerHour: number)`, with the same return type.
  - `rankGroup(rows)` sorts by score descending, then by name. Unranked rows go last.
  - The formulas are as in Rulings.
- **API:**
  - **Periods:** `period=week|month&key=YYYY-MM-DD|YYYY-MM` (default this week). Aggregate `opsForDays` over the period's days.
  - `GET /api/performance/ranking` (manager) → `{ groups: { floor: Row[], kitchen: Row[], bar: Row[] } }`, where `Row = { staffId, name, role, score, breakdown, ratingAvg, ratingCount, minutes, plannedMinutes, lateShifts }`. Hosts, dishwashers and managers aren't ranked, so they're not listed here.
  - `GET /api/performance/:staffId` (manager) → that `Row`, plus weekly points history for the last 8 weeks, the ratings trend, and the visible and hidden comments about them (waiters: `Rating.serverStaffId`).
  - `GET /api/me/performance` (any login role) → `{ score, breakdown, ratingAvg, ratingCount, minutes, plannedMinutes, lateShifts, rank: { position, of } | null, comments }`. Comments are visible ones only. There are **no other staff fields anywhere in the response**.

- [ ] **Step 1: Write the failing tests:**
  - **Shared:**
    - the breakdown sums to the score;
    - 4 ratings → `not_enough_data`;
    - workload normalises per hour, so a part-timer with the same covers per hour scores the same;
    - ties break by name.
  - **Review Focus 4, "staff only ever see their own performance":**
    - Deniz's `/api/me/performance` JSON contains no other staff id or name, and no `kurusPerHour`/`hourlyRate` key at any depth (walk the object);
    - Deniz's call to `/api/performance/ranking` → `403`.
  - Isolation entries.
- [ ] **Step 2:** Run `npm test -w @lodos/shared -- performance` and `npm test -w @lodos/api -- performance`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: staff performance scores, rankings and my performance`.

### Task 11: Web: ranking, person page, My performance

**Files:**
- Create: `apps/web/src/staff/performance/{Ranking,Person,MyPerformance,Breakdown,queries}.tsx`
- Modify:
  - `router.tsx`;
  - `Shell.tsx`: a "Performance" item (manager) and a "My performance" item (waiter, beside My shifts);
  - i18n.
- Test: `apps/web/test/staff/Performance.test.tsx`

**Interfaces:**
- **Consumes:** Task 10, and Task 2's hide/unhide.
- **`Breakdown`:** a stacked bar out of 100, plus a table of each component's points and max (the text equivalent).
- **Ranking:**
  - three tabs: Floor, Kitchen, Bar;
  - a period picker (this week, this month, past months);
  - unranked rows show "Not enough data yet".
- **Person page:**
  - hours actual against planned;
  - lateness;
  - the rating trend with a table equivalent;
  - points history;
  - comments, each with a Hide/Unhide button.
- **My performance:** the caller's score and breakdown, "2nd of 6 waiters", hours, lateness, and visible comments.

- [ ] **Step 1: Write the failing tests:** the breakdown table sums to the score shown; Hide calls the API and greys the comment; My performance renders "2nd of 6" in EN and "6 garsondan 2." in TR; axe clean.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- Performance`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): rankings, person page and my performance`.

### Task 12: P&L, monthly dashboard data, PDF and CSV

**Files:**
- Create:
  - `packages/shared/src/business.ts`;
  - `apps/api/src/business/{pnl,monthly,pdf,routes}.ts`.
- Modify: `apps/api/src/app.ts`, the isolation tests
- Test: `packages/shared/test/business.test.ts`, `apps/api/test/business.test.ts`, `apps/api/test/business.pdf.test.ts`

**Interfaces:**
- **Shared:**
  - `monthDays(month: "YYYY-MM", today: string): string[]`, capped at `today` for the current month.
  - `comparisonDays(month, today): string[]`, from Rulings ("Month").
  - `pctChange(cur, prev): number | null`, null when prev is 0.
  - `menuQuadrant(dishes: {qty; ratingAvg: number|null}[]): ("stars"|"hidden_gems"|"fix"|"rethink"|null)[]`:
    - the quantity threshold is the median of `qty`;
    - the rating threshold is **4.0**;
    - `ratingAvg` null → null;
    - `qty ≥ median` counts as "sells a lot", and `rating ≥ 4.0` counts as "high".
- **`monthlyPnl(models, month, now): Promise<Pnl>`**, where `Pnl = { sales, foodDrink, labour, other, otherByCategory, profit, margin: number|null }`:
  - sales come from `ensureSummaries`;
  - labour is Σ `people.labourCost` from `opsForDays`;
  - expenses come from `expensesForMonth`;
  - `profit = sales − foodDrink − labour − other`.
- **`monthlyView(models, month, now)`** → `{ month, soFar: boolean, current, previous, pnl: {cur, prev}, sales: { byDay, byWeekday, byHour, avgCheck, avgCover, covers, salesPerLabourHour, turnsPerNight }, menu: [{ itemId, name, qty, revenue, ratingAvg, ratingCount, group }], staff: [...rows as Task 10 plus labourCost], labourByGroup, overtimeMinutes, ratings: { restaurant, food, cleanliness, atmosphere, dist: {restaurant, waiter, dish}, byWeek, comments (visible, latest 10) }, expenses: { byCategory, biggest (top 5) } }`.
  - "Table turns per night" = checks ÷ active tables ÷ open nights.
  - Every `current` figure has a `previous` counterpart.
- **Routes (manager):**
  - `GET /api/business/monthly?month=`
  - `GET /api/business/monthly.pdf?month=&lang=en|tr`: A4 portrait, pdfkit, with the section tables and simple bar charts drawn with rectangles, reusing `shifts/fonts.ts`.
  - `GET /api/business/monthly.csv?month=&section=menu|staff|expenses|days`

- [ ] **Step 1: Write the failing tests:**
  - **Reconciliation:** on a hand-made month, `pnl.profit === sales − foodDrink − labour − other` exactly, and `margin = profit / sales`.
  - **Quadrant:** median and 4.0 edges.
  - **Review Focus 5, "first day of the month compares with day 1 and handles zero sales":** 1st at 08:00 with no sales yet → margin null, `pctChange` null where prev is 0, and no throw.
  - **Current month:** `soFar: true`, and the previous month is compared on days 1…N.
  - **PDF:** its parsed text (via `pdfjs-dist`, as the shift PDF test does) contains the month name in TR, "Yemek", and the profit figure formatted the same as the JSON.
  - **CSV:** a BOM, then the menu section with the group column.
- [ ] **Step 2:** Run `npm test -w @lodos/shared -- business` and `npm test -w @lodos/api -- business`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): monthly P&L, business dashboard data, PDF and CSV`.

### Task 13: Web: monthly business dashboard

**Files:**
- Create: `apps/web/src/staff/business/{Monthly,queries}.tsx`, `apps/web/src/staff/business/sections/{Pnl,SalesPatterns,MenuQuadrant,StaffTable,Ratings,ExpensesSection}.tsx`
- Modify: `router.tsx`, `Shell.tsx` (a "Business" item, manager), i18n
- Test: `apps/web/test/staff/Monthly.test.tsx`

**Interfaces:**
- **Consumes:** Task 12, and Task 2's hide.
- **Layout:** the six sections in the order of `phase-3-monthly.html`.
- **Controls:** a month picker (◀ ▶, no later than this month), and PDF and CSV links.
- **"So far":** the current month shows a "so far" label and "vs the same days last month".
- **Charts:**
  - charts use the same approach as P2's Sales page (`HourBars`);
  - every chart has a table or visible numbers;
  - change arrows have text ("↑ 6% vs September"), not colour only.

- [ ] **Step 1: Write the failing tests:**
  - all six section headings render;
  - the P&L row adds up visually: the rendered numbers equal the JSON;
  - the four groups appear with their TR names;
  - month navigation stops at the current month;
  - axe clean.
- [ ] **Step 2:** Run `npm test -w @lodos/web -- Monthly`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w @lodos/web`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): monthly business dashboard`.

### Task 14: Manager overview ("Today first")

**Files:**
- Create: `apps/api/src/business/overview.ts`, `apps/web/src/staff/business/Overview.tsx`
- Modify:
  - `apps/api/src/business/routes.ts`;
  - `router.tsx` (`/staff` → `/staff/overview` for managers);
  - `Shell.tsx` (Overview is the first manager rail item);
  - i18n.
- Test: `apps/api/test/overview.test.ts`, `apps/web/test/staff/Overview.test.tsx`

**Interfaces:**
- **`GET /api/business/overview` (manager)** → `{ today: { sales, salesPrev, covers, coversPrev }, rating7d: { restaurant, prev }, month: Pnl & { budgetTotal, expensesTotal }, working: [{ staffId, name, role, status, lateMin?, in?, shift? }], topStaff: { floor, kitchen, bar } (top 3), expenses: { total, budget, latest: 3 }, dishes: { best: 3, needsWork: [...] } }`:
  - `today` reuses `salesView(models, "today", now)`;
  - `month` **is `monthlyPnl(this month)`**;
  - `working` uses `attendanceStatus` for everyone with a shift today, plus unscheduled clock-ins;
  - `needsWork` = dishes rated below 4.0 with ≥ 5 ratings in the last 7 days.
- **Web:**
  - layout A of `phase-3-overview.html`, plus the "This month at a glance" strip linking to `/staff/business`;
  - live: refetch on `clock.changed`, `rating.created`, `expense.changed` and `check.updated` (the existing `useLive`).

- [ ] **Step 1: Write the failing tests:**
  - **API:** the overview's `month` equals `/api/business/monthly`'s `pnl.cur` for the same `now` (the spec's anti-goal); the `working` statuses for a seeded day contain on_shift, late, later and missing; a waiter → `403`.
  - **Web:** the late pill shows "18 min late", a `clock.changed` event triggers a refetch, and axe clean.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- overview` and `npm test -w @lodos/web -- Overview`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: manager overview, today first`.

# Part D: Demo history and end-to-end

### Task 15: Demo seed: 4 months of ratings, hours, expenses, and today's states

**Files:**
- Create: `apps/api/src/seed/ops-seed.ts`
- Modify: `apps/api/src/sales/history.ts` (`HISTORY_DAYS = 120`; generated summaries gain `byServer`, `onTime`, and `ratings` and `people` outside the raw windows), `apps/api/src/seed/seed.ts`
- Test: `apps/api/test/history.test.ts`, `apps/api/test/seed.test.ts` (extend), `apps/api/test/sandboxes.test.ts` (size)

**Interfaces:**
- **`seedOps(models, { tenantId, now, staff, items, rand })`**, called from `seedRestaurant` when `liveService && history !== false`. It seeds:
  - **Hourly rates for everyone on the schedule** (₺ per hour): waiters 180–220, cooks 200–260, bartenders 190–230, host and dishwasher 150–170, managers 320. Rates are stored ×100 in kuruş. One person gets a rate change about 20 days ago.
  - **Clock PINs:** the schedule-only staff get clock PIN `1111`. Add the demo hint EN "Demo: clock PIN for kitchen and bar staff is 1111", TR "Demo: mutfak ve bar ekibinin saat PIN'i 1111".
  - **Raw `ClockEntry` for the last 35 days**, following the seeded schedule: about 8% late (6–25 min), one forgotten clock-out fixed with an edit, and P2's 47 h week producing overtime. Older days go in `people` aggregates on the generated summaries, consistent with `byServer` and the station ticket counts.
  - **Raw `Rating` for the last 14 days** (`generated: true`, `checkId: null`) and aggregates before that:
    - waiter averages 4.3–4.9 with Deniz the best;
    - Mantı ≈ 3.4 ("Fix") and one high-rated, low-selling dish ("Hidden gems");
    - food ≈ 4.5, cleanliness ≈ 4.6, atmosphere ≈ 4.7;
    - about 15 comments in EN and TR, one of them hidden.
  - **Expenses for 4 months:**
    - the 7 categories with budgets (food ₺380k, drinks ₺190k, rent ₺220k, utilities ₺90k, repairs ₺60k, marketing ₺40k, other ₺30k);
    - supplier deliveries spread over each month, rent on the 1st, utilities around the 10th;
    - this month, Repairs is over budget.
  - **Today, anchored to `now`:** today's shifts are rewritten so that relative to `now`:
    - one waiter clocked in on time 2 h ago;
    - one cook clocked in 18 min late;
    - one bartender due in 3 h;
    - one host whose shift started 20 min ago with no entry (missing);
    - one dishwasher who finished.

    This must hold for any `now` (03:00, 11:00, 21:00). Shifts may be shifted, but never to before the service day start (06:00).
- **Determinism:** everything uses the passed `rand` (`mulberry32(now)`).

- [ ] **Step 1: Write the failing tests:**
  - For `now` = 03:00, 11:00 and 21:00 Istanbul, the overview's `working` contains every status above.
  - The monthly page for last month has every section non-empty, and the menu has at least one dish in each of "stars", "fix" and "hidden_gems".
  - Same `now` → identical documents (determinism).
  - Raw and aggregate windows never overlap on a day.
  - Sandbox size: the total documents per sandbox stay under **6,000**. Write down the measured number in the commit message.
- [ ] **Step 2:** Run `npm test -w @lodos/api -- history seed sandboxes`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(seed): four months of ratings, hours and expenses; today's live staff states`.

### Task 16: End-to-end, accessibility, docs

**Files:**
- Create: `e2e/management.spec.ts`
- Modify: `e2e/a11y.spec.ts` (the new screens), `README.md` (the feature table), `docs/ARCHITECTURE.md` (rollup and ops reader), and the screenshots in `docs/screenshots/` (overview and monthly)
- Test: the e2e itself

- [ ] **Step 1: Write the e2e:**
  1. A guest phone orders on T4.
  2. The waiter closes the check.
  3. The guest's page shows "How was your visit?". They rate waiter 5, one dish 4, food 5, cleanliness 5, atmosphere 4, with a comment.
  4. The manager's overview rating tile and the monthly page's latest comments show it.
  5. The time clock: Mert punches in, and the overview shows him on shift.

  Add a11y scans for the overview, monthly, performance, expenses, timesheets, My performance, the time clock and the rating card, in EN and TR.
- [ ] **Step 2:** Run `npm run test:e2e -- management a11y`. Expected: PASS, since Tasks 1–15 are in. Any failure is a defect in those tasks: fix it there, not in the test.
- [ ] **Step 3:** Update README and ARCHITECTURE. Retake the two screenshots from a fresh demo copy at 1440×900, with no dev overlays.
- [ ] **Step 4:** Run `npm run lint && npm run typecheck && npm test && npm run test:e2e`. Expected: all green.
- [ ] **Step 5:** Commit: `test(e2e): ratings to dashboards; docs for the management system`.
