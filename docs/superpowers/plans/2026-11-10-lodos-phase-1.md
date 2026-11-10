# Lodos Restaurant System: Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phase 1 of Lodos: a real-time restaurant system for a fictional Karaköy bistro, consisting of:
- a guest QR menu
- kitchen and bar displays
- a waiter floor plan
- a manager back office
- a demo mode that gives every visitor a private copy of the restaurant

**Architecture:** An npm-workspaces monorepo with three packages:
- `apps/web`: a React SPA (Vite)
- `apps/api`: a Fastify + Socket.IO API over MongoDB (Mongoose)
- `packages/shared`: Zod schemas and pure domain helpers used by both sides

**Real-time design:** the API is the only source of truth. After every committed change it emits a small "something changed" event into tenant-namespaced Socket.IO rooms. Clients refetch with TanStack Query, and always take a full snapshot on (re)connect.

**Multi-tenancy:** enforced once, in a Mongoose plugin driven by AsyncLocalStorage. Every visitor's demo sandbox is a tenant.

**Tech Stack:**
- **Runtime:** Node 22, TypeScript (strict)
- **Web:** React 19, Vite, React Router 7, TanStack Query 5, Tailwind CSS 4, i18next/react-i18next, lucide-react, socket.io-client, vite-plugin-pwa, qrcode
- **API:** Fastify 5 with @fastify/cookie, @fastify/multipart, @fastify/helmet and @fastify/cors; Socket.IO 4; Mongoose (current major); Zod 4; argon2
- **Testing:** Vitest, mongodb-memory-server (replica set), Playwright with @axe-core/playwright
- **Versions:** install the current stable major of each, and commit `package-lock.json`.

**Spec:** `docs/superpowers/specs/2026-11-10-lodos-design.md`. Read it fully before any task. The two mockups it points to are in `docs/design-reference/`.

## Global Constraints

- **Repo and identity:**
  - Repo `cemakcck/lodos`, personal GitHub account only. Never push without the owner's go-ahead.
  - Commits come from `~/Personal/lodos`, which already uses the personal identity.
  - Every commit message ends with:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01G1gUztbjonzCYopjxcu6K3
    ```
- **Build:** from scratch; no employer code, no old coursework.
- **Ports:**
  - Never touch **3000** (the owner's portfolio) or **3100** (the clinic preview).
  - Dev: Mongo **27018**, API **4100**, web **5180**.
  - E2E: in-memory Mongo **27019**, API **4200**, web **5280**.
  - Kill any server you start by PID; never `pkill -f`.
- **Money:** integer kuruş everywhere, VAT-inclusive, no service charge. Display with `formatTRY` (Task 2).
- **Time zone and service day:** all times are `Europe/Istanbul`. The service day starts at 06:00, so 01:00 belongs to the previous day. Use `serviceDayOf` (Task 2), never ad-hoc date math.
- **Table names:** `T<n>` for tables and `B<n>` for booths, everywhere (tickets, chips, guest page, QR sheet). Never bare numbers.
- **No courses:** no starters, mains or desserts, and no fire or hold-for-course logic. Every order goes straight to its stations. The only grouping is **Food** (kitchen items) and **Drinks** (bar items).
- **Languages:** EN + TR for all UI and all menu content. Turkish copy must read naturally.
- **Design:**
  - **Guest:** "Plum Salon"
    - colours: plum `#24101E`/`#3A1630`/`#4B1D3F`, blood red `#C8102E`, cream `#F8F4EE`, beige `#E7D7C2`, brass `#C9A46A`, black `#0E0C0D`
    - fonts: Bodoni Moda italic for the wordmark, Cormorant Garamond for dish names, Manrope for body
    - motifs: arched image frames and a thin leopard band
  - **Staff:** follows `docs/design-reference/staff-screens.html` exactly.
    - colours: bg `#F7F6F4`, panel `#FFF`, lines `#E7E4DF`, plum rail `#4B1D3F`, red `#C8102E` (only for late and allergen), amber `#9A6A14`
    - fonts: Inter 12–14px for UI, JetBrains Mono for timers and amounts
    - icons: Lucide; no emoji
    - touch targets at least 38px
- **Accessibility:** WCAG 2.2 AA. Colour always comes with text or an icon.
- **Abuse limits:**
  - a guest note is at most 140 characters
  - an order has at most 20 items (sum of quantities)
  - a check has at most 30 orders
  - a table can call the waiter at most once every 60 s
  - PIN: 5 wrong attempts lock that staff member for 5 minutes
  - staff sessions last 12 h; station sessions slide (renew on use)
  - demo: at most 200 sandboxes; each is deleted 30 minutes after its last window disconnects, or 24 h after creation
- **Tests:**
  - Every test passes at any hour. Inject "now" through the clock (Task 3) or use fixed dates; never assert on the real wall clock.
  - Each test file uses fresh random tenant ids, so files never interfere with each other.
- **Environment variables** (`.env.example`): `MONGODB_URI`, `SESSION_SECRET` (at least 32 chars), `DEMO_MODE` (`1` = on), `WEB_ORIGIN`, `PORT`.

## Rulings made while planning (owner can veto)

- **QR table tokens are stored in plain form, not hashed** (spec §7 said hashed). The manager must be able to reprint a table's QR sheet, which needs the raw token. The token is a capability that is already printed on a public table anyway. Tokens are 32 random bytes, base64url-encoded.
- **Tickets are a stored collection.** Hold, recall, bump time and "served" are per-station states with their own timestamps, so storing them is simpler and auditable. Per-item check-offs live on the ticket.
- **Tests use an in-memory replica set (mongodb-memory-server).** GitHub Actions service containers can't start Mongo with `--replSet`, and the in-memory server needs no Docker in CI. Local development uses Docker.
- **Phone-to-laptop demo:** a table token is globally unique and resolves its own tenant. So the "Scan to order from your phone" QR code is simply that sandbox's T7 guest URL. Nothing else needs to be carried in the link.

## Review Focus

1. **Invalid option selections from a tampered client** must be rejected with a 400 `validation` error naming the problem, never silently accepted. Cases:
   - a required single-choice group is missing
   - two options are picked in a single-choice group
   - an option id belongs to another item
   - qty is 0, negative or fractional

   Test: Task 7, `orders.options.test.ts`.
2. **A dish hidden, deleted or repriced while it sits in a guest's cart.**
   - Hidden or deleted: the order is rejected with `item_unavailable` and the item id.
   - Repriced: the order is charged the server's current price, never the client's.

   Test: Task 7, `orders.stale-cart.test.ts`.
3. **The 06:00 service-day rollover.**
   - An order at 05:59 Istanbul belongs to the previous service day; one at 06:00 belongs to the new one.
   - The 86 list and "N left" counts don't carry over.
   - The KDS "Done" tab shows only the current service day.

   Tests: Task 2 (`time.test.ts`) and Task 9 (`kds.service-day.test.ts`).
4. **Turkish text in search.** Waiter order-entry search finds "Şiş" from "sis", "İskender" from "iskender", and "Çoban" from "COBAN". Test: Task 2 (`text.test.ts`, `fold`).
5. **A kitchen screen that was offline while an order arrived** shows that ticket as soon as it reconnects, without a manual reload. Test: Task 16 e2e, `kds-reconnect.spec.ts`, using `context.setOffline(true/false)`.

---

## File structure (locked)

```
package.json                    workspaces: apps/*, packages/*; root scripts
tsconfig.base.json
eslint.config.js
docker-compose.yml              mongo:8 single-node replica set rs0 on 27018
.github/workflows/ci.yml
.env.example
README.md
packages/shared/src/
  index.ts                      re-exports
  money.ts  time.ts  tickets.ts  tables.ts  routing.ts  options.ts  text.ts  allergens.ts
  schemas.ts                    Zod request/response schemas
  events.ts                     realtime event names + room helpers
apps/api/src/
  main.ts                       starts server (reads env)
  app.ts                        buildApp(opts) → { app, io, clock, jobs }
  config.ts  clock.ts  errors.ts
  db/connect.ts  db/tenancy.ts  db/models/*.ts
  auth/sessions.ts auth/pin.ts auth/guard.ts auth/rate-limit.ts
  demo/sandboxes.ts demo/routes.ts demo/cleanup.ts demo/simulator.ts
  seed/content.ts seed/seed.ts
  guest/routes.ts  guest/orders.ts
  kds/routes.ts    kds/service.ts
  floor/routes.ts  floor/service.ts
  manager/routes.ts manager/menu.ts manager/tonight.ts
  realtime/io.ts   realtime/emit.ts realtime/presence.ts
  scripts/setup.ts              CLI: create real restaurant + staff
apps/api/test/
  global-setup.ts               MongoMemoryReplSet; sets MONGODB_URI
  helpers.ts                    makeTestApp, newTenant, staffCookie, guestToken
  *.test.ts
apps/web/src/
  main.tsx  router.tsx  i18n/{index.ts,en.json,tr.json}
  lib/api.ts  lib/socket.ts  lib/useLive.ts  lib/format.ts
  styles/{guest.css,staff.css}
  guest/   (Landing, Menu, DishSheet, Cart, TableStatus, VisitEnded)
  staff/   (Shell, Login, Kds, Floor, TableDetail, OrderEntry, PrintCheck,
            MenuEditor, Tables, QrSheet, Tonight)
  demo/    (DemoLanding, DemoBanner, KitchenCallout, PhoneQr)
apps/web/public/photos/         seeded dish photos (free licence) + CREDITS.md
apps/web/test/                  vitest + testing-library unit tests
e2e/                            Playwright specs + playwright.config.ts + mem-mongo.mjs
```

