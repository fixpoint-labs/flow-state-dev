# Cycle 11 — honest-task-substrate epic wrap (FIX-980) (2026-09-10)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Numbered 11 although it was collected when the ledger ended at cycle 7.** It was written
as cycle 8; cycles 8, 9 and 10 landed while it sat unmerged, so it is renumbered rather than
reordered — cycle 8's own note sets that precedent. Everything below was computed against
**cycles 1–7**: the samples for cycles 8, 9 and 10 are three different epics and none of their
PRs are in this one. That is why this entry scores cycle 7's fixes rather than cycle 10's, and
why its *Claims to test next cycle* are for **cycle 12** — the next cycle collected after this
lands. Cycle 10's claim 1 pointed at "cycle 11" for the same forward cycle; taking that number
broke the pointer, so it is repaired in place and marked, rather than left to this note.

The epic's whole life, six weeks: **28 PRs** under epic
[#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983), across two tracks — Track 1
(write path / drain report) and Track 2 (human-wait board) — plus **three specs that were
reviewed and never built**, which are rows, not absences. Reviewers:
`chatgpt-codex-connector[bot]`, `cursor[bot]` (three automations), `greptile-apps[bot]`,
`github-code-quality[bot]`, plus the owner's `fsd-architect`, `second-look` and
`FSD Review Moderator` seats.

**Per-instance evidence, the round reconstruction, the reproduced instrument failure and the
per-row enumerations:** [`epic-wraps/honest-task-substrate-980.md`](../epic-wraps/honest-task-substrate-980.md).
This entry carries the counts, the scoring, the proposed fixes and what was dropped.

**Method — three numbers per row, and the fourth definition of a round in this file, declared as
such.**

- **Passes** — automated review submissions from `cursor[bot]` + `chatgpt-codex-connector[bot]`,
  counted from `GET /pulls/N/reviews`. This is **cycles 4 and 5's pass metric, unchanged**, and is
  comparable to them directly. **It is not cycle 7's**, which counts `github-code-quality[bot]` as
  a third reviewer — cycle 7's own Method says so, and says cycles 4–5 did not count it.
- **Rounds** — **spent review rounds**: a maximal group of consecutive passes with no non-merge
  commit between them, followed by at least one non-merge commit. It is the unit BP-040's budget is
  written in — a review, then a response. Every budget comparison in this entry uses this column.
  **It applies cycle 7's *spent review wave* rule over a narrower reviewer set, so it is not the
  same measurement.** Cycle 7 counts waves over three reviewers (`cursor[bot]`,
  `chatgpt-codex-connector[bot]` and `github-code-quality[bot]`); this entry counts them over the
  two-bot `Passes` set above. A third reviewer can open a wave the two-bot set does not see, so
  these rounds run **at or below** cycle 7's on the same PR and a cross-cycle round comparison
  needs the third reviewer added back first. #1513's row shows the size of the effect: 3 passes on
  the two-bot set, 14 once `greptile`, `github-code-quality` and the owner are counted.
- **Folds** — non-merge commits pushed after the first automated pass. This is a **new
  measurement, introduced here, comparable to nothing before it.** It answers a different
  question: how many times an artifact was *rewritten* under review. **Never set a fold count
  against any budget or any earlier cycle's rounds** — `folds ≥ rounds` on every row in this
  entry, because a batch of correction-only commits answering one review costs one round and
  several folds. Cycle 4 warned that two baselines had been invalidated by a definition change and
  to check for a third; cycle 7 was the third. This is a fourth, added deliberately and fenced.

`nit` is excluded from the rework signal. Direction artifacts (spec and epic PRs) take the
spent-round rules. Endpoints: epic PR → epic close (**reached**, so #983 is a complete row, not a
partial); spec PR → its approval; implementation PR → merge or close. **Three rows fall back to
the wrap and are partials:** #992 and #994 (specs never approved, still open) and #1677 (open,
unmerged).

**Author round numbers are not instrumented and are not used as measurements here.** #1461's
author wrote "round 25"; the reconstructed figure is 24 spent rounds, against 29 bot passes and 73
review submissions of all kinds. Four numbers for one PR, none wrong for its own definition.

## The epic PR

