# Cycle 12 — W3 file-convention epic wrap (FIX-1351) (2026-09-17)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Second collection on the same epic.** Cycle 10 sampled FIX-1351 mid-flight (#1718, #1711,
#1715, #1735, #1737, #1738, #1747, #1793, #1797). **None of those rows are repeated here.**
This entry covers the twelve artifacts produced after that collection: six spec PRs, six
implementation PRs. The epic PR #1718 is still open and FIX-1351 is still `In Development`
(wrap pending), so its endpoint falls back to **collection time** and it stays a **partial** —
it is not re-scored here.

**Method — rounds.** `Rounds` = **spent waves**: distinct commits drawing at least one
automated pass, followed by a push — **plus a terminal clean pass, which this entry counts and
prior cycles did not.** Definition change, fenced here: a pass that finds nothing still costs a
review cycle, and excluding it makes a converging PR look cheaper than one that stopped while
still red. It affects exactly one row (#1834, `a97cdead8f`). **The figure comparable to cycles
1–11 is 23 implementation rounds, not 24.** Counted from `/pulls/N/reviews` **and**
`/issues/N/comments`,
because **a zero-finding Codex pass posts as an issue comment, not a review** (#1834's
converging round, `a97cdead8f`, 18:06Z). A reviews-only collector cannot see a clean round, so
it systematically reports the last *finding* as the last look. Checked against cycle 9's three
"bots absent from the merge head" PRs (#1790, #1754, #1785): no clean-pass comment exists on any
of them, so **cycle 9's finding stands** — but every future row must read both endpoints.

**Agent replies still post under `jhoffner`** (cycle 10's instrument hole). All `jhoffner`
reviews in this sample are the implementing agents' thread replies and are excluded from waves.

**Method — classes.** Per the file header, `vacuous-assertion` is a **reading label**, not a
class, and must never be summed into a class distribution. Every observation carrying it is
counted under exactly one closed-set class in the column below; the reading label is named in
parentheses beside it. **Fold rule used:** a `vacuous-assertion` observation counts as
`missed-edge-case` unless the row names another class for it — the same fold cycle 7 applied
(`vacuous-assertion` ×3 → `missed-edge-case` ×3). **The reading-label counts are a floor, not a
census:** they were applied where the epic's narrative named the shape, not by re-reading every
thread, so an artifact without one is *not* evidence the shape was absent. The first draft of
this entry summed the label into the class totals; that is corrected here.

**Claims (per direction artifact).** `claims-settled` counts claims that **went to a POC**, with
verdicts — not `settle-claim` invocations. Those are two different numbers and the first draft of
this paragraph conflated them, the same way it conflated a reading label with a class.

- **#1814 (spec FIX-1368): `claims-looped` 1, `claims-settled` 1, verdict REFUTED.** The claim was
  D2 — whether a worker's documents get a fence or only an address — and the settlement is the
  most instructive result in the sample. The spec's own branch POC
  (`spec-poc/FIX-1368-third-root/probe.mts`) priced the fence and found a per-seat install could
  not mint a kind holding a block-declared lazy resource. **It measured an arm nobody proposed:**
  FIX-1323 had already moved isolation from flow *kind* to flow *instance id*, and `hireWorkforce`
  already mints one instance id per seat, so the fence needs no per-seat map. A second POC ran two
  real `.md` fixtures through the production path end to end, with a firing red state, and refuted
  the cost argument. The owner's call reversed from address to fence **after** the approval the
  first POC had helped produce.
- **#1804, #1807, #1810: `claims-looped` 0** — single-round.
- **#1819: `claims-looped` 0, verified** — every finding raised in round 1 and folded in one reply
  pass; no claim re-argued.
- **#1809 and the epic PR #1718: not collected.** A real gap, since the cycle's headline direction
  finding rests on #1809. Distinguishing a zero from an uncollected value is why both are written
  down; collect them next cycle.
- **`claims-settled` 0 for every other artifact**, and **`settle-claim` front-door invocations = 0
  across the whole cycle** — the fourth-cycle figure, kept separate because the skill reads the two
  in opposite directions.

**Two instrument findings fall out of #1814.** First, `Rounds` **cannot see a looped claim**: #1814
is a one-round artifact whose central claim was argued across several exchanges and reversed after
approval, all in issue comments rather than review waves. A round counter reading waves will report
0 loops on an artifact that looped. Second, a POC is **an assertion like any other** — the first one
came back green about a cost that did not exist, because it probed an arm nobody had proposed. The
cycle's own defect class, at settlement altitude.

| PR | Kind | Rounds | Endpoint | Feedback classes | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1804](https://github.com/fixpoint-labs/flow-state-dev/pull/1804) spec FIX-1357 | spec | **1** | approval | missed-edge-case ×3 (D1 design holes) · design-off | no | — a spec-level error (D4, contradicting the epic) that **no reviewer caught**; found in the fold |
| [#1807](https://github.com/fixpoint-labs/flow-state-dev/pull/1807) spec FIX-1367 | spec | **1** | approval | missed-edge-case ×3 · design-off (`params` re-gated, then cut by the owner) | no | — |
| [#1809](https://github.com/fixpoint-labs/flow-state-dev/pull/1809) spec FIX-1355 | spec | **6** | approval | missed-edge-case ×9 (*five vacuous-assertion*: controls red/green for the wrong reason, inside the spec's own POC) · nit | no | **BP-040 did not bind: five rounds moved zero decisions.** Fresh instance for cycle 11's fix A |
| [#1810](https://github.com/fixpoint-labs/flow-state-dev/pull/1810) spec FIX-1389 | spec | **1** | approval | missed-edge-case ×2 · docs-miss | no | — **measured its parity premise instead of asserting it** (issue-spec Step 5 firing) |
| [#1814](https://github.com/fixpoint-labs/flow-state-dev/pull/1814) spec FIX-1368 | spec | **1** | approval | missed-edge-case ×2 · design-off (D2 fence) | no | — |
| [#1819](https://github.com/fixpoint-labs/flow-state-dev/pull/1819) spec FIX-1377 | spec | **2** | approval | missed-edge-case ×2 · nit | no | — |
| [#1824](https://github.com/fixpoint-labs/flow-state-dev/pull/1824) impl FIX-1389 | impl | **3** | merge | missed-edge-case ×3 · docs-miss | no | — |
| [#1826](https://github.com/fixpoint-labs/flow-state-dev/pull/1826) impl FIX-1389 | impl | **3** | merge | missed-edge-case ×2 · nit | no | — |
| [#1832](https://github.com/fixpoint-labs/flow-state-dev/pull/1832) impl FIX-1368 | impl | **1** | merge | missed-edge-case ×1 (*vacuous-assertion*) — a new silent drop introduced *inside* the PR fixing the old silent drop | no | merged past its only automated pass |
| [#1835](https://github.com/fixpoint-labs/flow-state-dev/pull/1835) impl FIX-1355 | impl | **2** | merge | missed-edge-case ×7 (*all seven vacuous-assertion*) (charter unasserted · BR-15 comparing two fields · a timeout returning a count · a retry rerunning the mechanism · two controls red for the wrong reason · first-channel-vs-set) | no | **A control's blast radius is the upper bound on what it can discriminate** |
| [#1833](https://github.com/fixpoint-labs/flow-state-dev/pull/1833) impl FIX-1367 | impl | **8** | merge | missed-edge-case ×9 (*six vacuous-assertion*) · docs-miss ×4 (*overclaim*) | no | **A guard's stated coverage is a claim and was never executed** — see below |
| [#1834](https://github.com/fixpoint-labs/flow-state-dev/pull/1834) impl FIX-1357 | impl | **7** (6 finding + 1 clean) | merge | docs-miss ×5 (one showing generator output the generator abandoned) · missed-edge-case ×5 (incl. an over-refusal `com0`; one *vacuous-assertion*) | no | **A prose copy of generated output is a second authority for one rule** |

**Load: 24 rounds across six implementation PRs (23 on the prior cycles' definition — see
*Method — rounds*), 12 across six direction artifacts** — and the
direction side held BP-040's two-round budget on **five of six**. The whole direction overrun is
one artifact (#1809 at 6), and its own coordinator diagnosed it correctly in the moment: *"four
rounds moved zero decisions… review converged on direction long ago and has been doing the
implementer's job since."* **One** of the two long implementation PRs converged on a round that
found nothing after every prior round found something: **#1834**, whose seventh pass was clean.
**#1833 did not** — its round 8 was another substantive coverage finding (see the escape analysis
below), the fix for it landed in `591c5e4e3`, and the base merge `522da85d4` on top drew no pass
before the merge. An earlier draft claimed both, which this entry's own accounting contradicts.

## The first fully-carried sample in four cycles

**Every commit authored on the six merged implementation branches descends from `bbf7b7eb5`**
(the merge that put cycle 7's grounding on `main`, 09-16 01:41Z) — with one bounded exception,
named below. Derived per commit, not per head: for each branch, `git rev-list <head> --not
bbf7b7eb5` enumerates its commits and `git merge-base --is-ancestor bbf7b7eb5 <c>` is run on
every one. A head-only `merge-base` check, which is what the first draft of this entry ran,
proves the *head* carries the grounding and says nothing about the commits under it — the check
whose stated scope is wider than its real one, in an entry whose subject is that shape.

**The exception, and why it does not weaken the sample.** The per-commit scan returns the **same
13 commits** on all six branches — dated 09-11 to 09-14, all `FIX-1354` / `FIX-1370` work
inherited from the epic branch, already scored in **cycle 10** (#1735 and its neighbours) and not
re-scored here. Every other commit on every branch descends from `bbf7b7eb5`: 35 of 48 on #1824,
44 of 57 on #1826, 52 of 65 on #1832, 77 of 90 on #1833, 91 of 104 on #1834, 52 of 65 on #1835.
So the work this cycle scores was authored with the grounding in the tree, which is the inference
the sample needs.

(The count was also wrong: the first draft said "four" — the epic's four — while the sample is
six. Both FIX-1389 branches were checked after review caught it.) Cycles 8, 9 and 10 could score
nothing; this one can.

- **BP-003's red-state clause — second clean win, and the pattern of its escapes is the finding.**
  It fired repeatedly and visibly: red states produced before the fix on the symlink findings
  (`ff857dd`), on the `com0` over-refusal, on the settle helpers (by temporarily restoring
  `return last`), and on the round-8 control (the refusing control given its missing key
  **hires**). It also caught itself: a worker's first guard draft went red on the pre-fix fixture
  for an unrelated parsing reason and it refused that red — *"had I accepted the first red as
  evidence, I would have shipped a guard that cannot fire, reported it as verified."*
  **Both escapes are outside the clause's subject.** It governs a check you write; it says nothing
  about (i) what a check *covers* or (ii) a *report* that a check was written. Rounds 6, 7 and 8 of
  #1833 are (i), (ii) and (i) again.
- **`issue-spec` Step 5's factual checker — fired.** #1810 measured its parity premise rather than
  asserting it and closed in one round; five of six specs held the budget.
- **`issue-implement` 10.6 (correct the generator first) — did not reach the one case that needed
  it.** #1834's docs snippet was a hand-written copy of generator output that had drifted with
  nobody correcting anything, so no sweep was triggered. 10.6 fires when you correct a claim; this
  claim was never touched.

## The shape worth reading — `vacuous-assertion` on 20 of 62 non-`nit` findings

**Classes (closed set), 62 non-`nit` findings:** `missed-edge-case` 48 · `docs-miss` 11 ·
`design-off` 3. Restricted to the six implementation PRs: 37 — `missed-edge-case` 27,
`docs-miss` 10.

**Reading label, counted separately and never added to the above:** `vacuous-assertion` on **20
of those 62** findings, **15 of the 37** on implementation PRs. It is the larger of the two
reading labels and it concentrates on implementation. It is **not** a class and not "the dominant
class" — under the closed set that is `missed-edge-case`, which is where the fold puts these
findings anyway.

**Prevalence, stated to what the table supports:** it is labelled on **4 of the 7 artifacts that
ran more than one round** (#1809, #1833, #1834, #1835) — not all of them. And because the labels
are a floor rather than a census (see *Method — classes*), 4-of-7 is itself a lower bound: #1819's
own P1 finding was a check that could not fail on what it claimed, which is the shape, and the row
does not carry the label.

(An earlier draft said "~20 of ~45", "the largest class by a wide margin", and "every artifact
that ran more than one round". All three were wrong: the first two summed a reading label into
the class distribution, which the file's header forbids; the third was a universal the table
contradicts. A wrong baseline is worse than none, because the next cycle scores against it.
Caught in review of the PR that lands this entry — a report is a claim.)

Cycle 11 proposed minting it as a class; it is still a reading label until the owner rules.
The epic's own statement of it:

> **A check that is green for the wrong reason — or red for the wrong reason.**

The second half is the one that costs, because a red control *feels* like evidence. An existing
red control adopted as evidence for a new assertion is a false green wearing a red coat.

**The measurement that settles the altitude question.** #1833's text guard was described as firing
*"wherever that sentence lives"*; it carried a hardcoded list of eight files and matched key names
only, so a claim written as a count or an ordinal was invisible to it even inside its own
territory. Rebuilt to **scan the repo and exclude** rather than list, with three detectors, it
found **eleven instances across 3,864 files. Six rounds of review — Codex's, the coordinator's and
the worker's own adjacency sweeps — had found four.** One executed scan with derived coverage beat
six rounds of looking, on the same population.

**And prose did not deter it, again.** `PLAN.md → Guardrails` already carried *"assert each seat's
sibling value is absent, not merely different"* — in the right document, in plain language — and it
failed three times, once in the same edit where the worker applied it to the adjacent line. Fifth
consecutive cycle with that result.

## Findings recorded, not fixed

- **A zero-finding review is invisible to a reviews-only collector** (method note above). Every
  future row reads both endpoints.
- **Four issues read `In Review` after their PRs merged** — all four, found only because a filing
  agent mentioned one in passing. `issue-lifecycle` → *"Linear status is a mirror you own"* names
  this transition with the `stateId` inlined and assigns it to whichever agent detects the merge.
  The rule exists, is precise, and did not bind on 4 of 4. **Mechanism gap, not a wording gap** —
  `epic-wake` already normalises `PR_FEEDBACK` + `merged` → `DONE` and hands the mirror to the
  coordinator; it could emit the disagreement as a pending action instead.
- **The coordinator relayed three claims it had not checked**, each verifiable in one call (a
  guard that did not exist, a PR's `draft` field, a stale tracker read). Its own note: *"the cost
  of checking was never the reason I didn't."*
- **An escalation raised and withdrawn as an over-ask** — a package-boundary entry judged by the
  file's *label* (a "locked contract") rather than its content, where the file's own conventions
  showed that entry was a bare enumeration. Cost: the epic's last PR idle on a question that was
  the coordinator's.
- **A widening multiplied a bad bound.** A device-name rule widened from two labels to six carried
  a `com0`/`lpt0` off-by-one into the whole tree. The refusal had a test; its boundary did not.
- **`settle-claim`'s front door: zero invocations, fourth cycle.** Claims were settled — the D2
  fence POC came back **REFUTED** — through ad-hoc POCs.
- **`philosophy-drift` = 0 is "not looked for", not measured.** Fifth cycle.
- **Follow-ups filed:** FIX-1424 (mutation testing over `goals/`), FIX-1425 (revert the pentest-lab
  workaround), FIX-1428 (one canonical reserved-name list), FIX-1429 (kitchen-sink's demo is
  unwired).

## Upstream fix — landed

**One consolidated sharpening of BP-003**, folding cycle 11's pending fix C (a) and (b) together
with one new neighbour from this cycle — a check whose *stated scope* is wider than its real one.
**No new BP, no tenet change.** Proposed at wrap, approved by the owner, and written the same day
in PR #1857 — `docs/contributing/best-practices.md` plus the `CLAUDE.md` mirror.

That same-day landing is the point rather than a detail. Cycles 9 and 10 each proposed two fixes
and wrote none; cycle 11's fix C is half of what this cycle rediscovered independently. Four
cycles of the instrument's own corrections decayed with nothing pointing at them — the defect this
entry's own headline describes, committed by the thing that measures it. The rule that came out of
it is **land an approved fix the day it is approved**, and this is the first cycle to obey it.

Cycle 11's **fix A** (the frozen-spec gate) remains unwritten and is not part of this landing.

## Claims to test next cycle

1. **Does the consolidated BP-003 edit cut `vacuous-assertion`?** Baseline: the reading label on
   **20 of 62** non-`nit` findings overall, **15 of 37** on implementation PRs, on a
   fully-carried sample. Score it only on branches that carry the edit, and against the
   implementation figure — that is where the shape concentrates. Score it as a *reading label
   rate*, never against a class total. Both baselines are floors: collect the labels by
   re-reading threads next cycle rather than from the narrative, or the trend measures
   collection effort instead of the shape.
2. **Does deriving a check's scope beat stating it?** Baseline: 11 found by one derived scan vs 4
   by six rounds of review, same population.
3. **Does a freeze hold?** Cycle 11's fix A now has a second instance: #1809, five rounds moving
   zero decisions, on a branch carrying BP-040. Five of six specs held the budget without it.
4. **Are the loop's fixes being landed at the gate?** Cycle 12 is the first `yes`: fix C (a) and
   (b) plus this cycle's new neighbour were written the day they were approved, in #1857. Cycle
   11's fix A is still unwritten, so the baseline is now **one of four landed**, not zero of four.
   Score the next cycle on whether same-day landing holds or this was a single exception.
