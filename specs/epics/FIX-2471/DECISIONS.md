# FIX-2471 · Decisions

[Spec](SPEC.md) · **Decisions**

Three calls are the sign-off surface: D1, and D5 and D9 as the EM amended them on 2026-11-03.
Four forks are [open](#open). The rest were decided earlier and sit in the collapsed block, so no
child reopens them.

## The tree

```mermaid
flowchart TD
  E["FIX-2471"] --> D1["D1 · one service flow per provider routes, in code"]
  D1 -.->|"rejected · tokens per event per agent"| X1["an LLM router reads every event"]
  E --> D5["D5 · a subscription is its user's; a user hears only what they can read"]
  D5 -.->|"rejected · content crosses users"| X5["one app token at org scope"]
  E --> D9["D9 · delivery is sendMessage's exempt path, labelled"]
  D9 -.->|"rejected · two sets of recipient rules"| X9["a new sender kind"]
  E --> O["open · Q1 screening default · Q3 what observe writes · Q4 Slack · Q5 sessionId's scope"]
  E --> G["decided earlier · D2–D4, D6–D8, D10, D11"]
```

<a name="d1"></a>
## D1 · One service flow per provider is the single routing point, and it routes in code · owner, 2026-11-01

| | |
|---|---|
| **Instead of** | DeepSeek's LLM router that sees every event · a binding per app that names a session |
| **Because** | Most deliveries are a lookup. DeepSeek spends tokens per event per agent: without pass-through, 31.8M cache-read tokens against 23.2M with it |
| **Locks in** | The flow routes and never decides new work ([D8](#d8)). One per provider, mounted by the app |

**What would change my mind:** the kill line. If config screens decide under half the deliveries, a
coordinator with a filter is cheaper, and the epic stops.

![D1: a service flow in code, chosen, beside an LLM router; decided by cost as sessions multiply](figures/d1-code-routes.svg)

It comes down to cost as sessions multiply: the router's spend grows with every event.

<a name="d5"></a>
## D5 · A subscription is a user-scoped resource, and a user hears only what they can read · owner, 2026-11-02; credentials rule, EM, 2026-11-03

| | |
|---|---|
| **Instead of** | Org scope on one app token · session state on each subscriber, which the flow can't query |
| **Because** | It runs on its user's credentials (owner). So it names only a thread its user can read, checked with their credentials at subscribe; an event fans out only to users who can read its thread; a poll runs under one subscriber's token and reaches only users who can read the thread. Still one Jev call per event, and no verdict or interest sentence reaches another user ([ER-4](#who-owns-what)) |
| **Locks in** | `subscribe` and `unsubscribe`, the service flow's tools, are the only writers, so FIX-2056's five-tool bar holds. A task's subscription ends with it. A coding task is subscribed to its PR when it opens (owner) |

![D5: the user's credentials, chosen, beside one app token; decided by a private repo](figures/d5-user-scoped.svg)

It comes down to a private repo: on one app token, its content reaches a user who can't read it.

<a name="d9"></a>
## D9 · Delivery is `sendMessage`'s exempt path, with a server-set source label · owner, 2026-11-02; mechanism, EM, 2026-11-03

| | |
|---|---|
| **Instead of** | A new sender kind, `service:<flowKind>`, with its own budget · a system worker on the roster |
| **Because** | The `exempt` path (`send-message.ts` ~249) already skips the hop budget and takes a crash-safe `id`. New: a server-set source label where the worker id sits, so no `not_a_worker` refusal (~289); a check that the session is the subscription's user's; a cap per subscription per window, distinct from `hop.ts`. The id is `<object>@<version>:<session>` ([D4](#d4)) |
| **Locks in** | The owner's intent: no roster worker, one messaging API, its own budget, the service shown as sender. FIX-2070 edits the same function ([seam](#coordination-seams)) |

![D9: the exempt path, chosen, beside a new sender kind; decided by where recipient rules live](figures/d9-exempt-sender.svg)

It comes down to where recipient rules live: a second sender kind keeps a second copy in step.

<a name="open"></a>
## Open

Q2, the screen contract, is drafted in child 1, which ships config screens and the seam, and is
approved at its spec gate.

<a name="q1"></a>
### Q1 · Fail closed or fail open: who gets through a screen by default?

- **In plain terms:** does a coding task hear an outsider's comment on a public repo? Child 1
  ships the sender check, so it is decided here.
- **The trade-off:** fail open puts unscreened outside text into a coding task's context.
- **My recommendation: fail closed.** Org members, repo collaborators and the app's listed bots
  pass; outsiders are refused unless the subscription opts in.
- **What would change my mind:** an app whose core job is triaging outsiders' issues. Its answer
  is one line, the opt-in.
- **If wrong:** that app hears nothing until it opts in.

![Q1: fail closed, recommended, beside fail open; decided by an outsider's comment](figures/open-screening-default.svg)

<a name="q3"></a>
### Q3 · In `observe`, a held task or an Inbox item with no task?

- **In plain terms:** the Inbox lists only task-row holds and suspensions
  (`orchestration/src/inbox/check.ts`; the inbox row of `docs/mechanisms/mechanisms.yaml`), so a
  "would accept" item with no task is a new source.
- **The trade-off:** A, the Inbox gains that source and `observe` files nothing (the owner's
  wording). B files the task held on a confirm: nothing runs until a person says yes.
- **My recommendation: B.** The Inbox stays as it is, and accepting is one click. "Files nothing"
  becomes "runs nothing"; the Not-done-if line and leg d are written to B.
- **What would change my mind:** held rows cluttering the board for people who never accept them.
- **If wrong:** rows nobody accepts, or under A, a second Inbox source.

![Q3: a held task, recommended, beside an Inbox item with no task; decided by the Inbox as it is](figures/open-observe-writes.svg)

<a name="q4"></a>
### Q4 · Build the Slack flow now, or prove the event shape without it?

- **In plain terms:** the Slack child was there to prove the event isn't GitHub-shaped. Child 1
  can check the shape against Slack's payload, and the closure keeps Slack-shaped fixture events.
- **The trade-off:** that proof with no second flow, against Slack routing at wrap.
- **My recommendation: Not doing.** The #support journey becomes a GitHub one.
- **What would change my mind:** a committed user needing Slack routing this quarter. Restoring
  it adds one child after the GitHub one, a Slack token, and live Slack events at closure.
- **If wrong:** that user waits for its own epic.

![Q4: no Slack flow, recommended, beside building it; decided by proving the event's shape](figures/open-slack.svg)

<a name="q5"></a>
### Q5 · Retire `sessionId` for every provider, or only where a service flow routes? · found 2026-11-03

- **In plain terms:** besides GitHub, the Stripe and Slack guides and `keeping-a-flow-running.md`
  set `sessionId`, and with Slack out no service flow replaces them.
- **The trade-off:** a Stripe customer keeps one session, against one way to route.
- **My recommendation: only where a service flow routes.** The GitHub binding loses it; Stripe,
  Slack and custom bindings keep it. The Not-done-if line is written to this.
- **What would change my mind:** every provider in the guides getting a flow.
- **If wrong:** two ways to route, or each Stripe event in a fresh session.

![Q5: retire only where a flow routes, recommended, beside everywhere; decided by a Stripe customer's events](figures/open-sessionid-scope.svg)

<details>
<summary><b>Decided earlier, not on the sign-off</b> · D2–D4, D6–D8, D10, D11</summary>

<a name="d2"></a>
**D2 · Deterministic checks first; the evaluator is the only model use** (owner, 2026-11-01). No
generator runs anywhere in routing. The closure counts 0 generator calls.

<a name="d3"></a>
**D3 · Sessions subscribe; the service flow keeps the list** (owner, 2026-11-01). Fan-out is
many-to-many.

<a name="d4"></a>
**D4 · Push and poll are only ingestion; two dedupe questions** (owner, 2026-11-01; EM,
2026-11-03). Ingestion: has this subscription seen this object and version? Its last-seen version
on the subscription row, which D10's cursor already persists. Delivery: has this recipient got it?
A `sendMessage` id of `<object>@<version>:<session>` on the user-scoped log's `getOrCreate`
(~298, ~394). No new store. `runOnce` doesn't reach across requests, and FIX-2199 is related, not
a prerequisite.

<a name="d6"></a>
**D6 · A structured filter selects; the screen decides.** A subscription names a provider and a
thread, and optionally kinds: a zero-token lookup. A sentence compiles to config screens at
subscribe where it can. A subscription with only a sentence is refused.

<a name="d7"></a>
**D7 · The screen chain is a sequencer, not a router** (order, owner, 2026-11-02; block kind, EM,
2026-11-03). A router picks one branch; a screen stops at the first refusal. `.stepIf` over config
screens, then custom screen blocks, then one evaluator on Jev across the event's readers, with a
verdict per subscription. A config refusal is final. A delivered message carries its sender and an
"outside content" mark. `fit-check.ts`'s generator fallback is fenced off.

<a name="d8"></a>
**D8 · An unmatched event goes to the coordinator, or is dropped.** Only kinds the app lists are
forwarded. Dropped events are counted, not stored. The service flow never calls `createTask`.

<a name="d10"></a>
**D10 · Polling runs on per-user schedule rows; `sessionId` retires** (cadence, owner, 2026-11-02;
rows, EM, 2026-11-03). A static schedule runs as a system principal and can't read user-scoped
subscriptions. Each subscription is a schedule-collection row (`defineScheduleCollection`,
`createResourceCollectionScheduleResolver`, `onOverlap: "skip"`), and the 5-minute floor is a cron
check at subscribe. `sessionId` retires from GitHub in the GitHub child; its scope elsewhere is
[Q5](#q5). Implementer notes: conditional requests and batching per repo against
rate limits; check runs delivered on terminal state, comment edits once per object.

<a name="d11"></a>
**D11 · Explicit vs inferred work, in this epic** (owner, 2026-11-02). `off`, `observe`, `auto`:
one key beside `routing`, default `observe`. Explicit means the event addresses the agent and
passes the sender rule, and runs in every mode. Inferred runs only in `auto`. What `observe`
writes is [Q3](#q3).

</details>

## Who owns what

![Who owns what: eight rules by six children, each with one owner; child 1 owns six](figures/ownership.svg)

Child 1 owns six of eight rules because it is the seam; a *uses* cell is a place a child must not
re-decide.

| # | Rule every child obeys | Owner | Checked at |
|---|---|---|---|
| ER-1 | No generator in routing; Jev is one evaluator call per event | Child 4 (D2, D7) | Every spec review; the closure ledger |
| ER-2 | The service flow never files a task; the coordinator decides new work | Child 5 (D8) | The closure, leg d |
| ER-3 | One messaging API: delivery is `sendMessage`, no roster worker | Child 1 (D9) | Each child's spec review |
| ER-4 | A user subscribes to, and hears, only threads they can read; no verdict or interest sentence reaches another user | Child 1 (D5) | Child 3's and 4's spec review; the closure's two users |
| ER-5 | Subscriptions are written only by `subscribe` and `unsubscribe` | Child 1 (D5) | Child 2's and 5's spec review |
| ER-6 | One normalized event: the service action's input over `WebhookInboundEvent` | Child 1 (D4) | Child 2's and 3's spec review |
| ER-7 | A task's subscription ends with the task | Child 1 (D5) | The closure |
| ER-8 | Seen once per subscription (last-seen version), sent once per session (`<object>@<version>:<session>`) | Child 1 (D4) | The closure, leg c |

## Coordination seams

| Seam | Between | Rule |
|---|---|---|
| `sendMessage` | Child 1 and [FIX-2070](https://linear.app/fixpoint-labs/issue/FIX-2070) (In Development) | Whichever lands second rebases onto the other's `exempt` path |
| The subscription row | Child 1 and child 3 | Child 1 owns it; child 3 adds the schedule fields and the last-seen version |
| The event shape | Child 1, children 2 and 3 | Child 1 fixes it; push and poll both map into it |
| Coordinator config | Child 5 and FIX-1786's `routing` | One key beside it, no new policy |

## Decided in review, recorded so no child reopens them

All EM calls, 2026-11-03.

- **Two dedupe questions, no new store:** [D4](#d4).
- **Credentials:** [D5](#d5), ER-4.
- **The 5× bar** counts context tokens with a fixed tokenizer and overhead.
- **Retiring `sessionId` folds into the GitHub child.**
- **Screens are a sequencer**; Q2 moves to child 1's spec gate: [D7](#d7).
- **The exempt path, not a new sender kind:** [D9](#d9).
- **Per-user schedule rows:** [D10](#d10).
- **Reuse:** the event is an action schema; subscriptions follow the message log, the tools
  standing rules; the work mode is one key.

## What the end-state POC showed

None built.

## How it got here

- **Drafted (Nov 1).** D1–D4 decided by the owner.
- **Owner (Nov 2).** D5, D7's order, D9, D10's cadence, D11, the 5× bar.
- **Second look and review (Nov 2–3).** Eight EM calls above. Seven children became five; Q1, Q3,
  Q4 opened, and Q5 when the guides showed Stripe and Slack also set `sessionId`.
