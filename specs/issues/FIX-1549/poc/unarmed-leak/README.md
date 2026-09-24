# POC · what an unarmed registry lets another member read

Settles the review claim on [#2178](https://github.com/fixpoint-labs/flow-state-dev/pull/2178)
(Codex, `DECISIONS.md` D1): a registry that never registered Workforce's private roster writer
admits an overlapping collection, and that collection reads another member's hired-seat row.
Retained spec evidence, not production code: nothing imports it, it has no package manifest,
and `run.sh` copies the test into `packages/engine/test` for one run and removes it.

## How to run it

```bash
pnpm install                                   # once per checkout
pnpm --filter @flow-state-dev/core build       # engine resolves core's build
bash specs/issues/FIX-1549/poc/unarmed-leak/run.sh
PAT='[a]/[b]/[c]' bash specs/issues/FIX-1549/poc/unarmed-leak/run.sh   # control
```

## What it does

Alice's user-owned row, `workforce/roster/~alice/research`, is planted store-direct in org
`acme`, the way a row written by another process, an earlier deployment of the app, or another
app over the same store sits there. One flow declares an org-scoped, unbranded collection and
no private writer. The roster admission check is stubbed to a no-op, which is what the drafted
D1 does in a registry that has not seen the writer. Bob, in `acme`, runs an action that lists
the collection through `ctx.resources` and records what it saw. The flow goes through
`createFlowState` and the HTTP router.

## What was observed

On `01a9d43`:

| Pattern | Bob's list | Verdict |
|---|---|---|
| `[a]/[b]/[c]/[d]` | `workforce/roster/~alice/research = {"instructions":"ALICE-PRIVATE"}` | **leak**, test passes |
| `[a]/[b]/[c]` (control, cannot reach a user-owned row) | empty | test fails, as it should |

`[tenant]/**` listed nothing in this harness; `**` and `workforce/**` cannot be defined on
today's `main`, so they were not measured. One overlapping pattern reading the row is enough:
the handle only scopes the branded writer (`scopePrivateRosterToCaller` returns every other
handle unchanged) and `privateRosterAdmits` admits every key for any other collection.

**CONFIRMED.** Per-registry arming alone fails open wherever the writer is absent and the rows
are not. The redrafted D1 closes it by the key the row is stored under. After implementation,
running this POC with the stub still in place must show Bob an empty list.
