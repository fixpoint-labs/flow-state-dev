# Cycle 7 — flow-instances epic wrap (FIX-1320) (2026-09-08)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

FIX-1321 + FIX-1322 (#1640, landed atomically), FIX-1323 (#1646), FIX-1324 (#1649),
FIX-1331 (#1653), under epic [#1617](https://github.com/fixpoint-labs/flow-state-dev/pull/1617).
Four implementation PRs, **all merged the same day**; five spec PRs closed unmerged (BP-037).
Reviewers: `cursor[bot]` (three automations — simplify, Code Snob subtraction, diagrams — plus
Bugbot), `chatgpt-codex-connector[bot]`, `github-code-quality[bot]`, and the owner's own
FSD-Architect pass on the epic PR. Run under `epic-em`.

**Method — and one break from cycles 4–6 that this entry originally hid.** `Rounds` here is
**spent review waves** (a set of automated passes on one head, followed by a fix commit),
counted from `GET /pulls/N/reviews` over `cursor[bot]`, `chatgpt-codex-connector[bot]` and
`github-code-quality[bot]`. **Cycles 4 and 5 define `Rounds` as automated review passes, and
put implementation PRs on ordinary scoring** — the wave rule is theirs for *direction
artifacts* only. So a wave count and a pass count are different measurements, and this entry's
first draft claimed the method was "cycles 4–6's, unchanged" while silently changing the
denominator on every implementation row. It also adds `github-code-quality[bot]`, which cycles
4–5 did not count.

Both numbers are therefore given below: **waves**, which is what this cycle set out to measure,
and **passes**, which is the only figure comparable to earlier cycles. `nit` is excluded from
the rework signal. The epic PR takes the direction-artifact rules.

**#1617 is still open, so its row is a partial** (`1 (in flight)`) and is not compared against a
completed total. The four implementation rows are complete: each has a merge endpoint.

| PR | Kind | Rounds | Feedback classes | Claims (looped / settled / verdicts) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1617](https://github.com/fixpoint-labs/flow-state-dev/pull/1617) FIX-1320 epic-spec | epic | **1 spent (in flight)** | design-off ×1 (identity stopped at lookup; the floor had no durable owner) · over-engineered ×1 (themes 1/3/5 restate one invariant) · spec-ambiguity ×1 (a kind name and an instance id are the same string) | 1 / 1 / **REFUTED** | **yes** — the floor gained an issue at the gate | An identity change names its durable half, not only its lookup half |
| [#1640](https://github.com/fixpoint-labs/flow-state-dev/pull/1640) FIX-1321 + FIX-1322 | impl | **1 wave** · **5 passes** | missed-edge-case ×8 — **6 convergence** (route-auth collapses `migration-required` · `useFlow` still lists by kind · DevTool still keys by kind · CLI `--seed-session` writes before admission · `ChildSessionSummary` omits `flowId` · one legacy row yields three different 409s) + 2 concurrency (create-race zombie request; unfenced direct `requestId`) · stale-restatement ×1 (`add-flow` templates still scaffold `id: "default"`) · docs-miss ×2 (changeset prose; migration SQL updates the column, not the blob the adapters read) | 0 / 0 / — | no | Enumerate every door the address change passes through — the same fix as cycle 1 |
| [#1646](https://github.com/fixpoint-labs/flow-state-dev/pull/1646) FIX-1323 | impl | **2 waves** · **5 passes** (3 defect-finding; 2 were the diagram automation) | missed-edge-case ×2 (non-injective isolation key — two `(identity, instance)` pairs name one cell; empty-bucket retention the flat map did not have) · stale-restatement ×1 (the child-scope table promised sharing the runtime no longer gives, in three surfaces) · nit ×4 | 0 / 0 / — | no | — the injectivity finding is a genuine design catch, not rework |
| [#1649](https://github.com/fixpoint-labs/flow-state-dev/pull/1649) FIX-1324 | impl | **2 waves** · **3 passes** | missed-edge-case ×2 (a saved hint deleted on a *transient* failure; devtool's `recordBelongsTo` silently disagreeing with engine's `ownsRecord`) · over-engineered ×1 (an extraction sized off a line estimate) · docs-miss ×2 (changeset `minor` where policy says `patch`; changeset prose) · nit ×4 | 0 / 0 / — | no | Size a restructuring by enumeration before instructing it |
| [#1653](https://github.com/fixpoint-labs/flow-state-dev/pull/1653) FIX-1331 | impl | **2 waves** · **6 passes** (7 with `github-code-quality`) | missed-edge-case ×6 — **5 convergence** (sequencer's allowlist rebuild drops `flowConfigSchema` · a block requirement's parse output discarded · `.strict()` does not clear a `catchall` · dynamically-resolved tools never walked · a legacy structural instance admitted with no bag) + 1 type/runtime (inferred config typed mutable, frozen at runtime) · stale-restatement ×1 (docs echo across four surfaces, deferred) · docs-miss ×1 (changeset prose) · nit ×5 | 0 / 0 / — | no | Same class again — see below |

## The dominant class is the one tenet 5 has named since cycle 1

**~30 classified findings; `missed-edge-case` is 18 of them, and 12 of those 18 are
convergence** — one decision honoured at some of its sites and not others. Add the three
`stale-restatement` findings, which tenet 5's third paragraph explicitly owns, and **half of
this epic's review findings are tenet-5-shaped.**

- *#1640, across doors:* address-by-instance was applied at the registry, the host and the
  action route, and missed at route-auth, `useFlow`, the DevTool, the CLI seed write, the client
  child summary and the `add-flow` templates.
- *#1653, across carriers:* one declaration (`flowConfigSchema`) honoured by three of four block
  builders, one of two tool-resolution paths, and one of two admission paths — and its parse
  output declared and discarded.

**#1653 is the sharpest instance in the ledger to date, because the feature was built to remove
exactly this defect.** FIX-1331 exists so a misconfigured copy fails loudly; five separate paths
inside it let a declaration silently do nothing. Every one type-checked. That is the sub-shape
worth naming: **on the carrier axis there is no old answer for a reviewer to find — the compiler
returns success, so reading is not merely unreliable, it is actively reassured.**

**This is a coverage result, not a gap in the grounding.** Tenet 5 names the arithmetic and
tenet 7 names the tell, both in the always-loaded layer — and it is still the dominant class at
cycle 7, which is the whole argument against naming it a fourth time. **No prose change is
proposed for it; fix B is a test shape, not a restatement.** See *Dropped* and fix B.

## Rounds-to-approval did NOT fall — the metric changed, and two caveats finish the reading

This entry's first draft read: *"1–2 spent rounds on every implementation PR, against cycle 1's
5–12, cycle 5's 2–6 and cycle 6's 1/1/10/13 — the best cycle recorded."* **That comparison was
invalid**, and a reviewer caught it. It set this cycle's *wave* counts against earlier cycles'
*pass* counts.

**On the comparable metric, this cycle is unremarkable.** Automated passes per implementation
PR, counted as cycles 4–5 count them (`cursor[bot]` + `chatgpt-codex-connector[bot]`):

| PR | #1640 | #1646 | #1649 | #1653 |
|---|---|---|---|---|
| Passes | 5 | 5 | 3 | 6 |

Against **cycle 5's 2–6**, that is 3–6: the same range, at the top of it. There is no
improvement here to explain. The wave counts (1–2) are real and worth recording — they say the
*fix commits* were few — but a wave collapses however many passes landed on one head, so a low
wave count is partly a statement about how quickly the head moved to merge, which is the second
caveat below, not a statement about convergence.

**Why the error is worth its own paragraph — cycle 4 predicted it by name.** The note under
cycle 4's table closes: *"Two baselines have now been invalidated by the same definition change;
check for a third before trusting any rounds trend in this file."* **This is the third**, by the
same mechanism, written by an instrument whose subject that cycle was definition drift. The
false reading was flattering, arrived with a method line asserting continuity, and would have
become the baseline the next cycle is scored against. It is also the shape of the class this
epic catalogued: a claim that type-checks against the surrounding prose and is not true.

The standing instruction that follows is cycle 4's, now with three instances behind it: **a
rounds figure in this file is not comparable across cycles until you have re-read both cycles'
method lines.** A cycle asserting its method is unchanged is not evidence that it is.

**The caveat, and it is the finding cycle 5 pre-registered.** Cycle 5's claim 3 — *"before
reporting any class at or near zero, confirm every configured reviewer actually reported on the
head being scored"* — was run here, and **three of the four implementation PRs merged on a head
no automated reviewer ever passed over:**

| PR | Merged head | Last head an automated reviewer read |
|---|---|---|
| #1640 | `6fd3bbcd1` | `0dfe5d7ef` — the fix commit `d48f5fd7c` and the merge head were never re-read |
| #1646 | `32690a0ab` | `32690a0ab` — **reviewed**, 17 minutes before merge |
| #1649 | `1d09cd04e` | `1d9138cbd` — `f7657e563` and after were never re-read |
| #1653 | `96dbc8d69` | `29c9b6d0f` — `b7214b3f6` and `96dbc8d69` were never re-read |

On #1653 the unreviewed commit `b7214b3f6` is precisely *"close the gaps behind the config bag's
promises"* — the fix for four of the five fail-quiet doors, in a class whose signature is a fix
that reads correctly and does nothing. It was verified by its author (full suites, goal re-run,
each finding reproduced red first) but never re-reviewed.

**So the low WAVE count partly measures convergence and partly measures merging before round
two.** (The pass count, above, shows no convergence gain at all.) The two are not separable on
this data, and a later cycle reading `1` as convergence will score this epic as cheaper than it
was. Recorded as a fact, **not** as a proposed gate: there is
no measured escape to justify slowing every PR, and the merge call is the EM posture working as
designed. Claim 1 below is how it gets settled.

## Claim 1 was run before this entry merged, and it found an escape

The re-scan below was not deferred to next cycle: an adversarial review was run over exactly the
four unreviewed ranges in the table above, the same day. The pre-registered method (*look for
post-merge fix commits naming the issues*) would have measured **zero** — nobody had fixed
anything, because nobody had looked. Re-reviewing the unreviewed code instead found **two live
defects sitting in `main`**, both in #1653's unreviewed `b7214b3f6`, the commit whose whole
purpose was closing this class's doors:

| # | Defect | Class |
|---|---|---|
| 1 | A block whose `flowConfigSchema` names a setting inside a nested object is refused by every flow. Zod strips at every level, so a narrower nested requirement parses to a smaller nested object, and the whole-object comparison read that narrowing as contributing. The flow could then be neither minted nor registered bare, since the same predicate answers the blueprint's `requiresConfig` probe | convergence — the rule *"stripping is not contributing"* honoured at the top level and not at the levels below it |
| 2 | The check on dynamically resolved tools read `flowConfigSchema` off the top-level tools only, while the definition-time walk descends through composition and static tools. A needy block inside a tool was checked when the tool was static and not when a function returned it — offered to the model and run against a bag it had declared it could not accept | **fail-quiet, and the carrier-axis sub-shape exactly** |

**A correction to the table above, from the same scan:** it is **four** PRs that merged unread,
not three. #1646 *looks* reviewed at its merged head — a `cursor[bot]` comment landed on
`32690a0ab` six minutes before the merge — but that was the visual-walkthrough automation, whose
body is a mermaid diagram and a canvas link, not a defect-finding pass. Three distinct automations
post under one bot identity, and scoring by author rather than by what the review *does* counts a
diagram as coverage. Rebase equivalence was verified by normalised patch content, not by SHA.

**What this settles.** The low round count is no longer separable-in-principle; it is now measured
on one side. Merging at round two on this chain **did** leave real defects in `main`, and both are
in the family the epic was catalogued around. Fixed in FIX-1336; the fix's own tests assert the
static and dynamic carriers side by side.

**What it does not settle.** Two defects on one chain is an escape, not a rate. Both were found by
one deliberate re-review that cost more than a review round would have — this measures the *cost of
not re-reviewing*, not the general escape rate, and a gate on every PR still is not justified by
n=1 chain.

## Scoring the previous cycles' fixes

- **Cycle 5, fix A** (BP-003 extended to the claims that scope a change — *a reviewer's assertion
  is a guess too*): **two post-fix instances, and the discipline held in both.** #1653's module
  extraction was built and measured (232 lines moved, 215 removed) rather than argued; #1649's
  `useHeldWorkspaceRead` extraction was sized by enumerating call sites (20–30 net) against a
  reviewer's estimate (150–200). The measurement overturned the estimate both times. Fix A was
  aimed at the implementer's chair and **appears to work there.** Both residual costs landed in
  the chair it does not govern — the coordinator's — which is where this cycle's fix goes.
- **Cycle 6's proposed guard-table** (`goals/README.md`): **not adopted.** It was put to the
  owner rather than taken, and `goals/README.md` carries no guard table. Nothing to score.
- **Cycle 1, fix A** (tenet 5's convergence clause): **still the dominant class, six cycles on.**
  Combined with cycles 4–6's repeated finding that prose naming a class does not prevent the
  class, this is the strongest available evidence that the remaining work on this family is
  mechanism, not wording.

## Upstream fixes — two: one uncovered class, and one condition that fired

| # | Fix | Altitude | Targets | What it can do |
|---|---|---|---|---|
| A | **`epic-lifecycle` gains one bullet: *Blind by design — so check, don't infer.*** Never re-dispatch a row on elapsed silence — look for evidence of life first (worktree head, branch on `origin`). Never promote a reviewer's restructuring ask to an instruction before the number behind it exists (BP-003). | skill, coordinator | two coordination incidents this epic, neither covered by any tenet, BP or skill | **the only genuinely uncovered class here.** Score it on whether a live worker is duplicated again |
| B | **`write-block-tests` gains *Parameterize over carriers, not just over kinds*** — a declarative slot is found by code that WALKS to it, and the same declaration arrives by several carriers (action root, child block, static tool, tool returned at run time). Cover them in one `describe.each`, or assert two side by side, so a walk that stops one level short fails a test. Plus a coverage-checklist line. | skill, implementer | the fail-quiet / carrier-axis class — **not** as prose naming the class, but as a test shape at the point the slot is read | the pre-registered condition fired: score it on whether a carrier-shaped defect reaches `main` again |

**Why the skill and not the `epic-wake` script.** Dedupe is normally the script's remit, but the
check that settles this one is a filesystem read (a worktree head), and the script cannot read
the filesystem. The decision is the coordinator's; so is the rule.

**The two incidents.** A worker quiet for ~2h and not answering a status ping was judged dead and
its task re-dispatched; it was 5.5h into a healthy run. The collision was harmless **only because
that worker re-checked `origin` before pushing** — the safety came from a property of the worker,
not from the coordinator's decision. Separately, a module extraction was instructed on one
reviewer's file-altitude argument, built, measured, and reverted when a second reviewer applied
the subtraction test. Both are the same failure: **the coordinator acting on a second-hand signal
where cheap ground truth existed.** Reconstructed from worktree state (two agent worktrees on the
FIX-1331 spec, `e1d133612` at 12:55 and `efd82d94c` at 18:38 on a detached HEAD) plus the
coordinator's own report; there is no log, so it is an **author self-report, outside the review
sample and excluded from every rate above.**

## Dropped

- **A BP or tenet clause for the fail-quiet / convergence class — still dropped, and the
  reasoning survived the escape.** Three counts stand: tenets 5 and 7 already name it in the
  always-loaded layer, so a new entry is a near-duplicate that weakens both; tenet 5 already
  carries three parallel paragraphs of the same arithmetic and a fourth is the checklist growth
  tenet 3 forbids; and cycles 4, 5 and 6 each concluded that prose naming this family does not
  deter it — cycle 5 saw the class recur inside the remedy for it, within the hour. **A fourth
  consecutive prose fix would be the instrument justifying itself.**

  This entry was written recommending *no change of any kind*, on the added ground that review had
  caught every instance before merge. **That ground is gone** — claim 1 found a carrier-shaped
  instance in `main` — and the same paragraph pre-registered what to do about it: *if it recurs,
  the case is for a mechanism, not a sentence.* So the prose fix stays dropped and fix B above
  takes its place. The distinction is the whole point: fix B is not a rule saying "watch out for
  fail-quiet", it is a test shape at the one place the slot is read.
- **An upstream fix for the repeated docs-consolidation ask.** Verified: four reviewers raised it
  independently on #1640 (~30 pages), #1646, #1649 and #1653, and each was deferred to
  `polish-docs` at the wrap. **The deferral is the right standing answer** — consolidating from
  inside one PR is how four pages end up half-consolidated in four directions, which is what
  every reply said. The cost is real (~8 review artifacts for a decision made at the first one)
  but there is no cheap cure: #1653's description stated the deferral in advance and the reviewer
  raised it anyway. Uninstructable reviewers repeating a below-the-bar point is already
  `orchestration.md`'s expected behaviour, not a process defect.
- **A BP for "reproduce every review finding red before fixing it."** It worked — 6 of 6 on
  #1653, none failed to reproduce, and the discipline caught two findings a reviewer described
  convincingly and got wrong, plus two of the author's own vacuous assertions on #1649. It is
  also already tenet 7 (*break it on purpose and confirm the signal changes*) and BP-003.
  Nothing to add; recorded as the loop working.
- **A rule that two reviewers should disagree.** True twice here, but the disagreement only
  surfaced the question — **the measurement settled it** both times. Codifying the disagreement
  would codify the cheaper half, and the `review` skill already composes parallel lenses.
- **`inverted-check` / carrier-axis as a new feedback class.** Cycle 6 opened this watch on one
  instance. This cycle adds the #1649 vacuous-assertion pair. Still folded under
  `missed-edge-case`; **watch it a third cycle** before minting a label.

## Claims to test next cycle

1. ~~**Does an escape appear on this chain?**~~ **Answered within the cycle — two defects, both
   in `main`, both carrier-shaped.** See *Claim 1 was run before this entry merged* above. What
   carries forward is the narrower question fix B is scored on: **does a carrier-shaped defect
   reach `main` again, on a chain whose tests were written after fix B landed?** Note for whoever
   scores it that the pre-registered method here would have returned a false zero — searching for
   post-merge *fix commits* only finds defects somebody already noticed. Re-review the unread
   range instead."
2. **Convergence as a share of findings, after the epic that catalogued it.** It is ~40% of all
   findings and ~two thirds of `missed-edge-case` here, with tenet 5 in force since cycle 1.
   **Score which agent caught it** — if reviewers keep finding it and authors never do, the
   grounding is being read and not applied, and the next move is a mechanism at the point a
   declarative slot is added.
3. **Is a live worker duplicated again?** Fix A's only job. One instance this cycle; a second
   after the fix means the check is not being spent, and the next move is a handle the
   `epic-wake` script can refuse to re-dispatch rather than a rule the coordinator must remember.
