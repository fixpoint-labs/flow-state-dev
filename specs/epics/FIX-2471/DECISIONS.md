# FIX-2471 · Decisions

[Spec](SPEC.md) · **Decisions**

## The tree

```mermaid
flowchart TD
  E["FIX-2471"] --> D1["D1 · one service flow per provider routes, in code"]
  D1 -.->|"rejected · tokens per event per agent"| X1["an LLM router reads every event"]
  E --> D5["D5 · a subscription is its user's; a user hears only what they can read"]
  D5 -.->|"rejected · content crosses users"| X5["one app token at org scope"]
  E --> D9["D9 · delivery is sendMessage's exempt path, labelled"]
  D9 -.->|"rejected · two sets of recipient rules"| X9["a new sender kind"]
  E --> Q1["Q1 · Fail closed: who gets through a screen by default"]
  E --> Q3["Q3 · In observe, a held task, not an Inbox item with no task"]
  E --> Q4["Q4 · No Slack flow; the event shape is proved without it"]
  E --> Q5["Q5 · Retire sessionId only where a service flow routes"]
  E --> R7["ER-7 · open · when a task's subscription ends"]
  E --> G["decided earlier · D2–D4, D6–D8, D10, D11"]
```

<a name="d1"></a>
## D1 · One service flow per provider routes, in code · owner, Nov 1

