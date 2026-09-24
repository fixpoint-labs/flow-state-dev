# Cycle 5 — declared-surface epic wrap (FIX-1127) (2026-08-12)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

Full epic sweep at wrap: three merged implementation PRs plus one follow-up still open, under
epic [#1249](https://github.com/fixpoint-labs/flow-state-dev/pull/1249). **18 automated review
passes so far** — small next to cycle 4's 80, because three of the four rows are one-file fixes.
Read the classes, not the totals. Per-instance evidence for every count below — the enumeration,
the branch-head rescoring, and the correction narrative — lives in
[`epic-wraps/declared-surface-1127.md`](../epic-wraps/declared-surface-1127.md).

**Method:** cycle 4's, unchanged. `Rounds` = automated review passes (`get_reviews`;
`cursor[bot]` + `chatgpt-codex-connector[bot]`); implementation PRs take ordinary scoring, the
epic PR takes the direction-artifact rules. **Classes stay inside the header's closed taxonomy** —
the shape named below is a parenthetical qualifier on `missed-edge-case`, not a new label.

**Sample definition, stated so the next cycle can reproduce a rate instead of inferring one.** The
**review sample** is the five rows below — every classified review finding on this epic's PRs,
**16 findings**. That is the denominator for every rate in this entry. The entry also enumerates
**four** further instances of one shape that lie **outside** that sample: an author's self-report, a
reviewer's own unrun assertion, this wrap PR's own correction, and the defect in the fix for that
correction. They are counted in the enumeration and **excluded from every rate**, because the set
they come from has no denominator — nobody can count the claims that were made and never checked.
Where the two figures diverge, this entry says which one it is using.

