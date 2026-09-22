# FIX-1457 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build any
piece; that's each child's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n). **The set is open** ([ER-23](BUSINESS-RULES.md)) —
lanes are added here as children are filed, and that is the normal course of this epic.

## The path

![Lanes against time, with a now line at September 22, 2026. A ship-fence band under the axis says the fence STANDS: the W4 first-cut issues are done but FIX-1407 is In Review, so no W5 ship ticket may open; polish may start now. Two input lanes carry the W3 floor and the W4 first cut, both reaching the now line. Then the rows of the set: FIX-1467 carries a completed bar that ends before the now line, marked done and merged and labelled not a proving leg; FIX-1468, FIX-1469 and FIX-1474 are short dashed backlog lanes with no bars, all three labelled not a proving leg, and FIX-1474 additionally marked NOT an ER-Collab gate; then four exit-proof lanes, every one of which now holds a ticket and none of which carries a bar — FIX-1481 In Spec Review owning checklist rows 4 and 6 and verifying all six, FIX-1502 Backlog owning row 5 and marked BLOCKED BY FIX-1486, FIX-1496 In Spec Review and the lane that stands the live hire up, and FIX-1497 Backlog with no spec, held behind FIX-1481. A terminated stub marks FIX-1458 as canceled. The route to the done condition is drawn in the gutter through the proof lanes and every one of its dots is now in the accent colour, because every proof has an owner — so the route is whole and entirely unrun. Under a divider, related lanes not in the set: kitchen-sink FIX-1455, a sibling epic that left the set; FIX-1320 flow instances, which rows 1 to 3 ride and W5 does not run; FIX-1486, which blocks row 5 and which W5 must not build under ER-25; and FIX-1442 org never optional, wrap-gating.](figures/path.svg)

