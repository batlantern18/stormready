# StormReady v1.1 — Technical Build Spec (agent-executable)

**Release:** v1.1 "Ready Kit"  
**Status:** Approved for implementation  
**Owner:** Mobile engineering  
**Companion doc:** `docs/spec/02-project-plan.md` (what / why). This document is **how**.

---

## 0. How to use this spec

You are an implementation agent working in this repo. This document is the contract.

- Every requirement is numbered (`R-<area>-<n>`) and every acceptance criterion is testable.
- **Do not trust your training data on Expo APIs.** This repo is on **Expo SDK 58 / React Native 0.88 / React 19.3 / Reanimated 4.7**. Before writing code against any Expo or RN API, fetch the matching versioned docs: `https://docs.expo.dev/versions/v58.0.0/<page>` (append `.md` for the agent-readable version) and `https://docs.expo.dev/llms.txt`.
- `android/` is **generated** (Continuous Native Generation). Never create or hand-edit it. Native behavior lives in `app.json` + config plugins.
- MapLibre ships native code, so the app requires a **development build** (`npx expo run:android`). Expo Go cannot render the Map tab.
- Required gates before a PR is "done": `npx expo lint`, `npx tsc --noEmit`, `npm test`, plus a manual pass on a physical Android device for anything touching location, maps, files, or notifications.

### 0.1 Current baseline (verified against this repo)

| Area | State today |
|---|---|
| Routes | `src/app/_layout.tsx` → `(tabs)/{index,plan,map,updates,settings}`; `map` is platform-split (`map.tsx` re-exports `map.web.tsx`; `map.native.tsx` is the MapLibre implementation) |
| State | `src/plan.tsx` (`PlanProvider`, AsyncStorage key `stormready.plan.v1`), `src/theme.ts` (key `stormready.theme.dark.v1`) |
| Data | `src/shelters.ts` (FEMA ArcGIS + Overpass), `src/zone.ts` (Florida DEM ArcGIS), `src/offline-router.ts` (Overpass download + Dijkstra + offline destination index) |
| Storage | `AsyncStorage` for plan, theme, alert snapshot (`stormready.weather-alerts.snapshot.v1`) and area pack (`stormready.area.v2`); large road graph + destination index already use `expo-file-system` (`File`, `Paths`) |
| UI kit | `src/ui.tsx` — `Page`, `Header`, `Card`, `Label`, `Body`, `Field`, `Action`, `Pill`, `Row`, `MotionPressable`; tokens in `src/theme.ts` (light + dark palettes) |
| Map | `src/app/(tabs)/map.native.tsx` — offline packs, shelters, zone sheet, route + guidance, county PDF via `WebView` |
| Build | `app.json` (Android-only: package `org.stormready.app`, location permissions plugin), `eas.json` (`preview` = internal APK, `production`), CI absent, tests absent |

### 0.2 Non-goals for v1.1

No accounts, no cloud sync, no analytics SDK, no background push server, no live traffic, no official alert authority, no automated Mexico alerts, no paid features, no App Store submission.

---

## 1. Scope of the v1.1 build

Five features, one shared foundation.

| ID | Feature | Area |
|---|---|---|
| F1 | Versioned local storage layer + plan schema v2 | Foundation |
| F2 | First-run onboarding (household, zone, permissions) | Onboarding |
| F3 | Emergency kit calculator + shareable kit list | Kit |
| F4 | Manual evacuation-zone verification outside Florida | Zones |
| F5 | Local reminders (checklist nudges + "recheck your area") | Notifications |
| F6 | Accessibility, tests, CI, OTA | Quality |

**Critical path:** F1 → F2 → F3. F4 and F5 depend on F1 only. F6 runs continuously.

---

## 2. Architecture

### 2.1 Target module map

```
src/
  storage/
    keys.ts            # every persisted key + schema version, one place
    store.ts           # typed JSON read/write with schema version + migration
    migrate.ts         # v1 → v2 plan migration
  kit/
    catalog.ts         # static kit item catalog (id, label, category, unit, source)
    calculator.ts      # pure functions: household → kit lines + totals
    format.ts          # formatting helpers (gallons, quantities)
  zone/
    verification.ts    # manual zone entry model, validation, source list
  notifications/
    scheduler.ts       # local notification scheduling/cancelling (expo-notifications)
    channels.ts        # Android channel + permission setup
  net/
    http.ts            # fetch wrapper: timeout, retry/backoff, user-agent, error mapping
  plan.tsx             # PlanProvider (now consumes storage/store)
  theme.ts             # unchanged tokens
  ui.tsx               # shared components
  app/
    _layout.tsx        # providers + onboarding redirect
    onboarding/        # NEW route group: welcome, household, zone, done
    (tabs)/...
```

Rule: **`src/app/**` contains routes only.** Components, hooks, and utilities live outside it.

### 2.2 Dependency direction

