# POC · what actually blocks the roster and board panels

An experiment, not a supported API. Nothing here is imported by production code, and it is
outside default test, lint and knip discovery ([specs/README.md](../../../../README.md)).

## What it checks

The merged spec said the roster panel was blocked on the reference app carrying a credential,
because a session with no resolved identity takes whatever organization the caller sent. Both
halves of that turned out to be wrong, and the real wall is somewhere else. These two
experiments were written to make each half falsifiable rather than argued.

| File | The claim it makes falsifiable |
|---|---|
| `premise-proof.test.ts` | A session created with no resolved identity binds to the **default organization**, not to the one the caller asked for — and a caller cannot reach another organization's rows by asking for it |
| `read-gate-probe.test.ts` | What refuses the roster and the board is a **per-collection read permission**, identical for both, independent of any credential — and one declaration lifts it |

## How to run them

Neither file sits in a package, so each is copied into the package whose internals it drives
and run there. From the repository root:

```bash
cp specs/issues/FIX-1477/poc/read-gate/premise-proof.test.ts   packages/engine/test/zz-poc-premise.test.ts
cp specs/issues/FIX-1477/poc/read-gate/read-gate-probe.test.ts packages/workforce/test/zz-poc-gate.test.ts

(cd packages/engine    && ../../node_modules/.bin/vitest run test/zz-poc-premise.test.ts)
(cd packages/workforce && ../../node_modules/.bin/vitest run test/zz-poc-gate.test.ts)

rm packages/engine/test/zz-poc-premise.test.ts packages/workforce/test/zz-poc-gate.test.ts
```

## What was observed

Run against `main` at `0c076f9cb`. Both files green:

```
premise-proof      2 passed
read-gate-probe    3 passed
  ROSTER ->          403 {"error":"State read not permitted for \"roster\""}
  LEDGER DECL ->     {"hasClientKey":false,"client":null}
  BOARD ->           403 {"error":"State read not permitted for \"eng.feature.triage\""}
  ROSTER + OPT-IN -> 200 null
```

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
true } }` line, and it returns 200 where the first returns 403. Delete that line and the case
fails.

## Limits

- **In-memory stores and the router called directly.** No HTTP server, no browser, no
  persistence adapter. It settles what the route decides, not how a deployment is configured.
- **`premise-proof.test.ts` uses its own two flows**, not the reference app's. It proves the
  route's rule; it does not prove what the reference app's flow currently declares.
- **The 200 in the third case reads an empty organization.** It proves the door opens. It does
  not exercise a populated roster, cross-flow visibility, or pagination.
- **Nothing here says whether the rows *should* be readable.** That is
  [D4](../../DECISIONS.md#d4), which is a product call, answered separately.