| | |
|---|---|
| **Instead of** | DeepSeek's LLM router that sees every event · a per-app binding that names a session |
| **Because** | Most deliveries are a lookup. DeepSeek's router pays per event per agent: 31.8M cache-read tokens without pass-through, 23.2M with |
| **Locks in** | The flow routes and never decides new work ([D8](#d8)); the app mounts one per provider |

**What would change my mind:** the [kill line](SPEC.md#the-goal-and-how-well-know-its-met).

![D1: a service flow in code, chosen, beside an LLM router; decided by cost as sessions multiply](figures/d1-code-routes.svg)

It comes down to cost: the router's spend grows with every event.

<a name="d5"></a>
## D5 · A subscription is its user's, who hears only what they can read · owner, Nov 2; EM, Nov 3

| | |
|---|---|
| **Instead of** | One app token at org scope · state on each subscriber, which the flow can't query |
| **Because** | It runs on its user's credentials (owner): checked at subscribe, and an event or a poll reaches only users who can read the thread ([ER-4](#who-owns-what)) |
| **Locks in** | Only `subscribe` and `unsubscribe` write, so FIX-2056's five-tool bar holds. A coding task subscribes to its PR when it opens (owner) |

![D5: the user's credentials, chosen, beside one app token; decided by a private repo](figures/d5-user-scoped.svg)

It comes down to a private repo: on one app token, its content reaches a user who can't read it.

<a name="d9"></a>
## D9 · Delivery is `sendMessage`'s exempt path, server-labelled · owner, Nov 2; EM, Nov 3

| | |
|---|---|
| **Instead of** | A new sender kind, `service:<flowKind>`, with its own budget · a roster worker |
| **Because** | The `exempt` path (`send-message.ts` ~249) already skips the hop budget and takes a crash-safe `id` ([D4](#d4)). Added: the label in the worker-id slot (~289), a subscriber check, a per-subscription cap |
| **Locks in** | No roster worker, one messaging API, the service as sender (owner). FIX-2070 edits the same function ([seam](#coordination-seams)) |

![D9: the exempt path, chosen, beside a new sender kind; decided by where recipient rules live](figures/d9-exempt-sender.svg)

It comes down to where recipient rules live: a second sender kind keeps a second copy in step.

<a name="q1"></a>
## Q1 · decided · Fail closed: who gets through a screen by default · owner, 2026-11-04

| | |
|---|---|
| **Instead of** | Fail open: anyone the thread shows |
| **Because** | An outsider's comment on a public repo never reaches a coding task's context unscreened |
| **Locks in** | Members, collaborators and listed bots pass; an outsider needs a per-subscription opt-in. Child 1 ships the check |

**What would change my mind:** an app whose core job is triaging outsiders' issues.

![Q1: fail closed, chosen, beside fail open; decided by an outsider's comment](figures/q1-screening-default.svg)

It comes down to an outsider's comment: fail open lands it in a coding task unscreened.

<a name="q3"></a>
## Q3 · decided · In `observe`, a held task, not an Inbox item with no task · owner, 2026-11-04

| | |
|---|---|
| **Instead of** | An Inbox item with no task, which files nothing (the owner's first wording) |
| **Because** | The Inbox lists only task-row holds (`orchestration/src/inbox/check.ts`), so a taskless item is a new source |
| **Locks in** | The task is filed held on a confirm and runs nothing until a person says yes; leg d checks held tasks |

**What would change my mind:** held rows cluttering the board for people who never accept.

![Q3: a held task, chosen, beside an Inbox item with no task; decided by the Inbox as it is](figures/q3-observe-writes.svg)

It comes down to the Inbox as it is: an item with no task needs a second source.

<a name="q4"></a>
## Q4 · decided · No Slack flow; the event shape is proved without it · owner, 2026-11-04

| | |
|---|---|
| **Instead of** | A Slack service flow, push and poll, in this epic |
| **Because** | The Slack child proved the event isn't GitHub-shaped; child 1 checks it against Slack's payload, and the closure keeps Slack-shaped fixtures |
| **Locks in** | Five children and a closure; the #support journey becomes a GitHub one |

**What would change my mind:** a committed user needing Slack this quarter (one more child).

![Q4: no Slack flow, chosen, beside building it; decided by proving the event's shape](figures/q4-slack.svg)

It comes down to proving the event's shape: a Slack flow spends a whole child on it.

<a name="q5"></a>
## Q5 · decided · Retire `sessionId` only where a service flow routes · owner, 2026-11-04

| | |
|---|---|
| **Instead of** | Retiring it everywhere |
| **Because** | The Stripe and Slack guides and `keeping-a-flow-running.md` also set `sessionId`, and no flow replaces them |
| **Locks in** | GitHub loses it; Stripe, Slack and custom bindings keep it: two ways to route, split by provider |

**What would change my mind:** every provider in the guides getting a flow.

![Q5: retire only where a flow routes, chosen, beside everywhere; decided by a Stripe customer's events](figures/q5-sessionid-scope.svg)

It comes down to a Stripe customer's events: retired everywhere, each runs in a fresh session.

<a name="open"></a>
## Open

<a name="er7"></a>
### ER-7 · When does a task's subscription end?

- **In plain terms:** a coding task ends just after opening its PR, so under ER-7 as signed,
  later reviews reach no task.
- **The trade-off:** amended, a finished task's session takes a turn per review until the PR
  closes or the cap.
- **My recommendation: amend.** It ends when the task fails or is cancelled, or its thread
  closes (PR merged or closed). A finished task keeps hearing its open PR.
- **What would change my mind:** a finished task's session refusing messages; today only a
  running one is (`message-target.ts` ~90). Then it moves to the follow-up or owner.
- **If wrong:** sessions wake on reviews nobody acts on.

![ER-7: ending on failure, cancellation or a closed thread, recommended, beside ending with the task; decided by a review after the run](figures/open-er7-subscription-end.svg)

It comes down to a review after the run: as signed, it reaches no task.

Q2 is settled at FIX-2534's spec gate.

<details>
<summary><b>Decided earlier, not on the sign-off</b> · D2–D4, D6–D8, D10, D11</summary>

<a name="d2"></a>
**D2 · Deterministic checks first; the evaluator is the only model use** (owner, Nov 1).

<a name="d3"></a>
**D3 · Sessions subscribe; the service flow keeps the list** (owner, Nov 1). Fan-out is
many-to-many.

<a name="d4"></a>
**D4 · Push and poll are only ingestion; two dedupe questions** (owner, Nov 1; EM, Nov 3). Seen
by this subscription? Its cursor row's last-seen version. Got by this recipient? A `sendMessage` id
`<object>@<version>:<session>` on the log's `getOrCreate` (~298, ~394). No third dedupe store:
the log id and the cursor; the thread index only nominates.

<a name="d6"></a>
**D6 · A structured filter selects; the screen decides.** Provider, thread and optional kinds
select at zero tokens; a sentence compiles to config screens where it can, and alone is refused.

<a name="d7"></a>
**D7 · The screen chain is a sequencer, not a router** (order, owner, Nov 2; kind, EM, Nov 3). It
stops at the first refusal: config screens via `.stepIf`, custom screens, then one Jev
evaluator; messages carry their sender and an "outside content" mark. Implementer note:
the one Jev call per event returns a structured verdict per subscription; a failed call refuses
or holds, never falls back to N calls or a generator, and the closure asserts ≤1 evaluator call
per normalized event.

<a name="d8"></a>
**D8 · An unmatched event goes to the coordinator, or is dropped.** Only kinds the app lists are
forwarded; drops are counted. The service flow never calls `createTask`.

<a name="d10"></a>
**D10 · Polling runs on per-user schedule rows** (cadence, owner, Nov 2; rows, EM, Nov 3). Each
subscription is a row (`defineScheduleCollection`, `createResourceCollectionScheduleResolver`,
`onOverlap: "skip"`); the 5-minute floor is checked at subscribe. Implementer notes: the poll
walks the resolver's due index, not every subscription; conditional requests, per-repo batching;
check runs on terminal state, comment edits once per object.

<a name="d11"></a>
**D11 · Explicit vs inferred work** (owner, Nov 2). `off`, `observe`, `auto`: one key beside
`routing`, default `observe`. Explicit work (addresses the agent, passes the sender rule) runs in
every mode; inferred only in `auto`.

</details>

## Who owns what

![Who owns what: eight rules by six children, each with one owner; child 1 owns six](figures/ownership.svg)

Child 1, the seam, owns six; a *uses* cell is a place a child must not re-decide.

| # | Rule every child obeys | Owner | Checked at |
|---|---|---|---|
| ER-1 | No generator in routing; Jev is one evaluator call per event | Child 4 (D2, D7) | Spec reviews; closure ledger |
| ER-2 | The service flow never files a task | Child 5 (D8) | Closure, leg d |
| ER-3 | One messaging API: `sendMessage`, no roster worker | Child 1 (D9) | Spec reviews |
| ER-4 | Users subscribe to and hear only threads they can read; nothing crosses users | Child 1 (D5) | Children 3, 4; closure's two users |
| ER-5 | Only `subscribe` and `unsubscribe` write subscriptions | Child 1 (D5) | Children 2, 5 |
| ER-6 | One normalized event over `WebhookInboundEvent` | Child 1 (D4) | Children 2, 3 |
| ER-7 | *Pending [ER-7](#er7):* ends on failure, cancellation or a closed thread | Child 1 (D5) | Closure: a late review lands |
| ER-8 | Seen once per subscription, sent once per session | Child 1 (D4) | Closure, leg c |

## Coordination seams

| Seam | Between | Rule |
|---|---|---|
| `sendMessage` | Child 1, [FIX-2070](https://linear.app/fixpoint-labs/issue/FIX-2070) (In Development) | The second to land rebases onto the other's `exempt` path |
| The subscription row | Children 1, 3 | Child 1 owns it; child 3 adds schedule fields; last-seen version is a delivery-written cursor row (ER-5) |
| The event shape | Children 1, 2, 3 | Child 1 fixes it; push and poll map into it |
| Coordinator config | Child 5, FIX-1786 | One key beside `routing` |

## Decided in review, recorded so no child reopens them

EM, Nov 3: [D4](#d4)'s two dedupes · [D5](#d5)'s credentials · [D7](#d7)'s sequencer, Q2 at
child 1's gate · [D9](#d9)'s exempt path · [D10](#d10)'s rows · the 5× bar's fixed tokenizer ·
`sessionId`'s retirement in the GitHub child · the reuse calls in
[SPEC](SPEC.md#whats-already-here-and-the-debt)'s Adds table.

## What the end-state POC showed

None built.

## How it got here

- **Drafted (Nov 1).** D1–D4, by the owner.
- **Owner (Nov 2).** D5, D7's order, D9, D10's cadence, D11, the 5× bar.
- **Review (Nov 2–3).** The EM calls above. Seven children became five (`sessionId` into the
  GitHub child, Slack out). Q1, Q3, Q4 opened, then Q5 from the guides.
- **Merged (Nov 4).** The owner's merge of #4515 decided [Q1](#q1), [Q3](#q3), [Q4](#q4) and
  [Q5](#q5), and the set was filed as FIX-2534 to FIX-2539.
- **Amended (Nov 4).** FIX-2534's spec
  ([#4673](https://github.com/fixpoint-labs/flow-state-dev/pull/4673), Q-A) opened [ER-7](#er7)
  and placed the cursor.
