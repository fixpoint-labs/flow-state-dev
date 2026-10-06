# POC · a worker on a singleton flow, on today's Layer 1

An experiment retained as evidence for [FIX-1786](../../SPEC.md)'s
[D3](../../DECISIONS.md#d3). Not production code: nothing imports it, it has no package manifest,
and it is outside default build, test, lint and knip discovery ([specs/README.md](../../../../README.md)).

## The question

Can a singleton `agent` flow load a user-scoped worker through a server-set session link, and
drain a lineage-shared session board as that worker's owner, with nothing added to the engine?
The answer decides D3's third Layer 1 change, a worker link callers can't write.

**What would show the third change is NOT needed:** some shape built from today's parts refuses
every caller-written link, including one to another of the caller's own workers, and the link
can't outlive the session it was set on.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/epics/FIX-1786/poc/singleton-worker-link/run.sh
```

It runs on the real engine: `createFlowState` with in-memory stores, the real `/api/flows`
router for the caller's own session create, `runAction` for admitted requests, and the real
in-process dispatcher for the board's children. Nothing in the scope or store layer is stubbed.
Two verified headers stand in for a real sign-in.

## The flow

One singleton flow, `agent-poc`, in three shapes:

| Shape | Where the link lives | Where workers live |
|---|---|---|
| `state` | Session state, checked by a user-scoped read on every turn | User scope |
| `record` | A user-scoped row keyed by session id that only flow code writes; session state is ignored | User scope |
| `naive` · control | Session state | Org scope: today's org-locked hire |

`open` binds a session to a worker the caller can read, once. `message` runs as the linked
worker, writes to a `flowIsolation: true` memory resource, and puts a task on a session board
shared down the lineage, handed off to the same flow's `work` task entry. The task session gets
the worker id in the hand-off payload and reads the worker again at user scope.

## What was observed

On `b8e5f1531`: **12 passed**. Each assertion pins what is true today, so a change to the
engine shows up here as a red test.

| Leg | Question | Observed |
|---|---|---|
| P1 | Does the premise hold? | Yes, in both shapes. The door runs as `w1`. The task child is same-flow, alice's, parented to the door session and on its lineage; it reads `w1` at user scope and settles the row at the lineage address |
| X1 | Bob seeds or binds alice's `w1`? | Refused in both shapes: `worker "w1" is not readable by bob`. Nothing written |
| X2 | **Control:** workers at org scope | Bob's seeded link is honoured and he runs as alice's worker. The check X1 passes can fail |
| O1 | Alice seeds `w2` through the public create, in `state` | **Not refused.** `CreateSessionOptions.state` is persisted (`{ workerId: "w2" }`) and the door runs as `w2` with no bind. A seed that fails the schema is persisted raw, undeclared keys and all |
| O2 | The same seed, in `record` | Ignored: the session is unbound until `open`, and a second `open` to `w2` is refused. The public resource route can't write the row (403) |
| R1 | `record`: delete the session and recreate its id | The new session inherits the old link: `open` to `w2` is refused with `bound to "w1"`. Flow code sees `id`, `userId` and `orgId` on the session, not its lineage or creation time, so it can't tell the two apart |
| B1 | Bob in alice's session; the task entry over HTTP | `Session s_a belongs to another user`. The `work` entry isn't a public action (`does not define action "work"`, a 500 today rather than a 404) |
| I1 | Two of alice's workers write `flowIsolation: true` memory | **One cell.** It is keyed `(alice, agent-poc)` because a singleton's instance id is its kind; `w2` reads `w1`'s notes |
| I2 | A per-worker cell from today's hire, `(alice, w1)` | Not what the singleton reads. Moving to the singleton strands it |
| C1 | A coordinator flow's lineage board hands a row to the agent flow | The child roots its **own** lineage (cross-flow), resolves an empty ledger, runs nothing, and completes. The parent's row stays `in_progress`. A user-scoped ledger crosses flows today (`hand-off-cross-flow.test.ts`) |

## What it means

Superseded by [D3](../../DECISIONS.md#d3) and FIX-1788: the link is a server-only session field set at create.

- **The third Layer 1 change is needed.** Session state plus a user-scoped read stops other
  users (X1) but accepts a caller-seeded link to the caller's own other worker (O1). A row only
  flow code writes refuses that (O2) but outlives the session (R1). Neither holds ER-1.
- **A worker's private state needs its own key.** On a singleton, flow isolation separates flows,
  not workers (I1), and today's per-worker cells need a move (I2).
- **A lineage board stops at a flow boundary** (C1). A coordinator handing a row to an agent-flow
  worker crosses one every time, so that board can't use its lineage. The owner's user scope,
  suggested here, was struck in review: that ledger spans every session its owner has. ER-9 keeps
  each board its own and leaves how to FIX-1794.

Recorded in [DECISIONS.md → What the end-state POC showed](../../DECISIONS.md#what-the-end-state-poc-showed).

## What it doesn't cover

The real `agent` flow (`packages/workforce/src/agent-worker-flow.ts`), the skills library and
the memory package: the POC uses a plain `flowIsolation` resource as a stand-in for the drawer
they key the same way. Per-org user keys (FIX-1790). A real model.
