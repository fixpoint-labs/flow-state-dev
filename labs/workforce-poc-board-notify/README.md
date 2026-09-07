# Workforce POC — static board notify (FIX-1311)

Throwaway lab. Proves a message-board **notify** path on today's APIs: a
topic-scoped collection, subscribers in collection state, `reactTo` fan-out
through a **router over declared dispatchers**. No Workforce package. No
TeamFlow / MessageBoard L1. No dynamic `dispatcher()` from string data.

**Do not merge this as product API.** Findings go on
[`fsd/workforce/pocs`](https://github.com/fixpoint-labs/agent-mailbox/pull/12).

## Run

```bash
pnpm --filter @flow-state-dev/workforce-poc-board-notify test
pnpm --filter @flow-state-dev/workforce-poc-board-notify demo
```

## What was proved

1. A board is a `defineResourceCollection({ pattern: "boards/*", scope: "user" })`.
   Topic is the instance key. Subscribers live in instance state, including
   documentary `flow` / `sessionId` / `entry` fields.
2. A new thread row fires `reactTo.stateUpdated`. The bound sequencer iterates
   subscribers and dispatches fire-and-forget through `notify-alice` /
   `notify-bob` — both declared at `defineFlow` time, both targeting
   `internal.actions.onNotify`.
3. A stored `entry: "invented-from-data"` does **not** change the hop. The
   fence is `packages/core/src/types/dispatch.ts`:

   > A target chosen from data is a router over declared dispatchers, not a
   > dynamic address.

4. Same-flow only. Another flow kind is `session-not-addressable` at
   `packages/engine/src/context/create-request-host.ts:179`. This lab does
   not invent a second bus. Cross-flow waits on #1600.
5. Existing-session create is still 409 (FIX-1246). Not papered over.
6. Prune on `no-entry` / `session-not-found` only. Never on
   `dispatch-rejected` (classifier; the live hop did not produce that
   refusal — see below). Never on `session-not-addressable` until that
   refusal is split.

Same-session notify from `reactTo` **lands**. A poster who is also a
subscriber gets `onNotify` in their own session. `concurrency: "reject"`
on the entry does not treat the originating turn as a competing holder.
Do not read that as `dispatch-rejected`, and do not prune it.

## What was faked with static targets

Seats are a closed enum (`alice` | `bob`). A subscription **selects among**
those two declared dispatchers. Session id still comes from subscriber data
(`session: { id: (input) => input.sessionId }`) — that is today's existing
door, not a new address kind. A roster that names an arbitrary entry from
state still cannot become a dispatcher.

`no-entry` is untestable as a runtime prune under static addresses:
`defineFlow` refuses a dispatcher whose target is missing. The classifier
covers it; the live hop cannot name a dangling entry.

## What still needs substrate

| Gap | Why this lab cannot close it |
|---|---|
| Dynamic addresses / addresses-as-data | A subscriber's `entry` is data. Using it as `dispatcher({ target })` is the thing the fence forbids. |
| Flow instances / multi-hire same-kind | FIX-1320–1323. One flow, two seats, session id distinguishes them. |
| Cross-flow conversation | #1600. `flowKind !== flow.kind` → `session-not-addressable`. |
| Housekeeper CAS on the brief | Two concurrent posts can each rewrite the brief. Needs the collection's version CAS — do not invent a store. Design-note only. |
| Teams / TeamFlow | FIX-1310. Out of scope. |

## Brief / thread

Cheap split: `brief` is a current-state string, `thread` is append-only.
`post` may set the brief in the same write. No housekeeper job.

## What this is not

- Not Lab A (factory / DM / group fan-out from a `post` sequencer).
- Not Lab B (claim / reply-storm).
- Not FIX-957 / `materializeAgent` / FIX-796.
- No changeset. Private lab.