---

### Task 1: Workspace scaffold, tooling, CI skeleton

**Files:**
- Create: root `package.json`, `tsconfig.base.json`, `eslint.config.js`, `.gitignore`, `.editorconfig`, `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/shared/{package.json,tsconfig.json,src/index.ts}`, `apps/api/{package.json,tsconfig.json,vitest.config.ts}`, `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html,src/main.tsx}`
- Test: `packages/shared/test/smoke.test.ts`

**Interfaces:**
- **Produces root scripts:** `lint`, `typecheck` (all workspaces), `test` (all vitest projects), `test:e2e`, `dev` (api + web concurrently), `db:up` (`docker compose up -d --wait 2>/dev/null || docker-compose up -d --wait`), `build`.
- **Workspace names:** `@lodos/shared`, `@lodos/api`, `@lodos/web`.

- [ ] **Step 1:** Write `packages/shared/test/smoke.test.ts`: `expect(VERSION).toBe("phase-1")`, importing `VERSION` from `../src/index`.
- [ ] **Step 2:** Run `npm test -w @lodos/shared`. Expected: FAIL (`VERSION` is not exported).
- [ ] **Step 3:** Create the workspaces, configs and `export const VERSION = "phase-1"`.
  - **TypeScript:** strict, with `noUncheckedIndexedAccess`.
  - **ESLint:** flat config with typescript-eslint and the react-hooks plugin for web.
  - **docker-compose:** `mongo:8` running `--replSet rs0 --port 27017`, published on `27018:27017`, with a healthcheck that runs `rs.initiate()` if needed. Use `mongosh --eval "try{rs.status()}catch(e){rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})}"`, with `directConnection=true` in the URI.
  - **.env.example:** `MONGODB_URI=mongodb://localhost:27018/lodos?replicaSet=rs0&directConnection=true`.
  - **.gitignore:** `.superpowers/`, `node_modules`, `dist`, `.env*` (but not `.env.example`), `test-results`, `playwright-report`.
- [ ] **Step 4:** Run `npm install && npm run lint && npm run typecheck && npm test`. Expected: all green, 1 test passed.
- [ ] **Step 5:** Write the CI workflow, with `ubuntu-latest`, Node 22, `npm ci`, and these steps in order:
  1. lint
  2. typecheck
  3. test (env `MONGOMS_VERSION=8.0.4`)
  4. `npx playwright install --with-deps chromium`
  5. `npm run test:e2e`
  6. `npm run build`
  7. upload the Playwright report on failure

  Note: e2e has no specs yet; `test:e2e` passes with `--pass-with-no-tests`.
- [ ] **Step 6:** Commit: `chore: scaffold monorepo, tooling and CI`.

### Task 2: Shared domain helpers

**Files:**
- Create: `packages/shared/src/{money,time,tickets,tables,routing,options,text,allergens,schemas,events}.ts`, exported from `index.ts`
- Test: `packages/shared/test/{money,time,tickets,tables,routing,options,text,schemas}.test.ts`

**Interfaces:** Produces these exact exports.
```ts
// money.ts
formatTRY(kurus: number, locale: "en" | "tr"): string
lineTotal(unitPrice: number, optionDeltas: number[], qty: number): number   // (unit + Σdeltas) × qty
// time.ts
SERVICE_DAY_START_HOUR = 6
serviceDayOf(at: Date): string            // "YYYY-MM-DD" in Europe/Istanbul, shifted by 6h
istanbulClock(at: Date): string            // "HH:MM"
formatElapsed(ms: number): string          // "mm:ss" under 1h, else "h:mm:ss"
// tickets.ts
TICKET_THRESHOLDS = { warnMin: 8, lateMin: 15 }
type AgeState = "ok" | "warn" | "late"
ticketAgeState(sentAt: Date, now: Date, t = TICKET_THRESHOLDS): AgeState
type TicketStatus = "new" | "started" | "held" | "ready"
type GuestItemStatus = "sent" | "preparing" | "ready" | "served"
guestItemStatus(t: { status: TicketStatus; servedAt?: Date | null; anyChecked: boolean }): GuestItemStatus
// tables.ts
type TableState = "free" | "seated" | "ready" | "calling" | "bill"
deriveTableState(f: { openCheck: boolean; openCall: boolean; readyUnserved: boolean; billRequested: boolean }): TableState
TABLE_NAME_RE = /^(T|B)[1-9]\d{0,2}$/
// routing.ts
type Station = "kitchen" | "bar"
splitByStation<T extends { station: Station }>(items: T[]): Partial<Record<Station, T[]>>
checkTotals(lines: { station: Station; lineTotal: number }[]): { food: number; drinks: number; total: number }
// options.ts
type OptionGroup = { id: string; name: { en: string; tr: string }; type: "single" | "multi"; required: boolean;
                     options: { id: string; name: { en: string; tr: string }; priceDelta: number }[] }
type OptionSelection = { groupId: string; optionIds: string[] }
resolveOptions(groups: OptionGroup[], sel: OptionSelection[]):
  | { ok: true; chosen: { groupId: string; optionId: string; name: {en:string;tr:string}; priceDelta: number }[] }
  | { ok: false; errors: string[] }
// text.ts
fold(s: string): string                    // Turkish-aware ASCII fold + lowercase
maskProfanity(s: string): string           // replaces listed EN/TR words with "•••"
noteMentionsAllergy(note: string): boolean // allerg|alerji|gluten|nut|fıstık|fındık|laktoz|lactose|vegan|celiac|çölyak
// allergens.ts
ALLERGENS = ["gluten","crustaceans","eggs","fish","peanuts","soybeans","milk","nuts","celery","mustard","sesame","sulphites","lupin","molluscs"] as const
// schemas.ts (Zod)
OrderItemRequest = { itemId: string; qty: int 1..20; options: OptionSelection[]; note?: string ≤140; seat?: int 1..20 }
OrderRequest = { idempotencyKey: uuid; items: OrderItemRequest[] (1.., Σqty ≤ 20) }
StaffRole = "waiter" | "kitchen" | "bar" | "manager"
DemoRole = "guest" | "waiter" | "kitchen" | "bar" | "manager"
// events.ts
EVENTS = ["ticket.created","ticket.updated","check.updated","call.opened","call.answered","availability.changed","menu.changed","tables.changed"] as const
room(tenantId: string, kind: "kitchen" | "bar" | "floor" | "manager"): string     // `${tenantId}:station:kitchen`, `${tenantId}:floor`, …
tableRoom(tenantId: string, tableId: string): string                               // `${tenantId}:table:${tableId}`
```

- [ ] **Step 1:** Write the failing tests, including at least these assertions:
```ts
// money
expect(formatTRY(164000, "en")).toBe("₺1,640"); expect(formatTRY(164000, "tr")).toBe("₺1.640");
expect(formatTRY(1250, "en")).toBe("₺12.50"); expect(formatTRY(1250, "tr")).toBe("₺12,50");
expect(lineTotal(64000, [18000], 2)).toBe(164000);
// time (Review Focus 3)
expect(serviceDayOf(new Date("2026-11-13T02:59:00Z"))).toBe("2026-11-12"); // 05:59 Istanbul
expect(serviceDayOf(new Date("2026-11-13T03:00:00Z"))).toBe("2026-11-13"); // 06:00 Istanbul
expect(serviceDayOf(new Date("2026-11-12T22:30:00Z"))).toBe("2026-11-12"); // 01:30 next calendar day → previous service
expect(formatElapsed(17 * 60_000 + 20_000)).toBe("17:20"); expect(formatElapsed(3_725_000)).toBe("1:02:05");
// tickets
const s = new Date("2026-11-13T18:00:00Z"), m = (n: number) => new Date(s.getTime() + n * 60_000);
expect(ticketAgeState(s, m(7.99))).toBe("ok"); expect(ticketAgeState(s, m(8))).toBe("warn");
expect(ticketAgeState(s, m(15))).toBe("warn"); expect(ticketAgeState(s, m(15.01))).toBe("late");
expect(guestItemStatus({ status: "new", anyChecked: false })).toBe("sent");
expect(guestItemStatus({ status: "new", anyChecked: true })).toBe("preparing");
expect(guestItemStatus({ status: "held", anyChecked: false })).toBe("sent");
expect(guestItemStatus({ status: "ready", servedAt: new Date(), anyChecked: true })).toBe("served");
// tables: precedence Calling > Food ready > Bill > Seated > Free
expect(deriveTableState({ openCheck: true, openCall: true, readyUnserved: true, billRequested: true })).toBe("calling");
expect(deriveTableState({ openCheck: true, openCall: false, readyUnserved: true, billRequested: true })).toBe("ready");
expect(deriveTableState({ openCheck: true, openCall: false, readyUnserved: false, billRequested: true })).toBe("bill");
expect(deriveTableState({ openCheck: false, openCall: false, readyUnserved: false, billRequested: false })).toBe("free");
expect(TABLE_NAME_RE.test("T12")).toBe(true); expect(TABLE_NAME_RE.test("12")).toBe(false); expect(TABLE_NAME_RE.test("T0")).toBe(false);
// routing
expect(checkTotals([{ station: "kitchen", lineTotal: 500 }, { station: "bar", lineTotal: 300 }])).toEqual({ food: 500, drinks: 300, total: 800 });
expect(Object.keys(splitByStation([{ station: "bar" }]))).toEqual(["bar"]);
// options (Review Focus 1): required missing, two in single, foreign option id, valid multi
// text (Review Focus 4)
expect(fold("Şiş")).toBe("sis"); expect(fold("İskender")).toBe("iskender"); expect(fold("ÇOBAN")).toBe("coban");
expect(noteMentionsAllergy("fıstık alerjim var")).toBe(true); expect(noteMentionsAllergy("extra lemon")).toBe(false);
// schemas: Σqty 21 rejected; note of 141 chars rejected; qty 1.5 rejected
```
- [ ] **Step 2:** Run `npm test -w @lodos/shared`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement each file.
  - `serviceDayOf`: take `Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Istanbul"})` of `at − 6h`.
  - `fold`: map `İIıŞşĞğÜüÖöÇç` → `iiissgguuoocc`, strip combining dot U+0307, then lowercase.
