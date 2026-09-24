# FIX-1538 · cell-sites — where a user-scoped key comes from

**Question.** Is the per-(org, person) cell a narrow change? The plan rests on one enumerated
fact: every production read and write of user-scoped storage takes its key from the derivation in
`packages/engine/src/stores/scope-keys.ts`, with the flow in hand, except for the bypasses the plan
names.

**What it does.** Scans every `packages/<pkg>/src` TypeScript file (tests and the store adapters
excluded) for key derivations and for user-scope or variable-scope store calls, and asserts that
every file with a hit is classified with its exact counts. A new site fails until someone
classifies it.

**Run** (from the repo root, no install needed):

```bash
node specs/issues/FIX-1538/poc/cell-sites/check.mjs           # PASS, exit 0
node specs/issues/FIX-1538/poc/cell-sites/check.mjs --plant   # negative control: FAIL, exit 1
```

**What it showed, at `e337c7a2a` (2026-09-24).** PASS: 912 source files, 9 touch user-scoped keys.

| Class | Files |
|---|---|
| convergence | `engine/src/stores/scope-keys.ts` |
| derives, with the flow in hand | `engine/src/context/createExecutionContext.ts`, `engine/src/resources/internal.ts` (through `toIsolationFlow`), `engine/src/routes/state-routes.ts` |
| consumes a derived id | `engine/src/context/resource-registry.ts` |
| session and lineage only | `engine/src/routes/resource-routes.ts` |
| bypass | `scheduled/src/createResourceCollectionScheduleResolver.ts` (bare user id) |
| test harness | `testing/src/runtime/createTestContext.ts`, `testing/src/test-utilities/testFlow.ts` |

`--plant` adds one unclassified `content.get("user", …)` call and the check reported
`UNCLASSIFIED … derive=0 store=1`, exit 1. **The premise held**: three deriving files, all holding
the registered flow, and one production bypass that fails closed (it reads the person's own cell,
which no longer holds a seat's data).

Throwaway. Not wired into CI or any default discovery. A grep can miss a call written through an
alias; the typed guardrail in `PLAN.md` (the pin as a required key on the isolation shape) is what
catches those at build time.
