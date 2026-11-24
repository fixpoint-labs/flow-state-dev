# FIX-2536 · Decisions

[Spec](SPEC.md) · **Decisions**

Three decisions and one owner fork are the sign-off.

## The tree

```mermaid
flowchart TD
  I["FIX-2536"] --> D1["D1 · one poll per user and thread · only that user's subscriptions"]
  D1 -.->|"rejected · one user's sessions fetch one thread N times"| X0["a poll per subscription"]
  D1 -.->|"rejected · A's credentials read what B then hears"| X1["the poll feeds the thread index's routing"]
  I --> D2["D2 · the mark holds at the oldest event not taken, not screened"]
  D2 -.->|"rejected · a second, unscreened path into delivery"| X2["move the mark every poll · a resend list"]
  D2 -.->|"rejected · breaks seen only when taken"| X3["write refusals into seen"]
  I --> D3["D3 · config seeds rows under stable ids · a cadence per row"]
  D3 -.->|"rejected · needs a cross-user ledger"| X4["sweep seeded rows at startup"]
  I --> QA["Q-A · open, owner · pushed subscriptions also poll slowly"]
```

Solid edges are what you sign; dashed edges lost, for the reason on the label.

<a name="d1"></a>
## D1 · One poll per user and thread (owner call, 2026-11-09)

| | |
|---|---|
| **Instead of** | A poll per subscription · the thread index's routing, which nominates every user |
| **Because** | Keyed by owner and thread: one user's sessions and routines on a PR share a fetch on that user's credentials (epic D5, D10), reaching only their enabled subscriptions through the same screens and `deliverToRow` (ER-4) |
| **Locks in** | Two users on one PR, two polls; a second door into delivery, on the index's rules. Live while the user has an enabled subscription there, at their fastest `everyMinutes` (D3) |

![D1: a poll per user and thread, chosen, beside a poll per subscription; decided by one user's two sessions](figures/d1-poll-per-user.svg)

It comes down to one user's two sessions on a PR: one fetch, not two.

**What would change my mind:** one App credential for all, one poll per thread;
`deliverToRow` already rechecks `canRead` per reader of a private event (`service-flow.ts` ~264).

<a name="d2"></a>
## D2 · The mark holds at the oldest event neither taken nor screened out (EM call, 2026-11-05)

| | |
|---|---|
| **Instead of** | Moving `polledThrough` every poll, with a 20-event resend list · writing refusals into `seen` |
| **Because** | A lost delivery is `unsent`, or accepted and never taken (`service-flow.ts` ~336–343). The poll row holds `polledThrough` and ETags. With the mark held, the next poll refetches it; each subscription's `seen` and `screened` drop the rest. One delivery path |
| **Locks in** | A refused or held version goes to its subscription's `screened`, never judged again. Cost: re-fetching while the mark waits for the user's slowest subscription. **Bounded:** one not taken after 3 polls is screened as given up, with a line in the session; `screened` caps at 500 |

![D2: hold the mark and record what was screened, chosen, beside a resend list; decided by a lost delivery](figures/d2-place.svg)

It comes down to a lost delivery: the resend list was a second path into delivery.

An unjudged screen (a Jev outage) writes nothing, so the next poll judges it. `screened` is
**not** FIX-2537 Q-A's verdict memo (epic D4).

**What would change my mind:** delivery resending what it gave back on its own.

<a name="d3"></a>
## D3 · Config seeds subscriptions, each with its cadence (owner call, 2026-11-08)

| | |
|---|---|
| **Instead of** | Only a model's `subscribe` call, at one cadence |
| **Because** | At startup each entry calls `subscribe`'s write, keyed `cfg_<hash of flow kind and entry id>`, only when missing or changed: a restart adds no row. A `cfg_` row whose entry left config ends at its poll row's next fire (`unsubscribe`'s write, `config_removed`). `sub_` rows are untouched |
| **The owner (EM call)** | Each entry names `owner: { userId, orgId }` and a `worker`, as server config (BP-031). The row lands in that user's shared cell, checked by `fireOwnerRunThrough`; it polls, and `canRead` checks, as the owner (D1) |
| **Cadence** | `everyMinutes` on `subscribe` or an entry: 5/10/15/20/30/60, else throws; default `poll.everyMinutes` |
| **Locks in** | A `cfg_` row its thread or session ended stays ended while its entry is unchanged (ER-5). Per FIX-2614, the seed targets `{sessionId, worker, taskId?}`, merges only config-owned fields, never re-enabling a paused routine |

![D3: config seeds, chosen, beside a model's subscribe; decided by a redeploy](figures/d3-config-seed.svg)

It comes down to a redeploy: a seed keyed by config id writes nothing new.

**What would change my mind:** a tenant owning config (tenants aren't polled in v1).

<a name="decided-not-asked"></a>
<details>
<summary><b>Decided, not asked</b> — engineering calls</summary>

## Decided, not asked

- **The cursor (EM, 2026-11-05; split, owner, 2026-11-09).** New fields optional (BP-030). `screened` prunes once the mark passes an entry. Kind and read refusals write
  `screened`. No ETag while the mark is held, so a `304` can't hide a retry.
- <a name="seam-2537"></a>**The FIX-2537 seam (#4809, EM call).** Judge-once holds via
  `screened`. **Left:** with push and poll on, a push refusal is judged once more; leg 3 counts it.
- **The tick (EM call).** One `scheduled` helper, Vercel's claim-and-dispatch, run each minute by
  `serve()` and so `fsdev dev`.
- **Per-repo batching: not built (EM call);** a row per user and thread already shares
  fetches. Batch when a user meets GitHub's secondary limit.
- **The row (epic D10).** `defineScheduleCollection` at `workforce/subscription-polls/*`, keyed by
  owner and thread, `onOverlap: "skip"`, offset by its key. `subscribe`'s write creates it; a fire
  finding no enabled subscription ends it. Not a subscription row (ER-5).
- **Also:** a due index is required; versions come from FIX-2535 (ER-8); tenants aren't polled.

</details>

## Considered and dropped

| Alternative | Why not |
|---|---|
| A startup sweep of seeded rows (D3) | Needs a cross-user ledger; each row's next fire checks it |

<a name="open"></a>
## Open

<a name="qa"></a>
### Q-A · Should subscriptions that push also poll, slowly, to catch what push lost?

- **In plain terms:** a pushed event lost in delivery never comes back.
- **The trade-off:** an hourly row and a tick, against a lost review never arriving.
- **My recommendation: yes, a small follow-up in this epic**, hourly, given a due index.
- **What would change my mind:** GitHub redelivering failed webhooks itself.
- **If wrong:** a PR stalls silently.

![Q-A: hourly catch-up for pushed apps, recommended, beside push only; decided by a lost review](figures/open-qa-catch-up.svg)

It comes down to a lost review: push never sends it again.

## Settled

None. Read: `service-flow.ts`, `subscribe.ts`, `owner-runs.ts`, `scope-keys.ts`.

## Analysis

2026-11-05 · **Right approach.** It composes; the open concern is Q-A.

## How it got here

- **Draft:** the mark moved every poll, with a resend list.
- **Fold (EM, 2026-11-05, #4811):** the held mark, `screened`, one tick.
- **Amend (owner, 2026-11-08):** D3; the allowed list holds the floor.
- **Amend (owner, 2026-11-09):** D1, "polls per user for now".
