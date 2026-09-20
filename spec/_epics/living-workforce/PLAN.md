# FIX-1457 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build any
piece; that's each child's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n). **The set is open** ([ER-23](BUSINESS-RULES.md)) —
lanes are added here as children are filed, and that is the normal course of this epic.

## The path

![Lanes against time, with a now line at September 20, 2026. A ship-fence band under the axis says the fence STANDS: the W4 first-cut issues are done but FIX-1407 is In Review, so no W5 ship ticket may open; polish may start now. Two input lanes carry the W3 floor and the W4 first cut, both reaching the now line. Then the rows of the set: FIX-1467 carries a completed bar that ends before the now line, marked done and merged, and labelled not a proving leg; FIX-1468 and FIX-1469 are short dashed backlog lanes with no bars, both labelled not a proving leg; and three exit-proof lanes — the Devtool checklist, the DevForce proof path and the multi-seat collab scenario — carry no bars at all, each marked NO CHILD, not filed. A terminated stub marks FIX-1458 as canceled on September 20. The route to the done condition is drawn in the gutter as a broken line through all three proof lanes, because it has no owners anywhere along it. A note says the set is open and that every exit proof is a lane waiting to be filed. Under a divider, related lanes not in the set: kitchen-sink FIX-1455, a sibling epic that left the set; manager-queue FIX-1430 and org-never-optional FIX-1442, both W4-side, the second wrap-gating; and FIX-1320 flow instances, Spec Approved, which already owns the devtool instance and session surfaces four checklist rows read on.](figures/path.svg)

