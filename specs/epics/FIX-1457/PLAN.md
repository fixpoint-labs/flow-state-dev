# FIX-1457 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build any
piece; that's each child's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n). **The set is open** ([ER-23](BUSINESS-RULES.md)) —
lanes are added here as children are filed, and that is the normal course of this epic.

## The path

![Lanes against time, with a now line at September 24, 2026. A ship-fence band under the axis says the fence STANDS: the W4 first-cut issues are done but FIX-1407 is In Review, so no W5 ship ticket may open; polish may start now. Two input lanes carry the W3 floor, landed, and the W4 first cut, reaching the now line. Then the rows of the set: FIX-1467 done on September 20 and not a proving leg; FIX-1468, FIX-1469 and FIX-1474 dashed backlog lanes, none a proving leg, FIX-1474 NOT an ER-Collab gate. Then the proof lanes: FIX-1481 done, row 4 passed live, row 6 proved by automated checks only under D11; FIX-1502 in flight, In Spec Dev, row 5 built in W5 under D10; FIX-1496 done, ER-DevForce passed, the lane that stood the live hire up; FIX-1497 done, ER-Collab passed. FIX-1547, filed September 24, is in flight as the row 6 mitigation and not a proving leg. A terminated stub marks FIX-1458 as canceled. The route to the done condition runs through the proof lanes: filled dots for the two proofs that passed, hollow for ER-Devtool's two lanes. Under a divider, related lanes not in the set: kitchen-sink FIX-1455, a sibling epic that holds the note carrying row 6's live read; FIX-1320 flow instances, which rows 1 to 3 ride and W5 does not run; FIX-1486, related to row 5 and no longer blocking it; and FIX-1442 org never optional, wrap-gating.](figures/path.svg)

