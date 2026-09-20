# FIX-1457 · W5: Living Workforce — people in the org chart, and something you can run

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Epic · 3 spine points, 2 filed children · Workforce: Layer 2 Abstraction · Goal 1 — validate
through real usage

## Four teams, before and after

| A team that… | Today | After this epic |
|---|---|---|
| **needs a person to approve what a seat is doing** | Bolts on an ambient approval tool with no org identity. Nobody is accountable, and the org can't see who owes it | The agent seat keeps the row and **parks it with a reason**. The person is in the org chart, and answers through an action **bound to them** — so the org can say who owes it, and still knows after a redeploy |
| **runs a manager queue over a mixed team** | Can only assign to agent seats. A human step falls out of the queue into Slack | The coordinator assigns to a seat as before. A step that needs a person **parks** instead of falling out: the row stays on the board, and the person answers it through a bound action |
| **wants to see Workforce working** | Reads four architecture documents and finds a kitchen-sink demo nothing serves | Clones a reference app that hires a team, opens channels and boards, and still has them after a redeploy |
| **asks what Workforce is feature-complete *for*** | The bar is described in tickets; nothing runs it end to end | A living reference runs the bar — W3 floor, W4 routing, org identity — with no special wrappers |

**Why now.** W3 made a Workforce **describable** and W4 is making work **reach** a seat. Neither
produced something a person can run, and neither answered how a person gets into the loop **without
becoming a worker in it**. Every consumer that has needed a human in the loop invented an ambient
approval tool with no org identity — fine until an org has to say *who owes this* and *did they do
it*. W5 is where
the substrate stops being substrate, and it is deliberately **not** a fourth substrate epic
([D1](DECISIONS.md#d1)).

## What's in the box

![What's in the box: the human-input path — an agent seat parks a row with a reason, the audience derives to a principal, and the person answers through a bound flow action while the org chart holds the durable bind — plus the reference consumer and assemblies that compose the W3 floor with the W4 first cut. A ship fence, lifted on Sep 20 when W4's first cut landed, sits above two rows that have still not started, and below a second fence is the list of what the set refuses to build. The figure's aria-label carries every item.](figures/end-state.svg)

The box is a **composition**, not a layer ([D1](DECISIONS.md#d1)). The only genuinely new thing is
the path a person's answer takes back into a running flow, and it is **shaped, not shipped**, this
cycle — the dashed band is the ship fence, defined once in [D4](DECISIONS.md#d4). The bottom strip
is what the set refuses to build, and since the [D2](DECISIONS.md#d2) flip that strip also refuses
**a person as a board drainer**.

## The set · as of 2026-09-20

The live table. Refreshed on the epic PR as issues move; the plan and the figures point here rather
than repeating it. **A held child epic carries no spec PR of its own here** — it runs its own
lifecycle ([ER-15](BUSINESS-RULES.md)) — and an empty cell in that row is correct, not a gap.

**Who owns the done condition before the cut is made.** The assemblies row is where
[ER-19](BUSINESS-RULES.md) will most likely be proved, but that row is not filed and may yet
collapse into FIX-1455. So until the cut is made, **FIX-1455 is ER-19's provisional owner, unless
the assemblies cut says otherwise**, and [ER-4](BUSINESS-RULES.md) travels with it. This is a
default home, not a decision: it means the collapse path has a defined owner instead of none, and it
pre-empts nothing — the row stays, and [Open 1, 2 and 3](DECISIONS.md#open) stay open.

| Issue | What it delivers | Why the set needs it | Status |
|---|---|---|---|
| [FIX-1458](https://linear.app/fixpoint-labs/issue/FIX-1458) · Explore: humans-in-seats | The **shape of the human-input path**: a parked row with a reason, an audience that derives to a principal, the bound actions a person answers through, and the four walls answered — or left open only where the exploration shows they bind nothing downstream ([ER-18](BUSINESS-RULES.md)) | Spine point 1, and the gate on the other two — nothing else in the set can be specced until that path has a shape | **Spec in review** · route `spec` (Design + Feature) · spec [#1955](https://github.com/fixpoint-labs/flow-state-dev/pull/1955) · **being re-specced to [D2](DECISIONS.md#d2)'s flip** |
| [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) · Kitchen-sink rebuild | The reference consumer people copy: durable hire — which since the [D2](DECISIONS.md#d2) flip round-trips **principal / member identity**, not a human seat's settings bag — plus `CHANNEL.md` seats, boards, inventory, inline vs resource-backed UI | Spine point 2 — the living app the objective is proved in rather than described in, and ER-19's **provisional** owner until the cut | **Held child epic** · own `Epic` label, own child [FIX-1429](https://linear.app/fixpoint-labs/issue/FIX-1429) (a `Bug`) · runs its **own** lifecycle ([ER-15](BUSINESS-RULES.md)) · **ship fence lifted 2026-09-20** — W4's first cut landed; no ship ticket opened yet. No spec PR here **by design** |
| FIX-XXX · working assemblies | Reference surfaces composing the W3 floor and the W4 first cut into runnable product shape | Spine point 3, and where [ER-19](BUSINESS-RULES.md) and [ER-4](BUSINESS-RULES.md) land if the cut names work FIX-1455 cannot carry | **Not filed** · the child cut is still **undecided**, but W4's first cut has landed, so it is now decidable ([Open 2](DECISIONS.md#open)). One row standing for a spine point, **not** a promise of one issue |

**0 done · 1 spec in review · 1 held child epic · 1 not filed.** W4 (FIX-1407) is *In Review* and
every first-cut child is Done — only FIX-1460 (a dead-code call) and FIX-1461 (a docs page) are
still Backlog — so **the ship fence has lifted**. FIX-1458's spec is the only W5 work in flight; no
ship ticket has been opened and the assemblies cut has not been made
([Open 2 and 3](DECISIONS.md#open)).

**Is three really two?** The assemblies row is the one that can collapse: the locked input already
leans against a third demo stack. **Collapse trigger:** an assemblies cut whose every item is
already a FIX-1455 issue — then the row closes, W5 is two children, and ER-4 and ER-19 stay with
FIX-1455 where the provisional owner already put them. Which way it goes is
[Open 1 and 2](DECISIONS.md#open), and neither is pre-judged here: a coordinator reading this table
before the cut files **nothing**, it waits.

## How the issues flow into each other

```mermaid
flowchart LR
  W3["W3 floor · FIX-1351"] -.->|"seats, channels, skills on disk"| E
  W4["W4 first cut · FIX-1407"] -.->|"boards, inventory, dispatch"| E
  E["FIX-1458 · humans-in-seats"] -->|"the human-input path to build on"| K["FIX-1455 · kitchen-sink · child epic"]
  E -.->|"the park-and-answer story to compose"| A["FIX-XXX · working assemblies"]
  K -->|"the running reference"| A
  K -->|"provisional owner, until the cut"| P["ER-19 · the done condition"]
  A -.->|"if cut, ER-4 and ER-19 move here"| P
  classDef proposed stroke-dasharray:4 3
  class A proposed
```

An edge is what one node hands the next. Dashed **edges** are either consumed from another epic or
conditional on the assemblies cut; the one dashed **node** is not filed yet. FIX-1455 is solid
because it **is** filed — *held* and *unfiled* are different states, and only the second is a
placeholder. ER-19 is the epic’s done condition rather than an issue, and it has two routes in because the cut has not been made — it no longer has none.

## What stays as it is

- **The OOTB agent kind** ([FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359)). It is the
  seat that parks a row for a person; nothing here rewrites it.
- **Board assignee and L1 task status** ([D3](DECISIONS.md#d3)). Consumed from W4's invent-kill, not
  re-decided here.
- **Collab rooms** ([FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341)). Parked, and
  explicitly not this epic.
- **The finish-line Labs** — DevForce, CyberForce. W5 teaches the conventions they will run on; none
  of their product lands in the kitchen-sink.
- **Package cohesion, the skills register, the memory story.** Consumed as they are; W5 invents no
  second copy of any.

## Sign off

**The gate is being re-taken.** You approved this set on 2026-09-20 and flipped
[D2](DECISIONS.md#d2) the same day. D2 is the epic's first spine point, so the approval does not
carry over to the version below — it is a live ask again, and it is the hardest one.

1. **[D2](DECISIONS.md#d2) · Does a person act on the work, or in it?**
   - **Plain terms.** The old answer put a person in a seat beside the agents, pulling rows off the
     board. The new one leaves the work with a non-human seat that **parks** when it needs an
     answer, and lets the person answer through an action **bound to them** — the flow decides what
     the answer means and carries on. The org chart is the part that stays either way: one list of
     people and agent seats, with a bind that survives a redeploy.
   - **Trade-off.** Acting *on* the work means a person is never a bottleneck the board waits to be
     drained, and authorization has somewhere to live. It also means a person cannot simply pick up
     a row and do it — every human touch has to be an action some flow already anticipated.
   - **Recommendation: the flip, as you called it.** A task needs review while a non-human still
     owns it, and an answer only helps if something knows what to do with it. That is a flow's job.
   - **What would change my mind:** the exploration finding that a bound action cannot carry enough
     for the flow to continue — that a person's answer needs a worker's whole turn.
   - **If wrong:** the first spine point is the wrong shape and FIX-1458 re-specs again. Cheap now,
     expensive once FIX-1455 has rendered it.
2. **Approve a set whose done condition has only a provisional owner, or hold it until the cut is
   forced?**
   - **Plain terms.** The finish line is *a row parked by a seat in a running, **org-bound** app
     reaching the person who owes it, answered through a bound action, and the flow carrying on*.
     FIX-1455 is the app that could show it, but it runs its own lifecycle, and nobody is on the
     hook for whatever it turns out to be missing.
   - **Trade-off.** Approving starts the exploration a cycle earlier. Holding buys a committed proof
     owner, at the cost of the only W5 work that isn't fenced anyway.
   - **Recommendation: approve, with FIX-1455 as the provisional surface.** The exploration is what
     makes the cut decidable; cutting an assemblies child before W4's first cut lands is guessing at
     a division we would re-cut in a month.
   - **What would change my mind:** if you intend W5 to wrap this quarter. Then the proof needs a
     committed owner now, and the cut has to be forced.
   - **If wrong:** the epic runs an exploration and has nothing that proves it. Recoverable — the
     assemblies cut is the next decision either way.
3. **[D4](DECISIONS.md#d4) · Explore now; ship waits on W4's first cut.** Unchanged by the flip, and
   the fence has since lifted. If wrong: either W5 ships against a moving floor, or the exploration
   sits idle for a cycle it could have used.

**Not asked, reported as news.** [D5](DECISIONS.md#d5) — W5 starts as the fourth active epic against
a cap of two — was your call on 2026-09-19, recorded so a later reader knows the breach was
deliberate; it is not reopened here. [D3](DECISIONS.md#d3) — assignee stays a drain key and no L1
`TaskStatus` grows — is **consumed from W4's invent-kill with no re-gate**, and binds children
through [ER-7 and ER-8](BUSINESS-RULES.md).

**Open: three**, two of them structural — the assemblies child cut, and the done condition's owner
being provisional rather than committed ([Open 2 and 3](DECISIONS.md#open)). The exploration's walls
stay open by instruction, except where one binds a downstream child ([ER-18](BUSINESS-RULES.md)). Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The rules
every child obeys: [BUSINESS-RULES.md](BUSINESS-RULES.md). The order the work runs in:
[PLAN.md](PLAN.md).
