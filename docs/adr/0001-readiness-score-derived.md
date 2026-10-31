# ADR-0001: Readiness score is derived, never stored

## Status

Accepted

## Context

The readiness score (0–100, derived from 9 weighted factors) is computed fresh every time and never persisted. Most scoring systems store the result.

## Decision

The readiness score is derived, not stored. Every render recomputes it from the current plan data.

## Consequences

- **Pro**: Always current. No staleness risk. Matches the principle "the score describes the plan, not the person" (R-RDY-7).
- **Pro**: No migration path needed when weights change.
- **Con**: No trend line across sessions. A user can't see their score improve or decline over time.
- **Con**: If the score is ever used for a feature that needs persistence (e.g., a dashboard), the data must be re-derived or a new storage path added.

## Notes

It is unclear whether this was an intentional design choice or an oversight. The code comments reference R-RDY-7 ("the score describes the plan, not the person") which supports the derived approach, but the lack of a trend-line feature suggests the persistence question may not have been fully considered.
