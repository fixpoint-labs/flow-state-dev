# FIX-1497 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

What was considered, what was chosen, why, and what each locks in. Two decisions are the sign-off
surface. A third was routed up rather than answered here, and the owner closed it on 2026-09-22.

## The tree

```mermaid
flowchart TD
  I["FIX-1497 · ER-Collab proof"] --> D1["D1 · the shipped dev server<br/>and a real browser"]
  D1 -.->|"rejected"| X1["assert on the store, and<br/>a screenshot for the human half"]
  D1 -.->|"rejected"| X2["fold the session's items ourselves<br/>a copy of the view, graded against itself"]
  I --> D2["D2 · a handoff is a second row<br/>filed by the seat that finished the first"]
  D2 -.->|"rejected"| X3["a handed-off status · ER-8"]
  D2 -.->|"rejected"| X4["reassign the row<br/>a hand-off board refuses it by design"]
  I --> D3["D3 · this proof stands up its own hire<br/>owner's call, 2026-09-22"]
  D3 -.->|"rejected"| X5["share the DevForce proof's workforce"]
```

Solid edges are the decisions. D1 and D2 are what you're signing; **D3 is already closed** — it
reached outside this issue, went up, and came back answered.

<a name="d1"></a>
## D1 · The proof drives the shipped `fsdev dev` and reads the handoff in a real browser

| | |
|---|---|
| **Instead of** | Running headless and asserting the rows in the store, with a screenshot and a human's word for the *"observed in DevTool"* half · or replaying the session and folding its items into a board ourselves |
| **Because** | *Observed in DevTool, with no special wrapper* is a claim about what a person sees, and a store read cannot make it. The repo already grades the shipped bundle in Chromium exactly this way (`goals/flow-instances/devtool-shows-the-selected-copy`), so this reuses a shipped technique instead of inventing an observation surface. Folding the items ourselves is worse than either: the fold is the DevTool's, it is not exported, and a copy of it would be graded against itself |
| **Locks in** | The proof needs a browser and built DevTool assets, so it is out of CI like every goal. And its strength is bounded by the rows it reads: those are [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)'s, content-complete and **unmerged** |

**What would change my mind:** a DevTool surface that exports its board fold as a supported API.
Then the cheap check grades the real fold without a browser, and the browser leg narrows to the
one thing only a browser can answer — that a person can read it.

<a name="d2"></a>
## D2 · A handoff is a second row, filed by the seat that finished the first

| | |
|---|---|
| **Instead of** | A `handed-off` value on the task status · or moving a row's assignee from one seat to the other |
| **Because** | A status value for a handoff is a named invent-kill ([ER-8](../../epics/FIX-1457/BUSINESS-RULES.md)), and reassignment is not available to be chosen: a board that hands rows off to seats **freezes** the assignee and declines the write, because the child session a row was dispatched into is keyed the moment it is dispatched. What is left is what the board already does — one seat finishes its row and files the next one for another desk |
| **Locks in** | *Handed over* means two rows on one board with two assignees, for this proof and for anything that cites it. A later notify-based compose ([FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474)) has to be shown to produce the same observable, rather than quietly replacing the definition |

![A box holds what the human leg is: one principal, a non-human seat owning the row, the person answering through a flow action on the owning seat, and the reason as what the screen shows. Outside a dashed fence sit a second principal, originator distinct from reviewer, a durable reviewedBy, and a person claiming rows off the board — each stopped at the fence. One arrow crosses, the answer, as an action.](figures/the-two-fences.svg)

Inside the box is [ER-1](../../epics/FIX-1457/BUSINESS-RULES.md); outside is
[ER-22](../../epics/FIX-1457/BUSINESS-RULES.md). One thing crosses, and it crosses as an action.
The same four shapes are in [BUSINESS-RULES.md](BUSINESS-RULES.md) as rules with red states.

<a name="open"></a>
<a name="d3"></a>
## D3 · This proof stands up its own hire — **the owner's call, closed 2026-09-22**

