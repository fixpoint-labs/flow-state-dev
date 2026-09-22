# POC · what the tree can say today

A throwaway experiment retained as design evidence for [FIX-1481](../../SPEC.md). It is not
production code, not a workspace package, and is in no default build, test, lint or knip
discovery. Nothing imports it.

## What it checks

FIX-1481's three checklist rows each rest on a claim about what the DevTool *can* render. Those
claims were originally derived by reading source. This re-derives all three by running the real
modules and the real HTTP handlers, so the spec's factual base is executed rather than asserted
(BP-003).

| Check | Row | The claim | How it is made falsifiable |
|---|---|---|---|
| 1 | 4 | What a reason on the row will *mean*: exactly three task verbs write the field, and a park with no reason does not clear an earlier one | Slice the real task collection into its verb bodies and assert the **whole** writer set, not one sampled verb |
| 2 | 6 | A sealed document and a mutable one are the same row in the debug tree | Build a flow holding both, call the real `debug/resources` handler, compare the entries field for field |
| 2b | 6 | The mark has to be the **seal** (`writable === false`), not the agent manifest's write gate | Mint both halves of the `references/` vs `resources/` split with their real conventions and run both candidate predicates over them |
| 3 | 5 | The non-debug door cannot show them, and there are no inventory rows to show | Call the real `manifest` handler on the same flow; count `openInventory` call sites under `apps/` |

Each check carries a control that is **run**, not described:

- Check 1 plants a fourth writer and asserts the totality check rejects it.
- Check 2 plants a `writable` field on one entry and asserts both assertions go red.
- Checks 2b and 3 assert that something says *no* — a predicate declines, a door returns nothing —
  so their controls prove each can say *yes* when handed something it should accept, rather than
  passing because the call is broken.

### What this deliberately does not check

**Nothing here asserts anything about the view.** An earlier version asserted the task row's seven
column headers and the absence of `feedback` in the rendering module. Both describe *today*, and
PR-A's entire job is to add a column and render that field — so they were built to go red the
moment the work they justify succeeded. A retained check that fails when the work succeeds is
worse than no check: somebody has to decide, later and without context, whether the red is a
regression or the plan working.

They are cites below instead. The rule that kept checks 1's survivors and dropped these is
[FIX-817's `V7`](../../../FIX-817/PLAN.md): a totality check earns retention when its expectation
can be updated and still assert something. "Seven columns" becomes "eight columns", which is what
`PLAN.md`'s `V1` already checks — so retaining it duplicates a CI check in a spec artifact. The
writer set does not move when a view changes, so it stays.

## How to run it

```bash
pnpm install
pnpm exec tsx specs/issues/FIX-1481/poc/what-the-tree-can-say/run.mts
```

Add `POC_DUMP=1` to print the three debug entries verbatim. Exit code is 0 when every check and
every control behaves.

## What it showed

All fourteen assertions pass on `0c076f9cb`. Three results are worth carrying into the spec:

**Row 4's starting state, as `file:line` cites rather than assertions.** All three read on
`0c076f9cb`, and all three are things PR-A is expected to change or depend on:

- **The row has seven columns, none of them the reason** —
  `packages/devtool/src/react/components/workspace/task-collections-view.tsx:134-140`:
  `Id · Goal · Status · Assignee · ChildSession · Latest kind · Details`.
- **The rendering module never mentions the field** — no match for `feedback` in that file
  (357 lines). The reason is reachable only through the per-row `view` JSON expander.
- **DevTool's own mirror of `Task` already declares it** —
  `packages/devtool/src/react/lib/task-collection-state.ts:94`, `feedback?: string`. This is the
  one that sizes the work: nothing new has to cross the wire, so row 4 is a render.

**`feedback` is not parked-only, and that shapes the column.** Three verbs write it —
`awaitReview` (the park), `fail` (the retry patch, on a row that goes back to `pending`) and
`unpark` (which clears it unless given a new one). So a `pending` row can legitimately carry a
reason, and a park called with no feedback leaves an **earlier** one in place. Both are asserted
here, so a fourth writer appearing later fails the check rather than quietly changing what the
column means.

**Row 6 is worse than "unrendered", and the seal has two producers.** The three entries come back
identical apart from `definitionId`, `aliases` and `primaryName`:

```json
{ "scope": "org", "isCollection": false, "state": null, "clientView": null,
  "hasContent": false, "contentVisibleToClient": false,
  "clientConfig": { "hasClient": false, "data": false, "stateRead": false,
                    "contentRead": false, "prefetchWindow": null } }
```

No field of any entry speaks about writability. And the sealed pair were minted two different
ways — one by the `references/` convention, one by a seat's `ro` grant — which both land on
`{ writable: false, llmWritable: false }`. A badge derived from "is it a reference" would be
right about half the sealed documents in the tree.

**Which predicate the mark may be, settled by running both.** A review round proposed marking on
`!mayWrite`, reusing the agent manifest's predicate
(`core/src/manifest/resources-source.ts:50`) so the tree and the manifest could not disagree. The
reasoning was sound and the result would have broken the row:

| what it is | `writable` | `llmWritable` | `!mayWrite` | `writable === false` |
|---|---|---|---|---|
| a `references/` document — **sealed** | `false` | `false` | READ-ONLY | READ-ONLY |
| a `resources/` document — **mutable** | *unset* | *unset* | **READ-ONLY** | — |
| `defineResource`, no flags | *unset* | *unset* | **READ-ONLY** | — |
| `defineResource`, `llmWritable: true` | *unset* | `true` | — | — |

Row two is the failure: `llmWritable` is opt-in, so `!mayWrite` marks the mutable `resources/`
document — the exact one row 6 exists to distinguish from the reference above it. The two
predicates answer different questions, *may the agent write* against *can this be written at
all*, and check 2b keeps that result runnable rather than remembered.

**Row 5's subject does not exist in the reference app.** The non-debug manifest returns zero
entries for all three resources, because it skips anything without a `client` config and neither
references nor the inventory collections declare one. And no app calls `openInventory`, so there
are no inventory rows for any door to serve.

## Limits

- **It imports `packages/*/src` directly**, including `referencesFromDocs` and
  `resourcesFromDocs`, which are internal to `@flow-state-dev/workforce`. That is a POC reaching past a package boundary; it proves what the
  engine does with a sealed config, not that the boundary is public.
- **The `ro`-grant seal is reproduced, not called.** `resolveSeatResources` needs a whole seat
  context, so the check applies the same two-field seal that `seat-resources.ts:529` applies. If
  that line changes shape, this stops tracking it.
- **It is not a live hired Workforce.** It proves what the handlers do with a flow built in
  process. Whether a seat *reads as a seat* in a browser against a running hire is still
  unverified — see [SPEC.md](../../SPEC.md) → "What we still have not seen".
