# Lodos Restaurant System: Design

**Date:** 2026-11-10 · **Status:** draft for owner approval
**Visual references (open in a browser):**
- The guest-menu file has a "Try a red" switcher. It was only for choosing; the red is fixed at **Blood #C8102E** and the switcher does not ship.
- `docs/design-reference/guest-menu-directions.html`. Use **direction A, "Plum Salon"**, with the red set to **Blood #C8102E**, the default red when the page loads. Directions B and C are rejected. The food images and chairs in it are placeholders.
- `docs/design-reference/staff-screens.html`. The **approved staff look** for the kitchen display and the floor plan. Every staff screen follows this design language, including the ones that were not mocked.

**Two owner decisions override what the staff mockup shows:**
1. **No courses.** There are no starters, mains or desserts and no "fire". Guests and waiters order whatever they want, whenever they want, and everything goes straight to the kitchen and bar. Ignore the mockup's course strip ("Course 2 · Mains"), course stepper and "Fire dessert" button. The only split anywhere is **Food / Drinks** (§6).
2. **Table names are always prefixed:** **T1, T2, T3…** for tables and **B1, B2…** for booths. The mockup's bare numbers ("12", "7") become "T12", "T7".

---

## 1. Intent: why this exists

This is the second showcase project for Cem Akçiçek's portfolio (`~/Personal/portfolio`), after the clinic booking system (`~/Personal/clinic-booking`). It has two audiences:

1. **A restaurant owner (a potential freelance client).** They should think "this is better than the POS I pay for, and it looks like *my* place."
2. **A recruiter or hiring manager.** They should see things the clinic project does not show:
   - **real-time multi-screen sync**
   - a **separate frontend + API architecture** (the "MERN" shape job ads ask for)
   - **MongoDB** used where documents genuinely fit
   - product-grade UI craft

**The magic moment:** the visitor opens the guest menu in one window and the kitchen screen in another. They order a dish as a guest, and within a second it appears on the kitchen screen with a sound. They press "Bump", and the waiter's floor plan shows the table as "Food ready". Everything should be built so this moment is instant and reliable.

**The restaurant (fictional):** **Lodos**, named after Istanbul's southwesterly wind. A chic, upscale modern Mediterranean bistro and cocktail bar in Karaköy: the place you book for Friday night.
- **Menu:** sharing plates, a raw bar, wood-fired dishes, signature cocktails, natural wine.
- **Interior (drives the visuals):** a "dark Pinterest house" vibe.
  - animal (leopard) print
  - industrial and designer chairs
  - elegant arched mirrors
- **Palette:** blood red, plum, white, beige, black.
- **It is not** a lokanta or a balıkçı with ayran on the menu.

## 2. Goals, non-goals, anti-goals

**Goals, phase 1 (complete and demo-able on its own)**
- Guest QR menu (EN + TR) per table: browse, dish details, options and extras, cart, order, live order status, "call waiter", "request the bill".
- Order routing: each order splits into **kitchen** and **bar** tickets.
- Kitchen display and bar display (same component, different station) with live tickets, timers, item check-off, bump, hold, recall, "All day" counts, and the 86 list.
- Waiter floor plan: rooms, tables with live states, an attention queue, a table detail panel with the open check split into Food and Drinks. Waiter order entry (no courses; every item goes straight to its station). Closing the check with a simulated payment.
- Manager: menu editor (items, options, allergens, photos, station, price), one-tap 86 with an optional "N left" count, a basic "tonight" summary.
- Staff login by PIN.
- Demo mode: a private copy of the restaurant per visitor (§9), one-click role switcher, a seeded live service.

**Goals, phase 2**
- Split the bill (by item and evenly).
- Sales dashboard (covers, revenue, average check, top items, ticket times by hour).
- Drag-and-drop table layout editor.
- Staff management screen.
- Comps and voids with a reason (manager approval).
- Printable receipt layout.

