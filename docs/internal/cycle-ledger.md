# Cycle ledger

Measurement instrument for the development loop, maintained by the `distill-lessons`
skill. One row per **spec, implementation, or epic** PR, derived from GitHub review data.
Epic PRs are rows in their own right — they carry a rework class their child specs
don't, and a ledger that samples only children reports zero for it.

**The metric that matters:** rounds-to-approval and the share of findings in the
top recurring class, both trending **down** across cycles. Flat or rising means the
upstream fixes landed at the wrong altitude — move them, don't add more.

**A cycle may declare a different primary axis**, and several have. When it does, the
axis and its definition are declared in that cycle's own **Method** block, which is
authoritative for that entry — check it before reading any column against another
cycle's. The definition of a *round* has changed four times across this file; every
change is fenced where it happens.

**Feedback classes** — the closed set. Every finding gets exactly one:
`design-off` · `missed-edge-case` · `over-engineered` · `spec-ambiguity` ·
`philosophy-drift` · `docs-miss` · `stale-restatement` · `nit`.

**Reading labels** — non-exclusive, and **never** summed into a class distribution:
`overclaim` (prose, a comment or a test asserting more than the code does) and
`vacuous-assertion` (an assertion that passes for a reason unrelated to what it claims
to check). A reading label names a *shape* that cuts across the closed set; each
observation carrying one is also counted under exactly one official class, so a reading
total and a class total describe the same findings twice and must never be added
together. Introduced cycle 11, which is also where the distinction is argued.
`vacuous-assertion` is proposed for promotion to the closed set (cycle 11, fix B) and is
a reading label until the owner rules on it.

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

---

## Cycle 5 — declared-surface epic wrap (FIX-1127) (2026-08-12)

