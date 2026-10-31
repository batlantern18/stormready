# ADR-0002: Florida-only evacuation zone lookup in v1.2

## Status

Accepted

## Context

The app looks up a household's address against Florida Division of Emergency Management evacuation polygons. The season model works for any US state (Gulf/Southeast → hurricane, Western → wildfire, else → winter storm), but the zone lookup is Florida-only.

## Decision

The evacuation zone lookup uses Florida polygon data in v1.2. This was not a deliberate "only Florida" decision; it was the first step. The app is Florida-focused and built for Florida first.

## Consequences

- **Pro**: Florida has a well-defined polygon system with a public API. The domain fits the data.
- **Pro**: A focused launch is simpler than a multi-state rollout.
- **Con**: Users in other states see no zone data and may be confused. The season model works for them but the zone lookup does not.
- **Con**: Adding other states requires finding polygon APIs for each state and a routing mechanism to select the right one.

## Notes

The app is Florida-first. The season model is state-agnostic by design (Gulf/Southeast, Western, and default winter branches), but the zone lookup was built against the only public polygon API the developers had access to at launch.
