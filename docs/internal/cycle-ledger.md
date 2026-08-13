# Cycle ledger

Measurement instrument for the development loop, maintained by the `distill-lessons`
skill. One row per **spec, implementation, or epic** PR, derived from GitHub review data.
Epic PRs are rows in their own right — they carry a rework class their child specs
don't, and a ledger that samples only children reports zero for it.

**The metric that matters:** rounds-to-approval and the share of findings in the
top recurring class, both trending **down** across cycles. Flat or rising means the
upstream fixes landed at the wrong altitude — move them, don't add more.

**Feedback classes:** `design-off` · `missed-edge-case` · `over-engineered` ·
`spec-ambiguity` · `philosophy-drift` · `docs-miss` · `stale-restatement` · `nit`.

`stale-restatement` (added cycle 2) is the document-surface sibling of
`missed-edge-case`: a decision was corrected where it is *owned* and the surfaces
that **restate** it — a table, an index, a diagram, a completion criterion — still
carry the old answer. Kept separate because the fix differs: `missed-edge-case`
wants the case handled, `stale-restatement` wants the restatements converged.

---

## Cycle 1 — delegation substrate (2026-07)

FIX-940, FIX-924, FIX-931, plus the delegation goal check and the `goals/lib`
refactor. Seven PRs, ~70 review findings (`cursor[bot]`, `chatgpt-codex-connector[bot]`,
and `jhoffner`).

