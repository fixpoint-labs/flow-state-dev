# FIX-1790 · key-sites — where a user key comes from, and which org each site has

**Question.** Does putting the org into the one key derivation reach every flow? The plan rests
on an enumerated fact: every production read and write of user-scoped storage takes its key from
`packages/engine/src/stores/scope-keys.ts`, and each such site already holds an org it can pass.

**What it does.** Scans every `packages/<pkg>/src` TypeScript file (tests and the store adapters
excluded) for key derivations and for user-scope or variable-scope store calls, and asserts that
every file with a hit is classified with its exact counts. A new site fails until someone
classifies it. Each site's org source is read from the code by hand and printed beside it.

**Run** (from the repo root, no install needed):

```bash
node specs/issues/FIX-1790/poc/key-sites/check.mjs           # PASS, exit 0
node specs/issues/FIX-1790/poc/key-sites/check.mjs --plant   # negative control: FAIL, exit 1
```

**What it showed, at `fbecfe6f2` (2026-10-06).** PASS: 1,044 source files, 9 touch user-scoped keys.

| Class | Files | The org it has |
|---|---|---|
| convergence | `engine/src/stores/scope-keys.ts` | takes it as an argument after S1 |
| derives | `engine/src/context/createExecutionContext.ts` | the admitted run's, required since FIX-1442 |
| derives | `engine/src/resources/internal.ts`, `engine/src/routes/state-routes.ts` | the stored session's |
| derives | `scheduled/src/createResourceCollectionScheduleResolver.ts` | **none** before the read: the schedule id names only the user |
| consumes | `engine/src/context/resource-registry.ts` | handed a derived id |
| session-only | `engine/src/routes/resource-routes.ts` | n/a |
| harness | `testing/src/runtime/createTestContext.ts`, `testing/src/test-utilities/testFlow.ts` | the harness org, but both seed the bare user id |

`--plant` adds one unclassified `content.get("user", …)` call; the check reported
`UNCLASSIFIED … derive=0 store=1` and exited 1.

**The premise held**, with one gap: the schedule resolver has no org until the dispatch names
one, which is plan surface S4. The two harness files bypass the derivation, which is S5. Same
nine files FIX-1538's `cell-sites` found; nothing new has appeared since.

**Re-run at implementation (2026-10-07).** Before the build: PASS, the same nine files. After
it: the check failed on two sites until the table was updated, which is what it is for.
`createExecutionContext.ts` derives four keys, not three (the user record is now created under
the session's org), and the harness gained `testing/src/internal/user-cell.ts`, the one place both
seeders call the derivation. Every site now passes an org; the schedule resolver takes it from the
dispatch id. Ten files, PASS; `--plant` still FAILS.

Retained design evidence. Not wired into CI or any default discovery. A grep can miss a call
written through an alias; the required org argument in S1 is what catches those at build time.