```
routes (src/app)  →  domain modules (src/kit, src/zone, src/notifications)
                   →  storage (src/storage)  →  AsyncStorage / expo-file-system
                   →  net (src/net)          →  remote APIs
```

Domain modules never import from `src/app`. `src/kit`, `src/zone`, `src/notifications` and `src/storage` must be importable in a plain Node test environment (no React Native runtime imports except `expo-file-system`/`expo-notifications`, which are mocked in tests).

### 2.3 New dependencies

| Package | Why | Install |
|---|---|---|
| `expo-notifications` | F5 local notifications | `npx expo install expo-notifications` |
| `jest-expo`, `jest`, `@testing-library/react-native`, `@types/jest` | F6 test harness | `npx expo install jest-expo jest` + `npm i -D @testing-library/react-native @types/jest` |

No other dependency may be added in v1.1.

---

## 3. F1 — Versioned local storage layer

### 3.1 Requirements

- **R-STO-1.** All persisted state is read and written through `src/storage/store.ts`. No screen may call `AsyncStorage` directly. The four existing keys are migrated to the new layout.
- **R-STO-2.** Every stored document carries a `version` field. The store refuses to parse a document whose `version` is newer than the code knows.
- **R-STO-3.** A corrupted or unparseable document falls back to default values, keeping the corrupt payload under a `.corrupt` key for diagnosis, showing a non-blocking banner.
- **R-STO-4.** Writes are debounced (250 ms) and serialized.
- **R-STO-5.** Every key is declared in `src/storage/keys.ts` with a `SCHEMA_VERSION` and a `DEFAULT` value.

### 3.2 Plan schema v2

```ts
export type PlanState = {
  onboarded: boolean;
  household: {
    people: number;
    infants: number;
    days: number;
    pets: boolean;
    petCount: number;
    hasVehicle: boolean;
    medicalNeeds: boolean;
    county: string;
    accessibilityNeeds: boolean;
  };
  zone: {
    value: string;
    source: 'florida-lookup' | 'manual' | 'none';
    county: string;
    verifiedAt: string | null;
    notes: string;
  };
  destination: { label: string; address: string; transport: string };
  tasks: Task[];
};
```

---

## 4. F2 — First-run onboarding

### 4.1 Requirements

- **R-ONB-1.** On first launch (`plan.onboarded === false`) the root layout redirects into `src/app/onboarding/`.
- **R-ONB-2.** Onboarding consists of four steps: **Welcome**, **Household**, **Zone**, **Ready**.
- **R-ONB-3.** The user can skip the flow at any time.
- **R-ONB-4.** Location permission is **not** requested during onboarding.

---

## 5. F3 — Emergency kit calculator

### 5.1 Requirements

- **R-KIT-1.** `src/kit/calculator.ts` is **pure**: no React, no network, no storage. Fully unit tested.
- **R-KIT-2.** Every number produced is labeled with its basis and source.
- **R-KIT-3.** Shareable as plain text through the system share sheet.
- **R-KIT-4.** Viewable offline and reflects current household state.

---

## 6. F4 — Manual evacuation-zone verification

### 6.1 Requirements

- **R-ZON-1.** Florida keeps automatic lookup; all other US locations support manual entry with free-text notes and source URLs.
- **R-ZON-2.** Manual zones include provenance labels ("entered by you").
- **R-ZON-3.** Staleness warning when `verifiedAt` is older than 90 days.
- **R-ZON-4.** Links out to local emergency management pages.

---

## 7. F5 — Local reminders

### 7.1 Requirements

- **R-NOT-1.** Reminders are opt-in and off by default.
- **R-NOT-2.** Android uses two channels (`reminders` and `alerts`).
- **R-NOT-3.** Uses `Notifications.scheduleNotificationAsync` with inexact triggers.
- **R-NOT-4.** Identifiers persisted in `keys.notifications`.

---

## 8. F6 — Accessibility, tests, CI, OTA

### 8.1 Accessibility & Testing
- **R-A11Y-1 through 7.** Standard accessibility roles, target sizes, WCAG AA contrast, and reduced motion compliance.
- **R-TST-1 through 4.** Jest-expo test suite covering calculator, migrations, store, zone validation, reminder scheduler, and offline routing with mocked fetch.

### 8.2 CI Requirements
GitHub Actions workflow executing linting, TypeScript type-checking, Jest tests, and `expo-doctor`.

---

## 9. Network and offline behavior

- All remote requests route through `src/net/http.ts` with explicit `User-Agent` headers, timeout management, and exponential backoff retry policies for safe GET requests.
- Supports FEMA, Overpass, Nominatim, Weather.gov, and Florida DEM integrations with local caching fallback strategies.

---

## 10. Explicitly deferred (Backlog)
- Push notifications with a backend server
- Multi-household support
- Spanish/Portuguese UI localization
- PDF kit sharing
- Automated zone lookups outside Florida