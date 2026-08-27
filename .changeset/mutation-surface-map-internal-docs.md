---
---

Internal (docs): corrects the concurrency guarantee the contributor-facing docs state over the scope-state mutators. No package surface changes.

The architecture and contributing references said every state op was CAS-guarded. Only some are: a commutative write (single-field `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, single-literal-field `patchState`) persists at `expectedVersion: "any"` where the adapter advertises the delta verb, and takes no version check — while a deleted record still refuses it. Corrected in `docs/architecture/overview.md`, `docs/architecture/state-and-scopes.md`, `docs/contributing/architecture-reference.md` and the `debug-flow` skill. The published `apps/docs` half of the same correction is not in this change.
