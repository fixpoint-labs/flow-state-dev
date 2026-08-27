---
---

Internal (docs): corrects the concurrency guarantee the contributor-facing docs state over the scope-state mutators. No package surface changes.

The architecture and contributing references said every state op was CAS-guarded. Only some are. A commutative write — `pushState`, `setStateRecord` and `deleteStateRecord`, `incState` on a single field, `patchState` on one literal field — persists at `expectedVersion: "any"` where the adapter advertises the delta verb and takes no version check. What that buys is narrower than "no lost updates": writes to unrelated paths all survive, increments and appends compose, but two same-path writes overwrite each other silently, and a deleted record refuses the write regardless. `deleteField` is uneven across adapters and scopes — no shipped adapter advertises it on request scope.

The full enumeration now lives once, in `docs/architecture/state-and-scopes.md` → "Atomicity Guarantees"; `docs/architecture/overview.md`, `docs/contributing/architecture-reference.md` and the `debug-flow` skill link to it at their own altitude. The published half is corrected to match — nine `apps/docs` pages and the `@flow-state-dev/engine` README. Prose only: no exported symbol, type or runtime behaviour moves, so nothing is version-bumped.