**Two proof lanes finished, and ER-Devtool's are the ones still open.** FIX-1496 and FIX-1497
completed on 2026-09-22 with their proofs passed, and FIX-1481 completed the same day with row 4
passed live. As of 2026-09-24 the one proof lane in flight is FIX-1502, which builds row 5 inside W5
([D10](DECISIONS.md#d10)); beside it FIX-1547 carries row 6's mitigation
([D11](DECISIONS.md#d11)). **One lane still carries a blocker that is not W5's**: rows 1–3 ride
FIX-1320. FIX-1486 no longer blocks row 5. The ship fence
[D4](DECISIONS.md#d4) **stands** — [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407)
is still *In Review*.
The dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure adds
time to it.

## What each row entails

| Row | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **[FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)** Devtool checklist | spec → impl · **Done** · spec [#2025](https://github.com/fixpoint-labs/flow-state-dev/pull/2025), live run [#2066](https://github.com/fixpoint-labs/flow-state-dev/pull/2066) · owns rows 4 and 6, **verifies all six**; row 4 passed live, row 6 proved by automated checks only ([D11](DECISIONS.md#d11)); row 5 is FIX-1502's, rows 1–3 ride [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) | A live hired Workforce ([ER-26](BUSINESS-RULES.md#er-26), for the *run*) · the existing Devtool panel, instance list, `task-collections-view`, resources tree and `/debug/resources` | **[ER-Devtool](BUSINESS-RULES.md#er-devtool)** — the six-row checklist green, **with no special wrapper** | The lens the other two proofs are observed through. It is the one that cannot run last | Done · **rows 4 and 6 failed when it was cut**, so it was not a polish pass. Rows 1–3 remain outside W5's control, on FIX-1320 |
| **[FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)** org-level inventory view | spec → impl · **In Spec Dev** · **built in W5** ([D10](DECISIONS.md#d10)); related to [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486), no longer blocked by it | The three `inventory/*` collections, read through a **channel session**, which already declares them — for the org that session carries. **No org selection**: a one-user, one-org deployment does not need it | **Checklist row 5** — a reader and view answering *who exists* and *who is in which channel* for a live org | Row 5 of ER-Devtool, and nothing else | **Priced by the 2026-09-22 settlement:** app wiring (`openInventory`), a `client` read on the three collection factories ([ER-17](BUSINESS-RULES.md#er-17), a shared L2 contract) and a reader. **Org *selection* is the [ER-25](BUSINESS-RULES.md) growth; row 5's reader is not** |
| **[FIX-1547](https://linear.app/fixpoint-labs/issue/FIX-1547)** row 6 hire-to-snapshot test | **In Development** · filed 2026-09-24 | A hired team's `references/` document · the debug snapshot | A test that the reference reaches the snapshot as `writable: false` | **The mitigation for row 6's deferred live read** ([D11](DECISIONS.md#d11)). **Not a proving leg** | Small · a test |
| **[FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496)** DevForce proof path | spec → impl · **Done** · spec [#2023](https://github.com/fixpoint-labs/flow-state-dev/pull/2023), **ER-DevForce PASS** [#2051](https://github.com/fixpoint-labs/flow-state-dev/pull/2051) | The W3/W4 substrate · the Done first build slice ([FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426), [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410)) · `references/` conventions · the existing `goals/devforce-lab/` | **[ER-DevForce](BUSINESS-RULES.md#er-devforce)** — one path completing with a **real artifact**, one automated leg | The live hired Workforce the other proofs' **runs** are graded on ([ER-3](BUSINESS-RULES.md), [ER-26](BUSINESS-RULES.md#er-26)) | **Thinnest that works** · a four-gap delta, not a new Lab tree · fenced by [ER-11](BUSINESS-RULES.md) |
| **[FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497)** multi-seat collab | spec → impl · **Done** · **ER-Collab PASS** [#2065](https://github.com/fixpoint-labs/flow-state-dev/pull/2065) · was held behind FIX-1481 | Boards [FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385) · inventory [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405) · manager-queue [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) · dispatch honesty [FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) | **[ER-Collab](BUSINESS-RULES.md#er-collab)** — ≥2 seats, ≥1 channel, file → assign → drain → handoff, **observed in Devtool** | The epic's wrap, with the other two | One graded scenario · **not the whole of W5** ([ER-9](BUSINESS-RULES.md)) |
| **FIX-1467** `references/` vs `resources/` | `spec` → **Done, merged** | W3's `resources:` convention · [FIX-1381](https://linear.app/fixpoint-labs/issue/FIX-1381)'s per-seat grant · sandbox mounts | The isolation convention: `references/` ambient and read-only, `resources:` the mutable grant, `clearShadowedReferences` the migration | **[ER-18](BUSINESS-RULES.md) met.** Checklist row 6 now has a distinction to render | Done |
| **FIX-1468** `ReadOnlyResourceRef` | Backlog | FIX-1467's shipped split | A handle type that omits `writeContent` for read-only documents | Nothing in the set. **Not a proving leg** | Small · additive |
| **FIX-1469** `goals/` labs + KS documents | Backlog | FIX-1467's deferred S7 | A decision on the graded labs' document migration | Nothing in the set. **Not a proving leg**, and its **kitchen-sink half is stale** ([D9](DECISIONS.md#d9)) | Small · **needs re-scoping** |
| **[FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474)** composed `@seat` notify + board file | Backlog | Today's channel, dispatch and board primitives · inventory, for a find-or-create DM later | A named path to notify another seat **while** filing on a board | Nothing in the set. **Not a proving leg**, and **not an ER-Collab gate** — the gate stays on today's separate paths until this lands | Small · **composes, never a new package** ([ER-25](BUSINESS-RULES.md)) |
| ~~**FIX-1458**~~ humans-in-seats | — | — | **Canceled 2026-09-20.** Its invent-kills survive as [D2](DECISIONS.md#d2) | Nothing. Not re-specced, not reopened | — |

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-24). The lanes
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
2. **The two open direction gates are answered — done, 2026-09-22.** FIX-1481
   ([#2025](https://github.com/fixpoint-labs/flow-state-dev/pull/2025)) and FIX-1496
   ([#2023](https://github.com/fixpoint-labs/flow-state-dev/pull/2023)) merged and implemented, and
   FIX-1497 was specced and built.
3. **The end-state POC is run or deliberately skipped** → its trigger fired when the last gap was
   filed ([DECISIONS.md](DECISIONS.md#what-the-end-state-poc-showed)) and **nothing should start
   building before it is settled**, because what it falsifies is the division these four children
   were just cut along. **Overtaken:** it was neither run nor recorded as skipped, and the children
   built regardless.
4. **FIX-1496 stands a live hired Workforce up — done, 2026-09-22**
   ([#2051](https://github.com/fixpoint-labs/flow-state-dev/pull/2051)) → [ER-26](BUSINESS-RULES.md#er-26)
   is met, and ER-DevForce and ER-Collab passed after it.
5. **The Devtool checklist goes green** → the last exit proof. **Row 4 is done**, live. **Row 5 is
   FIX-1502's, inside W5** ([D10](DECISIONS.md#d10)) — the live front of the epic. **Row 6 counts on
   its automated checks**, its live read carried to the first real hire with a sealed document
   ([D11](DECISIONS.md#d11)). **Rows 1–3 wait on FIX-1320's verification.**
6. ~~**[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) lands** → FIX-1502 unblocks.~~
   **Removed from the path 2026-09-24** ([D10](DECISIONS.md#d10)): row 5 is a channel session's view
   of the organization, so it does not need org selection, and FIX-1502 is only *related* to
   FIX-1486. W5 does not own **org selection** and must not build it ([ER-25](BUSINESS-RULES.md));
   nothing in the set waits on it.
7. **W4's epic closes** → the ship fence lifts ([D4](DECISIONS.md#d4)). Polish does not wait on this.
8. **Org-bound execution is available** ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442),
   W4-side) → the proofs are observable at all. W5 does not own this and cannot wrap without it.
9. **All three proofs pass** → the epic wraps. ER-DevForce and ER-Collab have; ER-Devtool passes on
   rows 1–5 live and row 6 as [D11](DECISIONS.md#d11) defines it.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| **The Devtool surface** | [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) and [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) | FIX-1320 (Spec Approved) already owns the instance list, instance switching, sessions and request inspection, and its own UI verification is **planned, not run**. **Checklist rows 1–3 read on exactly those surfaces and ride it**; FIX-1481 owns rows 4 and 6, and row 5 is [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)'s (corrected 2026-09-22). The split is enacted, so the seam is now **schedule**: ER-Devtool cannot go green until FIX-1320's verification has run. [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) is **no longer** on this seam ([D10](DECISIONS.md#d10)) |
| **Across sessions, not within one** | The Devtool checklist and the collab scenario | A session belongs to one user, and the inventory ledger is **org-scoped**. Boards and inventory must be readable **across** sessions — rows 3 and 5 are session-scoped today, and a proof that opens one session per seat has not shown collaboration |
| **Checklist row 5's owner** | [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) and [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) | 1481 **verifies** all six rows; 1502 **builds** row 5's reader and view. Neither builds the other's half, and **neither may declare row 5 green on the other's behalf.** The seam exists because 1481 deferred the row on a false claim about who owned the reader — see [EVOLUTION.md](EVOLUTION.md) |
| **A run needs a subject** | [FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496) and the other two proofs | [ER-26](BUSINESS-RULES.md#er-26), **met 2026-09-22**. No exit proof's run is graded before 1496 stands a live hired Workforce up — row 6 in particular cannot go green live until a tree with a sealed document exists, and **none does** ([D11](DECISIONS.md#d11)). **This orders the runs and not the code**: 1481's and 1502's implementation PRs are not behind 1496 and must not be scheduled as if they were |
| **A failing row is never passed with an enum** | The Devtool checklist and L1 | Rows 4 and 6 failed when the checklist was drafted, and FIX-1481 rendered both without one. A parked row's reason and a read-only reference are **renderings**, not status values ([ER-8](BUSINESS-RULES.md), [D3](DECISIONS.md#d3)) |
| **No special wrapper** | The Devtool checklist and every other row | A bespoke debug app would pass all six rows and prove nothing. The north star says Devtool inspects *"without special wrappers"*, and that clause is the proof's whole content |
| **Lab as evidence, not product** | The DevForce path and everything else | The **thinnest** path that produces a real artifact, and it stops there ([D8](DECISIONS.md#d8), [ER-11](BUSINESS-RULES.md)). *Which artifact counts* was cut and approved at FIX-1496's own gate: one automated leg |
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
identity on flow and session listing — **new here 2026-09-22**: *related* to
[FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) in Linear, no longer blocking it since
2026-09-24 ([D10](DECISIONS.md#d10)), and deliberately **not** pulled in, because building **org
selection** under a QA epic is the [ER-25](BUSINESS-RULES.md) growth the owner fenced. **Row 5's own
reader is not that work** · **CyberForce**, which [D8](DECISIONS.md#d8) leaves out this cycle
while admitting DevForce. Linked from the rules, never re-parented.

## Wrap

When all three exit proofs have passed — the Devtool checklist green on a live hired Workforce with
no special wrapper (rows 1–5 read live; row 6 on its automated checks, with its live read carried
per [D11](DECISIONS.md#d11)), one DevForce path completed with a real artifact, and ≥2 seats collaborating
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
