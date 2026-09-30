# FIX-1084 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n). `tdd`, refactor shape: characterise first, then move code under green. One PR.

## Surfaces

| ID | Package · role | Change | Rules |
|---|---|---|---|
| S1 | `engine` · test | **Add** a parity characterisation test from [`poc/parity-today/`](poc/parity-today/README.md): per probe, the absolute address on each path, plus the conflicting-prefix case (execution refuses, HTTP answers). Land it green on today's code first | BR-1 to BR-5 |
| S2 | `engine` · `resources/lineage-scope.ts` | Export one session routing index built from a flow's resources: buckets (singles, prefixes in declaration order), whether anything is shared, and any prefix whose collections disagree on sharing. Export the flag predicate. The existing private walk becomes this | BR-4 BR-5 BR-7 |
| S3 | `engine` · `context/createExecutionContext.ts` | Session buckets come from S2. Throw the existing conflict error from S2's report. The session flag predicate is S2's. User and org keep `buildScopeBuckets` as is | BR-4 BR-7 BR-9 |
| S4 | `engine` · `createExecutionContext.ts`, optional | Session branches of the scope-kind and config-based scope-id resolution call the lineage-scope helpers, if clean (DECISIONS → Decided) | BR-1 |
| S5 | `docs/architecture/state-and-scopes.md` | Reconcile "Where resolution happens" per [DOCS.md](DOCS.md) | — |

Removed: execution's session-specific walk (its session call to `buildScopeBuckets` and its local
`sharedToLineage` predicate).

## Sequence

```mermaid
flowchart TD
  S1["S1 · parity test, green on main"] --> S2["S2 · the one session index"]
  S2 --> S3["S3 · execution builds session buckets from it"]
  S3 --> S4["S4 · optional collapse of the one-liners"]
  S3 --> VG["VG · planted divergence, both sides red"]
  S4 --> S5["S5 · architecture doc"]
  VG --> S5
```

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V0 | before S1 | The red state reproduces on the base commit: invert the collection-prefix flag in the HTTP walk, run the three lineage test files, and only HTTP-side tests fail. Record the counts, revert. If execution tests also fail, the base already changed: stop and re-read |
| V1 | S1 | Parity test green on the unchanged code |
| V2 | S3 | Conflicting-prefix flow: execution rejects with `/conflicting sharedToLineage/`; the HTTP helper returns the first declaration's address |
| V3 | S3, S4 | V1 still green; the three lineage test files unedited (`git diff --stat` on them is empty) and green; full `pnpm --filter @flow-state-dev/engine test` and `typecheck` green |
| VG | S3 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met): plant the V0 inversion in S2's index; at least one HTTP-side and one execution-side test fail (for example the broad-route get-state test and "shares collection instances across the lineage"). Revert. Quote both runs in the PR |
| V4 | S3 | `grep` shows one session declaration walk in engine source; `createExecutionContext` no longer reads `sharedToLineage` for bucket building |

## Pinned names

None. The issue's `sessionRoutingIndex` is a suggestion.

## Guardrails

| Rule | Because |
|---|---|
| Characterise before moving code, and never edit an existing lineage test | The issue's own scope line: a test that needs editing means the refactor overreached |
| Keep the prefix list in declaration order with duplicates | The HTTP tie-break on conflicting flows is first-declared-wins, and that is observable today (BR-4) |
| Execution still builds its buckets once per context | The HTTP helpers rebuild per call; copying that into execution would add a walk per key read |
| Throw only in execution | Refusing over HTTP too is a behaviour change, out of this issue |
| Keep the null-prototype map and canonical storage keys from the full session config map | An accessor named `__proto__` and unaliased singles (FIX-591) both depend on it |

## Docs

Reconcile [DOCS.md](DOCS.md) after V3; it is one internal architecture paragraph. No site docs.

## Sketch · pseudocode, illustrative

```
session routing index (flow resources):
    for each session-scoped declaration, in order:
        flag = declared shared to lineage
        collection  -> prefix list gets (pattern prefix + "/", or "" ; flag)
                       remember prefix -> flag; a second, different flag is a conflict
        single      -> singles gets (canonical storage key ; flag)
    return buckets, anything shared, conflicts

HTTP helpers:      index -> tie-break -> lineage or session        (unchanged shape)
execution context: index -> throw on conflict -> same tie-break    (session only)
```

**POC:** [`poc/parity-today/`](poc/parity-today/README.md). The premise held: 12/12 probes agree
and match the expected address; the flip control fails. It also produced the red state V0 repeats.

## At implement time

- Re-run V0 on the base commit. If another change has already unified the walk, stop and report.
- Check `docs/architecture/state-and-scopes.md` for edits since this spec; reconcile S5 against
  the current text.

## Follow-ups

- The user and org `flowIsolation` buckets are still built by a loop shaped like the session one.
  No HTTP per-key twin, so no split-brain, but a generic walk would remove it. Out of the fence;
  `improve-codebase-architecture`.
- `sessionResourceScopeId` has no callers today (per the architecture doc). S4 may give it one; if
  not, it is dead code to mention, not delete, here.
- Conflicting-prefix collections could be refused when the flow is defined, so HTTP and execution
  refuse together. A behaviour change; its own issue.
