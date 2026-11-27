# FIX-2886 · All fires of one poll schedule run in one session

**Spec** · [Decisions](DECISIONS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens a service flow's poll in the DevTool** | Finds "One-off runs (580)": one empty session per fire, each one's Trace tab saying "No requests yet" | Finds one session per poll, with every fire in its request history |
| **runs a deployment that polls GitHub every 5 minutes** | Gets about 288 new session rows a day per poll, and nothing removes them | Gets one session per poll, whose history the service flow's retention caps at a day ([Decided, not asked](DECISIONS.md#decided-not-asked)) |
| **has a poll fire that is still running when the next one is due** | The next fire is skipped (`onOverlap: "skip"`), and it would have run in a session of its own anyway | The next fire is still skipped, before it reaches the session. The poll's mark lives in its schedule resource, so the fire after that catches up, as today |
| **is another signed-in user, and creates a session at someone's poll session id** | No such id exists to take | Is refused: the id carries a prefix only the scheduled dispatch may create or send to, so nobody can stop someone else's poll by holding its session first ([D1](DECISIONS.md#d1)) |
| **writes a schedule of their own** | Every fire is a one-off run, with no way to keep them together | Adds `session: "per-schedule"` and gets the poll's behaviour. Leaving it out keeps one-off runs, as today |

Webhook deliveries are unchanged: each still runs once, as a one-off run. The 581 empty sessions
already in the Teammates lab stay where they are; [D2](DECISIONS.md#d2) says why and who removes them.

## The goal, and how we'll know it's met

**Every fire of one poll schedule runs in one session that only the schedule can open, each fire's
request record names that session, the session's history is capped by retention, and a slow fire
never puts two runs in it.** The sessions the old behaviour left are not removed here ([D2](DECISIONS.md#d2)).

| Is it the right goal? | |
|---|---|
| **The real need** | From the mailbox request: "give a schedule a stable session, so a poll doesn't mint one per fire … so all fires for one poll share one session and retention can cap its request history." And: "poll history stays visible in the devtool" |
| **Smaller, and rejected** | "Poll fires run with no session at all" (Approach B). Poll runs would vanish from the DevTool, and it needs a no-session mode for actions that only views have today. Jake chose A |
| **Bigger, and not this issue's** | Removing one-off sessions that already exist, or that webhooks keep making ([FIX-2887](https://linear.app/fixpoint-labs/issue/FIX-2887)). A sessionless run losing its minted id on the request record ([FIX-2888](https://linear.app/fixpoint-labs/issue/FIX-2888), fixed in its own thread). Giving routine and task schedules the same option |
| **Not done if** | A poll fire still creates an `ephemeral_` session · two fires of one poll name different sessions, or two polls (other users, other threads) share one · a fire's request record names a session that has no row, or the session's request listing (what the DevTool's Trace tab reads) misses a fire · another user can create, send an action to, or read a poll's session, or anyone can retry, continue or resume a request in it · a fire that comes due while the last still runs runs beside it, or is lost rather than caught up by the next · the service flow declares no retention, or retention never runs on a completed fire's session · a schedule that does not opt in, or a webhook delivery, changes behaviour |

```mermaid
flowchart LR
  A["the polling goal app · polls firing every 5 minutes over SQLite"] --> T["80 minutes of fires"]
  T -->|"one session per poll · every fire names it · no one-off session"| P["PASS · goal met"]
  C["control · the poll resolver drops per-schedule"] -.-> T
  T -.->|"under the control"| F["must FAIL · a session per fire"]
```

The check counts sessions and request records in the store, after real fires through the
engine's tick and the dispatch endpoint.

| How we verify | |
|---|---|
| **Goal check** | `goals/webhook-routing/polls-each-event-once-without-a-webhook/`, amended · model `n/a` · run by the implementer at completion · verdict on the implementation PR |
| **Signal** | Every existing leg still passes. New **(m)**: for each poll schedule, every accepted fire's request record names one session; that session's row exists, belongs to the poll's user and flow, and its request listing (`GET …/sessions/:id/requests`, as the DevTool reads it) returns every accepted fire; no two polls share a session; and the store holds no `ephemeral_` session for the service flow except leg 3's pushed deliveries, one per pushed event the leg routes. New **(n)**: on leg 1, `bob` sends `POST /api/flows/<service flow>/sessions` with `alice`'s poll session id before her first fire, and an action to that id and a state read of it after; all three are refused, no session at that id belongs to bob, and alice's poll delivers as the oracle says. Also before her first fire, bob creates a session on a flow of his own with the id split across the tenant header (its part before the first `:` in `x-tenant-id`, the rest as `sessionId`; with a colon-free id, any split), and with `sessionId: "<tenant>:<id>"` and no header; both are refused or land on another key, and alice's poll still delivers. On leg 1, the fake provider fails one of alice's poll fetches once; alice's retry of that failed fire (`POST …/requests/:id/retry`) is refused, the session's listing marks it not retryable, and the next fire delivers what the failed one missed. New **(o)**: on leg 1, the fake provider holds one poll's answer past its next due beat; that beat's fire is answered `skipped`, the session never holds two running requests, and the held event and the next one are delivered once each, by the fires after |
| **Input** | The goal's existing fixture, legs and clock |
| **Anti-game** | Read sessions and requests from the store, not from a counter in the code under test. Floor each list with `tell.over`, so a run that read no sessions reads CAN'T TELL |
| **Control that must fail** | `GOAL_CONTROL=session-per-fire`: the service flow's poll resolver omits `session`. Must FAIL (m). `GOAL_CONTROL=no-reserve`: the engine skips the reserved-prefix check. Must FAIL (n), on the create. `GOAL_CONTROL=colon-id`: the schedule id is colon-joined. Must FAIL (n), on the split create. `GOAL_CONTROL=reentry-open`: re-entry skips its schedule-session check. Must FAIL (n), on the retry. `GOAL_CONTROL=overlap-allow`: the poll schedule is written with `onOverlap: "allow"`. Must FAIL (o). Today's `main` fails (m) |
| **Retention** | Not in the goal, which runs 80 simulated minutes against a one-day cap. A workforce test fires a service flow's poll through the real dispatch endpoint past a simulated day and reads that the older fires' requests are gone from the poll's session. It must fail with the flow's retention removed, and with the poll resolver's `session` removed (then each fire runs alone, and nothing is capped) |
| **What the goal reads but doesn't fix** | The id's exact spelling is the implementer's ([Decided, not asked](DECISIONS.md#decided-not-asked)). The goal checks that one id holds across a poll's fires, carries the reserved prefix, and differs between polls, without importing the code that derives it |

## What changes

![Before and after. Before, each fire of a poll schedule reaches the engine with no session, the engine mints an ephemeral session per fire, and nothing removes them. After, the poll's resolver marks the schedule per-schedule, the dispatch endpoint derives one reserved session id from the flow, the user and the schedule id, every fire runs in that session, and the service flow's retention caps its history at a day](figures/what-changes.svg)

A schedule can say where its fires run, and the subscription poll says one session per schedule.

```diff
  // A static schedule
  defineFlow({
    schedules: {
      static: {
        "nightly-digest": {
          cron: "0 2 * * *",
          block: digest,
+         session: "per-schedule",
        },
      },
    },
  });

  // A dynamic schedule, from a schedule collection
  schedules: {
    resolve: createResourceCollectionScheduleResolver({
      collection: polls,
      blocks: { [SUBSCRIPTION_POLL_HANDLER]: pollFire },
+     session: "per-schedule",
    }),
    index,
  },

  // The workforce service flow, which the app does not write
+ session: { retention: { maxAge: "24h" } },
```

`session` takes `"per-fire"` (the default, today's one-off run) or `"per-schedule"`. It is not
stored on a schedule row: the resolver sets it for every row it resolves, so a stored schedule
can't choose another user's session.

**Docs:** at release, `docs/server/scheduled.md` gains a section "Where a fire runs", after
"Overlap policy" (the two options, the reserved id, how overlap and retention apply);
`docs/server/schedule-index.md` names the resolver's `session` option; the `@flow-state-dev/scheduled`
README adds the option to the resolver's table. Contributor docs in the implementation PR:
`docs/architecture/scheduled-actions.md` (where a fire runs, and the reserved prefix beside the
write-session one). No new page.

```mermaid
sequenceDiagram
  participant Tick as schedule tick
  participant EP as dispatch endpoint
  participant Host as inbound host
  participant Run as runAction
  Tick->>EP: fire poll schedule
  EP->>EP: resolve, overlap skip, claim the time
  EP->>Host: envelope with the derived session id
  Host->>Host: reserved prefix, admitted only from the scheduled source
  Host->>Run: run in that session, created on the first fire
  Run->>Run: retention prunes the session's old fires
```

## What stays as it is

- A schedule with no `session`, static or dynamic: one one-off session per fire, byte for byte.
- Webhook deliveries in service flows: one-off runs. Webhook bindings keep their own `sessionId`.
- Overlap policy, the once-per-scheduled-time claim, the tick, the schedule index and every
  dispatch response code.
- The flow's concurrency policy (FIX-837). Its default (`allow`) is unchanged.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| **The job: pick the session a run from outside lands in.** Mechanisms `inbound-transport`, `webhook`, `schedule`, `dispatch`. Four ways do it today: the HTTP action body's `sessionId`; a webhook binding's `sessionId(event)` (`core/src/types/webhooks.ts`); the dispatcher's key-derived child session; and, for every run with none, the minted one-off session (`createExecutionContext.ts`, `ONE_OFF_SESSION_PREFIX`). The closest is the webhook binding's `sessionId`. Searched `sessionId` across `packages/scheduled/src` (none), `packages/engine/src/transports/`, and `core/src/types/{schedules,webhooks,flow}.ts` | **Adds** a fifth: a schedule option. It is a preset, not an id the author writes, for the reason [D1](DECISIONS.md#d1) gives |
| **The job: a session id the engine derives from who and what a run is for.** `owner-run:<org>:<user>:<flow>:<row>` and `service-route:<org>:<user>:<flow>` (`engine/src/durability/owner-runs.ts`), each part URL-encoded. The service flow's routing and deliveries already run in these | **Precedent for what the id names**, not its spelling: the schedule's id names the same parts but is colon-free, since a colon-joined id can be pre-claimed by splitting it across the tenant header. These two are not reserved and can be split, so the pre-claim hole D1 closes for schedules is open for them today: filed as [FIX-2889](https://linear.app/fixpoint-labs/issue/FIX-2889) |
| **The job: re-run a request someone owns.** Retry, continue and resume, gated by `isPublicReentryAllowed` (`routes/public-reentry.ts`), where `scheduled` is allowed | **Narrowed** for a schedule's session only: refused there, since a re-run would skip the overlap check and run beside a live fire ([Decided, not asked](DECISIONS.md#decided-not-asked)) |
| **The job: keep a client off an id the server owns.** `WRITE_SESSION_PREFIX` (`engine/src/resources/write-session-id.ts`), enforced in six places: the inbound host (`refuseReservedAddress`), the create and action routes, every other HTTP route (`reserved-addresses.ts`, which hides reads), the session listing and change notices | **Extended**: the schedule prefix joins the first three only, so its owner still lists and reads the session. A separate check beside `isWriteSessionId`, not a change to it. FIX-2889 can put the other two derived prefixes behind the same check |
| The `onOverlap` check in the dispatch endpoint (`transports/scheduled/routes.ts`) | **Kept**, and it is the answer to a slow fire: the next fire is skipped before it reaches the session |
| Session retention (`flow.session.retention`, `execution/retention.ts`, FIX-216) | **Used**: the service flow declares it. Retention runs per session, so it can cap one poll's history and never could cap one-offs. It also caps the flow's `service-route:` session, unbounded today ([Decided, not asked](DECISIONS.md#decided-not-asked)) |
| [FIX-1233](https://linear.app/fixpoint-labs/issue/FIX-1233) (canceled, no retained spec): a schedule that names a session and fires into it as a relay message | **Not revived.** That design sent into an existing conversation; this one keeps a schedule's own fires together. D1 keeps the two apart |
| [FIX-1739](https://linear.app/fixpoint-labs/issue/FIX-1739) (canceled when channels were removed): a caller pre-claiming a known session id and stopping a channel from opening | **The same hole, closed here before it opens**: a poll's id is computable, so it is reserved |
| [FIX-2888](https://linear.app/fixpoint-labs/issue/FIX-2888) (the mailbox's Issue 1): a sessionless run's request record loses the minted id | **Independent.** A per-schedule fire names its session before the request stub is claimed, so its record carries it with or without that fix |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `session: "per-fire" \| "per-schedule"` on a schedule and on `createResourceCollectionScheduleResolver` | A webhook binding's `sessionId` function, copied onto schedules | A free id can name any session, so every author must defend it against pre-claiming, and it becomes a second way to send into a conversation ([D1](DECISIONS.md#d1)) |
| A schedule session id, and its reserved prefix | The `owner-run:` / `service-route:` ids; the write-session prefix and its checks | **Composed**: the id names what the derived ids name, spelled colon-free like a write session id; the prefix is checked at three of the write prefix's six points (host, create route, action route) and before a dispatcher births a session in the request host |
| `session.retention` on the workforce service flow | None: the flow declares no session config today | Uses the existing retention option |

| The debt | |
|---|---|
| **Removes** | One session row per poll fire, going forward |
| **Adds** | A fifth way to pick a run's session, as a two-value preset. Permanent by design: it is the schedule's half of a job every transport has. One more reserved prefix, permanent by design, kept by the same checks as the first |
| **Leaves** | One-off sessions are never pruned, the 581 included ([FIX-2887](https://linear.app/fixpoint-labs/issue/FIX-2887)). Routine and task schedules on the roster flow still fire one-off; each is one line to change when someone wants it. The two existing derived session ids are not reserved ([FIX-2889](https://linear.app/fixpoint-labs/issue/FIX-2889)). `fsdev run` creates sessions without the reserved-prefix guard; it is a trusted local operator, so that stays |

**Net: flat.** A preset and a reserved prefix are added; a session per fire stops, which is a
storage win, not a code removal. The analysis found an existing hole of the same kind, filed, not
paid here.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** one reserved session per poll,
each fire's record naming it, history capped by retention. If wrong: polls still leave a session
per fire, or a poll's session can be taken by someone else.

**[The debt](#whats-already-here-and-the-debt), net flat:** a two-value schedule option and a
reserved prefix are added; nothing is removed from the code. If wrong: a fifth way to pick a
session that the next transport copies with a twist.

1. **[D1](DECISIONS.md#d1) · A schedule picks `session: "per-schedule"`, a framework-derived,
   reserved id, not a `sessionId` it writes.** The one to weigh: the mailbox request said
   "a sessionId hook". If wrong: the first schedule that must fire into a session of the author's
   choosing needs a new option.
2. **[D2](DECISIONS.md#d2) · The 581 existing empty sessions are left; FIX-2887 prunes one-off
   sessions for every source.** If wrong: the lab's DevTool keeps the old rows until FIX-2887
   ships, unless the lab deletes its database.

Feature · `core`, `engine`, `scheduled`, `workforce`, one goal · S (one option, one reserved
prefix, one flow setting) · independent of FIX-2888 · [Linear](https://linear.app/fixpoint-labs/issue/FIX-2886)