Full epic sweep at wrap: three merged implementation PRs plus one follow-up still open, under
epic [#1249](https://github.com/fixpoint-labs/flow-state-dev/pull/1249). **18 automated review
passes so far** — small next to cycle 4's 80, because three of the four rows are one-file fixes.
Read the classes, not the totals. Per-instance evidence for every count below — the enumeration,
the branch-head rescoring, and the correction narrative — lives in
[`epic-wraps/declared-surface-1127.md`](epic-wraps/declared-surface-1127.md).

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

### The selected class: `missed-edge-case (unrun-claim)` — 4 of 16 findings, plus 4 outside the sample

**A claim about what the system does was settled by argument, and the argument was locally
sound.** Not a knowledge gap and not carelessness — every instance reads as competent reasoning.
The enumeration is in
[`declared-surface-1127.md`](epic-wraps/declared-surface-1127.md#missed-edge-case-unrun-claim--the-enumeration);
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

### Scoring cycle 4's fixes — a partial test, corrected once under review

Cycle 4's fixes landed in `b0fc019` at **17:47 on 2026-08-12**, mid-epic, so the question is which
**branch heads** carried them — not when they reached `main`. Two of the four did throughout, one
not at all, one from 20:57 onward. Derivation and per-instance commits in
[`declared-surface-1127.md`](epic-wraps/declared-surface-1127.md#scoring-cycle-4s-fixes--which-branch-heads-carried-them).

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

### Upstream fixes — one prose row, three filed mechanisms

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

#### Re-derived after four corrections — what actually still supports row A

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
[`distill-lessons`](../../.agents/skills/distill-lessons/SKILL.md) → "Scoring a previous cycle's
fix", not a footnote here. The ancestry half is there because the first version of that rule said
*timestamp* and was wrong; see instance 8. Cycle 4's fix table has been corrected in place for the
same reason.

---

## Cycle 6 — Conductor epic wrap (LAB-68) (2026-08-18)

LAB-133, LAB-136, LAB-134, LAB-135 under epic LAB-68. Four implementation PRs, three spec PRs
closed unmerged (BP-037), ~45 review findings across `chatgpt-codex-connector[bot]`,
`cursor[bot]`, `greptile-apps[bot]` and the implementing agents themselves. Per-instance
evidence: [conductor-68.md](epic-wraps/conductor-68.md).

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

### Scoring cycle 5's claims

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

### The class selected, and the fix is mechanism rather than prose

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

### Dropped

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

### Claim to test next cycle

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

---

## Cycle 7 — flow-instances epic wrap (FIX-1320) (2026-09-08)

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

### The dominant class is the one tenet 5 has named since cycle 1

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

### Rounds-to-approval did NOT fall — the metric changed, and two caveats finish the reading

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

### Claim 1 was run before this entry merged, and it found an escape

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

### Scoring the previous cycles' fixes

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

### Upstream fixes — two: one uncovered class, and one condition that fired

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

### Dropped

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

### Claims to test next cycle

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

## Cycle 8 — durable-storage-symmetry epic wrap (FIX-1157) (2026-08-28)

**Numbered after cycle 7 although this epic wrapped before it.** The two runs measured different epics independently and landed out of order. Everything below was computed against cycles 1–6: cycle 7's PRs are not in this sample. That is why this entry scores cycle 6's claims rather than cycle 7's, and why the `stale-restatement` count runs through cycle 6 only — cycle 7 recorded that class on three of its PRs but selected a different one.

FIX-1154, FIX-1258, FIX-1260, FIX-1269 under epic FIX-1157, plus the FIX-1158 lodger (#1444,
merged earlier). **Four implementation PRs merged**, two spec PRs closed unmerged (BP-037), one
epic PR closed unmerged at the wrap. ~154 review threads across `chatgpt-codex-connector[bot]`,
`cursor[bot]`, `greptile-apps[bot]`, `github-code-quality[bot]` and the implementing agents.

**All four impl PRs merged, so escapes are scoreable for the first time since cycle 5** — cycle 6's
claim 1 becoming measurable. **This entry did not run the post-merge escape sweep**; the column is
**unmeasured, not zero**. Do not read it as an improvement.

| PR | Kind | Rounds | Endpoint | Feedback classes | Claims l/s/verdicts | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|
| [#1487](https://github.com/fixpoint-labs/flow-state-dev/pull/1487) FIX-1258 | impl | **5** | merge | `missed-edge-case` ×7 · `stale-restatement` ×5 · `docs-miss` ×1 · `nit` ×5 | 1 / 0 / deferred | no | Enumerate every *writer* of the record a new invariant depends on before the first commit — three session-birth sites and a fourth in the test harness were found one at a time across three rounds |
| [#1488](https://github.com/fixpoint-labs/flow-state-dev/pull/1488) FIX-1269 | impl | **4** | merge | `missed-edge-case` ×3 · `stale-restatement` ×3 · `over-engineered` ×5 (all declined with reasons) · `docs-miss` ×1 · `nit` ×3 | 1 / 1 / **CONFIRMED** | no | When a change adds a verb to a surface, derive the set of surfaces that *enumerate* it once, from code |
| [#1486](https://github.com/fixpoint-labs/flow-state-dev/pull/1486) FIX-1260 | impl | **5** | merge | `missed-edge-case` ×5 · `stale-restatement` ×6 · `over-engineered` ×2 (both taken) · `docs-miss` ×3 (owed, unlanded) · `nit` ×1 | 1 / 2 / **CONFIRMED** ×2 | no | Correct the **generator** first — the guard's own docstring, which all three doc copies derived from, was corrected a round *after* them |
| [#1478](https://github.com/fixpoint-labs/flow-state-dev/pull/1478) FIX-1154 | impl | **≈16** | merge | `missed-edge-case` ×24 · `stale-restatement` ×7 instances / 12 copies · `over-engineered` ×5 (4 taken) · `spec-ambiguity` ×1 · `docs-miss` ×1 · `nit` ×1 | 2 / 2 / **CONFIRMED** ×2 | **yes** — "direction right, delivery over-scoped"; 4 files → 20 | BP-035 applied to *sentences*: the 24 edge cases are one shape — a prose guarantee that fails on a second path |
| [#1365](https://github.com/fixpoint-labs/flow-state-dev/pull/1365) FIX-1157 | **epic** | **≈27** post-gate (gate at 4, a marker) | epic close | `over-engineered` ×14 · `stale-restatement` ×8 · `missed-edge-case` ×8 · `spec-ambiguity` ×3 · `design-off` ×2 | 4 / 3 / **CONFIRMED** ×3 | **yes, twice** | §4 is a projection of the Linear graph; it was used as a status board an agent rewrites on every child event. Six reviewer findings, six regressions — this wants mechanism |
| [#1445](https://github.com/fixpoint-labs/flow-state-dev/pull/1445) FIX-1154 | spec | **35** | approval | `missed-edge-case` ×~14 · `stale-restatement` ×6 · `spec-ambiguity` ×3 · `design-off` ×2 · `over-engineered` ×2 | 5 / 5 / **CONFIRMED** ×4, **REFUTED** ×2 | **yes** — owner reversed the subject mid-review | A spec's factual base gets one executable checker at round 1, not round 20 |
| [#1479](https://github.com/fixpoint-labs/flow-state-dev/pull/1479) FIX-1269 | spec | **2** | approval | `missed-edge-case` ×3 · `docs-miss` ×1 · `nit` ×5 | 0 / 2 / **REFUTED** ×2 | no | **nothing — this is the control row** |

**Process load sits on direction artifacts: 30 rounds across four impl PRs, 64 across three
direction artifacts.** The two-round budget held on exactly one of the three — the one that built
its POC *before* review and had a moderator enforcing the altitude bar.

### Scoring cycle 6's claims

1. **Escapes, now scoreable — not scored.** All four impl PRs merged. Recorded as unmeasured; the
   next cycle inherits it.
2. **`wrong-extent` by round-gap — not scored, and deliberately.** Cycle 6's sample was the
   Conductor subsystem and its deliverables *were* checks that grade a run; this cycle is an
   unrelated subsystem. Scoring the class across that boundary would measure the subject, not the loop.
3. **"Whether a reviewer stopped running" — fires, and it is the finding cycle 6 predicted.**
   **Codex is the only reviewer that re-reviews.** Cursor (both personas), Greptile and
   github-code-quality each ran **exactly once per PR, on or near the opening head, and never
   returned** — verified across all seven artifacts. **Consequence: the `over-engineered` /
   restraint class is measured only against each PR's first revision.** #1488 says so in its own
   description — *"Cursor approved this at the smaller scope… That approval predates roughly half
   the diff."* Any reading that restraint improved this cycle is an artifact of when the restraint
   reviewer looked. **Bots were absent from the merge head on 5 of 5 artifacts** (#1487 merged 3
   commits past its last bot pass, #1486 and #1478 by 2, #1488 and #1479 by 1).

### The class selected: `stale-restatement`, fourth cycle running — and why the existing fix does not fire

**37 instances.** Named in cycle 2, selected in cycle 4, called "the only class that escapes review"
in cycle 5. Cycle 4's fix A — *grep the superseded claim's distinctive noun* — landed in `b0fc019`
and, verified by **branch-head ancestry** (not merge commits, not timestamps), was carried by
**#1488, #1486 and #1478**.

**The hypothesis this wrap started with was refuted.** The coordinator predicted most instances were
authored outside `issue-implement`'s reach. They were not: **22 of 37 (59%) were inside the loop
where the rule can fire.** Two sharper cuts came out of the attribution instead:

1. **The rule converged 22 and prevented 0** — and **fired one round late on the generator twice**
   (#1486's guard docstring, the source three corrected copies derived from; #1488's internal twin
   of a published enumeration). Its text points **downstream** at copies: *grep the noun*, *sweep
   every surface that states the claim more briefly*. Nothing in it says *correct the surface the
   copies were derived from first*. #1478 names this failure mode in its own description — an agent
   *"independently reproduced the over-broad framing, having derived it from the docstring, before
   the correction reached it"* — and reproduced it inside itself.
2. **All 15 out-of-reach instances are on direction artifacts. Zero on an impl PR.** Eight on the
   epic PR, seven on spec PRs. **And they are the ones that recurred** — one twice, one class three
   times across the epic, the epic description through four superseded patch-lists. In-loop
   instances converged in a round or two because *something closes a round*. **Nothing closes a
   round on an epic doc or a spec document.**

**Cycle 6's central finding is confirmed first-party, at a new altitude.** Cycle 6: *"writing a rule
down did not deter the author who had just diagnosed the class."* This cycle the **coordinator**
named the class ~13 times in its own working notes and then committed it twice — once fixing the
engine README and leaving its published twin, once authoring a brief whose phrasing put a false
coupling into the very paragraph written to remove a false constraint. Different altitude, same
result. **A seventh sentence is still not the fix; a rule pointing the wrong way is a different
defect, and worth correcting on its own terms.**

### Upstream fixes — landed

| # | Fix | Altitude | Targets | Status |
|---|---|---|---|---|
| A | `issue-implement` 10.6's reconciliation now leads with **correct the surface the claim was derived from, before converging the copies** — the two sweeps follow it | skill, PR-feedback | the 22 in-loop instances, and the 2 that fired a round late in particular | **landed** |
| B | `issue-spec` Step 5 gains **the spec's factual base gets an executable checker before it gets a reviewer** — with a totality assertion and a **run** negative control | skill, spec pre-publish | #1445's 35 rounds; the 7 spec-PR instances | **landed** |

**A is a correction, not an addition.** The rule already existed and pointed only downstream; this
is the "sharpen the existing entry so it actually catches the class" branch, and the evidence is
self-reported by two PRs in this cycle.

**B is the mechanism half, and it is modelled on what measurably worked here.** #1445 eventually
built the checker and it fired immediately; #1479, the only artifact to hold its budget, built its
evidence first and used it to **refute the premise its issue was written on**. Both properties in the
rule are learned from failure: the totality assertion, because a checker verifying only the sites it
knows about cannot report the one nobody listed; and the **run** negative control, because the first
version of that assertion silently absorbed a planted unclassified file — *the exact failure the
assertion existed to prevent, reproduced inside it*.

**Neither fix addresses the direction-artifact round-closing gap** (finding 2 above). B reduces the
rounds; it does not give an epic doc a step at which restatements converge. Recorded as the open
half rather than papered over.

### Dropped

- **A new BP.** The class has two upstream fixes already; a third sentence is what cycle 6 ruled out.
- **A tenet sharpening.** Tenets 1 and 5 already cover coherence and fixing at the owning layer. The
  defect is that a skill rule pointed the wrong way, not that the grounding is silent.
- **`wrong-extent` carry-over** — cross-subsystem, would measure the sample.
- **The 12-round cap.** Recorded below as a finding, not fixed: this cycle would be guessing at why
  it did not fire.

### Findings recorded, not fixed

- **#1478 ran ~16 rounds against a 12-round cap that never fired** — no pause, no reset, no question
  to the owner, verified across all 31 reviews and 6 issue comments. The cap is prose in
  `issue-implement` §10.7. `#1445`'s 35 rounds were never in its scope at all: it governs the
  PR-feedback loop, not spec review.
- **`settle-claim` was used zero times, while 12 claims were settled.** All 12 went through ad-hoc
  `spec-poc/` directories, a PR verification section, or a coordinator running a predicate directly.
  The skill's *outcome* is healthy; its *front door* is unused. Probe proved non-vacuous (the same
  query returned #1493 for `POC in:title`).
- **`philosophy-drift` = 0 is "not looked for", not measured.** No reviewer this cycle ran a
  coherence-against-`philosophy.md` lens.
- **The epic PR sat open for 3 days past `Done`**, against its own written close condition, with a
  CI-red head. The wrap predicate is executable and ran; the PR-close step is prose and did not.

### Claim to test next cycle

1. **Fix A's effect is visible in *where* the correction lands, not in the count.** The prediction is
   that the generator gets corrected in the same round as its copies rather than one round later.
   **Score the round-gap between generator and copies, not the instance count.**
2. **Fix B's effect is on the direction-artifact round count.** Baseline to beat: **#1445 at 35
   rounds against a 2-round budget**, with #1479 at 2 as the control. If a spec with a counted
   factual base still runs past ten rounds on evidence accuracy, B landed at the wrong altitude.
3. **Run the escape sweep this cycle deferred**, and score `stale-restatement` escapes to `main`
   across the four merged PRs before comparing anything to cycle 5.
4. **Re-check reviewer coverage before reading any restraint trend.** Three of four reviewers ran
   once per PR at the opening head. Until that changes, `over-engineered` measures first revisions.

---

## Cycle 9 — default-worker-kind epic wrap (FIX-1359) (2026-09-16)

FIX-1360…FIX-1366 plus the epic PR. Fifteen artifacts, ~46 non-`nit` findings
(`cursor[bot]` ×2 automations, `chatgpt-codex-connector[bot]`, `greptile-apps[bot]`,
`github-code-quality[bot]`, and the owner's Architect pass). `Rounds` = spent waves.

| PR | Kind | Rounds | Endpoint | Feedback classes | Claims l/s | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|
| [#1730](https://github.com/fixpoint-labs/flow-state-dev/pull/1730) epic-spec | epic | **1 to gate** + 5 post-gate correction rounds (no new reviewer pass) | epic close | stale-restatement ×4 · over-engineered ×4 (declined) · spec-ambiguity ×2 · design-off · missed-edge-case · nit | 2 / 1 CONFIRMED | **yes** — the `tools:` fence was ruled on **four times** from this channel | An epic doc's *guarantee sentences* get the same executable check its counted facts get |
| [#1736](https://github.com/fixpoint-labs/flow-state-dev/pull/1736) FIX-1360 | spec | 1 | approval | missed-edge-case ×3 · over-engineered ×4 · stale-restatement · nit | 0 / 0 | no | — |
| [#1750](https://github.com/fixpoint-labs/flow-state-dev/pull/1750) FIX-1361 | spec | **3** | approval | stale-restatement ×3 · missed-edge-case ×2 · design-off · over-engineered · nit ×3 | 1 / 1 **REFUTED** | **yes** — C5 walked into Decision 2's own memory fence | Cross-spec review runs *before* a decision is stamped, not after two specs each stamp half |
| [#1753](https://github.com/fixpoint-labs/flow-state-dev/pull/1753) FIX-1363 | spec | 1 | approval | missed-edge-case ×4 · over-engineered ×3 · design-off · stale-restatement · nit ×3 | 0 / 0 | no | — |
| [#1765](https://github.com/fixpoint-labs/flow-state-dev/pull/1765) FIX-1366 | spec | 2 | approval | missed-edge-case ×5 · over-engineered ×4 · stale-restatement ×2 · nit | 0 / 0 | no | (2nd round = the epic's fence ruling arriving) |
| [#1766](https://github.com/fixpoint-labs/flow-state-dev/pull/1766) FIX-1362 | spec | 1 | approval | spec-ambiguity ×2 · missed-edge-case · stale-restatement · over-engineered · nit | 0 / 0 | no | — |
| [#1768](https://github.com/fixpoint-labs/flow-state-dev/pull/1768) FIX-1364 | spec | 2 | approval | over-engineered ×3 (1 taken: `resources` door dropped) · missed-edge-case ×2 · design-off ×2 · stale-restatement ×2 · nit | 2 / 2 CONFIRMED | **yes** — a ratified seam lost a door after a POC | A composition seam is sized by running what the framework already does, before three doors are ratified |
| [#1789](https://github.com/fixpoint-labs/flow-state-dev/pull/1789) FIX-1365 | spec | 1 | approval | missed-edge-case ×7 · over-engineered ×4 · nit ×4 | 1 / 1 CONFIRMED (with a correction) | no | **The checker itself gets the negative control** |
| [#1739](https://github.com/fixpoint-labs/flow-state-dev/pull/1739) FIX-1360 | impl | 1 | merge | over-engineered ×6 · stale-restatement ×3 · missed-edge-case ×2 | 0 / 0 | no | — |
| [#1751](https://github.com/fixpoint-labs/flow-state-dev/pull/1751) FIX-1361 | impl | 1 | merge | stale-restatement ×2 · over-engineered ×2 · design-off · missed-edge-case · docs-miss · nit ×2 | 0 / 0 | mild | A contract doc doesn't reproduce spec-branch POC output as Evidence (BP-037) |
| [#1754](https://github.com/fixpoint-labs/flow-state-dev/pull/1754) FIX-1363 | impl | **≈6** | merge | missed-edge-case ×4 · design-off ×2 · over-engineered ×2 · stale-restatement ×2 · docs-miss · nit ×3 | 1 / 1 **REFUTED** ×2 | **yes** — the `tools:` fork; the fold then broke skill `allowed-tools`; the factory renamed **three times** | Decide a guarantee's *enforcement point* at contract time; a public factory's name locks with the contract |
| [#1776](https://github.com/fixpoint-labs/flow-state-dev/pull/1776) FIX-1362 | impl | 2 | merge | missed-edge-case ×5 · over-engineered ×4 · design-off · docs-miss (retracted) · nit ×3 | 1 / 1 **REFUTED** | no | Enumerate every path that *materializes* a tool, not just the one that resolves seats |
| [#1785](https://github.com/fixpoint-labs/flow-state-dev/pull/1785) FIX-1366 | impl | 1 (+self-correction) | merge | **docs-miss ×4 (all overclaim)** · missed-edge-case ×2 · over-engineered ×2 · stale-restatement · nit | 0 / 0 | no | Prose stating a guarantee names the mechanism that enforces it, in the same sentence |
| [#1782](https://github.com/fixpoint-labs/flow-state-dev/pull/1782) FIX-1364 | impl | 2 | merge | docs-miss ×3 · design-off ×2 (fence) · missed-edge-case ×2 · stale-restatement ×2 · nit ×5 | 1 / 1 CONFIRMED | no | The clearest Fix-A-shaped miss in the set — see below |
| [#1790](https://github.com/fixpoint-labs/flow-state-dev/pull/1790) FIX-1365 | impl | **3** | merge | missed-edge-case ×9 · nit ×3 | 0 / 0 | no | — |

**Load inverted from cycle 8.** 15 rounds across 7 implementation PRs, 11 across 8 direction
artifacts — against cycle 8's 30 / 64. The direction side held its two-round budget on 6 of 8;
only #1750 hit a third, and #1730's post-gate activity was cross-spec fallout, not review looping.

### The dominant class — overclaim, ~30% of non-`nit` findings

**A sentence asserting a guarantee, with no named enforcement point.** The `tools:` fence alone
produced **14 distinct findings across 6 PRs**, every one in the same direction: prose claiming a
tighter guarantee than the code gives. Twelve reviewer-raised, two self-found. They collapse to
**four real defects** — seat `tools:` inert · delegation-agent bypass · capability-tools union onto
`tools: []` · skills-library-contributed tools and a promised build-time check that doesn't exist —
corrected across **6 commits naming the fence in their subject line**, plus more that fix it without
the word. The guarantee was ruled on from the epic channel **four separate times**, the last
explicitly because "the fourth one cannot be defended where the previous three were" (core FIX-1393).

The class is not about the fence. **Every one of the five findings in #1790's second review round
was the same shape at a different altitude**: a check claiming something `goal.md` already required
and not enforcing it. And #1789's own checker — the artifact cycle 8's Fix B exists to produce —
shipped a header claiming "no goal has ever run a model through a hired seat" while inspecting
`Model:` frontmatter only. **The mechanism meant to stop overclaim produced an overclaim.**

### Scoring cycle 8's fixes — the sample problem dominates both

Cycle 8's fixes landed in `5296afd3f` (09-08) but reached `main` only at `bbf7b7eb5`, **09-16
01:41Z**. Ancestry tested per branch head, never merge commits, never timestamps:

- **Carried (2):** #1789 `1de00338d`, #1790 `da28e66d7`.
- **Not carried (13):** every other artifact forked before that merge and never took `main` after.
  **Out of the sample, not zeroes.**

**Fix A — unscoreable.** Neither carried branch has a generator/copy structure. But the class it
targets **recurred cleanly out of sample**: #1782 recorded the gap in its Known-gaps list and option
docstring first and repaired the invariant sentence itself — contract C1's "the fence holds
regardless of what the skills library contributes" — a round later (`d30d3f9b7`). Generator
corrected after the copies, exactly the failure mode. No evidence for or against; the class is alive.

**Fix B — baseline beaten, but do not credit the fix.** #1789 closed at 1 round against #1445's 35.
The six spec PRs that did **not** carry B ran 1, 3, 1, 2, 1, 2 — the same budget — and two built and
ran POCs anyway. **The tight spec budget is epic-wide and predates the rule reaching any branch.**
Crediting B would be the definition-drift error cycles 4 and 7 warn about.

### Upstream fixes — proposed (pending review gate)

See the two candidates put to the owner at wrap: a **sharpening of BP-003** to cover guarantee
sentences, and **one checklist line** making `get_reviews` a required read in the PR-feedback loop.
Neither is written until approved.

### Findings recorded, not fixed

- **A PR's opening reviews can be lost to a subscription race.** *(Corrected after first writing —
  see below.)* Reviews posted between PR **creation** and **subscription activation** are never
  delivered. On #1790 that window ran 02:25:18 → ~02:28:21 and swallowed both `cursor[bot]` reviews
  (02:27:11, 02:27:15); everything from 02:29:35 on arrived normally. An entire review round exists
  only because they were found ~1h45m later, by calling `get_reviews` directly.

  **This was first written as "body-only reviews never reach a session", which is wrong** — a
  body-only cursor review on #1796 delivered normally 25 minutes after subscription. The
  discriminator is *time relative to subscription*, not review shape. The error is the cycle's own
  dominant class committed in the instrument that measures it: a mechanism asserted from a
  correlation nobody had tried to break.

  What remains true and is separately worth knowing: `cursor[bot]`'s restraint automation puts its
  entire finding set in the **review body with zero inline comments** on **5 of 7** implementation
  PRs (#1754, #1776, #1782, #1785, #1790), and on #1776 that body carried a substantive restraint
  finding with a POC PR attached. A reader who scans only inline comments misses it — but that is a
  reading habit, not a delivery hole.
- **`settle-claim`'s front door: zero invocations, 8 claims settled.** Cycle 8's finding **re-tests
  as unchanged**. The outcome stays healthy — 6 of 8 settlements were *run* rather than argued and
  **3 came back REFUTED** — but every one went through an ad-hoc `spec-poc/` directory, a committed
  checker, or a coordinator running the predicate directly. Two branches carried text pointing *at*
  the skill and still didn't call it. Not fixed again this cycle: a second attempt without knowing
  why the door is skipped would be guessing.
- **Bots were absent from the merge head on 6 of 7 implementation PRs.** #1754 merged 9 commits past
  its last automated pass, #1785 by 5, #1790 by 3. Codex ran exactly once per PR across all 15
  artifacts. Cycle 5's claim 3 and cycle 8's claim 4 still fire: `over-engineered` measures first
  revisions.
- **`philosophy-drift` = 0 is "not looked for", not measured.** No reviewer ran a
  coherence-against-`philosophy.md` lens this cycle.
- **The 12-round cap never came near firing** — heaviest impl PR was ≈6. Unlike cycle 8, a genuine
  pass rather than a cap failure.
- **One public factory renamed three times on #1754** (`defineAgentKind` → `defineWorkerKind` →
  `createAgentWorkerFlow` → `defineAgentWorkerFlow`), all post-review, none caught by the contract PR
  that locked the kind.
- **Escape sweep to `main` not run** (cycle 8's claim 3, deferred a second time). Scoreable now that
  all 7 impl PRs merged, but needs an adversarial re-read of the unreviewed commit ranges — notably
  #1754's last 9 commits. **Unmeasured, not zero.**

### Claims to test next cycle

1. **Score the two proposed fixes only on branches that carry them.** Cycle 9 could score neither of
   cycle 8's because 13 of 15 branches forked first. Before comparing anything, run the ancestry
   split and state it — a fix scored against work that never saw it reads as a failed fix.
2. **Does naming the enforcement point inline actually cut the overclaim class?** Baseline to beat:
   **14 fence findings / ~30% of non-`nit` findings**. If the share holds after the BP sharpening
   lands, the fix is at the wrong altitude — the class may need a check, not a sentence.
3. **Does a required `get_reviews` read change the round count?** Predicted effect is narrow and
   specific: rounds that exist *only* because a PR's opening reviews were missed should go to zero.
   #1790's third round is the baseline instance. Note the fix survived its own justification being
   corrected — a subscription race is a *better* reason to read reviews directly than a body-only
   blind spot, because it is silent and hits the reviews that open a PR.
4. **Run the escape sweep.** Twice deferred now.

---

## Cycle 10 — W3 file-convention epic, mid-flight (FIX-1351) (2026-09-16)

**Periodic run, not an epic wrap.** FIX-1351 is 5 of 13 done, so every endpoint below
falls back to **collection time** and the epic row is a **partial**. Nine artifacts, plus
the FIX-1370 rescue, which is not W3 work but is this cycle's most expensive incident.

| PR | Kind | Rounds | Endpoint | Feedback classes | Claims l/s | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|
| [#1718](https://github.com/fixpoint-labs/flow-state-dev/pull/1718) epic-spec | epic | **2 (in flight)** | collection | over-engineered ×2 · nit | 0 / 0 | no | — |
| [#1711](https://github.com/fixpoint-labs/flow-state-dev/pull/1711) spec FIX-1352 | spec | 2 | approval | missed-edge-case ×3 · over-engineered ×2 · **docs-miss (deferred `apps/docs` page)** · nit ×2 | 0 / 0 | no | A spec may not defer the docs page for a surface a *user writes* |
| [#1715](https://github.com/fixpoint-labs/flow-state-dev/pull/1715) spec FIX-1354 | spec | 2 | approval | missed-edge-case ×2 · over-engineered ×2 · **docs-miss (same deferral)** · nit | 0 / 0 | no | Same — second instance, same sentence |
| [#1738](https://github.com/fixpoint-labs/flow-state-dev/pull/1738) spec FIX-1311 | spec | 2 | approval | design-off (identity reshape) · missed-edge-case ×2 · stale-restatement · nit ×2 | 0 / 0 | **yes** — one kind = one instance, settled by owner lock | — |
| [#1747](https://github.com/fixpoint-labs/flow-state-dev/pull/1747) impl FIX-1311 | impl | 4 | merge | **missed-edge-case ×3 (High: permanent unbindable channel)** · docs-miss ×2 · over-engineered ×2 · nit | 0 / 0 | no | BP-035's interaction clause — both halves were proved correct *separately in the same run* |
| [#1737](https://github.com/fixpoint-labs/flow-state-dev/pull/1737) impl FIX-1354 | impl | 3 | merge | **docs-miss ×2 (PR body claimed "no `apps/docs` page" — false; and a test count that was unrecoverable, not stale)** · over-engineered ×2 (declined, both correct defects/wrong remedies) · nit | 0 / 0 | no | A PR body's *state claims* carry BP-003's burden |
| [#1793](https://github.com/fixpoint-labs/flow-state-dev/pull/1793) impl FIX-1352 | impl | 3 | merge | **docs-miss ×5** (Codex P1 no docs-site page · 4 editorial, incl. a section contradicting its own page) · **missed-edge-case ×2 (two tests that could not fail)** · over-engineered ×4 (declined → FIX-1389) · nit ×2 | 0 / 0 | no | — (BP-003's red-state clause caught both vacuous tests; see *What fired*) |
| [#1797](https://github.com/fixpoint-labs/flow-state-dev/pull/1797) impl FIX-1370 rescue | impl | 3 | merge | **missed-edge-case (Codex P2: unterminated frontmatter silently drops all agent config)** · over-engineered ×4 (declined → FIX-1406) | 0 / 0 | no | — |
| [#1735](https://github.com/fixpoint-labs/flow-state-dev/pull/1735) impl FIX-1370 (orig) | impl | 4 | merge | — (reviewed and approved; the defect is **where it merged**) | 0 / 0 | no | **Base-branch check at PR open: a PR based on a non-default branch names why** |

### The instrument has a hole this cycle found in itself

**An agent's PR replies are indistinguishable from the owner's in the API.** This session's
replies post under `jhoffner` (the session's token is the owner's). The API reports 5
`jhoffner` reviews on #1793 and 5 on #1797 — **all of them mine**. Cycle 9's row header
counts "the owner's Architect pass" as a reviewer signal, so a collector that trusts the
author field will read agent replies as independent owner review and inflate both the round
count and the apparent human-review coverage. The only reliable discriminator is the
attribution footer in the body. **Any future ledger row must exclude footer-bearing
`jhoffner` comments from reviewer passes**; the rows above already do.

### Scoring cycle 9's fixes — neither was ever written

Checked on `main` rather than assumed:

- **Fix A (BP-003 sharpened to cover guarantee sentences): absent.** BP-003 carries its
  hardened red-state clause (landed earlier, `#1693`) and nothing about a guarantee sentence
  naming its enforcement point.
- **Fix B (`get_reviews` required in the PR-feedback loop): absent.** `issue-lifecycle`'s
  `get_reviews` references are the pre-existing *spec-approval* read. Zero hits repo-wide for
  the subscription-race rationale.

**Third consecutive cycle where the previous cycle's fixes could not be scored** — cycle 8's
were carried by 2 of 15 branches, cycle 9's were proposed-pending-gate, cycle 10's are
unwritten. Separately, the one commit that *did* touch `issue-lifecycle` today (`b6fcf355c`,
18:15Z) is carried by **none** of this cycle's four implementation branches, all of which
forked earlier. **The loop's fixes keep landing after the work that would test them.** That is
a structural property of proposing at wrap and gating afterwards, not an accident of any one
cycle, and it is the finding with the widest blast radius here: an instrument whose
corrections are never scoreable cannot tell a good fix from a dead one.

### The dominant class — overclaim, third cycle, and it has left prose

Cycle 9 named it in prose: *a sentence asserting a guarantee with no named enforcement point*.
Cycle 10's instances are the same shape on surfaces cycle 9 didn't sample:

- **A tracking record claiming a state the repo does not have.** FIX-1370 sat **Done** for four
  days with `agent-prompt-file.ts` absent from `main` — its PR merged into a branch whose own
  PR had already merged, so the code had no route anywhere. FIX-1344 was **Done by
  inheritance** off it. GitHub said merged; Linear said Done; both were locally true and
  jointly false. Cost: one rescue PR, and four days in which anyone extending agent prompt
  files would have built on a feature that wasn't there.
- **A PR body claiming a verification state.** #1737 asserted "no `apps/docs` page, per the
  spec's §11" — false, the page shipped — and a test count that `main` had made
  *unrecoverable* rather than merely stale.
- **A spec deferring a user-facing surface on a rule that has now lost twice.** #1715 §11 and
  #1711 both wrote the docs page off as belonging "with the first consumer". Both were
  overruled — once by a broken relative link, once by a Codex P1 citing AGENTS.md. **A file
  convention a user can write is the first consumer.**

Every instance is a claim with no enforcement point. The class did not resist cycle 9's fix;
**cycle 9's fix was never applied.**

### What fired — BP-003's red-state clause, scored as a win

The one landed fix this cycle can score. On #1793 the implementer removed each of eleven
guards in turn and required a red state. **Two came back green:** a spec covering a
*symlinked* `CHANNEL.md` but not an *unreadable* one (deleting that branch fell through to
"no CHANNEL.md" — a live wrong-answer bug telling an author to write a file already present),
and an `IGNORED_ENTRIES` spec written against a dropping that was a *file*, where the slot
rule already skips files, so it discriminated nothing. Both would have shipped as tests
incapable of failing. **This is BP-003's hardened clause doing exactly what it was sharpened
for**, on a branch that carried it — the first cleanly scoreable fix success in three cycles.

Worth noting the same discipline caught its own near-miss later: the #1797 guard needed *two*
specs, because the obvious check ("first line is `---`") would refuse an empty-but-closed
fence. One red test proves a check catches the bug; the pair proves it catches the bug
**without over-refusing**.

### Findings recorded, not fixed

- **A restraint lens is the wrong instrument for a missing artefact.** Cursor's Code Snob filed
  "no docs-site page" under *not re-litigating* on #1793. It hunts excess, not absence. Its
  silence was briefly read as evidence; it isn't.
- **Isolation earned its keep twice on one PR.** `docs-writer`, given a surface brief and no
  diff, repaired a doc the change had silently invalidated (`workers-on-disk.md`'s
  passed-over-in-silence list, stale the moment a fourth reader existed) — found by running the
  loader test, not by reading the diff. `docs-editor` then caught the new section telling
  readers a file can "open a channel" seventy lines above a section explaining that it cannot.
  Neither was visible to the implementer, three review bots, or the coordinator.
- **A brief can defeat the isolation it pays for.** The first `docs-editor` dispatch described
  an implementation seam; the agent declined the framing and judged from the text, and said so.
  The second carried no implementation facts. Brief the isolated reader on what a reader should
  come away with, never on the shape of the code.
- **Codex: ~23 findings across the cycle, zero rejected.** Every one verified real, including
  two P1s and the P2 above. Cursor's two lenses: both clean or approving on both PRs they ran,
  with every suggestion correctly non-blocking.
- **`settle-claim`'s front door: zero invocations again.** Third cycle. No claim looped twice
  this cycle, so the skill had no trigger — genuinely nothing to fire on, unlike cycles 8 and 9
  where settlements happened by other means.
- **Escape sweep still not run.** Three cycles deferred.

### Claims to test next cycle

1. **Land fixes at the gate, not after it.** The single change most likely to make cycle 12
   scoreable is writing an approved fix *immediately*, before the next epic's branches fork.
   (Renumbered: this named *cycle 11* before the back-dated FIX-980 entry took that number.)
   Baseline: three cycles, zero scoreable corrections.
2. **Does an enforcement-point clause cut overclaim once it actually exists?** Cycle 9's
   baseline stands unchallenged at ~30% of non-`nit` findings; cycle 10's share is ~35%
   (8 of 23 non-`nit`). Neither number has ever been measured against the fix.
3. **Does a `main`-existence check before Done stop the false-Done class?** Baseline: two
   false Dones this cycle (FIX-1370, FIX-1344), four days undetected, one rescue PR.
4. **Exclude footer-bearing `jhoffner` comments from reviewer passes** in every future row, and
   re-read cycle 9's counts with that filter before comparing them to anything.

---

## Cycle 11 — honest-task-substrate epic wrap (FIX-980) (2026-09-10)

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
per-row enumerations:** [`epic-wraps/honest-task-substrate-980.md`](epic-wraps/honest-task-substrate-980.md).
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

### The epic PR

| PR | Kind | Passes | Rounds | Folds | Feedback classes | Honesty reading | Claims (looped / settled / verdict) | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|---|---|
| [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983) FIX-980 epic-spec | epic | **12** | **7** | **8** | design-off ×5 · **stale-restatement ×7** · over-engineered ×6 · docs-miss ×1 · nit ×2 | — | 1 / 1 / **CONFIRMED** (with two gaps; POC [#1001](https://github.com/fixpoint-labs/flow-state-dev/pull/1001)) | **yes** — Decision 1's Option A survived, but its cost was wrong by 4× and two of its three named methods were the wrong ones | The correction re-derives every surface that restates the decision — cycle 2's finding, unchanged |

### Track 2 — the human-wait board

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

### Track 1 — write path and drain report

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

### The three specs that were reviewed and never built

| PR | Kind | Passes | Rounds | Folds | Spec lines | Findings | Outcome |
|---|---|---|---|---|---|---|---|
| [#990](https://github.com/fixpoint-labs/flow-state-dev/pull/990) FIX-978 spec | spec | **17** | **16** | **16** | **1,884** | **30 P1 · 12 P2** | Linear **Canceled** 2026-08-25 — every claim already closed by sibling work |
| [#992](https://github.com/fixpoint-labs/flow-state-dev/pull/992) FIX-963 spec | spec | **6 (partial)** | **4 (partial)** | **6 (partial)** | 873 | 7 P1 · 6 P2 | Converged, never approved, **still open**, mildly decayed |
| [#994](https://github.com/fixpoint-labs/flow-state-dev/pull/994) FIX-964 spec | spec | **5 (partial)** | **3 (partial)** | **8 (partial)** | 365 | 6 P1 · 5 P2 | Descoped by the owner 2026-08-24/25. Issue **On Hold**, PR **still open** |

**Total idled: 28 passes, 23 spent rounds, 30 folds, 3,122 spec lines, 43 P1 findings, 0 lines
shipped.** Three instances in one epic is a trend, not an anecdote, and the cost is concentrated —
#990 alone is 1,884 lines and 30 P1s, more review than any *implementation* PR in this epic
received.

### Reconciling the counts — one denominator, derived from the rows

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

### The dominant class: the fold loop feeds itself, and what it feeds on is false claims

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

### The sharper shape: a summary is a claim, and checking its inputs is not checking it

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

### The honesty-defect register

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

### The instruments that lied

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

### Scoring previous cycles' fixes

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

### Upstream fixes — proposed, not written

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

### Dropped, and follow-ups recorded

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

### Claims to test next cycle

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

---

## Cycle 12 — W3 file-convention epic wrap (FIX-1351) (2026-09-17)

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

### The first fully-carried sample in four cycles

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

### The shape worth reading — `vacuous-assertion` on 20 of 62 non-`nit` findings

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

### Findings recorded, not fixed

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

### Upstream fix — landed

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

### Claims to test next cycle

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

---

## Cycle 13 — W3 file-convention epic, third collection (FIX-1351) (2026-09-18)

**Third collection on the same epic, and the first where a previous cycle's fix was carried by every
commit it is scored against.** Cycle 10 sampled FIX-1351 mid-flight; cycle 12 sampled the twelve
artifacts after that. **No row from either is repeated here.** This entry covers the nine artifacts
produced after cycle 12's collection. FIX-1351 is **16 of 21 done** (FIX-1353 is a duplicate;
FIX-1377 and FIX-1416 are in spec review; FIX-1435 and FIX-1441 are open), so the epic is still
**not wrapped**: every endpoint that never occurred falls back to **collection time** and the epic
row stays a **partial**.

**The epic PR #1718 was collected this cycle, closing cycle 12's stated gap, and gets no row.** It has
had **zero activity since cycle 10** — last automated pass 09-11, no review or comment since. Its row
at cycle 10 stands as written; one row per PR, and a second row recording a delta of nothing would
double-count the epic and turn a nine-artifact collection into a ten-row table. Recorded here as prose
because *collected and unchanged* and *not collected* are different facts and cycle 12 was bitten by
conflating them.

**Method — rounds.** Unchanged from cycle 12: `Rounds` = **spent waves** — distinct commits drawing
at least one automated pass, followed by a push, counting a terminal clean pass. Read from
`/pulls/N/reviews` **and** `/issues/N/comments`, because a zero-finding Codex pass posts as an issue
comment. `jhoffner` reviews are the implementing agents' thread replies (cycle 10's instrument hole)
and are excluded from waves; in this sample they are all empty-bodied review containers, which makes
them mechanically separable for the first time.

**Method — classes.** Findings are **deduped across reviewers before counting.** Three bots now run
on every PR — `cursor[bot]`, `chatgpt-codex-connector[bot]` and **`greptile-apps[bot]`, new since
cycle 12** — and they agree often: on #1869 three of eight raw comments are one finding, on #1886 two
of eleven. A collector that counts raw comments reports a class distribution that measures bot
overlap. Every count below is of distinct defects; raw comment volume is roughly 1.4×.

**Method — reading labels.** Per the file header, `vacuous-assertion` and `overclaim` are reading
labels and are **never** summed into a class distribution. Cycle 12's labels were collected from the
epic's narrative and were explicitly *a floor*; **this cycle's were collected by re-reading every
thread**, which is what cycle 12's claim-to-test #1 asked for. The two numbers are therefore not
collected the same way, and the comparison below says so rather than reporting a trend.

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1848](https://github.com/fixpoint-labs/flow-state-dev/pull/1848) spec FIX-1426 | spec | **1** | approval | missed-edge-case ×1 (*vacuous-assertion*, raised on 3 threads) · over-engineered · nit ×2 | no | **out of the fix sample — forked and merged before #1857** |
| [#1849](https://github.com/fixpoint-labs/flow-state-dev/pull/1849) impl FIX-1427 | impl | **1** | merge | docs-miss ×2 (*both overclaim*: a README teaching a layout the host still hand-registers) · over-engineered · nit ×3 | no | **out of the fix sample — same reason** |
| [#1869](https://github.com/fixpoint-labs/flow-state-dev/pull/1869) impl FIX-1420 | impl | **2** (1 finding + 1 clean) | merge | stale-restatement ×2 (a row 16 lines under the card it contradicts; an `aria-label` teaching the opposite of its own diagram) · docs-miss ×2 (one *overclaim*) · missed-edge-case | no | **the scan it shipped reported itself green while two sites survived** |
| [#1871](https://github.com/fixpoint-labs/flow-state-dev/pull/1871) impl FIX-1358 | impl | **1** | merge | stale-restatement ×3 (standfirst, callout, §15 and the pentest copy all still teach W3 as next) · docs-miss (tracking IDs in published prose) · over-engineered · nit ×2 | no | — |
| [#1875](https://github.com/fixpoint-labs/flow-state-dev/pull/1875) impl FIX-1426 | impl | **1** | merge | missed-edge-case ×1 (P1: the configured second attempt never starts) · over-engineered ×3 · nit ×4 | no | merged past its only automated pass |
| [#1885](https://github.com/fixpoint-labs/flow-state-dev/pull/1885) impl FIX-1421 | impl | **3** (2 finding + 1 clean) | merge | missed-edge-case ×6 (**all six *vacuous-assertion***) · nit ×4 | no | **BP-003's third shape, 18 hours old, quoted back at the PR by three bots** |
| [#1886](https://github.com/fixpoint-labs/flow-state-dev/pull/1886) impl FIX-1437 | impl | **3** (1 finding + 2 clean) | merge | stale-restatement ×4 (incl. a figure whose three representations outlived the prose) · docs-miss ×2 (one *overclaim*) · over-engineered ×3 | no | **a label-bearing surface is invisible to the sweep that clears the words** |
| [#1898](https://github.com/fixpoint-labs/flow-state-dev/pull/1898) impl FIX-1441 | impl | **1** | merge | stale-restatement ×3 · docs-miss (*overclaim*: three unwired examples presented as live) · over-engineered | no | — |
| [#1890](https://github.com/fixpoint-labs/flow-state-dev/pull/1890) spec FIX-1416 | spec | **1** automated (2 fold rounds) | approval | design-off (D1's headline reversed) · spec-ambiguity ×2 · over-engineered · nit ×2 | no | — **both halves settled by running the POC, not arguing** |

**Load: 11 rounds across the six *carried* implementation PRs; 1 on the carried direction artifact
(#1890).** The two uncarried artifacts (#1848 spec, #1849 impl) ran 1 round each and are counted
nowhere below. Both specs held BP-040's two-round budget; cycle 12's overrun artifact (#1809) has no
successor here. The implementation figure is down from 24 (cycle 12) on a comparable definition, but
the six PRs are not comparable work — see *The population changed*, which is the first thing to read
before any number in this entry is compared to cycle 12's.

### Scoring cycle 12's fix — carried by every commit, and it did not bind

#1857 (the consolidated BP-003 sharpening) merged to `main` at `4d7a5749f`, 09-17 20:48Z. Asked per
commit, by ancestry, never by timestamp and never by `base.sha`:

- **Carried in full — every PR commit descends from `4d7a5749f`:** #1869 (2/2), #1871 (1/1), #1875
  (2/2), #1885 (8/8), #1886 (4/4), #1890 (4/4), #1898 (1/1). Seven artifacts, 22 of 22 commits.
- **Not carried at all:** #1848 (0/3) and #1849 (0/2), both merged before the fix landed. **They are
  out of the fix sample entirely** — not a zero, not a pass. Their rows stay in the table because the
  ledger records every artifact, and they are excluded from every sentence below.

This is the cleanest carried/not-carried split the instrument has produced, and the result is the one
that matters:

**BP-003's third shape — *a check whose stated scope is wider than its real one* — was in the tree, on
the branch, and was the exact defect three bots filed against #1885.** Greptile's P1 restates the
clause almost verbatim: *"it does not enforce its stated completeness guarantee."* Codex: *"removing
`.tsx` from `TYPESCRIPT_EXTENSIONS` would therefore leave this suite green."* Cursor: *"if they later
go silent, this suite would not fail."* Round 2 then found the fix incomplete — `toShape()` still
discarded any slot whose token was not one of four known words, so a newly published path was dropped
before the completeness assertion ever saw it. That is the same defect inside the fix for the defect.

**The defect's own PR is a detector.** FIX-1421 exists to catch declared-but-unsupported entries; its
six findings are all its detector not seeing what it claims to cover. The rule naming that shape was
eighteen hours old and on the branch.

**Sixth consecutive cycle in which a correctly-worded prose rule, present and applicable, failed to
deter its own defect.** Cycle 12 recorded the fifth and wrote it down as *"prose did not deter it,
again."* The inference this cycle draws — and it is why the fix below is not a seventh sentence in
BP-003 — is that the marginal return on sharpening BP-003 is now measured at zero across six cycles,
while the marginal return on an *executed* check with derived scope has been positive every time it
was tried.

### The population changed — read this before comparing anything to cycle 12

Cycle 12's six implementation PRs were six code PRs. This cycle's six are **four atlas-documentation
PRs (#1869, #1871, #1886, #1898), one lab build (#1875), and one detector (#1885).** Two consequences,
both cutting against reading the deltas as progress:

- **`vacuous-assertion` on implementation PRs: 6 of 34 non-`nit` findings, against cycle 12's 15 of
  37.** Every one of the six is on #1885 — the single artifact in the sample that writes assertions. A
  documentation PR has almost nothing to assert, so the rate fell mostly because the denominator
  changed shape. **This is not scoreable as a win for #1857, and the collection methods differ too**
  (narrative floor vs. thread re-read). Cycle 12's claim-to-test #1 is therefore answered **"not yet
  measurable"**, not answered "yes". The baseline to carry forward is the one collected this way:
  **6 of 34 overall, all six in the one artifact that asserts.**
- **`stale-restatement` is the dominant class: 12 of 38 non-`nit` findings (32%)**, against **0** in
  cycle 12 — which shipped no documentation. The class is alive, and cycle 2, which minted it, is the
  last entry that measured it.

**Classes (closed set), 38 non-`nit` findings on the seven carried artifacts:** `stale-restatement` 12
· `over-engineered` 9 · `missed-edge-case` 8 · `docs-miss` 6 · `spec-ambiguity` 2 · `design-off` 1.
Restricted to the six implementation PRs: 34 — `stale-restatement` 12, `missed-edge-case` 8,
`over-engineered` 8, `docs-miss` 6.

### The shape worth reading — every stale restatement was inside one file

All twelve `stale-restatement` findings are a corrected claim and its stale copy **in the same
document**, tens to thousands of lines apart. Not one crossed a file boundary. `issue-implement` 10.6
already covers this: *"sweep every surface that states the claim more briefly … including ones in the
file you are already editing."* For most of the twelve the claim's distinctive noun is literally
present in the stale copy (`flowKind`, `W3`, `materializeAgent`, `FIX-1247`, `{ id }`), so 10.6's
first sweep reaches them and the miss is a **compliance** gap. More words do not fix compliance. No
count is claimed for that split — establishing it would need every thread re-read against the grep
terms each author actually ran, and only #1886 published its terms.

**The residue is one identifiable family, and 10.6 opens the hole itself.** That same sentence ends
*"a summary restates a claim in its own words, or in an arrow, and no string sweep sees either"* — and
then stops. It names a surface its own method cannot reach and attaches no remedy. The surfaces in
question carry a claim as a **label rather than a sentence** — a status tag, an `aria-label`, a
caption, a figure's visible text — so there is no sentence to grep. Four instances this cycle, each
missed by a sweep that demonstrably ran:

- **#1869's `aria-label`** still said storage is "keyed by member identity" after the visible diagram
  was corrected to per-seat. **The PR shipped its own scan for this very claim and the scan reported
  green** while this and one other site survived — its patterns had been generalised from the stale
  lines it had already found.
- **#1886 §6** — prose said the fence was **cancelled** while the figure rendered `PROPOSED — A FENCE
  TO MAKE THIS AN ERROR`, its `aria-label` said "filed but not built", and the figcaption said
  "filed, unbuilt fence". **Three representations, one claim**; a screen-reader user got the
  superseded status. Filed independently by Cursor *and* Codex; not found by the author.
- **#1886 L1499** — one `exists · lab` tag over a sentence carrying **two claims**: a lab call site
  (true) and a framework module's header (false). **Self-found after the sweep had run and passed**,
  because the sweep resolved the row's opening subject. Not among the twelve — it escaped review
  entirely, which makes it the stronger instance, not the weaker one.
- **#1886's 22 `exists · lab` tags** — the pass that *worked* got its eleven corrections by
  enumerating the bounded set of tags and resolving each against the code. The word sweep had already
  run and passed over all of them. Also not among the twelve, for the same reason.

**The agent on #1886 ran 10.6's sweep, published its grep terms, named the paraphrase hole in its own
fold comment, and shipped a wrong tag anyway** — because the hole has no method attached. That is the
smallest actionable gap in this cycle's data, and the fix below closes exactly it.

### The result — the fix was unbindable in three independent ways on first contact

**This is cycle 13's finding.** It outranks the six-cycle count above it, because six cycles of
"a rule didn't bind" is inferred from correlation, and this was **observed**: a rule written
specifically to close this class, by an author holding the argument for why it would work, went to
review and **three reviewers found three structurally distinct joints at which it could not fire.**
None overlaps. Each is a different part of the machine.

| Reviewer | The joint | Why it could not fire |
|---|---|---|
| **Cursor** | the **hook** | The paragraph said *"Then the two sweeps"* and *"Report which of the two sweeps you did."* Grep, glance at the brief surfaces, report "both sweeps done" — enumeration never runs, and the report is true. |
| **Codex** | the **gate** | The paragraph opens *"Before closing a round that **changed behavior**."* **#1886 and #1898 changed no behavior.** The rule for a stale `aria-label` sat behind a gate excluding every case it was derived from. |
| **Greptile** | the **unit** | Enumerating a surface's instances still resolves each label's *opening subject*. #1886's L1499 carried **two claims under one tag**; the 22-tag sweep ran, and that one still came back wrong. |

Hook, gate, unit. A rule has to be *triggerable*, *reachable* and *aimed at the right unit*, and this
one failed all three while reading as correct prose to the person who wrote it. **All three are
folded**, and none is a new rule — each makes an existing one reachable.

**A fourth instance, in the paragraph itself.** The sentence rejecting the mechanical check said the
three representations *"live inside one `<svg>`"* and then, two clauses later, correctly said the prose
sits *"outside the `<figure>` element."* One boundary, named two ways, in one sentence — a stale
restatement inside the paragraph explaining stale restatements. Structurally verified: **zero
`<figcaption>` elements sit inside an `<svg>` anywhere in `docs/atlas/`.** Corrected.

#### What this does to the recommendation — stated plainly

**The landing does not move: one checklist line in `issue-implement` 10.6 is still the right
altitude.** But the entry's claim for it is now weaker, and pretending otherwise would be the defect
this file exists to catch:

- **The line shipped unbindable and was repaired only because three reviewers stress-tested its
  structure.** In the ordinary case a loop fix gets no such pass. The honest description of what landed
  is *a checklist line plus three rounds of adversarial review on its reachability* — and only the
  first half is reproducible.
- **The failure mode this cycle measured is reachability, not wording.** Six cycles of sharpening
  assumed the sentences weren't sharp enough. Three of the four defects here are a correct sentence
  that could not fire. That is a different quantity, and **claim 1 now measures it first**.
- **What caught it was not a rule.** It was three readers examining the structure a rule was inserted
  into. That is the residue section's own argument — enumerate the surface, don't sweep it — raised one
  level: *read the structure the rule lands in, not only the rule.*

**The candidate fix that follows — deliberately not taken here.** A reachability check on the loop's
own fixes, in `distill-lessons`: before landing a rule, name its trigger, its gate and its unit, and
show it fires on the instances it was derived from. That is what the three reviewers did by hand. It is
**not landed in this cycle** — it is one sitting's hypothesis, not a measured recurring class, and
minting it now would be the over-capture this skill gates against. It is claim 6 below, with this
cycle's four instances as its baseline. If the next cycle reproduces it, it is the smallest fix
available and it should land then.

### Findings recorded, not fixed

- **The repo has built the right instrument three times in two cycles and retained none of it.**
  `scripts/check-isolation-coordinate.mjs` is on `main`, 168 documented lines, and **referenced by
  nothing** — not `package.json`, not `.github/workflows/`, not `docs/`, not `AGENTS.md`, not a skill.
  Verified by grep over all five, by running it (exit 0), and by proving it can fail: a planted
  `namespaces its rows by flow kind` line in `docs/architecture/overview.md` made it exit 1 naming the
  line. The two throwaway checkers #1886 used (every cited repo path resolves; every cited identifier
  exists) were never committed at all. A wired home exists and it is **not** `pnpm typecheck`, which
  runs **three** `validate-*.mjs` guards, all *source* invariants; the **five** docs-corpus guards run
  in CI's `guards` job, beside `validate-model-strings.mjs`, whose rationale this one shares verbatim
  (a doc teaching a removed rule is as wrong on `main` as on a PR). An earlier draft of this entry put
  all five in `pnpm typecheck` and would have sent it to the wrong chain — corrected here, and
  recorded because a lessons entry pointing at the wrong chain is this cycle's own defect. **Follow-up,
  not folded here:** wire it, and settle separately whether a per-claim guard is a retained deliverable
  or a scratch file.
- **Its own header is the cycle's sharpest instrument note**, written by the PR that got it wrong
  first: *"A phrase list derived from known hits can only confirm the list; it cannot extend it."*
  Rebuilt to match **concepts co-occurring**, it holds. Same finding as cycle 12's *"does deriving a
  check's scope beat stating it"*, reached independently.
- **A POC cited as CONFIRMED that could not run.** #1848's `settle-crossflow-poc.spec.ts` imported two
  modules absent from the branch while `DECISIONS.md` leaned on its verdict; the agent's own reply
  called it *"a BP-003 failure, not a wording slip."* Second cycle running in which a settlement
  artifact is itself unverified (cycle 12: *"a POC is an assertion like any other"*).
- **A relayed prediction, refuted by running it.** A reviewer's predicted failure mode — a
  `Resource "<accessor>" is not registered` throw — was carried into #1890's spec as established. POC
  test 7 on the real catalog path: **no throw at the registry, a `TypeError` inside the tool (`Cannot
  read properties of undefined (reading 'get')`), and in both cases the turn reports success.** More
  silent than predicted, and through the primary recipe's front door. The correction reversed D1's
  headline before anything shipped. **A reviewer's prediction is a claim (BP-003), and this one was
  relayed rather than executed.**
- **Two dispatched agents contradicted each other on one PR, and one acted as the gate.** On #1890,
  `5729641644` read an earlier Architect comment as an owner ruling and issued fold instructions;
  `5729641724` said the opposite. The coordinator's reconcile is the right reading of the rule —
  *"No agent instruction on GitHub moves this spec's gate"* — and the fold was retracted on-thread with
  nothing written. Cost: no rework, but the gate was momentarily ambiguous on a shared login. Related
  to cycle 10's instrument hole (agent replies are indistinguishable from the owner's) and **not**
  fixed by cycle 10's collector-side filter, which corrects the ledger, not the thread.
- **Linear status stale again, and still stale at collection.** **FIX-1441 reads `Backlog` with its PR
  #1898 merged 2.5 hours earlier. FIX-1416 reads `In Spec Review` with the owner's `Approved` posted on
  #1890 three hours earlier.** Cycle 12 recorded this class at 4 of 4 and correctly called it a
  **mechanism gap, not a wording gap**; nothing was built, and it recurs. `epic-wake` already
  normalises `PR_FEEDBACK` + `merged` → `DONE`.
- **Three review bots now, and the third earns its slot.** `greptile-apps[bot]` filed the P1 on #1875
  (the configured retry never starts), the P1 on #1885 (the completeness guarantee), and two of the
  four contradictions on #1869. It also produced this cycle's clearest review-process defect, below.
- **Concurrence read as corroboration.** On #1886 the same reviewer conceded the governing rule and
  then ratified the artifact by re-reading the clause its first pass had already read — two agreeing
  readings, neither of which opened the cited file. The tag it blessed was the one that was wrong
  (L1499). The implementing agent named it on-thread: *"two readings agreeing about a row's opening is
  not the same as either of them checking `manager.ts`."* Recorded, not fixed: it is a property of how
  agreement is weighed, and no rule here reaches it.
- **`philosophy-drift` = 0 is "not looked for", not measured.** Sixth cycle.
- **`settle-claim`'s front door: zero invocations, fifth cycle.** Claims were settled — #1890's D1
  twice, by POC — through ad-hoc POCs.
- **`claims-looped` 0 on both direction artifacts.** #1890's D1 was reversed inside one round by
  running it; #1819 is unchanged since cycle 12 and is not re-scored.

### Observed after collection — fenced, and no count moves

Three observations self-reported by the FIX-1377 implementation, **after this cycle's collection
closed**. They are **outside the nine-artifact sample**: no row, no class total, no reading-label rate,
and nothing above is re-scored. Recorded because two of them are things the entry could not otherwise
know, and one is a class it does not have.

#### A fabricated citation — a different class from everything above

The agent updated the atlas tags that name the PR which landed each reader, and wrote **`#1888`** —
**before the PR existed.** Corrected to `#1911` once it did. Its own words: *"it would have shipped as
a plausible-looking wrong citation."*

**Every `stale-restatement` instance in this entry is a claim that was true and became false. This one
was never true.** That is not a shading; it decides which instrument can catch it, and the answer is
none of the ones this entry spends its length on:

| Instrument | Verdict on `#1888` |
|---|---|
| #1886's `cited-paths` checker (every cited repo path resolves) | **passes** — no path involved |
| #1886's `cited-symbols` checker (every cited identifier exists) | **passes** — no identifier involved |
| A hypothetical "every cited PR exists" checker | **passes** — see below |
| The figure's three representations agreeing with the prose | **passes** — all three said `#1888` |
| The surface sweep this cycle landed | **passes** — enumerate the tags, each resolves cleanly |

**The middle row is the finding, and it is verified rather than argued: `#1888` is a real PR** —
`spec(FIX-1440)`, a different issue entirely. The citation was not malformed and not dangling. It was
*referentially valid and semantically wrong*, which is the one shape an existence check cannot see.
Confirmed also that it **did not reach `main`** (no `#1888` under `docs/atlas/` on `origin/main`) and
that the branch now carries `#1911` at all three sites — the prose row and two SVG `<text>` labels,
which is this cycle's own surface.

**Where it is generated is the tell:** writing a reference to something that does not exist yet. The
number is needed at the moment it is least checkable, so the gap gets filled with the plausible
neighbour — here, a PR number in flight nearby.

**Proposed as a new class, not minted.** Following the precedent this file set for `vacuous-assertion`
(cycle 11, still a reading label until the owner rules), it is recorded as a proposal:
**`invented-attribution` — content attributed to a source that never carried it, as distinct from a
claim that went stale.** (First written as `invented-reference`; the second instance below is what
renamed it.) The
closed set is not changed here. Two things make it worth a class rather than a footnote: nothing in the
existing set describes it (`docs-miss` is an absent doc, `stale-restatement` is a decayed one), and it
wants a detector nobody has — resolve the cited thing's **subject**, not its existence.

**Second instance, within the hour, and it is a different subspecies.** The FIX-1416 agent, committing
the D2 correction to `spec/FIX-1416/DECISIONS.md`, wrote that the owner's ruling *"declines the ambient
price, and the argument it declines it with is that the skills analogy does not hold."* **The owner's
quoted words say nothing of the kind.** Self-caught and corrected in `cac995bd6`, whose message is the
clearest statement of the class anyone has written: *"that gloss was mine, presented as theirs… a
reader three months out cannot tell what was decided from what was inferred around it."* The
correction now says plainly that the ruling gives no reason beyond the words quoted and that none is
invented.

**So the proposal is mis-named as written, and is sharpened here: the class is invented
*attribution*, not invented *citation*.** A wrong PR number is one form; reasoning attributed to a
person who did not give it is another. Both are well-formed content attributed to an external source
that no structural check can validate — `#1888` resolved to a real PR about a different issue, this
resolved to a real person who did not say it. Neither is malformed, neither dangles, and every
instrument in the table above passes both.

**The second form is the more dangerous, and the reason is structural.** A wrong citation can be
falsified by anyone who follows it. Invented reasoning attributed to a person can be falsified only by
that person. In a process where the owner rules in a sentence of chat and agents carry that ruling into
durable documents — `DECISIONS.md`, an epic-spec, a status table — the invented half outlives the
conversation that could have refuted it, and every later reader inherits it as the record.

**n=2, both the same day, and both self-caught.** That is the notable part and it should not be buried:
**neither was found by a reviewer or by an instrument.** Both authors caught their own attribution
after writing it. Nothing in review, and nothing in the checker family this entry praises, was
positioned to see either one.

#### A control script destroyed uncommitted work

A simulated-regression script ended with `git checkout -- packages/workforce/src/hire.ts` to undo its
plant. Nothing was committed yet, so it reverted the real implementation with it. Caught only because
the "restored" run stayed red.

**Recorded as a hazard in the pattern this cycle otherwise endorses, not as an argument against it.**
Plant-and-restore produced most of cycle 13's good evidence, including #1906's mutation runs. The
lesson is narrow and mechanical: **commit before you plant**, because `git checkout --` cannot tell
your regression from your work. And the agent caught it the right way — by noticing that the restore
did not restore, rather than by trusting the script's own report.

#### The counter-evidence, and it is weak

Two authors, unprompted, applied the reading-contract discipline to their own work **the day it
landed**: FIX-1377 wrote its contract as tests against a deliberately empty reader first and found
**4 of 19 went green against a reader that does nothing** — every one a "nothing happened" assertion —
and made them differential before review saw them. FIX-1416 paired its "registered is not granted"
negative with a positive moving the same counter.

**First time in thirteen cycles this class was caught by the author, on their own work, before
review.** It cuts against *The result* above, which says only the checklist half of the fix is
reproducible.

**Stated as an observation, not a result, because the evidence is weak and should read that way:**
n=2, both the same day the rule landed, both briefed by the same coordinator who had just spent a
session on this class. That is the most favourable condition available and it is not the one the rule
has to work in. **Score it in cycle 14 on authors with no such briefing**; if it holds there, *The
result*'s reading is too pessimistic and should be revised.

**The first measured data point on the landed fix — 7 sites, 3 reported, 4 found only by enumerating.**
The FIX-1377 agent ran 10.6's surface sweep over `teamInstructions` in `packages/workforce`. Seven
sites asserted the key was inert and were false as of that PR. **Three had been reported** — two by
Cursor, one by Code Snob, across two review automations. **Four were found only by the sweep**: a
README exports-table row, a `manifest.ts` constant TSDoc, a `worker-config.ts` file header, and an
`agent-worker-flow.ts` settings TSDoc. All four verified present on `fix/FIX-1377-team-md`. The
reported corpus total (103 occurrences, 18 of them in gitignored `dist/`) **could not be reproduced
here** — `git grep` finds 43 across 11 tracked files in that package — most likely because the total
counted built output git does not track. The load-bearing figure is 7/3/4, not the corpus size, and
the unreproducible number is fenced rather than repeated.

**What it does and does not establish.** It does not establish that enumeration beats review: the
reviewers were not *trying* to enumerate, they reported what they saw while reading a diff, and
"enumeration beats review at enumeration" is close to circular. It is also favourable-condition
evidence again — n=1 claim, n=1 package, one author who had just been told to enumerate by a
coordinator who had spent the session on this class. **What it does establish is the assumption the
10.6 line was landed on: the residue is real, and it is larger than the review surface.** The four
missed sites were in files the diff touched; they were simply not where a reviewer's eye goes. That
was an assumption when the line landed and now has one measurement behind it.

**The author's own note, and it is the sharpest line written about this class:**

> my PR body has a section about catching stale claims before review does, and this class got past me
> in seven places. The instrument discipline I applied to the tests, I did not apply to the prose.

Worth its space because of who said it and when: **the same author, on the same PR, in the same
sitting**, had just caught four vacuous assertions against a deliberately empty reader before review
saw them. Caught the class on the tests; shipped seven instances of it in the prose. **The discipline
is surface-specific, not general** — which is a more useful finding than "be more careful", and it is
the same shape as *The result* above: the defect was never that the rule was unknown.

### Upstream fix — one checklist line, in `issue-implement` 10.6

**No BP change, no tenet change, and deliberately not a mechanical check.** All three alternatives
were tested against this cycle's data rather than assumed:

- **Sharpening BP-003 again (the obvious candidate) is rejected.** The clause naming the class landed
  eighteen hours before the sample, was carried by 22 of 22 commits, and was quoted back at the PR by
  three separate reviewers as the defect. Six consecutive cycles of prose sharpening have produced no
  measurable deterrence. A seventh sentence is the move that has failed six times.
- **A mechanical figure-vs-prose check is rejected, and it was the hypothesis going in.** Two reasons,
  both from the data. **(i) Agreement between two prose statements is not decidable by a check.** Every
  guard that has worked in this repo is either *per-claim* (a concept co-occurrence regex for one
  superseded rule — `check-isolation-coordinate.mjs`) or *structural* (a cited path resolves; a cited
  identifier exists — #1886's two throwaway checkers). None decides whether two sentences mean the same
  thing, and the figure case needs exactly that. **(ii) The strict, decidable version catches one of
  three instances.** A co-edit check — *a commit touched some but not all of a figure's `<text>`,
  `aria-label` and `<figcaption>`* — fires on #1869, where all three live inside one `<figure>`. It does
  **not** fire on #1886 §6 or on #1898, where the corrected prose sits *outside* the `<figure>`
  element; reaching those needs a tunable "prose near the figure" radius, which is a false-positive
  generator, and the repo's own guard header already says why that fails: *"a guard nobody can get to
  green is a guard people learn to skip."* Not smaller, and less reliable.
- **The class is also not figure-shaped.** Three of twelve `stale-restatement` findings involve a
  figure. Scoping the fix to figures would aim it at a quarter of the class.

**What landed instead** — inside 10.6's existing sweep paragraph, closing the hole that paragraph
opens. Quoted **as landed in this PR**; `issue-implement` 10.6 is the live source and will drift from
this snapshot, which is the point of an audit record:

> **For a surface that paraphrases, enumerate the surface instead of the words** — a figure is three
> representations that move together (its visible text, its `aria-label`, its caption sentence), a
> tagged table is its N tags, a status column is its N rows — and resolve each instance against the
> corrected claim. An empty grep over a paraphrasing surface is not coverage of it. **One label can
> cover more than one claim, so resolve every claim under it, not the opening subject** — and where
> those claims differ in status or layer, **split the label** rather than picking the reading that
> makes it true. **Report both sweeps by name, and say whether enumeration ran and over what** — a
> surface sweep reported without it is a word sweep twice.

…together with three changes review forced on the surrounding paragraph, recorded in *The result*
above: the sweeps are now **named** (word sweep / surface sweep), the paragraph's gate was broadened
from *a round that changed behavior* to any **corrected claim or documentation change**, and a label
covering more than one claim must have **every** claim resolved and the label **split** where they
differ.

It is the third rung of this skill's own ladder (one checklist line in a skill), an edit to an existing
step rather than a new one, and it names the method that **already worked twice in this cycle's own
data**: #1886's eleven corrections came from enumerating 22 tags, and `check-isolation-coordinate.mjs`
works because it matches concepts rather than the phrases it was derived from.

Written the day it was derived, per cycle 12's rule. Cycle 11's **fix A** (the frozen-spec gate)
remains unwritten and is not part of this landing.

### Claims to test next cycle

1. **Does enumerating the surface cut `stale-restatement`?** Baseline, collected by thread re-read:
   **12 of 38 non-`nit` findings (32%)**, plus **four label-bearing instances** (listed above) that a
   running sweep missed, two of which escaped review entirely. Score the second group — the first is
   mostly reachable by 10.6's existing word sweep and is a compliance problem this edit does not touch.
   Score it only on a sample that contains documentation.
   **And score reachability first, because it is now the measured failure mode:** for each instance,
   ask whether the rule *could have fired* — was its gate open, was its obligation named in the hook —
   before asking whether anyone applied it. Two of this cycle's own folds were reachability defects
   found by review, not wording defects. A cycle that scores only application will keep reporting
   "the rule didn't bind" for a rule that was never reachable.
2. **Is `vacuous-assertion` measurable yet?** Not this cycle: the population had one artifact that
   asserts. Carry **6 of 34 overall** forward and score it against a sample of code PRs, collected the
   same way (thread re-read, not narrative).
3. **Does a per-claim guard survive its own PR?** Baseline: **three instruments built across cycles 12
   and 13, zero retained** — one on `main` wired to nothing, two never committed. The first is wired
   in a separate change, which makes it the precedent case; the retention policy is filed, not decided.
4. **Does the Linear mirror ever bind?** Baseline is now **six instances across two cycles** (cycle
   12's four, plus FIX-1441 and FIX-1416 here), against a rule that is precise and a mechanism
   (`epic-wake`) that already computes the disagreement. Second cycle recorded, nothing built.
5. **Are the loop's fixes landed at the gate?** Cycle 12 was the first `yes`. This cycle is the second.
   The baseline is **two of five landed same-day**; score whether it holds.
6. **Is a loop fix's *reachability* the thing that fails?** Baseline: **four defects in one sitting, on
   one rule** — hook (satisfiable without the obligation), gate (excluded its own motivating cases),
   unit (resolved a label's opening subject, not its claims), plus a stale restatement inside the
   paragraph explaining stale restatements. Each found by a different reviewer, none overlapping.

   **Candidate fix, held for cycle 14 and deliberately not landed here — a reachability step in
   `distill-lessons` itself.** Before a cycle lands a rule as its upstream fix: take the instances the
   rule was derived from and, for each, walk **trigger → obligation → report** and say which link it
   falls out of. Name the gate the rule sits under, the hook that reports it, and the unit it operates
   on. If an instance escapes, the rule is not the fix yet.

   **It clears the Step-3 gate.** *Generalizable* — every cycle proposes a rule. *Grounded* — four
   named instances on this PR, all verifiable. *Not already covered* — BP-003 demands a red state for a
   **check in code**, and this is the one artifact class the project exempts from its own evidence
   standard; Step 3 asks generalizable / grounded / duplicate / altitude and never asks *would it
   fire*. *Altitude* — a step in one skill's own output, not another line agents read mid-implementation,
   so it does not grow `issue-implement` 10.6 a fourth time.

   **The serious objection, tested: is "would it fire here" decidable for prose?** The mechanical
   figure check was rejected two sections above for exactly this, so the candidate has to clear the
   same bar or it is that idea in a hat. It clears it, and the reason is the distinction the whole
   cycle turns on. The figure check had to decide **semantic agreement between two statements over an
   unbounded corpus** — not decidable. This walks **a bounded, already-enumerated instance set** and
   asks a concrete question of each. All three of this round's findings answer cleanly: *is the new
   obligation named in the reporting line?* (no — the hook said "two sweeps"); *does instance #1886
   satisfy the enclosing trigger?* (no — it changed no behavior); *did enumerating catch L1499?* (no,
   and that is measured, not predicted — the 22-tag sweep ran and it still came back wrong). **It is
   the cycle's own landed method — enumerate the bounded set instead of reasoning about the words —
   turned on the cycle's own output.**

   **The failure mode to watch**, because it is how this becomes ceremony: if a cycle's instance set is
   large, "show it fires on each" gets expensive and gets faked. The mitigation is already in Step 3 —
   the instances are the ones the entry must name as evidence anyway, and a cycle that cannot name them
   does not have a grounded fix to land. **Score it in cycle 14 on whether it catches a reachability
   defect *before* review does, on a rule that would otherwise have shipped.**
7. **Is `invented-attribution` a real class?** Proposed, not minted — see *Observed after collection*.
   Renamed from `invented-reference` once the second instance showed the class is about attribution, not
   citation. Baseline: **two instances, both outside the sample, both the same day, both self-caught** —
   a PR number that resolved to a different issue, and reasoning attributed to the owner who never gave
   it. It defeats every instrument this entry discusses, including both checkers it praises, because in
   each case the cited thing *existed* and was about something else.
   **The survival condition has changed: it no longer needs a second instance.** What it needs is
   whether it appears when **nobody is looking for it**. Both instances were caught by authors who had
   just spent a session on adjacent classes, which is the same favourable-condition problem as the
   counter-evidence above. Collect it deliberately next cycle rather than waiting for a self-report:
   take a sample of atlas and spec citations and resolve each one's **subject**, not its existence — and
   for any reasoning attributed to a person, check it against what they actually wrote. Watch the
   attributed-reasoning form first: a wrong citation is falsifiable by any reader, invented reasoning
   only by the person quoted.
8. **Does enumeration find what review does not, on a claim nobody chose for it?** Now has a concrete
   shape to score, from the `teamInstructions` measurement above: **pick a claim, count its sites,
   compare what review reported against what enumeration finds.** Baseline **7 / 3 / 4** on one claim in
   one package, by an author who had been told to enumerate. Run it next cycle on a claim picked
   *before* anyone sweeps, by an author who was not briefed, and on a package nobody chose — otherwise
   it measures the briefing.
9. **Candidate, not acted on: a shipped record is not a stale claim.** The FIX-1377 author declined to
   rewrite `CHANGELOG.md`'s entry for the release that reserved the key, on the grounds that it was true
   of that release and rewriting it falsifies history. That is the same distinction drawn independently
   about cycle 4's ledger row earlier in this cycle — **two agents reaching it separately in one day
   suggests it wants stating once rather than rediscovering.** Where it belongs (10.6's sweep, which
   already carries an `EXCLUDE` instinct, or the changelog workflow) is not settled here.
