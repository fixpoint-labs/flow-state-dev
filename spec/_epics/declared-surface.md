# Epic — The declared surface is the real surface

**Linear:** [FIX-1127](https://linear.app/fixpoint-labs/issue/FIX-1127/epic-the-declared-surface-is-the-real-surface) · **Project:** Framework simplification & cleanup · **Branch:** `epic/declared-surface`

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Everything FSD declares or documents should be true. Three independently-filed
defects share one failure mode: the framework states something — in a doc page, in a type, in a
block's declared resources — and the runtime does something else. A developer meeting FSD cannot
tell which of our statements to trust, and the ones that fail first are the ones they meet first.
When this epic lands, the three places we are provably lying have stopped lying.

This is the last cheap moment. `@flow-state-dev/core` is `0.0.0` and unpublished, so nothing here
has an external consumer to migrate today. One of the three is nonetheless already written down
as a contract — FIX-1048's four type fields — which is why *what* to do about it is a product
call (§5) even though doing it is cheap either way.

**Holistic necessity.** Three issues, and the honest question is whether it's two.

- **FIX-1126 is the substance.** The getting-started sequence and both public blog posts teach
  `preset/*` model strings that were removed by FIX-516 and now `throw`. The documented
  first-run path ends in an unhandled exception at the exact moment a reader has the least
  context to diagnose it. **Its boundary is semantic, not textual.** A page that names
  `preset/*` as a *rejected* value, or that teaches the migration away from it, is telling the
  truth and stays; a broken example is in scope wherever it lives, including outside
  `apps/docs/`. Scoping by a count of textual matches gets both ends wrong — it deletes correct
  migration guidance and leaves the most prominent broken examples untouched.
- **FIX-1048 is the same defect one layer down**, and worse-shaped: a *type* that accepts four
  fields the runtime silently drops. A missing option fails loudly; a declared-and-ignored one
  compiles clean and looks configured. **Which way it resolves is not ours** — wiring the
  fields adds a capability, deleting them retracts an advertised one. It is open with the
  product owner (§5).
- **FIX-1052 is cheap rather than severe, and it is now the row to cut if the set has to give
  one up.** Its runtime consequence is unestablished — most likely a superset of what should be
  prefetched, not a misroute. It is kept because one line (`mergeDeclaredResources` stops
  mutating its target) closes it, closes FIX-1051, and closes an unfiled third variant. **If the
  fix grows past making that function pure, that is the signal something larger was found and it
  should be re-scoped, not absorbed.**

**One gate, and it is this one.** All three rows take the direct route, so the objective sign-off
above is the only approval standing in front of the set; after it, each row merges on its own
implementation PR. There is no spec-approval gate anywhere in this epic. *(Round 2 added a second
one when FIX-754 was promoted to the spec route. That issue has since left the set — below — and
the single-gate structure is restored.)*

**Not doing.** This is three verified defects, not a sweep. An objective phrased as "everything
declared is true" invites an unbounded audit of every declaration in the framework; that is
explicitly not this epic, and a further site discovered during the work is filed, not folded.
Round 3 is what that rule looks like when it fires:

- **FIX-754 left the epic in round 3, because it stopped being a row.** Filed as two one-word
  edits, it was rescoped to four handler definitions in round 2; then review found a fifth, and a
  repo-wide sweep put the real count at **eight** — across three publishable packages (`core`,
  `patterns`, `tools`), touching **two public exports** (`captureContext` and `createAppendEntry`,
  `packages/patterns/src/index.ts:86` and `:106`). That is bigger than the three issues left here
  combined, it turns on public-export contract decisions that need a document and a spec gate of
  their own, and its natural pair is **FIX-625** — the BP-014 enforcement guard it already
  blocks. Together those two are "make BP-012/BP-014 true, then keep it true," which is a
  coherent objective and not this one. Unparented in Linear; the full eight-site scope is
  recorded on the issue.
- **FIX-852** (model-layer complexity) — a different objective, runs standalone after.
- **FIX-766** (`work` → `sideChain`) — same family, but it grew into a persisted-format migration
  with a rollout, an order of magnitude larger than anything here, so it runs its own lifecycle.

## 2. Themes & long-horizon direction

1. **When a declaration and the runtime disagree, make the runtime true.** That is the epic's
   default and it binds every issue here. **One deliberate exception:** where the declaration
   was never meant to be supported, removing it from the type — so misuse fails at compile
   time — closes the gap just as well. **Taking that exception is not an implementer's call**,
   because it decides what the framework offers rather than how a fix is written.

   **One issue can take it, and it is FIX-1048** — wire the four fields, or delete them. It is
   open with the product owner in §5, because there is no other gate in front of it. *(Round 2
   read this as two issues: FIX-754 reached the same fork one level up, over whether
   `captureContext` stays exported. It is no longer in the set, and that fork goes with it.)*

2. **A carrier PR names its passenger.** FIX-502 rides FIX-1126 and FIX-1051 rides FIX-1052
   rather than each getting its own row. The carrier's description names the passenger, or the
   passenger closes with no trace of what closed it. **The changeset names it too only where the
   carrier touches a publishable package** — of the two carriers, that is FIX-1052/FIX-1051
   alone, in `@flow-state-dev/core`. FIX-1126/FIX-502 is docs-and-examples-only across private
   packages, which take no changeset at all
   ([`release-notes-workflow.md`](../../docs/contributing/release-notes-workflow.md)). *This rule
   is about a carrier naming its passenger; it does not decide whether a row takes a changeset at
   all. FIX-1048 also changes `core` and takes one under plain BP-022, carrying nobody.*

3. **No sequencing constraint — the three are independent.** Different files, parallel, any
   merge order. **This is round 1's claim, and it is restored rather than merely repeated.**
   Round 2 falsified it: FIX-754's export decision governed
   `apps/docs/docs/patterns/response-auditor.md:246-250`, and FIX-1126 edits that same page for
   stale `preset/*` strings, so the two had a real seam. Removing FIX-754 removes the seam, and
   no pair among the three remaining shares a file. Written this way deliberately — an
   independence claim that has been wrong once should not read as though it was never tested.

## 3. Shape of the whole *(POC)*

**`spec_poc: skipped`** — and the reason has now moved twice, which is itself worth recording.
Round 1 skipped on "disjoint files, no seam." Round 2 falsified that and the skip moved to "the
seam is known, named, and owned by FIX-754's spec." Round 3 removed FIX-754, and the original
reason is true again on its own terms: three fixes, three disjoint file sets, no shared surface.
An end-state POC asks whether the division into issues holds. It does — and at three independent
rows, rendering it would show nothing theme 3 doesn't state in a line.

**What reading `main` bought, and what it cost.** Every scope correction in this epic came from
reading `main`, and the readings kept failing in the same direction: always understating. FIX-754
went two sites → four → eight across three rounds, and round 1's "zero observable effect" claim
had never left the runtime to look at the package's export surface or the docs page describing it.
What finally settled the count was not a fourth careful read but a **mechanical sweep** — a
brace-matched parse of all 157 `handler({…})` definitions across 907 files under `packages/*/src`.
Kept as this epic's own evidence standard, since the epic is about honest declarations:

- **A claim about what is observable has to be checked at the boundary the observer is standing
  on**, not only at the layer the change is made in.
- **A claim about how many sites a pattern has is a claim about the whole tree, and a reader who
  samples cannot make it.** Three rounds of careful reading undercounted by six; one parse got it
  exactly. The second lesson has a payoff past this epic — see §5.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1126](https://linear.app/fixpoint-labs/issue/FIX-1126) | Every stale `preset/*` example stops teaching syntax that throws; getting-started rewritten around `intent/*` (carries FIX-502) | **direct** | — | — | Todo |
| [FIX-1048](https://linear.app/fixpoint-labs/issue/FIX-1048) | `FlowInstanceOptions.webhooks/chat/schedules/mcp` either apply at instance creation or stop type-checking | **direct** | — | — | Todo |
| [FIX-1052](https://linear.app/fixpoint-labs/issue/FIX-1052) | `mergeDeclaredResources` stops mutating its target, so `ownDeclaredResources` stays a block's own (carries FIX-1051) | **direct** | — | — | Todo |

*Route is derived from each issue's Linear category on every refresh
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"), and
this set is **uniformly `direct`**. No row here will ever carry a spec PR, so every empty Spec PR
cell is correct by design rather than a gap, and the objective gate above is the only approval in
front of the set. (Round 2's mixed-route set left with FIX-754.) Each row's per-issue evidence and
implementer notes live on its Linear issue, not here.*

## 5. Open cross-cutting questions

- **Do the four dead `FlowInstanceOptions` fields get wired, or deleted?** Raised by review on
  this PR. It is theme 1's exception — a call about what the framework offers, not about how a
  fix is written — and it comes to you here rather than in a spec because FIX-1048 is a
  direct-route row with no gate of its own. **With the product owner**, alongside the objective
  gate. **Blocks FIX-1048 only**; the other two proceed either way.

  *The ask:*

  - **The fork.** Should creating a flow instance be able to override webhooks, chat, schedules
    and MCP — or do we retract that promise?
  - **Plain terms.** Our type says you can hand these four transport settings to a flow when you
    create it. The runtime ignores them. Wiring them means one flow definition can be reused
    under different transports — the same app served to two tenants on two webhook endpoints.
    Deleting them means transports belong to the definition, and passing them stops compiling.
  - **The trade-off.** Wiring is real work — four merge paths and their tests, mirroring how
    `voice` already does it — for a capability nobody has asked for. Deleting is small and
    honest and costs no migration at `0.0.0`, but it takes back something the type has been
    advertising.
  - **My recommendation: delete the four fields.** Nothing in the repo passes them, we have no
    per-instance transport use case, and while we're unpublished we can add the capability back
    the day someone wants it — as a feature with a real requirement behind it, rather than as
    four fields we guessed at.
  - **What would change my mind.** A concrete near-term need to run one flow definition under
    two transport configurations. Multi-tenant webhook endpoints is the obvious shape; if that's
    on the roadmap this quarter, wire them now.
  - **Cost of being wrong.** Low and reversible both ways while unpublished. Delete wrongly and
    we add it back later as a normal feature. Wire wrongly and we maintain four merge paths and
    their tests for something unused.

  *Either way, FIX-1048's PR adds a `packages/core/test/flow.test.ts` assertion — no
  instance-override test exists today, which is how four fields stayed dead unnoticed.*

- **Does the objective imply a fourth issue — a guard that keeps this from recurring?**
  Raised here, at authoring. FIX-516 removed `preset/*` from the framework and the docs went on
  teaching it, unnoticed, until an audit found them. This epic restores truth today and does
  nothing about tomorrow: the next removal repeats it. Whether we spend on a check that fails CI
  when a doc example uses removed syntax is a scope-and-timing call, not an engineering one.
  **Blocks nothing** — all three issues proceed either way.

  *The ask:*

  - **The fork.** Fix the stale examples and move on, or also build a guard that catches the next one?
  - **Plain terms.** Our docs can teach code that crashes, and nothing tells us. It happened
    once and took months to notice. A guard would compile-check the examples in our docs so it
    fails our own build instead of a reader's first run.
  - **The trade-off.** The guard is real work (docs examples aren't currently compiled at all)
    and it is not this epic's three verified defects — it's a fourth, larger, unscoped one.
    Without it, the same class of failure returns on the next syntax removal, and the cost is
    paid by whoever is evaluating FSD that week.
  - **My recommendation: fix the stale examples now, file the guard separately, don't fold it in.**
    The three issues here are small and individually verified. Adding an unscoped infrastructure
    issue to that set is exactly the "does the whole overbuild" failure this epic-spec exists to
    catch, and filing it keeps it from being forgotten without holding this epic's objective open.
  - **What would change my mind.** If we're near a public launch of the docs site, the
    recurrence risk stops being theoretical and the guard becomes part of shipping them.
  - **Cost of being wrong.** Low and reversible either way. Fold it in and this epic grows an
    unbounded issue. Defer it and the worst case is a second doc-cleanup pass later — annoying,
    not expensive, and cheaper while we're pre-1.0 with no external consumers.
  - **New evidence, round 3 — the class of guard works, which was previously an assumption.**
    The sweep that resized FIX-754 *was* a mechanical guard, run once by hand: a brace-matched
    parse of every `handler({…})` definition in `packages/*/src` found all **8** BP-014
    violations with **zero false positives** on today's tree. That doesn't price the docs-example
    guard this question actually asks about — compiling doc examples is a different and larger
    mechanism — but it retires the general worry that declaration-drift checks are too noisy to
    live in CI, and it confirms **FIX-625's guard is mechanically feasible**.

---

## Epic evolution

- **Epic drafted** — four verified defects under one outcome: what FSD declares is what FSD
  does. Scoped out FIX-852 and FIX-766; recorded that the set is four defects, not an audit.
- **At drafting, verifying FIX-754 against `main`** — rescoped it from a stream-pollution fix
  to a BP-012/BP-014 conformance fix, because `block_output` no longer exists as an item type
  and its filed harm was priced against a taxonomy that has since been replaced by
  `block_trace`. It stays in the set; what its PR must claim changed.
- **After epic review (round 1)** — trimmed §2 from six themes to three, because the four
  themes cut were per-issue implementation briefs and this epic has no sub-issue specs for them
  to coordinate; they now live on the Linear issues they belong to.
- **After epic review (round 1)** — FIX-754's keep is now argued on standards conformance and
  on unblocking FIX-625, not on observable harm, because reading `main` established there is
  none: `.tap()` suppresses no item `.step()` emits, and the real scope is two sites, not four.
  *(Superseded in rounds 2–3: "no observable harm" and the site count were both wrong, and the
  issue has since left the epic.)*
- **After epic review (round 1)** — theme 1's compile-time-removal exception stopped being the
  implementer's call and became an open question with the product owner, because choosing it for
  FIX-1048 adds or retracts a capability rather than settling how a fix is written.
- **After epic review (round 1)** — FIX-1126 is scoped by semantically stale usage rather than
  by textual match, because the file count included pages that correctly teach the migration and
  excluded broken examples living outside `apps/docs/`.
- **After epic review (round 2)** — FIX-754's "zero observable effect" is **withdrawn**.
  `captureContext` is an export of a publishable package that the docs invite authors to remix,
  so dropping its output contract silently changes a third-party `.step()` to `undefined`, and
  `block_trace.output` changes for all four blocks. In-repo nothing breaks — `.tap()` passes
  `{ value }` through untouched — so the breakage is external only, and it is a contract change
  rather than a live migration.
- **After epic review (round 2)** — FIX-754's scope is **four handler definitions, not two**,
  because BP-012's second clause governs the handler definition and `.tapIf`/`.workIf` wiring
  satisfies only the first. The two bash handlers were wrongly cleared on their wiring; their
  definitions still declare `outputSchema` and return their input.
- **After epic review (round 2)** — FIX-754 moved from the **direct route to the spec route**
  and its Linear category from Bug to Improvement, because a fix that changes a contract other
  code depends on is promoted rather than passed through the ungated route
  (`orchestration.md:245-248`). The epic then had one spec-approval gate alongside the objective
  gate. *(Superseded in round 3 — the issue left the set and took the second gate with it.)*
- **After epic review (round 2)** — theme 3 stopped claiming the four are independent. FIX-754's
  export decision governs `response-auditor.md:246-250`, and FIX-1126 edits that same page, so
  the near-seam is a real constraint. *(Superseded in round 3 — the seam left with the issue.)*
- **After epic review (round 3)** — **FIX-754 is removed from the epic; this is a three-issue
  set.** Review found a fifth violation (`persistTitle`,
  `packages/core/src/utility/session-title-generator.ts:71-86`), which triggered a repo-wide
  mechanical sweep: the real count is **8 sites across three publishable packages, touching two
  public exports**. That is larger than the remaining three combined and is gated differently, so
  it earns its own spec rather than a row here. Unparented in Linear and paired with FIX-625.
- **After epic review (round 3)** — the epic is back to **one gate structure**: the objective
  gate, then merge per row. §1's "two approvals" paragraph is deleted and §4's footnote records
  a uniformly `direct` set, because the only spec-route row left the epic.
- **After epic review (round 3)** — theme 3's independence claim is **restored, not reverted**.
  Round 2 falsified it on the FIX-754 ↔ FIX-1126 docs seam and round 3 removed the seam with the
  issue, so the three remaining rows genuinely share no file. Recorded as tested-and-restored
  because silently returning to round 1's wording would hide that it was once wrong.
- **After epic review (round 3)** — theme 1's compile-time-removal exception applies to
  **FIX-1048 alone** again. That is what round 1 said and what round 2 correctly widened to two
  issues; the narrowing back is not a reversal of round 2's reasoning but a consequence of the
  second issue leaving the set.
- **After epic review (round 3)** — §5's recurrence-guard question gained **evidence, not an
  answer**: the sweep was a mechanical BP-014 check that scored 8/8 with no false positives, so
  **FIX-625's guard is feasible**. The docs-example guard the question actually asks about is
  still a separate and larger mechanism, and the fork stays open with the owner.
