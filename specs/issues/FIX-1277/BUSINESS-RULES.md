# FIX-1277 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, as rules. Every rule here holds today; the point of this change is that it still holds
afterwards, on every store. "All four" means memory, filesystem, Postgres (PGlite in CI) and
SQLite.

## Refusing a version that can't be one

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A write passes `"any"`, `"absent"` or a whole number ≥ 0 to `set` | Accepted for checking; the store decides the outcome | Conformance, all four |
| BR-2 | A write passes a negative, fractional, `NaN` or infinite version to `set` or `delete` | A `TypeError` whose text is exactly today's, never a conflict | New characterization case, all four, green on `main` first |
| BR-3 | `delete` is passed `"absent"` | A `TypeError` with today's delete-specific text, which points at `0` | Same case |
| BR-4 | A refused version reaches `delete` on a key that never existed, or one already deleted | Still refused. The guard runs before those early answers | Conformance (exists) |
| BR-5 | `-1` reaches any store | Refused, so it can never reach the SQL stores' internal "any" marker | Conformance (exists) |

## What a conflict reports

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A write conflicts with a live row | The row's current value and version | Conformance (exists) |
| BR-7 | A write conflicts with a deleted row, or no row | No current value; the deleted row's version, or `0` | Conformance (exists) |
| BR-8 | The in-memory store reports a conflict | The value is a copy; changing it does not change the stored row | Conformance (exists) |

## One implementation, no side effects

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | The source is searched for a definition of the guards or the conflict report | Exactly one, in contracts | Census, `--after` |
| BR-10 | Contracts is built | It still imports nothing | `contracts-zero-dep.spec.ts` |
| BR-11 | A store package imports the rule | The package-boundary check passes | `scripts/validate-package-boundaries.mjs` |
| BR-12 | Code imports `ExpectedVersion`, `ResourceStateRow` or `ResourceStateConflict` from `@flow-state-dev/engine` | It still compiles | `pnpm typecheck` |
| BR-13 | The diff is read | No SQL text changed in either store | Diff check (PLAN V6) |

## Failure taxonomy

Nothing new can fail. A refused version stays a thrown `TypeError` (a caller's programming
error); a lost race stays a returned conflict. Neither retries inside the store.

## Acceptance criteria this issue owns

The conformance suite, with the new characterization case, is green on all four stores before
and after; the census passes in `--after` mode where it fails on `main`; no SQL line changed.
