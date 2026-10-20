# StormReady v1.2 "Resilience" — New Feature Project Plan

**Release:** v1.2 "Resilience" (proposed)
**Status:** Draft for review — not yet approved for execution
**Author:** Mobile engineering
**Companion docs:** `docs/spec/01-project-plan.md` (v1.1 plan), `docs/spec/02-project-plan.md` (v1.1 summary), `docs/spec/01-technical-build-spec.md`, `docs/spec/02-technical-build-spec.md`
**Baseline:** StormReady v1.1.0 — Expo SDK 58, React Native 0.88, Expo Router, local-first, no accounts, no cloud sync, no analytics

---

## 0. How to read this document

This plan describes **new features that can be added to StormReady** on top of the shipped v1.1 baseline. It is not a rewrite of v1.1; every feature below is additive and preserves the four non-negotiable properties of the current product:

1. **Local first.** Everything works with the device in airplane mode. Network is an enhancement, never a precondition.
2. **The app plans; the authority decides.** StormReady never asserts that a zone, shelter, route, quantity, or alert is current or safe. It shows provenance, timestamps, and official sources.
3. **No accounts, no cloud sync, no analytics, no tracking.**
4. **Plain language, calm tone.** No fear marketing, no fake urgency, no alarmist copy.

**Sections:**

| Section | Content |
|---|---|
| §1–§3 | Executive summary, current-state audit, principles, personas |
| §4 | **Feature catalogue** — the core of this document. 12 new features, each with problem, scope, user flow, data model, offline behavior, acceptance criteria, effort, and risk |
| §5 | Prioritization and release cut lines |
| §6 | Phased roadmap (P0–P3) with dependencies |
| §7 | Schema v3 migration design |
| §8 | New module and route map |
| §9 | Dependency, risk, and privacy review |
| §10 | QA and test plan |
| §11 | Non-goals, deferred ideas, open questions |
| §12 | Success measures and reporting |

**Requirement IDs** are `R-<FEATURE>-<n>` (e.g. `R-INV-2`). **Feature IDs** are `F<nn>`. Every acceptance criterion in §4 is written so that it can be verified either by a Jest test or by a named device check.

---

## 1. Executive summary

v1.1 "Ready Kit" gave a household three durable things: a personalized **kit list** with stated bases and sources, a **zone** with provenance, and a **checklist** that saves on-device. It also made the platform trustworthy — versioned storage, migrations, corruption recovery, tests, CI, OTA.

What v1.1 deliberately does **not** do is answer the question that follows a few weeks of use: *"I have a list — do I actually have the stuff?"* and *"we are four people; what does each of us carry?"* v1.1 knows the household as a set of numbers (people, infants, days, pets). It does not know the household as a set of **people, possessions, and commitments**.

**v1.2 "Resilience"** closes that gap with twelve additive features across four themes:

| Theme | Features | The question it answers |
|---|---|---|
| **Possession** | F01 Kit Inventory & Expiry Tracker, F02 Go-Bag Builder, F03 Medication & Medical Plan | "Do I actually have it, and who carries what?" |
| **People** | F04 Family Communication & Meeting Plan, F06 Household Transfer, F07 Multi-Household Profiles | "How do my people reach each other?" |
| **Situations** | F05 Travel Mode, F08 Scenario Drills | "What if the situation is not the one I planned for?" |
| **Craft & reach** | F09 Readiness Score & Seasonal Dashboard, F10 Spanish (es-MX) Localization, F11 Home-Screen Widget, F12 Zone Provider Registry | "Does it feel like my product, in my language, on my home screen?" |

**The bet:** preparedness decays. A list that cannot be *checked off against reality*, *divided between people*, or *rehearsed* is a document, not a plan. v1.2 turns the plan into something a household **maintains and practices**.

| | v1.1 (shipped) | v1.2 (proposed) |
|---|---|---|
| Kit | A calculated list of what you need | A **tracked inventory** of what you own, with expiry and reorder |
| Responsibility | One shared household | **Per-person go-bags** and per-person medical details |
| Communication | A destination and a transport note | Out-of-area contacts, meeting point, check-in plan, offline cards |
| Practice | A checklist you tick | **Scenario drills** you run in ten minutes |
| Context | One household | Travel mode, **multiple households**, seasonal readiness |
| Language | English | **Spanish (es-MX)** with localized Mexico sources |
| Surface | In-app only | **Home-screen widget** glance, local transfer to a relative's phone |
| Privacy | Local-only | Unchanged — local-only, no accounts, no cloud, no analytics |

**Deliberate non-goals for v1.2** (see §11): no accounts, no backend, no push server, no live traffic, no automatic zone coverage beyond Florida, no store submission, no paid tier, no user-generated content that leaves the device.

**Definition of success for v1.2:** a household can install the app, create one go-bag per person, mark half the kit lines as "have it" with an expiry date, record an out-of-area contact, run one scenario drill, and share a single plan card with a relative's phone — entirely offline, with no account, and without the app ever claiming something is "safe".

---

## 2. Current-state audit (v1.1 baseline)

What already exists, so that nothing in §4 duplicates it and every proposal builds on a real seam.

| Area | Existing implementation | Seam this plan uses |
|---|---|---|
| Storage | `src/storage/store.ts` (versioned, debounced, corruption-quarantined), `src/storage/keys.ts`, `src/storage/migrate.ts` (v1 → v2) | New documents get a new `KeySpec` in `keys.ts` and a pure migration function; the store never changes shape. |
| Plan schema | `src/plan-schema.ts` — `PlanState` with `household`, `zone`, `destination`, `tasks` | v1.2 adds **new top-level fields** to `PlanState` (see §7) so a single `plan` document stays the source of truth. |
| Kit domain | `src/kit/catalog.ts` (18 items, basis + source each), `src/kit/calculator.ts` (pure), `src/kit/format.ts` | Inventory (F01) attaches *user state* to catalog item ids; the calculator stays pure. |
| Zone | `src/zone/verification.ts` — manual entry, staleness at 90 days, provenance labels, official source links | F12 wraps the source list into a provider registry so new counties can be added without touching screens. |
| Alerts | `src/alerts.ts` + Updates screen; NWS `api.weather.gov` for US, saved snapshot for offline | F05/F08 reuse the snapshot; no new alert backend. |
| Map | `src/app/(tabs)/map.native.tsx` — offline vector packs, shelters (FEMA + Overpass), zone sheet, offline routing on a downloaded road graph, county PDF in a WebView | F11's widget reads saved plan state; it never touches the map. |
| Notifications | `src/notifications/scheduler.ts` — opt-in, weekly checklist nudge, monthly zone recheck, two channels | F01 expiry reminders and F09 seasonal refresh extend the same scheduler. |
| UI kit | `src/ui.tsx` — `Page`, `Header`, `Card`, `Label`, `Body`, `Field`, `Action`, `Pill`, `Row`, `ProgressBar`, `Stepper`, `ToggleRow`, `MotionPressable`; tokens in `src/theme.ts` | All new screens reuse these primitives; no new design system in v1.2. |
| Tests | Jest (`jest-expo`) + React Native Testing Library; coverage floor 80 % on `src/kit`, `src/storage`, `src/zone`, 60 % global | New modules `src/inventory`, `src/gobag`, `src/medical`, `src/comms`, `src/scenarios` are added to the 80 % floor. |
| CI | GitHub Actions: lint, typecheck, test, coverage, expo-doctor | Unchanged; the plan adds no gate that the repo cannot run today. |

**Known gaps this plan addresses**

1. **No notion of possession.** The kit is a shopping list forever. There is no way to say "I have 6 gallons, bought in March, rotate in September".
2. **No division of responsibility.** Household size is a number; a household of four shares one list and one destination note.
3. **No communication plan.** `destination` is a label, an address, and a transport sentence. There is no out-of-area contact, no meeting point, no check-in cadence.
4. **One household per install.** A person with a home, a rental, and a lake house must overwrite one another.
5. **No rehearsal.** The app tells you what to do but never helps you practice it.
6. **English only.** The product ships to Mexico with English copy and US-centric sources.
7. **The app is invisible when it matters.** A readiness glance requires opening the app.

---

## 3. Product intent, principles, and personas

**North star:** a household can answer "are we actually ready, and does everyone know their part?" in under a minute, offline, without an account.

### 3.1 Principles (unchanged from v1.1, sharpened for v1.2)

1. **Local first, always.** Fully useful with no connection. Every new feature in §4 has a documented offline behavior; if it cannot be offline, it says so plainly and is opt-in.
2. **The app plans; the authority decides.** StormReady never states that a zone, shelter, route, quantity, or alert is safe or current. It shows what the user entered, where it came from, and when it was verified.
3. **Plain language, calm tone.** No fear marketing, no alarmist copy, no red-alert theatre. Rehearsal features (F08) are framed as practice, not panic.
4. **Small steps, visible progress.** Each new feature shows a state the user can see and advance.
5. **Privacy is a feature, stated out loud.** No accounts, no servers, no tracking. F06 transfers data **directly between two devices** by file, not through a server.
6. **Nothing is silently deleted.** New features that supersede v1.1 data keep the old value visible until the user acts on it.
7. **A feature that cannot be verified is not a feature.** Every item in §4 carries testable acceptance criteria and a named device check.

### 3.2 Personas (carried forward, extended)

| Persona | Situation | What v1.2 must deliver |
|---|---|---|
| **Marisol (Tampa, US)** | Family of 4, one dog, two adults who can drive | Per-person go-bags, an inventory she can update when she shops, a shared plan card she can send to her sister |
| **Dev (Monterrey, MX)** | Rents, no car, shares a phone with his sister | Spanish UI, Mexico-sourced local guidance, a plan he can export without an account, travel mode for the family trip |
| **Rita (Lubbock, US)** | 68, insulin, alone during a freeze, on a 130 % system font | Medication plan with refrigeration and power needs, a printed contact card, drills that fit a chair and a phone |
| **The prepared parent (Denver, US)** | Already has a kit, wants it to stay fresh | Expiry tracking with rotation reminders, a seasonal readiness score, no nagging |
| **Sol (Tijuana, MX)** *(new)* | Two addresses — home and his sister's — plus a beach house | Multiple household profiles, each with its own zone, kit, and contacts |
| **The volunteer coordinator (El Paso, US)** *(new)* | Runs a shelter block for 40 neighbors | A drill they can run with a group, a shared plan card template, no per-neighbor accounts |

### 3.3 What "additive" means here

- No existing screen is removed. New navigation entries appear only where they earn their place.
- No existing v1.1 user data is deleted or rewritten by the migration in §7. Every migration is a pure function with a unit test.
- No new network dependency is required for any P0/P1 feature in §4.
- No new third-party package is required for any P0/P1 feature. Where a package is required (F11 widget, F10 i18n), it is called out in the feature's dependency line.

---

## 4. Feature catalogue

Twelve features, each written the same way: the problem, what it does, the user flow, the data model, the offline and privacy story, acceptance criteria, effort estimate, dependencies, risks, and what is explicitly out of scope.

**Effort units** are engineering days for one mobile engineer, including tests. Estimates exclude content review time (WS-D) and device-QA time.

### 4.1 F01 — Kit Inventory & Expiry Tracker

**Theme:** Possession · **Priority:** P0 · **Effort:** 5 d

#### Problem

v1.1's kit is a *shopping list that never changes*. The user sees "14 gallons of water" forever. There is no way to record that they bought 4 gallons on 3 March, that the water cooler jugs expire in 12 months, or that the first-aid kit's antiseptic expired last week. Ready.gov's own guidance is that supplies must be **replaced on a schedule**, not checked once. A preparedness app that cannot represent possession, or the passage of time, is a static document.

#### What it does

Adds a second dimension to the kit: **inventory state per catalog item**, stored locally.

For every line produced by `calculateKit(household)`, the user can record:

| Field | Type | Meaning |
|---|---|---|
| `owned` | boolean | Do I have this item? |
| `quantityOwned` | number | How many do I actually have (may differ from the calculated amount)? |
| `purchasedAt` | ISO date \| null | When it was bought or last rotated. |
| `expiresAt` | ISO date \| null | Manufacturer expiry, if the item has one. |
| `note` | string ≤ 140 chars | Where it is stored, or a swap ("borrowed from Ana"). |

From this the app derives, purely and offline:

- **Coverage**: for the two quantities that matter most — water (gallons) and food (person-days) — the ratio of `quantityOwned` to the calculated requirement. A household of 4 needing 28 gallons and owning 12 shows **43 % covered** with the shortfall in gallons.
- **Expiring soon**: any owned item whose `expiresAt` is within 60 days.
- **Expired**: any owned item past `expiresAt`; these appear in a dedicated "Replace now" list and never disappear silently.
- **Replacement guidance**: each catalog item gains an optional `shelfLifeMonths` and `rotationNote` (e.g. water "rotate every 12 months; freeze the jug and mark the date"). A "Start rotating" action stamps `purchasedAt` to today for all water lines.

#### User flow

1. **Kit screen → new "Inventory" section** below the calculated list. Each line gains a small state pill: `Not tracked`, `Have it`, `Short`, `Expired`.
2. Tapping a line opens a sheet (not a new route) with: owned toggle, quantity stepper (defaults to the calculated quantity), purchased date, expiry date, note field.
3. Tapping **Mark all as not tracked** clears inventory state for the current household and asks for confirmation.
4. A **Coverage card** at the top of the Kit screen shows water and food coverage as two horizontal meters with plain-language text ("You have 12 of 28 gallons — 8 short"), plus a count of expiring and expired items.
5. The **Home screen** shows a single line: "12 of 18 kit items tracked" with a link to the Kit.
6. Optional **rotation reminder** (extends the existing notification scheduler): one notification per household per year, at the user's chosen month, titled "Time to rotate your water and check expiry dates". Opt-in, low-importance channel, off by default.

#### Data model

New top-level `PlanState.inventory` (see §7 for the full v3 shape):

```ts
export type InventoryEntry = {
  itemId: string;          // matches KitLine.id in the catalog
  owned: boolean;
  quantityOwned: number;
  purchasedAt: string | null;   // ISO 8601
  expiresAt: string | null;     // ISO 8601
  note: string;
};

export type InventoryState = {
  entries: Record<string, InventoryEntry>;  // keyed by itemId
  lastRotationAt: string | null;
};
```

Two pure modules, both fully unit-testable and both under the 80 % coverage floor:

- `src/inventory/model.ts` — `upsertEntry`, `removeEntry`, `coverageFor(lines, inventory)`, `expiringItems(entries, now, days)`, `expiredItems(entries, now)`.
- `src/inventory/rotation.ts` — `rotationDateFor(entry, shelfLifeMonths)`, `nextRotationMonth(entries)`.

**Rules:**

- `R-INV-1` — Inventory is keyed by catalog `itemId`. A catalog item that is deleted in a future version leaves its inventory entry orphaned; the orphan is **preserved** and shown in a "no longer in your kit" list until the user removes it.
- `R-INV-2` — `quantityOwned` is clamped to `[0, 9999]` and stored as an integer. A non-numeric entry falls back to 0 rather than corrupting the document.
- `R-INV-3` — Dates are stored as ISO strings. A date in the future for `purchasedAt` is rejected with an inline error; a past `expiresAt` is allowed (that is how an expired item is recorded).
- `R-INV-4` — Coverage is computed from `calculateKit(household)` output, so changing household size immediately changes the required amount and the coverage percentage. It is never stored.
- `R-INV-5` — Inventory never changes the calculated kit. The two are displayed side by side and never merged into one number, so the user can always see what the guidance says *and* what they have.

