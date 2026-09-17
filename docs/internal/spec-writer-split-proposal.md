# Splitting the spec-writer sub-agent — the proposal, and what the evidence says

**Date:** 2026-09-17 · **Scope:** `issue-spec`, and whether its write-the-set half should
become its own sub-agent

**Recommendation: don't split it. Close the question rather than deferring it again.**

The session that shipped the four-document format
([#1800](https://github.com/fixpoint-labs/flow-state-dev/pull/1800), 2026-09-16) closed by
proposing that `issue-spec`'s *write the set* half be pulled out of its *research and decide*
half into a separate sub-agent, and recommended holding the call until one or two more specs had
been written in the new format. **Seven have been** — all opened within seven hours of the
format landing, all approved and closed within a day. They say the writing half is not where the cost is.

---

## 1. What the two halves actually are today

`issue-spec` is 13,056 words across 712 lines. Split by step (section counts exclude headings):

| Half | Steps | Words |
|---|---|---|
| Research and decide | 1 (pull), 2 (codebase), 3 (research), 3.5 (necessity gate), 5 (validate) | 4,051 |
| Write and publish | 4 (synthesize and draft), 6 (publish: branch, figures, PR body, Linear mirror) | 2,963 |
| Respond to review | 6.5 | 2,270 |
| Close out | 7 (reframe the issue), 8 (present) | 1,320 |
| Preamble, companion skills, guidelines | — | 2,575 |

The writing half also pulls in the format corpus, which the research half does not need:
`spec-template.md` (6,383 words), `pr-reviewer-guidance.md` (6,625), `asking-for-decisions.md`
(3,020), `spec-figures.md` (2,821), `writing-for-humans.md` (2,008) — about **20,900 words** of
format instruction behind Steps 4 and 6.

So the asymmetry the proposal noticed is real. It is just not the asymmetry that costs us
anything.

---

## 2. What the seven specs show

Every spec authored since the format merged, with its review history read off the branch:

| Issue | PR | Documents | Figures | Rounds to approval | What the rounds were about |
|---|---|---|---|---|---|
| FIX-1357 | [#1804](https://github.com/fixpoint-labs/flow-state-dev/pull/1804) | 4/4 | 2 | 1 | Two decisions folded in — no module loading, two kind maps |
| FIX-1358 | [#1805](https://github.com/fixpoint-labs/flow-state-dev/pull/1805) | 4/4 | 2 | 1 | A premise checked against the shipped readers |
| FIX-1367 | [#1807](https://github.com/fixpoint-labs/flow-state-dev/pull/1807) | 4/4 | 1 | 1 (+ an owner scope cut) | Three gaps in D1 closed; then the owner cut `params` |
| FIX-1355 | [#1809](https://github.com/fixpoint-labs/flow-state-dev/pull/1809) | 4/4 | 2 | 5 | False premise, three false-green probes, a control that cannot terminate, a rule that would fail a correct run |
| FIX-1389 | [#1810](https://github.com/fixpoint-labs/flow-state-dev/pull/1810) | 4/4 | 1 | 1 | Red state relocated; changeset raised to `minor` |
| FIX-1368 | [#1814](https://github.com/fixpoint-labs/flow-state-dev/pull/1814) | 4/4 | 1 | 1 (+ a post-approval reversal) | A false premise about the locked W3 tree; later, a cost argument withdrawn after a POC |
| FIX-1377 | [#1819](https://github.com/fixpoint-labs/flow-state-dev/pull/1819) | 4/4 | 1 | 1 | Precedence promise narrowed, an N+1, missed contracts |

Three things fall out of that table.

**Format compliance is 100%.** Seven for seven produced all four documents, the nav line on all
four files (28/28), and at least one figure. Prose budgets held on five of seven; the two that
ran over (`DECISIONS.md` on FIX-1355 and FIX-1377) ran over by length of argument, not by
misreading the template.

**Convergence held.** Six of seven approved inside the two-round budget. That is the number
[`spec-process-review.md`](spec-process-review.md) was written against, when one spec had run
thirty-five rounds.

**Not one review round was spent on the writing.** Read the commit subjects: *correct a false
premise* · *fix three false-green probes and a wrong claim* · *a control that cannot terminate* ·
*a rule that would have failed a correct run* · *checked against the shipped readers*. The
expensive spec, FIX-1355, spent all five of its rounds on evidence. The one hard correction on
FIX-1368 was a reviewer pointing out that *"there is no org-level worker"* contradicted the
locked W3 tree. And FIX-1368's D2 was reversed the day after approval because a cost argument had
priced an arm nobody proposed — caught by a POC, not by a reader.

Every one of those is a research failure. A writer sub-agent catches none of them.

---

## 3. Why the split doesn't follow

**The handoff is the whole problem.** A `DECISIONS.md` card is *Instead of · Because · Locks in*,
plus *What would change my mind*. Those four rows are research outputs wearing a format —
`Instead of` is Step 3's alternatives, `Because` is Step 3.5's verdict and the tenets it leaned
on, `Locks in` is the path-of-least-resistance test. To write them, a writer agent needs the
research in full. Hand it everything and the context saving is gone; hand it a summary and the
cards get written off a lossy brief. The failure that summary produces is *a confidently phrased
card resting on a premise nobody re-checked* — which is precisely the class of failure that
consumed the rounds above. The split would make our actual defect rate worse, not better.

**The altitude analogy doesn't carry.** `epic-agent` and `project-agent` are already exactly this
shape: bounded sub-agents that author a four-document set while a coordinator owns research and
gates. They work because an epic-spec's decisions are *coordination* calls the coordinator
already holds in a compact status table — a set table, a dependency graph, whose issue owns
what. Nothing is synthesized at the moment of writing. An issue-spec's decisions are synthesized
at exactly that moment. Same artifact shape, different information flow.

**The precedent that looks closest argues the other way.** `docs-writer` / `docs-editor` are
split for *isolation* — the writer is deliberately denied the spec and the diff so implementation
rationale can't leak into published prose. Here the leak we care about runs the opposite
direction: a spec writer that hasn't seen the research can't write an honest *Because*.

**The biggest piece is already split.** Step 6.5 (2,270 words, the largest single section) is not
run inline. `issue-lifecycle`'s AWAITING_SPEC_APPROVAL row dispatches a bounded sub-agent per
review batch, which triages, folds, and exits. `issue-spec` itself is already dispatched as one
bounded sub-agent per spec. The monolith is smaller than reading the skill top to bottom suggests.

---

## 4. The one piece that could still come out, and why it can wait

If anything separates cleanly it is **Step 6 alone** — create the branch, render and check the
figures, write the PR body to the layout, open the PR, mirror to Linear, move the Linear state.
1,358 words of skill, ~13,000 words of format docs behind it, and almost nothing it needs from
the research beyond the four finished documents. That is a genuinely mechanical publisher, and it
is a much smaller change than the proposal on the table.

It is not worth doing yet. Seven for seven got published correctly, so there is no defect to
point at, and a handoff boundary is cheap to add later and awkward to remove. File it; don't
build it.

---

## 5. What would change my mind

Revisit if any of these shows up:

- **A spec ships with a document missing, a budget badly blown, or a figure that contradicts the
  decisions** — a writing defect, which is the thing we have zero of so far.
- **Two or more review rounds in a cycle triage as format** rather than evidence or direction.
  The cycle ledger already classifies feedback; this is a query, not new instrumentation.
- **`issue-spec` starts running out of context mid-spec.** Not observed; the seven specs above
  each drafted in one pass.

Until one of those fires, the leverage is where the rounds actually go. Step 5's *"the spec's
factual base gets a checker before it gets a reviewer"* rule is the right instrument and it is
already written; FIX-1355 and FIX-1358 both reached for a `spec-poc` to run their premises, and
FIX-1357 committed a check. Sharpening that path will buy more than moving the writing.
