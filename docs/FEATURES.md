# StormReady — Features

StormReady is a local-first emergency preparedness app for households in the United States and Mexico. It helps a household build an emergency plan, track supplies, coordinate household response, and review official preparedness guidance. Personal plan data stays on the device; no account is required.

This document describes each feature in detail. It intentionally excludes internal offline mapping and routing plumbing.

## Household planning

- **Purpose:** Establish the facts of a household so later guidance (kit quantities, checklist steps, drills) can be grounded in real conditions.
- **What it captures:** Number of people, infants, preparedness days, pets and pet count, vehicle availability, medical needs, county, and accessibility needs. Household country and state were added in schema v1.2 to drive Spanish content and the Mexico guidance set.
- **How it is used:** Household details feed the emergency kit quantities, the preparedness checklist, and scenario personalization.

## Emergency kit

- **Purpose:** Maintain a household-sized emergency kit and know what is missing.
- **What it captures:** Kit catalog lines with quantities and units, plus inventory entries keyed by catalog line.
- **Inventory tracking:** For each kit line, the app records whether the item is owned, how many units are owned, purchase date, expiration date, and notes. Rotation state and expiry/expiration analysis are tracked over time.
- **Gap analysis:** Compare owned quantities against recommended kit quantities and surface gaps and items needing attention.

## Preparedness checklist

- **Purpose:** Turn preparedness into actionable steps rather than abstract advice.
- **What it does:** Presents a checklist of tasks with categories, optional tasks, and completion state; progress saves automatically and stays on the device.
- **Next steps:** The Home screen surfaces the next incomplete item and overall completion progress; a complete checklist prompts the user to keep the plan handy and recheck local guidance when conditions change.

## Kit personalization

- **Purpose:** Make kit and checklist content reflect the household, not generic advice.
- **How:** Kit recommendations and checklist context are derived from household details and the verified evacuation zone.

## Supply tracking (inventory)

- **Purpose:** Keep supply data current over time.
- **What it tracks:** Item ownership, quantities, purchase/expiration dates, notes, and seasonal rotations, with expiry and rotation analytics.

## Go-bags

- **Purpose:** Organize grab-and-go supplies by household member.
- **What it does:** Supports personal, vehicle, work, kids, home, and custom bag templates; tracks per-bag item packing state and readiness.

## Medical planning

- **Purpose:** Record medical needs and backup power requirements.
- **What it captures:** Medications (dose, schedule, days, refrigeration, prescription refill date, pharmacy, notes) and medical devices (power source: mains, battery, or both; backup hours; refrigeration need), plus medical contacts and allergies.
- **Backup power:** Records how many backup hours each device needs and for how long, informing the backup power planner.

## Communication planning

- **Purpose:** Keep household response coordination concrete.
- **What it captures:** Emergency contacts, meeting points, check-in plans (who, interval, method, fallback), and backup contact arrangements.

## Preparedness drills

- **Purpose:** Practice response before an emergency.
- **What it does:** Runs offline scenario drills (for example, power outage, shelter in place, evacuation walk, home medical hour, phones down) and maps answers to suggested follow-up tasks.

## Readiness summary

- **Purpose:** Give a quick view of preparedness health.
- **What it does:** Derives a readiness score from weighted factors — checklist, coverage, expiry, zone, go-bags, communication, medical, drills, and kit review — and surfaces bands (ready, almost, attention, starting) with top gaps and actionable reasons.

## Backup power planning (Power tab)

- **Purpose:** Plan for power loss.
- **What it does:** Opens the embedded, self-contained backup power planner (rendered in a WebView from a single-file HTML bundle) for building a household power plan: backup hours per device, longer-outage call lists, and related next steps.

## Alerts and updates

- **Purpose:** Check and understand alerts affecting the household.
- **What it does:** Runs a live alert check based on the user's location or an entered address; surfaces nearby alerts, event details, severity/urgency, instructions, and saved offline alert snapshots.
- **Scope notes:** Alerts come from official sources; the app is a planning aid, not an alert authority.

## Onboarding and zones

- **Purpose:** Collect and verify household context.
- **What it does:** Multi-step onboarding (welcome, language, household, zone); evacuation zone selection/verification with staleness handling and source metadata (manual, Florida lookup, none); country-aware guidance for US and Mexico.

## Settings and data

- **Appearance:** Light or dark theme.
- **Optional reminders:** Weekly checklist nudges and monthly zone recheck prompts, scheduled through the device reminders channel; off by default.
- **Your saved plan:** Inspect locally stored plan; transfer plan to another device via QR code; clear saved data.
- **Trusted guidance:** Official preparedness sources and disclaimers.
- **About:** Version and app information.

## Privacy and data handling

- **On-device storage:** Personal plan data is stored on the device only; no account required.
- **Locking:** Optional device PIN gate for stored plan data.

## Internationalization

- **English and Spanish:** Locale switching; dates follow the selected locale; guidance content adapts by country.

## Safety and scope

- StormReady is a planning aid, not an emergency alert authority; official sources are final.
- Automated evacuation-zone lookup is currently available for Florida; elsewhere use the zone published by the local emergency authority.

## App areas / screens

- **Home:** Preparedness progress, next steps, alert guidance.
- **Prepare:** Household details, emergency kit, checklist, zone/destination planning.
- **Updates:** Alerts and local guidance.
- **Power:** Backup power planner.
- **Settings:** Appearance, reminders, saved plan, trusted guidance, about.

## Out of scope for this document

- Internal offline mapping and routing systems are not described here.
