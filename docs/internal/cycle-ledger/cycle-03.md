# Cycle 3 — epic-lifecycle coordination (2026-08, in flight)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

Per-PR mode, two rows. Opened early because the owner named the class himself on #1169
("when applying feedback to PRs do not simply accrete but refactor as necessary") — the
rows are the evidence for that call, not a periodic sweep. Rounds are partials; this
cycle is not scored yet.

| PR | Kind | Rounds | Feedback classes | Claims (looped / settled / verdicts) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1169](https://github.com/fixpoint-labs/flow-state-dev/pull/1169) FIX-1073 `epic-em` | impl | 3 (in flight) | over-engineered ×1 (owner, load-bearing) · missed-edge-case ×6 (behavioral, all correct) | 0 / 0 / — | **no** — the design was right at 138 lines and right at 73; only the prose grew | The feedback loop measures the artifact's total each round, not just that every comment was answered |
| [#1166](https://github.com/fixpoint-labs/flow-state-dev/pull/1166) FIX-1072 `orchestration.md` | impl | 1 | over-engineered ×1 (four-cost list + routing table + argumentation) | 0 / 0 / — | no | Same |

## The class: correct feedback, applied additively

`epic-em/SKILL.md` went **138 → 167 → 198 → 73** lines. Rounds 1 (Cursor, three behavioral
findings) and 2 (Codex, three P2s) were **entirely correct** — not one finding was wrong, and
the 73-line rewrite still holds all 13 constraints the 198-line version held. So the failure
was neither bad feedback nor bad per-item judgment. **Each round appended, and nothing in the
loop was measuring the total.**

Two details make the mechanism legible rather than a matter of taste:

- **The reviewer's remedy is always additive.** Cursor's three findings were phrased "One
  explicit line would help", "one line that … would prevent it", "One inherited line would
  close the loop." A reviewer proposes lines; nobody proposes a restructure. An implementer
  taking each in good faith accretes by construction.
- **The rewrite is the proof.** Two findings arrived *during* the final rewrite and folded in
  at near-zero cost — a back-reference and a table row. At 198 lines they would have been two
  more paragraphs. Stated once in the right structure, a constraint is nearly free; stated as
  an addendum, it costs a paragraph and makes the next one cost more.

The author defended the growth on the PR at round 2 (the alternative was three separate
caveats) — which was locally true and globally wrong, and is what a per-comment gate produces.

## Upstream fix landed this cycle

| # | Fix | Altitude | Targets |
|---|---|---|---|
| A | `issue-spec` 6.5.2 (the anti-addenda rule) gains **growth** as a second trigger — cumulative, past ~1.3× the artifact's length when review opened — and becomes canonical for `issue-implement` 10.6, which carries a short pointer and makes the resulting re-draft binding | skill, spec + PR-feedback | both rows |

`issue-spec` **6.5.2 already held this rule**, but fired only on a *direction pivot*; neither of
these PRs pivoted. The first cut of fix A restated the rule in 10.6 instead, which left one rule
in two homes — the same accretion this cycle is about, in the fix aimed at it. Review caught it;
the rule now lives once, with two entry points. **The trigger is cumulative by construction:**
anchored per-round, small batches bloat a file without ever tripping it, which is "measure the
total, not the delta" defeated by its own trigger.

## Dropped

- **Sharpening tenet 2 ("Refine, don't accrete") or tenet 3 ("Earn every addition") to reach
  the review loop.** The conviction is already fully present in both, and in
  `writing-for-humans.md`'s "Over budget is a signal to **cut**, not to collapse more." Nothing
  was unconvinced. What was missing is a *structural* trigger at the moment feedback is
  applied — the skill ladder's rung 4, not rung 1. Three paragraphs of new grounding about not
  accreting would have refuted themselves.
- **Re-running `review`'s restraint lens per feedback round.** Would catch it, at the cost of a
  four-lens panel every round on every PR. Far more expensive than the class. Revisit if fix A
  doesn't move the number.
- **A line-count budget for skill/doc files in `writing-for-humans.md`.** That doc's budgets are
  above-the-fold word counts for reader-facing artifacts; a skill file is agent-facing, and a new
  standing budget row is exactly the registry growth the skill gates against.
- **A `Guidelines` bullet at the end of `issue-implement` mirroring fix A.** The rule would then
  live in two places in one file — the accretion this cycle is about.

## Claim to test next cycle

**Observable: at merge, no file in a PR sits above 6.5.2's growth trigger without a re-draft
commit reconciling it.** If fix A works, growth is either avoided or reconciled *before* the PR
closes, so merged artifacts carry no unreconciled accretion. If it doesn't, files merge over the
trigger untouched and the accretion ships. **Baseline: #1166 fails it** — merged with its growth
intact. **#1169 is not scored**: it never merged, so it has no at-merge result, and it was in fact
reconciled (198→73). Counting it as a failure scored *who prompted the rewrite*, which is a
different thing than the observable measures.

The criterion deliberately does **not** score a peak above 1.3× as failure. Fix A only fires
*after* growth crosses the trigger, so a correct firing **requires** a peak and then a re-draft —
scoring the peak would read every successful firing as a failure and trip the abandon-this-altitude
conclusion on the best case.

**This is the fourth formulation of this claim** — delta-vs-cumulative, raw-vs-share,
false-under-success, and a baseline that contradicted its own observable. There will not be a
fifth. Four attempts is evidence about the instrument, not bad luck: a criterion that needs five
rewrites to become scoreable is itself the argument for the mechanical check the live fork already
puts to the owner. If this formulation doesn't hold either, the conclusion is that the class isn't
measurable from review data — not that the claim needs another edit.

Fix A is prose, aimed at attention at edit time — the same shape cycle 2's round 8 note said it
doubts. If unreconciled growth still reaches merge, that is the second class where written guidance
failed to change behavior, and the honest read is mechanical enforcement (CI computing the ratio at
merge), not sharper prose. Do not spend a third cycle on rung 4 here.
