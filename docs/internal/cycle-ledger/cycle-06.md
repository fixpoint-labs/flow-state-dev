# Cycle 6 — Conductor epic wrap (LAB-68) (2026-08-18)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

LAB-133, LAB-136, LAB-134, LAB-135 under epic LAB-68. Four implementation PRs, three spec PRs
closed unmerged (BP-037), ~45 review findings across `chatgpt-codex-connector[bot]`,
`cursor[bot]`, `greptile-apps[bot]` and the implementing agents themselves. Per-instance
evidence: [conductor-68.md](../epic-wraps/conductor-68.md).

**Read the denominator caveat before any comparison.** Nothing merged — the chain is open at the
owner's gate — so **the escape column is structurally empty, not measured zero.** Cycles 4 and 5
score escapes to `main`; this cycle cannot. Comparing its escape rate to cycle 5's compares a
number to its own absence. Everything below is caught-in-review or caught-by-author.

**And the sample is biased toward its own subject.** This epic's deliverables *are* checks that
grade a coding run, so a class about checks that cannot see what they measure is over-represented
by construction. Weight it accordingly; do not read cycle 6's dominance of that class as a trend
against cycle 5.

| PR | Kind | Rounds | Feedback classes | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|
| #1327 (LAB-133) | impl | 1 | `missed-edge-case` ×2 | no | three-way rescue outcome stated in the spec's decision, not two |
| #1325 (LAB-136) | impl | 1 | `over-engineered` ×1, `missed-edge-case` ×1 | no | a guard whose rejection was never watched fire — see the reverted anchor guard |
| #1332 (LAB-134) | impl | 10 (capped) | `missed-edge-case` ×22, `nit` ×4, `over-engineered` ×3 | no | LAB-137 — make the invariant structural |
| #1334 (LAB-135) | impl | 13 | `missed-edge-case` ×31, `over-engineered` ×3, `docs-miss` ×2 | no | the calibration fixture must carry the state a rule is about |

**Both round counts were understated when first written and are corrected here.** #1334 was recorded
at 8 while it was still running; it took 13, and the last five produced the cycle's most consequential
findings (A3 and A7 inert, the seventh ambiguity direction). **A count entered before the thing it
counts has stopped is an unrun claim about the future** — the same class this cycle selected, committed
inside the instrument that measures it, for the third cycle running. The correction is in place rather
than appended because a wrong number in a measurement table is worth less than no number.

## Scoring cycle 5's claims

**Claim 1 — `unrun-claim` falls.** *Not scoreable as a rate* (no escapes possible), but scoreable
as **method**, which is what cycle 5 asked for. Result: **the method held on deliverables and
failed on summaries.** Every goal verdict was executed and pinned to a commit; `git diff --quiet`
before dispatch became routine. But four unrun claims reached a PR body or commit message anyway,
all of them *counts about the work rather than the work*: "all 181 existing tests passed" (181 is
the after-count, 176 was measured — caught by its own author) · "CI 8/8 green" ×2 (actually 6 pass
+ 2 neutral, one of which was a reviewer that never ran) · a coordinator changeset sweep whose
parser was broken and reported the opposite of the truth.

**The sub-shape cycle 5 flagged — a green result from a check aimed at a neighbour of the claim —
did not fall. It was the epic's main sequence: 12 instances.** See the caveat above before
concluding anything about the trend.

**Claim 2 — `stale-restatement` escape count.** **Unmeasured, and say so.** Two instances caught in
review (a header saying "two collections" beside three; a comment saying pathless calls are
"skipped silently" after the body began emitting a gap row). Zero escapes — because zero could
escape. **This does not discharge the third-escape trigger; it does not test it.**

**Claim 3 — a zero is suspect until the reviewer was looking.** **Directly vindicated, by
accident.** `cursor[bot]` exhausted its usage budget mid-epic and stopped reviewing both live PRs.
Its distinctive class (doc/comment drift, state trims) therefore shows near-zero for the back half
— an artifact of the reviewer stopping, not of the class stopping. Worse, **its abort renders as
`neutral` in the checks list**, sitting beside six passes and reading as "nothing failed." A
reviewer that did not run and a reviewer that found nothing are indistinguishable at a glance,
which is claim 3's exact hypothesis occurring in the instrument rather than the sample.

## The class selected, and the fix is mechanism rather than prose

**`wrong-extent`** — a fix aimed at the right defect, covering less than the defect. **Six
instances plus one rule wrong in three successive directions**, across two PRs and eight rounds.
Selected over the larger blind-check count because (a) blind-check is the biased half of this
sample and (b) `wrong-extent` is invisible to the test you would naturally write, since that test
is written against the target.

**Cycle 5 established that writing a rule down did not deter the author who had just diagnosed the
class.** This cycle is first-party evidence of the same thing at a finer grain: #1332's implementer
*named* `wrong-extent` in round 9 and hit it four more times by round 11 — including once inside
the fix for it. **A seventh sentence in `best-practices.md` is not the fix.**

**What did work, measured:** LAB-135's guard table — 64 broken worlds run **pre-dispatch**, every
entry after the first added because a mutation stayed green, and **each entry asserting which
branch it must reach.** It hard-stops before a model call, so eight rounds of regressions cost no
coding run. It caught two defects nobody was looking for: a mutation that stayed green because the
guard could not reach reader-side code, and a guard case that silently retired when the fixture
grew past its array index. **Rules were half-applied six times this epic; the table never was,
because it is not remembered — it executes.**

**And the proposal needs one specific clause, identified by #1334's implementer on the way out.**

