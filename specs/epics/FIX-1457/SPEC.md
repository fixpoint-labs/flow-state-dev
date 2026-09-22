# FIX-1457 · W5: Workforce release QA — Devtool, a DevForce proof, multi-seat collab

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Epic · **an open set · all three exit proofs now have a producer, none has been run** ·
Workforce: Layer 2 Abstraction · Goal 1 — foundation honesty / validate through real usage

> **Recalibrated by the owner on 2026-09-20 (18:05Z).** W5 is **Workforce release QA / polish** —
> get L2 tested and proven ready to ship. The done condition is **three named exit proofs**
> ([D6](DECISIONS.md#d6)), replacing the previous three-surfaces framing. **Kitchen-sink left the
> set** ([D9](DECISIONS.md#d9)); **proof-via-DevForce came in** ([D8](DECISIONS.md#d8)), reversing a
> standing invent-kill. The owner's words for the north star: *"Workforce is feature-complete enough
> that a finish-line Lab (DevForce) can actually build something with seats collaborating across
> channel(s), and Devtool can inspect that world without special wrappers."*

## Four teams, before and after

| A team that… | Today | After this epic |
|---|---|---|
| **is deciding whether Workforce is ready to ship** | "Ready" is a claim standing on architecture documents. Nothing has run a workforce and produced anything | Three named proofs, each pass/fail: the inspector is green, a Lab shipped a real artifact, two seats collaborated |
| **needs to watch what its workers are doing** | Opens a session and reads its stream. There is no roster, no channel list and no board browser — and a parked row's reason is inside a JSON expander | Opens Devtool on a live hired Workforce and reads the roster, the channels, the boards, the inventory and the parked rows, **without a special wrapper** |
| **wants to know a workforce can actually build something** | The Labs have a first build slice and no end-to-end run. Whether seats can ship a work product is untested | One DevForce path completes and hands back a **real artifact** — code, a PR, a work product — with seats and channels used honestly |
| **runs more than one seat** | Multi-seat is a composition the docs describe | ≥2 seats across ≥1 channel: work filed, assigned, drained, and a cross-seat handoff observed |

**Why now.** W3 made a Workforce **describable** and W4 made work **reach** a seat. Both ended in a
claim about what exists. Nothing between them and a launch is more substrate
([D1](DECISIONS.md#d1)) — it is **evidence**, and evidence is what a QA epic produces.

## What's in the box

![What's in the box: the objective is Workforce release QA, and the box holds three named exit proofs — ER-Devtool, a documented Devtool checklist green on a live hired Workforce; ER-DevForce, one DevForce path completing with a real artifact; and ER-Collab, two or more seats across at least one channel filing, assigning, draining and handing off. As of 2026-09-22 all three are drawn as solid held slots because each has a filed child, and none is drawn as passed because none has been run: ER-Devtool names FIX-1481 for rows 4 and 6 and FIX-1502 for row 5, with rows 1 to 3 riding FIX-1320; ER-DevForce names FIX-1496, in spec review, with its artifact cut to one automated leg pushed to a bare clone and the credentialed pull-request leg documented as the human release run; ER-Collab names FIX-1497, Backlog with no spec. Beneath the box sits the unchanged substrate they compose and must not extend: boards, inventory, manager-queue, org identity, dispatch honesty, and the references-versus-resources split FIX-1467 settled. A boundary line reads one user, one org. To the side, kitchen-sink FIX-1455 is drawn outside the box as a sibling epic that left the set, and below it a box headed open, the owner's call, asking whether W5 exits on five of the six checklist rows given that row 5 is blocked by FIX-1486 outside W5. Below, a grow-into-later band, and below a fence, everything the set refuses to build — including the invent-kills the recalibration added and the one it killed. The figure's aria-label carries every item.](figures/end-state.svg)

**All three slots now hold a ticket, and no slot holds a result.** That is what the figure is for:
the done condition is three proofs, each is staffed as of 2026-09-22, and **none has been run**.
Beneath them is the substrate they compose and may not extend ([ER-4](BUSINESS-RULES.md)).
Kitchen-sink sits **outside** the box — a sibling epic, not a member ([D9](DECISIONS.md#d9)).

## The set · as of 2026-09-22

A dated snapshot of the reviewed scope, and **an open set** ([ER-23](BUSINESS-RULES.md)).
**Filing a child is the normal course of this epic, not a re-scope** — and on 2026-09-22 three more
were filed, which is what this snapshot carries. Live state is in Linear and the implementation PRs.

| Issue | What it delivers | Why the set needs it | Status |
|---|---|---|---|
| [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) · Devtool checklist | **ER-Devtool** (with FIX-1502) — the six-area checklist green on a live hired Workforce: roster, channels, boards, inventory, parked rows, resources + references, **with no special wrapper** | The inspector is how the other two proofs are observed at all. Without it, "it worked" is asserted from a log | **In Spec Review** · spec [#2025](https://github.com/fixpoint-labs/flow-state-dev/pull/2025). Owns **rows 4 and 6** — parked reasons, references vs resources — and **verifies all six**. **Row 5 is [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)'s**, not its own: the 2026-09-20 three-and-three split was **corrected on 2026-09-22**. **Rows 1–3 ride [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320)**, an epic W5 does not run. **Nothing observed yet**; rows 4 and 6 still fail as written |
| [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) · org-level inventory view | **ER-Devtool row 5** — a reader and view over `inventory/seats/*`, `inventory/channels/*`, `inventory/members/*`, so *who exists* and *who is in which channel* are answerable for a live org | The row FIX-1481's deferral left with no owner. Filed so the checklist is not silently five rows of six | **Backlog** · filed 2026-09-22, no spec. **Blocked by [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486)** — **nothing can *name* an org**, so no surface accepts *show me organization X*; that is the missing axis, and building it inside W5 is the [ER-25](BUSINESS-RULES.md) growth the owner fenced |
| [FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496) · DevForce proof path | **ER-DevForce** — the **thinnest** DevForce path that completes and produces a **real artifact**, seats and channels used honestly | A reference app shows Workforce *can* run. A Lab shipping a work product is the evidence a launch claim rests on | **In Spec Review** · spec [#2023](https://github.com/fixpoint-labs/flow-state-dev/pull/2023), head `25e7507`, direction gate open. A four-gap delta on `goals/devforce-lab/`, not a new Lab tree. **Which artifact counts is cut**: one automated leg pushing to a bare clone, the credentialed PR leg documented as the human release run ([ER-DevForce](BUSINESS-RULES.md#er-devforce)) |
| [FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497) · multi-seat collab scenario | **ER-Collab** — one graded scenario: ≥2 seats across ≥1 channel, work filed → assigned → drained, and a cross-seat handoff or reply **observed in Devtool** | Multi-seat is the composition W3 and W4 exist to enable and the one nothing has run | **Backlog** · filed 2026-09-22, **no spec yet**. Held behind [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) — *observed in Devtool* is what makes it depend on ER-Devtool. Composes boards ([FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385)), inventory ([FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)), manager-queue ([FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430)) |
| [FIX-1467](https://linear.app/fixpoint-labs/issue/FIX-1467) · `references/` vs `resources/` | The isolation convention: read-only handbooks ambient by tree, mutable resources by explicit grant | Settled the noun before anything teaches it. **Not a proving leg** — it never advanced the done condition | **Done · merged 2026-09-20.** Noun is `references/`, migration is `clearShadowedReferences`, grant model settled. **[ER-18](BUSINESS-RULES.md) is met** by it |
| [FIX-1468](https://linear.app/fixpoint-labs/issue/FIX-1468) · `ReadOnlyResourceRef` | A handle type that omits `writeContent` for read-only documents | FIX-1467's deliberately-deferred type change. Additive, independent | **Backlog** · filed 2026-09-20 as a spin-off. **Not a proving leg** |
| [FIX-1469](https://linear.app/fixpoint-labs/issue/FIX-1469) · `goals/` labs migration + KS documents | Decides the `goals/` labs document migration; would give kitchen-sink workforce documents | FIX-1467's deferred step S7. **Its kitchen-sink half is now stale** — it was filed while "upgrade kitchen-sink" was a W5 leg, and that leg left with [D9](DECISIONS.md#d9) | **Backlog** · filed 2026-09-20. **Not a proving leg.** Its KS half belongs to [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455); flagged, not moved |
| [FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474) · composed `@seat` notify + board file | A named path to notify another seat **while** filing on a board, composing the existing channel, dispatch and board primitives | Release polish for real collab. **Explicitly not an ER-Collab gate** — its own body keeps ER-Collab on today's separate paths until this lands | **Backlog** · filed 2026-09-20. **Not a proving leg.** Soft-related. Its own invent-kills forbid a new message-board package as W5 substrate ([ER-25](BUSINESS-RULES.md)) |
| ~~[FIX-1458](https://linear.app/fixpoint-labs/issue/FIX-1458)~~ · humans-in-seats | Would have shaped the multi-person org chart | **Canceled 2026-09-20**, [#1955](https://github.com/fixpoint-labs/flow-state-dev/pull/1955) closed unmerged. Kept so a reader sees it was considered and dropped | **Canceled** · not re-specced, not reopened, no longer a child |

**1 done · 4 proof-producers filed (2 in spec review, 2 Backlog) · 2 backlog spin-offs · 1 backlog
polish child · 0 named gaps · 1 canceled.**

**Every exit proof now has a producer, and nothing has been proved.** That is the whole change since
the 2026-09-21 snapshot, and the second half of it has not moved at all: two producers are in spec
review, two are Backlog without a spec, and **no checklist row, artifact or scenario has been
observed on a running workforce**. FIX-1467 is Done and it settled a convention; it did not advance
the done condition, and saying so is the point of its row. FIX-1468, FIX-1469 and FIX-1474 are not
legs either. So the staffing gap that was [Open 1](DECISIONS.md#open) is closed, and what replaces
it is narrower and real: **row 5 of the Devtool checklist is blocked outside W5**, which puts
*whether W5 exits on five rows of six* in front of the owner ([Open 1](DECISIONS.md#open)).
**Kitchen-sink is not in this table by design** — FIX-1455 is a sibling epic, soft-related, running
its own lifecycle ([D9](DECISIONS.md#d9), [ER-15](BUSINESS-RULES.md)).

## How the issues flow into each other

```mermaid
flowchart LR
  W3["W3 floor · FIX-1351"] -.->|"seats, channels, skills on disk"| S
  W4["W4 first cut · FIX-1407"] -.->|"boards, inventory, dispatch, org identity"| S
  R["FIX-1467 · references vs resources"] -->|"the settled isolation noun"| S["a live hired Workforce"]
  S -->|"a world to inspect"| T["FIX-1481 · Devtool checklist · rows 4 and 6"]
  S -->|"seats and channels to run"| F["FIX-1496 · DevForce proof path"]
  S -->|"two seats and a channel"| C["FIX-1497 · multi-seat collab"]
  F -->|"the live hired Workforce every run is graded on · ER-26"| T
  T -->|"the lens it is observed through"| C
  V["FIX-1502 · org-level inventory · row 5"] -->|"checklist row 5"| T
  B["FIX-1486 · org identity on list reads"] -.->|"blocks it · outside W5"| V
  T --> P["the done condition · three exit proofs"]
  F --> P
  C --> P
  K["FIX-1455 · kitchen-sink"] -.->|"sibling epic · left the set"| P
  X["FIX-1458 · canceled Sep 20"] -.->|"its invent-kills, as locked constraint"| S
  I["FIX-1320 · flow instances · Spec Approved"] -.->|"checklist rows 1–3 ride it · W5 does not run it"| T
  N["FIX-1474 · @seat notify + board file"] -.->|"soft-related polish · not an ER-Collab gate"| C
  classDef done stroke-width:2px
  classDef proposed stroke-dasharray:4 3
  class R done
  class K,X,I,B proposed
```

An edge is what one node hands the next. **No node in the chain is a placeholder any more** — the
two `FIX-XXX` gaps became FIX-1496 and FIX-1497 on 2026-09-22, and row 5 gained FIX-1502. A heavy
border is done and a dashed one is outside the set; the filed-but-unstarted children are drawn
plain, because a ticket is neither. Two edges are new and both are real orderings rather than
polish: FIX-1496 hands the checklist the **live hired Workforce its run is graded on**
([ER-26](BUSINESS-RULES.md#er-26)) — which fences the run, not FIX-1481's code — and FIX-1502 hands
it row 5. The one dashed edge in from below is **FIX-1486 blocking FIX-1502**, an epic W5 does not
run, beside the dashed FIX-1320 edge for rows 1–3. FIX-1474 hangs off collab as polish, not as a
gate. Kitchen-sink is dashed and outside the chain: it hands the set nothing and the set owes it
nothing.

## What stays as it is

- **Kitchen-sink** ([FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455)) — a **sibling**
  epic on its own lifecycle. Not a child, not in the set, not specced here
  ([D9](DECISIONS.md#d9)).
- **The substrate.** Boards ([FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385)), inventory
  ([FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)), manager-queue
  ([FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430)), org never optional
  ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442)), dispatch honesty
  ([FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440)). Composed, never re-decided
  ([D1](DECISIONS.md#d1)).
- **CyberForce.** DevForce enters as the proof; the pentest Lab does not this cycle
  ([D8](DECISIONS.md#d8)).
- **Collab rooms** ([FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341)), the skills
  register, the memory story, package cohesion.
- **Everything the cancellation deferred** ([Grow into later](DECISIONS.md#later)) — multi-user, an
  org chart of people, originator ≠ reviewer, durable `reviewedBy:`, multi-principal boards. Parked
  with a revisit condition, and **not** open questions.

## Sign off

**The objective gate is owed on this re-cut.** The recalibration is explicit that it is *"Not owner
merge approval… direction for the EM"* — so it sets the direction and does not discharge the gate.
Approving here certifies the objective and the three exit proofs, nothing below them.

**The recalibration answered the previous three asks and they are not carried forward.** The items
it left under *Still open* — the exact Devtool checklist rows, which DevForce artifact counts,
whether CyberForce gets a parallel thin proof this cycle — are explicitly **not blocking EM start on
polish**, so none of them is an ask here. The checklist rows are drafted below as the EM's own work
([ER-Devtool](BUSINESS-RULES.md#er-devtool)).

**One ask, answered in practice on 2026-09-20 — confirm or correct.** It is kept in full because the
answer was enacted by a filing rather than stated, and because it commits a cycle's capacity.

1. **Does W5 file its own Devtool child, or does ER-Devtool ride
   [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320)?**
   - **Plain terms.** FIX-1320 (*Flow instances first-class*, **Spec Approved**) already owns
     Devtool's instance and session surfaces — its INST-4 is *"Devtool instance list/switch/sessions
     and request inspection,"* and its own text says completion *"requires actual UI verification on
     the real Devtool surface"* and that the proof *"is planned, not run."* Four of ER-Devtool's six
     areas read on exactly those surfaces. Two teams could end up building one inspector.
   - **Trade-off.** Riding FIX-1320 means one Devtool body of work and one UI verification pass, but
     W5's exit proof then depends on an epic W5 does not run, and ER-Devtool's workforce-specific
     rows — inventory, parked-row reasons, references vs resources — are outside FIX-1320's stated
     scope and would have to be added to it. Filing W5's own child keeps the proof in W5's hands and
     risks two passes over the same panel.
   - **Recommendation: ride FIX-1320 for the instance/session surfaces and file a small W5 child for
     the four workforce-specific rows.** FIX-1320's UI verification is unrun and W5 needs it run;
     that is one pass, not two, and the rows it does not cover are genuinely W5's.
   - **What would change my mind:** FIX-1320 slipping past this cycle. Then W5's proof is hostage to
     it, and a self-contained W5 Devtool child is worth the duplication.
   - **If wrong:** one Devtool pass is done twice, or W5's exit proof waits on another epic's
     schedule. Both are real cost; neither is incorrect behaviour.
   - **What happened.** [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) was filed on
     2026-09-20 taking exactly this recommendation — **three** rows to the W5 child (parked reasons,
     references vs resources, org-level inventory) and **three** riding FIX-1320, not the four-and-four
     the ask estimated. FIX-1320 is still *Spec Approved* and its UI verification is still unrun, so
     the *changes my mind* condition has not fired. **Say so here if the split is wrong**; nothing has
     been built against it.
   - **Corrected 2026-09-22 — it is two-and-one-and-three, not three-and-three.** FIX-1481's spec
     defers the org-level inventory row, so its share is **rows 4 and 6**; row 5 went to
     [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) and is **blocked outside W5** by
     [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486). The *if wrong* above named two
     costs and this is the second one, arriving on a row nobody expected: **half of the checklist
     now waits on two epics W5 does not run**, FIX-1320 and FIX-1486. The recommendation itself
     still holds; what moved is how much of the proof sits outside W5's hands, and that is what
     [Open 1](DECISIONS.md#open) now asks about.

**Not asked, reported as news.** [D8](DECISIONS.md#d8) — **proof-via-DevForce is in**, and the
invent-kill that said *don't treat W5 as build DevForce* is **dead**; unbounded Lab delivery stays
out. [D9](DECISIONS.md#d9) — kitchen-sink left the set. [ER-18](BUSINESS-RULES.md) is **met** by
FIX-1467's merge. [ER-15](BUSINESS-RULES.md) was **rewritten**: this epic drives no child epic.
[D7](DECISIONS.md#d7) (one user, one org) and [D2](DECISIONS.md#d2) (humans are not board drainers)
stand unchanged. **[FIX-1469](https://linear.app/fixpoint-labs/issue/FIX-1469)'s kitchen-sink half is
stale** — flagged for routing to FIX-1455, not moved. **Two children were filed on 2026-09-20 and are
now in the set table**: [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481), the Devtool
child, and [FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474), soft-related polish that is
**not** an ER-Collab gate.

**News, as of 2026-09-22.** **Three more children were filed and the last two named gaps closed**:
[FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496) (ER-DevForce, *In Spec Review*),
[FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497) (ER-Collab, Backlog) and
[FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) (checklist row 5, Backlog). Filing them
is [ER-23](BUSINESS-RULES.md) normal course, not a re-scope. **One of the recalibration's three
*Still open* items is answered**: *which DevForce artifact counts* is cut by FIX-1496 — one
automated leg, the credentialed PR leg documented as the human release run — and that cut is still
its own gate's to approve, not this document's. The other two are unmoved. **[ER-26](BUSINESS-RULES.md#er-26)
is new**: no exit proof's *run* is graded before FIX-1496 stands a live workforce up, which fences
the runs and explicitly not FIX-1481's or FIX-1502's code PRs.

**Open: one**, and it is narrower than the one it replaces — the staffing gap closed, and what is
left is whether W5 exits on five checklist rows of six ([Open 1](DECISIONS.md#open)). Reasoning and what lost:
[DECISIONS.md](DECISIONS.md). The rules every child obeys: [BUSINESS-RULES.md](BUSINESS-RULES.md).
The order the work runs in: [PLAN.md](PLAN.md). The reader-facing prose the set owes, and who
publishes it: [DOCS.md](DOCS.md). What it is written on top of: [EVOLUTION.md](EVOLUTION.md).
