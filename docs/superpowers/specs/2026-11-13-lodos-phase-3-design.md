# Lodos Phase 3: Design — the management system

**Status:** draft for owner review, 2026-11-13
**Extends:** `docs/superpowers/specs/2026-11-10-lodos-design.md` (P1) and `docs/superpowers/specs/2026-11-10-lodos-phase-2-design.md` (P2). Everything there still holds (constraints, roles, tenancy, per-visitor demo sandboxes, security, testing rules, the staff design standard, service days 06:00–05:59 Istanbul) unless this document says otherwise. "P2 §6" points into the phase 2 spec.
**Visual reference:** `docs/design-reference/phase-3-overview.html` (layout **A, "Today first"**, chosen by the owner; layout B on that page was rejected) and `docs/design-reference/phase-3-monthly.html` (the monthly business dashboard, approved). Both are wireframes with made-up numbers: they fix *what* is shown and the rough arrangement, not the visual styling, which follows the existing staff design standard.

Calls marked **(Claude's call)** were made by Claude while writing this and were not explicitly decided by the owner. Everything else is owner-decided.

---

## 1. Intent

The portfolio shows three sides of the owner's skills, one per app. **Lodos is the management side.** Phase 1 and 2 made it a restaurant you can run a service on; phase 3 makes it a system you can run the *business* on: who worked, how well, what guests thought, what it cost, and whether it made money. The pitch to a freelance client is "I can build the system that runs your business": restaurant today, but the same shape fits a hotel or an office. The main highlight of Lodos becomes management.

Audience as before: recruiters and prospective clients opening a fresh demo copy. **Every new screen must look lived-in on a fresh demo**, with history to compare against.

Phase 3 does not block deployment: phase 2 Lodos can go live first and phase 3 ships with a later push.

## 2. Scope

**In (owner-decided):**

1. **Guest ratings** (§3): after paying, guests rate their waiter, each dish they ordered, and the restaurant itself in three general categories (food, cleanliness, atmosphere), all out of 5.
2. **Time clock** (§4): staff clock in and out with a PIN; actual hours versus planned shifts, lateness.
3. **Staff performance and ranking** (§5): ratings combined with work done; staff see their own, the manager sees everyone.
4. **Expenses and budgets** (§6).
5. **Manager overview** (§7): the manager's first screen, today first, plus the month's most important numbers.
6. **Monthly business dashboard** (§8): a separate, detailed page with every meaningful number for a month.
7. **Demo history** (§9) for all of the above.

**Non-goals:**
- Real payroll: payslips, tax, SGK, net/gross. Wages exist only to compute labour cost (§4.3).
- Receipt photo uploads for expenses **(Claude's call)**.
- Guest accounts, guest ratings outside a paid check, public reviews.
- Tips and service charge (still a P2 non-goal).
- Shift swaps, time-off requests, staff messaging (still P2 non-goals).
- Multi-location reporting.

P2 listed "payroll, wages, clock-in/clock-out" as non-goals; this phase brings in **clock-in/out and hourly wages for labour cost only**.

**Anti-goals:**
- **Numbers that don't add up.** Monthly profit must equal sales − food and drink cost − labour − other costs to the kuruş; the overview's month strip must agree with the monthly page; a dish's rating count must match the ratings stored. P2's money rules still apply.
- **An empty or flat dashboard on a fresh demo.** Every chart has history and visible variation.
- **A ranking nobody can explain.** Every score must show its breakdown.
- **Staff seeing each other's numbers.** A staff member only ever receives their own performance data from the API.

## 3. Guest ratings

- **When:** once a check is paid (in full or every share), the guest QR menu for that table shows a rating card. The prompt stays available for that check until the table's guest session ends **(Claude's call)**.
- **What:** one rating out of 5 for **the waiter** (the check's server); one rating out of 5 for **each distinct dish** on the check (voided items excluded; comped items included); and the **restaurant overall** in three general categories, each out of 5: **Food**, **Cleanliness**, **Atmosphere** (owner-decided: three general categories such as food and cleanliness; the third, Atmosphere, is Claude's call). The **restaurant rating** is the average of the three categories. Each part is optional; at least one star value is required to submit. An optional comment (max 500 characters).
- **One rating per check** **(Claude's call)**: whoever at the table submits first; afterwards the card shows "Thanks". A second submission is rejected by the database (unique key on the check), not only in the UI.
- **Kitchen and bar staff are not rated directly**; dish ratings feed their station's score (§5).
- **Comments:** the manager can hide a comment (abusive, personal data) from every dashboard; its star values still count. Hidden is reversible.
- EN + TR, keyboard and screen-reader usable star inputs (WCAG 2.2 AA, as everywhere).

## 4. Time clock

### 4.1 Clocking in and out
- A **Time clock** screen reachable from the staff sign-in screen (a "Clock in / out" button) on any staff device. Pick your name, enter your PIN, and it shows "Clocked in 10:58" or "Clocked out, 7 h 12 min today".
- **Schedule-only roles (cook, bartender, host, dishwasher; P2 §6.1) have no sign-in PIN today.** They get a **clock PIN** that works only on the time clock and never signs in **(Claude's call)**. Managers set it like a sign-in PIN. Station accounts (Kitchen, Bar) never clock in.
- Rate-limit PIN attempts like sign-in.
- A person can't be clocked in twice. Forgotten clock-outs: the manager can edit or add a clock entry (start, end, reason); edits are kept in the entry's history and marked "edited" in reports.
- An open entry older than 16 h (P2's max shift) is flagged on the overview as "forgot to clock out?" and is excluded from hours until fixed **(Claude's call)**.

### 4.2 Actual versus planned
- Each clock entry is matched to the person's shift on that service day, if any.
- **Late** = clocked in more than 5 minutes after the shift start **(Claude's call)**; **missing** = shift started, not clocked in, still not in after 15 minutes; **unscheduled** = clocked in with no shift.
- **Overtime** = actual hours beyond 45 in a week (the Turkish weekly limit P2 already uses).

### 4.3 Wages
- Every person on the schedule gets an **hourly rate** (₺), set by the manager on the Staff screen; visible to managers only.
- **Labour cost** = clocked hours × the rate in force at that time (keep rate history so changing a rate doesn't rewrite past months) **(Claude's call)**, with **overtime hours (beyond 45 in a Monday–Sunday week) at 1.5×**, the Turkish Labour Law premium **(Claude's call)**. No payroll beyond this. Details in §13.

## 5. Staff performance and ranking

- **Ranked per role group** (Floor: waiters; Kitchen: cooks; Bar: bartenders) **(Claude's call)**. Station accounts are not ranked; they are only where ticket numbers come from: people only compete with people doing the same job. Managers, hosts and dishwashers get hours and lateness but no ranking **(Claude's call)**.
- **Score = guest ratings combined with work done** (owner-decided). Inputs:
  - **Waiters:** their average waiter rating; checks and covers handled; sales on their checks; reliability (lateness).
  - **Kitchen / bar people:** the average dish rating of dishes their station made during the shifts they worked; tickets completed by their station during those shifts and how often within the ticket-time threshold; reliability.
- The exact formula is the builder's call within these rules: a **0–100 points** score; each component's contribution is **shown as a breakdown** wherever a score appears; a person needs a minimum number of ratings and shifts in the period to be ranked (otherwise "not enough data yet"); work volume is normalised per hour worked so part-timers aren't punished.
- Periods: this week, this month, and any past month.
- **Manager:** the full ranking per group, each person's breakdown, and a per-person page (hours actual vs planned, lateness, ratings trend, comments about them, points history).
- **Staff ("My performance")**, next to P2's "My shifts" for anyone who signs in: their own rating, comments about them (hidden ones excluded), hours, lateness, points with breakdown, and their position as "2nd of 6 waiters", **never other people's names or numbers**. Schedule-only staff can't sign in, so they have no My performance page.

## 6. Expenses and budgets

- **Manager only.** Add, edit, delete an expense: amount (₺), category, date, optional supplier/payee, optional note.
- **Categories** (seeded, manager can add more): Suppliers – food, Suppliers – drinks, Rent, Utilities, Repairs and maintenance, Marketing, Other. Supplier categories count as **food and drink cost**; the rest as **other costs**. Wages are not entered here; labour comes from §4.3.
- **Monthly budget** per category, set by the manager; spending versus budget shown on the overview and the monthly page.
- List with filters (month, category) and CSV export.

## 7. Manager overview

The manager's landing screen. Layout **A, "Today first"** per the mockup:
- **Today, top row:** sales today so far (vs same weekday last week to the same time, as P2 Sales), covers, restaurant rating (last 7 days, the average of food, cleanliness and atmosphere), and profit this month with margin.
- **Who's working now:** everyone scheduled today with status: on shift (clocked-in time), late (by how much), missing, later today, finished, plus unscheduled clock-ins and "forgot to clock out?" flags. Updates live (Socket.IO, as the rest of the staff app).
- **Top staff this week:** top 3 per group with rating and points.
- **Expenses this month:** total against total budget with a bar, latest entries.
- **Dish ratings:** best dishes and any dish that "needs work" this week.
- **This month at a glance** (owner-decided): the month's most important numbers only, with a link to the monthly page: sales, profit and margin, food cost %, labour %, expenses against budget.
- Each block links to its detailed page. P2's **Sales** page (today/7/30 days) stays as the operational sales view **(Claude's call)**.

## 8. Monthly business dashboard

A separate manager page: **every meaningful number for a month, in detail.** Month picker (any month with data); every figure compares with the previous month. Export the page as **PDF** and its tables as **CSV**. Sections per the mockup:

1. **Profit and loss:** sales; food and drink cost (and % of sales); labour (and %); other costs by category; profit and margin.
2. **Sales patterns:** sales by day; by weekday; by hour; average check and per cover; covers; sales per labour hour; table turns per night.
3. **Menu, popularity × rating:** every dish sold, with quantity, revenue, average rating and rating count, sorted into four groups: **Stars** (sells a lot, rated high), **Hidden gems** (rated high, sells little), **Fix** (sells a lot, rated low), **Rethink** (both low). Thresholds: the month's median quantity and a 4.0 rating **(Claude's call)**.
4. **Staff:** per person: hours actual (planned), late count, rating, points; labour cost by role group; overtime hours.
5. **Guests and ratings:** the restaurant rating and each of its three categories (food, cleanliness, atmosphere) with change vs the previous month; rating spread 1–5 for the restaurant categories, waiters and dishes; averages over the month by week; latest visible comments.
6. **Expenses:** per category spent vs budget; the biggest single expenses.

Every chart has a text equivalent (table or visible numbers), EN + TR, AA contrast. Chart approach is the builder's call, consistent with P2's Sales page.

## 9. Demo history

Each new sandbox (P1 §9) is seeded so every screen above is full on first open:
- **About 4 months** of history relative to sandbox creation **(Claude's call)**, so the monthly page has a previous month to compare against even early in a month. P2's 60 days of sales summaries grow to match.
- Ratings for most past checks' worth of summary data (believable: mostly 4–5, a few low; one dish clearly "Fix", one "Hidden gem"; a few comments in EN and TR); clock entries matching the past schedule, with occasional lateness and one or two overtime weeks; hourly rates for all staff; four months of expenses with realistic Karaköy-bistro amounts and one category over budget this month.
- **Today:** some staff clocked in, one person late, one due later, so "Who's working now" shows every state.
- Deterministic per sandbox creation time and cheap, like P2: aggregate what the dashboards need rather than generating months of raw checks, so 200 sandboxes stay small on the free database. The builder decides the storage shape, but dashboards must read the same way for seeded and live data.

## 10. Security and privacy

- New manager-only API routes check the manager role server-side; "My performance" returns only the signed-in person's data.
- Hourly rates and other people's performance never reach a non-manager browser.
- Rating submission is tied to the table's guest session and a paid check of that table; one per check; rate-limited.
- Comments are stored as text, rendered escaped, and the manager can hide them.

## 11. Testing (in addition to P1 §11 and P2 §11)

At least: rating only after payment and only once per check (parallel submits), voided items not ratable; clock in/out including double clock-in, forgotten clock-out, manager edit, late/missing/unscheduled classification at the edges; labour cost with a rate change mid-month; score breakdown sums to the score and "not enough data" below the minimum; a staff member's My performance never contains another person's data (API test); profit reconciliation (P&L adds up to the kuruş and the overview strip equals the monthly page); menu quadrant thresholds; one e2e: guest pays → rates waiter and a dish → manager overview and monthly page reflect it; axe on every new screen; EN + TR.

## 12. Left to the builder

Data shapes and collection names, the score formula within §5's rules, chart implementation, PDF layout for the monthly export, page layout details within the staff design standard and the mockups, pagination, and the order of work (suggested: ratings → time clock and wages → expenses → performance → overview → monthly page, each demo-able on its own).

## 13. Clarifications (answers to the builder check, all Claude's calls)

1. **Seeded history is pre-aggregated.** The data model is a per-service-day rollup (extending P2's daily summaries) with per-dish, per-waiter, per-station and per-person figures: sales, covers, checks, rating sums and counts, ticket counts and on-time counts, clocked hours, labour cost. Live data writes the same rollup when a service day closes; the current day is computed live. Individual rating documents exist for live ratings and, in the seed, only for the last ~14 days and for every seeded comment. The "counts match" anti-goal means: for any day that has individual rating documents, the rollup's counts equal them exactly; dashboards always read the rollup (plus today live), for seeded and live data alike.
2. **Today in the demo is anchored to sandbox creation time.** Today's seeded shifts and clock entries are generated relative to the creation moment so every "Who's working now" state exists when the visitor first opens it (on shift, late, due later, finished), then ages naturally. The seeded weeks stay consistent with P2's seeded schedule, including the 47 h warning, which also produces some overtime.
3. **Overtime** is paid at 1.5× the hourly rate. Weeks run Monday–Sunday by service day. Within a week, hours are taken in time order and those beyond 45 are overtime; overtime cost is booked on the service day it occurs, so a week split across two months splits correctly.
4. **Kitchen and bar attribution** uses the **clocked** interval, not the planned shift. A station's tickets and dish ratings in a time window are shared equally among that station's people clocked in during that window (a cook alone for an hour gets all of it; two overlapping cooks get half each). Per-hour station figures in the rollup make this computable.
5. **Profit is cash basis**: expenses count in the month of their date; no inventory or cost-of-goods. The current month is always labelled **"so far"**, and the overview and monthly page compare it with **the same point of the previous month** (as P2 Sales does for today). The seed spreads supplier deliveries through the month and puts rent and utilities on realistic dates, so a mid-month margin looks plausible. Past months are complete.
6. **Restaurant categories** are stored per day in the rollup (sum and count per category) and as fields on the individual rating document, exactly like waiter and dish ratings.
7. **Rating attribution:** the waiter rated is the check's server **at payment time**. One rating per check, including split checks paid by several guests. A rating can be submitted until the table's guest session ends or 24 hours after payment, whichever comes first, and counts in the service day of the payment.
8. **Time clock access:** it works without a staff session on any device already bound to the restaurant (in demo, the visitor's sandbox, exactly as the sign-in screen is today); it lists the same names as the sign-in picker, so nothing new is exposed. A person can clock in for themselves on any such device. PIN attempts are rate-limited per person and per device, as sign-in.
9. **Monthly PDF** is generated on the server with `pdfkit`, as P2's schedule PDFs: the section tables plus simple bar charts drawn with pdfkit primitives, so tests can parse the text.
10. **Rate history** is effective from the moment a new rate is saved. A clock entry is priced at the rate in force at its clock-in time; when a manager edits an entry, it is repriced at the rate in force at its (new) start.