| PR | Kind | Rounds | Feedback classes | Claims (looped / settled / verdicts) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1249](https://github.com/fixpoint-labs/flow-state-dev/pull/1249) FIX-1127 epic-spec | epic | **3 spent (in flight)** (6 raw) | design-off ×1 (FIX-754 left the set at round 3) · over-engineered ×1 (§2 cut from seven themes to three) · missed-edge-case ×1 (unrun-claim — independence asserted, then falsified) | 2 / 1 / **REFUTED** | **yes** — the set was resized twice and shed a row | Settle a scope count by parse before the gate, not at round 3 |
| [#1262](https://github.com/fixpoint-labs/flow-state-dev/pull/1262) FIX-1052 + FIX-1051 | impl | 3 | over-engineered ×2 (one rationale across JSDoc + changeset + test comment) · docs-miss ×2 (changeset altitude; **protocol tags in the published fragment**) | 0 / 0 / — | no | A guard on the fragment body (FIX-1139) |
| [#1263](https://github.com/fixpoint-labs/flow-state-dev/pull/1263) FIX-1126 + FIX-502 | impl | **6** | missed-edge-case ×3 (unrun-claim — dotted Anthropic IDs · Google-less intent ladder · `create-block` template) · stale-restatement ×1 (utility default in four places) · docs-miss ×1 (no provider package in step 1) | 1 / 1 / **REFUTED** | no | Run the documented config once per single-provider key |
| [#1275](https://github.com/fixpoint-labs/flow-state-dev/pull/1275) FIX-1048 | impl | 2 | missed-edge-case ×1 (`patch` where pre-1.0 breaking is `minor`) · over-engineered ×1 (one rationale in five places) | 0 / 0 / — | no | — `AGENTS.md:32` already states the rule plainly |
| [#1273](https://github.com/fixpoint-labs/flow-state-dev/pull/1273) FIX-1142 | impl | 1 (in flight) | over-engineered ×1 (policy prose in four places) · stale-restatement ×1 (stale success string) | 0 / 0 / — | no | — |

**#1249 is still open, and this epic is deliberately unfinished.** An epic PR closes unmerged at
wrap; this one hasn't, because the wrap itself is still in flight. **The row is a partial, per
this instrument's own rule that an in-flight epic is never compared against a completed total** —
and the partial is live, not nominal: the two wrap PRs (this entry's, and the docs-polish pass)
are epic work accruing review rounds right now, and none of those rounds are in the 18 above.
What finalises the row: both wrap PRs land, #1249 closes unmerged, and the epic's rounds are
re-totalled. Until then a later cycle reading `3 spent` as final will score this epic as cheaper
than it was.

## The selected class: `missed-edge-case (unrun-claim)` — 4 of 16 findings, plus 4 outside the sample

**A claim about what the system does was settled by argument, and the argument was locally
sound.** Not a knowledge gap and not carelessness — every instance reads as competent reasoning.
The enumeration is in
[`declared-surface-1127.md`](../epic-wraps/declared-surface-1127.md#missed-edge-case-unrun-claim--the-enumeration);
the counts and the selection axis are here.

**It is not the dominant class, and the first draft of this entry said it was.** On the review
sample, `unrun-claim` is **4 of 16** findings — four of the five `missed-edge-case` findings —
while `missed-edge-case` (5) and `over-engineered` (5) tie as the largest classes. The "7
instances" the first draft led with silently mixed the four sampled findings with instances
drawn from a wider set. Corrected by parsing the table's own class column rather than tallying it
by eye, which is the method this section is about.

**Nor does escape carry the selection: one instance shipped, not two.** The second "escape" an
earlier draft counted was #1275's `patch`/`minor` PR description — a **`stale-restatement`**
instance, scored under cycle 4's fix A, a different class. Read off the companion's outcome
column: of the eight enumerated instances, review caught six, one was a reviewer's own unrun claim
declined after the author ran it, and **one shipped** (#1262's lazy-resource claim, self-flagged as
unverified). Cycle 4 selected `stale-restatement` on 4 escapes out of 9. One out of eight is not
that signal, and the comparison should not be drawn.

**So what does select it, stated as the judgement call it is.** Not frequency, not escape rate.
Two things: the failure mode is **confident and silent** — a wrong scope count reshapes a change
rather than adding a review round, and `over-engineered`, the class that ties it on count, costs a
paragraph — and the class **recurred twice inside this wrap PR itself** (the ancestry correction,
then the defect in its own fix), which is a recurrence signal that owes nothing to the review
sample. That is a qualitative argument. The quantitative case for selecting this class over the two
that outnumber it **does not hold**, and a later cycle should challenge the selection rather than
the arithmetic. Claim 1 below pre-registers the test that would settle it.

**And the honest counter-reading, recorded because it is available on this data:** review caught six
of eight, including both of this PR's own instances. That is evidence the review layer already
handles this class, which argues the remaining work is mechanism (FIX-1146) rather than anything
written down.

**The asymmetry is the finding.** Every settlement by a parse or an execution *of the claim
itself* was right on the first attempt — FIX-754's count was read carefully three times and was
wrong all three, then parsed once and was right (**8**, 8/8, no false positives). Every
settlement by reading that was later checked was wrong. Careful reading did not produce hedged
answers, it produced confident wrong ones.

The lesson is neither "trust the reviewers" nor "run something" — a reviewer's unrun assertion is
still a guess, and a command aimed at a neighbour of the claim buys confidence without buying
evidence. The instances that establish each are in the companion, including **instance 8: the
sampling rule this cycle promoted to prevent the neighbouring-question failure prescribed a
neighbouring-question check** (authoring time instead of ancestry), and got two of this epic's own
instances backwards. Caught by a reviewer, not by its author, inside the PR that diagnosed the
shape.

## Scoring cycle 4's fixes — a partial test, corrected once under review

Cycle 4's fixes landed in `b0fc019` at **17:47 on 2026-08-12**, mid-epic, so the question is which
**branch heads** carried them — not when they reached `main`. Two of the four did throughout, one
not at all, one from 20:57 onward. Derivation and per-instance commits in
[`declared-surface-1127.md`](../epic-wraps/declared-surface-1127.md#scoring-cycle-4s-fixes--which-branch-heads-carried-them).

- **Fix A** (`issue-implement` 10.6, grep the superseded claim's distinctive noun): **2 post-fix
  instances** — #1273's stale success string, and #1275's PR description recording the changeset
  as `patch` while the merged fragment says `minor`. **0 edit-time · 1 review · 1 escaped**, the
  escape frozen in a merged body. #1263's instance is **withdrawn** as pre-fix.
- **Fix B** (tenet 7, *a check that cannot fire is not a check*): **0 post-fix instances — this
  scoring is withdrawn in full.** #1263's 1,624-file exclusion was authored ninety minutes before
  the clause reached that branch, so it says nothing about whether the clause works.

**Cycle 4's rule still fires, on a thinner basis than first claimed:** *"If fix A lands and
instances still escape, reading 2 is confirmed twice and the next move is CI, not prose."* Fix A
landed, and one instance escaped into a merged PR body. That is one escape, not a pattern — the
trigger is met as written, and the next cycle should treat the strength of the evidence as one
data point rather than four.

**This section was wrong on first write, and the failure is the entry's own instance of the class
it names** — a real command, executed, that could not have returned "no" (instance 7). It is the
reason the fix below cross-references tenet 7 rather than restating it. **The fix for that failure
then reproduced it** (instance 8): the sampling rule promoted into `distill-lessons` prescribed
comparing authoring timestamps, which is a neighbour of ancestry and reverses this epic's own two
pre-fix instances. Both are kept in full in the companion rather than smoothed over, because the
failures are more instructive than the result.

## Upstream fixes — one prose row, three filed mechanisms

Split into two rows because they do different things, and a future collector scoring this cycle
should not read the first as a behaviour change that failed.

| # | Fix | Altitude | Targets | What it can do |
|---|---|---|---|---|
| A | **BP-003 extended from the deliverable to the claims that scope it** — a scope count, an equivalence, or what a path does at runtime carries the same evidence burden; settle it by executing or parsing, a reviewer's assertion is a guess too. Plus a cross-reference to tenet 7 for the green-result-that-cannot-fail shape (`best-practices.md` + the `CLAUDE.md` mirror) | BP | the citation gap, narrowly — the 4 sampled `unrun-claim` findings and the 4 outside it | **citeable in review, not behaviour-changing.** Score it as a closed citation gap; do not score it as a fix that was supposed to drive the count down. Instance 8 is direct evidence it will not |
| B | **Three mechanisms, filed rather than written** — FIX-1146 (resolve the documented config per single-provider key), FIX-1147 (post-merge revalidation of an epic's other open PRs, scoped to PRs the merge can actually invalidate), FIX-1148 (read Linear label writes back) | mechanism | the same shape, at the point where it can be executed instead of remembered | **the actual bet.** Score these on whether they land and whether the class falls after they do |

**Row A is the narrow half deliberately.** BP-003 governed deliverables and said nothing about the
claims that scope them, so when a reviewer wanted to say "you didn't run that," there was no clause
to point at. Closing that is worth one sentence. It is not worth pretending a sentence changes
behaviour that five cycles now say prose does not change: the class was named, with this exact
evidence, in the epic-spec at the objective gate — *"It was read carefully three times and
undercounted every time; only a mechanical parse got it right"* — four hours before #1262 opened,
and then recurred repeatedly downstream in the same session, same loop, and **twice more in this
entry**, the second time inside the fix itself. **Prose naming the class did not prevent the
class.**

### Re-derived after four corrections — what actually still supports row A

Review cut this entry's evidence four times. Rather than patch each number where it sat, the
conclusion is re-derived from what is left.

| # | What the entry claimed | What it is after review | Effect on row A |
|---|---|---|---|
| 1 | Cycle 4's fixes got a four-PR controlled test | one PR never carried them; one split mid-branch. **One escape, not a pattern** | removes the "prose fix A demonstrably worked" precedent |
| 2 | `unrun-claim` is the dominant class, 7 instances | **4 of 16** sampled findings; `missed-edge-case` and `over-engineered` tie above it | removes the frequency argument entirely |
| 3 | Two of the instances shipped | **one** shipped; the second was a different class | removes the escape argument as a basis for selection |
| 4 | The sampling rule promoted here prevents recurrence | **the rule was itself defective in this class's exact shape**, caught by a reviewer | direct evidence *against* expecting prose to change behaviour |

**Three of the four arguments this entry originally made for row A are gone, and the fourth now
points the other way.** Frequency: withdrawn. Escape rate: withdrawn. The precedent that a prose
fix worked last cycle: thinned to a single data point. And correction 4 is first-party evidence
that writing this rule down did not stop the author who had just diagnosed the class from
committing it again, inside the remedy, within the hour.

**What survives is one argument, and it is untouched by all four: the coverage gap.** BP-003
governed deliverables and said nothing about the claims that *scope* them, so when a reviewer
wanted to say "you didn't run that," there was no clause to cite. That is a statement about what
the rule **covers**, not about how often the gap bites — so a rate correction cannot weaken it, and
neither can correction 4, which is evidence about **deterrence**. Row A's stated job is citation,
not deterrence, and the two are being kept apart deliberately.

**Stated plainly, because the alternative is a tidy case that is not true:** this entry no longer
carries a measured argument that `unrun-claim` is the cycle's most expensive class, and it carries
fresh evidence that grounding prose does not close it. If the sentence is taken, it should be taken
because a citeable rule is worth one line, and for no other reason. If the reader's bar is "show me
the rework this prevents," the honest answer is that this entry cannot, and the answer is FIX-1146.
The fork is live on the wrap PR and is put to the owner on these figures, not the original ones.

## Dropped

- **Protocol tags leaking into a changeset** (`</content>`, `</invoke>` in
  `own-declared-resources-stay-own.md`, headed for published `@flow-state-dev/core` release notes).
  Real, and caught by codex — who verified it with `@changesets/parse` rather than asserting it.
  **Already filed as FIX-1139** with its design constraint recorded. One instance, already a gate;
  a lesson would be a second copy of a ticket. Same disposition as cycle 1's NUL-byte drop.
- **"A correct premise applied to the wrong question"** (#1275's `patch`). The argument — `core` is
  `0.0.0` with no consumers — is *true*, and is the right reason the deletion needs no deprecation
  window. It was simply answering a different question than the bump level. But `AGENTS.md:32`
  states the rule without ambiguity, so this is a rule that was clear and wasn't applied, not a
  guidance gap. One instance. **Watch it**; do not write it down.
- **"Don't surface a PR as merge-ready before the last reviewer has finished the current head."**
  #1263 was surfaced, then two P2s landed on that same head minutes later and it was retracted.
  One instance, coordinator-level, no cost beyond the retraction. Revisit on recurrence.
- **Widening `settle-claim`'s trigger** from "argued twice" to "cheap to execute and load-bearing".
  Tempting: FIX-754's count was argued **four** times before a parse settled it, and cycle 4
  independently flagged the same trigger as possibly too narrow. Two cycles pointing at one
  trigger is not yet three, and this cycle's answer is mechanism, not another skill edit. **This is
  the first candidate to pull back if the class survives FIX-1146.**

## Claim to test next cycle

1. **`unrun-claim` falls, and specifically: no scope count or equivalence claim reaches a PR
   description without an execution or parse behind it.** Score the *method*, not the outcome — a
   claim that happened to be right after being read is still an unrun claim, and counting it as a
   pass makes the metric unfalsifiable. **Score the neighbouring-question sub-shape separately**;
   it is the one BP-003's first wording missed, and a collector that only asks "was something run"
   will score this entry's own correction as a pass. **Baseline to beat, on the review sample:
   4 of 16 findings, 1 escape out of 8 enumerated instances** — quote the denominator, not the raw
   count, or the comparison is with a number this cycle also had to correct.
   **And test the selection itself, not just the count.** This cycle selected `unrun-claim` over
   two classes that outnumber it, on a qualitative argument (silent failure mode, recurrence inside
   the instrument) after the frequency and escape arguments were both withdrawn. If next cycle's
   `unrun-claim` escape count is again 0–1 while `over-engineered` or `missed-edge-case` stays
   level or rises, **the selection was wrong and the axis should move**, regardless of what the
   `unrun-claim` count does.
2. **`stale-restatement`'s escape count.** This cycle, scored only on the branches that carried
   fix A: **2 instances, 0 edit-time, 1 review, 1 escaped.** That is the second consecutive cycle
   with a post-fix escape, on one data point rather than a pattern. If it escapes a third time,
   stop editing skills for this class and cost the CI check.
3. **A zero on either is suspect until confirmed the reviewer was looking.** No lens asks about
   `unrun-claim` today, and an unmeasured shape reads as a solved one.

**For the next collector:** the sampling rules this entry got wrong — ask the **branch head**, never
the merge commit or the API's `base.sha`; and decide which commits carried a fix by **ancestry**
(`git merge-base --is-ancestor`), never by authoring timestamp — are now operational spec in
[`distill-lessons`](../../../.agents/skills/distill-lessons/SKILL.md) → "Scoring a previous cycle's
fix", not a footnote here. The ancestry half is there because the first version of that rule said
*timestamp* and was wrong; see instance 8. Cycle 4's fix table has been corrected in place for the
same reason.