**Still no lane carries a live bar, and now every lane exists.** The only completed bar belongs to
FIX-1467, which finished a convention and was **never a proving leg**. Every exit-proof lane is
occupied as of 2026-09-22 — two in spec review, two in Backlog — and not one of them is a duration.
So the picture changed in exactly one way: the gaps became tickets. **Two lanes now carry a blocker
that is not W5's**: row 5 waits on FIX-1486, and rows 1–3 ride FIX-1320. The ship fence
[D4](DECISIONS.md#d4) **stands** — [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407)
is still *In Review*.
The dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure adds
time to it.

## What each row entails

| Row | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **[FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)** Devtool checklist | spec → impl · **In Spec Review** [#2025](https://github.com/fixpoint-labs/flow-state-dev/pull/2025) · owns rows 4 and 6, **verifies all six**; row 5 is FIX-1502's, rows 1–3 ride [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) | A live hired Workforce ([ER-26](BUSINESS-RULES.md#er-26), for the *run*) · the existing Devtool panel, instance list, `task-collections-view`, resources tree and `/debug/resources` | **[ER-Devtool](BUSINESS-RULES.md#er-devtool)** — the six-row checklist green, **with no special wrapper** | The lens the other two proofs are observed through. It is the one that cannot run last | Unknown · **rows 4 and 6 fail today**, so not a polish pass. **Half of it is outside W5's control**, now on two epics rather than one |
| **[FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)** org-level inventory view | spec → impl · **Backlog, no spec** · **blocked by [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486)** | The three `inventory/*` collections · **a way to *select* an org, which does not exist yet** — an org-scoped read always answers with the org its session already carries, and nothing can choose another | **Checklist row 5** — a reader and view answering *who exists* and *who is in which channel* for a live org | Row 5 of ER-Devtool, and nothing else | Unknown · **not startable inside W5** · building the read here would be [ER-25](BUSINESS-RULES.md) growth |
| **[FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496)** DevForce proof path | spec → impl · **In Spec Review** [#2023](https://github.com/fixpoint-labs/flow-state-dev/pull/2023) | The W3/W4 substrate · the Done first build slice ([FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426), [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410)) · `references/` conventions · the existing `goals/devforce-lab/` | **[ER-DevForce](BUSINESS-RULES.md#er-devforce)** — one path completing with a **real artifact**, one automated leg | The live hired Workforce the other proofs' **runs** are graded on ([ER-3](BUSINESS-RULES.md), [ER-26](BUSINESS-RULES.md#er-26)) | **Thinnest that works** · a four-gap delta, not a new Lab tree · fenced by [ER-11](BUSINESS-RULES.md) |
| **[FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497)** multi-seat collab | spec → impl · **Backlog, no spec** · held behind FIX-1481 | Boards [FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385) · inventory [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405) · manager-queue [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) · dispatch honesty [FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) | **[ER-Collab](BUSINESS-RULES.md#er-collab)** — ≥2 seats, ≥1 channel, file → assign → drain → handoff, **observed in Devtool** | The epic's wrap, with the other two | One graded scenario · **not the whole of W5** ([ER-9](BUSINESS-RULES.md)) |
| **FIX-1467** `references/` vs `resources/` | `spec` → **Done, merged** | W3's `resources:` convention · [FIX-1381](https://linear.app/fixpoint-labs/issue/FIX-1381)'s per-seat grant · sandbox mounts | The isolation convention: `references/` ambient and read-only, `resources:` the mutable grant, `clearShadowedReferences` the migration | **[ER-18](BUSINESS-RULES.md) met.** Checklist row 6 now has a distinction to render | Done |
| **FIX-1468** `ReadOnlyResourceRef` | Backlog | FIX-1467's shipped split | A handle type that omits `writeContent` for read-only documents | Nothing in the set. **Not a proving leg** | Small · additive |
| **FIX-1469** `goals/` labs + KS documents | Backlog | FIX-1467's deferred S7 | A decision on the graded labs' document migration | Nothing in the set. **Not a proving leg**, and its **kitchen-sink half is stale** ([D9](DECISIONS.md#d9)) | Small · **needs re-scoping** |
| **[FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474)** composed `@seat` notify + board file | Backlog | Today's channel, dispatch and board primitives · inventory, for a find-or-create DM later | A named path to notify another seat **while** filing on a board | Nothing in the set. **Not a proving leg**, and **not an ER-Collab gate** — the gate stays on today's separate paths until this lands | Small · **composes, never a new package** ([ER-25](BUSINESS-RULES.md)) |
| ~~**FIX-1458**~~ humans-in-seats | — | — | **Canceled 2026-09-20.** Its invent-kills survive as [D2](DECISIONS.md#d2) | Nothing. Not re-specced, not reopened | — |

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-22). The lanes
above carry the same state as a picture of time and are redrawn when it moves.

**The inputs from other epics, verified 2026-09-20:** the **W3 floor** (FIX-1351) has landed the
pieces W5 needs, including DevForce's first build slice. The **W4 first cut** (FIX-1407) has landed
its issues — FIX-1381, FIX-1385, FIX-1394, FIX-1405, FIX-1408, FIX-1430 and FIX-1451 are Done — but
**the epic itself is *In Review*, not closed**, so [ER-10](BUSINESS-RULES.md)'s ship fence stands.
W5 is a **sibling** of W4, never nested under it.

## What unblocks what, from here

1. **Every gap is filed — done, 2026-09-22.** This stood first for two revisions because W5 could
   not finish however well anything else went. FIX-1481 and FIX-1502 hold ER-Devtool, FIX-1496 holds
   ER-DevForce, FIX-1497 holds ER-Collab. It is recorded rather than deleted because the next two
   steps only make sense as its successors.
2. **The two open direction gates are answered** → FIX-1481 ([#2025](https://github.com/fixpoint-labs/flow-state-dev/pull/2025))
   and FIX-1496 ([#2023](https://github.com/fixpoint-labs/flow-state-dev/pull/2023)) can implement,
   and FIX-1497 can be specced. **This is the live front of the epic.**
3. **The end-state POC is run or deliberately skipped** → its trigger fired when the last gap was
   filed ([DECISIONS.md](DECISIONS.md#what-the-end-state-poc-showed)) and **nothing should start
   building before it is settled**, because what it falsifies is the division these four children
   were just cut along.
4. **FIX-1496 stands a live hired Workforce up** → [ER-26](BUSINESS-RULES.md#er-26) is discharged,
   ER-3 is satisfiable, and the other two proofs have something real to observe and grade. It is the
   only row that produces the subject, and **it fences their runs, not their code.**
5. **The Devtool checklist goes green** → ER-Collab's *observed in Devtool* clause is satisfiable,
   and ER-DevForce's *seats and channels used honestly* becomes checkable rather than asserted.
   **On five rows or six** is [Open 1](DECISIONS.md#open), and it is the owner's.
6. **[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) lands** → FIX-1502 unblocks and row
   5 becomes buildable. **W5 does not own this, must not build it ([ER-25](BUSINESS-RULES.md)), and
   nothing else in the set waits on it** — which is exactly why the five-or-six call exists.
7. **W4's epic closes** → the ship fence lifts ([D4](DECISIONS.md#d4)). Polish does not wait on this.
8. **Org-bound execution is available** ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442),
   W4-side) → the proofs are observable at all. W5 does not own this and cannot wrap without it.
9. **All three proofs pass** → the epic wraps.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| **The Devtool surface** | [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) and [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) | FIX-1320 (Spec Approved) already owns the instance list, instance switching, sessions and request inspection, and its own UI verification is **planned, not run**. **Checklist rows 1–3 read on exactly those surfaces and ride it**; FIX-1481 owns rows 4 and 6, and row 5 is [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)'s (corrected 2026-09-22). The split is enacted, so the seam is now **schedule** — and it has widened: ER-Devtool cannot go green until **two** epics W5 does not run have moved, FIX-1320 for its verification and [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) for row 5 |
| **Across sessions, not within one** | The Devtool checklist and the collab scenario | A session belongs to one user, and the inventory ledger is **org-scoped**. Boards and inventory must be readable **across** sessions — rows 3 and 5 are session-scoped today, and a proof that opens one session per seat has not shown collaboration |
| **Checklist row 5's owner** | [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) and [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) | 1481 **verifies** all six rows; 1502 **builds** row 5's reader and view. Neither builds the other's half, and **neither may declare row 5 green on the other's behalf.** The seam exists because 1481 deferred the row on a false claim about who owned the reader — see [EVOLUTION.md](EVOLUTION.md) |
| **A run needs a subject** | [FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496) and the other two proofs | [ER-26](BUSINESS-RULES.md#er-26). No exit proof's run is graded before 1496 stands a live hired Workforce up — row 6 in particular cannot go green until a tree with a sealed document exists, and **none does today**. **This orders the runs and not the code**: 1481's and 1502's implementation PRs are not behind 1496 and must not be scheduled as if they were |
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
and it stays one: checklist rows 1–3 ride it rather than being re-built here · [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) Collab
park (later, and never the whole of W5) · [FIX-277](https://linear.app/fixpoint-labs/issue/FIX-277)
HITL consumers · [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) manager-queue and
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) org-never-optional (both W4-side;
FIX-1442 **gates the wrap**) · **[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486)** org
identity on flow and session listing — **new here 2026-09-22**: it blocks
[FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) in Linear and is deliberately **not**
pulled in, because building **org selection** under a QA epic is the
[ER-25](BUSINESS-RULES.md) growth the owner fenced. **Row 5's own reader is not that work**, and
whether row 5 needs selection at all is [Open 1](DECISIONS.md#open), reopened by the 2026-09-22
settlement · **CyberForce**, which [D8](DECISIONS.md#d8) leaves out this cycle
while admitting DevForce. Linked from the rules, never re-parented.

## Wrap

When all three exit proofs have passed — the Devtool checklist green on a live hired Workforce with
no special wrapper, one DevForce path completed with a real artifact, and ≥2 seats collaborating
across ≥1 channel with a handoff observed — and every row is terminal: run
[ER-20](BUSINESS-RULES.md)'s **wrap-time sweep over the shipped child diffs** for a new L1 type, a
widened `TaskStatus`, a second work plane, multi-human machinery, or **new substrate arriving under a
polish label** ([ER-25](BUSINESS-RULES.md)); run the lessons pass over the set's review rounds;
dispatch the docs polish over the Workforce pages; publish the reader narrative
[DOCS.md](DOCS.md) assigns; and report completion in Linear, derived from the children's states and
their implementation PRs rather than from this PR. **This spec merges after the objective gate**
([orchestration.md → Merging and amending a spec](../../../docs/contributing/orchestration.md#merging-and-amending-a-spec));
the merged PR stays as the review record, and anything the wrap changes materially goes on a
follow-up PR from `main`, not back onto it. FIX-1455 wraps on **its own** lifecycle and W5 neither
waits for it nor performs it ([D9](DECISIONS.md#d9)).