#### Offline and privacy

Fully offline. No network calls, no new storage key, no permissions. Inventory lives inside the existing `plan` document, so it participates in the v1.1 migration and corruption-recovery machinery for free.

#### Acceptance criteria

- [ ] `R-INV-6` — Toggling "Have it" on a kit line updates the coverage card without a network request and survives an app restart.
- [ ] `R-INV-7` — Changing household `people` from 4 to 5 updates the water coverage percentage to reflect the new requirement (28 → 35 gallons) with no manual re-entry.
- [ ] `R-INV-8` — An item with `expiresAt` in 30 days appears in "Replace soon"; an item expired 5 days ago appears in "Replace now"; both appear on Home as a count.
- [ ] `R-INV-9` — "Start rotating" sets `purchasedAt` to today for every water and food entry that has no date, and does nothing for entries that already have one.
- [ ] `R-INV-10` — Deleting an app-level catalog item (simulated in a test fixture) does not delete the corresponding inventory entry; the orphan is listed and can be removed explicitly.
- [ ] `R-INV-11` — Unit tests cover: empty inventory, partial coverage, over-coverage (> 100 % is shown as "covered", never as an error), expiring window boundaries (exactly 60 days in, 61 days out), expired items, and clamping of a corrupted `quantityOwned` of `"abc"`.
- [ ] `R-INV-12` — Device check: airplane mode → set inventory on 3 lines → kill and relaunch → state intact, coverage card correct.

#### Dependencies

`src/kit/catalog.ts` (add optional `shelfLifeMonths` + `rotationNote` per item), `src/kit/calculator.ts` (no change), `src/plan-schema.ts` (§7), `src/notifications/scheduler.ts` (rotation reminder).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users read "43 % covered" as "you are unsafe" | Medium | High | Coverage copy is neutral and paired with "this is your own tracking, not an official requirement"; no color-coded danger states |
| Catalog churn orphans entries | Low | Medium | `R-INV-1` orphan list; a catalog item is never removed without a migration that also migrates inventory |
| Inventory bloats the plan document | Low | Low | ~18 items max; a JSON document of a few KB |

#### Out of scope

Barcode scanning, expiry photo capture, cloud sync, "smart" reorder suggestions, sharing inventory with other people.

---

### 4.2 F02 — Go-Bag Builder (per-person grab-and-go bags)

**Theme:** Possession · **Priority:** P0 · **Effort:** 5 d

#### Problem

The v1.1 kit is a single list for a single household. Real households prepare **multiple small bags**: one per person, one in the car, one at work, one in a duffel by the door. The current model cannot express "this bag is Ana's and it lives in her backpack". When something happens in 30 seconds, the household's most important artifact is the small bag each person can grab, not a 28-gallon water calculation.

#### What it does

A **Go-Bag** is a named, per-person (or per-location) bag containing a chosen subset of kit lines, with its own progress checklist, its own notes, and an optional weight and location field.

- Bags are created from a template: **"Personal go-bag"** (one per person), **"Vehicle kit"**, **"Work bag"**, **"Kids' bag"**, **"Home shelter kit"**. Templates pre-select sensible items (e.g. vehicle kit: water for 2 days, first-aid, flashlight, charging cable, blanket, cash).
- Each bag references **kit line ids** rather than duplicating them, so a change in household size updates the quantities shown in every bag automatically.
- A bag has a **location** field ("in the car", "under the bed", "at Mom's") and a **responsible person**.
- A bag has its own **checklist of what is packed** — separate from the household kit's "do I own this" state, because "we own it" and "it is in the bag I would grab" are different facts.
- A **"Grab list"** screen shows every bag in one view: name, owner, packed count, missing high-priority items, location.
- Bags can be **shared as text** through the system share sheet, so a family member can build the same bag at their own home. No account, no server.

#### User flow

1. **Plan → "Go-bags" section** (or a new top-level card on Home for households with ≥ 2 people).
2. "Add a bag" → name, owner (a person name, free text), location, template.
3. The bag screen lists the template's items with quantities, each with a "Packed" checkbox and a "Remove" action.
4. Adding an item not in the template opens a picker filtered by the current kit categories, with the calculated quantity pre-filled.
5. "Share bag" produces plain text: bag name, owner, location, each item with quantity and a ☐/☑ marker, plus the household kit link. It is generated offline.
6. Optional: each bag shows a **completeness percentage** against its own item list, and bags below 50 % are flagged on Home as "Ana's go-bag is half empty".

#### Data model

```ts
export type GoBag = {
  id: string;              // uuid-like, generated locally
  name: string;
  owner: string;           // free text, may be empty
  location: string;
  template: 'personal' | 'vehicle' | 'work' | 'kids' | 'home' | 'custom';
  itemIds: string[];       // kit line ids
  packed: Record<string, boolean>;  // kit line id → packed
  note: string;
  createdAt: string;
};

export type GoBagState = { bags: GoBag[] };
```

Pure module `src/gobag/model.ts` with: `createBag(template, household)`, `itemsForBag(bag, kitLines)`, `bagProgress(bag, kitLines)`, `bagToText(bag, kitLines, household)`.

**Rules:**

- `R-BAG-1` — A bag stores **line ids only**. If a line disappears from the calculated kit (e.g. "Pets" lines when `household.pets` is false), the bag keeps the id and displays it as "Not in your current kit" rather than silently dropping it.
- `R-BAG-2` — Templates are data, not code branches: `src/gobag/templates.ts` maps a template to a list of catalog item ids plus a title. Adding a template is a data change.
- `R-BAG-3` — `bagProgress` is derived, never stored.
- `R-BAG-4` — Bags are per-household in v1.2 (they live inside the active household profile, see F07). A bag belongs to exactly one profile.
- `R-BAG-5` — Sharing a bag produces text only. No image, no link, no server round-trip.
- `R-BAG-6` — Deleting a bag requires a confirmation that names the bag and its packed count.

#### Offline and privacy

Fully offline. Text export only. `R-BAG-5` is a privacy requirement, not an implementation detail: a shared bag must never include the household's zone, contacts, or medical details — only the bag's own items and quantities.

#### Acceptance criteria

- [ ] `R-BAG-7` — "Add a personal go-bag" for a 2-person household creates two suggested bags, each with the personal template's items and correct quantities for 1 person.
- [ ] `R-BAG-8` — Marking an item packed updates the bag's percentage immediately and persists across a restart.
- [ ] `R-BAG-9` — Increasing `household.days` from 7 to 14 changes the water quantity shown inside every bag that includes water.
- [ ] `R-BAG-10` — Turning off "we have pets" leaves a pet item in the bag, marked "Not in your current kit", rather than removing it.
- [ ] `R-BAG-11` — The shared text contains the bag name, owner, location, and item list, and contains **no** zone, contact, or medical text (asserted by a unit test over `bagToText` output).
- [ ] `R-BAG-12` — Unit tests cover template expansion, progress math with an empty bag, a bag with an unknown line id, and the `bagToText` privacy assertion.
- [ ] `R-BAG-13` — Device check: create 3 bags, pack items, share one via the system sheet, and confirm the text on a second device.

#### Dependencies

`src/kit/catalog.ts`, `src/kit/calculator.ts`, `src/kit/format.ts` (text formatting), `src/plan-schema.ts` (§7).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Template content is opinionated and may not fit every culture or household | High | Medium | Templates are suggestions; every item can be added or removed; the copy says "a starting point" |
| Users duplicate the kit list by hand in bags | Medium | Low | Bags reference kit lines; the copy explains that quantities follow your household automatically |
| Bag count grows and the UI becomes noisy | Low | Low | Bags live on one screen with a summary row; no new bottom tab |

#### Out of scope

Bag sharing between devices automatically (F06 is file-based, not bag-based), weight-based auto-optimization, bag photos, per-bag expiry dates (v1.3 idea).

---

### 4.3 F03 — Medication & Medical Needs Plan

**Theme:** Possession · **Priority:** P1 · **Effort:** 6 d

#### Problem

v1.1's household model has a single boolean, `medicalNeeds`, which adds one generic line to the kit. Real medical preparedness is more specific and more life-critical than that: it is a list of specific medicines with doses and schedules, whether each needs refrigeration, which devices need power, who the clinician is, and what happens if the power is out for 12 hours. The kit line "Prescription medicines and medical supplies — 7 days" does not help a person who needs to know whether their insulin can stay cold.

#### What it does

A **Medical Plan** attached to the household, containing three sections.

**1. Medication list.** Each entry:

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. "Insulin glargine" |
| `dose` | string | e.g. "10 units" — free text, since formats vary |
| `schedule` | string | e.g. "once daily at bedtime" |
| `days` | number | Days of supply on hand (defaults to `household.days`) |
| `refrigerated` | boolean | Shows a cold-chain line in the kit |
| `prescriptionRefillDate` | ISO date \| null | Feeds a "refill due" reminder |
| `pharmacy` | string | Name and phone, optional |
| `notes` | string | E.g. "store in the door shelf, not the back" |

**2. Powered medical devices.** Entries for devices that need electricity: oxygen concentrator, ventilator, powered wheelchair, CPAP, infusion pump, refrigerated insulin. Each has `deviceName`, `powerSource` (mains / battery / both), `backupHours` (how long the device can run on battery), and `needsRefrigeration`.

**3. Clinician and facility contacts.** Free-text name, phone, and role (primary clinician, pharmacy, specialist, dialysis center, facility). A single "call in advance" note.

**Downstream effects (this is the point of the feature):**

- The **kit calculator** gains a `medical` category whose lines are driven by the medical plan rather than by a boolean:
  - *"Refrigerated medication cooler pack"* — 1 per household that has any refrigerated medicine, with basis "Your medical plan lists N refrigerated medicines" and a note about a 48-hour qualified cooler.
  - *"Backup power for medical devices"* — 1 per household that lists a powered device, with basis listing the device names.
  - *"Extra prescription days"* — the medication list's minimum `days` across entries, so a person on a 30-day prescription is not told to stock 7.
- The **Plan screen** shows a compact "Medical" card: number of medications, earliest refill date, whether any device needs power, and the coldest-chain item.
- A **"Medical summary card"** can be printed or shared as text (§F06) for a hospital or a neighbor — with the user choosing exactly which fields to include. It is the single most valuable export in the app for the "Rita" persona.

#### User flow

1. **Plan → Medical card → "Add a medication"** (or set `medicalNeeds` to true during onboarding, which now links to this screen).
2. A medication row expands in place to show dose, schedule, days, refrigeration, refill date, pharmacy.
3. A **"Cooler check"** line appears when any medication is refrigerated: "Keep these below 8 °C. A qualified cooler holds 48 hours without ice." with a link to a CDC/FDA source.
4. A **"Power plan"** section appears when a powered device is listed: it shows `backupHours` and reminds the user that a power outage longer than that needs a generator or a facility.
5. **Export** produces a text card: name, medication, dose, schedule, allergy/notes, clinician, pharmacy. The user toggles fields before sharing.

#### Data model

```ts
export type Medication = {
  id: string;
  name: string;
  dose: string;
  schedule: string;
  days: number;
  refrigerated: boolean;
  prescriptionRefillDate: string | null;
  pharmacy: string;
  notes: string;
};

export type MedicalDevice = {
  id: string;
  name: string;
  powerSource: 'mains' | 'battery' | 'both';
  backupHours: number;
  needsRefrigeration: boolean;
};

export type MedicalContact = {
  id: string;
  name: string;
  phone: string;
  role: string;
};

export type MedicalPlan = {
  medications: Medication[];
  devices: MedicalDevice[];
  contacts: MedicalContact[];
  allergies: string;
  notes: string;
};
```

Pure module `src/medical/model.ts`: `medicalKitLines(plan, household)`, `earliestRefill(plan)`, `needsRefrigeration(plan)`, `needsPower(plan)`, `medicalCardText(plan, selectedFields)`.

**Rules:**

- `R-MED-1` — `household.medicalNeeds` becomes a **derived** value: `true` when the medical plan is non-empty. The old boolean is preserved in storage for migration and still accepted as an input, but the new plan is the source of truth.
- `R-MED-2` — No medical line in the kit is ever stated as a clinical requirement. Every basis string names the user's own input ("Your medical plan lists 2 refrigerated medicines"), and every line links to a public, non-clinical source (CDC, FDA, Ready.gov). The copy states: "This is a planning aid. Your clinician decides what you need."
- `R-MED-3` — The medical card export is **opt-in per field**. Nothing is included unless the user selects it. The default selection is name, dose, schedule, and allergies.
- `R-MED-4` — `days` is clamped to `[1, 365]`; `backupHours` to `[0, 168]`.
- `R-MED-5` — Phone numbers are stored as free text and rendered as `tel:` links. No call is ever placed automatically.
- `R-MED-6` — The medication list is included in the v1.2 **encrypted-at-rest** consideration only insofar as the plan document itself remains on-device; the medical plan is never written to the area pack, the alert snapshot, or any share text except the explicit card export.

#### Offline and privacy

Fully offline. All medical data stays in the plan document on the device. The app never requests a health permission, never syncs, and never transmits. The card export is a deliberate, user-initiated action.

#### Acceptance criteria

- [ ] `R-MED-7` — Adding one refrigerated medication adds exactly one "Refrigerated medication cooler pack" line to the kit, with a basis naming the medication count.
- [ ] `R-MED-8` — Adding a powered device with `backupHours: 8` adds a "Backup power for medical devices" line whose basis names the device.
- [ ] `R-MED-9` — A medication with `days: 30` makes the kit's "Extra prescription days" line read 30, not `household.days`.
- [ ] `R-MED-10` — The medical card export contains only the fields the user selected; the unit test asserts that an unselected `pharmacy` string does not appear in the output.
- [ ] `R-MED-11` — Setting `household.medicalNeeds = false` while the medical plan is non-empty does not delete the plan; the UI explains that the plan is still active and offers a single "remove the medical plan" action behind a confirmation.
- [ ] `R-MED-12` — Unit tests cover clamping, empty-plan behavior, the `needsRefrigeration` / `needsPower` derivations, and export field filtering.
- [ ] `R-MED-13` — Device check: airplane mode → build a 2-medication plan → export the card → confirm the text.

#### Dependencies

`src/kit/catalog.ts` (three new medical items), `src/kit/calculator.ts` (accepts the medical plan as an optional second argument — a **backwards-compatible** signature change: `calculateKit(household, medicalPlan?)`), `src/plan-schema.ts` (§7).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users treat the app as clinical advice | Medium | High | No clinical claims, no dosing guidance, always "ask your clinician"; content review of every medical string (WS-D) |
| Sensitive data on a shared or lost device | Medium | Medium | v1.2 ships a **privacy screen** explaining on-device storage; a "wipe all data" action is added in F12 |
| The calculator signature change breaks existing callers | Low | Medium | `medicalPlan` is optional with a default of `undefined`; a typecheck plus existing kit tests catch regressions |

#### Out of scope

Dosage reminders, refill ordering, pharmacy integrations, any clinical decision support, HIPAA/regulatory claims.

---

