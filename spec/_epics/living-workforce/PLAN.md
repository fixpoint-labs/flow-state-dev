# FIX-1457 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build any
piece; that's each child's own plan — and for FIX-1455, that's a whole lifecycle this one doesn't
run ([ER-15](BUSINESS-RULES.md)). IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![Lanes against time. Two input lanes carry the W3 floor, landed, and the W4 first cut, still in development. A ship fence band says W4's first cut has not shipped, so every W5 ship lane is fenced. Below it the three lanes of the set: FIX-1458 opens a bar at the now line, the only lane that crosses the fence; FIX-1455 is a dashed line beginning after the fence lifts; the assemblies lane carries no bar at all. The figure's aria-label carries every lane.](figures/path.svg)

One lane crosses the now line. **FIX-1458 is the whole of this cycle's W5 work** — everything else
is behind the ship fence, and the fence lifts on an event in another epic, not on anything a child
here can do ([D4](DECISIONS.md#d4)). The dashed assemblies lane has no bar at all rather than a
zero-width one: a row whose cut is undecided has no duration to draw. The dependency graph itself is
in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1458** humans-in-seats | `spec` → explore/spec PR | The W3 seat slot · W4 boards and inventory · the manager-queue lab's drain story · [FIX-277](https://linear.app/fixpoint-labs/issue/FIX-277) HITL consumers | The **shape** of a human seat ([ER-1](BUSINESS-RULES.md), [ER-2](BUSINESS-RULES.md)), with the four walls answered or explicitly still open | FIX-1455's human-seat surfaces · the assemblies cut | Medium |
| **FIX-1455** kitchen-sink rebuild | **own epic lifecycle** | W4 first cut · existing Postgres-backed persistence · FIX-1458's seat shape | A runnable reference consumer that survives a redeploy ([ER-3](BUSINESS-RULES.md)) | The surface ER-19 could be proved on | Its own set |
| **FIX-XXX** working assemblies | not cut | W3 floor · W4 first cut · both children above | Reference surfaces that prove the composition ([ER-4](BUSINESS-RULES.md)) and, probably, [ER-19](BUSINESS-RULES.md) | The epic's wrap | Unknown |

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-19). The lanes
above carry the same state as a picture of time and are redrawn when it moves.

**The inputs from other epics, and their verified state as of 2026-09-19:** the **W3 floor**
(FIX-1351) has landed the pieces W5 needs. The **W4 first cut** (FIX-1407) is *In Development* and
has **not** shipped — FIX-1385, FIX-1394, FIX-1408 and FIX-1451 are Done, FIX-1405 is In Review,
FIX-1381 In Spec Review, FIX-1430 Spec Approved, and FIX-1460 and FIX-1461 are Backlog. W5 is a
**sibling** of W4, never nested under it; the W3→W4→W5 chain is unbroken.

## What unblocks what, from here

1. **FIX-1458's exploration produces a shape** → FIX-1455 can spec its human-seat surfaces, and the
   assemblies cut can be argued with something concrete in hand. It does **not** lift the ship fence.
2. **W4's first cut ships** (channel/org board → seat runs · assign team seats) → the ship fence
   lifts, FIX-1455's ship tickets may open, and the assemblies cut is made
   ([Open 3](DECISIONS.md#open)).
3. **The assemblies cut is made** → ER-19 gets an owner, and the set stops having a structural gap.
   If the cut names nothing outside FIX-1455's set, the row **closes** instead and W5 is two children.
4. **ER-19 is observed** → the epic wraps.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| Durable hire of a **human** seat | FIX-1458 and FIX-1455 | 1458 owns the identity; 1455 owns persisting it. 1455 must not settle the `principal:`-vs-own-kind wall by picking whatever its store makes easy |
| The **Waiting-on-you** surface | FIX-1458 and FIX-1455 | The state shape is 1458's ([ER-2](BUSINESS-RULES.md)); the rendering is 1455's. A UI need is not a reason to grow a status value ([ER-8](BUSINESS-RULES.md)) |
| The **manager-queue** drain story | FIX-1458 and [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) (W4, not a child) | Human seats plug into the same drain the lab proved. A second drain path is the parallel plane ER-6 forbids |
| **Org identity** on every assembly | Every child and [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) | Assemblies open under org identity. The security pass is soft-related and is **not** a W5 redesign |

## Not children, deliberately

[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) Collab park (later, and never the whole
of W5) · [FIX-277](https://linear.app/fixpoint-labs/issue/FIX-277) HITL consumers (consumed as a POC
spine) · [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) manager-queue lab and
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) org-never-optional (both W4-side) ·
[FIX-1429](https://linear.app/fixpoint-labs/issue/FIX-1429), which is **FIX-1455's** child, not this
epic's. Linked from the rules, never re-parented.

## Wrap

When [ER-19](BUSINESS-RULES.md) holds and every row is terminal: run the lessons pass over the set's
review rounds, dispatch the docs polish over the Workforce pages the children each edited in
isolation, refresh the set table and the path one last time, and close the epic PR unmerged.
FIX-1455 wraps on **its own** lifecycle; W5's wrap waits for that outcome but does not perform it.
