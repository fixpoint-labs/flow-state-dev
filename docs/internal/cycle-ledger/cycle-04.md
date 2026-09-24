# Cycle 4 — durable-jobs epic wrap (FIX-939) (2026-08-11)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

Full epic sweep at wrap: five merged implementation PRs under epic
[#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993), whose endpoint arrives here.
**80 automated review passes.** Distinct from cycle 3, still open in per-PR mode on a different
class. Per-instance evidence for every count below lives in
[`epic-wraps/durable-jobs-939.md`](../epic-wraps/durable-jobs-939.md).

**Method, stated because two earlier baselines in this file died of definition drift.** `Rounds`
= automated review passes (`get_reviews`; `cursor[bot]` + `chatgpt-codex-connector[bot]`),
counted identically for all six rows. Implementation PRs take **ordinary scoring** — the
spent-round rule, the `nit` exclusion and the third-round flag are direction-artifact rules and
are not applied. Not comparable to cycle 1's or cycle 2's round columns; the impl-PR rounds
trend starts here. **Classes stay inside the header's closed taxonomy**; new shapes appear as
parenthetical qualifiers on an existing class, not as new labels.

| PR | Kind | Rounds | Feedback classes | Claims (looped / settled / verdicts) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1159](https://github.com/fixpoint-labs/flow-state-dev/pull/1159) FIX-982 P3a — detached work runs | impl | **23** | missed-edge-case ×4 · stale-restatement ×3 (both `background-work` pages; the read-cost line) · docs-miss ×1 (a comment justifying behaviour with a mechanism that does not exist) · over-engineered ×1 | 0 / 0 / — | **yes** — the `started` milestone moved later three rounds running, then was removed | Ask which layer *owns* the fact before adding a checkpoint: the host can assert nothing about a task row |
| [#1173](https://github.com/fixpoint-labs/flow-state-dev/pull/1173) FIX-1071 — DevTool Workstreams | impl | **27** | missed-edge-case ×14 (incl. 1 seam-inert, 1 split-channel — `error` + `truncation`, **3 rounds on one claim**) · over-engineered ×1 | 1 / 0 / — | no | Collapse a fact split across two values before wiring a second consumer to it |
| [#1177](https://github.com/fixpoint-labs/flow-state-dev/pull/1177) FIX-1077 — router-less detached start | impl | **15** | missed-edge-case ×5 (incl. 2 seam-inert, **both self-reported**; kill-count table in the body) · stale-restatement ×1 (`--model`, ~12 sites over 3 rounds) · design-off ×1 | 1 / 0 / — | **yes** — "two installers competing" was the wrong diagnosis for three rounds; there was one, writing to a fork | Prove the outcome, not the seam — and grep the old answer rather than re-reading the diff |
| [#1180](https://github.com/fixpoint-labs/flow-state-dev/pull/1180) FIX-1068 — shared session resource | impl | **9** | missed-edge-case ×16 (incl. 3 seam-inert, 5 carry-the-decision, **self-reported**) · stale-restatement ×1 (`state-and-scopes.md` on the superseded design) | 0 / 0 / — | no | Compute the answer once and pass it along; a comparison re-deciding what the caller knew is the shape to distrust |
| [#1184](https://github.com/fixpoint-labs/flow-state-dev/pull/1184) FIX-1013 — kitchen-sink demo | impl | **6** | missed-edge-case ×3 · over-engineered ×1 (a second Workstream read per turn on *every* conversation — flagged twice, accepted as debt, FIX-1109) | 0 / 0 / — | no | A reference app teaches whatever it does; an app-level workaround in it is a framework gap deferred |
| [#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993) durable-jobs epic-spec | epic | **6 raw** (endpoint reached — see note) | *(no new findings; last updated 2026-08-09, before any of the five merged)* | 1 / 0 / — | — | *(carried from cycle 2)* |

**#993's endpoint has arrived and its count is still not comparable.** The epic closes at this
wrap, so the row is no longer in flight — but `6` is cycle 2's raw pre-rule number and stays
labelled raw. There is still **no comparable epic-PR rounds baseline**; the next epic scored
under the spent-round rule starts it.

**Claims.** No factual claim looped twice on any row, so no POC settlement fired
(`claims-settled` 0 throughout). Two were argued and settled by reading code instead: #1173's
task↔Workstream attribution bound, and #1177's installer diagnosis — asserted wrongly for three
rounds, then settled by probing a colocated worker-shaped adapter. The second looped on a
*mechanism* claim and was settled by building a probe by hand, which is what `settle-claim`
exists for; worth watching whether its trigger is too narrow rather than too loose.

## The dominant class: `missed-edge-case` again, and its two named sub-shapes

**42 of 52 findings** — the same class that dominated cycle 1, on material (lineage addressing,
claim fencing, shutdown drains) where it is plausibly the expected cost rather than a loop
defect. Every one was caught in review, before merge.

Two sub-shapes inside it are new, account for **12 of the 42**, and are what the proposed
grounding edits target. Neither is promoted to a header class: cycle 2 promoted
`stale-restatement` only after it recurred, and that is the right bar — a class named on first
observation is a row we maintain whether or not it returns.

- **Seam-correct-but-inert** (`seam-inert` in the table; 6) — a check placed correctly at the seam that is vacuous end to
  end. Four are inert *production* code: `retainOwnedKeys` provably returning `{}`,
  `storageScopeOf` with zero call sites, a widened callback signature `tsc` accepted while every
  call site kept passing a hardcoded value, and a coverage token written in one shape and read in
  another. Nothing in the grounding reaches those — BP-035's second-path checklist is their
  *inverse*, asking about paths the change didn't add code for rather than code the change added
  that nothing reaches. The other two are vacuous tests, which tenet 7 asserts against without
  supplying a method. **The epic produced the antidote itself**: #1177's kill-count table (neuter
  each fix, record how many tests go red) and #1159's "every behavioural fix was neutered against
  its own test before being kept" caught most of the six.
- **Carry-the-decision (5), with a state-shaped twin (1)** — one rule implemented in two places
  that then drift; every fix the same move, compute once and pass it along. Tenet 5 ¶2's
  convergence clause is the nearest cover and misses it for the reason cycle 2 found ¶2 missing
  documents: it is phrased about **guards**, and neither site is one.

## `stale-restatement`: third cycle running, and the only class that escapes review

**9 instances — 5 caught in review, 4 that reached `main`.** Second by count, and the entry
selects on it anyway; the axis is stated below because it is not dominance.

**The finding is a date.** Tenet 5 ¶3 — the clause saying a decision restated in ten places is
corrected in none until every restatement moves — landed `3b339008d` on **2026-08-07**. These
PRs merged **2026-08-11**. The class recurred four days after its own fix shipped, in work by
the same loop. Cycle 2 set this test up, named the two readings, and warned against letting a
third cycle pass on reading 1 by default (lines 218–238). This is that third cycle and it
**confirms reading 2**.

Two scope reasons, neither about conviction: fix B binds `epic-agent`, which edits the epic-spec
and never touches an implementation PR's code comments, file headers, `--help` strings or package
READMEs; and cycle 1's fix C (`issue-implement` 10.6) says **re-read against the current diff**,
which structurally cannot find a stale claim in a file the diff never opened —
`packages/bullmq/README.md` was in none of the five diffs. The `--model` exemplar is the class in
one artifact: one claim, three commits, three rounds, ~12 sites, and the third command found by
searching for the string rather than by reading the diff.

**Attribution: 0 caught at edit time · 5 by review · 4 by the wrap sweep.** All four escapes were
closed by the `polish-docs` pass dispatched at this wrap
([#1246](https://github.com/fixpoint-labs/flow-state-dev/pull/1246), open and green), which
verified each against the code and independently lists the same four. Record the attribution, not
just the count: an edit-time catch and a wrap-time sweep are not the same result, and only the
first is evidence the guidance works.

**Why this class and not the dominant one.** `missed-edge-case` is four times larger, and the
ledger is not selecting on size. It is selecting on **escape rate and tractability**: every one
of the 42 `missed-edge-case` findings was caught by review, while 4 of these 9 escaped review
entirely and shipped; this class has a mechanical fix of proven shape, and 42 findings on hard
concurrency work do not; and it is the only class here with a three-cycle recurrence record,
which makes it a loop problem rather than a domain cost. Stated explicitly so a later cycle can
challenge the axis rather than the arithmetic.

## Upstream fixes — proposed, none landed

This wrap produced a proposal, not a change. Nothing was written to `philosophy.md`,
`best-practices.md` or any skill. Recorded so the next cycle can tell a failed fix from one that
never shipped.

| # | Proposed fix | Altitude | Targets | Status |
|---|---|---|---|---|
| A | `issue-implement` 10.6's reconciliation rewritten from *re-read the diff* to **grep the superseded claim's distinctive noun** across headers, comments, `--help`/error strings, READMEs and docs | skill, PR-feedback | `stale-restatement` — all 9, and the 4 escapes in particular | proposed |
| B | Tenets 7 and 5 ¶2 extended together: **a check that cannot fire is not a check** (break it on purpose, confirm the signal changes), and a decision is **computed or stored once and carried**, not re-derived | philosophy | the two named sub-shapes — 12 of the 42 | proposed |

> **Corrected in cycle 5:** both fixes **landed** in `b0fc019` at 17:47 on 2026-08-12, before the
> declared-surface epic wrapped. The heading and the `Status` column above are wrong; they are left
> in place as the record of what this entry claimed. Cycle 5 scores them — partially, since only
> some branch heads carried them — under "Scoring cycle 4's fixes."

**A is first on tractability, not on size** — one line in a skill, mechanically checkable, aimed
at the only class that escapes review, and generalising cycle 2 round 5's method (grep every place
the thing is written down, converge in one pass, which *"found what the review queue hadn't"*)
from the epic-spec to a code change's surfaces. **B targets more findings and is the bigger bet**:
it is a grounding edit, and cycle 2's evidence is that grounding prose has not moved this kind of
behaviour. If B's sub-shapes do not fall, the conclusion is the altitude, not the wording.

## Dropped

- **"Fix the claim, not the file" and "finish the edit" as entries of their own.** Both are tenet
  5 ¶3, near verbatim. Nine instances argue for a mechanism, not a second statement of a rule
  written down four days earlier. Folded into fix A.
- **Split-channel truth as its own class.** One instance in the table. Merged into fix B — one
  answer, one place, whether computed or stored.
- **Zero callers in a framework, as a ledger class.** Two review lenses argued from in-repo usage
  counts and both were wrong to; `sharedToWorkstream` was called overbuilt for having one in-repo
  consumer when it is deliberate framework configuration. **One episode, no trend — not a rework
  class, so no row and no count.** *This is a scoring call, not a rejection:* the tenet 3
  sharpening it produced — "nothing calls it yet" is not the test in a framework; the test is
  whether it is a **duplicate route** — is a live grounding proposal with the product owner. It
  closes a real conflict between tenets 3 and 4 that nothing disambiguates, and that is worth
  closing the first time it is seen. Promotion here and acceptance there are separate gates, and
  the same split applies to the two sub-shapes above: unpromoted in this instrument, still
  proposed as grounding.
- **Two harness caveats**, both observed on this entry's own PR rather than reported. Reverting a
  neuter with `git checkout <file>` discards every uncommitted change in the file — replace the
  exact string instead. And the GitHub MCP PR tools strip `<details>`/`<summary>` while leaving
  `<b>`, on **both** `create_pull_request` and `update_pull_request`, so a body written to
  `pr-reviewer-guidance.md`'s fold arrives unfolded. The draft flip often reported alongside it is
  **avoidable, not inherent**: `update_pull_request` takes an explicit `draft` parameter, and
  passing `draft: true` preserves the state — the flip is what its default does, not what the tool
  must do. Mechanics for `pr-reviewer-guidance.md` and the skills, not rework classes.

## Claim to test next cycle

1. **`stale-restatement`'s escape count falls to zero, and its share of implementation-PR findings
   falls.** Score the escapes first — they are the half fix A targets and the half review cannot
   see. This cycle: 9 instances, 0 edit-time, 5 review, 4 escaped. If fix A lands and instances
   still escape, reading 2 is confirmed twice and the next move is CI, not prose.
2. **The two sub-shapes appear at all.** A zero is suspect until confirmed the reviewer was
   looking: no lens asks about either today, and an unmeasured shape reads as a solved one. Both
   are promoted to header classes only on recurrence.
3. **Cycle 3's fix-A observable stays unscored here**, deliberately: all five PRs merged after
   `#1182` put the growth trigger on `main`, so they are in scope, but scoring needs
   review-open-versus-merge length ratios this sweep did not compute. One data point is recorded
   rather than scored — **this entry itself tripped the trigger** (213 narrative lines, against
   ~60 and ~70 for cycles 1 and 3) and was re-drafted to ~135 before merge, on a reviewer's
   prompt. Cycle 3's claim says counting reviewer-prompted rewrites scores who prompted them, so
   it is logged, not counted. The instrument applying the accretion it diagnoses one cycle earlier
   is worth logging on its own.

**Footnote on fix A's own first outing, logged as data about the fix rather than a joke at its
expense.** The §10.6 rewrite ([#1252](https://github.com/fixpoint-labs/flow-state-dev/pull/1252))
was sharpened three times inside its own PR, and the transferable half is the distinction between
the first two rounds and the third: **an incomplete rule gets extended; a rule that can be
satisfied while the failure it names survives converts a miss into a defensible one.** That is why
the landed text keys on compression rather than on a set of places — see `issue-implement` §10.6.

| Round | Failure mode | The writer it missed |
|---|---|---|
| 1 | Under-caught: a string sweep cannot read a summary | The compressed surfaces on [#1246](https://github.com/fixpoint-labs/flow-state-dev/pull/1246) — a locked-contract bullet, a README condensation, and `packages/orchestration/README.md` stating the false claim as a labelled arrow no string sweep in any vocabulary finds. The "shutdown never settles" claim held **8** sites, "lease expiry returns the task" **5** |
| 2 | The correction shed the enumeration it was extending | `--help` output, error strings and the changeset — the only list pointing at them, and where this epic put one of its four escapes: the model-migration message that shipped a dead internal URL to users |
| 3 | The replacement enumeration **licensed a skip** — the sweep was complete by the rule as written while the failure survived | A topology matrix in `detached-work.md` contradicting the acceptance contract thirty lines below it in the same file, one round after that contract was corrected, and outside the three surfaces the rule named |

This footnote itself merged a round behind its subject. **None of the three was caught by the
author.**
