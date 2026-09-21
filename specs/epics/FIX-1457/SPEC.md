# FIX-1457 · W5: Workforce release QA — Devtool, a DevForce proof, multi-seat collab

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Epic · **an open set · 1 filed proof-producer, 2 named gaps** · Workforce: Layer 2 Abstraction ·
Goal 1 — foundation honesty / validate through real usage

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

![What's in the box: the objective is Workforce release QA, and the box holds three named exit proofs — ER-Devtool, a documented Devtool checklist green on a live hired Workforce; ER-DevForce, one DevForce path completing with a real artifact; and ER-Collab, two or more seats across at least one channel filing, assigning, draining and handing off. ER-Devtool is drawn as a solid held slot because FIX-1481 now owns three of its six rows and rows one to three ride FIX-1320; the other two are drawn as empty slots marked NO CHILD because nothing in the set produces them. Beneath the box sits the unchanged substrate they compose and must not extend: boards, inventory, manager-queue, org identity, dispatch honesty, and the references-versus-resources split FIX-1467 settled. A boundary line reads one user, one org. To the side, kitchen-sink FIX-1455 is drawn outside the box as a sibling epic that left the set. Below, a grow-into-later band, and below a fence, everything the set refuses to build — including the four invent-kills the recalibration added and the one it killed. The figure's aria-label carries every item.](figures/end-state.svg)