### 4.4 F04 — Family Communication & Meeting Plan

**Theme:** People · **Priority:** P0 · **Effort:** 4 d

#### Problem

The v1.1 plan has one `destination` object — a label, an address, and a transport sentence — and a checklist line "Choose an out-of-area contact" that is never a data field. Real emergency communication is a small protocol: an out-of-area contact who is *outside* the affected area, a meeting point (a park, a school), a check-in time, and a fallback if the primary contact is unreachable. The kit includes a "Written emergency contact card" line but there is no way to fill it in.

#### What it does

A **Communication Plan** with four parts, each optional and each usable offline:

1. **Out-of-area contacts** — a list of `{ name, phone, relationship, distance }`. The app flags a contact whose `distance` is inside the likely affected area ("a contact 5 miles away may not be reachable") as information, not an error.
2. **Meeting point** — `{ label, address, note }` with a note field for landmarks ("the big oak by the north gate"). A "Use the same place for everyone" line explains why a meeting point beats a home address.
3. **Check-in plan** — `{ who, when, method, fallback }`: e.g. "Ana texts Mom every 24 hours; if no reply by 3 pm, call her landline."
4. **Backup plan** — `{ backupContact, backupMethod, note }` for when the primary contact is unreachable.

**Derived behaviour:**

- The kit gains a **"Communication card"** line when no out-of-area contact exists, with basis "No out-of-area contact recorded" — an actionable prompt inside the kit the user already looks at.
- The **Home screen** shows a "People" strip: the primary contact, the meeting point, and the next check-in, each tappable (phone / map).
- A **one-page communication card** can be shared as text (and printed via F12) with a compact format designed to be read by a stranger: "If I am missing, contact …, meet at …, I check in every …".

#### User flow

1. **Plan → Communication card.** Empty state explains the protocol in three lines with a link to a Ready.gov source.
2. Contacts are added with name, phone, and an optional "how far from home" field. `tel:` links open the dialer; the app never places a call.
3. The meeting point gets a "Show on map" action that opens the Map tab centered on the saved place if it is inside a downloaded area, otherwise it copies the address for a manual search. It never requires the network.
4. The check-in plan is free text plus a "every N hours" stepper (default 24, options 6/12/24/48).
5. **Share card** produces plain text with the four parts, plus the household size and the zone label (with its provenance, so the recipient knows how fresh it is).

#### Data model

```ts
export type EmergencyContact = {
  id: string; name: string; phone: string; relationship: string; distance: string;
};
export type MeetingPoint = { label: string; address: string; note: string };
export type CheckInPlan = { who: string; everyHours: number; method: string; fallback: string };
export type CommunicationPlan = {
  contacts: EmergencyContact[];
  meetingPoint: MeetingPoint;
  checkIn: CheckInPlan;
  backup: { contact: string; method: string; note: string };
};
```

Pure module `src/comms/model.ts`: `communicationCardText(plan)`, `commsCompletion(plan)` (0–100 % of the four parts filled), `needsOutOfAreaContact(plan)`.

#### Offline and privacy

Fully offline. No network call, no new storage key, no permission. Contacts are stored as free text in the plan document and are never transmitted, synced, or shared except through the explicit card export the user initiates.

**Rules:**

- `R-COM-1` — Phone numbers are free text, rendered as `tel:` links, never dialed automatically.
- `R-COM-2` — The shared card includes the zone label **with its provenance and age**, and never asserts the zone is current.
- `R-COM-3` — The card omits anything the user has not filled in — no placeholder "N/A" lines.
- `R-COM-4` — `everyHours` is clamped to `[1, 168]`.
- `R-COM-5` — "Show on map" only works for a meeting point that resolves to coordinates; it stores coordinates when known and degrades to copying the address when not.

#### Acceptance criteria

- [ ] `R-COM-6` — With no contacts, the kit shows a "Communication card" line and the Home "People" strip shows a "No contact recorded" state with a link.
- [ ] `R-COM-7` — Adding one out-of-area contact removes the kit's "Communication card" line, because the need is met.
- [ ] `R-COM-8` — The shared text contains the contact name, the meeting point, and the check-in cadence, and contains nothing for the parts the user left blank.
- [ ] `R-COM-9` — A contact whose distance string is under 15 miles is shown with a neutral informational note, not an error.
- [ ] `R-COM-10` — `tel:` links use the `tel:` scheme; a unit test asserts the scheme and that the number is not prefixed with extra characters.
- [ ] `R-COM-11` — Device check: airplane mode → fill all four parts → share the card → confirm the text.

#### Dependencies

`src/plan-schema.ts` (§7), `src/zone/verification.ts` (for the zone label and provenance), `src/kit/catalog.ts` (one new line), `src/app/(tabs)/map.native.tsx` (meeting point on map).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users put a nearby contact and think they are covered | Medium | Medium | Informational note on near contacts; the card asks for an out-of-area contact explicitly |
| Share text leaks more than intended | Low | High | The card is built from an explicit field list, unit-tested for absence of unfilled parts |
| Feature scope grows into a full contacts app | Medium | Medium | Free-text contacts only; no contact importing, no photos, no sync |

#### Out of scope

Messaging, location sharing with family, push-based check-ins, contact import from the phone.

---

### 4.5 F05 — Travel Mode (plan for somewhere else)

**Theme:** Situations · **Priority:** P2 · **Effort:** 3 d

#### Problem

The plan is always about the house you live in. Preparedness has a second geography though: a two-week trip, a road trip, a flight, a weekend at the coast. A person flying to Mexico City for ten days needs a different kit (smaller, but with a specific medicine supply, a copy of their passport, and local cash), and — critically — the app's zone, contacts, and saved map are all irrelevant or wrong there. Nothing in v1.1 lets you hold a second plan without overwriting the first.

#### What it does

A **Travel Plan** is a lightweight, separate plan that does not touch the home plan:

- Trip name, destination (free text plus an optional county/region), start and end dates, and **"who is travelling"** (reuses the household people count, or a smaller number for a subset of the household).
- A **trip kit**: the same `calculateKit` engine run against a temporary household override (fewer people, trip-length days), so a 3-person / 10-day trip produces a correct list. It is labeled "Trip kit" and is visually distinct from the home kit.
- A **travel-specific checklist** from a static template: documents and copies, medication in hand luggage, chargers and adapters, water and snacks for the transit, and — for flights — "carry-on essentials".
- **Trip notes** — free text for the things you do not want to forget, and a link to a trip-scoped contact card (built by F04, scoped to the trip).
- The saved area and zone are **not** changed. The Travel screen says so plainly: "Your home zone and map are unchanged. For orders at your destination, check the local authority."

#### User flow

