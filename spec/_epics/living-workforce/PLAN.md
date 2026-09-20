# FIX-1457 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build any
piece; that's each child's own plan — and for FIX-1455, that's a whole lifecycle this one doesn't
run ([ER-15](BUSINESS-RULES.md)). IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n). **The set is open** ([ER-23](BUSINESS-RULES.md)) —
lanes are added here as children are filed, and that is the normal course of this epic.

## The path

![Lanes against time. Two input lanes carry the W3 floor and the W4 first cut, both landed. A ship fence band says the fence lifted on Sep 20 when W4's first cut landed. Below it the rows of the set: FIX-1467 carries a live in-flight bar across the now line, its spec in review; FIX-1455 is a dashed not-started line beginning just after the now line; two unfiled lanes, devtool observability and basic DevForce, carry no bars at all and are marked as having no child; and a short terminated lane for FIX-1458 ends at Sep 20 marked canceled. A note says more lanes are expected. The figure's aria-label carries every lane.](figures/path.svg)

One lane carries a live bar: **FIX-1467's spec is in review, and it is the only W5 work in flight.**
The two lanes with **no bar and no ticket** are the objective's other two proving surfaces — they
have no duration because they have no owner, which is the schedule fact worth reading here. The ship
fence [D4](DECISIONS.md#d4) defines **lifted** on Sep 20, so nothing downstream is fenced any more;
it simply has not started. The dependency graph is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1467** references vs resources | `spec` → explore/spec PR | W3's `resources:` convention · [FIX-1381](https://linear.app/fixpoint-labs/issue/FIX-1381)'s per-seat grant · [FIX-1354](https://linear.app/fixpoint-labs/issue/FIX-1354) resources-file convention · sandbox mounts ([FIX-1382](https://linear.app/fixpoint-labs/issue/FIX-1382)) | The **isolation convention**: read-only handbooks ambient by tree, mutable resources by explicit grant, with the migration named ([ER-18](BUSINESS-RULES.md)) | The noun FIX-1455 teaches and declares seats with | Medium |
| **FIX-1455** kitchen-sink rebuild | **own epic lifecycle** | W4 first cut · existing Postgres-backed persistence · FIX-1467's convention · org identity from [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) | **Proving surface 1** — a runnable reference consumer whose hired team survives a redeploy ([ER-3](BUSINESS-RULES.md)) | The running Workforce the other two surfaces observe and extend | Its own set |
| **FIX-XXX** devtool observability | **not filed** | A running Workforce · the existing devtool app and `@flow-state-dev/devtool` package · SSE item/content streaming | **Proving surface 2** — a run watched **as it unfolds** across channels and workers ([ER-19](BUSINESS-RULES.md)b) | The lens the DevForce evidence is seen through, and how the other surfaces are tested at all | Unknown |
| **FIX-XXX** basic DevForce | **not filed** | The kitchen-sink conventions · the devtool view · the Done first slice ([FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426), [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410)) | **Proving surface 3** — one real configuration running one genuine task end to end ([ER-19](BUSINESS-RULES.md)c) | The epic's wrap | Unknown · **and the size is the ask** ([D6](DECISIONS.md#d6)) |
| ~~**FIX-1458**~~ humans-in-seats | — | — | **Canceled 2026-09-20.** Its invent-kills survive as [D2](DECISIONS.md#d2); its product half is [deferred](DECISIONS.md#later) | Nothing. Not re-specced, not reopened | — |

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-20). The lanes
above carry the same state as a picture of time and are redrawn when it moves.

**The inputs from other epics, and their verified state as of 2026-09-20:** the **W3 floor**
(FIX-1351) has landed the pieces W5 needs, including DevForce's first build slice
([FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426), Done). The **W4 first cut** (FIX-1407)
has **landed** — the epic is *In Review* and FIX-1381, FIX-1385, FIX-1394, FIX-1405, FIX-1408,
FIX-1430 and FIX-1451 are all Done; the two rows left open, FIX-1460 (a dead-code call) and FIX-1461
(a docs page), are Backlog strays outside the first cut. W5 is a **sibling** of W4, never nested
under it; the W3→W4→W5 chain is unbroken.

## What unblocks what, from here

1. **The two gaps are filed** → the done condition becomes reachable at all. **This is first, and it
   is not a technical dependency** — [ER-19](BUSINESS-RULES.md)'s legs (b) and (c) have no producer,
   so until tickets exist W5 cannot finish however well its filed rows go
   ([Open 1](DECISIONS.md#open)).
2. **FIX-1467's exploration produces the convention** → FIX-1455 can rebuild against a settled noun.
   Only once its **downstream-blocking walls** — the noun and migration, and the grant model — are
   resolved or signed off open ([ER-18](BUSINESS-RULES.md)). An exploration that exits with either
   open releases its dependants onto nothing.
3. **W4's first cut ships** → the ship fence lifts. **This happened on 2026-09-20**; nothing
   downstream of it has started.
4. **FIX-1455 runs** → there is a Workforce to observe, so the devtool surface has a subject and the
   DevForce configuration has conventions to run on.
5. **Org-bound execution is available** ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442),
   W4-side) → ER-19 is observable at all. W5 does not own this and cannot wrap without it.
6. **All three artifacts exist and are watched** → the epic wraps.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The **isolation noun** | FIX-1467 and FIX-1455 | 1467 decides which noun holds read-only handbooks and what the migration does; 1455 **teaches** it in the reference app. 1455 must not settle it by shipping whichever name its templates already use ([ER-18](BUSINESS-RULES.md)) |
| **What a run looks like** | FIX-1455 and the devtool gap | The activity is emitted by the running Workforce; the rendering is devtool's. **A UI need is never a reason to grow a status value** ([ER-8](BUSINESS-RULES.md)), and the Waiting-on-you column is a view over parked + reason |
| **Session scope** | FIX-1455 and the devtool gap | A session belongs to one user, so a board answered into cannot be session-scoped to the seat's session; the ledger is org-scoped. Established by the canceled explore's POC and [recorded here](DECISIONS.md) rather than re-derived — devtool renders **across** sessions |
| **Lab as evidence, not product** | The DevForce gap and FIX-1455 | DevForce runs **beside** the kitchen-sink and never inside it ([ER-11](BUSINESS-RULES.md)). It consumes the same conventions; it does not get its own APIs, and it does not grow into an adoptable Lab without a new decision ([D6](DECISIONS.md#d6)) |
| **Who may answer** a parked row | FIX-1455 and any surface that renders one | The action reads the **resolved principal off the request** — per BP-031, never a `userId` in the action's input. Under [D7](DECISIONS.md#d7) there is one principal, so this is a discipline to preserve, not a routing problem to solve |
| **Org identity** on every surface | Every child and [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) | Surfaces open under org identity, and [ER-19](BUSINESS-RULES.md) is not observable without it — so FIX-1442 is a **wrap-gating input**, not merely soft-related. The security pass itself is still **not** a W5 redesign |

## Not children, deliberately

[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) Collab park (later, and never the whole
of W5) · [FIX-277](https://linear.app/fixpoint-labs/issue/FIX-277) HITL consumers (consumed as a POC
spine) · [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) manager-queue lab and
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) org-never-optional (both W4-side;
FIX-1442 is not a child but **does gate the wrap**) ·
[FIX-1429](https://linear.app/fixpoint-labs/issue/FIX-1429), which is **FIX-1455's** child, not this
epic's · **CyberForce**, which [D6](DECISIONS.md#d6) leaves out while admitting DevForce. Linked from
the rules, never re-parented.

## Wrap

When [ER-19](BUSINESS-RULES.md)'s three artifacts exist and have been watched — the cloned reference
app with its team surviving a redeploy, the run observed unfolding in devtool, and one real DevForce
configuration doing genuine work — and every row is terminal: run
[ER-20](BUSINESS-RULES.md)'s **wrap-time sweep over the shipped child diffs** for a new L1 type, a
widened `TaskStatus`, a second work plane or multi-human machinery; run the lessons pass over the
set's review rounds; dispatch the docs polish over the Workforce pages the children each edited in
isolation; refresh the set table and the path one last time; and close the epic PR unmerged.
FIX-1455 wraps on **its own** lifecycle; W5's wrap waits for that outcome but does not perform it.
