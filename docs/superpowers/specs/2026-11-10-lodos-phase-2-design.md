# Lodos Phase 2: Design

**Status:** draft for owner review, 2026-11-10
**Extends:** `docs/superpowers/specs/2026-11-10-lodos-design.md` (the phase 1 spec). Everything there still holds — constraints, roles, tenancy, demo sandboxes, security, testing rules, the staff design standard — unless this document says otherwise. Section references like "P1 §9" point into it.
**Visual reference:** `docs/design-reference/phase-2-money.html` (split, comp/void, receipt) and `docs/design-reference/phase-2-manage.html` (sales, staff, floor editor). The owner approved both. The shift screen was described in conversation and approved without a mockup; §6 describes it.

Calls marked **(builder's call)** below were made by Claude while writing this and were not explicitly decided by the owner. Everything else is owner-approved.

---

## 1. Intent

Phase 1 made Lodos work through a service: guests order, the kitchen cooks, waiters run food and close checks. Phase 2 makes it a system a restaurant could actually *run on*: the end of the night (splitting the bill, comps, receipts), the manager's view of the business (sales), and the people and the room (staff, schedules, floor plan).

It is still a portfolio piece. The audience is freelance clients (restaurant owners) and recruiters. For a restaurant owner, split bills, comps with manager approval, the staff schedule and the sales page are the features they recognise from the tools they pay for; for a recruiter, they show money arithmetic done right, approval flows, reporting over time, and a drag-and-drop editor done accessibly.

## 2. Scope

**In (owner-approved, build in this order):**

1. **Closing the check:** split the bill (in full / evenly / by item), comps and voids with manager approval, printable receipt.
2. **Sales:** the "Tonight" page becomes a Sales dashboard (today / 7 days / 30 days).
3. **Running the restaurant:**
   - Staff management.
   - **Shifts** (owner's addition): a weekly staff schedule with templates, warnings, and PDF export of the whole week and of each person's own shifts. Staff see their own upcoming shifts.
   - Floor plan editor.

Each of the three groups should end demo-able on its own. The builder may plan them as one plan or three; three is fine.

**Still non-goals (P1 §2 plus):**
- Tips and service charge.
- Real fiscal receipts (e-Arşiv / ÖKC). The receipt is an information slip, marked as such.
- Payroll, wages, clock-in/clock-out, time-off requests, shift swaps, staff messaging.
- A draft/publish workflow for shifts (edits are live immediately). **(builder's call)**
- Rotating QR tokens.
- Multi-location reporting.

**Anti-goals (on top of P1's):**
- **Money that doesn't add up.** A split where the shares don't sum to the check to the kuruş, a receipt whose VAT lines don't reconcile, a dashboard whose revenue disagrees with the checks — any of these is a failure even if the screen looks right.
- **An empty dashboard.** A visitor opening Sales in a fresh demo copy must see a full month of believable history.
- **Drag-only interactions.** Everything that can be dragged (tables, shifts) must also be doable by tapping and by keyboard (WCAG 2.2, 2.5.7 Dragging Movements).

---

## 3. Closing the check

### 3.1 Split the bill

Entry: the waiter's **Close check** action (table panel) opens a full-screen close view with three modes, as in the mockup:

- **In full** — phase 1's behaviour: choose card or cash, check is paid, table frees.
- **Evenly** — N shares. N starts at the check's covers (or 2 if covers is null), adjustable 2–20. Each share is `floor(total / N)` kuruş, and the leftover kuruş go one each to the first shares, so the shares always sum exactly to the total.
- **By item** — the waiter selects a line on the left, then taps guest letters A, B, C… (as many as there are shares) to assign it. Tapping several letters splits that line equally between them (e.g. a bottle shared by four is ¼ each); leftover kuruş from the division go to the earliest letter. A line with quantity > 1 can be split by unit (e.g. "Negroni × 2" → one to A, one to B) **(builder's call: lines with qty > 1 are expanded into units in this view)**. Unassigned lines are shown in an amber banner with their total.

**Shares and payment:**
- Each share is a card with its lines and amount and its own **Take payment** (card or cash, simulated as in phase 1). A paid share shows "Paid · card" and a **Receipt** button.
- A progress strip shows "2 of 4 paid · ₺X left".
- The check closes automatically (status `paid`, table freed) when the last share is paid **and** nothing is unassigned.
- **Locks:** once any share is paid, the mode can't change, and the lines and amount of a paid share are frozen. Lines not in a paid share can still be reassigned.
- **New items during a split:** the check stays open, so a waiter can still add items. In *By item* they appear unassigned; in *Evenly* the unpaid shares are recalculated over the remaining amount (paid shares are untouched).
- Leaving the close view keeps the split as it is; the table shows "Paying · 2 of 4" on the floor.
- **Server is the authority.** The client sends assignments; the server computes every share amount from item snapshots and rejects a payment whose amount it didn't compute. Paying the same share twice is idempotent (no double payment).

### 3.2 Comps and voids

From the table panel, tapping a line on the open check offers **Comp** or **Void**:

- **Comp** — the item was made and served, but it's free. It stays on the check at ₺0 with a "Comp · reason" tag; the original price is kept for reporting.
- **Void** — a mistake, never made. It is removed from the check total. Allowed only while the item is not yet *ready* in the kitchen/bar; after that the UI offers Comp instead. A voided item that is still on an active ticket shows **struck through** on the kitchen/bar display (live), and a ticket whose items are all voided leaves the display.
- **Reason is required**, from a list (Birthday / celebration, Guest complaint, Long wait, Regular, Wrong item, Guest changed mind, Other… with a short free-text note for Other). Comp and void lists differ sensibly. **(builder's call on the exact lists; EN + TR.)**
- **Manager approval:** if the signed-in staff member is a manager, it applies immediately. Otherwise the dialog shows the active managers as name tiles (preselected when there is only one, as in the mockup's "Selin"), and the chosen manager enters their PIN on the waiter's tablet. This does **not** switch the session. It is the same `staffId + PIN` check as login, with the same hashing and lockout (P1 §4), so a wrong PIN counts toward *that* manager's lockout. **(builder's call: the picker; PINs stay non-unique)**
- **Demo:** in demo mode the PIN pad shows a hint "Demo: Selin's PIN is 9999", so a visitor can try the approval flow. **(builder's call)**
- Each comp/void records: item line, kind, reason, note, requested by, approved by, at, amount.
- **Availability:** voiding an item that had consumed an "N left" portion today gives the portion back. **(builder's call)**
- **Per unit:** a comp/void applies to a quantity of a line (comp 1 of "Gelato × 3"); the adjustment stores its quantity, and the rest of the line is unaffected. A void gives back that many "N left" portions. **(builder's call)**
- **During a split:** in *By item*, units in a paid share can't be comped or voided; in *Evenly*, comps and voids are blocked once any share is paid (otherwise the remaining shares could go below zero, which would mean a refund — out of scope). **(builder's call)** Undo: a manager can reverse a comp/void while the check is open.

### 3.3 Receipt

- A print-styled page for **80 mm receipt paper** (`@page { size: 80mm auto }`), printed through the browser, one per share or one for the whole check. Layout per the mockup: Lodos wordmark, address, demo notice, table · "Guest A of 4", check number, date/time, server, lines (shares show fractions like "½ Burrata"), options on their own line, TOTAL, VAT lines, payment method (card shows fake last 4), comps summary, "Teşekkürler · Thank you", and **"Bilgi fişi — mali değeri yoktur / Not a fiscal receipt"**.
- **VAT (KDV):** prices are VAT-inclusive (P1 §3). Each menu item gets a VAT rate, **10% or 20%**. Default from the category: food and zero-proof 10%, cocktails and wine 20% **(builder's call; editable per item in the menu editor)**. The receipt shows "incl. KDV 10%" and "incl. KDV 20%" amounts computed per rate as `round(gross × rate / (100 + rate))`; VAT lines are informational and are allowed to differ from a per-line sum by rounding, but the total line is exact.
- The receipt language follows the staff UI language.
- Phase 1's "Print check" (pre-payment check) stays and uses the same layout without payment lines.

---

## 4. Sales dashboard

"Tonight" becomes **Sales** (manager only), layout per the mockup:

- **Range:** Today / 7 days / 30 days, in service days (06:00–05:59 Istanbul, P1 §3). "Today" is the current service day so far. 7 and 30 days compare with the previous 7/30 service days; **"Today" compares with the same weekday last week up to the same time of day**, so daily summaries keep revenue, covers, checks and comps **by hour**. **(builder's call)** The page opens on 7 days.
- **Tiles:** Revenue (paid checks, after comps; voids never count), Covers, Average per cover (and per check), Comps · voids (count and amount, % of sales).
- **Revenue by hour:** bars 17:00–00:00 (or the hours that had sales), average per night over the range; the peak hour in red.
- **Ticket times by hour:** kitchen and bar lines (average sent→ready minutes by hour sent), with the 15-minute threshold from settings as a dashed line.
- **Top dishes:** top 5 by quantity, with revenue.
- **Comps & voids log:** newest first, time, kind, item · table, reason, requested → approved, amount.
- **Export CSV:** one row per paid check in the range (service day, closed at, table, covers, server, gross, comps, voids, total, payment method(s)).

**Data approach (builder's call, needed for the demo):**
- Past service days are stored as **daily summaries** (one document per tenant per service day: revenue, covers, checks, by-hour revenue, ticket times by hour per station, item counts, comp/void totals). The dashboard reads summaries for past days and computes today live.
- A summary is written when a service day ends (a job at/after 06:00) and on demand if a requested past day has none, so it's correct even after downtime.
- **Demo seed:** the live-service seed (P1 §9) also gets a handful of checks **already paid earlier tonight** so "Today" isn't ₺0. Each sandbox gets **60 days** of generated summaries (so 30 days can compare with the previous 30) plus a handful of past comp/void log entries. Numbers must be believable for a ~60-seat upscale bistro: weekends busier, closed-Monday optional, average per cover ₺700–1,000, kitchen ticket times peaking around 20:00–21:00. Generation is deterministic per sandbox creation time (seeded random), and cheap: summaries only, not 60 days of raw checks, so 200 sandboxes stay small on a free database.

---

## 5. Staff management

Manager-only **Staff** screen, per the mockup:

- **List:** name, role, tables (for waiters, shown as ranges like "B1–B3, T5–T10"), last sign-in, status. Inactive staff at the bottom, muted.
- **Add staff:** name, role, PIN (4–6 digits, entered twice), optional tables.
- **Edit:** role (Waiter or Manager, which sign in with a PIN, plus the schedule-only roles in §6), tables for waiters (chips grouped by room; another waiter's tables are dashed, and tapping one moves it over), **Reset PIN** (manager sets a new one).
- **Deactivate / reactivate.** Deactivating ends that person's sessions immediately and stops their PIN; their history (checks, approvals, shifts) stays. Their tables become unassigned and the screen says so. Nobody can deactivate themselves, and there must always be at least one active manager.
- Names must be unique among active staff (the login picker shows names).
- **Station accounts** ("Kitchen", "Bar") are a fixed, separate kind: listed in their own small section with only **Reset PIN**, never deactivated, never on the schedule, and not a choice in the role picker. (This replaces the Kitchen/Bar options shown in the mockup's role control.) **(builder's call)**
- **Demo safety:** the demo role buttons sign in to the seeded Deniz, Selin and station accounts; in demo mode those accounts can be edited but not deactivated (the screen says why), so a visitor can't break their own role buttons. Added people can be deactivated freely. **(builder's call)**
- In demo mode all of this works inside the visitor's copy; seeded staff can be edited too.
- The CLI setup script (P1 §4) stays for a real install.

---

## 6. Shifts (owner's addition)

"Personnel shifts": a weekly schedule for the staff, made by the manager, exported as PDF.

### 6.1 Who is on the schedule

Kitchen and bar *screens* sign in as station accounts (P1 §4), but the schedule needs the actual cooks and bartenders. **(builder's call)** The staff list therefore gains **schedule-only roles** — Cook, Bartender, Host, Dishwasher — people who appear on the schedule and in PDFs but have **no PIN and can't sign in**. Station accounts ("Kitchen", "Bar") never appear on the schedule. Seeded demo staff gain a realistic team: e.g. 3 cooks, 2 bartenders, a host, a dishwasher, alongside Deniz, Mert and Selin.

### 6.2 The schedule screen (manager)

- **Week view**, Monday–Sunday: people down the side (grouped: Floor, Kitchen, Bar, Managers), days across. Week picker with previous/next and "This week".
- Each shift is a block: start–end, area (Salon, Bar, Terrace, Kitchen, Bar station), optional note. Shifts may cross midnight (17:00–01:00). A shift belongs to the **service day** it starts in (06:00–05:59, P1 §3), so a 02:00 clean-down sits in the previous night's column; that day is what the daily total, the 11 h/day warning and the PDFs use. **(builder's call)**
- **Adding:** tap an empty cell → a sheet with the person and day prefilled; pick a **template** or set times. Drag a block to another day/person, or edit it in the sheet. Every drag action has a tap/keyboard equivalent.
- **Templates:** named start/end/area presets ("Dinner 17:00–01:00", "Prep 12:00–17:00", "Double 12:00–01:00"), managed by the manager, seeded with sensible ones.
- **Copy last week:** copies the previous week's shifts for people who are still active, skipping any that would overlap an existing shift, and reports how many were skipped.
- **Totals:** hours per person for the week on their row; hours per day at the column foot.
- **Rules:**
  - **Hard:** a person can't have two overlapping shifts; end must be after start; max 16 h per shift.
  - **Warnings (allowed, flagged amber on the block and in a summary):** over **45 h** in the week (Turkish Labour Law weekly limit), over **11 h** in one day (the law's daily limit), less than **11 h** rest between two shifts (common practice), and a shift for a deactivated person.
- Changes save immediately (no draft/publish).

### 6.3 PDF export

Real PDF files (downloaded, not the print dialog):
- **Week roster:** A4 landscape, the whole team's week as a grid like the screen, with week dates, totals, and the restaurant name. For the kitchen wall.
- **Personal schedule:** A4 portrait, one person's shifts for the week (date, day, start–end, area, note), their total hours. From the schedule screen: per person, or "All personal PDFs" as one PDF with one page per person.
- Language: the UI language at export time (EN or TR, including day names and Turkish characters rendered correctly).
- **(builder's call)** Generated on the server (e.g. `pdfkit` with an embedded font that has full Turkish glyph coverage, such as Inter), returned as `application/pdf`, so tests can parse and check the text.

### 6.4 "My shifts" for staff

Any staff member who signs in with a PIN sees **My shifts** in their rail: this week and next, with hours, and can download their personal PDF. Read-only.

### 6.5 Demo

Each sandbox is seeded with a full schedule for the current week and the next, relative to sandbox creation, including one deliberate warning (someone at 47 h) so the feature shows itself.

---

## 7. Floor plan editor

Manager-only, per the mockup:

- One room at a time (tabs), plus **add / rename room**; a room can be deleted only when it has no active tables.
- Tables on a **16 px snapping grid**, with alignment guides and an x/y readout while dragging (pointer events: mouse and touch).
- **Add:** Round, Square, Booth. Names continue the sequence: T17 for tables, B6 for booths (the T/B rule, P1 §6.2). Each new table gets a QR token.
- **Inspector:** name (must match `T<n>`/`B<n>` and be unique), shape, seats (1–12), waiter (section), **Duplicate**, **Delete**, **QR code for this table**.
- **Keyboard:** Tab selects tables; arrow keys move by one grid step (Shift = 4 steps); Delete removes. This is the non-drag alternative.
- **Open checks:** a table with an open check can be moved but not renamed, reshaped to a booth/table (which would change its prefix), or deleted. The inspector explains why.
- **Delete** is a soft delete (`active: false`), so past checks still name the table.
- **Save:** edits are local until **Save layout** ("2 unsaved changes" / Discard). Saving sends the whole room in one request, checked with a version number; if someone else saved in between, the editor says so and reloads rather than overwriting. After a save, waiter floors update live.
- Tables must stay inside the room's canvas and must not overlap (rejected on save with the offending tables highlighted).

---

## 8. Data changes (guide; the builder may adjust shapes)

- `menuItems`: + `vatRate` (10 | 20).
- `orders.items[]`: + `adjustment` `{ kind: comp|void, reason, note, requestedBy, approvedBy, at, amount }` (null when none).
- `checks`: + `split` `{ mode: full|even|items, shares[{ label, assignments[{ lineRef, fraction }], amount, payment {method, amount, at} | null }] }`. `payment` (P1) is kept for full payments. Check totals are always computed on the server.
- `staff`: roles extend to `cook | bartender | host | dishwasher` (no `pinHash`, can't log in); + `lastSignInAt`.
- `tables`: section moves from seed-only to editable (`waiterId`); + `active` is already present; `rooms` gain `version` for the save check.
- New: `shifts` (staffId, serviceDay, start, end, area, note), `shiftTemplates`, `dailySummaries` (§4), `adjustmentLog` if the builder prefers a separate log over scanning orders.
- Every new collection carries `tenantId` and goes through the tenancy plugin (P1 §9), and is included in sandbox seeding and cleanup.

## 9. Real-time

New events on the existing single "event" channel (P1 §8.3): check split/payment changes (floor and the waiter's close view), comp/void (floor, the affected station), layout saved (floor), staff deactivated (that person's open sockets get a session-ended event). The schedule does not need live updates.

## 10. Security

- Every new endpoint is staff-only with the right role: split/payments/comp/void request — waiter or manager; approval — PIN of an active manager; Sales, Staff, Shifts editing, Floor editor — manager; My shifts — any signed-in person, own shifts only.
- Approval PINs share login's rate limits and lockout (P1 §4, §10).
- A manager can't escalate a schedule-only person to a PIN role without setting a PIN.
- Tenancy isolation tests extend to every new collection, over HTTP and sockets (P1 §11).

## 11. Testing (in addition to P1 §11)

- **Money (unit + integration):** even split sums exactly for awkward totals and N (e.g. ₺1.000,01 / 3); by-item fractions sum exactly; recalculation after an added item; paid-share locks; idempotent share payment; check closes only when all paid and nothing unassigned; comp keeps the line at ₺0 and the original price in the log; void after *ready* rejected; void restores "N left"; VAT per rate on a mixed check.
- **Approval:** wrong manager PIN counts toward lockout; a waiter's own PIN can't approve; a deactivated manager can't approve.
- **Sales:** summary of a day equals a live computation of the same day; ranges respect the 06:00 service-day boundary; the comparison period is the right length; CSV rows match paid checks.
- **Shifts:** overlap rejected; cross-midnight shift belongs to the start day and counts correct hours; each warning triggers at its threshold and not below; copy-last-week skips overlaps and reports them; PDFs open, contain the person's shifts, and render Turkish characters (text extraction finds "Çarşamba", "Ş", "İ").
- **Floor editor:** version conflict on concurrent saves; can't delete/rename a table with an open check; overlapping/out-of-bounds tables rejected; keyboard moves.
- **E2E (Playwright):** split a check by item between two guests and pay both; comp an item with the manager PIN on a waiter session; Sales shows non-empty history in a fresh demo copy; add a shift and download the week PDF; move a table and see it move on a second waiter context. axe checks on the new screens.
- All of it wall-clock independent (P1 §11).

## 12. Left to the builder

- Endpoint shapes, component structure, chart implementation (hand-rolled SVG is fine; follow the mockups).
- Exact reason lists, template names, seed people names (Turkish names, clearly fictional).
- Whether `tickets` reflect voids by mutation or by a derived view.
- Whether shares store fractions or explicit kuruş per assignment, as long as the server is the only one computing amounts and sums are exact.
- Plan granularity (one plan or three; see §2).
