# StormReady v1.1 "Ready Kit" — Project Plan

**Release:** v1.1 "Ready Kit"  
**Status:** Approved for execution  
**Companion doc:** `docs/spec/01-technical-build-spec.md` (the implementation contract)

---

## 1. Executive summary

StormReady v1.0 is a working, local-first preparedness app for the US and Mexico. v1.1 "Ready Kit" introduces first-run onboarding, a household-driven kit calculator with a shareable checklist, manual evacuation-zone verification for every US county, and opt-in local reminders built on a versioned local storage layer.

| | v1.0 (today) | v1.1 (this release) |
|---|---|---|
| First run | Lands on Home with defaults | 4-step onboarding → personalized plan |
| Kit | One line: "set aside drinking water" | Full personalized, shareable kit list with quantities and sources |
| Zone | Florida only, automatic | Every US county: automatic (FL) or manual verification with provenance |
| Reminders | None | Opt-in local reminders (checklist nudge, recheck prompt) |
| Storage | Scattered AsyncStorage keys | Versioned store with migrations and corruption recovery |
| Quality | No tests, no CI, Android only | Unit + component tests, CI gates, preview APK builds |
| Privacy | Local-only, no accounts | Unchanged — local-only, no accounts, no analytics |

---

## 2. Product intent and principles

**North star:** a household completes a usable preparedness plan quickly, offline, without an account.

1. **Local first, always.** Fully useful with no connection.
2. **The app plans; the authority decides.** Shows what was entered, where it came from, and when it was verified.
3. **Plain language, calm tone.** No fear marketing or alarmist copy.
4. **Small steps, visible progress.**

### 2.1 Personas
- **Marisol (Tampa, US):** Family of 4 with a dog, wants a zone and a kit sized for her household.
- **Dev (Monterrey, MX):** Rents, no car, needs official-source guidance and exportable plans.
- **Rita (Lubbock, US):** Medical needs, requires medication tracking and emergency contacts.

### 2.2 Non-goals
No accounts, no cloud sync, no analytics, no push-notification server, no autonomous background alert polling, no paid tier, no live traffic.

---

## 3. Goals and success measures

| # | Goal | Measure |
|---|---|---|
| G1 | Users leave onboarding with a populated plan | % of new installs completing onboarding |
| G2 | A concrete kit exists | % of users who open the kit list |
| G3 | The plan is transportable | Kit lists shared via system share sheet |
| G4 | Zone confidence | % of US users with a recorded zone |
| G5 | Engagement without nagging | Weekly plan opens per active user |
| G6 | Reliability | Crash-free sessions in preview builds |
| G7 | Quality floor | CI green, coverage thresholds met |

---

## 4. Implementation phases

The build is structured into clear sequential engineering phases:

1. **Phase 1 — Foundation:** Storage migration layer, schema v2 updates, test harness setup, and pure plan reducers.
2. **Phase 2 — Kit & Onboarding:** Kit catalog and calculation engine, UI kit cards, share sheet integration, and onboarding route flow.
3. **Phase 3 — Zone & Reminders:** Manual zone verification rules, county entry, staleness warnings, and local notification scheduling.
4. **Phase 4 — Hardening & Quality:** Accessibility pass, network helper hardening (`http.ts`), CI workflow setup, and APK release engineering.

---

## 5. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Storage migration loses user data | Low | Critical | Migration unit-tested against v1 fixtures; keep legacy key temporarily |
| R2 | Kit quantities read as official requirements | Medium | High | Every line carries a basis + source label; clear planning-baseline copy |
| R3 | Reminders feel like false alarms | Medium | High | Low-importance notification channel; clear opt-in copy |
| R4 | Third-party API rate limits | High | Low | Dedicated User-Agents, serialized test usage, local fallback caches |
| R5 | Scope creep | High | Medium | Backlog discipline: new requests go to v1.2 |

---

## 6. QA and test plan

- **Unit Tests:** Jest (`jest-expo`) covering kit calculations, storage migrations, store operations, zone validation, and reminder scheduling.
- **Component Tests:** React Native Testing Library for onboarding flow and kit interfaces.
- **Device Checks:** Physical Android device testing for offline routes, map pack downloads, notifications, and airplane mode resilience.