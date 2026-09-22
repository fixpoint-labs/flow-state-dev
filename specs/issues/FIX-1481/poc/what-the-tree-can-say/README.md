# POC · what the tree can say today

A throwaway experiment retained as design evidence for [FIX-1481](../../SPEC.md). It is not
production code, not a workspace package, and is in no default build, test, lint or knip
discovery. Nothing imports it.

## What it checks

FIX-1481's three checklist rows each rest on a claim about what the DevTool *can* render. Those
claims were originally derived by reading source. This re-derives all three by running the real
modules and the real HTTP handlers, so the spec's factual base is executed rather than asserted
(BP-003).

| Check | The claim | How it is made falsifiable |
|---|---|---|
| 1 | A parked row's reason is in DevTool's model and on none of its columns | Parse the real row component; assert the **whole** header set, not the absence of one column |
| 2 | A sealed document and a mutable one are the same row in the debug tree | Build a flow holding both, call the real `debug/resources` handler, compare the entries field for field |
| 3 | The non-debug door cannot show them, and there are no inventory rows to show | Call the real `manifest` handler on the same flow; count `openInventory` call sites under `apps/` |

Each check carries a control that is **run**, not described:

- Check 1 plants an eighth column and asserts the totality check rejects it.
- Check 2 plants a `writable` field on one entry and asserts both assertions go red.
- Check 3 adds a resource that *does* declare a client surface and asserts it comes back — proof
  the check reaches the code it covers rather than returning zero because the call is broken.

## How to run it

```bash
pnpm install
pnpm exec tsx specs/issues/FIX-1481/poc/what-the-tree-can-say/run.mts
```

Add `POC_DUMP=1` to print the three debug entries verbatim. Exit code is 0 when every check and
every control behaves.

## What it showed

All twelve assertions pass on `0c076f9cb`. Three results are worth carrying into the spec:

**`feedback` is not parked-only, and that shapes the column.** Three verbs write it —
`awaitReview` (the park), `fail` (the retry patch, on a row that goes back to `pending`) and
`unpark` (which clears it unless given a new one). So a `pending` row can legitimately carry a
reason, and a park called with no feedback leaves an **earlier** one in place. Both are asserted
here, so a fourth writer appearing later fails the check rather than quietly changing what the
column means.

**Row 4 is a render, not a wire change.** `feedback` is already declared on DevTool's own mirror
of `Task` (`packages/devtool/src/react/lib/task-collection-state.ts`). The row's seven columns are
`Id · Goal · Status · Assignee · ChildSession · Latest kind · Details`, and the rendering module
never mentions the field. Nothing new has to reach the browser.

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

**Row 5's subject does not exist in the reference app.** The non-debug manifest returns zero
entries for all three resources, because it skips anything without a `client` config and neither
references nor the inventory collections declare one. And no app calls `openInventory`, so there
are no inventory rows for any door to serve.

## Limits

- **It imports `packages/*/src` directly**, including `referencesFromDocs`, which is internal to
  `@flow-state-dev/workforce`. That is a POC reaching past a package boundary; it proves what the
  engine does with a sealed config, not that the boundary is public.
- **The `ro`-grant seal is reproduced, not called.** `resolveSeatResources` needs a whole seat
  context, so the check applies the same two-field seal that `seat-resources.ts:529` applies. If
  that line changes shape, this stops tracking it.
- **It is not a live hired Workforce.** It proves what the handlers do with a flow built in
  process. Whether a seat *reads as a seat* in a browser against a running hire is still
  unverified — see [SPEC.md](../../SPEC.md) → "What we still have not seen".