**Non-goals**
- Real payments or card terminals (payment is simulated).
- Stock and inventory, recipes and costing, accounting.
- Reservations (the clinic project already shows booking).
- Delivery integrations (Yemeksepeti, Getir, Trendyol Yemek).
- Multiple locations or SaaS sign-up.
- Real printer or kitchen-bell hardware (printing goes through the browser).
- Full offline mode (see §8.4 for what happens on disconnect).
- Horizontal scaling (one API instance; see §8.3).

**Anti-goals (a failure even if it technically works)**
- **Staff screens that look like a student project.** The owner rejected two "simple" staff designs as amateur. The approved standard:
  - discipline: one type family at 12–14px, a real icon set, 1px hairlines, an 8px grid, monospaced timers, no emoji
  - domain detail: all-day counts, 86'd items, covers, ticket timers, check totals
  - reference: `staff-screens.html`
- **A guest menu that looks generic.** The guest side must feel like the restaurant: moody plum, blood red, arched-mirror shapes, a leopard accent.
- **Staff screens that are hard to use in a rush.** They are light-themed, high-contrast and readable from a distance. Colour always comes with a word or icon. Buttons are large enough for fast, imprecise taps (at least 38px).
- **A kitchen display that silently misses an order.** The real-time path must be reliable (§8.4).
- **Real or real-looking personal data in the demo.**

## 3. Constraints

- **Build:** from scratch; no code from Cem's employer (NDA) and no old coursework.
- **Repo and account:** repo `cemakcck/lodos` on Cem's **personal** GitHub account, never the company account. Local folder `~/Personal/lodos`, which already gets the personal git identity through `~/.gitconfig-personal`.
- **Languages:** English and Turkish for both guest and staff UI. Menu content is stored in both languages.
- **Money:** Turkish lira, VAT-inclusive (Turkish menus show KDV-included prices). No service charge in phase 1. Store amounts as integer kuruş.
- **Time zone:** all times are Istanbul time (`Europe/Istanbul`). The "service day" runs from 06:00 to 05:59 the next morning, so a 01:00 order belongs to the previous evening's service.
- **Accessibility:** WCAG 2.2 AA on both sides. The kitchen display must be readable at arm's length on a 10–13" tablet.
- **Devices:**
  - Guest menu: phone first.
  - Staff screens: tablet first (landscape, 1024–1366px wide), usable on a desktop browser.
  - Kitchen and bar displays: landscape tablet or a wall screen.
- **Cost:** free tiers wherever possible. Hosting is decided at deployment time (§11).

## 4. Roles and how people get in

| Role | Gets in by | Sees |
|---|---|---|
| **Guest** | Scanning the table's QR code. No account. | Their table's menu, their table's orders and status, call waiter and request bill. |
| **Waiter** | PIN | Floor plan, orders, checks |
| **Kitchen** | PIN | Kitchen display |
| **Bar** | PIN | Bar display |
| **Manager** | PIN | Everything above plus menu, 86, tonight summary (and phase 2 screens) |

- **Staff login:** a shared tablet shows a staff picker (name tiles), then a 4–6 digit PIN pad. This is how real restaurant tablets work.
  - Staff stay signed in on that device until they sign out or 12 hours pass.
  - PIN attempts are rate-limited: 5 wrong attempts lock that person for 5 minutes, and per-device limits apply too.
  - PINs are stored hashed.
- **One person per device at a time:** a waiter tablet holds one staff session. Switching staff means picking another name and entering their PIN.
- **Station screens:** the kitchen and bar displays sign in as **station accounts** ("Kitchen", "Bar") rather than individual cooks. Their session renews while the screen is in use, so a wall screen never logs out mid-service.
- **Setting up a real restaurant (demo mode off):** a command-line setup script creates the manager and the staff with their PINs, like the clinic's create-user script. A staff management screen is phase 2.
- **Guest table link:** `/t/<tableToken>`. **Each table has its own unique QR code** (owner decision). The guest never types a table number, which would let anyone order onto any table.
  - The token is random and unguessable, and printed into the table's QR code.
  - Phase 1: tokens are static per table; the manager can regenerate one.
  - A guest can only read and act on the **open check of that table**. They can never see other tables.

