# Workforce POC lab A — factory / DM / group fan-out

Throwaway lab. Proves the Atlas lock on **today's** APIs: one-worker factory
bootstrap, a static DM via `create_session`, and a group post that wakes **N
subscriber sessions** (one session per subscriber). Never a Workforce package,
never a Channel / Team / MessageBoard L1.

**Do not merge this as product API.** Findings go on
[`fsd/workforce/pocs`](https://github.com/fixpoint-labs/agent-mailbox/pull/12).

## Run

```bash
pnpm --filter @flow-state-dev/workforce-poc-a test
pnpm --filter @flow-state-dev/workforce-poc-a demo
```

The demo prints JSON: factory identity, the DM session, N subscriber wakes, and
the cross-flow refuse.

## What the lock is

1. **Factory** reads `src/workers/clerk/` and emits one `defineFlow({ kind: "clerk" })`.
2. **DM** is `POST /api/flows/clerk/sessions` (`handleCreateSession`). The session *is* the DM.
3. **Group** is a user-scoped `flowIsolation` resource (the working set) plus N
   `create_session` rooms. `post` fans out with `dispatcher({ session: { id } })`
   once per subscriber. There is no shared group session.

Every hop is `dispatcher()`. `create_session` opens rooms; it is not a hop.

## Exists vs proposed

| Piece | Status | Where |
|---|---|---|
| `defineFlow` / four block kinds | exists | `@flow-state-dev/core` |
| `dispatcher({ type: "internal", session: { id } })` | exists | `packages/core/src/blocks/dispatcher.ts` |
| `session: { from: true }` reverse | exists | same file; engine stamp in `packages/engine/src/context/create-request-host.ts` |
| `create_session` | exists | `packages/engine/src/routes/session-routes.ts` (`handleCreateSession`) |
| `flowIsolation` user/org resources | exists | `packages/core/src/types/resource.ts` |
| `@flow-state-dev/workforce` `defineAgent` | exists | thin registry → a **generator**, not a worker flow |
| Factory that emits a flow | **proposed** | this lab only — not a package export |
| DM as a named static session | **proposed** | convention: bootstrap calls the route |
| Group as board + N sessions | **proposed** | convention: resource + N `{ id }` wakes |
| `seed-session` on `defineFlow` | **cut** | no such field; bootstrap calls the route |
| Shared / multiparty group session | **cut** | fan-out is N dispatches into N existing sessions |
| Channel / Team / MessageBoard L1 | **cut** | would be inventing substrate |
| Cross-flow `dispatcher()` | **missing** | refused today — see gap |

## Gap (stop — do not invent)

A group of **different worker flows** (clerk → editor) is the Atlas picture.
Today `{ id }` delivery is same-flow, same principal:

```
packages/engine/src/context/create-request-host.ts:179
  record.flowKind !== flow.kind → session-not-addressable
  "cross-flow delivery is not supported"
```

The lab's N-subscriber proof stays **same flow, same user**. That is enough to
lock "not one shared group session." Crossing a flow kind needs the Architect
cross-flow fence (already queued after #1587). This lab does not invent a
peer-edge, a route-resolver, or a second bus to fill the wait.

Same-principal is also load-bearing: another `userId` is `session-not-found`
(existence oracle, same file). A multi-human group is not today's `{ id }` door.

## What this is not

- Not Lab B (reply-storm / one claim). A wake is not a turn; this lab does not
  decide who answers.
- Not Lab C (plan = `taskBoard` + `readContent`).
- Not `#1569` / `#1587` reverse. `{ from: true }` is on main; this lab does not
  re-prove it.
- No changeset. Private lab. No `@flow-state-dev/workforce` import.
