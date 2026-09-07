# Workforce POC lab F — team intake

Throwaway lab. Proves Atlas §10 on **today's** APIs: address-the-team is a
roster intake worker with a static DM, not a TeamFlow. Intake routes with
claim / ordered-reply / fan-out on `dispatcher()` + `taskBoard`. Never a
Team / Channel / MessageBoard L1, never a Workforce package export.

**Do not merge this as product API.** Findings go on
[`fsd/workforce/pocs`](https://github.com/fixpoint-labs/agent-mailbox/pull/12).

## Run

```bash
pnpm --filter @flow-state-dev/workforce-poc-f test
pnpm --filter @flow-state-dev/workforce-poc-f demo
```

The demo prints JSON: two roster inboxes, a claim that lands on `dm-alice`,
an ordered chain (bob blocked until alice completes), fan-out task ids, and
the cross-flow refuse.

## What the lock is

1. **Intake is a worker.** One `defineFlow({ kind: "intake" })`. Not a
   `TeamFlow`. Not a field on Agent.
2. **Address-the-team** is that worker's static DM. `openTeamInbox({ roster })`
   looks up the intake seat, then `create_session` opens `talk-to-eng`.
   Helpers take a roster key. Engineering and marketing are two keys, two
   sessions.
3. **Routing is L2 on today's board.** A message to the intake session files
   rows on a user-scoped `defineTaskCollection` + `taskBoard`. Members pick
   them up from their own DMs via `TaskCollectionRef.claim` — the same CAS
   Lab B used. Ordered replies are `task.deps`; `isClaimable` already waits.

Every hop that *delivers* is `dispatcher()`. Filing a task is not a hop.

## Exists vs proposed

| Piece | Status | Where |
|---|---|---|
| `defineFlow` / four block kinds | exists | `@flow-state-dev/core` |
| `create_session` | exists | `packages/engine/src/routes/session-routes.ts` |
| `dispatcher({ session: { id } })` | exists | `packages/core/src/blocks/dispatcher.ts` |
| `taskBoard` + `defineTaskCollection` | exists | `@flow-state-dev/orchestration` |
| `TaskCollectionRef.claim` + `task.deps` | exists | same; `isClaimable` waits on deps |
| Keyed roster + intake seat | **proposed** | this lab only — not a package export |
| `openTeamInbox({ roster })` | **proposed** | lookup + `create_session` of the intake seat |
| `fileOrderedReplies` | **proposed** | `addTask` with `deps`; no new sequencer |
| TeamFlow / team address type | **cut** | address stays a session id |
| Channel / Team / MessageBoard L1 | **cut** | would be inventing substrate |
| Cross-flow `dispatcher()` into a member worker | **missing** | refused today — see gap |

## Gap (stop — do not invent)

Intake and members are **different worker flows**. A message to `talk-to-eng`
can file work the member later claims. It cannot `dispatcher({ id: "dm-alice" })`
from the intake flow:

```
packages/engine/src/context/create-request-host.ts
  record.flowKind !== flow.kind → session-not-addressable
  "cross-flow delivery is not supported"
```

That is gap 4 / [#1600](https://github.com/fixpoint-labs/flow-state-dev/pull/1600).
Same-flow N-session fan-out already holds (Lab A). This lab does not invent a
second dispatch model, a TeamFlow, or a peer-edge to hide the refuse.

Two intake seats of the same kind (`talk-to-eng` / `talk-to-mkt`) share the
`intake` flow. Session id distinguishes them. Per-seat identity is gap 1
(FIX-1315) — named, not invented around.

## What this is not

- Not Lab A (factory / same-flow group fan-out).
- Not Lab B (reply-storm / who may reply). Claim is reused, not re-proved.
- Not Lab C (plan = board + content).
- Not a Team type, not `createWorkforceCapability` (that stub is not this).
- No changeset. Private lab. No `@flow-state-dev/workforce` import.