> *"The no-cap rule is now the load-bearing part of the process, and it has no mechanism behind it.
> The guard table catches regressions in the **check**; nothing catches a repair that over-rejects
> the world next to the one it was shown — that has been found by review three times, all three by
> Codex."*

**That is this cycle's own conclusion turned on its own remedy.** The finding is that structural
beats remembered; the rule now carrying the most weight — *a defect our own repair introduced folds,
however many times* — is **remembered**, and every instance of it was caught by an external
reviewer rather than by the table.

So the adoption should carry its clause: **make "both directions, including a neighbouring world
that must pass" a requirement of adding a case, not a habit.** Every fold in #1334's last rounds
shipped stand-downs precisely so the fix could not degrade into a blanket rejection — and that
discipline held only because one implementer kept choosing it. **A fifth self-inflicted regression
arrived within the hour** (a permitted shell command that mutated a file and then exited nonzero,
read as never having run, because the harness collapses refusal and execute-then-fail into one
status), which meets the trigger that implementer set for asking the question at all.

**And then the clause proved itself on its own author, unlooked for — which is the evidence this
recommendation was missing.** Folding a later finding, the implementer restructured a branch and
dropped the `entry.kind !== "created"` guard off the original rule. The single-write case — *the
ordinary shape of every real run's two create targets* — began failing. **The must-pass neighbour
caught it on the first table run, inside the fold that created it.** Nobody was looking for it; it
was shipped as a stand-down against a different degradation. Every other argument in this ledger for
the guard table is retrospective, constructed after knowing the answer. This one is not, and it is
the reason the clause is not decoration: **a table of broken worlds catches the regression its own
repair introduces, in the round that introduces it.**

The class total settled at **six** self-inflicted regressions, not seven. A candidate seventh was
proposed by the coordinator and rejected on analysis by the implementer — a regression requires a
repair to have made something worse, and the world in question passed before the repair too. It is
the **half-applied rule** landing on a repair one round old. Recorded because the correction ran
against the coordinator, which is the direction that matters.

**A second upstream fix, and it outranks the one below.** The owner asked why this epic was the
right thing to build. Applying this cycle's own discipline to the objective answers it: a guard
case must name the world it fails in, and **the epic's Proof line could not name one.** *"A run is
reconstructed from FSD state alone"* fails if recording breaks and passes if the recording is
flawless and useless — so thirty-four green runs said nothing about whether to continue. The
blind-check class, in the objective, above the fourteen instances the epic catalogued.

> **A Proof line must name the world in which it fails. If the only such world is "the mechanism
> broke", it is a capability check, not a proof.**

Paired with one re-ask: **at the first issue's goal proof, re-answer the Proof question once.**
That is the earliest point real evidence exists about what the work yields and the last point it
can still steer the remaining issues. The restraint pass cuts scope *inside* an objective; nothing
in the process reopens the objective, and a Proof that cannot fail guarantees nothing ever will.

**Cost of not fixing it, measured on this cycle:** the Outcome named *which files it changed · what
it thought its job was · where it stalled or failed*. Thirteen review rounds went to the first and
weakest. In the graded run, 4 of 33 items were file mutations. Meanwhile the reasoning stream —
already captured since LAB-133 — was never read, and the epic's most valuable artifact, the wrap,
was written by hand from reasoning that the machinery cannot see.

**Proposed upstream fix, put to the owner rather than taken:** promote the guard-table pattern from
one goal's internal practice to the documented standard for goal checks — a table of broken worlds,
each naming the branch it must reach, run before any dispatch, extended whenever a mutation stays
green. Home is `goals/README.md`, not `best-practices.md`, because it is a mechanism to copy rather
than a rule to remember. **Not applied here:** it is a standards change affecting every future goal
author, the epic that would justify it is unmerged, and this cycle's own evidence says prose-level
fixes for this family under-perform — so it should be adopted deliberately or not at all.

## Dropped

- **A BP for "name the symmetric case before writing the test."** Genuinely the operational form of
  `wrong-extent`, and cheap. Dropped for the reason above: cycle 5 already showed this family
  resists prose, and adding the sentence would be the third consecutive cycle answering a
  mechanism problem with wording. **Revisit if the guard-table fix is declined** — then a sentence
  is better than nothing.
- **`inverted-check` as a new feedback class.** One instance (a check that failed red on truth and
  green on the defect). Real, and the worst single defect this epic. One instance is not a class.
  **Watch it.**
- **Escalating the Playwright install stall.** Two occurrences, tripwire armed on a third, did not
  recur. Recorded in the wrap so the next observer knows they are seeing a third.
- **Anything from `stale-restatement`.** Two caught instances, no escape measurement. Nothing to
  conclude.

## Claim to test next cycle

1. **Re-score this cycle after the chain merges.** The escape column is the missing half of every
   count above, and `unrun-claim`'s four summary-level instances are exactly the kind that reach
   `main` because nobody re-derives a number in a merged PR body. **Baseline to beat once
   scoreable: 4 summary-level unrun claims, 0 measurable escapes out of 0 merged PRs.**
2. **`wrong-extent`'s recurrence, scored by round-gap rather than count.** The instances here
   cluster at gap 1 — the sibling direction surfaces in the *very next* review. If the guard-table
   fix lands, the prediction is that the gap widens or the instance is caught by the table rather
   than by a reviewer. **Score which agent caught it, not just whether it happened.**
3. **Whether a reviewer stopped running.** Cycle 5's claim 3 was vindicated by an accident this
   cycle; make it a standing check. Before reporting any class at or near zero, confirm every
   configured reviewer actually reported on the head being scored — and treat a `neutral` check
   conclusion as **absence, never as a pass.**