1. **Home → "Add a trip"** (also reachable from the Plan screen's "Where could you go?" card).
2. Enter the trip, pick a start date and a length, and the trip kit appears immediately, calculated for the trip's own people count and days.
3. The trip checklist is ticked like the home checklist.
4. "Share trip plan" produces text: trip, dates, people, trip kit, checklist, and the trip's contact card.

#### Data model

```ts
export type TravelPlan = {
  id: string;
  name: string;
  destination: string;
  region: string;
  startDate: string | null;
  endDate: string | null;
  people: number;
  days: number;
  notes: string;
  checklist: Task[];      // reuses the existing Task type
  createdAt: string;
};
export type TravelState = { trips: TravelPlan[] };
```

Pure module `src/travel/model.ts`: `tripHouseholdOverride(trip, household)`, `tripKit(trip, household)`, `tripToText(trip, kitLines)`, `tripChecklistTemplate(trip)`.

**Rules:**

- `R-TRV-1` — A trip never mutates `PlanState.household`, `PlanState.zone`, or the saved area. Its kit is a *derived view* of the household with overrides applied.
- `R-TRV-2` — `people` is clamped to `[1, household.people]` — a trip can never claim more people than the household contains.
- `R-TRV-3` — `days` is clamped to `[1, 30]`; when the trip has both dates, `days` is derived from them and the end date wins.
- `R-TRV-4` — A trip's checklist uses the existing `Task` type and the existing `visibleTasks` relevance rules, so pets and vehicle lines appear only when relevant to the trip override.
- `R-TRV-5` — The trip text export contains the trip's own content only, and no home zone or home contact data.

#### Offline and privacy

Fully offline. No network calls.

#### Acceptance criteria

- [ ] `R-TRV-6` — A 2-person / 10-day trip produces a trip kit with 20 gallons of water, while the home kit for 4 people / 7 days still shows 28 gallons. Both are correct simultaneously.
- [ ] `R-TRV-7` — Setting `people` to 6 on a 4-person household clamps to 4 and shows a hint.
- [ ] `R-TRV-8` — Adding a trip does not change the home zone, home contacts, or saved map area.
- [ ] `R-TRV-9` — The trip text export contains no home contact names (asserted in a unit test).
- [ ] `R-TRV-10` — Unit tests cover clamping, date-derived days, and the trip-kit override math.

#### Dependencies

`src/kit/calculator.ts`, `src/plan-schema.ts` (`Task`), `src/plan.tsx` (task-toggle pattern reused for trips).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Trips add clutter to the Home screen | Medium | Low | Trips appear in a single collapsible section, and only when a trip is in the future or recent |
| Users over-trust a trip kit for a destination with different hazards | Medium | Medium | The trip screen links to the destination's local authority and states that hazards differ |

#### Out of scope

Flight/airline rules, international customs guidance, automatic destination hazard lookup, trip sharing between devices.

---

### 4.6 F06 — Household Transfer (share a plan to another device, with no server)

**Theme:** People · **Priority:** P1 · **Effort:** 5 d

#### Problem

A household plan is only useful to the people in the household, and the people in the household are often on different devices. v1.1 offers text sharing of the *kit* only, through the system share sheet, which is lossy and requires a messaging app. A parent's phone, a teenager's phone, and a grandparent's phone each need a copy of the same plan, including the medication list, the meeting point, and the contacts — and the app has no account, no server, and no sync.

#### What it does

**Plan Transfer** produces a single, self-contained file that can be moved to another device by any means the user already has (cable, Bluetooth, email to themselves, messaging app) and opened by StormReady there.

- **Export** produces a `.stormready-plan` JSON document: a versioned envelope containing the plan, the inventory, the go-bags, the medical plan, the communication plan, and the checklist state.
- **Import** reads such a file (via the document picker) and offers a **preview before merge**: a screen that shows what will be imported, what will conflict, and what will be skipped. The user chooses **Merge** (combine) or **Replace** (overwrite the local plan).
- Merge rules are explicit and conservative: checklists merge by task id, keeping the more complete state; contacts, medications, and bags union by id; the zone is **not** imported silently — the importing device keeps its own zone and is told why.
- The exported file is **redacted by default**: no medical details unless the user opts in with an explicit toggle, no inventory quantities unless opted in. The export screen states exactly what is included, in plain language.
- The file carries a `planId` (a random local id, not a device id) so repeated imports of the same export are recognized, and a `exportedAt` timestamp so the receiving device can say "this plan was exported on 3 March".

#### User flow

1. **Settings → "Share my plan"** (also from the Plan screen's footer).
2. The export screen lists the sections with toggles: household, checklist, contacts, go-bags, medical (off by default), inventory (off by default).
3. "Create file" writes it to a temporary file and opens the system share sheet so the user can send it however they like. The share sheet is the only transport — no upload.
4. On the receiving device: **Settings → "Import a plan"** opens the system document picker. After selection, a preview screen lists what will change.
5. "Merge" applies the import; a non-blocking banner confirms what was imported and what was skipped.

#### Data model

```ts
export type PlanEnvelope = {
  format: 'stormready-plan';
  version: 1;
  planId: string;
  exportedAt: string;
  sections: {
    household?: Household;
    tasks?: Task[];
    destination?: Destination;
    zone?: VerifiedZone;      // present only if the user explicitly allows it
    communication?: CommunicationPlan;
    medical?: MedicalPlan;
    goBags?: GoBag[];
    inventory?: InventoryState;
  };
};

export type ImportPreview = {
  planId: string;
  exportedAt: string;
  added: { section: string; count: number }[];
  conflicts: { section: string; count: number }[];
  skipped: { section: string; reason: string }[];
};
```

Pure module `src/transfer/model.ts`: `buildEnvelope(plan, options)`, `previewImport(current, envelope)`, `mergeEnvelope(current, envelope, decisions)`. A separate `src/transfer/file.ts` handles `expo-file-system` read/write and the document picker.

**Rules:**

- `R-EXP-1` — Medical and inventory sections are **excluded unless explicitly enabled**. The default export contains no medication names, no doses, and no inventory quantities.
- `R-EXP-2` — The zone is excluded unless enabled, and even then it is imported as `manual` with the original verification date and the original provenance, never as a fresh verification.
- `R-EXP-3` — Import never overwrites without a preview and an explicit choice.
- `R-EXP-4` — Merge never deletes local data. Local-only sections (e.g. an import that omits the medical plan) leave the local medical plan untouched.
- `R-EXP-5` — The envelope carries a `format` and `version`; a file with an unknown format or a newer version is rejected with a plain explanation and no partial import.
- `R-EXP-6` — The file is plain JSON with a documented shape; it is not encrypted. The export screen says so and recommends a private channel.
- `R-EXP-7` — No network request is made during export or import.

#### Offline and privacy

Entirely offline. The file travels by the user's own chosen channel; StormReady never uploads it.

#### Acceptance criteria

- [ ] `R-EXP-8` — A default export contains no medication names, no doses, and no inventory quantities (asserted by a unit test over the serialized envelope).
- [ ] `R-EXP-9` — Exporting with the medical toggle on includes the medical plan; the receiving device's preview reports it as an addition.
- [ ] `R-EXP-10` — Importing a plan into a device that already has a zone keeps the local zone, and the preview lists the zone under "skipped" with the reason.
- [ ] `R-EXP-11` — Importing a file with `version: 99` produces an error message and changes nothing.
- [ ] `R-EXP-12` — Importing the same file twice produces a second preview that reports "already imported" for each section, with no duplicates created.
- [ ] `R-EXP-13` — Merge unions go-bags and medications by id and never deletes a local bag.
- [ ] `R-EXP-14` — Device check: export on phone A, transfer the file to phone B by hand, import on B, confirm the preview matches the expectation and the checklist state merged correctly.

#### Dependencies

`expo-file-system` (already a dependency), `expo-document-picker` (new, Expo-supported), `src/storage/store.ts` (write-through of merged results).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users email the file and leak medical data | Medium | High | `R-EXP-1` default-redaction, plus an explicit "this file is not encrypted" warning and a "share privately" hint |
| Import corrupts the local plan | Low | Critical | Import produces a new document through the normal store path, so versioning, migration, and corruption quarantine all still apply; a unit test covers import into a populated plan |
| Scope creep into a sync product | Medium | Medium | File-based only. Any "automatic sync" request is a non-goal (§11) |

#### Out of scope

Automatic sync, cloud backup, QR-code transfer, encryption of the export file, family accounts.

---

### 4.7 F07 — Multi-Household Profiles

**Theme:** People · **Priority:** P2 · **Effort:** 6 d

#### Problem

One install, one household. A person with a home, a rental, a lake house, or a shared caregiving situation must overwrite one plan to use another. The v1.1 docs already list multi-household support as a deferred item; it is a real constraint, not a nicety.

#### What it does

A **profile** is a named container for a complete plan: household, zone, destination, checklist, kit, inventory, go-bags, medical plan, communication plan, and travel plans.

- A **profile switcher** in the app header (a small pill showing the active profile name) lets the user switch with one tap.
- The **first-run flow** asks whether to start with a new profile or a copy of the current one.
- Onboarding (v1.1's 4 steps) is reused verbatim for a new profile, so creating a second household is a 60-second flow.
- Each profile keeps its **own zone, its own saved area, and its own alerts snapshot**. The saved map area and alert snapshot keys become **per-profile** — a schema change with a migration that moves the current (single) area and snapshot into the default profile.
- Notifications are per profile: the monthly "recheck your zone" reminder follows the active profile.
- The Home screen shows the active profile name so the user always knows which plan they are looking at.
- A profile can be **exported and imported** using F06, so a family can move a profile between devices.

#### User flow

1. Tap the profile pill in the header → a sheet lists profiles with a short summary (household size, zone label, checklist progress).
2. "Add a profile" → name → the v1.1 onboarding runs for the new profile → it becomes active.
3. Switching profiles persists the selection and reloads every screen. The map shows the new profile's saved area; if it has none, it says "No offline area saved for this profile" instead of silently showing the previous profile's map.
4. "Duplicate profile" copies everything as a starting point.
5. "Delete profile" requires typing the profile name to confirm, and is refused for the last remaining profile.

#### Data model

```ts
export type Profile = {
  id: string;
  name: string;
  createdAt: string;
  color: string;        // an accent token from the theme palette
};

export type ProfilesState = {
  profiles: Profile[];
  activeProfileId: string;
};
```

The existing `PlanState` becomes the **profile-scoped payload**. Two options were considered:

| Option | Description | Verdict |
|---|---|---|
| A | Keep one `plan` document containing a map of profile id → `PlanState` | **Chosen.** One key, one version, one migration path, one corruption boundary. |
| B | One key per profile, generated dynamically | Rejected: the `KeySpec` map in `keys.ts` is static, and dynamic keys would break the "one place declares every key" rule (R-STO-5). |

So `PlanState` in schema v3 becomes:

```ts
export type PlanState = {
  version: 3;
  activeProfileId: string;
  profiles: Record<string, ProfilePlan>;   // ProfilePlan = the old PlanState payload
  ...
};
```

The area pack and alert snapshot keys become `stormready.area.v3` and `stormready.weather-alerts.v3`, each holding a map of profile id → pack/snapshot, with the v1.1 value migrated into the default profile.

**Rules:**

- `R-PRO-1` — Exactly one profile is active at a time; the selection is persisted.
- `R-PRO-2` — Every screen reads from the active profile. No screen may read another profile's data by accident.
- `R-PRO-3` — Deleting the last profile is refused.
- `R-PRO-4` — Deleting a profile requires typing its name; a deleted profile's saved area is removed with it.
- `R-PRO-5` — Switching profiles is instantaneous: all profile-scoped state is held in memory after the first load, so switching does not re-read storage.
- `R-PRO-6` — The v1.1 single plan migrates into a profile named "Home" (or "My household" in the Spanish locale), and the existing area pack and alert snapshot migrate with it.

#### Offline and privacy

Fully offline. All profile data stays on-device.

#### Acceptance criteria

- [ ] `R-PRO-7` — A v1.1 install that upgrades shows one profile named "Home" containing the existing plan, zone, checklist, saved area, and alert snapshot — with nothing lost.
- [ ] `R-PRO-8` — Creating a second profile and switching to it shows empty state everywhere (no zone, no checklist progress, no saved area), never the first profile's data.
- [ ] `R-PRO-9` — The map screen for a profile with no saved area says so explicitly and does not display the other profile's map pack.
- [ ] `R-PRO-10` — Deleting a profile asks for its name; a wrong name aborts with no change.
- [ ] `R-PRO-11` — Switching profiles twice in a row returns to identical state (no cross-contamination) — asserted in a component test.
- [ ] `R-PRO-12` — Unit tests cover the v1.1 → v3 migration (single profile + area + snapshot), the last-profile guard, and the duplicate operation.

#### Dependencies

`src/storage/migrate.ts` (a v2 → v3 migration), `src/storage/keys.ts` (new key versions), `src/plan.tsx` (provider reshaped to select the active profile), `src/app/_layout.tsx` (profile switcher), the Map screen (per-profile area pack).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The plan provider reshape touches every screen | High | High | This is the largest single change in v1.2; it is sequenced last (P2) and lands only after F01–F06 are stable |
| A migration bug loses a v1.1 user's plan | Low | Critical | The v2 → v3 migration is a pure function with a fixture-based unit test; the store's corruption quarantine and `.corrupt` backup still apply; the legacy key is retained for one release |
| Two profiles in the same house cause confusion | Medium | Medium | The active profile is always visible in the header; each profile's zone and progress are shown in the switcher |

#### Out of scope

Cloud sync, shared profiles between two people's devices, per-profile accounts, workspace-style collaboration.

---

### 4.8 F08 — Scenario Drills (rehearsal)

**Theme:** Situations · **Priority:** P1 · **Effort:** 4 d

#### Problem

A plan that has never been rehearsaled is a guess. Emergency services consistently recommend practicing: what would you grab, where would you go, who would you call. v1.1's checklist is a *shopping* checklist — it does not rehearse a decision. The app also has no place to answer "what if the power is out for three days and it is 110 °F outside?"

#### What it does

**Drills** are short, guided, offline exercises the user runs on their own. Each drill is a scenario with a small set of steps, each step being a question or an action with a checkbox, and a closing "debrief" that asks what the user would change.

Five scenarios ship in v1.2, all grounded in the US/Mexico preparedness context:

| Drill | Scenario | Steps (abbreviated) | Debrief question |
|---|---|---|---|
| **Power outage** | The grid is down for 24 hours, no cell service | Lights, radio, charged devices, fridge/freezer check, medication cold-chain, neighbour check | "What would fail first in your home?" |
| **Evacuation** | An order is issued for your zone with 6 hours' notice | Grab go-bag, confirm medication, contact out-of-area, meeting point, route, what you leave behind | "What did you decide to leave?" |
| **Shelter night** | You are in a shelter for 12 hours | Medication schedule, charging, warm clothing, documents, accessibility needs, pets | "What would you need that you did not bring?" |
| **Home medical** | A household member has a medical event and no signal | Medication list, who to call, power-dependent device, nearest facility, ICE card | "Who else knows your medication list?" |
| **Communication failure** | Phones are down for 8 hours | Out-of-area contact, meeting point, paper card, check-in cadence | "Is your meeting point known to everyone?" |

**Behaviour:**

- A drill is launched from **Plan → "Practise"**. It shows a **timer** (3, 5, or 10 minutes) and a step counter. Steps are answered one at a time (a big tappable card, one question per screen) so it works on a phone held in one hand, in the dark, at a 130 % font scale.
- Each step can be answered "Yes, ready" / "Not yet" / "Skip". "Not yet" creates a **suggested checklist task** ("Get a battery radio") linked to the existing kit lines, so a drill feeds the plan instead of being a game.
- The **debrief** screen shows the drill's score ("4 of 6 ready"), the list of "not yet" items, and a **share/save** option that writes a plain-text drill record ("Home medical drill, 3 March: 5/6 ready — not yet: spare insulin pen").
- A **drill history** is stored locally: date, drill, score, and the "not yet" items. The Home screen shows "Last drill: 12 days ago" and, after 60 days, a gentle prompt to run another.
- Drills never claim to be authoritative training. Copy says: "Practice, not a test. Nothing here is an official requirement."

#### User flow

1. **Plan → "Practise"** shows the five drills with their scenario line and length ("Power outage · 5 min"). A "start" button begins one.
2. The runner shows **one step per screen** — a large prompt, an optional hint, and three answers: "Yes, ready", "Not yet", "Skip". A step counter ("3 of 6") and a countdown timer sit in the header. The screen is scroll-free at the default font size and readable at 130 %.
3. Answering "Not yet" on a step that has a `taskLink` shows a single extra line: "Add this to your checklist?" with **Add** and **Not now**.
4. The **debrief** screen shows the score in plain language ("4 of 6 — two things to pick up"), the "not yet" list, and a "Save my drill" action. Saving writes a drill result and shows the record text with a share button.
5. **Home** shows "Last drill: 12 days ago" linking to the drill list. After 60 days it becomes "Time to practise again" — a prompt, not a nag, and it disappears as soon as a drill is recorded.

#### Data model

```ts
export type DrillId = 'power-outage' | 'evacuation' | 'shelter-night' | 'home-medical' | 'communication-failure';

export type DrillStep = {
  id: string;
  prompt: string;                 // the question shown to the user
  hint?: string;                  // one line of guidance
  taskLink?: { title: string; detail: string; category: string };  // "Not yet" → suggested task
};

export type DrillDefinition = {
  id: DrillId;
  title: string;
  scenario: string;
  minutes: number;
  steps: DrillStep[];
  debrief: string;
};

export type DrillResult = {
  id: string;
  drillId: DrillId;
  completedAt: string;
  durationSeconds: number;
  answers: Record<string, 'ready' | 'not-yet' | 'skipped'>;
  suggestedTasks: { id: string; title: string; detail: string; category: string }[];
};

export type DrillState = { results: DrillResult[] };
```

Pure module `src/scenarios/model.ts` (definitions in `src/scenarios/drills.ts`): `scoreDrill(definition, answers)`, `suggestedTasksFor(definition, answers)`, `drillRecordText(result)`, `lastDrill(results)`, `isDrillDue(results, days)`.

**Rules:**

- `R-DRL-1` — A drill is entirely offline and contains no emergency instructions. It asks questions; it never instructs the user to act in a dangerous way.
- `R-DRL-2` — The answer "not yet" produces a **suggested task**, and the user chooses whether to add it to the checklist. Nothing is added silently.
- `R-DRL-3` — A drill is never framed as a test of the user, and the score copy is encouraging: "4 of 6 — two things to pick up."
- `R-DRL-4` — The drill timer is a local countdown, not an alarm. It does not schedule a notification and makes no sound.
- `R-DRL-5` — Drill results are stored in the plan document and are part of the F06 export (as a separate, opt-in section).
- `R-DRL-6` — A drill step never asks for a location, and a drill never requests any permission.

#### Offline and privacy

Fully offline. No permissions, no network.

#### Acceptance criteria

- [ ] `R-DRL-7` — Answering every step produces a score, a "not yet" list, and a debrief; answering "not yet" on a step with a `taskLink` offers to add that task, and declining adds nothing.
- [ ] `R-DRL-8` — Adding a suggested task adds it to the household checklist and it appears in the Home progress count.
- [ ] `R-DRL-9` — The drill record text contains the date, the drill name, the score, and the "not yet" items, and contains nothing else from the plan.
- [ ] `R-DRL-10` — The last drill is shown on Home; when the last drill is older than 60 days a gentle prompt appears, and it disappears once a new drill is recorded.
- [ ] `R-DRL-11` — A drill can be completed in airplane mode with no permission prompt of any kind.
- [ ] `R-DRL-12` — Unit tests cover scoring with skipped steps, the "not yet" → suggested task mapping, and the 60-day due check.
- [ ] `R-DRL-13` — Device check: run the evacuation drill at 130 % font scale and reduced motion on a small phone; every step must be readable and tappable without scrolling sideways.

#### Dependencies

`src/plan-schema.ts` (`Task`), `src/plan.tsx` (task add path), `src/ui.tsx` (the step card is a new composed component using `Card`, `Action`, `Body`).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The app is perceived as an official training program | Low | High | Copy and disclaimers; the drill is explicitly a practice aid, reviewed by WS-D |
| Drills become a chore | Medium | Medium | One-tap start, 3–10 minutes, gentle 60-day prompt rather than a streak |
| Content quality is uneven across five scenarios | Medium | Medium | All five scenarios are content-reviewed together in one WS-D batch before release |

#### Out of scope

Video instructions, push-based drills, certification, scoring other people.

---

### 4.9 F09 — Readiness Score & Seasonal Dashboard

**Theme:** Craft & reach · **Priority:** P1 · **Effort:** 3 d

#### Problem

v1.1's Home shows one number: checklist steps completed. That is a good "have I started" signal and a poor "am I ready" signal. It cannot distinguish "I ticked everything in March and my water is now stale" from "I ticked everything last week". It also cannot tell a user that hurricane season starts in June and their kit has not been reviewed since January.

#### What it does

A **Readiness Score** — a plain-language, composite, per-profile summary with an explicit breakdown, never a single opaque number.

**Inputs (all local, all already in the app):**

| Input | Source | Weight rationale |
|---|---|---|
| Checklist completion | `PlanState.tasks` | The baseline behaviour already tracked |
| Kit coverage (water/food) | F01 inventory | Possession, not intention |
| Expiring / expired items | F01 inventory | Time-sensitive decay |
| Zone recorded and fresh | `src/zone/verification.ts` | A plan without a zone has a hole in it |
| Go-bags packed | F02 | Per-person readiness |
| Out-of-area contact and meeting point | F04 | Communication readiness |
| Medical plan present (if the household needs one) | F03 | Highest-consequence gap |
| Drill recency | F08 | Rehearsal, not paperwork |
| Kit review recency (inventory `lastRotationAt`) | F01 | Seasonal decay |

**Output:** a 0–100 score shown as a **band**, never a raw number in isolation:

| Band | Label | Copy |
|---|---|---|
| 85–100 | **Ready** | "Your plan is complete and current. Keep it fresh." |
| 55–84 | **Almost there** | "A few things would make this plan dependable." |
| 30–54 | **Needs attention** | "Your plan has gaps. Start with the item below." |
| 0–29 | **Just getting started** | "Pick one step this week. It adds up fast." |

Each band lists **the three highest-impact gaps** with one-tap fixes ("Add an out-of-area contact →", "Rotate your water →"). The score never drops the user into a shame spiral: it is framed as "what to do next", and a low score is presented as a starting point.

**Seasonal readiness.** A small, deterministic season model determines the current preparedness season for a profile's country and region:

| Region | Seasons |
|---|---|
| Atlantic / Gulf US states (FL, TX, LA, MS, AL, GA, SC, NC) | Hurricane season: **June 1 – November 30** |
| Western states (CA, WA, OR, NV, AZ, UT, CO, NM) | Wildfire season: **April – October** |
| Northern tier (all US states above 39.5° latitude) | Winter storm season: **November – March** |
| Mexico coastal and national | Hurricane season: **June 1 – November 30**, with **tropical storm** risk May–November |

When a profile is inside a season window, the app shows a **"Season check"** card: "Hurricane season started on 1 June. Have you rotated your kit since then?" with a link to the rotation action (F01) and the latest kit review date. The season model is a static, content-reviewed table — no network lookup, and the copy says the dates are general guidance, and the local authority decides.

The dashboard lives as a **card on Home** and as a full **"Readiness" screen** with the complete breakdown, so a curious user can see exactly how the score was computed. Nothing is hidden.

#### User flow

1. **Home** gains a Readiness card under the checklist card: the band label ("Almost there"), a progress ring, and the count of expiring items.
2. Tapping the card opens the **Readiness** screen, which lists every factor as a row: label, a short reason ("You have 12 of 28 gallons"), and a one-tap action where a fix exists ("Rotate your water →").
3. The top of the Readiness screen shows the three **highest-impact gaps**, each a button that navigates to the fix. This is the screen's job — the user should always know the next best action.
4. During a preparedness season, a **"Season check"** card appears at the top of Home: "Hurricane season started on 1 June. Your kit was last reviewed on 3 January." with a "Review my kit" action and a link to the local authority.
5. The card is dismissible for the current season, and it returns only when the season window opens again or the kit is reviewed.

#### Data model

No new stored state — the score is derived. Pure module `src/readiness/score.ts`:

```ts
export type ReadinessFactor = {
  id: string;
  label: string;
  earned: number;      // 0..1
  weight: number;
  reason: string;      // "You have 12 of 28 gallons"
  action?: { label: string; route: string };
};

export type ReadinessScore = {
  total: number;            // 0..100
  band: 'ready' | 'almost' | 'attention' | 'starting';
  factors: ReadinessFactor[];
  topGaps: ReadinessFactor[];
};
```

Pure module `src/readiness/season.ts`: `currentSeason(country, region, now)`, `seasonCheck(country, region, now, lastReviewAt)`.

**Rules:**

- `R-RDY-1` — The score is **derived, never stored**. A change in any input immediately changes the score.
- `R-RDY-2` — The score is per profile (F07). The active profile's score is what Home shows.
- `R-RDY-3` — The breakdown is always available. A user is never shown a number without the ability to see its factors.
- `R-RDY-4` — The band thresholds are constants in one file, unit-tested, and change only with a version bump of the scoring model.
- `R-RDY-5` — The season model is a static table of general guidance. The copy states that local authorities determine actual conditions and dates, and the card always links to the local source.
- `R-RDY-6` — The score is not gamified: there are no points, levels, badges, or leaderboards, and no streak that can be "lost" by a missed week.
- `R-RDY-7` — The score never appears in a share or export by default; it is included in the F06 export only as a derived number when the user enables the "readiness" section.

#### Offline and privacy

Fully offline. No network, no stored telemetry.

#### Acceptance criteria

- [ ] `R-RDY-8` — A brand-new profile scores 0–29 and shows the "Just getting started" band with the three highest-impact gaps.
- [ ] `R-RDY-9` — Completing the checklist, recording a zone, adding a contact, and packing a go-bag each move the score by the documented amount; the unit test asserts the exact weights.
- [ ] `R-RDY-10` — The breakdown screen lists every factor with its reason, and the reasons match the current state (e.g. "You have 12 of 28 gallons").
- [ ] `R-RDY-11` — A profile in Florida on 2 June shows the "Hurricane season" check card; the same profile in Minnesota on 2 June does not.
- [ ] `R-RDY-12` — Rotating the water (`lastRotationAt` = today) clears the "season check" prompt and updates the review-recency factor.
- [ ] `R-RDY-13` — No streak, points, or level is present anywhere in the feature; a UI review confirms it.
- [ ] `R-RDY-14` — Unit tests cover band boundaries (29/30, 54/55, 84/85), factor weights, and the season model for each region and both hemispheric edges.

#### Dependencies

F01 (inventory), F02 (go-bags), F03 (medical), F04 (communication), F08 (drills), `src/zone/verification.ts`.

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A score is read as a judgement of the person | Medium | High | Bands are phrased as states of the plan, not of the user; copy review by WS-D; the "just getting started" band is explicitly welcoming |
| The weights feel arbitrary | High | Medium | The breakdown shows the reason and the factor weights; the weights are documented in the code and reviewed in the plan |
| The score becomes the only thing users look at | Medium | Medium | Home keeps the checklist progress card as the primary element; the score is a secondary card |

#### Out of scope

Comparative scoring between users, gamification, external benchmarks, points or levels.

---

### 4.10 F10 — Spanish (es-MX) Localization

**Theme:** Craft & reach · **Priority:** P1 · **Effort:** 7 d

#### Problem

The app ships to Mexico with an English interface and US-centric sources. The README names Mexico as a first-class country, and the "Dev (Monterrey, MX)" persona is a primary target — but every string, every source link, and every date format is English-only. This is the single clearest gap between what the product claims and what it delivers.

#### What it does

Full **Spanish (es-MX)** localization of the interface and of the *content that is specific to Mexico*.

**Interface.** All user-facing strings move into translation resources. The app offers a language choice in Settings — **System default**, **English**, **Español** — and stores the choice locally.

**Content, not just chrome.** This is the part that matters and the part that is often skipped:

- The **kit catalog** gets Mexican sources: Protección Civil, SMN (Servicio Meteorológico Nacional), and CENAPRED, alongside the existing Ready.gov sources. Each kit line shows the source for the user's country.
- The **zone source list** shows Mexican authorities (Coordinación Nacional de Protección Civil, CENAPRED's *Atlas Nacional de Riesgos*) when the profile's country is Mexico.
- The **Mexico alert guidance** already exists on the Updates screen; it is translated and linked to the correct state-level civil protection offices.
- The **season model** (F09) already has a Mexico entry; the copy is localized.
- Emergency numbers: **911** is used in both countries, but the app explains **how 911 works in Mexico** (it routes to the nearest state civil protection and the 066 line is Urban Assistance in Mexico City) — localized, factual, and content-reviewed.

**Implementation.** Rather than a heavy i18n framework, v1.2 uses a small, dependency-light approach: a `src/i18n/` module with typed string tables per locale, a `useT()` hook, and a `LocaleProvider` at the root layout. This keeps the translation keys type-checked (a missing key is a compile error, not a runtime blank) and keeps the bundle small.

#### User flow

1. **Settings → Language** shows three options: *System default*, *English*, *Español*, with the current choice marked.
2. Choosing a language applies **immediately** — no restart, no reload prompt — and the change is remembered across launches.
3. A **first-run prompt** appears during onboarding if the system locale is Spanish: "¿Prefieres usar StormReady en español?" with a one-tap choice, so a Mexican user never has to find the setting.
4. The **kit screen** shows the source appropriate to the profile's country. Because the profile's country is set during onboarding (or in the Plan screen), a new Spanish user in Monterrey sees Protección Civil sources rather than Ready.gov.
5. Every shared or exported text (kit, communication card, medical card, drill record, plan export) is produced in the active locale.

#### Data model

No new stored state beyond the locale preference. The string tables are static data:

```ts
// src/i18n/en.ts
export const en = {
  'home.title': 'Ready starts with one small step.',
  'kit.title': 'Emergency kit',
  'kit.coverage.short': '{owned} of {required} gallons',
  // ...
} as const;

export type TranslationKey = keyof typeof en;

// src/i18n/es.ts — the same key set, in Spanish
export const es: Record<TranslationKey, string> = {
  'home.title': 'La preparación empieza con un paso pequeño.',
  'kit.title': 'Kit de emergencia',
  'kit.coverage.short': '{owned} de {required} galones',
  // ...
};
```

- The English table is the **source of truth** for the key set; `TranslationKey` is derived from it, so the Spanish table is type-checked against it and a missing key is a **compile error**.
- Interpolation uses named `{placeholders}` replaced at lookup time, so a translation can reorder the placeholders freely (Spanish word order differs from English).
- The locale preference is stored in the existing theme/preference document as `locale: 'system' | 'en' | 'es'`, alongside the dark-mode flag.

#### Offline and privacy

Fully offline — the string tables are bundled, not fetched. No new network call, no new storage key, no new permission. The locale choice is stored in the existing theme/preference document.

**Rules:**

- `R-L10-1` — Every user-facing string is in a translation table. No inline English literals remain in `src/app/**` or in `src/ui.tsx`.
- `R-L10-2` — A missing translation key falls back to English and is **reported by a unit test** that compares the key sets of both tables, so the CI fails if a key is added to one table and not the other.
- `R-L10-3` — The locale choice is stored in the existing theme/preference document and defaults to the system locale.
- `R-L10-4` — Dates, times, and numbers use the active locale's formatting (`Intl` with an explicit locale, not the device default), so a Spanish user sees "3 de marzo de 2026".
- `R-L10-5` — All Mexico-specific preparedness content is reviewed by WS-D against the actual authority pages before release.
- `R-L10-6` — Kit quantities are locale-neutral (units stay in the familiar US/metric form the user expects); only the surrounding copy is translated.
- `R-L10-7` — The app never auto-translates a live alert; the NWS alert text for Mexico is not automated, and the guidance is translated copy, not machine translation.

#### Acceptance criteria

- [ ] `R-L10-8` — Switching the language to Español translates every screen, including the kit, onboarding, drills, and the export text.
- [ ] `R-L10-9` — The key-set parity unit test fails when a key is added to the English table and not the Spanish table — demonstrated in CI.
- [ ] `R-L10-10` — A profile with country Mexico shows Protección Civil and CENAPRED as kit and zone sources, and a US profile shows Ready.gov and FEMA.
- [ ] `R-L10-11` — Dates render as "3 de marzo de 2026" in Spanish and "March 3, 2026" in English.
- [ ] `R-L10-12` — The exported plan text is in the active locale.
- [ ] `R-L10-13` — Content review sign-off is recorded for the Mexico kit sources, the 911 explanation, and the zone source list before the feature merges.

#### Dependencies

Every screen touched by the string extraction, `src/kit/catalog.ts` (per-country sources), `src/zone/verification.ts` (per-country source lists), WS-D content review.

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Half-translated UI ships | Medium | High | Key parity test in CI; a "missing translation" fallback badge is shown in debug builds only |
| Mexican content is inaccurate | Medium | High | Every Mexico-specific claim is content-reviewed against the authority page; the app states the local authority decides |
| The string extraction is a large, noisy diff | High | Medium | Done as one mechanical PR with a reviewer focused on layout regressions, followed by content PRs |
| The 911 explanation is wrong for some regions | Medium | High | WS-D verifies per state; the copy is deliberately generic ("911 connects you to emergency services in both countries; in Mexico, state civil protection coordinates the response") |

#### Out of scope

Portuguese, French, English dialect variants, RTL, machine translation of user content, localized map tiles.

---

### 4.11 F11 — Home-Screen Readiness Widget

**Theme:** Craft & reach · **Priority:** P2 · **Effort:** 5 d

#### Problem

Preparedness fails at the moment of forgetting. The app's value is a weekly glance, but a glance requires opening the app — and a person who has not opened the app this month cannot be reminded by the app. A home-screen widget is the cheapest possible surface for "here is where you stand".

#### What it does

A small **readiness widget** that renders on the Android home screen (and, if the effort allows, on iOS via the same SDK where supported):

- **Small size (2×2):** the readiness band as a word ("Ready" / "Almost there" / "Needs attention"), a coloured ring showing the score, and the number of items expiring or expired. Tapping opens the Readiness screen.
- **Medium size (4×2):** the same, plus the zone label with its provenance ("Zone A · entered by you · 32 days ago") and the next check-in ("Next check-in: Mon 3 pm"), plus the last drill date.
- **Tap targets:** tapping the zone opens the Plan screen's zone card; tapping the expiry count opens the Kit's "Replace now" list; tapping the score opens Readiness.

**Constraints and honesty requirements:**

- The widget is **read-only**. It displays state already on the device and never fetches.
- Because the widget is rendered by the OS, it reads the same stored document as the app. A **shared** data layer is required so the widget and the app cannot disagree — this is the main engineering work, not the widget itself.
- The widget shows a **staleness hint** if the underlying data is more than 14 days old ("Plan not updated for 20 days"), so a frozen widget cannot look falsely current.
- The widget **never renders a "safe" or "all clear" claim** — only the readiness band and factual counts.
- If the OS kills the widget process, the next render reads the same file; the widget cannot show stale-but-confident data because of the staleness hint.

#### Implementation notes

- Requires a **native module / config plugin**, so it needs a development build and cannot ship by OTA. It is sequenced accordingly and bumps `runtimeVersion`.
- The plugin is written in the repo (not a third-party widget library) so the data bridge, the render, and the theme palette stay under the project's control.
- The widget reuses the theme tokens from `src/theme.ts`; the palette is exported to the native side as a shared resource so light and dark both work.

#### User flow

1. The user adds the widget from the Android launcher (long-press home → Widgets → StormReady), choosing the small or medium size.
2. The widget renders the readiness band, the score ring, and the expiry count. Tapping the score opens the Readiness screen; tapping the expiry count opens the Kit's "Replace now" list.
3. The user can change what the medium widget shows (zone, check-in, last drill) in **Settings → Widget**, and the change takes effect on the next widget refresh.
4. Settings also explains, in one short paragraph, exactly what the widget shows and that it is read-only.

#### Data model

The widget has **no data model of its own** — it renders a projection of the existing plan document. The shared contract between the app and the native side is a single, small, versioned JSON file that the app writes on every plan change:

```ts
// Written by the app after every plan mutation; read by the native widget.
export type WidgetPayload = {
  version: 1;
  band: 'ready' | 'almost' | 'attention' | 'starting';
  score: number;                    // 0..100
  expiringCount: number;
  expiredCount: number;
  zoneLabel: string;                // e.g. "Zone A"
  zoneProvenance: string;           // e.g. "Entered by you · 32 days ago"
  nextCheckIn: string | null;       // free text, e.g. "Mon 3 pm"
  lastDrillAt: string | null;
  planUpdatedAt: string;            // drives the 14-day staleness hint
};
```

**Rules:**

- `R-WDG-0` — The widget payload is a **projection**, never a second source of truth. The app is the only writer; the widget only reads. If the payload is missing or its `version` is unknown, the widget shows the neutral "Open StormReady" state.
- `R-WDG-0b` — The payload contains no location, no medical detail, no contact name, and no kit quantity. Only the fields listed above are ever written.

#### Offline and privacy

Fully offline and read-only. The widget reads the same on-device document the app reads and performs no network request. It shows no more than the app shows, and it never displays a location, a medical detail, or a contact name.

#### Rules:**

- `R-WDG-1` — The widget renders only local state. It performs no network request and requires no permission.
- `R-WDG-2` — The widget and the app read the same document through one shared accessor; a unit test asserts both compute the same band for the same input.
- `R-WDG-3` — The widget shows the "not updated for N days" hint when the plan document's `updatedAt` is older than 14 days.
- `R-WDG-4` — The widget never displays an evacuation order, a shelter status, or any statement that the user is safe.
- `R-WDG-5` — The widget is opt-in: the user adds it from the launcher, and the app's Settings screen explains what it shows.
- `R-WDG-6` — A widget that fails to load shows a neutral "Open StormReady" state with no score, rather than a stale score.

#### Acceptance criteria

- [ ] `R-WDG-7` — The widget shows the same band as the app's Readiness card for the same data (verified by a screenshot comparison on a device).
- [ ] `R-WDG-8` — The widget renders with no network connection and no permission granted.
- [ ] `R-WDG-9` — A plan document older than 14 days produces the staleness hint on the widget.
- [ ] `R-WDG-10` — Tapping each widget region opens the intended screen.
- [ ] `R-WDG-11` — The light and dark palettes both render legibly (screenshot check).
- [ ] `R-WDG-12` — `runtimeVersion` is bumped and the change ships as a new build, not an OTA update.

#### Dependencies

`src/readiness/score.ts` (F09), `src/theme.ts`, a new config plugin in `app.json`, EAS build changes.

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Native plugin work destabilizes the build | Medium | High | Plugin lives in its own PR, ships behind a separate build, and the app works normally without the widget |
| The widget cannot ship by OTA and lags the release | High | Medium | Sequenced in P2; the release notes say the widget arrives in the next build |
| Stale widget data reads as reassuring | Medium | High | `R-WDG-3` staleness hint; `R-WDG-4` forbids "all clear" copy |

#### Out of scope

Interactive widgets, live alert badges, home-screen actions, watch faces.

---

### 4.12 F12 — Zone Provider Registry & "Wipe My Data"

**Theme:** Craft & reach · **Priority:** P0 · **Effort:** 4 d

Two small but important features that belong together because they both concern **where the app's facts come from** and **the user's control over them**.

#### Problem

Two distinct problems share one fix. First, v1.1 hard-codes its zone sources in two separate places — the Florida lookup in `src/zone.ts` and a static link list in `src/zone/verification.ts` — so every new source is a fork rather than a plug-in, and the sources shown to a user can drift from the sources that actually work. Second, the app now stores genuinely sensitive material (medication lists, phone numbers, family locations), and there is **no way for a user to see what is stored, lock it, or erase it**.

#### What it does

- **F12a — a zone provider registry** (below): one plug-in point for automated and manual zone verification, with the user-facing source list generated from it.
- **F12b — a privacy explainer, a full wipe, and a device-local app lock** (below): the user can read exactly what the app stores, lock it behind a PIN, or erase all of it in one irreversible action.

#### User flow

Covered in each half below. In short: the user never sees the registry, only better source labels; and in Settings they find a Privacy screen that explains what is stored, offers a lock, and offers a wipe.

#### Data model

The registry is static data (below). The privacy screen's content list is **derived from `src/storage/keys.ts`**, so the two cannot drift:

```ts
// src/storage/keys.ts — each key gains a privacy descriptor
export type KeySpec<T> = {
  key: string;
  version: number;
  defaultValue: T;
  legacyKey?: string;
  parseLegacy?: (raw: string) => unknown;
  migrateLegacy?: (value: unknown) => T;
  migrate?: (value: unknown, fromVersion: number) => T;
  privacy: {                  // NEW in v1.2 — drives the privacy screen
    title: string;            // "Your emergency kit"
    description: string;      // "What you own, when you bought it, and when it expires."
    sensitive?: boolean;      // true for medical, contacts, location
  };
};
```

- `R-WIP-0` — Every key in `keys.ts` declares a `privacy` descriptor. A unit test fails if any key lacks one, so the privacy screen can never under-report what is stored.
- The wipe enumerates `keys.ts` and the file-system area directory; there is no hard-coded list of things to delete.

#### Offline and privacy

Both features are local-only. F12a adds no new network call beyond the existing Florida lookup. F12b stores the PIN in the OS keystore via `expo-secure-store` and never transmits it; the wipe removes data rather than uploading it.

#### 4.12.1 F12a — Zone provider registry

**Problem.** v1.1 hard-codes the Florida lookup in `src/zone.ts` and a static list of "official zone sources" in `src/zone/verification.ts`. Adding a second automated state means editing screens. There is no registry, so every new source is a fork rather than a plug-in.

**What it does.** A **zone provider registry**: a pure module that maps a country/region to an ordered list of providers, each provider declaring:

```ts
export type ZoneProvider = {
  id: string;                    // 'florida-dem'
  country: 'US' | 'MX';
  regions: string[];             // ['fl']
  label: string;                 // "Florida Know Your Zone (DEM)"
  authority: string;             // "Florida Division of Emergency Management"
  authorityUrl: string;
  confidence: 'authoritative' | 'community' | 'manual-only';
  lookup?: (point: { latitude: number; longitude: number }) => Promise<ZoneLookupResult>;
};
```

v1.2 ships the registry with the existing Florida provider and every other region marked `manual-only`, and it establishes the extension point so that adding a state in v1.3 is a data change plus one lookup function, not a screen rewrite. The **"where to verify"** list becomes generated from the registry, so the sources shown always match the providers that actually exist.

**User flow.** The user is not aware of the registry. What they see changes in one way: wherever v1.1 said "Enter it yourself" or listed a generic FEMA directory, v1.2 names the specific authority for their county and states the method ("Official state lookup", "Community-mapped — verify locally", "Enter it yourself"). The Zone sheet and the manual-entry screen both draw their source list from the registry.

**Offline and privacy.** The registry is local data. Only the Florida provider performs a network lookup, and that behaviour is unchanged from v1.1. No new data leaves the device.

**Rules:**

- `R-ZPR-1` — The zone source list shown to users is **generated from the registry**. There is no second hand-maintained list.
- `R-ZPR-2` — Every provider declares a `confidence` label that is displayed to the user ("Official state lookup", "Community-mapped — verify locally", "Enter it yourself").
- `R-ZPR-3` — A provider with no `lookup` is presented as a manual entry with the authority's page linked, never as an empty automated result.
- `R-ZPR-4` — The registry is pure data plus functions and is fully unit-testable without a network.
- `R-ZPR-5` — A provider lookup failure degrades to manual entry with a plain explanation; it never shows an error wall.

#### 4.12.2 F12b — Wipe my data (and a privacy explainer)

**Problem.** The app stores health information, addresses, family contacts, and a location history in the alert snapshot — on a device that may be shared, sold, or lost. There is currently no way to erase it, and no plain-language explanation of what is stored.

**What it does.**

- A **Privacy screen** in Settings: a plain-language list of exactly what is stored on the device (plan, checklist, zone, contacts, medical plan, inventory, go-bags, drill results, saved map area, last alert check), where it lives, and that **nothing is transmitted** — with links to the app's terms and to the two authorities the app cites.
- A **"Delete all my data"** action: a two-step confirmation (a warning listing what will be removed, then a typed confirmation), which resets every stored key to its default, removes the saved map files from the file system, cancels scheduled reminders, and returns the app to the first-run onboarding. It is a single, complete, irreversible reset — and it is stated to be irreversible.
- An **automatic inactivity option**: nothing is deleted automatically (that would destroy a plan a user still needs). Instead the privacy screen can **lock the app behind a device-local PIN** using `expo-secure-store`, so a shared device does not expose the medical plan. This is a small, high-value addition for the "Rita" persona.

**User flow.**

1. **Settings → Privacy** opens a screen that opens with the plain statement: "Everything StormReady knows stays on this phone. There is no account and nothing is uploaded." Below it, a generated list of exactly what is stored.
2. **"Lock the app"** asks the user to set a 4-digit PIN, stored in the device's secure hardware. The copy states: "This PIN is stored only on this phone. It is not an account, and it cannot be recovered if forgotten."
3. Once enabled, the app asks for the PIN on launch and after 5 minutes in the background, with a "forgot PIN" path that explains the only remedy is uninstalling the app (which deletes the data).
4. **"Delete all my data"** is at the bottom of the screen in a warning style. Tapping it opens a confirmation listing every category that will be removed, with a "Delete everything" button, and then a final typed confirmation ("Type DELETE to confirm"). On completion, the app wipes the store, deletes the saved area files, cancels reminders, and returns to onboarding.

**Offline and privacy.** Both features are local-only. The PIN is stored in the OS keystore via `expo-secure-store` and is never transmitted, logged, or recoverable. The wipe removes data rather than transmitting it.

**Rules:**

- `R-WIP-1` — "Delete all my data" removes every key known to `keys.ts` and every file written by the area pack, and cancels all scheduled notifications. A unit test asserts that no key survives.
- `R-WIP-2` — The reset returns the app to the onboarding screen with the default plan.
- `R-WIP-3` — The app-local PIN is stored in `expo-secure-store` (hardware-backed where available) and never leaves the device. The PIN is optional, and the app states that it is device-local, not a cloud account, and not recoverable if forgotten.
- `R-WIP-4` — The privacy screen lists every stored item by name, and the list is generated from `keys.ts` so it cannot drift from reality. A unit test asserts that every key in `keys.ts` appears in the privacy list.
- `R-WIP-5` — The wipe action is never triggered by a background job, a reminder, or an update.

#### Acceptance criteria

- [ ] `R-ZPR-6` — The "where to verify" list is generated from the registry; a unit test asserts that every provider in the registry appears in the list and that the list contains no entries outside the registry.
- [ ] `R-ZPR-7` — A Florida coordinate still resolves through the Florida provider, and a non-Florida coordinate still offers manual entry with the authority link.
- [ ] `R-ZPR-8` — A failed provider lookup offers manual entry with an explanation instead of an error.
- [ ] `R-WIP-9` — After "Delete all my data", the storage layer reports no user documents, the scheduled reminders are cancelled, the saved area files are gone, and the app is back at onboarding.
- [ ] `R-WIP-10` — The privacy screen lists every key in `keys.ts`; the unit test fails if a new key is added without a privacy entry.
- [ ] `R-WIP-11` — With the app lock enabled, the app requires the PIN on launch and after 5 minutes in the background.
- [ ] `R-WIP-12` — Device check: enable the PIN, kill the app, relaunch, confirm the lock; then wipe and confirm a clean install state.

#### Dependencies

`src/zone.ts`, `src/zone/verification.ts`, `src/storage/keys.ts`, `src/storage/store.ts`, `expo-secure-store` (new), `expo-file-system` (already a dependency).

#### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A wipe that misses a key leaves data behind | Low | Critical | The wipe enumerates `keys.ts`; a unit test asserts the store is empty afterwards; a "privacy list covers every key" test keeps the two in step |
| Users misread the app lock as an account | Medium | Medium | Copy says "device-local PIN, not an account, cannot be recovered if forgotten" |
| The registry becomes an abstraction with one implementation | Medium | Low | It ships with a real second case: `manual-only` regions are providers too, and the Florida lookup keeps its behaviour |

#### Out of scope

Remote wipe, cloud backup, per-section deletion, forensic recovery.

---

## 5. Prioritization and release cut lines

### 5.1 Scoring

Each feature is scored on four criteria. The weights reflect the product's stated bet: **possession and people first, craft second.**

| Criterion | Weight | Question |
|---|---|---|
| **Value** (1–5) | 35 % | How much does this close a real gap for a household? |
| **Confidence** (1–5) | 20 % | How sure are we that the design works? |
| **Effort** (1–5, inverted) | 15 % | How cheap is it relative to the others? |
| **Risk** (1–5, inverted) | 15 % | How likely is it to hurt users or the release? |
| **Reach** (1–5) | 15 % | How many of the personas does it serve? |

Weighted score = Σ (raw × weight). Scores are rounded to one decimal.

| Rank | ID | Feature | Value | Conf. | Effort | Risk | Reach | Score | Band |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **F01** | Kit Inventory & Expiry Tracker | 5 | 5 | 4 | 4 | 5 | **4.7** | P0 |
| 2 | **F04** | Family Communication & Meeting Plan | 5 | 4 | 5 | 5 | 5 | **4.6** | P0 |
| 3 | **F12** | Zone Provider Registry + Wipe My Data | 4 | 5 | 5 | 5 | 4 | **4.5** | P0 |
| 4 | **F02** | Go-Bag Builder | 5 | 4 | 4 | 4 | 4 | **4.3** | P0 |
| 5 | **F09** | Readiness Score & Seasonal Dashboard | 4 | 4 | 5 | 3 | 5 | **4.2** | P1 |
| 6 | **F08** | Scenario Drills | 4 | 4 | 5 | 4 | 3 | **4.1** | P1 |
| 7 | **F05** | Travel Mode | 3 | 4 | 5 | 5 | 3 | **3.9** | P2 |
| 8 | **F03** | Medication & Medical Needs Plan | 5 | 3 | 3 | 3 | 3 | **3.8** | P1 |
| 9 | **F10** | Spanish (es-MX) Localization | 5 | 3 | 3 | 3 | 3 | **3.7** | P1 |
| 10 | **F06** | Household Transfer | 4 | 3 | 3 | 3 | 4 | **3.4** | P1 |
| 11 | **F11** | Home-Screen Readiness Widget | 3 | 3 | 3 | 2 | 4 | **2.9** | P2 |
| 12 | **F07** | Multi-Household Profiles | 4 | 2 | 2 | 2 | 3 | **2.8** | P2 |

The ranking is not the same as the build order. F12 scores near the top because it is cheap, safe, and includes the privacy screen that the medical plan (F03) makes necessary. F07 scores low on confidence and risk because it reshapes the plan provider — it is a *sequencing* decision, not a value judgment.

### 5.2 Priority bands

| Band | Meaning | Features |
|---|---|---|
| **P0 — Must** | The release is not v1.2 without these. They carry the "possession + people" thesis. | F01, F02, F04, F12 |
| **P1 — Should** | Strong value; ship if the milestone budget allows. F03 and F10 are *paired* (a medical plan needs the privacy story; the Mexico persona needs the language). | F03, F06, F08, F09, F10 |
| **P2 — Could** | Real value, but they either reshape the app's data model (F07), need a native build (F11), or are situational (F05). | F05, F07, F11 |

### 5.3 Cut lines (in order, if the release is at risk)

1. **F11 Home-Screen Widget** — requires a native build and a `runtimeVersion` bump; it can never ship by OTA. Cut first.
2. **F07 Multi-Household Profiles** — the largest architectural change with the highest regression risk; it is a better v1.3 than a rushed v1.2.
3. **F05 Travel Mode** — situational; the value is real but the frequency is low.
4. **F06 Household Transfer** — nice-to-have once the data model is richer; the text share sheet of v1.1 still covers the basic case.
5. **F08 Scenario Drills** — the most content-heavy of the P1s; cut if the content review cannot keep pace, but never cut one drill and ship a half-finished set.
6. **F03 + F10** — cut as a **pair**. Shipping a Spanish UI without Mexico sources, or a medical plan without the privacy screen, is worse than shipping neither.

**Never cut:** F01, F02, F04, F09. They are the thesis of the release.

### 5.4 Scope discipline rules

- A feature ships **complete or not at all**. No "beta" flags inside the app, no half-wired states, no TODOs in user-facing copy.
- A new feature may be **added to** v1.1 behaviour, never **substituted** for it. The kit list, the zone, the checklist, and the offline map all still work exactly as they did.
- Any new package dependency requires a written justification in the PR and an `expo-doctor` clean run.
- Any new user-facing string requires WS-D review, batched twice weekly, as in v1.1.

---

## 6. Phased roadmap

Four phases, each with a clear exit criterion. The sequencing is driven by dependency, not by score.

```
                    ┌──────────────────────────────────────────┐
   P0 Phase A       │  F01 Inventory   F04 Communication        │   4 weeks
   "Possession &    │  F12a Zone registry  F12b Privacy+Wipe     │
    People"         └───────────────────┬──────────────────────┘
                                        │ (F01 → F02 kits share the item model)
                    ┌───────────────────▼──────────────────────┐
   P1 Phase B       │  F02 Go-bags   F08 Drills   F09 Readiness  │   5 weeks
   "Practice &      └───────────────────┬──────────────────────┘
    See"                             │
                    ┌───────────────────▼──────────────────────┐
   P1 Phase C       │  F03 Medical  F10 Spanish  F06 Transfer    │   5 weeks
   "Depth & Reach"  └───────────────────┬──────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────┐
   P2 Phase D       │  F05 Travel   F07 Profiles  F11 Widget     │   6 weeks
   "Scale & Surface"└──────────────────────────────────────────┘
```

### Phase A — Possession & People (P0, ~4 weeks)

**Goal:** the household can say what it has, who calls whom, and where the app's facts come from.

| Item | Days | Notes |
|---|---|---|
| F01 inventory model + kit UI | 5 | `src/inventory/*`, kit screen inventory section, coverage card |
| F04 communication plan | 4 | `src/comms/*`, Plan screen card, People strip on Home |
| F12a zone provider registry | 1 | `src/zone/registry.ts`, generated source list |
| F12b privacy screen + wipe | 3 | `src/storage/wipe.ts`, `expo-secure-store`, Settings screen |
| Schema v3 groundwork (inventory, comms, go-bags, medical, drills fields) | 3 | One migration, all fields default-empty |
| Home screen updates, copy, accessibility, i18n hooks | 3 | |
| Tests, CI, device QA | 3 | |

**Exit criteria:** a user can record inventory for 3 kit lines and see water coverage; a user can record an out-of-area contact and share a communication card; the privacy screen lists every stored key; "Delete all my data" returns the app to onboarding with an empty store — all offline, all covered by unit tests.

**Risks in this phase:** the schema v3 migration is the highest-risk change in the whole release, so it lands **first**, alone, with a fixture-based unit test before any feature depends on it.

### Phase B — Practice & See (P1, ~5 weeks)

**Goal:** the plan becomes something a household rehearses and can see at a glance.

| Item | Days | Notes |
|---|---|---|
| F02 go-bags | 5 | `src/gobag/*`, templates, share text |
| F08 scenario drills (5 scenarios) | 4 | `src/scenarios/*`; content review is on the critical path |
| F09 readiness score + seasonal dashboard | 3 | `src/readiness/*`, Home card, breakdown screen |

**Exit criteria:** a user can create a per-person go-bag whose quantities follow the household; a user can complete the evacuation drill offline in under ten minutes and get suggested tasks added to the checklist; the Home screen shows a readiness band with a full breakdown, and a Florida profile shows the hurricane-season check in June.

**Dependency note:** F09 reads F01, F02, F03, F04, and F08. F03 (Phase C) is therefore folded into the readiness calculation as "medical plan present" only when the plan is non-empty, and Phase C's medical work lands cleanly afterwards.

### Phase C — Depth & Reach (P1, ~5 weeks)

**Goal:** the app goes deep where the stakes are highest (medical) and broad where the audience is (Mexico).

| Item | Days | Notes |
|---|---|---|
| F03 medical plan + medical card export | 6 | `src/medical/*`, new kit category, 911/ICE content |
| F10 Spanish (es-MX) localization | 7 | `src/i18n/*`, string extraction, Mexico content (parallelizable with F03) |
| F06 household transfer (export/import) | 5 | `src/transfer/*`, `expo-document-picker`, merge logic |

**Exit criteria:** a user can build a two-medication plan, see the cooler and power lines appear in the kit with their own basis, and export a medical card containing exactly the selected fields; the entire UI works in Spanish with Mexico sources; a plan can be exported on one device and merged on another with a preview and no silent overwrites.

**Risk note:** F10's string extraction touches every screen. It is a separate, mechanical PR with a dedicated review pass for layout regressions, and it must not be bundled with F03's behavioural changes.

### Phase D — Scale & Surface (P2, ~6 weeks)

**Goal:** more households, more situations, and the app visible outside the app.

| Item | Days | Notes |
|---|---|---|
| F05 travel mode | 3 | `src/travel/*` |
| F07 multi-household profiles | 6 | Schema v4, provider reshape, per-profile area/alerts |
| F11 home-screen widget | 5 | Native config plugin, `runtimeVersion` bump, new build |

**Exit criteria:** two profiles coexist with separate zones, kits, and saved areas; a trip has its own kit; the widget shows the same band as the app and ships in a new build.

**Sequencing note:** F07 must land **before** F11, because the widget reads the active profile's data and needs a stable notion of "current plan". F11 is last because it needs a new build, and the release should not be waiting on a native change in its final week.

### 6.1 Milestones

| Milestone | Window | Contents | Exit criteria |
|---|---|---|---|
| **M-A** | Weeks 1–4 | Schema v3 + F01, F04, F12 | Phase A exit criteria; CI green; coverage floor met |
| **M-B** | Weeks 5–9 | F02, F08, F09 | Phase B exit criteria; 5 external testers complete a drill |
| **M-C** | Weeks 10–14 | F03, F10, F06 | Phase C exit criteria; WS-D sign-off on all new copy |
| **M-D** | Weeks 15–20 | F05, F07, F11 | Phase D exit criteria; full regression on a physical device |
| **GA** | Week 21 | Staged rollout | All release gates in §12.3 |

**Contingency:** 10 working days of buffer before GA. If a phase slips, cut in the §5.3 order. If Phase A slips by more than two weeks, F07 and F11 leave the release entirely rather than compressing Phases B and C.

---

## 7. Schema v3 migration design

One migration, at the start of Phase A, introducing every new field as empty. Later phases then add features without further migrations, which keeps the storage risk in exactly one place.

### 7.1 The v3 shape

```ts
// src/plan-schema.ts — schema v3

export type ProfileId = string;

export type Profile = {
  id: ProfileId;
  name: string;
  createdAt: string;
  accent: string;              // a token name from the theme palette
};

/** The per-profile payload — everything that was in the v2 PlanState. */
export type ProfilePlan = {
  household: Household;
  zone: VerifiedZone;
  destination: Destination;
  tasks: Task[];
  inventory: InventoryState;         // NEW — F01
  goBags: GoBagState;                // NEW — F02
  medical: MedicalPlan;              // NEW — F03
  communication: CommunicationPlan;  // NEW — F04
  travel: TravelState;               // NEW — F05
  drills: DrillState;                // NEW — F08
};

export type PlanState = {
  version: 3;
  activeProfileId: ProfileId;        // NEW — F07
  profiles: Record<ProfileId, ProfilePlan>;
  updatedAt: string;                 // NEW — the widget's staleness hint reads this
};
```

### 7.2 The migration

```ts
// src/storage/migrate.ts
export function migratePlanFromV2(value: unknown): PlanState;
```

Behaviour:

1. Read the v2 `PlanState` shape (`onboarded`, `household`, `zone`, `destination`, `tasks`).
2. Create a profile with id `'default'` and name `'Home'` (localized to `Casa` in Spanish).
3. Move the v2 payload into `profiles.default`, adding every new field with its documented empty default:
   - `inventory: { entries: {}, lastRotationAt: null }`
   - `goBags: { bags: [] }`
   - `medical: { medications: [], devices: [], contacts: [], allergies: '', notes: '' }`
   - `communication: { contacts: [], meetingPoint: { label:'', address:'', note:'' }, checkIn: { who:'', everyHours:24, method:'', fallback:'' }, backup: { contact:'', method:'', note:'' } }`
   - `travel: { trips: [] }`
   - `drills: { results: [] }`
4. Set `activeProfileId = 'default'`.
5. Set `updatedAt` to the migration time.

### 7.3 Migration rules

- `R-MIG-1` — The migration is a **pure function** of its input, with no clock, no storage, and no network. `updatedAt` is passed in as a parameter so the test is deterministic.
- `R-MIG-2` — The v2 document is preserved under the legacy key for one release, exactly as v1.1's v1 migration did. A failed migration therefore never destroys the previous plan.
- `R-MIG-3` — A v2 document with unexpected or missing fields migrates to a valid v3 document; every field is defensively read with a default. A v2 document that is not an object at all is rejected by the store and quarantined under `.corrupt`, as today.
- `R-MIG-4` — The **area pack** and **alert snapshot** keys also change (`stormready.area.v3`, `stormready.weather-alerts.v3`) to hold a per-profile map. Their v2 values migrate into the `'default'` profile. The v2 keys are retained as legacy keys for one release.
- `R-MIG-5` — The migration is covered by a unit test that starts from a **captured real v1.1 fixture** (not a hand-written toy) and asserts that every field of the original survives into `profiles.default`.
- `R-MIG-6` — The v3 plan document is written **before** the legacy key is cleared, and the store's newer-version guard prevents a downgrade from overwriting v3 data with a v2 write.

### 7.4 Storage key changes

| Key | v1.1 | v1.2 | Migration |
|---|---|---|---|
| Plan | `stormready.plan.v2` | `stormready.plan.v3` | `migratePlanFromV2` |
| Theme | `stormready.theme.v2` | `stormready.theme.v2` | unchanged (locale added as an optional field) |
| Alerts | `stormready.weather-alerts.v2` | `stormready.weather-alerts.v3` | per-profile map, v2 value into `'default'` |
| Area pack | `stormready.area.v3` | `stormready.area.v4` | per-profile map, v3 value into `'default'` |
| Destination | `stormready.map-destination.v2` | `stormready.map-destination.v3` | per-profile map |
| Notifications | `stormready.notifications.v1` | `stormready.notifications.v1` | unchanged; the rotation reminder adds a third identifier key |

Every new key is declared in `src/storage/keys.ts` with a `SCHEMA_VERSION` and a `DEFAULT`, per the existing rule R-STO-5. The privacy screen (F12b) is generated from this file, so the two cannot drift.

---

## 8. New module and route map

### 8.1 Modules

```
src/
  inventory/
    model.ts          # entries, coverage, expiring, expired  (pure)
    rotation.ts       # rotation dates and next rotation month (pure)
  gobag/
    model.ts          # bags, templates application, progress, text (pure)
    templates.ts      # template → item id lists (data)
  medical/
    model.ts          # medical plan → kit lines, card text, derivations (pure)
  comms/
    model.ts          # communication plan → card text, completion (pure)
  travel/
    model.ts          # trip household override, trip kit, trip text (pure)
  scenarios/
    drills.ts         # the five drill definitions (data)
    model.ts          # scoring, suggested tasks, records (pure)
  readiness/
    score.ts          # factors, weights, bands (pure)
    season.ts         # seasonal model (data + pure functions)
  transfer/
    model.ts          # envelope build, import preview, merge (pure)
    file.ts           # expo-file-system read/write, document picker
  zone/
    registry.ts       # zone providers (data + pure functions)
    verification.ts   # (existing, refactored to use the registry)
  i18n/
    en.ts             # English string table
    es.ts             # Spanish string table
    index.tsx         # LocaleProvider, useT()
  storage/
    wipe.ts           # delete-all-data (pure-ish; enumerates keys)
```

**Domain-module rules (unchanged from v1.1):** domain modules never import from `src/app`; they are importable in a plain Node test environment; they are pure unless the module name says otherwise (`transfer/file.ts` and `storage/wipe.ts` are the only two that touch the platform, and both are thin wrappers over pure logic).

### 8.2 New routes

```
src/app/
  readiness.tsx            # readiness breakdown (F09)
  go-bags.tsx              # bag list (F02)
  go-bags/[id].tsx         # a single bag (F02)
  inventory.tsx            # full inventory + replace-now list (F01)
  medical.tsx              # medical plan (F03)
  communication.tsx        # communication plan (F04)
  travel.tsx               # trip list (F05)
  travel/[id].tsx          # a single trip (F05)
  drill.tsx                # drill runner (F08)
  drill/[id].tsx           # drill debrief (F08)
  settings/
    privacy.tsx            # privacy screen + wipe + app lock (F12b)
    transfer.tsx           # export / import (F06)
    language.tsx           # locale picker (F10)
```

**Route rules:** `src/app/**` contains routes only. Shared components for these screens (the bag editor, the medical card builder, the drill step card, the coverage meter) live in `src/components/` — a new directory introduced in v1.2, since `src/ui.tsx` holds only the design-system primitives and these are product components.

**No new bottom tab.** v1.1 has five tabs (Home, Prepare, Map, Updates, Settings). v1.2 adds features to the existing tabs and links from Home rather than growing the tab bar, because a seven-tab bar is worse on a small phone.

### 8.3 New dependencies

| Package | Used by | Install | Justification |
|---|---|---|---|
| `expo-document-picker` | F06 | `npx expo install expo-document-picker` | Required to open a `.stormready-plan` file from Files/Drive |
| `expo-secure-store` | F12b | `npx expo install expo-secure-store` | Hardware-backed storage for the device-local PIN |
| `expo-print` | *(v1.3, optional)* | — | Deferred; the F06 file export is enough for v1.2 |
| `expo-widgets` *(or a custom plugin)* | F11 | `npx expo install expo-widgets` | Home-screen widget; evaluated in Phase D, custom plugin preferred for palette control |

**No new dependency** is introduced for F01–F05, F07–F10, F12a. The i18n implementation is dependency-free by design (typed string tables, `Intl` for formatting).

---

## 9. Dependency, risk, and privacy review

### 9.1 Internal dependency graph

```
              SCHEMA v3 (Phase A, standalone PR)
                 │
    ┌────────────┼─────────────┬──────────────┐
    ▼            ▼             ▼              ▼
   F01        F04           F12a           F12b
  inventory   comms        registry      privacy+wipe
    │            │                          ▲
    │            │                          │
    ▼            ▼                          │
   F02 ──────►  F09 (readiness) ◄───────────┘
 go-bags         ▲  ▲  ▲
    │            │  │  │
    │            │  │  └── F08 (drills)
    │            │  └───── F05 (travel)
    │            └──────── F03 (medical)
    │
    └──────────► F06 (transfer) ──► exports everything
```

Hard ordering constraints:

1. **Schema v3 precedes everything.** It is the first PR of Phase A and is reviewed and merged on its own.
2. **F12b (privacy + wipe) precedes F03 (medical).** The app must be able to erase and lock the medical data it stores. F12b is scheduled in Phase A, F03 in Phase C.
3. **F09 (readiness) follows F01, F02, F04, F08** so its factors have real inputs. F03 and F05 are optional inputs, added when they land.
4. **F07 (profiles) precedes F11 (widget).** The widget reads the active profile.
5. **F10 (Spanish) is independent of the others** and can be scheduled in parallel, but its content work depends on the Mexico sources that F12a's registry also touches — one content batch covers both.

### 9.2 Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| **R1** | The v2 → v3 migration loses a v1.1 user's plan | Low | **Critical** | Pure function; fixture-based unit test captured from a real v1.1 install; the v2 key is retained for one release; the store's corruption quarantine still applies; write-new-before-clear-old | WS-A |
| **R2** | The plan provider reshape in F07 breaks a screen | High | High | F07 is last; every screen is migrated in one PR with a component test per screen; the provider exposes a stable `useActiveProfile()` hook so screens do not change shape | WS-A |
| **R3** | A readiness score reads as a judgement of the user | Medium | High | Bands describe the *plan*, not the person; no points, levels, or streaks; the full breakdown is always one tap away; WS-D copy review | WS-D |
| **R4** | Inventory or the medical plan creates false confidence ("I have 14 gallons, I am ready") | Medium | **High** | Coverage is always shown next to the calculated requirement, never merged into it; copy states it is the user's own tracking, not an official assessment; no "safe" language anywhere | WS-D |
| **R5** | The app is treated as clinical or legal advice (medical plan, 911 guidance, drills) | Medium | **High** | No clinical claims; "ask your clinician"; drills are explicitly practice aids; every medical and drill string is content-reviewed before merge; the app states the local authority decides | WS-D |
| **R6** | Spanish content is inaccurate for Mexico | Medium | High | Sources are Protección Civil, SMN, and CENAPRED; every claim is checked against the authority page; the 911 copy is deliberately generic; key-parity test prevents half-translated UI | WS-D |
| **R7** | The Spanish string extraction causes layout regressions across every screen | High | Medium | Separate mechanical PR; a dedicated review pass focused on layout; the extraction is verified by screenshot comparison on small and large screens in both languages | WS-C |
| **R8** | A new dependency breaks the native build | Low | High | `expo-doctor` clean; a new EAS build is produced before the release branch is cut; native changes are held to the last two weeks (except F11, which is native by nature and isolated) | WS-C |
| **R9** | The widget ships an inconsistent or stale readiness state | Medium | Medium | Widget and app read one shared document; the 14-day staleness hint; a neutral "Open StormReady" fallback instead of a stale score | WS-A |
| **R10** | The export file leaks medical data through a messaging app | Medium | High | Medical and inventory are excluded by default (`R-EXP-1`); the export screen states the file is not encrypted and suggests a private channel; the redaction is unit-tested | WS-A |
| **R11** | "Delete all my data" leaves something behind | Low | **Critical** | The wipe enumerates `keys.ts` and the file-system area directory; a unit test asserts an empty store afterwards; the privacy list is generated from the same source and a test keeps them in step | WS-A |
| **R12** | Scope creep from "one more feature" | High | Medium | The §5.3 cut order is agreed before the release starts; new requests go to v1.3; a feature that is not in §4 is not started | PO |
| **R13** | Third-party service rate limits (FEMA, Overpass, Nominatim) during device QA | High | Low | Dedicated User-Agents, no automatic retry on POST, a device-testing checklist that avoids production endpoints in QA, local fallbacks unchanged | WS-A |
| **R14** | Offline behaviour regresses silently | Medium | High | Airplane-mode pass is part of every phase exit criterion; every new feature in §4 declares its offline behavior explicitly | QA |
| **R15** | Single-engineer bus factor across four phases | Medium | Medium | This document plus a v1.2 technical build spec are written before Phase A; every PR documents its requirement IDs; each phase ends with a written handoff | PO |

### 9.3 Privacy review

| Question | Answer for v1.2 |
|---|---|
| Does any new feature send data to a server? | **No.** Every P0/P1 feature is fully local. F06 moves a file by the user's own transport; the app never uploads it. |
| Does any new feature request a new permission? | **No.** F11's widget requires no permission. F12b's app lock uses the device's own biometrics/PIN, not an app permission. F08's drills request nothing. |
| Does any new feature introduce an identifier or tracker? | **No.** No analytics, no crash reporting, no advertising identifier. The readiness score is derived on-device and never stored. |
| Does any new feature store sensitive data? | **Yes** — F03 stores medication details and F04 stores phone numbers. Both are mitigated by F12b (device-local app lock + full wipe), and both are excluded from the default export. |
| Does any new feature change the privacy promise on the Settings screen? | **No.** The promise is unchanged: local-only, no accounts, no servers, no tracking. The privacy screen (F12b) makes it more concrete. |

---

## 10. QA and test plan

### 10.1 Test layers

| Layer | Tool | Coverage in v1.2 |
|---|---|---|
| **Unit** | Jest (`jest-expo`) | Every pure module: inventory, go-bag, medical, comms, travel, scenarios, readiness score, readiness season, transfer model, zone registry, i18n key parity, v2→v3 migration, wipe |
| **Component** | React Native Testing Library | Readiness card, inventory editor, bag editor, communication card, medical plan, drill runner, profile switcher, privacy screen |
| **Integration (device)** | Manual checklist | Import/export between two devices, widget rendering, app lock, airplane-mode passes, notification channels |
| **Visual** | Screenshots, light + dark | Every new screen, in **both languages**, on a 5" phone and a large phone, at 130 % font scale |
| **Accessibility** | TalkBack / VoiceOver walkthrough, reduced motion, font scale | Every new screen; the drill runner is checked specifically (one question per screen) |
| **Offline** | Airplane mode | Every feature. This is the primary test, not an edge case. |
| **Migration** | Fixture-based | v1.1 real fixture → v3, asserting every field survives |

### 10.2 Coverage floor (raised, not lowered)

The existing floor is 80 % statements for `src/kit`, `src/storage`, `src/zone` and 60 % globally. v1.2 raises it:

| Path | v1.1 | v1.2 |
|---|---|---|
| `src/kit`, `src/storage`, `src/zone` | 80 % | 80 % |
| `src/inventory`, `src/gobag`, `src/medical`, `src/comms`, `src/scenarios`, `src/readiness`, `src/transfer`, `src/travel` | — | **80 %** |
| `src/i18n` | — | **95 %** (a string table is either complete or it is a bug) |
| Global | 60 % | **65 %** |

The raised floor is the mechanism that keeps the release honest: every feature in §4 has a pure module, and a pure module with no tests cannot pass.

### 10.3 Per-phase regression checklist

1. Launch → Home renders the readiness card and the checklist progress card.
2. Kill and relaunch → plan, inventory, bags, medical plan, contacts, drills, and the active profile all persist.
3. Airplane mode → every new screen renders; nothing shows a spinner that never resolves; no feature requires a network call to be useful.
4. Change household size → kit quantities, bag quantities, readiness coverage, and the trip override all update.
5. Set a kit item to expire tomorrow → it appears in "Replace soon" on Home and in the widget's expiry count.
6. Run the evacuation drill offline → it completes, produces a score, and offers to add a suggested task.
7. Export a plan → the file contains no medication names and no inventory quantities.
8. Import that plan on a second device → the preview lists the sections, the merge is exact, and the local zone is preserved.
9. Enable the app lock → the app locks on relaunch and after 5 minutes in the background.
10. Delete all data → the store is empty, the app is at onboarding, the saved area files are gone, notifications are cancelled.
11. Switch the language to Español → every screen is Spanish, dates are Spanish-formatted, and the sources are Mexican.
12. Add a second profile → its zone, kit, checklist, and saved area are empty, and the map says so rather than showing the first profile's data.
13. Dark theme → every new screen is legible and consistent with the existing tokens.
14. Reduced motion → no scale animations; all interactions still work.

### 10.4 Device matrix

| Device | OS | Priority | Why |
|---|---|---|---|
| Samsung Galaxy A-series (mid-range) | Android 13–15 | P0 | The primary audience's device class |
| Pixel 7a | Android 14 | P0 | Reference device |
| Low-end Android (≤ 3 GB RAM) | Android 11 | P1 | Performance of the readiness score and inventory list |
| iPhone 13 | iOS 18 | P1 | Spanish locale, secure store, widget parity |
| iPhone SE (small screen) | iOS 17 | P1 | Layout regressions from the string extraction |

**Widget caveat:** widgets, notification channels, secure-store biometrics, and background delivery are not emulated reliably. Each requires a physical device pass.

---

## 11. Non-goals, deferred ideas, and open questions

### 11.1 Non-goals for v1.2

No accounts. No cloud sync or backup. No analytics or crash reporting. No push-notification server. No autonomous background alert polling. No live traffic, closures, or turn restrictions. No automatic zone lookup beyond Florida. No user-generated content that leaves the device. No paid tier. No store submission (v1.2 remains an APK + internal iOS build, as v1.1 was). No "all clear" or "you are safe" language anywhere. No gamification: no points, levels, badges, streaks, or leaderboards.

### 11.2 Deferred to v1.3 (captured now, not lost)

| ID | Idea | Why deferred |
|---|---|---|
| D1 | Print / PDF export of the plan and kit | `expo-print` adds a native dependency; the F06 text file covers the need for now |
| D2 | Background alert refresh via task manager | Needs a native background task and a careful battery-impact review |
| D3 | A second automated zone provider (Texas, Louisiana) | The registry (F12a) exists so this is now a data change; the lookup itself needs a reliable public source |
| D4 | QR-code transfer between devices | A camera + encoder dependency; the file transfer covers the case |
| D5 | Barcode scanning for expiry dates | Camera + decoding, and the accuracy problem makes it a poor first version |
| D6 | Household sharing of a plan with live sync | Requires a backend, which violates the product's core promise |
| D7 | Widgets on iOS | Depends on the Android widget implementation and the platform's widget capabilities |
| D8 | Offline evacuation-route replanning with closures | Requires a closure data source that does not exist |
| D9 | Medication refill reminders that integrate with a pharmacy | Requires a pharmacy integration and a network service |
| D10 | A community/shelter crowdsourcing layer | Would need moderation and a server; the app deliberately shows official listings only |
| D11 | Portuguese and other locales | After the i18n mechanism is proven in one additional language |
| D12 | Voice guidance for the drill runner | Accessibility win, but a TTS dependency and a large content effort |

### 11.3 Open questions (to resolve before Phase A)

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Does the readiness score's weighting feel right to a real household, or does it over-weight the checklist? | Product + 5 testers | End of Phase B |
| Q2 | Should the medical plan be able to exist for a household that answered "no" to medical needs during onboarding? (Current design: yes, with a gentle prompt.) | Product | Phase A |
| Q3 | Is the "off-season" copy for the seasonal check acceptable in the southern hemisphere (Mexico is entirely north of the equator, so the US model holds — but this should be stated explicitly rather than assumed)? | WS-D | Phase B |
| Q4 | Should the export file be encrypted with a user-supplied passphrase? (Deferred as D-encryption; the risk is mitigated by default redaction.) | Product + security review | Phase C |
| Q5 | Does the app lock need to be a numeric PIN, a device biometric, or both? `expo-secure-store` supports both, but the UX differs on shared devices. | Design | Phase A |
| Q6 | Is the "Home" default profile name localizable, or should it be the user's own input from the first-run flow? | Design + WS-D | Phase A |
| Q7 | Should the readiness band labels be adjectives ("Ready") or nouns ("Your plan is ready")? Nouns read less like a judgement. | WS-D | Phase B |
| Q8 | What is the maximum acceptable size for the v3 plan document with 3 profiles, 30 bags, 40 medications, and full inventory? (Estimate: well under 100 KB. Confirm with a device measurement, because AsyncStorage performance degrades with large values.) | Engineering | Phase A |

### 11.4 Explicitly rejected proposals

| Proposal | Why it was rejected |
|---|---|
| "Score of 92/100 — you're 92 % ready" | A precise number invites false precision and comparison. Bands with a visible breakdown are honest. |
| Cloud backup of the plan | Breaks the privacy promise, which is the product's main differentiator, and requires a backend the project does not have. |
| A chat/contact feature for the family | Message routing is not the product's job, and it would require a server. |
| Auto-ordering supplies or a shopping cart | Commercial feature, contradicts the no-paid-tier and no-tracking posture. |
| "Emergency mode" that changes the UI to red and disables non-essential features | The product's tone is calm by design. A panic-mode redesign is the opposite of the stated principles. |
| Live shelter capacity from a scraped source | The shelter data is already known to be incomplete; adding a scraped, unverified capacity figure would create a safety risk. |

---

## 12. Success measures and reporting

### 12.1 Goals and measures

| # | Goal | Measure | Target (by the end of Phase D) |
|---|---|---|---|
| **G1** | Households track possession, not just intention | % of active profiles with ≥ 3 inventory entries marked owned | ≥ 45 % |
| **G2** | The plan is divided between people | % of profiles with ≥ 1 go-bag | ≥ 30 % |
| **G3** | Communication gaps are closed | % of profiles with an out-of-area contact **and** a meeting point | ≥ 40 % |
| **G4** | The plan is rehearsed | Drills completed per active profile per quarter | ≥ 0.5 |
| **G5** | The plan travels between devices | Exports per 100 active profiles | ≥ 8 |
| **G6** | The Mexico audience is served | % of Spanish-locale sessions that complete onboarding (from the opt-in local counter) | ≥ 50 % |
| **G7** | Users trust the app with sensitive data | Medical plans created per 100 active profiles | ≥ 10 |
| **G8** | The app is visible outside the app | Widget installs (Android launcher metric, aggregate only) | ≥ 15 % of Android installs |
| **G9** | Reliability | Crash-free sessions in preview builds | ≥ 99.5 % |
| **G10** | Quality floor | CI green, coverage thresholds met, zero open Sev-1 at release | 100 % |

**Measurement caveat (unchanged from v1.1):** v1.2 ships **no analytics**. G1–G8 are measured with the same opt-in, on-device counters as v1.1 — counts of feature usage, stored locally, exportable by the user from Settings, never transmitted. If the user declines, the metrics simply do not exist. This trade is deliberate: **privacy promise over perfect numbers.**

### 12.2 Reporting cadence

- **Weekly (Fridays):** phase status, burn-up against the §6 milestones, blocked items, risk movement.
- **Per phase:** exit-criteria review with sign-off from the product owner; a written handoff note.
- **Post-release (14 days):** crash-free rate, opt-in counter export, qualitative feedback from 5 testers.
- **Retrospective at GA:** what was cut, what slipped, and the v1.3 list.

### 12.3 Release gates (all must hold on release day)

- All P0 and P1 features in §4 shipped complete; no half-wired features in the build.
- `npx expo lint`, `npx tsc --noEmit`, `npm test`, `npm run test:coverage`, `npx expo-doctor` all clean on the release commit.
- The v1.1 → v3 migration verified on a **real v1.1 install** upgraded to the v1.2 build, with the plan, zone, checklist, saved area, and alert snapshot all intact.
- Every new user-facing string reviewed by WS-D (medical, drills, readiness copy, Spanish content, privacy copy).
- The airplane-mode pass (§10.3) is complete on at least two physical devices.
- The wipe action and the privacy screen are verified on a physical device.
- If F11 ships, `runtimeVersion` is bumped and a new build is produced and distributed (not OTA).
- A rollback plan is tested: a previous OTA update can be re-applied or reverted. Note that any release containing schema v3 makes the app **forward-only** for that build — a rollback to a pre-v3 build would not read v3 data. The rollback plan therefore covers JS-only regressions within v1.2, and a v1.1 rollback requires a reinstall. This is stated here because it is a real consequence of the migration, and the v1.1 legacy key is retained for exactly this reason.

---

## 13. Definition of success for v1.2

StormReady v1.2 ships when a household can:

1. **Say what they have.** Record what is in the kit, when it was bought, and when it expires — and see the gap between what the guidance says and what is in the cupboard.
2. **Divide the plan between people.** Give each person a go-bag with quantities that follow the household automatically, and know who is responsible for what.
3. **Reach each other.** Record an out-of-area contact, a meeting point, and a check-in cadence — and share a single card with a relative's phone, with no account and no server.
4. **Rehearse.** Run a ten-minute drill offline, find two gaps, and turn them into checklist tasks.
5. **See where they stand.** Open the app (or the widget) and see one honest band with the three things that would help most — never a false "you are safe".
6. **Use it in their own language.** Use the whole app in Spanish, with Mexican authorities as the cited sources and no false claims of coverage.
7. **Trust it with the sensitive parts.** Store a medication list, lock the app with a device PIN, and delete everything with one irreversible, verified action.
8. **Do all of it on a plane, with no account, and with the app never having transmitted a byte of their plan.**

---

*End of document. Companion implementation contract: `docs/spec/04-technical-build-spec.md` (to be written before Phase A begins).*