Reached outside this issue, so it went up rather than being decided here
([ER-17](../../epics/FIX-1457/BUSINESS-RULES.md#er-17)). Answered on the spec PR:

> *"Keep them separate. We can combine them later but having separate labs prevents coordination
> issues for now"*
> — [#2045](https://github.com/fixpoint-labs/flow-state-dev/pull/2045#issuecomment-5780729223),
> 2026-09-22

| | |
|---|---|
| **Instead of** | Running the graded scenario inside [FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496)'s DevForce workforce — one tree, one team, one place to point people at |
| **Because** | Two reasons, and they are different in kind. **The owner's is sequencing:** separate labs keep the two proofs from colliding while both are in flight, and *"we can combine them later"* — so the separation is a choice about ordering, not a boundary anyone has to argue their way back through. **The spec's is technical:** FIX-1496's [BR-8](../FIX-1496/BUSINESS-RULES.md) forbids board or harness *work* dispatch reaching its reviewer seat, with the control `reviewer-files` graded on the board dispatch record to go red if one does. A tree carrying two collaborating seats would have to relax that rule deliberately and be re-gated — which costs the first proof the thing it exists to prove |
| **Locks in** | S1–S7 build their own `workforce/` tree under `goals/multi-seat-collab/`, and the day hiring changes shape there are two small Markdown trees to update rather than one. **What it does not lock in:** [ER-26](../../epics/FIX-1457/BUSINESS-RULES.md#er-26) fenced the *graded run* on a live hired Workforce existing at all ([BR-21](BUSINESS-RULES.md)); it lifted on 2026-09-22 ([#2051](https://github.com/fixpoint-labs/flow-state-dev/pull/2051)) and the run passed ([#2065](https://github.com/fixpoint-labs/flow-state-dev/pull/2065)). That fence was never a claim about whose tree the run uses, and this decision neither narrows nor widens it |

**Combining stays cheap, and stays available.** Both trees are a few hundred lines in the same
folder. Merging them later is an afternoon; the expensive direction was the other one — bending
the DevForce proof to fit this one and costing it its sharpness. If the release wants one
demonstration to point at, that is a new call, and FIX-1496's [BR-8](../FIX-1496/BUSINESS-RULES.md) gets relaxed
deliberately and re-gated rather than worked around.

## Decided, not asked

- **The human leg's shape is not a fork.** ER-1 and [D7](../../epics/FIX-1457/DECISIONS.md#d7)
  already fix it: the seat that owns the row parks it, and the person answers through a flow
  action carrying the request's own principal. This spec obeys it and exercises it.
- **Ordering against FIX-1481 is soft.** Authoring and building this issue need neither code PR
  merged; only the *graded run* needs them, and the run was already fenced until a live hire existed
  ([ER-26](../../epics/FIX-1457/BUSINESS-RULES.md#er-26)). Recorded so
  nobody reads the spec as blocked. **The fence lifted on 2026-09-22**
  ([#2051](https://github.com/fixpoint-labs/flow-state-dev/pull/2051)) and the graded run passed
  ([#2065](https://github.com/fixpoint-labs/flow-state-dev/pull/2065)).
- **The acceptance names the board by its local name**, and asserts the minted ledger id appears
  in no file under the scenario. The Architect left this open leaning yes; board v1's whole point
  is that a file says a name and the framework owns the identity.
- **One channel, not two.** The bar is ≥1. A second channel adds no claim and one more thing to
  keep in step.
- **The board hands rows off to the seats' task entries** rather than running inline workers, so
  an assignee genuinely routes *to a seat* instead of naming the worker itself.
- **Model-free.** A row is filed or it is not; a seat claims it or it does not; a reason is on the
  screen or it is not. A model in the loop adds a way to fail that has nothing to do with the claim.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Extend `manager-queue-lab` with a handoff leg | It has a green verdict log and two published claims. A proof that edits its own evidence is worse than a sibling that leaves it alone |
| Prove the handoff from the board's own report | The board reports what it did on the path under test. Execution has to be shown by something outside it |
| A screenshot plus a human's sign-off, as the whole observation leg | Not repeatable, not falsifiable, and worth nothing as a regression record a year out |
| An org-level board view so both rows sit on one screen | Boards are session-scoped today, and widening that is [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320)'s. Reaching for it here would be new substrate under a QA label ([ER-25](../../epics/FIX-1457/BUSINESS-RULES.md)) |
| Require [FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474)'s composed notify-plus-file path | Its own body keeps this gate on today's separate paths, and says it is not an ER-Collab gate |

## How it got here

- **Draft** — the scenario shaped as one board, two desk keys and three seats, with the human leg
  on the park-and-answer path the epic already ratified. The one premise the acceptance rests on
  was run rather than argued: the shipped dev server registers a file-declared hire, three seats
  and the channel singleton, with the channel's own four doors
  ([the POC](poc/served-hire-observable/README.md)). Both of its controls were seen red.
- **A stall the POC hit was isolated rather than disclosed**, because two controls pointing away
  from the change under test is the shape of a substrate defect. It is environmental:
  `FSDEV_DEFAULT_MODEL` set with no declared intent makes the model resolver throw, and the served
  path swallows it into a request that never advances. Stripped, the same server settles in 0 ms,
  so **[D1](#d1) stands**. The *silent* shape of that failure is raised up
  ([ER-17](../../epics/FIX-1457/BUSINESS-RULES.md#er-17)), not worked around — it is a follow-up in
  [PLAN.md](PLAN.md), and the EM owns whether it is filed.
- **The one open question was answered by the owner on 2026-09-22** — *keep them separate* — and is
  recorded as [D3](#d3) with both reasons: the owner's sequencing reason and the spec's technical
  one. Nothing else in the direction moved; D1, D2 and the three-screen observation stand.
