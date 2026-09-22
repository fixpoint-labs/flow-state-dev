# POC · what actually blocks the roster and board panels

An experiment, not a supported API. Nothing here is imported by production code, and it is
outside default test, lint and knip discovery ([specs/README.md](../../../../README.md)).

## What it checks

The merged spec said the roster panel was blocked on the reference app carrying a credential,
because a session with no resolved identity takes whatever organization the caller sent. These
two experiments were written to make that falsifiable rather than argued.

**Its premise is refuted; its conclusion is not.** A caller never chooses the organization — that
half is dead. But a session with no resolved identity binds to the *default* organization, so
wherever admin tokens put hires under a real one, the shell must still resolve a viewer principal
and carry its credential or the panel renders correct and empty. That requirement is real, and
`S8` cannot satisfy it in this repository — there is no credential here that represents a viewer,
so it is blocked on [FIX-1503](https://linear.app/fixpoint-labs/issue/FIX-1503) and ships as a
documented limit ([PLAN.md → Blocked on](../../PLAN.md#blocked-on)).
[V13](../../PLAN.md#checks) pins the org-binding mechanism, not a production credential. What the refutation actually moved is the **wall**: a
per-collection read permission, which stops both panels with or without a credential.

| File | The claim it makes falsifiable |
|---|---|
| `premise-proof.test.ts` | A session created with no resolved identity binds to the **default organization**, not to the one the caller asked for — and a caller cannot reach another organization's rows by asking for it |
| `read-gate-probe.test.ts` | What refuses the roster and the board is a **per-collection read permission**, identical for both, independent of any credential — and one declaration lifts it |

## How to run them

Neither file sits in a package, so both are copied into `packages/engine/test` and run there.
They import `@flow-state-dev/*` by package name; `read-gate-probe` additionally reaches into
`workforce`'s source for the two declarations under test. From the repository root:

```bash
cp specs/issues/FIX-1477/poc/read-gate/premise-proof.test.ts   packages/engine/test/zz-poc-premise.test.ts
cp specs/issues/FIX-1477/poc/read-gate/read-gate-probe.test.ts packages/engine/test/zz-poc-gate.test.ts

(cd packages/engine && ../../node_modules/.bin/vitest run test/zz-poc-premise.test.ts test/zz-poc-gate.test.ts)

rm packages/engine/test/zz-poc-premise.test.ts packages/engine/test/zz-poc-gate.test.ts
```

**Both run from `engine`, including the one that reads `workforce`'s declarations.** The thing
under test is an engine route, both files drive that router directly, and engine is where its
imports resolve without ceremony.

One local snag, recorded so the next reader does not re-derive it: built the way this probe
builds — `createFlowApiRouter` over `createInMemoryStores` — a seeded block did not execute when
the file lived in `packages/workforce`, though the identical file ran from `packages/engine`.
That is a property of how *this* probe constructs the runtime, **not** of the package.
`packages/workforce/test/cross-org-collection-read.test.ts` builds through `createFlowState` and
seeds through the action path from that package perfectly well — it is the working
counter-example, and the better model to copy if you need one there. It lives on
[#2036](https://github.com/fixpoint-labs/flow-state-dev/pull/2036)'s branch, not on `main`, so
look for it there.

## What was observed

Run against `main` at `119661150`. Both files green:

```
premise-proof        2 passed
read-gate-probe      3 passed
  ROSTER LIST ->            403 {"error":"State read not permitted for \"roster\""}
  BOARD LIST ->             403 {"error":"State read not permitted for \"eng.feature.triage\""}
  ROSTER LIST + OPT-IN ->   200 {"items":[{"topic":"support.ada",
                                "storageKey":"workforce/roster/support.ada",
                                "clientData":{"seatId":"support.ada","flow":"support-agent",
                                              "settings":{},"instructions":null}}]}
```

Three things in that last line are the point. It is the **list** route, which is what the panels
use. It returns a **seeded row**, so the 200 is not an empty success. And the row comes back
**whole** — every field of the stored record — which is the bare-opt-in hazard
[D4](../../DECISIONS.md#d4) warns about, visible here rather than argued.

That the board ledger declares no `client` config is **asserted**, not printed — it is half of
what the second case claims, so it has to be able to fail by itself.

**The red state, which is the part that makes green mean anything.** In
`premise-proof.test.ts`, the shell plants nothing under `victim-org` and sees nothing from it,
while asking for `victim-org` in the session-create body, in the action body, and in two
headers. Reverting one line — `packages/engine/src/routes/session-routes.ts:235`, back to the
`ctx.principal === undefined ? getString(body.orgId) : …` expression the merged spec quoted —
flips **both** assertions red: the stored session binds to `victim-org`, and the shell then
runs under `victim-org`. That is the behaviour the spec described. FIX-1442 replaced it, and
the line's own comment now says `body.orgId` is deliberately not consulted, at all.

In `read-gate-probe.test.ts` the red state is built in and needs no edit: the third case is
the same collection shape as the first, differing by the single `client: { state: { read:
true } }` line, and it returns 200 where the first returns 403. Commenting that one line out
was run, and turns it red — `ROSTER LIST + OPT-IN -> 403`, `expected 403 to be 200`. The other
two assertions have their own: assigning a `client` config onto the ledger turns the
declaration check red (`expected true to be false`) without touching the engine, and the
seeded-row assertion fails on an empty list (`expected [] to have a length of 1`) — which it
did, twice, while this probe was being written.

## Limits

- **In-memory stores and the router called directly.** No HTTP server, no browser, no
  persistence adapter. It settles what the route decides, not how a deployment is configured.
- **`premise-proof.test.ts` uses its own two flows**, not the reference app's. It proves the
  route's rule; it does not prove what the reference app's flow currently declares.
- **One row, one flow, one organization.** The third case proves the list route returns a
  seeded row. It does not exercise cross-flow visibility, pagination, or a second organization.
- **Every session here binds to the default organization**, because nothing authenticates
  anybody. So these prove a session cannot read the **wrong** organization; they do **not**
  prove the shell reads the **right** one in a deployment that has real organizations. That
  binding requirement is [PLAN.md → Blocked on](../../PLAN.md#blocked-on), not something this
  POC settles.
- **Nothing here says whether the rows *should* be readable.** That is
  [D4](../../DECISIONS.md#d4), which is a product call, answered separately.
