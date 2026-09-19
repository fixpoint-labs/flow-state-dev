# FIX-1430 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

What was chosen, what lost, what each locks in. Three decisions are the sign-off surface. Calls this issue may not take — where a board lives, what an assignee is, which package format a capability arrives in — belong to [FIX-1385](https://github.com/fixpoint-labs/flow-state-dev/pull/1917), [FIX-1394](https://github.com/fixpoint-labs/flow-state-dev/pull/1915) and the epic.

## The tree

```mermaid
flowchart TD
  I["FIX-1430"] --> D1["D1 · the lab ships no package code"]
  D1 -.->|"rejected"| X1["export the queue view<br/>a surface designed from one consumer"]
  I --> D2["D2 · a queue, not a hand-off"]
  D2 -.->|"rejected"| X2["FIX-1385's check with a third seat<br/>proves the half nobody doubted"]
  I --> D3["D3 · a busy seat's behaviour is shown"]
  D3 -.->|"rejected"| X3["pick a drain width and move on<br/>settles an epic wall in a goals folder"]
  D3 -.->|"rejected"| X4["run both widths in this issue's CI<br/>a second deliverable on the exit gate"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The lab ships no package code; the queue columns stay lab-local

| | |
|---|---|
| **Instead of** | Exporting the columns from `orchestration` or `workforce` as the Layer 2 view surface |
| **Because** | This issue owns one epic rule and no surface. [ER-11](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) calls a queue column a *view* rather than a status — a fence on where it may not live, not a commission to build a view package. One consumer is not a design input, and this lab is the only one. An export would also put the issue behind the W3 ship fence for no gain in evidence |
| **Locks in** | The next consumer that wants columns derives them again, and this lab's shape is a suggestion rather than a contract. If the view turns out to be the product we pay a second design pass — on two examples instead of one, which is the cheaper mistake |

<a name="d2"></a>
## D2 · The proof is a queue, not a hand-off: more rows than seats, and the coordinator assigns through the model's door

| | |
|---|---|
| **Instead of** | Re-running FIX-1385's own goal check with a third seat and calling it the exit gate |
| **Because** | That check already shows a row filed by one seat and claimed by another — [ER-20](https://github.com/fixpoint-labs/flow-state-dev/pull/1905)'s first half, the half nobody doubted. Its second half is a coordinator *assigning* to named seats, and routing to the only seat on a board is indistinguishable from not routing. [ER-21](https://github.com/fixpoint-labs/flow-state-dev/pull/1905)'s columns say nothing until a row waits. Hence: several candidate seats, more rows than seats, and a coordinator filing through the model's door |
| **Locks in** | A slower check with more moving parts, and a flaky queue is a flaky exit gate. Worker seats therefore do small deterministic work and the model appears at one place only — how far that goes is [Q1](#q1) |

<a name="d3"></a>
## D3 · What a busy seat does is shown, not chosen

| | |
|---|---|
| **Instead of** | Picking a drain width for the lab and letting that choice read as the recommended shape |
| **Because** | Whether a busy seat gets a second copy or work queues behind it is one of four session-policy walls the epic took back from FIX-1408 — and the epic named *this lab, running a queue deep enough to matter*, as what would settle it. Deciding it inside `goals/` settles an epic wall where nobody reads decisions ([ER-15](https://github.com/fixpoint-labs/flow-state-dev/pull/1905)) |
| **What "shown" means, exactly** | The lab is **wired so either width runs from one documented switch** — no edit to the tree, none to the checks. It does **not** mean this issue's CI runs the whole queue twice. Running both and writing out the comparison is evidence the epic asks for when it wants to rule, and it is off this issue's merge bar (BR-17). The decision is unchanged; only the work it implies moved |
| **And what the lab may therefore not assert** | If the lab must not choose the busy-seat policy, it cannot require the waiting row to read `pending` either — that reading *is* one of the two candidate policies. BR-6 keeps what holds at every width (nothing re-routes, nothing drops, the assignee is held) and records the status rather than requiring it. A hand-off leaves a claimed row `in_progress` while its child is still queued (`docs/architecture/dispatched-work.md` -> "The claim gate and the fence ticket"), so requiring `pending` would have pinned the gate to a state the landed path need not produce |
| **Locks in** | A reader looking for the recommended setting gets a comparison instead, and the epic owes a ruling before anyone can copy this lab as a shape. When it rules, the lab is revisited to keep the ruled width — the evidence costs a second visit, on purpose |

## Decided, not asked

- **No third `LabRoster`.** The lab reads its tree through whatever the package exports when it is built. FIX-1405 deletes the two copies that exist; a third while that is in flight is how a fourth appears.
- **Seat idle comes off the board's rows and the seats the lab hired**, not the live inventory — keeping blocking prerequisites at exactly one sibling.
- **No `defaultWorker`.** An unassigned row throws at the drain today. The lab shows that refusal rather than papering it, because "a row for nobody" is a case a queue meets.
- **The coordinator does not claim the rows it settles.** `taskTools` leaves an unclaimed settle unguarded on purpose; the lab records that rather than working around it.
- **Two checks over one host, differing by one block** — a model-free contract gate and a model-backed run. The devforce lab's shape, reused.
- **The channel's roster check on `author` is consumed, not re-implemented — and it is a label check, not a fence.** `author` is optional and stored `authorVerified: false`, so a filing that names no label is not checked at all, and `addTask` — the door the coordinator files through — carries no label to check ([FIX-1385 BR-10, BR-20](https://github.com/fixpoint-labs/flow-state-dev/pull/1917)). The lab grades the check where it exists (BR-8) and claims nothing about who may file. Members-only filing needs a per-caller identity the channel session does not have; that is parked on the epic, not borrowed here.
- **The lab files through the capability door, not the catalog door.** There are two ways the eight tools can reach a model. The one FIX-1385 ships is composition: the kind composes `taskTools` over the channel's ledger, the tools arrive as controls, and no `tools:` line touches them ([BR-17](https://github.com/fixpoint-labs/flow-state-dev/pull/1917)). The other is an app registering `buildTaskToolsList()` output in its own catalog, where a seat's `tools:` *does* bite. The lab takes the first, because ER-20 is evidence for the door models actually get; proving the catalog door would grade a wiring FIX-1385 does not ship and leave the shipped one unexercised. BR-2 is written so drifting to the catalog door turns it red.

## Considered and dropped

| Alternative | Why not |
|---|---|
| **Grow `goals/devforce-lab` instead** | It is the epic's other evidence and carries a board shape labelled interim. Rewriting it mid-epic destroys the before/after that makes a one-line board legible |
| **A harness-backed coding run per row** | The devforce lab already owns row → supervised coding run. Re-proving it buys no new fact and buys a slow, flaky exit gate ([Q1](#q1)) |
| **Build the nested cascade here too** | Phase-2 inside W4, off the gate by the epic's D1. A gate has to be reachable on a schedule |
| **Read seat liveness from the live inventory** | A second blocking sibling for a fact the board already carries |
| **Let the coordinator dispatch seats directly, skipping the board** | That is today, and it is what the epic exists to replace |

<a name="q1"></a>
## Open · one

### Does the exit gate close on routing proved, or on routing proved all the way into real work?

**In plain terms.** Either the demo ends at *the right worker picked up the right job and reported done*, or it ends at *the right worker picked up the right job, and here is the file it changed.*

**The trade-off.** The narrow reading makes the gate fast, deterministic and rerunnable on every change — but an outsider reading *work reaches a seat that runs it* may reasonably hear the wider one. The wide reading is closer to the words and costs a check that takes minutes, needs a scratch repository and a live harness, and fails for reasons unrelated to routing. A gate that goes red for unrelated reasons stops being one.

**My recommendation: the narrow one**, with worker seats doing small real work — writing a file the check reads back — rather than nothing. The wide claim is evidenced next door: `goals/devforce-lab/` shows a board row becoming a supervised coding run. What has never been shown is a *queue* crossing from a declared coordinator to declared seats, and that is the gap this issue was adopted to close.

**What would change my mind.** If the promise will be read publicly as *declare a team in Markdown and it ships code*, the two halves have to meet in one run at least once, and this is the cheapest place to make them meet.

**What being wrong costs.** Narrow when it was wide: the epic wraps on a claim narrower than it reads, and someone builds the wide check afterwards — a few days, nothing already built thrown away. Wide when it was narrow: the gate is slow and intermittently red from the day it lands, which is worse because it is permanent.

**Still open, and not settled here.** This is the product owner's call and it is with them.

**What is fenced while they decide.** Both reviewers asked for the same thing underneath the question, and it costs nothing to give: the *narrow* shape is now a hard requirement of the plan rather than a recommendation waiting on an answer — stub worker handlers doing small deterministic work, one model surface (the coordinator, and nothing else), and pentest-style poll and timeout fixtures ([PLAN](PLAN.md) -> Guardrails, and V-G). So the gate cannot widen toward devforce economics while the question is open. If the answer comes back wide, that is a change to make then, with the cost visible — not a door left open now.

**Settled: none.** No claim here has been argued twice.

## How it got here

- **Draft** — framed as evidence rather than surface: owns one rule, builds no export, consumes four. The delta against FIX-1385's goal check was made explicit early, because repeating a sibling's check is the obvious way this issue fails quietly.
- **Post-approval correction (two rules that could not go red).** Both were factual, both verified in the code before folding, and neither reopens an approved call. **BR-2** graded a `tools:` line that grants nothing: the task tools are capability controls, exempt from the fence and minted per resolver, so the twin that omitted the line would have filed just as happily (`task-tools-capability.ts:795-802`, `capability/types.ts:99-121`, `blocks/generator.ts:2760-2816`). The lab's draft carried the same sentence FIX-1385's draft carried — *registration makes a name resolvable, declaration grants its use* — which FIX-1385 had refuted in its own round 1. BR-2 now grades composition, and the door choice is recorded above. **BR-8** graded a membership gate the filing path does not have; it now grades the label check that does exist, on the action that has one, with the no-author arm beside it. D2's heading lost the words *the tools it declared* for the same reason FIX-1385's D3 did: the reasoning was wrong, the choice was not.