**No lane carries a live bar.** The only completed bar belongs to FIX-1467, which finished a
convention and was **never a proving leg** — so the picture is an epic whose staffed work is done and
whose objective has not started. The three lanes with **no bar and no ticket** are the exit proofs;
they have no duration because they have no owner. The ship fence [D4](DECISIONS.md#d4) **stands**.
The dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure adds
time to it.

## What each row entails

| Row | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-XXX** Devtool checklist | **not filed** | A live hired Workforce · the existing Devtool panel, instance list, `task-collections-view`, resources tree and `/debug/resources` · the inventory collections | **[ER-Devtool](BUSINESS-RULES.md#er-devtool)** — the six-row checklist green, **with no special wrapper** | The lens the other two proofs are observed through. It is the one that cannot run last | Unknown · **rows 4 and 6 fail today**, so not a polish pass |
| **FIX-XXX** DevForce proof path | **not filed** | The W3/W4 substrate · the Done first build slice ([FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426), [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410)) · `references/` conventions | **[ER-DevForce](BUSINESS-RULES.md#er-devforce)** — one path completing with a **real artifact** | The live hired Workforce the other proofs run against ([ER-3](BUSINESS-RULES.md)) | **Thinnest that works** · fenced by [ER-11](BUSINESS-RULES.md) |
| **FIX-XXX** multi-seat collab | **not filed** | Boards [FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385) · inventory [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405) · manager-queue [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) · dispatch honesty [FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) | **[ER-Collab](BUSINESS-RULES.md#er-collab)** — ≥2 seats, ≥1 channel, file → assign → drain → handoff, **observed in Devtool** | The epic's wrap, with the other two | One graded scenario · **not the whole of W5** ([ER-9](BUSINESS-RULES.md)) |
| **FIX-1467** `references/` vs `resources/` | `spec` → **Done, merged** | W3's `resources:` convention · [FIX-1381](https://linear.app/fixpoint-labs/issue/FIX-1381)'s per-seat grant · sandbox mounts | The isolation convention: `references/` ambient and read-only, `resources:` the mutable grant, `clearShadowedReferences` the migration | **[ER-18](BUSINESS-RULES.md) met.** Checklist row 6 now has a distinction to render | Done |
| **FIX-1468** `ReadOnlyResourceRef` | Backlog | FIX-1467's shipped split | A handle type that omits `writeContent` for read-only documents | Nothing in the set. **Not a proving leg** | Small · additive |
| **FIX-1469** `goals/` labs + KS documents | Backlog | FIX-1467's deferred S7 | A decision on the graded labs' document migration | Nothing in the set. **Not a proving leg**, and its **kitchen-sink half is stale** ([D9](DECISIONS.md#d9)) | Small · **needs re-scoping** |
| ~~**FIX-1458**~~ humans-in-seats | — | — | **Canceled 2026-09-20.** Its invent-kills survive as [D2](DECISIONS.md#d2) | Nothing. Not re-specced, not reopened | — |

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-20). The lanes
above carry the same state as a picture of time and are redrawn when it moves.

**The inputs from other epics, verified 2026-09-20:** the **W3 floor** (FIX-1351) has landed the
pieces W5 needs, including DevForce's first build slice. The **W4 first cut** (FIX-1407) has landed
its issues — FIX-1381, FIX-1385, FIX-1394, FIX-1405, FIX-1408, FIX-1430 and FIX-1451 are Done — but
**the epic itself is *In Review*, not closed**, so [ER-10](BUSINESS-RULES.md)'s ship fence stands.
W5 is a **sibling** of W4, never nested under it.

## What unblocks what, from here

1. **The three gaps are filed** → the done condition becomes reachable at all. **This is first, and
   it is not a technical dependency** — no exit proof has a producer, so W5 cannot finish however
   well anything else goes ([Open 1](DECISIONS.md#open)).
2. **Sign-off 1 is answered** → the Devtool child can be cut at the right size, or not cut at all if
   it rides [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320). Filing before this is how
   two teams build one inspector.
3. **The DevForce path stands a workforce up** → ER-3 is satisfiable, and the other two proofs have
   something real to observe. It is the only row that produces the subject.
4. **The Devtool checklist goes green** → ER-Collab's *observed in Devtool* clause is satisfiable,
   and ER-DevForce's *seats and channels used honestly* becomes checkable rather than asserted.
5. **W4's epic closes** → the ship fence lifts ([D4](DECISIONS.md#d4)). Polish does not wait on this.
6. **Org-bound execution is available** ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442),
   W4-side) → the proofs are observable at all. W5 does not own this and cannot wrap without it.
7. **All three proofs pass** → the epic wraps.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| **The Devtool surface** | The Devtool checklist and [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) | FIX-1320 (Spec Approved) already owns the instance list, instance switching, sessions and request inspection, and its own UI verification is **planned, not run**. **Checklist rows 1–3 read on exactly those surfaces.** Not decided here — [Sign-off 1](SPEC.md#sign-off) |
| **Across sessions, not within one** | The Devtool checklist and the collab scenario | A session belongs to one user, and the inventory ledger is **org-scoped**. Boards and inventory must be readable **across** sessions — rows 3 and 5 are session-scoped today, and a proof that opens one session per seat has not shown collaboration |
| **A failing row is never passed with an enum** | The Devtool checklist and L1 | Rows 4 and 6 fail today. A parked row's reason and a read-only reference are **renderings**, not status values ([ER-8](BUSINESS-RULES.md), [D3](DECISIONS.md#d3)) |
| **No special wrapper** | The Devtool checklist and every other row | A bespoke debug app would pass all six rows and prove nothing. The north star says Devtool inspects *"without special wrappers"*, and that clause is the proof's whole content |
| **Lab as evidence, not product** | The DevForce path and everything else | The **thinnest** path that produces a real artifact, and it stops there ([D8](DECISIONS.md#d8), [ER-11](BUSINESS-RULES.md)). *Which artifact counts* leans on the owner when the child is cut, and is not blocking |
| **Who may answer** a parked row | The collab scenario and the Devtool surface | The action reads the **resolved principal off the request** — per BP-031, never a `userId` in the action's input. Under [D7](DECISIONS.md#d7) there is one principal, so this is a discipline to preserve, not a routing problem to solve |
| **Org identity** on every proof | Every row and [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) | Proofs run under org identity, and none is observable without it — so FIX-1442 is a **wrap-gating input**, not merely soft-related |

## Not children, deliberately

[FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) **kitchen-sink** — a **sibling** epic
that left the set on 2026-09-20 ([D9](DECISIONS.md#d9), [ER-24](BUSINESS-RULES.md)); its child
[FIX-1429](https://linear.app/fixpoint-labs/issue/FIX-1429) is its own, never this epic's ·
[FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) flow instances — a **seam**, not a child,
until Sign-off 1 says otherwise · [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) Collab
park (later, and never the whole of W5) · [FIX-277](https://linear.app/fixpoint-labs/issue/FIX-277)
HITL consumers · [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) manager-queue and
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) org-never-optional (both W4-side;
FIX-1442 **gates the wrap**) · **CyberForce**, which [D8](DECISIONS.md#d8) leaves out this cycle
while admitting DevForce. Linked from the rules, never re-parented.

## Wrap

When all three exit proofs have passed — the Devtool checklist green on a live hired Workforce with
no special wrapper, one DevForce path completed with a real artifact, and ≥2 seats collaborating
across ≥1 channel with a handoff observed — and every row is terminal: run
[ER-20](BUSINESS-RULES.md)'s **wrap-time sweep over the shipped child diffs** for a new L1 type, a
widened `TaskStatus`, a second work plane, multi-human machinery, or **new substrate arriving under a
polish label** ([ER-25](BUSINESS-RULES.md)); run the lessons pass over the set's review rounds;
dispatch the docs polish over the Workforce pages; refresh the set table and the path one last time;
and close the epic PR unmerged. FIX-1455 wraps on **its own** lifecycle and W5 neither waits for it
nor performs it ([D9](DECISIONS.md#d9)).