- [ ] **Step 4:** Run the tests. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(shared): money, service day, ticket age, table state, routing, options, text helpers`.

### Task 3: API core: app factory, clock, errors, Mongo, tenancy, models, test harness

**Files:**
- Create: `apps/api/src/{app,config,clock,errors,main}.ts`, `src/db/{connect,tenancy}.ts`, `src/db/models/{tenant,sandbox,category,menuItem,room,table,check,order,ticket,call,availability,staff,session,rateEvent,photo,setting}.ts`
- Test: `apps/api/test/{global-setup,helpers}.ts`, `apps/api/test/tenancy.test.ts`, `apps/api/test/health.test.ts`

**Interfaces:**
- **App factory:** `buildApp(opts: { mongoUri: string; clock?: Clock; demoMode?: boolean; sessionSecret: string; webOrigin: string; startJobs?: boolean }): Promise<{ app: FastifyInstance; io: Server; clock: Clock; close(): Promise<void> }>`
- **Clock:** `type Clock = { now(): Date }`; `systemClock`; `fixedClock(at: Date): Clock & { set(d: Date): void; advance(ms: number): void }`.
- **Errors:**
  - `class ApiError extends Error { constructor(status: number, code: ErrorCode, message?: string, details?: unknown) }`
  - `ErrorCode = "validation"|"unauthorized"|"forbidden"|"not_found"|"sold_out"|"item_unavailable"|"check_closed"|"rate_limited"|"limit_exceeded"|"conflict"|"demo_busy"`
  - Response body: `{ error: { code, message, details? } }`. ZodErrors map to 400 `validation`.
- **Tenancy (`db/tenancy.ts`):**
  - `runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>`, `currentTenant(): string` (throws if none), and `unscoped<T>(reason: string, fn: () => Promise<T>)` (an explicit escape hatch).
  - `tenantPlugin` (a Mongoose schema plugin) adds `tenantId: { type: String, required: true, index: true }`.
  - It injects `tenantId` into every `find*`, `count*`, `update*`, `delete*`, `aggregate` (as a first `$match`) and `save`/`insertMany`.
  - Any of those without a tenant context and outside `unscoped` throws `Error("tenant context missing")`.
  - It is applied to every model except `Sandbox` and `RateEvent`.
- **Models:** follow spec §7, plus the decisions below.
  - `Table`
    - fields: `{ roomId, name (TABLE_NAME_RE), shape: "round"|"rect", x, y, w, h, capacity, token (unique, global), sectionStaffId, active }`
  - `Check`
    - fields: `{ tableId, status: "open"|"paid", covers: number|null, openedAt, closedAt, serverStaffId, billRequestedAt, billMethod, payment }`
    - index: partial unique `{tenantId, tableId}` where `status:"open"`
  - `Order`
    - fields: `{ checkId, tableId, source: "qr"|"staff", placedBy, placedAt, idempotencyKey, items: [{ itemId, name{en,tr}, unitPrice, options:[{name{en,tr},priceDelta}], qty, note, seat, station, allergens, lineTotal }] }`
    - index: unique `{tenantId, idempotencyKey}`
  - `Ticket`
    - fields: `{ orderId, checkId, tableId, tableName, station, status: TicketStatus, serverName: string|null, covers, sentAt, startedAt, readyAt, servedAt, items: [{ orderItemIndex, name, qty, options, note, allergens, checked }] }`
  - `Availability`
    - fields: `{ serviceDay, itemId, soldOut, remaining: number|null }`
    - index: unique `{tenantId, serviceDay, itemId}`
  - `Sandbox`
    - fields: `{ _id: tenantId, createdAt, lastSeenAt, simulatorOn, nextSimAt }`
  - `RateEvent`
    - fields: `{ key, at }`
    - index: TTL index on `at` (1 day)
- **Test helpers (`test/helpers.ts`):** `makeTestApp(opts?: { now?: Date; demoMode?: boolean })` → `{ app, clock, inject, close }`; `newTenant(): string` (random).

- [ ] **Step 1:** Write `test/global-setup.ts`. It starts `MongoMemoryReplSet({ replSet: { count: 1 } })`, puts the URI in `process.env.MONGODB_URI`, and stops it on teardown. Configure vitest `globalSetup` and `fileParallelism: true`.
- [ ] **Step 2:** Write the failing `tenancy.test.ts`:
  - two tenants each insert a `Category`; `find()` under `runWithTenant(a)` returns only a's
  - `Category.find()` outside any context rejects with `"tenant context missing"`
  - `updateMany({}, …)` under tenant a never touches b's docs
  - an aggregate under a returns only a's docs
  - `unscoped("token lookup", () => Table.findOne({ token }))` works without a context
  - the open-check partial unique index rejects a second open check for the same table, and allows it once the first is `paid`

  Also write `health.test.ts`: `GET /api/health` → `200 {ok:true}`.
- [ ] **Step 3:** Run `npm test -w @lodos/api`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement.
  - `buildApp` registers helmet, CORS (`origin: webOrigin, credentials: true`), cookie (signed with `sessionSecret`) and the error handler.
  - It attaches Socket.IO to `app.server` (setup itself in Task 8).
  - `connect.ts` uses `mongoose.createConnection` per app, so tests can build several apps.
  - `main.ts` reads env via `config.ts`, which validates with Zod and refuses a `SESSION_SECRET` shorter than 32 chars.
- [ ] **Step 5:** Run the tests. Expected: all pass.
- [ ] **Step 6:** Commit: `feat(api): app factory, clock, errors, tenancy plugin, models, test harness`.

### Task 4: Seed content and `seedRestaurant`

**Files:**
- Create: `apps/api/src/seed/content.ts`, `apps/api/src/seed/seed.ts`, `apps/web/public/photos/*` (+ `CREDITS.md`)
- Test: `apps/api/test/seed.test.ts`

**Interfaces:**
- `seedRestaurant(tenantId: string, now: Date, opts: { liveService: boolean }): Promise<SeedResult>`
- `SeedResult = { tables: Record<string, { id: string; token: string }>; staff: Record<"waiter"|"waiter2"|"kitchen"|"bar"|"manager", string> }`
  - `tables` is keyed by table name.
  - `staff` holds staff ids; `kitchen` and `bar` are station accounts.

**Content** (invented, Lodos vibe, EN + TR):
- **Categories, in order:** To share, Raw bar, From the fire, Sides, Desserts, Cocktails, Wine, Zero-proof.
- **About 32 items.** Kitchen items are food; bar items are drinks.
  - Each item has a price, a description, a story, allergens and dietary tags.
  - At least these 4 items have option groups:
    - Dry-aged ribeye: a required single "doneness" group
    - Levrek crudo: an optional multi "extras" group, including "add burrata +₺180"
    - Lodos Negroni: a required single "gin" group
    - Wine by the glass: a required single "size" group
- **Photos:** one per item, licence-free (e.g. Unsplash/Pexels), downloaded into `apps/web/public/photos/`, each under 200 KB, credited in `CREDITS.md`. Items reference them as `/photos/<slug>.jpg`.
- **Rooms and tables:**
  - **Salon:** booths B1–B5 along the mirror wall, and tables T1–T8.
  - **Bar:** bar-height tables T9–T12.
  - **Terrace:** T13–T16.
  - Positions match the floor mockup's feel.
- **Staff:**
  - waiters **Deniz** and **Mert**, each with a section split roughly in half; T7 is in Deniz's section
  - station accounts **Kitchen** and **Bar**
  - manager **Selin**
  - demo PINs: `1111`, `2222`, `3333`, `4444`, `9999`
- **Live service** (when `liveService: true`), all relative to `now`:
  - **Seated tables:** 7 tables are seated, with covers and opening times 10–95 minutes before `now`.
  - **Tickets, varied in age:**
    - 2 late: 16 and 18 minutes old
    - 1 warn: 9 minutes old
    - 3 ok
    - 1 ready and not yet served
  - **A busy table:** one table with an open call ("Wine advice", 1 minute ago).
  - **A table wanting the bill:** one table with the bill requested (card).
  - **Sold out:** 2 items are 86'd for `serviceDayOf(now)`, and one item has `remaining: 2`.
  - **T7 is free.** It's the guest's table.
- **Settings:** `{ warnMin: 8, lateMin: 15 }`.

- [ ] **Step 1:** Write the failing `seed.test.ts`. With a fixed `now`:
  - every table name matches `TABLE_NAME_RE`
  - there are 21 tables, and every token is unique and at least 43 chars
  - every item has non-empty `en` and `tr` names and a photo path that exists on disk
  - kitchen items are only in food categories, and bar items only in drink categories
  - with `liveService`, `ticketAgeState` across the seeded tickets yields exactly 2 `late` and 1 `warn`
  - T7 has no open check
  - seeding two tenants gives disjoint tokens
  - `liveService:false` creates no checks
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement `content.ts` (data only) and `seed.ts`, using `runWithTenant` and inserting in bulk. Tokens come from `crypto.randomBytes(32).toString("base64url")`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): Lodos seed content and live-service seeding`.

### Task 5: Staff auth: PIN login, sessions, roles, rate limits, setup CLI

**Files:**
- Create: `apps/api/src/auth/{sessions,pin,guard,rate-limit}.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/scripts/setup.ts`
- Test: `apps/api/test/auth.test.ts`, `apps/api/test/setup-cli.test.ts`

**Interfaces:**
- **Rate limit:** `hit(key: string, limit: number, windowMs: number, now: Date): Promise<boolean>` (true = allowed) in `rate-limit.ts`. Uses `RateEvent`, unscoped. Callers prefix keys with the tenant where relevant.
- **Sessions:**
  - `createSession(staffId, tenantId, kind: "person"|"station", now)` → raw token. The cookie `lodos_sid` (httpOnly, sameSite lax, secure in production) holds the raw token; the database stores `sha256(token)`.
  - **Person sessions** expire 12 h after login.
  - **Station sessions** slide: each authenticated request extends them to now + 12 h.
- **Guard:**
  - `requireStaff(...roles: StaffRole[])` is a Fastify preHandler.
  - It sets `req.staff = { id, name, role, tenantId }` and runs the rest of the request inside `runWithTenant`.
  - `manager` passes every staff guard.
  - Errors: 401 `unauthorized`, 403 `forbidden`.
- **Routes:**
  - `GET /api/auth/staff` → `[{id,name,role}]` for the tenant from the sandbox cookie (demo) or the `main` tenant (live)
  - `POST /api/auth/pin {staffId, pin}` → `{ staff }` and sets the cookie
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- **PIN rules:**
  - PINs are 4–6 digits, hashed with argon2id.
  - 5 failures for a staff member within 5 minutes → 429 `rate_limited`, until 5 minutes have passed.
  - Per IP: 30 attempts per 10 minutes.
- **Setup CLI:**
  - Command: `npm run setup -w @lodos/api -- --tenant main --seed-menu --staff "Selin:manager:482910" --staff "Deniz:waiter:1234" …`
  - Creates the `main` tenant, seeds the menu and tables without a live service, and upserts the staff.
  - Refuses to run if `DEMO_MODE=1`.

- [ ] **Step 1:** Write the failing `auth.test.ts`, using a fixed clock:
  - a correct PIN sets the cookie and `/me` returns the role
  - a wrong PIN gives 401
  - after 5 wrong PINs, even the correct one gives 429; after advancing the clock 5 minutes, the correct PIN works
  - a person session is rejected after 12 h + 1 s
  - a station session used every hour stays valid after 30 h
  - for each of `/api/kds/kitchen`, `/api/floor`, `/api/manager/menu`, a role matrix test checks waiter/kitchen/bar/manager get the expected 200 or 403, and no cookie gets 401
  - a session from tenant A sent with a tenant-B resource id gets 404 (it never leaks)

  Write `setup-cli.test.ts`: running `runSetup(args)` creates staff whose hashed PINs verify, and refuses when `DEMO_MODE=1`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Stub the protected route handlers as `{ok:true}` behind their guards, so the role matrix test exercises the guards now. Tasks 9–11 replace the stubs.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): PIN login, sessions, role guards, rate limits, setup CLI`.

### Task 6: Demo sandboxes: create, demo sign-in, cap, cleanup

**Files:**
- Create: `apps/api/src/demo/{sandboxes,routes,cleanup}.ts`
- Test: `apps/api/test/sandboxes.test.ts`, `apps/api/test/isolation-http.test.ts`

**Interfaces:**
- **Sandbox functions (`sandboxes.ts`):**
  - `ensureSandbox(req, reply, now)` → `{ tenantId, created: boolean }`. It reads the signed `lodos_sb` cookie; if that's missing or the sandbox is gone, it creates one: `_id = "sb_" + random`, then `seedRestaurant(id, now, {liveService:true})`, then sets the cookie with maxAge 24 h.
  - `deleteSandbox(tenantId)` deletes every tenant-scoped collection's docs, then the `Sandbox` doc.
- **Caps:**
  - When 200 sandboxes exist, delete the oldest *idle* one first. Idle means not currently connected and `lastSeenAt` more than 2 minutes ago; presence comes from Task 8.
  - If none is idle, return 503 `demo_busy`.
  - Creation is limited to 5 sandboxes per IP per hour.
- **Routes:**
  - `POST /api/demo/session {role: DemoRole}` (only when `demoMode`):
    - creates a person session (or a station session for kitchen and bar) for that sandbox's seeded staff
    - returns `{ redirect }`:
      - `guest` → `/t/<T7 token>`
      - `waiter` → `/staff/floor`
      - `kitchen` → `/staff/kitchen`
      - `bar` → `/staff/bar`
      - `manager` → `/staff/menu`
  - `GET /api/demo/info` → `{ guestUrl, simulatorOn }`
  - `POST /api/demo/simulator {on}`
- **Cleanup:**
  - `runCleanup(now, isConnected: (tenantId) => boolean)` → number of sandboxes deleted.
  - It deletes a sandbox when it is not connected and `lastSeenAt < now − 30 min`, or when `createdAt < now − 24 h` (whether connected or not).
  - The app schedules it every 2 minutes when `startJobs`.

- [ ] **Step 1:** Write the failing `sandboxes.test.ts`:
  - `POST /api/demo/session {role:"kitchen"}` with no cookie creates a sandbox, sets `lodos_sb` and `lodos_sid`, and the redirect is `/staff/kitchen`
  - a second call with the same cookie reuses the sandbox
  - a tampered `lodos_sb` gets a fresh sandbox
  - the guest role's redirect is `/t/<token>`, and that token resolves to T7
  - cleanup: idle for 29 minutes → kept; 31 minutes → deleted, with every collection empty for that tenant; connected but 24 h + 1 s old → deleted
  - the cap: with 200 sandboxes, one idle, a new one deletes the idle one; with none idle → 503 `demo_busy`
  - the per-IP limit: the 6th creation within the hour → 429
  - `/api/demo/*` returns 404 when `demoMode` is false
- [ ] **Step 2:** Write the failing `isolation-http.test.ts`. Two sandboxes A and B. With A's cookies, every GET and POST on B's ticket, check, table and menu item ids returns 404, and B's data is unchanged afterwards. Also, A's guest token can't read B's menu.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the tests. Expected: PASS. (The isolation test fully passes after Tasks 7–11 add routes; keep it in the suite. It must stay green.)
- [ ] **Step 6:** Commit: `feat(api): per-visitor demo sandboxes, demo sign-in, cap and cleanup`.

### Task 7: Guest API: table token, menu, place order, status, call, bill

**Files:**
- Create: `apps/api/src/guest/{routes,orders}.ts`, `apps/api/src/orders/place.ts` (shared with staff orders)
- Test: `apps/api/test/{guest,orders,orders.options,orders.stale-cart,orders.race,orders.idempotency,guest.limits}.test.ts`

**Interfaces:**
- **Guest auth:** the guest sends the `X-Table-Token` header.
  - `resolveTable(token)` looks the token up with `unscoped("guest token")`, then runs the rest inside `runWithTenant(table.tenantId)`.
  - An unknown token → 404.
- **Place order** (`orders/place.ts`):
  - Signature: `placeOrder(input: { tableId: string; source: "qr"|"staff"; placedBy: string|null; req: OrderRequest; now: Date }): Promise<{ order: OrderDoc; tickets: TicketDoc[]; checkOpened: boolean }>`
  - It runs in one Mongo transaction:
    1. Idempotency: if `{idempotencyKey}` exists, return that order unchanged.
    2. Get the open check.
       - For staff orders, a check must already be open: the waiter seats the table first; otherwise `conflict`.
       - For QR orders with no open check, open one: `covers:null`, `serverStaffId = table.sectionStaffId`.
    3. Enforce at most 30 orders per check (`limit_exceeded`).
    4. For each line, load the current item.
       - Missing or `active:false` → `item_unavailable` with details `{itemId}`.
       - Run `resolveOptions`; on errors → `validation`.
       - Check availability for `serviceDayOf(now)`: `soldOut` → `sold_out` with details `{itemId}`.
       - If `remaining != null`, do a conditional `$inc` with `{remaining: {$gte: qty}}`. On no match → `sold_out`. Reaching 0 sets `soldOut:true`.
    5. Snapshot the lines with the current price. Compute `lineTotal` on the server.
    6. Insert the order, then one ticket per station from `splitByStation`.
       - Each ticket gets `tableName`, `serverName` (the section waiter's name, or `null` for QR), `covers` and `sentAt = now`.
  - After commit, emit events (Task 8 wires this up; until then, `emit` is a no-op injected function).
- **Routes** (all guest routes are scoped to the token's table):

  | Route | Returns / does |
  |---|---|
  | `GET /api/guest/table` | `{ table:{id,name}, visit: { checkId, openedAt } \| null }` |
  | `GET /api/guest/menu` | `{ categories, items (active only, with availability: {soldOut, remaining}) }` |
  | `POST /api/guest/orders` (body `OrderRequest`) | `201 {orderId}` |
  | `GET /api/guest/orders` | the open check's lines with `guestItemStatus`, or `{visit:null}` |
  | `POST /api/guest/calls {reason: "wine"\|"problem"\|"other"}` | opens a call; at most 1 per table per 60 s → 429 |
  | `POST /api/guest/bill {method: "card"\|"cash"}` | sets `billRequestedAt`/`billMethod`; no open check → `conflict` |

- **Ordering rate limits:**
  - per table token: 10 orders per 10 minutes
  - per IP: 30 orders per 10 minutes
- **Closed check:** an order whose idempotency key is new, sent after the check was paid, opens a new check only if the table is free. This is correct: it's the next party. The "visit ended" behaviour is client-side, based on `checkId` changing (Task 14).

- [ ] **Step 1:** Write the failing tests:
  - **`orders.test.ts`:** a QR order at free T7 opens a check, creates a kitchen ticket and a bar ticket for a mixed order, gives `checkTotals` food/drinks matching the snapshot sums, and gives `serverName` null.
  - **`orders.options.test.ts`** (Review Focus 1): the four invalid selections → 400 `validation`, each error naming the group.
  - **`orders.stale-cart.test.ts`** (Review Focus 2):
    - a hidden item → `item_unavailable` with that id
    - an item repriced after the cart was built → the order is charged the new price
    - a client-sent price field is ignored (stripped by Zod)
  - **`orders.race.test.ts`:** with `remaining: 1`, two concurrent orders for qty 1 → exactly one 201 and one 409 `sold_out`, and availability ends `remaining 0, soldOut true`.
  - **`orders.idempotency.test.ts`:** the same key posted twice → one order, the same id returned.
  - **`guest.limits.test.ts`:** Σqty 21 → 400; the 31st order on a check → `limit_exceeded`; a second call within 60 s → 429 and allowed at 61 s (fixed clock); a token from another sandbox can't read this table.
  - **`guest.test.ts`:**
    - `/guest/menu` hides inactive items and marks the seeded 86'd items `soldOut`
    - `/guest/orders` returns `sent` for a new ticket, and `ready` after the ticket's status is set to `ready` directly in the DB
    - the bill request is recorded
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): guest menu, atomic order placement, status, calls and bill`.

### Task 8: Real-time: sockets, tenant rooms, presence, emit after commit

**Files:**
- Create: `apps/api/src/realtime/{io,emit,presence}.ts`
- Modify: `apps/api/src/app.ts` (wire up), `apps/api/src/orders/place.ts` (emit)
- Test: `apps/api/test/realtime.test.ts`, `apps/api/test/isolation-socket.test.ts`

**Interfaces:**
- **Handshake:**
  - **Staff sockets** authenticate with the `lodos_sid` cookie.
    - They join rooms by role: `kitchen` → `room(t,"kitchen")`; `bar` → `room(t,"bar")`; `waiter` → `room(t,"floor")`; `manager` → floor + manager + kitchen + bar.
  - **Guest sockets** authenticate with `auth: { tableToken }` and join `tableRoom(t, tableId)`.
  - **Bad credentials:** `connect_error` with message `unauthorized`.
- **Emitting:** `emit(tenantId, event: typeof EVENTS[number], payload: { ids: string[]; tableId?: string }, audiences: ("kitchen"|"bar"|"floor"|"manager"|"table")[])`. Emit only after the transaction commits.
- **Event audiences:**

  | Event | Audiences |
  |---|---|
  | `ticket.created` / `ticket.updated` | the ticket's station, floor, manager, and the table |
  | `check.updated` | floor, manager, table |
  | `call.opened` / `call.answered` | floor, manager, table |
  | `availability.changed` / `menu.changed` | every room of the tenant (guests included) |
  | `tables.changed` | floor, manager |

- **Presence (`presence.ts`):**
  - `connect(tenantId)` / `disconnect(tenantId)` keep an in-memory count.
  - `isConnected(tenantId)`.
  - While a sandbox has connections, persist `Sandbox.lastSeenAt` on connect, on disconnect, and every 60 s.
  - Cleanup (Task 6) calls `isConnected`.

- [ ] **Step 1:** Write the failing `realtime.test.ts`, using a real `buildApp` on port 0 and `socket.io-client`:
  - a kitchen socket receives `ticket.created` within 1 s of a guest order containing food; a bar socket doesn't receive it for a food-only order
  - a guest socket for T7 receives `ticket.created` for T7's order and nothing for T3's
  - `availability.changed` reaches the guest
  - no event is emitted when `placeOrder` throws `sold_out`
  - presence: connect → `isConnected` true; disconnect → false, with `lastSeenAt` updated
- [ ] **Step 2:** Write the failing `isolation-socket.test.ts`. A kitchen socket of sandbox A receives nothing when sandbox B gets an order, and a guest socket with A's token never joins B's rooms.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement, and wire `emit` into `placeOrder` and the call and bill routes.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(api): socket rooms per tenant, presence and post-commit events`.

### Task 9: Kitchen and bar API

**Files:**
- Create: `apps/api/src/kds/{routes,service}.ts`
- Test: `apps/api/test/kds.test.ts`, `apps/api/test/kds.service-day.test.ts`

**Interfaces:**
- **`GET /api/kds/:station?tab=active|held|done`** (guard: `kitchen` for kitchen, `bar` for bar, `manager` for both) returns `{ tickets, allDay, eightySix, stats }`:
  - **`tickets`:**
    - **active:** status `new` or `started`, ordered by `sentAt` ascending (oldest first)
    - **held:** status `held`
    - **done:** status `ready` with `readyAt` in `serviceDayOf(now)`, newest first, limit 50
  - **`allDay`:** `[{ name, qty }]`, the quantity of not-yet-checked items summed over active tickets, sorted by qty descending
  - **`eightySix`:** `[{ itemId, name, soldOut, remaining }]` for the current service day; items that are sold out, or have a remaining count
  - **`stats`:** `{ open, items, avgTicketMs, late }`
    - `avgTicketMs`: average `readyAt − sentAt` of today's ready tickets
    - `late`: count of active tickets with `ticketAgeState` = `late`
- **Actions:**

  | Action | Effect |
  |---|---|
  | `POST /api/tickets/:id/start` | `new` → `started` |
  | `POST /api/tickets/:id/hold` | `new`/`started` → `held` |
  | `POST /api/tickets/:id/unhold` | `held` → `started` |
  | `POST /api/tickets/:id/bump` | `new`/`started` → `ready`, sets `readyAt`, checks every item |
  | `POST /api/tickets/:id/items/:idx/toggle` | flips `checked` |
  | `POST /api/kds/:station/recall` | the most recently bumped ticket of that station that hasn't been served → `started`, `readyAt` cleared |

  - **Errors:** an invalid transition → 409 `conflict`. Bumping twice is idempotent: the second bump → 200 with no change, which covers a double tap.
  - **Events:** each action emits `ticket.updated`.

- [ ] **Step 1:** Write the failing `kds.test.ts`:
  - the active order is oldest first
  - the all-day counts across 3 tickets match, and drop after an item toggle
  - bump → `ready`, and the floor socket gets `ticket.updated`
  - recall brings back only the latest bumped ticket, and never a served one
  - a hold/unhold round trip
  - the bar never sees kitchen tickets
  - a double bump doesn't error
  - `stats.late` counts the seeded 2

  Write `kds.service-day.test.ts` (Review Focus 3), using a fixed clock:
  - a ticket readied at 05:59 Istanbul doesn't show in "done" at 06:00
  - "N left" set on the previous service day doesn't appear in `eightySix` after 06:00
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): kitchen and bar display API`.

### Task 10: Floor and check API

**Files:**
- Create: `apps/api/src/floor/{routes,service}.ts`
- Test: `apps/api/test/floor.test.ts`, `apps/api/test/checks.test.ts`

**Interfaces:**
- **`GET /api/floor`** (guard: `waiter`) returns `{ rooms, tables, chips, stats }`:
  - **`rooms`:** `[{id,name}]`
  - **`tables`:** `[{ id, name, roomId, shape, x, y, w, h, capacity, sectionStaffId, state: TableState, covers, seatedAt, checkId }]`. `state` comes from `deriveTableState`.
  - **`chips`:** `[{ kind: "calling"|"ready"|"bill", tableId, tableName, since }]`, ordered calling, then ready, then bill, oldest first
  - **`stats`:** `{ seated, totalTables, covers, avgTurnMs, openChecksTotal }`. `avgTurnMs` is the average duration of checks paid today.
- **`GET /api/tables/:id/check`** returns `{ table, check: { id, covers, openedAt, serverName, billRequestedAt, billMethod }, food: Line[], drinks: Line[], totals }`, or `{ check: null }`.
  - `Line = { orderId, ticketId, qty, name, options, note, seat, status: GuestItemStatus, lineTotal }`
  - `totals` comes from `checkTotals`.
- **Actions:**

  | Action | Effect / errors |
  |---|---|
  | `POST /api/tables/:id/seat {covers: 1..20}` | opens a check, `serverStaffId` = the acting waiter; the table already has an open check → `conflict`. On a QR-opened check with `covers:null`, it sets the covers instead. |
  | `POST /api/tables/:id/orders` (body `OrderRequest`) | `placeOrder` with `source:"staff"` |
  | `POST /api/tickets/:id/served` | `ready` → sets `servedAt` |
  | `POST /api/calls/:id/answer` | sets `answeredAt` and `answeredBy` |
  | `POST /api/checks/:id/close {method: "card"\|"cash"}` | `status:"paid"`, `payment {method, amount: totals.total, at}`, `closedAt`; answers any open calls on that table |
  | `GET /api/checks/:id/print` | the check data for the print page |

  - **Events:** each action emits its events.
  - **Closing a check** also emits `check.updated` to the table room, so the guest page can show "visit ended".

- [ ] **Step 1:** Write the failing tests:
  - **`floor.test.ts`:**
    - the seeded floor gives exactly one `calling` table, one `bill` and one `ready`
    - T7 is `free`
    - chips are ordered calling → ready → bill
    - answering the call turns that table `seated`
    - marking the ready ticket `served` removes the `ready` chip
  - **`checks.test.ts`:**
    - seat T7 with 2 covers, then a staff order with 1 food + 1 drink → `/check` has food 1 line and drinks 1 line, and the totals add up
    - seating twice → `conflict`
    - close (card) → `paid` and the amount equals the total; T7 is `free` on `/floor`; and a guest order afterwards opens a **new** check whose id differs
    - a guest socket for T7 receives `check.updated` on close
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): floor snapshot, table states, check detail and close`.

### Task 11: Manager API: menu, photos, 86, tables, tonight

**Files:**
- Create: `apps/api/src/manager/{routes,menu,tonight}.ts`
- Test: `apps/api/test/manager.test.ts`

**Interfaces** (guard: `manager`; changes emit `menu.changed`, `availability.changed` or `tables.changed`):

| Route | Behaviour |
|---|---|
| `GET /api/manager/menu` | categories and items, including inactive ones |
| `POST/PATCH/DELETE /api/manager/categories[/:id]` | category CRUD |
| `POST/PATCH /api/manager/items[/:id]` | item CRUD. Validated with the Zod schema `MenuItemInput` in shared (add it to `schemas.ts`): EN/TR name and description required, price an integer > 0, station required, allergens ⊆ `ALLERGENS`. |
| `DELETE /api/manager/items/:id` | soft delete: `active:false` |
| `POST /api/manager/items/:id/photo` | multipart, jpeg/png/webp, ≤ 2 MB. Stored in `Photo` `{data, contentType}`, served at `GET /api/photos/:id` with cache headers. Sets `item.photo = "/api/photos/<id>"`. |
| `POST /api/manager/availability/:itemId {soldOut?: boolean, remaining?: number\|null}` | upserts for `serviceDayOf(now)` |
| `GET /api/manager/tables` | the tables |
| `PATCH /api/manager/tables/:id {name?, capacity?}` | `name` must match `TABLE_NAME_RE` and be unique within the tenant |
| `POST /api/manager/tables/:id/token` | regenerates the token. The old token → 404 from then on. |
| `GET /api/manager/tonight` | `{ covers, revenue, openChecks, openTotal, avgTicketMs, topItems: [{name, qty}] (5) }`, for `serviceDayOf(now)` |

- [ ] **Step 1:** Write the failing `manager.test.ts`:
  - creating an item with a missing TR name → 400
  - a price edit appears on `/guest/menu` and the guest socket gets `menu.changed`
  - 86 → the guest menu shows `soldOut`
  - `remaining 1` plus one order → `soldOut`
  - renaming a table to "12" → 400; to "T99" → 200; to an existing name → 409
  - the token regenerates, and the old token → 404
  - a photo upload of 3 MB → 400; a valid one is served back with the right content type
  - `tonight` revenue equals the sum of paid checks today
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): manager menu editor, photos, 86, tables and tonight summary`.

### Task 12: Demo simulator

**Files:**
- Create: `apps/api/src/demo/simulator.ts`
- Modify: `apps/api/src/app.ts` (schedule it when `startJobs && demoMode`)
- Test: `apps/api/test/simulator.test.ts`

**Interfaces:**
- `tickSimulator(tenantId: string, now: Date, rand: () => number): Promise<"placed" | "skipped">`.
  - It places one QR order at a random **seated table other than T7**, with 1–3 random active, available food or drink items and no options.
  - When options are required, it picks the first option of each required group.
  - It uses `placeOrder`, so all the usual events fire.
  - It sets `nextSimAt = now + 180–300 s`, using `rand`.
- **Scheduler:** every 30 s, for each sandbox with `simulatorOn && isConnected(id) && nextSimAt <= now`, call `tickSimulator`.

- [ ] **Step 1:** Write the failing test:
  - a tick places exactly one order, never on T7, and only items that aren't sold out
  - `nextSimAt` lands within the window
  - no seated tables → `skipped`
  - the scheduler skips sandboxes that aren't connected or have `simulatorOn:false`
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): demo order simulator`.

### Task 13: Web foundation: themes, router, i18n, API client, live data

**Files:**
- Create: `apps/web/src/{main.tsx,router.tsx}`, `src/i18n/{index.ts,en.json,tr.json}`, `src/lib/{api,socket,useLive,format}.ts`, `src/styles/{guest.css,staff.css}`, `src/staff/ConnectionBanner.tsx`
- Modify: `apps/web/vite.config.ts`: dev server port 5180; proxy `/api` and `/socket.io` (ws) to `http://localhost:4100`; vite-plugin-pwa with manifest name "Lodos", theme `#4B1D3F`.
- Test: `apps/web/test/{format,useLive,i18n}.test.tsx`

**Interfaces:**
- **API client:** `api<T>(path: string, init?: RequestInit & { tableToken?: string }): Promise<T>`
  - It sends credentials and JSON.
  - On a non-2xx response it throws `ApiClientError { status, code, message, details }`.
- **Live data:** `useLive(opts: { audience: "staff" } | { audience: "guest"; tableToken: string }, onEvent: (e: { type: string; ids: string[]; tableId?: string }) => void): { connected: boolean; lastSyncAt: Date | null }`
  - Uses one shared socket per audience.
  - **On every `connect`** (including reconnects) it calls `queryClient.invalidateQueries()` for the live keys, then sets `lastSyncAt`.
  - **On each event** it calls `onEvent`; the default handlers invalidate the related query keys.
- **Query keys:** `["kds", station, tab]`, `["floor"]`, `["check", tableId]`, `["guest","menu"]`, `["guest","orders"]`, `["guest","table"]`, `["manager", …]`.
- **`ConnectionBanner`:** shows "Reconnecting…" when disconnected for more than 1 s, and "Last updated HH:MM:SS".
- **Formatting:** `useFormat()` → `{ money(kurus), clock(date), elapsed(ms) }` bound to the current language.
- **Languages:**
  - i18next with `en` and `tr`.
  - The language is chosen from `localStorage("lodos.lang")`, falling back to `navigator.language` starting with "tr".
  - `<html lang>` is kept in sync.
- **Themes:** the CSS tokens from the Global Constraints, as Tailwind 4 `@theme` variables in `guest.css` and `staff.css`.
  - Load fonts from Google Fonts: Bodoni Moda, Cormorant Garamond, Manrope, Inter, JetBrains Mono.
  - The leopard pattern is an inline SVG data URI, taken from the guest mockup.

- [ ] **Step 1:** Write the failing tests:
  - `useLive` (with a mocked socket.io-client emitter): `connect` → `invalidateQueries` is called and `lastSyncAt` is set; a disconnect for 1.5 s → `connected` false; a reconnect invalidates again
  - `format` money: `en` "₺1,640", `tr` "₺1.640"
  - i18n: switching to `tr` updates `document.documentElement.lang`, and every key in `en.json` exists in `tr.json` (a key parity test)
- [ ] **Step 2:** Run `npm test -w @lodos/web`. Expected: FAIL.
- [ ] **Step 3:** Implement. The routes for later tasks render placeholder components.
- [ ] **Step 4:** Run the tests. Expected: PASS. Also run `npm run build -w @lodos/web`. Expected: success.
- [ ] **Step 5:** Commit: `feat(web): themes, router, i18n, API client and live-data hook`.

### Task 14: Guest UI (Plum Salon)

**Files:**
- Create: `apps/web/src/guest/{GuestApp,Landing,Menu,DishSheet,Cart,TableStatus,CallWaiter,RequestBill,VisitEnded}.tsx`, `src/guest/cart.ts`
- Test: `apps/web/test/guest/{cart,DishSheet,TableStatus}.test.tsx`

**Interfaces:**
- **Routes:** `/t/:token` (menu with landing hero) and `/t/:token/table` (the "Your table" view). The token is passed as `tableToken` to `api`.
- **Cart storage** (`cart.ts`): `localStorage` key `lodos.cart.<token>`, holding `{ checkId: string|null; lines: CartLine[] }`.
  - `CartLine = { key, itemId, qty, options: OptionSelection[], note }`
  - `addLine`, `setQty`, `removeLine`, `clear`.
  - The `idempotencyKey` is generated once per checkout attempt, kept until success, and reused on retry.
- **Errors after placing an order:**
  - `sold_out` / `item_unavailable`: mark that line "Sold out tonight" / "No longer available" and keep the rest of the cart.
  - `rate_limited`: show a friendly message.
- **Visit ended:** if `GET /guest/table` returns a `visit.checkId` different from the one stored with the cart while the cart holds an earlier `checkId`, or a `check.updated` event shows the visit closed, show **VisitEnded** ("This table's visit has ended. Thank you!") and clear the cart.
- **Screens follow the guest mockup A:**
  - **Hero:** an arched mirror with a brass edge, the Bodoni italic "Lodos" wordmark, "T7 · welcome", and the leopard band.
  - **Menu:** category chips, then dish rows with an arch-framed photo, Cormorant name, description, tags and price.
  - **Sold-out items:** greyed, with "Sold out tonight" and the add button disabled.
  - **Dish sheet:** the full allergen list (localized names of `ALLERGENS`), options built from `resolveOptions` (client-side validation using the same shared function), a note field (140 max, with a counter) and a quantity control.
  - **Sticky red cart bar:** "View order · N" with the total.
  - **"Your table":** lines grouped as Food and Drinks with a status pill per line, plus "Call the waiter" (reason chips) and "Request the bill" (card or cash).
- **Accessibility:** focus management on sheet open and close, Esc closes, and every control has a label.

- [ ] **Step 1:** Write the failing tests:
  - **cart:** the same item with different options → separate lines; the same options → qty merges; the idempotency key is stable across retries and new after success
  - **DishSheet:** a required group with no choice → the add button is disabled and the message says which group; extras raise the shown price
  - **TableStatus:** given lines with statuses, it renders Food and Drinks headings and the localized status labels; it renders VisitEnded when the `checkId` changes
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run the app manually (`npm run db:up && npm run dev`, then the demo guest button) at 390×844, and compare against the mockup.
- [ ] **Step 5:** Commit: `feat(web): guest QR menu, dish sheet, cart, live table status, call and bill`.

### Task 15: Staff shell, PIN login, demo landing and banner

**Files:**
- Create: `apps/web/src/staff/{Shell,Login,RequireStaff}.tsx`, `apps/web/src/demo/{DemoLanding,DemoBanner,PhoneQr,KitchenCallout}.tsx`
- Test: `apps/web/test/staff/{Login,Shell}.test.tsx`, `apps/web/test/demo/DemoBanner.test.tsx`

**Interfaces:**
- **`Shell`** (staff mockup layout):
  - a 56px plum rail with the Bodoni "L" and Lucide icons for Kitchen, Bar, Floor, Menu, Tables and Tonight; the items shown depend on the role
  - an avatar with initials at the bottom; a 52px white toolbar slot; a 40px stats strip slot
  - `ConnectionBanner` (Task 13)
- **`Login`** (`/staff/login`): staff name tiles, then a 4–6 digit PIN pad (big keys of at least 56px; physical keyboard digits work too), plus error and lockout messages.
- **`RequireStaff roles=[…]`:** redirects to `/staff/login` when there's no session.
- **`DemoLanding`** (`/`, demo only):
  - a Plum Salon hero: "Lodos, a restaurant system demo"
  - one paragraph on what this is (fictional restaurant, portfolio project by Cem Akçiçek)
  - five role buttons that call `POST /api/demo/session`, then navigate
- **`DemoBanner`:** a slim bar on every page in demo mode.
  - Text: "Demo restaurant, not real".
  - The role buttons.
  - A simulator toggle: "Live orders from other tables: on/off".
  - A **"Scan to order from your phone"** popover with a QR code of `guestUrl` (`qrcode` package, rendered to SVG).
- **`KitchenCallout`:** shown on the guest page after the first successful order in demo mode. Text: "Now open the kitchen screen →". It opens `/staff/kitchen` in a new window after making sure a kitchen session exists: it calls `POST /api/demo/session {role:"kitchen"}` first. The guest page keeps working because it uses the token, not the session.
- **Non-demo:** `/` redirects to `/staff/login`.

- [ ] **Step 1:** Write the failing tests:
  - **Login:** typing a PIN with the physical keyboard submits it; a 429 shows the lockout message
  - **Shell:** the kitchen role sees only the Kitchen rail item; the manager sees all
  - **DemoBanner:** the simulator toggle calls the API; the QR popover renders an `<svg>` encoding `guestUrl`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): staff shell, PIN login, demo landing, banner and helpers`.

### Task 16: Kitchen and bar display UI

**Files:**
- Create: `apps/web/src/staff/kds/{Kds,Ticket,AllDay,EightySix,useChime}.tsx`
- Test: `apps/web/test/staff/Ticket.test.tsx`, `e2e/kds-reconnect.spec.ts` (written here, run in Task 20's suite)

**Interfaces:**
- **Routes:** `/staff/kitchen` and `/staff/bar`.
- **Layout:** the staff mockup's KDS exactly, minus the course strip.
  - **Toolbar:** the title ("Kitchen · Hot line" / "Bar"), the Active/Held/Done segmented control with counts, a search box ("Find table or dish", `/` to focus), Recall, and a seconds clock.
  - **Stats strip:** a Live dot, open tickets, items, average ticket time, and over-15-minute count in red.
  - **Tickets:** a 4-column grid.
  - **Right column:** "All day" and "86'd tonight".
- **Ticket card:**
  - **Header:** the table name (`T7`/`B2`), the server name or "QR order", covers, "Sent HH:MM", and the timer `formatElapsed`. The timer ticks every second from one shared interval.
  - **Timer state:** `ticketAgeState` sets the style: `warn` gives an amber timer; `late` gives a red header tint, a red timer pill, a red outline and a red Bump button.
  - **Items:** quantity, name, options as "–" lines, the note masked by `maskProfanity`, and a red allergen chip when `allergens.length || noteMentionsAllergy(note)`.
  - **Tick-off:** a checkbox per item, toggled by tapping the row.
  - **Footer:** Bump (primary, 38px tall) and Hold (icon button).
  - **New tickets** get a "New" tag and plum left edge for their first 60 s.
- **Chime (`useChime`):** an "Enable sound" button in the toolbar until it's tapped. After that, a short chime (a WebAudio oscillator; no audio files) plays on `ticket.created` for this station.

- [ ] **Step 1:** Write the failing `Ticket.test.tsx`, using a fixed `now` prop:
  - at 9 minutes the timer has the `warn` style; at 16 minutes the `late` style, and "Late" is in the accessible name
  - an allergen chip appears for a note "fıstık alerjisi"
  - the Bump button calls `onBump`
  - tapping an item calls `onToggle(idx)`

  Write `e2e/kds-reconnect.spec.ts` (Review Focus 5):
  1. Sign in as kitchen via the demo.
  2. `context.setOffline(true)`.
  3. Place a guest order via `request` in a second context.
  4. `setOffline(false)`.
  5. The new ticket is visible within 5 s, without `page.reload()`.
- [ ] **Step 2:** Run the unit test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the unit test. Expected: PASS. Check visually against `staff-screens.html` at 1280×800.
- [ ] **Step 5:** Commit: `feat(web): kitchen and bar display`.

### Task 17: Waiter floor, table detail, close and print

**Files:**
- Create: `apps/web/src/staff/floor/{Floor,FloorCanvas,TableShape,Chips,TableDetail,SeatDialog,CloseCheckDialog}.tsx`, `apps/web/src/staff/PrintCheck.tsx`
- Test: `apps/web/test/staff/{TableShape,TableDetail}.test.tsx`

**Interfaces:**
- **Route:** `/staff/floor?room=<id>&table=<id>`.
- **Layout:** the staff mockup's floor.
  - **Toolbar:** "Floor", room tabs (Salon/Bar/Terrace), attention chips (from `chips`; tapping one selects that table), "+ New order", and a **"My tables"** toggle.
  - **Stats strip:** the `/floor` stats, plus "My section: <name> · N tables".
  - **Canvas:** the tables at their seeded positions, on a dotted grid with the mirror wall.
    - Each table shows its name, `covers · elapsed` and a status dot.
    - The table's own waiter's tables get a subtle plum underline.
    - With "My tables" on, other tables are dimmed (the stats aren't filtered).
  - **Legend and zoom control:** zoom is visual only, 75–125%.
  - **Selected table:** a 2px plum ring.
- **Table states:** `free` dashed; `seated` plum tint; `ready` black fill; `calling` red ring and red dot; `bill` amber.
- **`TableDetail` (the right panel):**
  - name, a status pill, and the server's initials
  - key values: covers, seated time, check
  - **Food** and **Drinks** groups with line, status and price, a subtotal per group, and the open check total
- **Actions:**
  - free table: **Seat table** (covers dialog)
  - seated table: **Add items** (to Task 18), **Mark picked up** (one per ready ticket), **Answer call** (when calling), **Print check**, **Close check** (card or cash, shows the total, confirm)
- **`PrintCheck`** (`/staff/check/:id/print`): print-styled; the Lodos wordmark, table name, date and time, lines, Food and Drinks subtotals, total, and "KDV dahil / VAT included". It calls `window.print()` on load.

- [ ] **Step 1:** Write the failing tests:
  - **TableShape:** for each state, it renders the state word in its accessible name, e.g. "T12, food ready, 4 covers, 1 hour 12 minutes"
  - **TableDetail:** given a check with 2 food and 1 drink lines, it renders both group subtotals and the total via `formatTRY`; Close shows the total in the confirmation
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS. Check visually against the mockup at 1280×800.
- [ ] **Step 5:** Commit: `feat(web): waiter floor, table detail, close check and print`.

### Task 18: Waiter order entry

**Files:**
- Create: `apps/web/src/staff/order/{OrderEntry,ItemGrid,OptionsSheet,OrderTicket}.tsx`, `src/staff/order/search.ts`
- Test: `apps/web/test/staff/{search,OrderEntry}.test.tsx`

**Interfaces:**
- **Route:** `/staff/order/:tableId`. It is reached from Add items or "+ New order" (the latter picks a table first).
- **Layout:**
  - **Left:** category tabs and a search box (`/` to focus).
  - **Centre:** a dense item grid. Each tile shows name, price, a Food/Drink marker and a sold-out state.
  - **Right:** the order being built, as lines with qty +/−, a seat number (optional, 1–20), a note, and a remove control.
  - **Bottom:** the total and **Send to kitchen & bar**.
- **Options:** an item with option groups opens the `OptionsSheet` (same rules as the guest side, through `resolveOptions`).
- **Sending:**
  - It posts `/api/tables/:id/orders` with an `idempotencyKey` that is generated per send attempt and reused on retry.
  - On success it returns to the floor with that table selected.
  - Sold-out errors mark the line.
- **Search** (`search.ts`): `searchItems(items, q)` uses `fold` on the EN and TR names; it matches substrings and ranks prefix matches first.

- [ ] **Step 1:** Write the failing tests:
  - **search** (Review Focus 4): "sis" finds "Kuzu şiş", "COBAN" finds "Çoban salatası", and "neg" ranks "Lodos Negroni" first
  - **OrderEntry:** adding the same item twice merges qty; Send is disabled with no lines; a `sold_out` response marks the line and keeps the others
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): waiter order entry`.

### Task 19: Manager UI: menu editor, 86, tables, QR sheet, tonight

**Files:**
- Create: `apps/web/src/staff/manager/{MenuEditor,ItemForm,OptionGroupsEditor,Availability,Tables,QrSheet,Tonight}.tsx`
- Test: `apps/web/test/staff/manager/{ItemForm,Availability}.test.tsx`

**Interfaces:**
- **`/staff/menu`:**
  - **Left:** a category list (add, rename, reorder with up/down buttons).
  - **Right:** an item table with photo, EN/TR name, price, station, a status chip, and an **86** switch with a "N left" number input inline.
  - Selecting an item opens `ItemForm`.
- **`ItemForm`:**
  - fields: EN/TR name and description, price (entered in lira, stored as kuruş), station, dietary tags, an allergen multi-select from `ALLERGENS`, photo upload with a preview, and active/hidden
  - option groups through `OptionGroupsEditor`: add a group, choose single/multi and required, add options with a price change
  - validation: the shared `MenuItemInput`
- **`/staff/tables`:** a table list with name, room, capacity and section, plus "Regenerate QR" (confirm dialog) and "Print QR sheet".
- **`/staff/tables/qr`** (`QrSheet`): a print layout, A4, 2×3 cards per page. Each card has the Lodos wordmark, the table name in large type, the QR code (SVG) and "Scan to see the menu and order · Menüyü görmek ve sipariş vermek için okutun".
- **`/staff/tonight`:** key-value cards (covers, revenue, open checks and their total, average ticket time) and the top 5 items list.

- [ ] **Step 1:** Write the failing tests:
  - **ItemForm:** price input "640" is saved as 64000; a missing TR name shows an error and doesn't submit; adding a required single group with two options produces the right payload
  - **Availability:** toggling 86 calls the API with `soldOut:true`; setting "N left" to 2 sends `remaining:2`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): manager menu editor, 86, tables, QR sheet and tonight`.

### Task 20: End-to-end suite, accessibility, CI, README

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/mem-mongo.mjs`, `e2e/helpers.ts`, `e2e/{magic-moment,eighty-six,waiter-order,close-check,a11y,kds-reconnect}.spec.ts`
- Modify: `.github/workflows/ci.yml` (if needed), root `package.json` `test:e2e`, `README.md`

**Interfaces:**
- **Playwright `webServer`** starts three processes:
  1. `node e2e/mem-mongo.mjs`: `MongoMemoryReplSet` on port **27019**; waits on `port: 27019`
  2. the API: `PORT=4200 DEMO_MODE=1 MONGODB_URI=… WEB_ORIGIN=http://localhost:5280 SESSION_SECRET=<test-only 32+ chars>`, built and started with `node`
  3. the web app: `vite preview --port 5280`, proxying to 4200

  Settings: `reuseExistingServer: false`, `retries: process.env.CI ? 1 : 0`, `workers: 2`. Each test starts with a fresh browser context, so it gets its own sandbox.
- **E2E helpers:** `demoAs(page, role)`, `guestUrl(page)` (reads `/api/demo/info`), `orderAsGuest(page, items)`.

- [ ] **Step 1:** Write the specs:
  - **`magic-moment.spec.ts`:**
    - context A, the guest, orders "Levrek crudo" plus a "Lodos Negroni" (choosing the gin)
    - **the same sandbox** (cookies copied from A into page B, the way the KitchenCallout opens a window) as kitchen sees the crudo ticket with "T7" **within 2 s** of placing the order (`expect(...).toBeVisible({ timeout: 2000 })`)
    - the bar screen shows only the Negroni
    - Bump in the kitchen → the floor shows T7 as "Food ready" within 2 s, and the guest's "Your table" shows "Ready"
  - **`eighty-six.spec.ts`:** the manager 86's "Burnt cheesecake" → the open guest page shows "Sold out tonight" for it within 2 s, with no reload, and its add button is disabled.
  - **`waiter-order.spec.ts`:** the waiter seats T7 with 2 covers, adds 1 food + 1 drink, and sends → the kitchen gets the food only, the bar the drink only, and the table detail shows the Food and Drinks groups with correct subtotals.
  - **`close-check.spec.ts`:**
    - the waiter closes a seated table (card) → the table becomes Free
    - a guest page open for that table shows "This table's visit has ended"
    - a new guest order opens a new visit
  - **`a11y.spec.ts`:** axe with no serious or critical violations on guest menu, dish sheet, "Your table", staff login, kitchen, floor (with a table selected), order entry, menu editor and the demo landing.
  - **`kds-reconnect.spec.ts`:** from Task 16.
- [ ] **Step 2:** Run `npm run test:e2e`. Expected: any failures are real bugs. Fix the code, not the tests (unless a test is wrong, in which case write down why). Then all pass.
- [ ] **Step 3:** Run the whole gate:
  - Command: `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`.
  - Expected: all green.
  - Confirm no server is left on 27019, 4200 or 5280.
- [ ] **Step 4:** Write `README.md`, in the clinic README's tone:
  - what Lodos is, with a fictional-data notice
  - the magic moment, and how to try it, including "scan with your phone"
  - an architecture mermaid diagram: web ↔ API ↔ Socket.IO rooms ↔ MongoDB
  - why MongoDB here
  - **how no order is ever missed:** snapshot on reconnect, idempotency keys, atomic "last portion"
  - **multi-tenancy:** a sandbox per visitor, enforced in one plugin
  - running locally: `npm run db:up`, `npm run dev`, demo vs. setup CLI
  - testing; photo credits
  - "Phase 2" (from the spec)
- [ ] **Step 5:** Commit: `test: end-to-end suite, accessibility checks, README`.
