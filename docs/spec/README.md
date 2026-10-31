# Build specs

Build records for shipped releases. Each file describes what was planned and why at the time it was written; none of them describe the app as it is today.

| File | Release | Read it for |
|---|---|---|
| [`v1.1-project-plan.md`](./v1.1-project-plan.md) | v1.1 "Ready Kit" | Goals, milestones, risks, and rollout for the v1.1 build |
| [`v1.1-technical-build-spec.md`](./v1.1-technical-build-spec.md) | v1.1 "Ready Kit" | Numbered requirements and acceptance criteria for storage, onboarding, kit, zones, reminders, and tests |
| [`v1.2-project-plan.md`](./v1.2-project-plan.md) | v1.2 "Resilience" | The 12-feature catalogue, prioritization, schema v3 migration design, and QA plan |
| [`v1.2-release-notes.md`](./v1.2-release-notes.md) | v1.2 "Resilience" | What shipped, what was cut, defects found, and the gate results |

For current behavior read [`docs/FEATURES.md`](../FEATURES.md) and the code. For decisions read [`docs/adr/`](../adr/). For what shipped in each release read [`RELEASE_NOTES.md`](../../RELEASE_NOTES.md).

Baselines, dependency versions, "state today" tables, and test/coverage counts inside these files describe the tree when the spec was written. They are kept as written; `package.json`, the code, and a fresh `npm test` run are the source of truth for the present.