| PR | Kind | Passes | Rounds | Folds | Feedback classes | Honesty reading | Claims (looped / settled / verdict) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|---|---|
| [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983) FIX-980 epic-spec | epic | **12** | **7** | **8** | design-off ×5 · **stale-restatement ×7** · over-engineered ×6 · docs-miss ×1 · nit ×2 | — | 1 / 1 / **CONFIRMED** (with two gaps; POC [#1001](https://github.com/fixpoint-labs/flow-state-dev/pull/1001)) | **yes** — Decision 1's Option A survived, but its cost was wrong by 4× and two of its three named methods were the wrong ones | The correction re-derives every surface that restates the decision — cycle 2's finding, unchanged |

## Track 2 — the human-wait board

| PR | Kind | Passes | Rounds | Folds | Feedback classes | Honesty reading | Claims (looped / settled / verdict) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|---|---|
| [#1419](https://github.com/fixpoint-labs/flow-state-dev/pull/1419) FIX-1234 spec | spec | **12** | **8** | **8** | design-off ×4 · missed-edge-case ×3 · docs-miss ×3 · stale-restatement ×2 · nit ×4 | overclaim ×2 | 1 / 1 / **REFUTED** (the detached-recapture premise, settled by reading the code) | no | Budget 2 rounds. Spent 8 — see *the fold loop* |
| [#1422](https://github.com/fixpoint-labs/flow-state-dev/pull/1422) FIX-1234 | impl | **11** | **9** | **13** | missed-edge-case ×7 (**5 convergence**) · docs-miss ×3 · over-engineered ×2 · stale-restatement ×1 · nit ×5 | overclaim ×3 | 2 / 2 (settled by **running** the example, not by POC) | no | Same convergence arithmetic tenet 5 has named since cycle 1 |
| [#1461](https://github.com/fixpoint-labs/flow-state-dev/pull/1461) FIX-1244 spec | spec | **29** | **24** | **30** | **The worst overrun in this epic.** design-off ×5 · over-engineered ×4 · docs-miss ×3 · stale-restatement ×3 · spec-ambiguity ×3 · nit ×43 | overclaim ×6 | 2 / 0 (both settled by **re-measurement**; the author's round-21 refutation of a reviewer was itself wrong) | **yes** — but the owner found it, not the review: *"resumeFromReview and unparkAndDrain. Why do we need both? … Is the wall of text in the spec really necessary?"* | **A hard stop after round 2.** BP-040 was in force and did not bind — see *scoring* |
| [#1571](https://github.com/fixpoint-labs/flow-state-dev/pull/1571) FIX-1244 | impl | **3** | **2** | **2** | missed-edge-case ×2 | — | 0 / 0 | no | — a clean implementation off a 30-fold spec |
| [#1513](https://github.com/fixpoint-labs/flow-state-dev/pull/1513) FIX-1245 | impl | **3** (14 with `greptile`, `github-code-quality` and the owner) | **1** | **3** (see note) | missed-edge-case ×4 — **all convergence, and the dual-read shipped missing three of its four readers** · docs-miss ×2 · stale-restatement ×1 · nit ×2 | overclaim ×1 | 0 / 0 | no | BP-030's dual-read is only as strong as its least-guarded **reader** — the enforcement/verification split of cycle 1's class, on the read side |
| [#1673](https://github.com/fixpoint-labs/flow-state-dev/pull/1673) FIX-1238 spec | spec | **2** | **1** | **2** | **2 findings, both above the bar, both from one reviewer.** docs-miss ×1 · missed-edge-case ×1 | overclaim ×1 · vacuous-assertion ×1 | 1 / 1 / **REFUTED** (the reviewer re-ran the spec's own POC with `unknownOut` and got silence where the spec predicted an error) | **yes** — the guarantee narrowed from "conditional inserts" to "conditional inserts that declare an output", and §3.4 got stronger | **Inside the two-round budget** — one of two spec PRs in the epic that were |
| [#1675](https://github.com/fixpoint-labs/flow-state-dev/pull/1675) FIX-1238 | impl | **2** | **1** | **1** | **The same two shapes again, in the redesign the first pair produced.** docs-miss ×1 · missed-edge-case ×1 | overclaim ×1 · vacuous-assertion ×1 | 0 / 0 | no | Both were caught. See *the four seats that missed them* in the sidecar |
| [#1677](https://github.com/fixpoint-labs/flow-state-dev/pull/1677) FIX-1032 | impl | **1 (in flight)** | **1 (in flight)** | **1 (in flight)** | missed-edge-case ×2 · nit ×1 | — | 0 / 0 | no | — the fix for the lying instrument, still open |

**Note on #1513's folds.** An earlier draft recorded 5, counting from the first
`github-code-quality[bot]` pass while the same row's pass count used only
`cursor[bot]` + `chatgpt-codex-connector[bot]` — a different reviewer set for the numerator and the
denominator of one row. Under the Method's stated set the figure is **3** (the first counted pass
is `cursor[bot]` on 2026-09-04; three non-merge commits follow it). The wider set gives 5. The
substantive fact the row rests on is unchanged either way: the fourth read path was closed on the
last commit, **eight days** after the first.

## Track 1 — write path and drain report

Same schema as Track 2, now that the per-row enumeration lives in the sidecar. The `Claims`
column is **structurally empty** rather than measured zero: no claim on a Track 1 row was argued
twice, so none entered the `settle-claim` path. The epic's one settled claim sits on #983.

| PR | Kind | Passes | Rounds | Folds | Feedback classes | Honesty reading | Claims (looped / settled / verdict) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|---|---|
| [#941](https://github.com/fixpoint-labs/flow-state-dev/pull/941) FIX-951 spec | spec | 7 | **5** | 5 | design-off ×2 · missed-edge-case ×3 · stale-restatement ×2 · over-engineered ×2 · nit ×7 | overclaim ×2 | — | no | Budget 2 rounds, spent 5 |
| [#953](https://github.com/fixpoint-labs/flow-state-dev/pull/953) FIX-951 | impl | 3 | **3** | 3 | missed-edge-case ×2 · docs-miss ×1 | — | — | no | — |
| [#995](https://github.com/fixpoint-labs/flow-state-dev/pull/995) FIX-976 spec | spec | **4** | **2** | **2** | over-engineered ×3 · spec-ambiguity ×2 · stale-restatement ×1 · nit ×4 | — | — | no | **inside budget** |
| [#1004](https://github.com/fixpoint-labs/flow-state-dev/pull/1004) FIX-976 | impl | **1** | **1** | **1** | nit ×5 — **no finding above the bar** | — | — | no | — the cheapest implementation in the epic |
| [#1005](https://github.com/fixpoint-labs/flow-state-dev/pull/1005) FIX-989 spec | spec | 5 | **5** | 5 | design-off ×3 · missed-edge-case ×4 · docs-miss ×2 · nit ×2 | — | — | no | Budget 2 rounds, spent 5 |
| [#1128](https://github.com/fixpoint-labs/flow-state-dev/pull/1128) FIX-989 | impl | 7 | **6** | 8 | missed-edge-case ×6 — **convergence** · docs-miss ×2 | — | — | no | Cycle 1's class |
| [#1010](https://github.com/fixpoint-labs/flow-state-dev/pull/1010) FIX-992 spec | spec | 9 | **8** | 9 | design-off ×6 · missed-edge-case ×8 · over-engineered ×2 · nit ×3 | — | — | **yes** — split into three PRs after review | Budget 2 rounds, spent 8 |
| [#1035](https://github.com/fixpoint-labs/flow-state-dev/pull/1035) FIX-992a | impl | 8 | **6** | 9 | missed-edge-case ×12 — **convergence across every backing** · docs-miss ×2 · nit ×4 | overclaim ×2 | — | no | **The sharpest convergence instance in Track 1: eight findings are the same rule missing from its second adapter.** |
| [#1036](https://github.com/fixpoint-labs/flow-state-dev/pull/1036) FIX-992c | impl | 8 | **6** | 6 | missed-edge-case ×5 · docs-miss ×3 · stale-restatement ×1 · nit ×4 | overclaim ×3 | — | no | Same |
| [#1039](https://github.com/fixpoint-labs/flow-state-dev/pull/1039) FIX-992b | impl | 8 | **3** | 3 | missed-edge-case ×7 · docs-miss ×2 · nit ×4 | vacuous-assertion ×1 | — | no | Same |
| [#1011](https://github.com/fixpoint-labs/flow-state-dev/pull/1011) FIX-948 spec | spec | 6 | **6** | 6 | design-off ×2 · missed-edge-case ×3 · docs-miss ×2 · nit ×6 | — | — | no | Budget 2 rounds, spent 6 |
| [#1031](https://github.com/fixpoint-labs/flow-state-dev/pull/1031) FIX-948 | impl | 2 | **2** | 2 | missed-edge-case ×2 · nit ×3 | — | — | no | — |
| [#1022](https://github.com/fixpoint-labs/flow-state-dev/pull/1022) FIX-995 spec | spec | 5 | **3** | 3 | missed-edge-case ×3 · over-engineered ×2 · nit ×5 | — | — | no | Budget 2 rounds, spent 3 |
| [#1023](https://github.com/fixpoint-labs/flow-state-dev/pull/1023) FIX-995 | impl | 4 | **3** | 3 | missed-edge-case ×4 · docs-miss ×1 · stale-restatement ×1 · nit ×3 | overclaim ×2 | — | no | Cycle 1's class |
| [#1048](https://github.com/fixpoint-labs/flow-state-dev/pull/1048) FIX-1001 spec | spec | 10 | **8** | 8 | design-off ×5 · missed-edge-case ×7 · over-engineered ×2 · nit ×4 | — | — | no | Budget 2 rounds, spent 8 |
| [#1292](https://github.com/fixpoint-labs/flow-state-dev/pull/1292) FIX-1001 | impl | 4 | **2** | 5 | missed-edge-case ×3 · docs-miss ×1 · nit ×2 | — | — | no | — |

## The three specs that were reviewed and never built

| PR | Kind | Passes | Rounds | Folds | Spec lines | Findings | Outcome |
|---|---|---|---|---|---|---|---|
| [#990](https://github.com/fixpoint-labs/flow-state-dev/pull/990) FIX-978 spec | spec | **17** | **16** | **16** | **1,884** | **30 P1 · 12 P2** | Linear **Canceled** 2026-08-25 — every claim already closed by sibling work |
| [#992](https://github.com/fixpoint-labs/flow-state-dev/pull/992) FIX-963 spec | spec | **6 (partial)** | **4 (partial)** | **6 (partial)** | 873 | 7 P1 · 6 P2 | Converged, never approved, **still open**, mildly decayed |
| [#994](https://github.com/fixpoint-labs/flow-state-dev/pull/994) FIX-964 spec | spec | **5 (partial)** | **3 (partial)** | **8 (partial)** | 365 | 6 P1 · 5 P2 | Descoped by the owner 2026-08-24/25. Issue **On Hold**, PR **still open** |

**Total idled: 28 passes, 23 spent rounds, 30 folds, 3,122 spec lines, 43 P1 findings, 0 lines
shipped.** Three instances in one epic is a trend, not an anecdote, and the cost is concentrated —
#990 alone is 1,884 lines and 30 P1s, more review than any *implementation* PR in this epic
received.

## Reconciling the counts — one denominator, derived from the rows

Every aggregate in this entry sums the `Feedback classes` column of the tables above. **198
classified findings**, nits excluded (113 nits).

| Official class | Count | Share of 198 |
|---|---|---|
| `missed-edge-case` | **89** | 45% |
| `design-off` | 32 | 16% |
| `docs-miss` | 30 | 15% |
| `over-engineered` | 23 | 12% |
| `stale-restatement` | 19 | 10% |
| `spec-ambiguity` | 5 | 3% |
| `philosophy-drift` | 0 | — |
| **total** | **198** | 100% |

**The honesty reading, stated separately so it cannot be added in.** 26 of those 198 observations
carry a reading label — `overclaim` 23 and `vacuous-assertion` 3, **13% of the corpus**. They are
not a seventh class and are already inside the table above, assigned like this:

- `overclaim` ×23 → `docs-miss` ×17 (prose, a comment or a doc asserting what the code does not) +
  `stale-restatement` ×6 (a decision corrected where it is owned, a restating surface left
  asserting the old answer).
- `vacuous-assertion` ×3 → `missed-edge-case` ×3, which is where cycle 7 folded the same shape.

**Where the honesty family ranks depends on how wide you draw it, so both readings are given.**
Strictly — a claim that is false, or an assertion that cannot fail — it is **26, the third-largest
family**, behind `missed-edge-case` (89) and `design-off` (32). Read wider, with
`stale-restatement`'s 19 included on the grounds that a superseded claim still standing is also a
claim that is not true, it is **39 and the second-largest** — 26 + (19 − 6), because six of
`overclaim`'s 23 *are* `stale-restatement` observations, as the decomposition above says, and a
union counts them once. The thesis holds on either reading; the entry no longer depends on which.

**Corrections to this entry's own arithmetic, recorded rather than quietly fixed.** Earlier drafts
reported two different denominators for one corpus — "~195 classified findings" in one place and
"~145" in another — and read `overclaim`'s 23 as a share of a closed taxonomy that did not contain
it. Both figures were wrong; the rows total 198. An eight-fold spec row (#994) was also missing
from the overrun count. **The wide honesty reading was 45**, adding all 19 `stale-restatement`
observations to the 26 when six of them are the same observations — the exact double-count this
file's header forbids, committed by the entry that argued for the fence, and caught on review of
the re-cut. **The `Passes` and `Rounds` columns were both declared comparable to cycle 7's and are
not** — cycle 7 counts a third reviewer, `github-code-quality[bot]`, in both. This is the same
error cycle 7 records its own first draft making, in the opposite direction; the Method block now
fences it. **The round/fold gap was called zero on nine of thirteen spec rows and concentrated in
four**; #1673's gap of 1 was missed, so it is eight and five, corrected here and in the sidecar
table it is read from. **#1461's 24 rounds were also called the worst overrun "in this ledger"**,
true of the file this entry was collected against, which ended at cycle 7. Cycle 8 has since landed
carrying #1445 at **35** rounds against the same budget — under a unit this entry's Method block
does not reconcile with its own, so neither row can be ranked against the other without
reconstructing #1445. Both claims are now qualified to this epic; the argument they serve does not
rest on the superlative, only on BP-040 permitting a 24-round spec on a branch that carried it.
Every figure above now traces to a table in this entry, which is the standard the entry sets for
everything else.

## The dominant class: the fold loop feeds itself, and what it feeds on is false claims

**Eleven of thirteen spec PRs exceeded BP-040's two-round budget.** Only #995 (2 rounds) and #1673
(1) held. Spent rounds across the thirteen: 1, 2, 3, 3, 4, 5, 5, 6, 8, 8, 8, 16 and **24**.

**Measured in rounds, because BP-040's budget is written in rounds.** An earlier draft of this
entry set fold counts against that budget, which is the comparison this entry's own Method block
forbids — and folds systematically overcount rounds, since a batch of correction-only commits
answering one review costs one round and several folds. The reconstruction is in the sidecar. It
did not rescue the finding: on rounds the overrun is marginally *larger* (eleven of thirteen over
two rounds, against eleven of thirteen over two folds, and twelve of thirteen over two passes).

The mechanism is visible in the data rather than inferred. On #1461: **29 automated passes across
30 folds, a 1:1 ratio** — every push drew a fresh review, the review found something, and the
finding drew another push. The author diagnosed it correctly at fold 5, quoted the convergence
rule, said *"I'm stopping now"* — and folded twenty-five more times. The quote and the fold-by-fold
narrative are in the sidecar.

**What each fold was spending itself on is why this is one finding and not two.** A direction
document states one decision in many sections. Folding it into the section that owns it leaves the
siblings asserting the old answer; the reviewer finds that on the next push; the fix creates the
next one. **That is not review converging on a document — it is a document and a reviewer taking
turns.** #1461's own worst fold is the exemplar: a §12 rename promise added, then a wholesale
revert left §7–§11 asserting the opposite, *"the same one-site-left-standing class as six earlier
rounds"*, in the author's words.

**So the epic named "Honest task substrate" produced 26 findings of the form *a claim that is not
true*, in its own artifacts, at every altitude** — and that family is the loop's fuel, not a
separate result:

- **Epic altitude (#983):** counts drifting across four surfaces; §1 and §3 contradicting each
  other; *"Stop claiming Decision 1 resolves S3"*; a load-bearing cost figure wrong by ~4×; the
  whole document still describing a `main` that five merges had moved past.
- **Spec altitude (#1673):** the spec's central guarantee was false, and the test it proposed to
  protect that guarantee could not fail.
- **Implementation altitude (#1675):** the *same two shapes*, in the redesign the first pair
  produced — a comment drawing the guard's boundary in the wrong place, and an erosion test whose
  only assertion was "is an array."
- **Across the write path:** *"Don't describe failed content writes as silent"*; two README CAS
  guarantees wider than the code; a comment claiming a value was "decoded from a stored row" when
  durable reads bypass that schema; *"add a real no-op path before asserting notification
  silence."*

**The tell that the loop was not tracking value.** On #1461 the two findings that actually changed
the design came from **outside** it — the owner asking in two sentences why two verbs existed and
whether the wall of text was necessary, a restraint question 20 automated passes had not asked.
And when a genuinely direction-level P1 did land at ~round 22, the implementation that followed it
took **3 passes, 1 round and 2 folds**.

## The sharper shape: a summary is a claim, and checking its inputs is not checking it

Kept as its own finding rather than merged into the fold loop above, because the mechanism is
different. The loop's mechanism is *restatement drift* — a decision fixed in one section, left
standing in its siblings. This one survives even when nothing drifted: the artifact is derived
correctly from inputs that were each verified, and the derivation itself was never checked. The
entry's concession that the fold loop and the honesty count are "one finding and not two" is about
those two; it does not reach this one.

**The anchor is the instance that happened during this wrap**, in the artifact announcing it. The
epic's retirement post on `agent-mailbox#7` published *"The objective's first clause is met."*
Verified against the epic-spec on `0cc231c25` and live Linear: **it is not.** The spec's §1 lists
seven criteria; criterion 2 is FIX-963 verbatim, FIX-963 is Backlog with its spec PR still open,
and that criterion is not adjacent to the objective's first clause — **it is that clause.**
Criterion 3 is partial at best after FIX-964's descope. **Two of seven NOT MET.** The
criterion-by-criterion derivation, and the same post's wrong claim that the surviving issues
*"stand alone now"*, are in the sidecar.

**Why this instance and not the others carries the finding.** Every input to the false sentence was
verified. The author checked each issue's Linear state and never re-derived the sentence about what
those states added up to. So the class is not "update the other artifacts after a fold" — it is:
**a summarizing artifact inherits the verification burden of a claim, and verifying its inputs is
not verifying it.**

**Does BP-003 already cover it? Substantially, yes — and that is the finding.** BP-003 requires
every claimed deliverable to have an evidence path and pass criteria, and the epic-spec *had* seven
of them. `CLAUDE.md` separately forbids writing user-facing prose while holding a spec or a diff,
*"because context leaks even when you know the rules."* Both applied; neither was reached for,
because neither names **prose about completion** as the thing under verification. An application
gap with a nine-word cure, not a new rule.

## The honesty-defect register

One register, so the two totals below cannot disagree again. `In corpus?` means the defect is
inside the PR review record this entry counts; a `no` is excluded from all 198.

| # | Instance | Artifact kind | In corpus? | Found by | Official class |
|---|---|---|---|---|---|
| 1 | Spec's central guarantee false (#1673) | spec body | yes | `chatgpt-codex-connector[bot]` | `docs-miss` |
| 2 | Proposed regression test could not fail (#1673) | spec's proposed test | yes | `chatgpt-codex-connector[bot]` | `missed-edge-case` |
| 3 | Wiring comment's boundary wrong (#1675) | code comment | yes | `chatgpt-codex-connector[bot]` | `docs-miss` |
| 4 | Erosion test asserted only "is an array" (#1675) | test | yes | `chatgpt-codex-connector[bot]` | `missed-edge-case` |
| 5 | Status block describing a two-week-old `main` (#983) | epic-spec status block | yes | a re-derivation pass against live Linear | `stale-restatement` |
| 6 | §12 rename promise left standing against §7–§11 (#1461) | spec body | yes | `chatgpt-codex-connector[bot]` | `stale-restatement` |
| 7 | Uncitable "settled" (#1461) | review reply | yes | the `fsd-architect` seat challenging it | `docs-miss` |
| 8 | *"The objective's first clause is met"* (`agent-mailbox#7`) | wrap post | **no** — outside the PR corpus | an isolated epic-spec sub-agent pass | — |
| 9 | *"The PR description says 'six rounds.' Two more landed after it."* (#1461) | PR description | **no** — not a review finding | **the record does not name a finder** | — |
| 10 | The wiring overclaim left standing in the PR body (#1675) | PR description | **no** — testimony only | the author, self-reported | — |

Row 10 is author self-report and **not verifiable from the review record**: GitHub's body-edit
history is not reachable from this session and no comment on the PR documents the sweep.

**Both totals, derived from the register.**

- **Summary-overclaim instances — the class fix C(b) targets — are rows 5, 7, 8, 9, 10: five
  instances across *four* artifact kinds**, not five. `PR description` appears twice (rows 9 and
  10), which the earlier "five artifact kinds" phrasing double-counted. Four of the five are
  in-corpus or on the record; row 10 is testimony.
- **Independently found, and never by the writer in the act of writing — rows 1–8: six defect
  groups (eight underlying defects; rows 1–2 and 3–4 are pairs), six found by an automated or
  isolated check, zero by the writer.** That is the "six for six" figure. It does not contradict
  the five above: it counts a different set — every honesty defect with a named finder, not only
  the summarizing ones. Rows 9 and 10 are outside it, one for having no named finder and one for
  being found by the author after the fact.

**Six for six by an automated or isolated check** is the strongest argument in this entry for
keeping the fix at the level of *what gets independently re-derived* rather than *what the writer
should remember* — and it is why fix A is a freeze and fix C is a sharpening of an existing burden
rather than a new discipline to hold.

**The confound, stated plainly.** Every PR in this corpus has the same non-bot author, so it
**cannot** separate "this author's habit" from "this process's gap"; there is no second author to
compare against. What the register does establish is narrower and still useful: the shape is not
FIX-1238-specific and not wrap-post-specific. Whether it generalizes across authors is
**unanswered**, and fix C is scoped accordingly — a sharpening of a rule that already exists.

## The instruments that lied

`scripts/typecheck.mjs` runs `tsc` only when `node_modules/.bin/tsc` exists at the repo root.
Otherwise it walks `src/**.ts`, regex-scans import specifiers, and prints
`static typecheck passed (<pkg>): N source file(s) validated` with **exit 0**. Reproduced for this
entry rather than quoted — a one-file package with three unambiguous type errors passes with exit
0; the probe and its output are in the sidecar.

**The trap was live in this repository at the wrap (2026-09-10)** — see the note below — and it has
an inverse face: deps installed but
`core`'s `dist` stale reports ~22 type errors in untouched files, which nearly got a correct fix
rejected. Cost this epic, from the author's record on #1675: **four fabricated measurements**, and
a worker came close to reporting an approved spec's central mechanism as broken. Filed as
**FIX-1032** (High, *Ready to Spec*), fixed at
[#1677](https://github.com/fixpoint-labs/flow-state-dev/pull/1677), **which merged 2026-09-10,
two minutes before this entry's first PR opened.** `scripts/typecheck.mjs` on `main` now exits 1
when `tsc` is absent, so the probe above is a dated observation of the trap, not current guidance.
It is kept because it is the evidence proposal C rests on. A sibling instrument,
`packages/orchestration/test/types.type-test.ts`, states that vitest typecheck covers it; nothing
does (**FIX-1239**, High, Backlog).

**This is one step past what BP-003 currently covers.** Its third bullet warns about *"a green
result from a command aimed at a **neighbour** of the claim."* Here the command was aimed at
exactly the right claim and reported success **without performing the check at all.** Same false
green, different mechanism, and the existing sentence does not reach it.

## Scoring previous cycles' fixes

- **BP-040** (*spec review is a direction check — fold only what changes the approach, converge in
  two rounds*), landed `1c69f65fe` 2026-08-08. **Carried/not-carried split, by ancestry, not
  timestamps:** three spec PRs carry it from their first commit — #1419 (`959ec8e1e`), #1461
  (`d37dc8bcd`), #1673 (`bc07d3a44`); the other ten forked before it (verified: `1c69f65fe` is not
  an ancestor of #1048's head `954a293c6`). **The rule was in force and did not bind on two of the
  three.** Post-BP-040 spent rounds are **8, 24 and 1** against a pre-BP-040 median of **5**. The
  worst spec overrun **in this epic** happened **17 days after** BP-040 landed, on a branch
  carrying it, by an author who quoted the convergence rule at fold 5 and folded 25 more times.
  **n=3 is not a trend**, and one of the three (#1673) held at a single round — so the carriage
  evidence on its own is two overruns and one success. What it does establish is that the rule was
  present, was read, was quoted, and still permitted a 24-round spec. That is the cleanest
  available evidence that this class needs a stop rather than a sentence, and it is weaker than a
  trend.
- **Cycle 7's fixes A and B** (`epic-lifecycle` *Blind by design*, `write-block-tests` *parameterize
  over carriers*) landed 2026-09-08 in `a85a17da9` / `c667f344a`. **Unscoreable against this epic —
  the entire corpus is out of the sample.** Every branch forked before those commits and none
  merged `main` afterwards; verified by ancestry on the branch heads, not by date (`git merge-base
  --is-ancestor a85a17da9 5b99b1550` → exit 1, and the same for `c667f344a`). Per this file's own
  rule that is *not a zero and not a pass*. Recorded so the next cycle does not read this entry's
  silence as a failed fix.
- **Cycle 1, fix A** (tenet 5's convergence clause): in force throughout. `missed-edge-case` is
  **89 of 198** classified findings — 45%, the largest share in the file — and convergence is most
  of it: #1035's eight findings are one rule missing from its second adapter; #1513 shipped a
  dual-read missing three of its four readers. **Eight cycles of sample, still the dominant class.**
  Consistent with cycles 4–7; nothing new to add, and the fourth consecutive conclusion that the
  remaining work here is mechanism, not wording.

## Upstream fixes — proposed, not written

Per this skill's Step 6, nothing below is applied. `docs/philosophy.md`,
`docs/contributing/best-practices.md` and the skills are **untouched** in this change; the entry
records the proposal and the ledger rows land regardless of what the owner does with it.

| # | Proposed fix | Altitude | Targets | How it gets scored |
|---|---|---|---|---|
| A | **A hard stop, not a budget: after spent round 2 the spec branch is frozen.** Remaining findings go into **one** comment as implementer notes, and the approval gate is raised with them attached. No further push to `spec/*` during review. **Implement it as a refusal, not a paragraph** — an `epic-wake` hook or branch protection that declines the push, rather than another `issue-spec` sentence. The diagnosis rules out the prose altitude: BP-040 already says this, was in the tree, was quoted by the author mid-loop, and did not bind, so a rule the coordinator must remember is the one altitude the evidence excludes. | tooling, spec-time — **mechanism** | the fold loop: 11 of 13 spec PRs over two rounds, #1461 at 24 | spent rounds per spec PR next cycle. A freeze either shows up as a hard ceiling of 2 or it was not spent |
| B | **Mint `vacuous-assertion` as an official feedback class** — an assertion that passes for a reason unrelated to what it claims to check. It is already in use as a *reading label* (this cycle and, narratively, cycle 7); promotion makes it countable in the closed set, with the mutual-exclusion rule that it takes precedence over `missed-edge-case` for the same observation. | ledger instrument only | the pre-registered watch, now in its **third** cycle | it becomes countable; if it does not recur, retire it |
| C | **Sharpen BP-003's third bullet — one list, two more neighbours.** It already warns about *"a green result from a command aimed at a **neighbour** of the claim."* Add the two seen this epic: **(a) a command that never ran the check** — a missing toolchain taking a fallback path, a skipped suite, a type assertion in a file nothing typechecks; read what the command reports it *did*, not only its exit code. **(b) the claim's inputs instead of the claim** — a summary is a claim and carries a claim's burden; verifying every input and not re-deriving the sentence about what they add up to is checking a neighbour. | sharpen existing BP | (a) FIX-1032 + FIX-1239, four fabricated measurements · (b) five summary-overclaim instances across four artifact kinds | a false green reaching a report again; a completion summary contradicted by its own pass criteria |

**Why A is a freeze and not a reminder.** The rule already exists, was in the tree, was quoted by
the author mid-loop, and did not bind. Cycles 4, 5, 6 and 7 each concluded that prose naming a
class does not deter the class. A freeze is refusable in a way a budget is not — which is also why
it belongs in tooling.

**What A costs, stated honestly.** On #1461 a real direction-level P1 arrived around round 22;
under a freeze it would have reached the implementer as a note instead. That is what BP-040
prescribes, and the implementation off that spec took 3 passes and 2 folds — but the loss is real
and A should be withdrawn if a frozen spec produces an implementation that has to be re-specced.

**What the evidence for A does and does not carry.** The overrun is measured on BP-040's own unit
and is systematic: 11 of 13. The attribution to *BP-040 having failed* rests on three carrier
branches, two of which overran — enough to rule out "nobody had the rule yet," not enough to be a
trend. A is proposed on the systematic overrun; the carriage split is corroboration, not the case.

## Dropped, and follow-ups recorded

- **A tenet or BP clause for the convergence class.** Fifth cycle of the same answer, and the
  reasoning has not changed: tenets 5 and 7 already name it in the always-loaded layer, tenet 5
  already carries three parallel paragraphs of the arithmetic, and a fourth is the checklist growth
  tenet 3 forbids. Cycle 7's fix B is the standing mechanism attempt and **could not be scored
  here** — it deserves a cycle where the branches carry it before anything is added.
- **A standalone rule about artifact drift after a fold** — *"a fold is not done when the diff is
  right, it is done when every artifact repeating the claim is right."* Dropped **as a rule of its
  own**, and folded into fix C(b) instead. Two reasons. The rework-hygiene framing does not fit the
  register's row 8, where every input *was* verified and only the derived sentence was not — so the
  rule would have been aimed at the wrong step. And the residue is `stale-restatement`, which cycle
  2 minted and tenet 5's third paragraph owns; sharpening that a fifth time is the instrument
  justifying itself. What survives is the narrower, uncovered half: a summary carries a claim's
  verification burden.
- **A new BP for the summary-overclaim class.** Rejected on the coordinator's own test: BP-003
  already requires pass criteria on every claimed deliverable and the epic-spec had seven of them;
  `CLAUDE.md` already forbids writing prose while holding the diff. Two existing rules covered it
  and neither was reached for. That is an application gap, and the cure is a scope clause on the
  rule that exists — not a third rule to not reach for.
- **A fix for the idling cost.** Three specs, 3,122 lines, 43 P1s, nothing shipped — and no cheap
  cure survives contact. FIX-978's defect was real when specced and closed by sibling work weeks
  later; FIX-964 and FIX-963 were owner scope calls, which is the owner's chair working correctly.
  The one mechanically checkable half — *re-verify a converged spec against `main` before it enters
  implementation* — is worth doing, but it belongs to fix A's frozen-spec gate rather than a rule
  of its own. Recorded so a later cycle can see the cost was counted and deliberately not acted on.
- **A rule that reviewers should disagree, or that one reviewer is worth more than another.** Codex
  found four defects four other seats missed on FIX-1238, and produced every P1 on five other PRs.
  Tempting and wrong: weighting a reviewer is a configuration change, not a discipline, and the
  #1673 data cuts the other way — Cursor's approval *endorsed* the defect in writing, which a
  weight would not have caught. The `review` skill already composes parallel lenses.
- **`overclaim` as an official feedback class.** It is the union of `docs-miss`,
  `stale-restatement` and the proposed `vacuous-assertion`, so minting it would double-count.
  Declared in this file's header as a **reading label** instead — named, non-exclusive, and barred
  from class distributions. That is the honest version of what earlier drafts did implicitly by
  using it as a table classifier while refusing to declare it.
- **Follow-up recorded, not built: a `collect-ledger-rows` collector.** The `distill-lessons` skill
  says the ledger is auto-derived from GitHub and Linear; this cycle was largely manual adjudication
  at 28× scale, and the round reconstruction in the sidecar had to be scripted by hand. A thin
  collector that emits passes, spent rounds, folds and finding titles per PR would make the
  mechanical half reproducible and leave adjudication to the coordinator. **Non-blocking and not
  proposed as an upstream fix this cycle** — it is tooling for the instrument, not a fix for a
  rework class. Filed here so the next cycle can pick it up or decline it deliberately.

## Claims to test next cycle

1. **Does a freeze hold?** Fix A's only job. **Spent rounds** per spec PR should show a ceiling of
   2, with the overflow visible as one implementer-notes comment. If rounds stay above 2, the
   freeze was not spent and the next move is a refusal the tooling makes, not a rule the
   coordinator remembers.
2. **Does a small direction artifact get read?** Two specs held the budget this cycle (#995 at 2
   rounds, #1673 at 1). #1673 is the interesting one: it is both the only spec where every
   above-the-bar finding was found *and* the only one where four seats read the same thing and all
   agreed it was fine while two defects sat in it. Both readings are available from n=1. Score it
   by whether rounds-under-2 correlates with findings-per-pass **rising**, which is the good
   direction, or with findings falling, which would mean short specs are simply reviewed less.
3. **Score cycle 7's fixes A and B for real.** Unscoreable here because the whole corpus forked
   before them. Next cycle's branches will carry them; check whether a live worker is duplicated
   again, and whether a carrier-shaped defect reaches `main` on a chain whose tests were written
   after fix B.
4. **Does `vacuous-assertion` recur?** Three instances this cycle, in the epic whose subject was
   honesty. If the class does not appear next cycle, retire the label rather than keeping it.
5. **Does the round/fold gap stay small?** `folds ≥ rounds` everywhere this cycle, with the gap
   zero on eight of thirteen spec PRs and concentrated in five. If the gap widens, folds stop being
   a usable proxy for anything and the fold column should be retired rather than reinterpreted.