| PR | Kind | Rounds | Feedback classes | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|
| [#909](https://github.com/fixpoint-labs/flow-state-dev/pull/909) spec FIX-931 | spec | **12** | missed-edge-case ×5 · design-off ×2 · spec-ambiguity · over-engineered | **yes** — park-and-promote, killed before implementation | Spec names the invariant's convergence point and every writer |
| [#910](https://github.com/fixpoint-labs/flow-state-dev/pull/910) delegation goal check | impl | **12** | missed-edge-case ×14 (grader forgery surface) | no | Same class, verification half: enumerate every *producer* of the graded property |
| [#911](https://github.com/fixpoint-labs/flow-state-dev/pull/911) FIX-940 | impl | 5 | missed-edge-case ×3 · docs-miss ×2 · over-engineered | no | Same, plus reconcile prose with the final diff |
| [#912](https://github.com/fixpoint-labs/flow-state-dev/pull/912) goals/lib | infra | 7 | missed-edge-case ×5 · over-engineered (scope overshoot) | no | Restraint lens applied to infra scope, not just public surface |
| [#913](https://github.com/fixpoint-labs/flow-state-dev/pull/913) goal hardening | impl | 6 | missed-edge-case ×7 (grader forgery surface) | no | Same as #910 |
| [#920](https://github.com/fixpoint-labs/flow-state-dev/pull/920) FIX-924 | impl | 2 | missed-edge-case ×1 · over-engineered (test weight) | no | — |
| [#921](https://github.com/fixpoint-labs/flow-state-dev/pull/921) FIX-931 | impl | 6 | missed-edge-case ×5 · docs-miss ×2 · design-off ×1 | no | Same as #909; plus defaulted options over constants |

### The dominant class

Roughly two thirds of all findings are one class: **an invariant was guarded at one
of its producers, and the reviewer enumerated the rest.**

- *Enforcement half* — "enforce the ceiling on every public creation path" · "route
  every board writer through the capped collection" · "enforce caps through the legacy
  replan helper" · "guard every transition into pending."
- *Verification half* — "reject every graded marker in the solo baseline" · "use an
  independent researcher marker" · "validate markers against framework-injected
  context" · "verify the auditor was enqueued by the researcher, not the coordinator."

Same shape, different noun. A cap is only as strong as its least-guarded writer; a
grader is only as strong as the producers it rules out. The grounding was silent on
it: tenet 5 covered *depth* (push the fix down a layer), and an agent that has fully
internalized depth still ships this bug, because the other writers sit at the **same**
layer.

### Upstream fixes landed this cycle

| # | Fix | Altitude | Targets |
|---|---|---|---|
| A | Tenet 5 gains a convergence clause (`docs/philosophy.md`) | philosophy | the dominant class, both halves |
| B | `issue-spec` Part II names the convergence point and every writer | skill, spec-time | #909's 12 rounds |
| C | `issue-implement` 10.6 reconciles prose against the current diff | skill, PR-feedback | `docs-miss` (#911, #921) |
| D | Tenet 3: where a config surface exists, "a default" means a *defaulted option* | philosophy | #909/#921 hardcoded caps with no escape hatch |

### Dropped

- **"Naming a tradeoff is not weighing it."** One instance. *When tenets collide*
  already says surface-don't-average-don't-pick-silently. Pull back if it recurs.
- **C0/NUL control bytes.** Recurred in a different package, by a different author,
  *after* a written warning comment existed. Not a lesson — a gate. Tracked as FIX-944
  (High). Evidence that documenting a trap does not prevent it.
- **Test-weight overbuild.** Flagged on 5 of 7 PRs by the restraint lens, always as
  optional, never blocking. Tenet 3 and `second-look` already own it; the open question
  is whether restraint is being applied to test surface at all.

### Claim to test next cycle

`missed-edge-case (invariant breadth)` falls as a share of findings, and spec
rounds-to-approval falls from 12. No trend exists yet — this cycle is the baseline.

> **Superseded on the rounds axis.** The `12` here is a raw pass count. Cycle 2's
> spent-round rule (count only rounds actually spent, exclude `nit`, treat a third round as
> the flag) caps a spec PR near three, so any post-rule spec compared against this 12 shows
> a ~75% "improvement" from the definition change alone. **The `missed-edge-case`-share
> half of this claim still stands** — findings were classified, not round-counted. The
> rounds half does not; that trend restarts at the first spec scored under the rule.

---

## Cycle 2 — durable-jobs epic-spec (2026-08)

Not a full-cycle sweep — the durable-jobs epic's implementation PRs mostly haven't run yet — so the **class analysis below is scoped to one artifact**: the epic-spec on [#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993), 18 findings across six automated review rounds in a single session. That is where the session's rework actually was.

The two rows under it ([#1064](https://github.com/fixpoint-labs/flow-state-dev/pull/1064), [#1061](https://github.com/fixpoint-labs/flow-state-dev/pull/1061)) are recorded for cross-cycle continuity — they are the only non-epic PRs this session closed — but they are **not** in the dominant-class denominator. Read the trend off #993's 18.

| PR | Kind | Rounds | Feedback classes | Claims (looped / settled / verdicts) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993) durable-jobs epic-spec | epic | **6 raw** (in flight; pre-rule count — see note) | stale-restatement ×11 · docs-miss ×4 (external-state mirroring) · design-off ×3 | 1 / 0 / — | **yes** — one binding rule directed the superseded design; one fix created a correctness defect | The correction re-derives every surface that restates the decision, not just the section that owns it |
| [#1064](https://github.com/fixpoint-labs/flow-state-dev/pull/1064) FIX-925 | impl | 2 | over-engineered ×1 (owner, load-bearing) · nit ×6 | 0 / 0 / — | **yes** — a declaration was re-declaring what the runtime already held twice | Ask what the runtime already knows before adding a declaration kind |
| [#1061](https://github.com/fixpoint-labs/flow-state-dev/pull/1061) FIX-1008 | spec | 2 | design-off ×1 (premise dissolved upstream) | 0 / 0 / — | **yes** — closed unmerged, issue cancelled | A spec whose motivating premise is owned by another doc re-checks it before round 2 |

**#993's round count is raw and is NOT comparable to later epic rows.** It counts all six
automated review passes. Fix D's spent-round rule — count only rounds actually *spent*, exclude
`nit`, treat a third round as the flag — lands *after* this row, so every epic collected under it
tops out around three. Comparing a post-rule 3 against this raw 6 would manufacture a 50%
"improvement" out of a definition change while review behaviour was identical. Two honest uses of
this row, then: **the findings counts (18 total, 11 in the dominant class) are comparable** — they
were classified, not round-counted — and **the round count is not.** The rounds trend starts at
the next epic scored under the rule; this row is its provenance, not its baseline. Reconstructing
#993 under the spent-round rule was the alternative and is rejected: it would mean re-adjudicating
six rounds of review after the fact, and a baseline invented that way is worse than an honestly
labelled gap.

**On the claims column.** These were reconstructed from the session, not auto-derived — at
the time, the collector sampled only spec and implementation PRs, so the epic PR that produced
this whole baseline was outside it (fixed in `distill-lessons` this cycle). #993's one looped
claim is the detached-board scope question (N66 → N68): asserted, corrected, and re-opened
across rounds. It settled by reading `scopeIdentityId` / `resolveResourceScopeId` directly and
escalating the remaining choice to the user — **not** by a POC, which is why `claims-settled`
is 0 rather than 1. Cycle 1's rows predate the requirement and have no claims data; that is
missing data, not zero.

### The dominant class: 11 of 18 findings

**A decision was corrected in the section that owns it, and the surfaces that restate it were not.** Every one was caught by review, never by the author — including three consecutive commits *whose entire subject was propagating a correction*, and one case where a gate added to a binding rule was missing from the index it governed **one commit later**.

The restating surfaces, enumerated only after the sixth round: prose · binding rules · milestone table · membership · execution sequence · blocked/lifecycle table · proposed-scope table · running index · open-question index · two diagrams · **the objective's completion-criteria table**.

That last one is the reason this matters beyond tidiness. Clause C3 (non-stranding) still gated on an issue that explicitly excludes recovery, so a coordinator could mark the objective satisfied and **wrap the epic with the mechanism unbuilt** — the exact failure the finding two rounds earlier had been filed to prevent.

**Two sub-shapes recur inside the class:**
- **A deferral rendered as a dependency** (3 instances). An accepted deferral and "blocked by X" are identical in a dependency column and mean opposite things: one starts when X lands, the other doesn't start at all.
- **A gate added to a rule but not to the index that governs it** (2 instances).

**Competing explanation, tested and rejected — and classed out of the count.** The doc also mirrors mutable external state (Linear issue status, PR status), which goes stale on its own. That is a different failure: nothing was *corrected*, the world moved, so it does not meet the `stale-restatement` definition and is classed `docs-miss`. Four findings, against eleven of internal restatement drift — 11:4, and the eleven are the class. Keeping the four inside it would have inflated the baseline with cases fix B does not target, which is how a measurement instrument stops measuring. `epic-lifecycle` already tells the coordinator to refresh the index from PR handles each wake; that mechanism exists, and it didn't fire because the edits were hand-made outside a wake.

### Same shape as cycle 1, different surface

Cycle 1's dominant class was *"an invariant guarded at one of its writers; the reviewer enumerated the rest."* Cycle 2's is *"a fact corrected at one of its restatements; the reviewer enumerated the rest."*

Cycle 1's fix was tenet 5's convergence clause — and that clause **already predicts this failure**, ending *"you're patching call sites, and review will keep finding more of them."* It didn't fire because it is phrased in code nouns (invariant, writers, guard, producers) and the surface here was a document. An agent can hold the discipline, write notes about the pattern, and still commit fresh instances of it, because it doesn't recognise a table as a writer.

### Upstream fixes landed this cycle

| # | Fix | Altitude | Targets |
|---|---|---|---|
| A | Tenet 5's convergence clause widened to cover what you *write down*, not only what executes (`docs/philosophy.md`) | philosophy | the dominant class, all 11 |
| B | `epic-agent` re-derives the surfaces that restate a changed decision before committing, and names the two regressing sub-shapes — a standing rule binding **every** action, not one bullet; `epic-lifecycle` keeps a one-line pointer | subagent, edit-time | the same class, structurally, before review sees it |
| C | `distill-lessons` collects **epic** PRs alongside spec and implementation PRs, **and `epic-lifecycle`'s wrap dispatch passes the epic PR** | skill, collector + its caller | makes A and B measurable at all — see below |
| D | **direction artifact** named as the kind covering spec *and* epic PRs, so the review-bar scoring, the `nit` exclusion, the claims fields and the endpoint all reach both; endpoints given as one table (impl→merge, **or close if dropped** · spec→approval · epic→epic close), with a fallback when a kind's own endpoint never fires — **epic wrap at wrap, collection time for periodic/per-PR runs outside an epic** — so artifacts from cancelled work still get rows; anything scored at the fallback, and any in-flight epic, is an explicit partial | skill, scoring | makes epic round counts comparable **from the next epic onward** (#993 predates the rule and is labelled raw), and stops an epic's lifetime activity reading as rework |
| E | the epic-wrap lessons skip is **partial** — ledger rows always append **and always land as a draft rows-only PR**; only the grounding proposal is skippable | skill, wrap | survivor bias: a ledger holding only epics that had findings can't show an improvement — and rows that never leave the wrap worker's worktree are the same bias by another route |

**The fixes for this class took twelve rounds to reach all their own writers, and that is the
cycle's sharpest evidence.**

| Round | The fix as written | The writer it missed |
|---|---|---|
| 1 | reconciliation rule in `epic-lifecycle` | the coordinator only *dispatches*; `epic-agent` performs the edit and never reads the coordinator's skill |
| 2 | moved to `epic-agent`, inside the `Update` bullet | **End-state POC** also changes decisions, and is dispatched separately |
| 3 | hoisted to a standing rule over all actions | the *dual-sync to Linear* was itself guarded at two of three actions — a reconciled branch doc beside a stale mirror |
| 4 | collector widened to sample epic PRs | its **caller** at epic wrap still passed only the children, so the widened contract would never receive one |
| 5 | epic PRs given an endpoint | the *other* rules keyed to "spec PR" — review-bar scoring, the `nit` exclusion, the claims fields, the ledger's own declared row scope — still excluded them; and a clean epic skipped the ledger entirely, biasing every trend |
| 6 | rows always appended for a clean epic | **no landing path existed** for rows without a proposal PR — they'd stay in the wrap worker's worktree; the primary collector line still said "before merge"; and the baseline's own round count was raw, so the new rule would have manufactured an improvement |
| 7 | rows land as a rows-only PR | the coordinator-state schema still allowed `lessons: skipped`, and the skip paragraph still said "no lessons PR" — a coordinator reading either could record a skip and finish wrap with the row unlanded. **And unifying those two surfaces introduced a third token format**, caught in the same edit |
| 8 | round 7 recorded in this table | **the sentence introducing this table still said "four rounds"** while the table below it listed seven and the paragraph below that said seven |
| 9 | endpoint table written for three artifact kinds | it gave implementation PRs only `merge`, though an epic may wrap on issues **dropped** during `PR_FEEDBACK` — a dropped impl PR had no endpoint at all. Separately: the reconciliation rule enumerated surfaces *inside* the epic-spec, while the **PR description** restates decisions too |
| 10 | `close` added as the impl-PR endpoint | patched the *named* case and missed the family: `epic-wake` treats a cancelled Linear state as terminal **without closing that issue's PRs**, so an epic can wrap over open PRs whose endpoint still doesn't exist. Fixed as a universal fallback (score at wrap) rather than a fourth case |
| 11 | "universal" fallback = epic wrap | not universal — this skill also runs **periodic / per-PR outside an epic**, where no wrap event exists, so standalone abandoned artifacts still had none. Separately: **cycle 1's claim still compared spec rounds against a raw pre-rule 12** — the identical defect fixed for #993 five rounds earlier, one section up in the same file |
| 12 | fallback endpoints written into the skill | **this ledger's own record of fix D still said `impl→merge`** — the summary of the fix, stale about the fix, one round after making it. This is where the PR-feedback cap lands, and the loop is stopped here rather than run to a thirteenth round |

Twelve rounds, each the same error the fix is about, each caught by review and not by the author.

**Round 8 is the purest instance this cycle will produce, and it should be read as the finding
rather than as trivia.** The defect was in the sentence that introduces *this table* — the table
whose entire purpose is counting how many times a correction failed to reach its restatements. The
table was extended, the paragraph below it was updated, and the sentence above it kept the old
number. Nothing about the class was unknown at that moment: it is named in this file, defined in
the header, formalised in tenet 5, and the author had written all three within the hour.

Round 9 adds the one detail that makes the class fully general: **the PR description is a
restatement surface too.** Fix B enumerated surfaces inside the epic-spec and stopped at the
document boundary, but the PR's *"Parts worth reviewing closely"* block names specific decisions
and costs, and a reviewer acting on a superseded one there is the same defect reaching further.
Worth noting how this was found: across eight rounds the author kept the PR description current
**by hand, every round**, and never noticed that the rule being written down didn't require it.
Doing a thing reliably is not the same as having encoded it.

Round 4 is the purest *mechanical* case — a contract corrected and its one caller left behind — but
round 8 is the one that constrains the conclusion, because no amount of knowing the rule prevented
it.

Round 5 is the instructive one, because it shows *how* the loop was being run wrong. Rounds 1–4
each patched the one writer the reviewer named, which is precisely the behaviour tenet 5 warns
produces "review will keep finding more of them." Round 5 was fixed differently: grep every place
the taxonomy is written down, then converge them in one pass — which surfaced two restatements
(`epic-lifecycle`'s phase table, and a cross-reference to the old `lessons: skipped:` token) that
no reviewer had flagged. **The enumeration found what the review queue hadn't.** That is the
difference between applying the lesson and describing it.

Round 6 is the correction to that story, and it belongs here at full strength. The round-5 pass
claimed to have enumerated every writer — and still missed the primary collector line that defines
`rounds-to-approval` as "before merge", which is a restatement of exactly the thing being changed.
It also introduced a *new* defect: "always append the rows" with no path for the rows to land, so
a clean epic's row would have died in the wrap worker's worktree — the same survivor bias the fix
existed to remove, reintroduced by the fix. Enumeration beat patching, and it still wasn't
sufficient. Rounds 6 through 12 then repeated the shape seven more times, each inside a *fix for the shape* —
and round 8 inside the very table that counts them.

**Twelve rounds is no longer an anecdote about this change; it is the cycle's primary measurement,
and it does not say what the fixes claim.** Fix A and fix B were chosen on the theory that naming
the class in the grounding gets an agent to converge restatements without being told which ones.
This PR tested that theory on its own author, live, twelve times — and the author needed an external
reviewer on every single one, including after adopting the enumerate-every-writer procedure that
was supposed to be the answer. Round 7's finding was generated *by* round 6's fix; the unified
token in round 7 was itself inconsistent on first write.

Two readings, and the ledger does not get to pick the flattering one:

1. **The fixes work but slowly** — the floor rises, instances get cheaper to find, and a falling
   rate across cycle 3 is the thing to watch. This is the reading the fixes assume.
2. **Written guidance cannot close this class at all**, because the failure is one of *attention
   at edit time*, not of knowing the rule. Every round here happened with the rule already written
   down, and in the last three, written down **by the same agent, minutes earlier**. On that
   reading the real fix is mechanical — a check that enumerates restatement surfaces — which this
   cycle explicitly dropped on cost.

**Round 8 moves the weight to reading 2**, and the ledger should say so plainly rather than wait
for tidier data. Reading 1 requires that better-written guidance eventually gets absorbed. Round 8
is a case where the guidance was maximally present — named in this file, defined in its header,
formalised in tenet 5, all authored by the same agent within the hour — and the miss happened
anyway, on the sentence introducing the evidence table itself. That is not a knowledge gap that
sharper prose closes.

Cycle 3 still decides formally: if `stale-restatement` does not fall as a share of epic-PR
findings, reading 2 is confirmed. But the honest recommendation *now* is to rebuild and cost the
consistency-check this cycle dropped, rather than spend another cycle collecting evidence for a
conclusion twelve rounds already point at. Do not let a third cycle pass on reading 1 by default.

Logged rather than quietly corrected. A guidance fix has writers exactly as code does, and this is
the measured cost of not enumerating them: the class does not spare the fix aimed at it.

**Fix C is why A and B can be scored at all.** The collector sampled only spec and implementation
PRs, so next cycle would have read this baseline's artifact class as **zero** — indistinguishable
from a fix that worked. A trend the collector cannot see is not a trend.

### Dropped

- **"Verify a constraint you relocate to a new axis."** The session's most severe defect — a fix moved a constraint from reachability to scope and created silent cross-session task corruption. **One instance.** Severity is not recurrence; the gate is recurrence. Watch it.
- **"External state mirrored in prose goes stale."** 4 instances, but `epic-lifecycle` already owns the refresh. A mechanism that exists and wasn't used is not a guidance gap.
- **A consistency-check script / collapsing the tables to one canonical source.** The original hypothesis. Rejected on cost: the tables serve genuinely different readers (sequence, membership, blockers, criteria) and deriving them mechanically is a larger build than the class justifies. Revisit if fix B doesn't move the number.

### Claim to test next cycle

Stale-restatement findings fall as a share of epic-PR review, and no epic-spec commit whose subject is "propagate correction X" leaves knock-ons behind. **Measurable only because fixes C, D and E made epic PRs collectable, their rounds comparable, and a clean epic's row land at all** — score it against #993's **11-of-18 findings** baseline, which is the comparable axis. Do **not** score it against #993's round count: that is raw and pre-rule (see the note under the table). Treat a zero as suspect until you have confirmed the epic PR was actually sampled. Cycle 1's claim is **half open, half retired**: the `missed-edge-case`-breadth share is still open (this cycle produced one implementation PR — #1064, 2 rounds, no `missed-edge-case` — too small a sample to move it), while its *spec rounds from 12* half is retired as incomparable for the same reason #993's count is: 12 is a raw pre-rule number and the rule now caps a spec near three. Two baselines have now been invalidated by the same definition change; check for a third before trusting any rounds trend in this file.

---

## Cycle 3 — epic-lifecycle coordination (2026-08, in flight)

Per-PR mode, two rows. Opened early because the owner named the class himself on #1169
("when applying feedback to PRs do not simply accrete but refactor as necessary") — the
rows are the evidence for that call, not a periodic sweep. Rounds are partials; this
cycle is not scored yet.

| PR | Kind | Rounds | Feedback classes | Claims (looped / settled / verdicts) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1169](https://github.com/fixpoint-labs/flow-state-dev/pull/1169) FIX-1073 `epic-em` | impl | 3 (in flight) | over-engineered ×1 (owner, load-bearing) · missed-edge-case ×6 (behavioral, all correct) | 0 / 0 / — | **no** — the design was right at 138 lines and right at 73; only the prose grew | The feedback loop measures the artifact's total each round, not just that every comment was answered |
| [#1166](https://github.com/fixpoint-labs/flow-state-dev/pull/1166) FIX-1072 `orchestration.md` | impl | 1 | over-engineered ×1 (four-cost list + routing table + argumentation) | 0 / 0 / — | no | Same |

### The class: correct feedback, applied additively

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

### Upstream fix landed this cycle

| # | Fix | Altitude | Targets |
|---|---|---|---|
| A | `issue-spec` 6.5.2 (the anti-addenda rule) gains **growth** as a second trigger — cumulative, past ~1.3× the artifact's length when review opened — and becomes canonical for `issue-implement` 10.6, which carries a short pointer and makes the resulting re-draft binding | skill, spec + PR-feedback | both rows |

`issue-spec` **6.5.2 already held this rule**, but fired only on a *direction pivot*; neither of
these PRs pivoted. The first cut of fix A restated the rule in 10.6 instead, which left one rule
in two homes — the same accretion this cycle is about, in the fix aimed at it. Review caught it;
the rule now lives once, with two entry points. **The trigger is cumulative by construction:**
anchored per-round, small batches bloat a file without ever tripping it, which is "measure the
total, not the delta" defeated by its own trigger.

### Dropped

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

### Claim to test next cycle

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

---

## Cycle 4 — durable-jobs epic wrap (FIX-939) (2026-08-11)

Full epic sweep at wrap: five merged implementation PRs under epic
[#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993), whose endpoint arrives here.
**80 automated review passes.** Distinct from cycle 3, still open in per-PR mode on a different
class. Per-instance evidence for every count below lives in
[`epic-wraps/durable-jobs-939.md`](epic-wraps/durable-jobs-939.md).

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

### The dominant class: `missed-edge-case` again, and its two named sub-shapes

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

### `stale-restatement`: third cycle running, and the only class that escapes review

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

### Upstream fixes — proposed, none landed

This wrap produced a proposal, not a change. Nothing was written to `philosophy.md`,
`best-practices.md` or any skill. Recorded so the next cycle can tell a failed fix from one that
never shipped.

| # | Proposed fix | Altitude | Targets | Status |
|---|---|---|---|---|
| A | `issue-implement` 10.6's reconciliation rewritten from *re-read the diff* to **grep the superseded claim's distinctive noun** across headers, comments, `--help`/error strings, READMEs and docs | skill, PR-feedback | `stale-restatement` — all 9, and the 4 escapes in particular | proposed |
| B | Tenets 7 and 5 ¶2 extended together: **a check that cannot fire is not a check** (break it on purpose, confirm the signal changes), and a decision is **computed or stored once and carried**, not re-derived | philosophy | the two named sub-shapes — 12 of the 42 | proposed |

**A is first on tractability, not on size** — one line in a skill, mechanically checkable, aimed
at the only class that escapes review, and generalising cycle 2 round 5's method (grep every place
the thing is written down, converge in one pass, which *"found what the review queue hadn't"*)
from the epic-spec to a code change's surfaces. **B targets more findings and is the bigger bet**:
it is a grounding edit, and cycle 2's evidence is that grounding prose has not moved this kind of
behaviour. If B's sub-shapes do not fall, the conclusion is the altitude, not the wording.

### Dropped

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

### Claim to test next cycle

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
expense.** The §10.6 rewrite was sharpened twice inside its own PR ([#1252](https://github.com/fixpoint-labs/flow-state-dev/pull/1252)).
First when its opening live application under-caught: the agent on
[#1246](https://github.com/fixpoint-labs/flow-state-dev/pull/1246) grepped the distinctive noun and
honestly reported zero remaining hits, and review plus a concept sweep then found three more sites
— the "shutdown never settles" claim occupied **8**, "lease expiry returns the task" **5**. Every
miss was a document whose job is to be shorter than its source (a locked-contract bullet, a README
summary, a state diagram), because compression is where an author reaches for different words or
for none; `packages/orchestration/README.md` stated the false claim as a labelled arrow, which no
string sweep in any vocabulary finds. Second when the correction for that dropped the grep
enumeration it was extending — and **that list was the only thing pointing at `--help` output,
error strings and the changeset, which is where this epic put one of its four escapes**: the
model-migration message that shipped a dead internal URL to users. A rule that loses a restatement
of itself inside the edit correcting restatements is the class; a rule that loses the only route to
the surface where an escape actually happened is the cost. **Neither round was caught by the
author.**

---

## Cycle 5 — declared-surface epic wrap (FIX-1127) (2026-08-12)

Full epic sweep at wrap: three merged implementation PRs plus one follow-up still open, under
epic [#1249](https://github.com/fixpoint-labs/flow-state-dev/pull/1249). **18 automated review
passes** — small next to cycle 4's 80, because three of the four rows are one-file fixes. Read
the classes, not the totals.

**Method:** cycle 4's, unchanged. `Rounds` = automated review passes (`get_reviews`;
`cursor[bot]` + `chatgpt-codex-connector[bot]`); implementation PRs take ordinary scoring, the
epic PR takes the direction-artifact rules. **Classes stay inside the header's closed taxonomy** —
the shape named below is a parenthetical qualifier on `missed-edge-case`, not a new label.

| PR | Kind | Rounds | Feedback classes | Claims (looped / settled / verdicts) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1249](https://github.com/fixpoint-labs/flow-state-dev/pull/1249) FIX-1127 epic-spec | epic | **3 spent** (6 raw) | design-off ×1 (FIX-754 left the set at round 3) · over-engineered ×1 (§2 cut from seven themes to three) · missed-edge-case ×1 (unrun-claim — independence asserted, then falsified) | 2 / 1 / **REFUTED** | **yes** — the set was resized twice and shed a row | Settle a scope count by parse before the gate, not at round 3 |
| [#1262](https://github.com/fixpoint-labs/flow-state-dev/pull/1262) FIX-1052 + FIX-1051 | impl | 3 | over-engineered ×2 (one rationale across JSDoc + changeset + test comment) · docs-miss ×2 (changeset altitude; **protocol tags in the published fragment**) | 0 / 0 / — | no | A guard on the fragment body (FIX-1139) |
| [#1263](https://github.com/fixpoint-labs/flow-state-dev/pull/1263) FIX-1126 + FIX-502 | impl | **6** | missed-edge-case ×3 (unrun-claim — dotted Anthropic IDs · Google-less intent ladder · `create-block` template) · stale-restatement ×1 (utility default in four places) · docs-miss ×1 (no provider package in step 1) | 1 / 1 / **REFUTED** | no | Run the documented config once per single-provider key |
| [#1275](https://github.com/fixpoint-labs/flow-state-dev/pull/1275) FIX-1048 | impl | 2 | missed-edge-case ×1 (`patch` where pre-1.0 breaking is `minor`) · over-engineered ×1 (one rationale in five places) | 0 / 0 / — | no | — `AGENTS.md:32` already states the rule plainly |
| [#1273](https://github.com/fixpoint-labs/flow-state-dev/pull/1273) FIX-1142 | impl | 1 (in flight) | over-engineered ×1 (policy prose in four places) · stale-restatement ×1 (stale success string) | 0 / 0 / — | no | — |

**#1249 is still open on GitHub.** An epic PR closes unmerged at wrap; this one hasn't. Its
endpoint is this wrap, so the row is scored rather than partial, but the close is outstanding.

### The dominant class: `missed-edge-case (unrun-claim)` — 7 instances

**A claim about what the system does was settled by argument, and the argument was locally
sound.** Not a knowledge gap and not carelessness — every instance reads as competent reasoning.

| Claim | How it was settled | Result |
|---|---|---|
| FIX-754: "four sites violate BP-012/BP-014" | read `main` carefully, three times (4 → 2 → 4) | wrong each time; a reviewer then found a 5th |
| the same count, fourth attempt | brace-matched parse of 157 `handler({…})` definitions across 907 files | **8**, first try, 8/8 with no false positives |
| "`preset/small` → `intent/utility` is a drop-in swap" | read the runtime's own migration message | wrong — `intent/*` also throws with no map *and* no `default` |
| "these Anthropic IDs should be dotted" (a sweep normalised them) | read for consistency | wrong — direct strings pass through unnormalised; caught by a reviewer tracing `resolveId` |
| "the ladders cover the providers these pages advertise" | reasoned about the ladder | wrong — a Google-only reader matched nothing; caught by running a 5×3 matrix |
| #1262: "a child's lazy resource loads at the parent's dispatch" | traced by reading; **self-flagged on the PR** as "the claim I'd bet least on" | shipped unverified |
| codex: "the repo already contains unquoted YAML model fields" | asserted, unrun | **false** — zero `model:` keys across 144 `.yml`/`.yaml` files |
| **this entry:** "all four PR bases carried cycle 4's fixes" | `git merge-base --is-ancestor` — **executed**, against the wrong commit | **false for #1262** — the command cannot return "no" for a merged PR (see below) |

Six of the seven were settled by reading or by bare assertion. The seventh was executed, and is
the hardest of the set.

**The asymmetry is the finding.** Every settlement by a parse or an execution *of the claim itself*
was right on the first attempt. Every settlement by reading that was later checked was wrong.
Careful reading did not produce hedged answers, it produced confident wrong ones — FIX-754 was read
carefully three times.

The codex row is why the lesson is **not** "trust the reviewers": a premise nobody ran is a guess
regardless of who asserts it, and the author was right to run it before declining. The last row is
why it is also not "run something": a command aimed a little to the side of the claim buys
confidence without buying evidence.

### Scoring cycle 4's fixes — a partial test, corrected once under review

**This section was wrong on first write and is the entry's own dominant-class instance. The
correction is kept in full rather than smoothed over, because the failure is more instructive than
the result.**

Cycle 4's grounding sharpenings landed in `b0fc019` at **17:47 on 2026-08-12**. The question is
not when they landed on `main` but **which worker trees carried them**, and that has to be asked of
each branch head, not of the merge commit:

| PR | Branch head | Carries `b0fc019`? |
|---|---|---|
| #1262 | `d011d5f` | **NO** — forked at `151fb9a` (2026-08-11), ~19h older than the fixes, and never merged `main` |
| #1263 | `0fd6077` | **YES**, from `b302284` (20:57) onward — its first five commits, including the guard, are **pre-fix** |
| #1275 | `b065970` | YES |
| #1273 | `af26b707` | YES |

So this is **not** the four-PR controlled test the first draft claimed. #1262 is out entirely, and
#1263 splits down the middle at 20:57.

- **Fix A** (`issue-implement` 10.6: grep the superseded claim's distinctive noun, counting
  READMEs, error strings and the changeset as sites). **2 post-fix instances**, not three:
  #1273's stale success string — the author widened the scan scope and renamed the CI step at
  `4fc55e1` (22:31, post-fix) and left `main()` still printing "in docs or examples", caught by
  Cursor — and **#1275's PR description, which still records the changeset as `patch` while the
  merged fragment says `minor`**, which escaped review and is frozen in a merged body.
  **0 edit-time · 1 review · 1 escaped.** #1263's utility-default-in-four-places instance is
  **withdrawn**: it was authored at `660e65e` (19:55), pre-fix.
- **Fix B** (tenet 7: *a check that cannot fire is not a check*). **0 post-fix instances — this
  scoring is withdrawn in full.** #1263's guard, whose exclusion hid 1,624 files, was authored at
  `2429c30` (19:25), ninety minutes *before* the clause reached that branch. It is a fine instance
  of the shape and says nothing about whether the clause works.

**Cycle 4's rule still fires, on a thinner basis than first claimed:** *"If fix A lands and
instances still escape, reading 2 is confirmed twice and the next move is CI, not prose."* Fix A
landed, and one instance escaped into a merged PR body. That is one escape, not a pattern — the
trigger is met as written, and the next cycle should treat the strength of the evidence as one
data point rather than four.

#1275 remains the sharpest data point, and is unaffected by the correction. The discipline was
demonstrably active: the author swept **every other changeset fragment in the repo** for the same
`patch`/`minor` error and reported the sweep — a textbook fix-A convergence pass — and did not
converge the PR description sitting above it. Cycle 2's round 9 had already named the PR
description as a restatement surface. Applying the rule well on the adjacent surface did not carry
it to the next one.

#### The correction itself: a check that could not fire

The first draft asserted "all four PR bases already contained the fixes," from a real command:
`git merge-base --is-ancestor b0fc019 <base.sha>`, where `base.sha` came from the GitHub API. Both
inputs were wrong in the same direction. A merged PR's `base.sha` is the **base branch tip**, not
the branch's fork point, and `--is-ancestor <fix> <merge-commit>` is **trivially YES for every
merged PR**, because a merge commit's first parent is `main`. Reproduced:

```
git merge-base --is-ancestor b0fc019 5b66a28     -> YES   (merge commit for #1262)
git merge-base --is-ancestor b0fc019 5b66a28^2   -> NO    (the branch head — the real answer)
```

**This is the seventh instance of the dominant class and its hardest sub-shape: executed, but the
command answered a neighbouring question.** It is worse than not checking, because a green result
from a real command retires the doubt that would otherwise have prompted a second look — and the
entry then reported it as its most confident finding, explicitly inviting challenge on it.

It also locates a gap in this cycle's own fix. BP-003 as first written says *execute or parse it,
don't read it*; the author did execute. What the clause was missing is that **the thing executed
has to be able to come back "no."** That is tenet 7's *a check that cannot fire is not a check*
reaching verification commands rather than shipped code, and it is why fix A gained a second
sentence rather than being left as it was.

### Upstream fix landed

| # | Fix | Altitude | Targets |
|---|---|---|---|
| A | **BP-003 extended from the deliverable to the claims that scope it** — a scope count, an equivalence, or what a path does at runtime carries the same evidence burden; settle it by executing or parsing, a reviewer's assertion is a guess too, **and the check has to be able to come back "no"** (`best-practices.md` + the `CLAUDE.md` mirror) | BP | the 7 `unrun-claim` instances |

**The second sentence was added under review, after this entry produced instance 7 in its own
scoring section.** The first wording — *execute or parse it, don't read it* — would not have
caught it, because the check was executed. A clause aimed at a class should be tested against the
newest instance of that class before it lands; this one wasn't, and the instance arrived from the
clause's own author within the hour.

**Stated plainly: fix A is not expected to close the class on its own.** The class was named, with
this exact evidence, in the epic-spec itself at the objective gate — *"It was read carefully three
times and undercounted every time; only a mechanical parse got it right"* — four hours before
#1262 opened. It then recurred repeatedly downstream, same session, same loop, and once more in
this entry. Prose naming the class did not prevent the class.

BP-003 was extended because its **gap is real**: it governed deliverables and said nothing about
the claims that scope them, so review had no clause to cite. That is worth one sentence. It is not
worth pretending a sentence changes behaviour that five cycles now say prose does not change.
**The weight is on mechanism**, per cycle 4's fired rule — filed rather than written: FIX-1146
(resolve the documented config per single-provider key), FIX-1147 (post-merge revalidation of an
epic's other open PRs), FIX-1148 (read Linear label writes back).

### Dropped

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

### Claim to test next cycle

1. **`unrun-claim` falls, and specifically: no scope count or equivalence claim reaches a PR
   description without an execution or parse behind it.** Score the *method*, not the outcome — a
   claim that happened to be right after being read is still an unrun claim, and counting it as a
   pass makes the metric unfalsifiable. **Score the neighbouring-question sub-shape separately**;
   it is the one BP-003's first wording missed, and a collector that only asks "was something run"
   will score instance 7 as a pass.
2. **`stale-restatement`'s escape count.** This cycle, scored only on the branches that carried
   fix A: **2 instances, 0 edit-time, 1 review, 1 escaped.** That is the second consecutive cycle
   with a post-fix escape, on one data point rather than a pattern. If it escapes a third time,
   stop editing skills for this class and cost the CI check.
3. **A zero on either is suspect until confirmed the reviewer was looking.** No lens asks about
   `unrun-claim` today, and an unmeasured shape reads as a solved one.

**Two notes for the next collector.**

*Sampling.* Ask which **branch head** carried a fix, never the merge commit and never the API's
`base.sha`. Half this entry's first-draft scoring was invalid because it asked the wrong commit,
and a whole PR (#1262) had to be removed from the set. An epic's PRs do not all carry a mid-epic
grounding change — #1262 forked ~19h before it and never merged `main`, and #1263 split down the
middle at `b302284`. Sub-PR granularity is required, not optional.

*Baseline.* Cycle 4's own fix table says "proposed, none landed" and both fixes **had** landed in
`b0fc019` before this epic began. A ledger that records its fixes as unshipped will score the next
cycle against the wrong baseline. Left as a footnote rather than an edit to cycle 4's record.
