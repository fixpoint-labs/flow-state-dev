# POC · do the two copies of the session-shared-key rule agree today?

Throwaway design evidence for [FIX-1084](../../SPEC.md). Not production code, not a workspace
package, in no default build, test, lint or knip discovery. Nothing outside this folder imports it.

## The question

The desk's rule for this refactor: if the HTTP copy and the execution copy of the rule differ in
any observable way today, that is a bug to escalate, not a refactor to do. So before specifying
one rule, check the two copies resolve every declaration shape to the same address.

## How to run it

```bash
pnpm exec tsx specs/issues/FIX-1084/poc/parity-today/check.mts                     # PASS, exit 0
POC_CONTROL=flip pnpm exec tsx specs/issues/FIX-1084/poc/parity-today/check.mts    # must FAIL, exit 1
```

No key, no model. Uses the repo's own `pnpm install`.

## What it does

For each of 7 declaration shapes, a child session of a lineage holds two rows for the same key,
one marked `SESSION` at its own address and one marked `LINEAGE` at the lineage address.
Execution reads the key through `ctx.resources`, and the marker it gets back is the address it
routed to. The HTTP side answers through `sessionKeyScopeId` + `sessionStorageScope`, the helpers
the resource routes call. Each probe must match on both sides **and** match the expected address.

## What it showed (2026-09-30, `main` at `8de98a317`)

- **12/12 probes agree**, and each matches its expected address: shared and private singles, an
  unaliased single, static-prefix collections, a private prefix nested under a shared one in both
  declaration orders, an empty-prefix shared collection beside a private single, two collections
  on one prefix with the same flag.
- **Control:** `POC_CONTROL=flip` inverts one HTTP answer, and the check fails naming that probe.
- **One asymmetry, not a divergence:** two collections on one prefix with *conflicting* flags.
  Execution refuses the flow outright; the HTTP helpers still answer (declaration order breaks
  the tie). Execution never produces an address for such a flow, so there is nothing to disagree
  with. The refactor preserves both halves (BR-4).
  This script logs that case and does not gate it, on purpose: the engine test (PLAN → V2, BR-4)
  owns "execution refuses, HTTP answers".

## The red state (recorded, not scripted)

On the same commit, inverting the flag on collection prefixes in the HTTP copy of the walk
(`sessionOwnership` in `packages/engine/src/resources/lineage-scope.ts`) and running the three
lineage test files gave **6 failed, 19 passed**. Every failure was an HTTP route or whole-scope
read; every execution-path test (eager bucket scans, `ctx.resources` across a lineage) stayed
green. That is the duplication, made visible: the edit landed in one path only. After FIX-1084
the same edit must redden both.
