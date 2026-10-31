# StormReady Glossary

Terms and definitions for the StormReady domain model. Use these terms consistently in issues, ADRs, code comments, and UI copy.

## Core

**StormReady** — A local, on-device disaster preparedness planner. Explicitly *not* an alert system, a clinical tool, or a weather service. The app helps a household plan and check back; it never sends data anywhere or fetches live data (except the Florida evacuation zone lookup in v1.2).

**Profile** — A single household's complete plan. One profile per plan in v1.2. The multi-profile infrastructure exists in the schema but no switching UI has shipped.

**Zone** — The household's local evacuation zone assigned by the emergency authority. Florida-specific in v1.2 (via the Division of Emergency Management polygon lookup); the domain model is state-agnostic.

**State** — The household's US state or Mexican state. Used for the season model (regional risk), not for evacuation zones.

**Source authority** — The emergency management body or preparedness guide cited by a planning item (e.g., Ready.gov, Protección Civil, National Hurricane Center). A *citation*, not a data source. The app never connects to these authorities.

## Planning

**Task** — A planning action in the preparedness checklist (e.g., "Set aside drinking water", "Choose an out-of-area contact"). Tasks are the plan; they are not drills.

**Drill** — A scenario-based exercise that tests the plan (e.g., "Power outage", "Evacuation"). Drills are practice, not planning. A drill can suggest tasks; tasks are never drills.

**Kit** — The calculated list of supplies the household needs, derived from the household's composition (people, infants, days, pets, medical needs). The kit is computed, not stored.

**Go-bag** — A pre-packed bag containing a subset of the household's kit. The go-bag is the "grab-and-go" layer on top of the full kit. It stores only kit line IDs; quantities always come from `calculateKit`.

**Readiness score** — A derived 0–100 measure of the plan's completeness. Scores the *plan data*, not the family. The score is a planning aid, not a judgment. No points, levels, badges, or streaks.

**Season** — A recurring period of elevated disaster risk for a region. Currently: hurricane (Gulf/Southeast US, Mexico), wildfire (Western US), winter storm (elsewhere in US). The season drives the seasonal reminder, not the kit calculation.

## Data

**Plan file** — A self-contained, on-device export of a profile's data (`.stormready-plan` format). Never uploads anywhere. Medical and inventory data are excluded by default (opt-in). Zones are never overwritten on import. A sharing mechanism, not a backup service.

**Kit inventory** — The user's own tracking of what they own (separate from the calculated kit). Tracks quantities, purchase dates, and expiry dates for water and food.

**Coverage** — The ratio of owned to required for water (gallons) and food (person-days). Derived, never stored.

**Rotation** — The act of stamping `purchasedAt` to today for inventory items that have no date. Driven by the seasonal check.

**Seasonal check** — The prompt to review and rotate the kit when a season starts and the kit has not been reviewed since the season began.

## Scenarios

**Evacuation zone** — A more specific term for the zone: the household's local evacuation zone (e.g., "Zone C") determined by the emergency authority's polygon data. In v1.2, Florida only.

**Shelter** — A designated place for displaced residents. The app stores shelter data for offline map display; it does not fetch shelter data live.

**Drill result** — A record of a completed drill: the answers given, the time taken, and any suggested tasks. Stored locally; never shared.