## 5. The guest experience (QR menu)

Visual language: mockup **A · Plum Salon** with blood red.
- **Colours:** deep plum backgrounds, cream text, blood red for primary actions.
- **Shapes:** arched (mirror-shaped) image frames, a brass-edged hero arch, and a thin leopard band.
- **Type:** Bodoni Moda italic for the wordmark, Cormorant Garamond for dish names, Manrope for body text.
- **Photos:** real food and interior photography (free licence, credited in the README) replaces the placeholders.

**Flow**
1. **Landing:** the Lodos hero, the table name ("T7 · welcome") and a language toggle.
2. **Menu:** category tabs (To share, Raw bar, From the fire, Sides, Desserts, Cocktails, Wine, Zero-proof).
   - Each dish shows its photo, name, a one-line description, price, dietary tags (Vegan, Vegetarian, GF) and allergen icons.
   - **Sold-out (86'd) items** stay visible but greyed with "Sold out tonight", and can't be added. This updates live.
3. **Dish detail sheet:**
   - photo, longer story, the full allergen list (the EU's 14 major allergens), pairing suggestion
   - **options:** required single choice (e.g. doneness) and optional extras with a price change (e.g. "add burrata +₺180")
   - a short note field (max 140 characters) and a quantity selector
4. **Cart → Place order.**
   - The order goes straight to the stations. No waiter confirmation, which is what makes the magic moment work.
   - Abuse limits apply (§10).
5. **"Your table" view:** every order placed from this table (by any phone at the table), with live per-item status: *Sent → Preparing → Ready → Served*.
6. **Call the waiter:** optional quick reasons ("Wine advice", "Something's wrong", "Other").
7. **Request the bill:** choose card or cash. The waiter is notified, and the guest sees "Your waiter is on the way."

**Rules**
- Several phones at one table each have their own cart, but all orders land on the table's single open check.
- When a guest places the first order at a free table, a check opens automatically (covers unknown until the waiter sets them).
- When the waiter closes the check, the table resets. A guest still on the old page sees "This table's visit has ended. Thank you!" and can't order onto the next party's check.
- Guests can't cancel or edit an order once it's placed; they call the waiter.

## 6. Staff experience

Visual language: `staff-screens.html`.
- **Layout:** plum navigation rail with the Bodoni "L" mark, white toolbar, a live stats strip under it.
- **Type and colour:** Inter for UI text, JetBrains Mono for timers and amounts, warm neutral greys. Blood red only for *late* and *allergen*.
- **Icons:** Lucide.

### 6.1 Kitchen and bar displays

One component; the station decides which tickets appear.
- **A ticket** is one station's slice of one order. The header shows:
  - the table (T7, B2), the server (or "QR order") and the covers
  - the time it was sent
  - a live timer and the item count
- **No courses:** a ticket is everything one order sent to that station. Items are cooked as they come.
- **Items:**
  - quantity, name, options as indented "–" lines, guest note
  - an allergen chip, in red, if the dish contains allergens or the note mentions one
  - tap an item to tick it off
- **Timer states:** under 8 minutes neutral, 8–15 minutes amber, over 15 minutes red with a red outline. The 8 and 15 thresholds are stored settings; phase 1 has no screen to change them.
- **Actions:**
  - **Bump** marks the ticket ready (all items ready) and notifies the floor.
  - **Hold** pauses the ticket into the "Held" tab.
  - **Recall** brings back the last bumped ticket.
  - **Start** is optional: a ticket can be bumped without being started.
- **Tabs:** Active, Held, Done (today's service).
- **Sound:** a short chime on a new ticket, after a one-time "Enable sound" tap, since browsers block autoplay.
- **"All day" column:** counts of each dish not yet bumped across active tickets.
- **"86'd tonight" box:** sold-out items, and items with "N left".
- **Order of tickets:** oldest first.

### 6.2 Waiter floor

- **Rooms:** Salon, Bar, Terrace, as tabs. Each has a fixed seeded layout of tables (shape, size, position, capacity, name).
- **Table states**, derived from data and never stored separately:
  - *Free*
  - *Seated*: open check
  - *Food ready*: a bumped ticket not yet marked picked up
  - *Calling*: open waiter call
  - *Bill*: bill requested
  - If several apply, show the most urgent: Calling > Food ready > Bill > Seated.
- **Table names:** always prefixed and consistent: **T1, T2, T3…** for tables (including bar-height tables) and **B1, B2…** for booths. Never bare numbers. The same name appears on tickets, chips, the guest page and the QR sheet.
- **On each table:** name, covers, time seated, and a status dot.
- **Toolbar attention chips:** "T7 calling · 1m", "2 ready to run", "B4 wants the bill". Tapping one opens that table.
- **Stats strip:** tables seated, covers, average turn time, total of open checks, "My section".
- **Sections:**
  - Each waiter has a section, a set of tables assigned in the seed (phase 1) and edited on the phase 2 staff screen.
  - Every waiter sees the whole room, with their own tables highlighted, plus a **"My tables"** filter.
  - Attention chips go to everyone and are emphasised for the table's own waiter.
  - The server on a check opened by a QR order is the waiter whose section the table is in.
- **Table detail panel:**
  - covers, time seated, check total
  - the open check as two groups, **Food** and **Drinks**. Each line shows quantity, item, options, status (sent, preparing, ready, served) and price, with a subtotal per group and the check total.
  - actions: **Seat table** (when free; asks for covers), **New order / Add items**, **Mark picked up / served**, **Answer call**, **Print check**, **Close check**
- **Waiter order entry** (not mocked; follow the staff design language):
  - a fast item grid by category with search
  - options sheets
  - a seat number (optional) and a note
  - **Send** sends everything straight to the kitchen and bar. No courses, no holding, no firing.
- **QR orders** go straight to the stations too, labelled "QR order" on tickets.
- **Close check:** choose card or cash. Payment is simulated; it records the method and marks the check paid. Close the check, then free the table.
- **Print check:** a print-styled check page, using the browser's print dialog.

### 6.3 Manager

- **Menu editor:**
  - categories (ordered), and items with name and description in EN and TR
  - price, photo upload, dietary tags, allergens, station (kitchen or bar; drinks go to the bar)
  - option groups (single or multi, required or optional, price changes), active or hidden
- **86:** one tap marks an item sold out tonight. Optionally set "N left": each order reduces it, and it 86's itself at zero. Everything clears automatically when a new service day starts.
- **Tonight summary:** covers, revenue (closed checks), open checks, average ticket time, top 5 items.
- **Tables:** rename tables, change capacity, regenerate a table's QR token, print the QR code sheet. The drag-and-drop layout editor is phase 2.

## 7. Data (MongoDB)

MongoDB is chosen because these records are naturally documents:
- A menu item carries nested option groups.
- An order carries a **snapshot** of each item as ordered (name, price, chosen options). Later menu edits must never change a past check.

The collections below are a guide; the builder may adjust shapes.

- `menuItems`: name `{en, tr}`, description `{en, tr}`, story `{en, tr}`, price (kuruş), category, station, dietary[], allergens[], photo, optionGroups[{ name, type: single|multi, required, options[{ name, priceDelta }] }], active, sort.
- `categories`
- `rooms` and `tables`: room, name, shape, x, y, w, h, capacity, qrToken (stored hashed), active.
- `checks`: one per table visit.
  - fields: table, status open|paid, covers, openedAt, closedAt, server, payment {method, amount, at}
  - **constraint:** at most one *open* check per table, enforced by a partial unique index
- `orders`: check, source qr|staff, placedBy, placedAt, items[snapshot + seat + note + status + station + readyAt + servedAt]
- `tickets`: order, station, status new|started|held|ready|recalled, sentAt, readyAt, items[refs]. Tickets can instead be derived views of `orders`; the builder decides and records why.
- `calls`: table, check, reason, openedAt, answeredAt, answeredBy
- `availability`: per service day, item, soldOut, remaining
- `staff`: name, role, pinHash, active
- `sessions`: staff sessions
- `settings`: thresholds, service-day start
- `rateEvents`

**Integrity rules (each must be tested)**
- Placing an order and decrementing "N left" happen atomically. Two guests can never both get the last portion; the loser gets a clear "just sold out" message. Use transactions (replica set) or a single conditional update.
- A guest order is accepted only onto the open check of the table whose token it carries.
- A closed check accepts no new orders.
- Totals are computed on the server from snapshots, never trusted from the client.

## 8. Architecture and technology

### 8.1 Stack (owner-approved)

**Frontend:** React (Vite) + TypeScript + Tailwind CSS.
- React Router for routing and TanStack Query for server state.
- Installable as a PWA, so staff tablets can run it full-screen.

**API:** Node.js + TypeScript.
- Fastify, or Express: the owner approved "Fastify or Express"; Fastify is preferred.
- Zod validation.

**Real-time:** Socket.IO.

**Database:** MongoDB.
- Mongoose is preferred, since the MERN audience recognises it.
- Local development uses a single-node **replica set** in Docker, so transactions work.

**Repo shape:** one repo with npm workspaces:
- `apps/web`
- `apps/api`
- `packages/shared`: Zod schemas, types, and the money and time helpers both sides use

### 8.2 API style

- REST/JSON for commands and reads.
- Socket.IO only pushes "something changed" events to the right audiences.
- The server is the single source of truth.

### 8.3 Real-time

- **Socket.IO rooms:** `station:kitchen`, `station:bar`, `floor`, `manager`, `table:<id>` (guests of that table).
- **When to emit:** after each committed change, the API emits a small event (`ticket.created`, `ticket.updated`, `check.updated`, `call.opened`, `availability.changed`, …). Clients either apply the event or refetch the affected query.
- **Guest sockets** authenticate with the table token and only join their table's room. **Staff sockets** authenticate with the session cookie.
- **Scaling:** one API instance in phase 1. Scaling out would need the Socket.IO Redis adapter; that's documented as the next step and not built.

### 8.4 Reliability (the "never miss an order" rule)

- On connect and every reconnect, a client fetches a full snapshot of what it shows, then applies events. Events never carry the only copy of the data.
- Staff screens show a clear **"Reconnecting…"** banner when the socket is down, and a "Last updated hh:mm:ss" stamp.
- If a guest's connection drops while ordering, they must never be charged twice: placing an order carries a client-generated **idempotency key**.

## 9. Demo mode: a private copy per visitor

Turned on by an environment flag. **Owner decision: every visitor gets their own private copy of Lodos.** Nobody shares data with anyone else.

- **Creating a copy:** a visitor's first click on "Try the demo" (or any demo role button) creates a **sandbox**, a full copy of the seeded restaurant. It starts identical for everyone: same menu, tables, staff and busy Friday service.
  - The sandbox is tied to the browser by a signed, httpOnly cookie.
  - Every visitor can do everything inside their copy, including manager edits: rename dishes, 86 items, regenerate QR codes.
  - Nothing they do is visible to anyone else.
- **Deleting a copy:** the owner wants the copy to go away when the visitor leaves. A single closed tab must not wipe it, since the magic moment uses two windows, and browsers don't reliably report closed tabs. So:
  - a sandbox is deleted **30 minutes after its last connected window disconnects**
  - and in any case **24 hours after it was created**
  - a returning visitor whose copy is gone simply gets a fresh one
- **Multi-tenancy:** every document carries a `tenantId` (the sandbox's, or the real restaurant's when demo mode is off).
  - Every query is scoped by it; enforce this in one place, not per query by hand.
  - Socket rooms are namespaced per tenant (`<tenant>:station:kitchen`, …).
  - Tests must prove that one sandbox can never read or change another's data, over both HTTP and sockets.
- **Limits:**
  - at most 200 live sandboxes at once (beyond that, the oldest idle one is deleted first)
  - sandbox creation is rate-limited per IP
  - a cleanup job runs every few minutes
- **Banner:** "Demo restaurant, not real" with one-click role buttons: **Guest at T7**, **Waiter**, **Kitchen**, **Bar**, **Manager**. Each signs in to that sandbox's seeded account with no PIN.
- **Magic-moment helpers:**
  - After a guest's first order, a callout says "Now open the kitchen screen" and offers to open it in a new window.
  - The demo shows a **"Scan to order from your phone"** QR code. It carries the sandbox and the table, so a visitor can order on their phone and watch it land on the kitchen screen on their laptop. A phone is a different browser, so without this it would get a separate copy.
- **A living restaurant:**
  - Each sandbox's seed creates a busy Friday service *relative to the moment it's created*: several seated tables, tickets at different ages (some late), one table calling, one wanting the bill, a couple of 86'd items. The demo never looks empty.
  - A light "simulator" adds a believable QR order from another table every few minutes, only while that sandbox has a window open. It can be switched off in the banner.
- **Abuse:** guest notes are length-limited, and a simple profanity filter applies to notes shown on staff screens.

## 10. Security and abuse limits

- Staff routes require a valid session and the right role. Tested per endpoint.
- PIN brute-force limits (§4).
- Guest limits, per table token and per IP:
  - order rate limits
  - at most 20 items per order
  - at most 30 orders per check
  - call-waiter cooldown of 1 minute
- CORS is restricted to the web app's origin; secure, httpOnly, sameSite cookies; security headers.
- No personal data is collected from guests.

## 11. Testing and quality

- **Unit tests:** money, service-day, timer thresholds, state derivation (table state precedence), routing (order → one ticket per station).
- **API integration tests** against a real MongoDB replica set:
  - order placement
  - "last portion" race
  - sandbox isolation (one copy can never read or change another, over HTTP or sockets) and sandbox cleanup
  - closed-check rejection
  - token scoping
  - idempotency
  - role checks
- **Playwright end-to-end** (Chromium):
  - **the magic moment with two browser contexts:** a guest orders, the kitchen sees the ticket within 2 seconds, the bump shows on the waiter floor
  - an 86 hiding an item live on the guest menu
  - a waiter order sending food to the kitchen and drinks to the bar, and the table detail showing them grouped as Food and Drinks
  - closing a check
  - axe accessibility checks on the main screens
- **CI:** GitHub Actions runs lint, typecheck, unit, integration, e2e and build on every push.
- **Wall-clock independence:** tests must pass at any hour. The clinic project lost time to tests that broke late at night or mid-afternoon. Freeze or inject "now" where time matters.

## 12. Deployment (decided later)

Deployment is decided when the app is built, as with the clinic. **Two requirements are fixed now:**
- **The API runs on an always-on server,** not one that sleeps when idle. Real-time, the simulator and sandbox cleanup all need a process that stays up.
- **The web app and API are same-site**, e.g. `lodos.<domain>` and `api.lodos.<domain>`, or the web host proxies `/api`. This keeps cookie-based staff sessions working on iPad Safari.

The likely shape:
- the web app on a static host
- the API on a host that keeps a long-running Node process (Socket.IO needs one)
- MongoDB Atlas free tier

The app's subdomain goes on the portfolio's project page.

## 13. Left to the builder

- Exact component structure, state management details beyond TanStack Query, and file layout inside the workspaces.
- Whether tickets are stored or derived (§7), recorded with the reason.
- Seed content: dishes, cocktails, staff names, table layout. Everything must be invented, fit the Lodos vibe, and come in EN and TR.
- The source of photos (free licence, credited), and the exact Turkish UI copy (natural, not machine-sounding).
- Icon choices within Lucide, and the micro-interactions, as long as they stay within the approved design language.
