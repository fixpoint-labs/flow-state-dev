# FIX-1457 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build any
piece; that's each child's own plan — and for FIX-1455, that's a whole lifecycle this one doesn't
run ([ER-15](BUSINESS-RULES.md)). IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![Lanes against time. Two input lanes carry the W3 floor and the W4 first cut, both landed. A ship fence band says the fence lifted on Sep 20 when W4's first cut landed, and that no W5 ship lane has opened yet. Below it the three lanes of the set: FIX-1458 carries a live in-flight bar across the now line, its spec in review; FIX-1455 is a dashed not-started line beginning just after the now line; the assemblies lane carries no bar at all. The figure's aria-label carries every lane.](figures/path.svg)

One lane carries a live bar: **FIX-1458's spec is in review, and it is still the only W5 work in
flight.** The ship fence [D4](DECISIONS.md#d4) defines has **lifted** — W4's first cut landed on
Sep 20 — so neither FIX-1455 nor the assemblies cut is fenced any more, and neither has started. The
dashed assemblies lane has no bar at all rather than a zero-width one — a row whose cut is undecided
has no duration to draw. The dependency graph is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure adds time to it, and the
critical path runs through FIX-1455 because the proof surface is the reference app.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1458** humans-in-seats | `spec` → explore/spec PR | The W3 seat slot · W4 boards and inventory · the manager-queue lab's drain story · [FIX-277](https://linear.app/fixpoint-labs/issue/FIX-277) HITL consumers | The **shape** of a human seat ([ER-1](BUSINESS-RULES.md), [ER-2](BUSINESS-RULES.md)), with the four walls answered or explicitly still open | FIX-1455's human-seat surfaces · the assemblies cut | Medium |
| **FIX-1455** kitchen-sink rebuild | **own epic lifecycle** | W4 first cut · existing Postgres-backed persistence · FIX-1458's seat shape · org identity from [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) | A runnable reference consumer that survives a redeploy ([ER-3](BUSINESS-RULES.md)) | The surface [ER-19](BUSINESS-RULES.md) is observed on — it is ER-19's **provisional** owner until the cut | Its own set |
| **FIX-XXX** working assemblies | not cut | W3 floor · W4 first cut · both children above | Reference surfaces that prove the composition ([ER-4](BUSINESS-RULES.md)) | The epic's wrap. If cut, ER-4 and [ER-19](BUSINESS-RULES.md) move here from FIX-1455 | Unknown |

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-20). The lanes
above carry the same state as a picture of time and are redrawn when it moves.

**The inputs from other epics, and their verified state as of 2026-09-20:** the **W3 floor**
(FIX-1351) has landed the pieces W5 needs. The **W4 first cut** (FIX-1407) has **landed** — the epic
is *In Review* and FIX-1381, FIX-1385, FIX-1394, FIX-1405, FIX-1408, FIX-1430 and FIX-1451 are all
Done; the two rows left open, FIX-1460 (a dead-code call) and FIX-1461 (a docs page), are Backlog
strays outside the first cut. W5 is a **sibling** of W4, never nested under it; the W3→W4→W5 chain
is unbroken.

## What unblocks what, from here

1. **FIX-1458's exploration produces a shape** → FIX-1455 can spec its human-seat surfaces, and the
   assemblies cut can be argued with something concrete in hand. It does **not** lift the ship fence.
   A shape only releases them once its **downstream-blocking walls** — the identity model and
   durable-hire persistence — are resolved or signed off open ([ER-18](BUSINESS-RULES.md)). An
   exploration that exits with either still open releases its dependants onto nothing.
2. **W4's first cut ships** (channel/org board → seat runs · assign team seats) → the ship fence
   lifts, FIX-1455's ship tickets may open, and the assemblies cut is made
   ([Open 3](DECISIONS.md#open)). **This happened on 2026-09-20** — the fence is down, and nothing
   downstream of it has been started.
3. **The assemblies cut is made** → ER-19's owner turns from provisional into committed, either
   staying with FIX-1455 or moving to the new row. If the cut names nothing outside FIX-1455's set,
   the row **closes** instead and W5 is two children.
4. **Org-bound execution is available** ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442),
   W4-side) → ER-19 becomes observable at all. W5 does not own this and cannot wrap without it.
5. **ER-19 is observed** → the epic wraps.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| Durable hire of a **human** seat | FIX-1458 and FIX-1455 | 1458 owns the identity; 1455 owns persisting it. 1455 must not settle the `principal:`-vs-own-kind wall by picking whatever its store makes easy |
| The **Waiting-on-you** surface | FIX-1458 and FIX-1455 | The state shape is 1458's ([ER-2](BUSINESS-RULES.md)); the rendering is 1455's. A UI need is not a reason to grow a status value ([ER-8](BUSINESS-RULES.md)) |
| The **manager-queue** drain story | FIX-1458 and [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) (W4, not a child) | Human seats plug into the same drain the lab proved. A second drain path is the parallel plane ER-6 forbids |
| **Org identity** on every assembly | Every child and [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) | Assemblies open under org identity, and [ER-19](BUSINESS-RULES.md) is not observable without it — so FIX-1442 is a **wrap-gating input**, not merely soft-related. The security pass itself is still **not** a W5 redesign |

## Not children, deliberately

[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) Collab park (later, and never the whole
of W5) · [FIX-277](https://linear.app/fixpoint-labs/issue/FIX-277) HITL consumers (consumed as a POC
spine) · [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) manager-queue lab and
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) org-never-optional (both W4-side; FIX-1442 is not a child but **does gate the wrap**, because [ER-19](BUSINESS-RULES.md) needs an org-bound assembly) ·
[FIX-1429](https://linear.app/fixpoint-labs/issue/FIX-1429), which is **FIX-1455's** child, not this
epic's. Linked from the rules, never re-parented.

## Wrap

When [ER-19](BUSINESS-RULES.md) holds — a person draining a row in an **org-bound** running
reference — and every row is terminal: run [ER-20](BUSINESS-RULES.md)'s **wrap-time sweep over the
shipped child diffs** for a new L1 type, a widened `TaskStatus` or a second work plane, run the
lessons pass over the set's review rounds, dispatch the docs polish over the Workforce pages the
children each edited in isolation, refresh the set table and the path one last time, and close the
epic PR unmerged.
FIX-1455 wraps on **its own** lifecycle; W5's wrap waits for that outcome but does not perform it.