**Two of the three slots are still empty, and the third holds a ticket, not a result.** That is what
the figure is for: the done condition is three proofs, one has a producer and none has been run.
Beneath them is the substrate they compose and may not extend ([ER-4](BUSINESS-RULES.md)).
Kitchen-sink sits **outside** the box — a sibling epic, not a member ([D9](DECISIONS.md#d9)).

## The set · as of 2026-09-21

A dated snapshot of the reviewed scope, and **an open set** ([ER-23](BUSINESS-RULES.md)) — where a
proof still has no ticket it is shown as a named gap rather than left out. **Filing a child is the
normal course of this epic, not a re-scope.** Live state is in Linear and the implementation PRs.

| Issue | What it delivers | Why the set needs it | Status |
|---|---|---|---|
| [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) · Devtool checklist | **ER-Devtool** — the six-area checklist green on a live hired Workforce: roster, channels, boards, inventory, parked rows, resources + references, **with no special wrapper** | The inspector is how the other two proofs are observed at all. Without it, "it worked" is asserted from a log | **Backlog** · filed 2026-09-20. **The first filed proof-producer**, and it owns **three of the six rows** — parked reasons, references vs resources, org-level inventory. **Rows 1–3 ride [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320)**, an epic W5 does not run. That is the split [Sign-off 1](#sign-off) recommended, enacted three-and-three. **Nothing observed yet**; two of six still fail as written |
| FIX-XXX · DevForce proof path | **ER-DevForce** — the **thinnest** DevForce path that completes and produces a **real artifact**, seats and channels used honestly | A reference app shows Workforce *can* run. A Lab shipping a work product is the evidence a launch claim rests on | **No child — named gap.** Not filed. First build slice is Done ([FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426), [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410)); an end-to-end path has no owner. Scope fenced by [ER-11](BUSINESS-RULES.md) |
| FIX-XXX · multi-seat collab scenario | **ER-Collab** — one graded scenario: ≥2 seats across ≥1 channel, work filed → assigned → drained, and a cross-seat handoff or reply **observed in Devtool** | Multi-seat is the composition W3 and W4 exist to enable and the one nothing has run | **No child — named gap.** Not filed. Composes boards ([FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385)), inventory ([FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)), manager-queue ([FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430)) |
| [FIX-1467](https://linear.app/fixpoint-labs/issue/FIX-1467) · `references/` vs `resources/` | The isolation convention: read-only handbooks ambient by tree, mutable resources by explicit grant | Settled the noun before anything teaches it. **Not a proving leg** — it never advanced the done condition | **Done · merged 2026-09-20.** Noun is `references/`, migration is `clearShadowedReferences`, grant model settled. **[ER-18](BUSINESS-RULES.md) is met** by it |
| [FIX-1468](https://linear.app/fixpoint-labs/issue/FIX-1468) · `ReadOnlyResourceRef` | A handle type that omits `writeContent` for read-only documents | FIX-1467's deliberately-deferred type change. Additive, independent | **Backlog** · filed 2026-09-20 as a spin-off. **Not a proving leg** |
| [FIX-1469](https://linear.app/fixpoint-labs/issue/FIX-1469) · `goals/` labs migration + KS documents | Decides the `goals/` labs document migration; would give kitchen-sink workforce documents | FIX-1467's deferred step S7. **Its kitchen-sink half is now stale** — it was filed while "upgrade kitchen-sink" was a W5 leg, and that leg left with [D9](DECISIONS.md#d9) | **Backlog** · filed 2026-09-20. **Not a proving leg.** Its KS half belongs to [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455); flagged, not moved |
| [FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474) · composed `@seat` notify + board file | A named path to notify another seat **while** filing on a board, composing the existing channel, dispatch and board primitives | Release polish for real collab. **Explicitly not an ER-Collab gate** — its own body keeps ER-Collab on today's separate paths until this lands | **Backlog** · filed 2026-09-20. **Not a proving leg.** Soft-related. Its own invent-kills forbid a new message-board package as W5 substrate ([ER-25](BUSINESS-RULES.md)) |
| ~~[FIX-1458](https://linear.app/fixpoint-labs/issue/FIX-1458)~~ · humans-in-seats | Would have shaped the multi-person org chart | **Canceled 2026-09-20**, [#1955](https://github.com/fixpoint-labs/flow-state-dev/pull/1955) closed unmerged. Kept so a reader sees it was considered and dropped | **Canceled** · not re-specced, not reopened, no longer a child |

**1 done · 2 backlog spin-offs · 1 backlog polish child · 1 filed proof-producer, not started · 2
named gaps with no child · 1 canceled.**

**Two of the three exit proofs still have no producer, and nothing has been proved.** FIX-1481 is
the first filed proof-producer, and it is Backlog — a ticket, not a run, and covering half of one
proof. FIX-1467 is Done and it settled a convention; it did not advance the done condition, and
saying so is the point of this row. FIX-1468, FIX-1469 and FIX-1474 are not legs either. So the
honest reading of this table is that W5 has begun to staff its objective and **has still proved
nothing**. Filing the remaining two gaps is the next thing that has to happen
([Open 1](DECISIONS.md#open)).
**Kitchen-sink is not in this table by design** — FIX-1455 is a sibling epic, soft-related, running
its own lifecycle ([D9](DECISIONS.md#d9), [ER-15](BUSINESS-RULES.md)).

## How the issues flow into each other

```mermaid
flowchart LR
  W3["W3 floor · FIX-1351"] -.->|"seats, channels, skills on disk"| S
  W4["W4 first cut · FIX-1407"] -.->|"boards, inventory, dispatch, org identity"| S
  R["FIX-1467 · references vs resources"] -->|"the settled isolation noun"| S["a live hired Workforce"]
  S -->|"a world to inspect"| T["FIX-1481 · Devtool checklist"]
  S -->|"seats and channels to run"| F["FIX-XXX · DevForce proof path"]
  S -->|"two seats and a channel"| C["FIX-XXX · multi-seat collab"]
  T -->|"the lens both are observed through"| F
  T --> C
  T --> P["the done condition · three exit proofs"]
  F --> P
  C --> P
  K["FIX-1455 · kitchen-sink"] -.->|"sibling epic · left the set"| P
  X["FIX-1458 · canceled Sep 20"] -.->|"its invent-kills, as locked constraint"| S
  I["FIX-1320 · flow instances · Spec Approved"] -.->|"checklist rows 1–3 ride it · W5 does not run it"| T
  N["FIX-1474 · @seat notify + board file"] -.->|"soft-related polish · not an ER-Collab gate"| C
  classDef done stroke-width:2px
  classDef filed stroke-width:2px
  classDef proposed stroke-dasharray:4 3
  class R done
  class T,N filed
  class F,C proposed
  class K,X,I proposed
```

An edge is what one node hands the next. **The two dashed nodes in the middle are the named gaps**
— all three inbound edges to the done condition matter equally, and two have no owner. The Devtool
checklist is drawn upstream of the other two because both are *observed in Devtool*, which makes it
the one that cannot be last; it is now solid because FIX-1481 holds it, with a dashed edge in from
FIX-1320 for the three rows W5 does not own. FIX-1474 hangs off collab as polish, not as a gate.
Kitchen-sink is dashed and outside the chain: it hands the set nothing and the set owes it nothing.

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

**Open: one**, and it is structural — two of the three exit proofs have no producer, and the third
has a ticket and no run ([Open 1](DECISIONS.md#open)). Reasoning and what lost:
[DECISIONS.md](DECISIONS.md). The rules every child obeys: [BUSINESS-RULES.md](BUSINESS-RULES.md).
The order the work runs in: [PLAN.md](PLAN.md). The reader-facing prose the set owes, and who
publishes it: [DOCS.md](DOCS.md). What it is written on top of: [EVOLUTION.md](EVOLUTION.md).
