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
together. Introduced cycle 8, which is also where the distinction is argued.
`vacuous-assertion` is proposed for promotion to the closed set (cycle 8, fix B) and is
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

---

## Cycle 8 — honest-task-substrate epic wrap (FIX-980) (2026-09-10)

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
  counted from `GET /pulls/N/reviews`. This is **cycles 4, 5 and 7's pass metric, unchanged**, and
  it is comparable to those cycles directly.
- **Rounds** — **spent review rounds**: a maximal group of consecutive passes with no non-merge
  commit between them, followed by at least one non-merge commit. This is **cycle 7's *spent
  review wave*, reused rather than redefined**, and it is the unit BP-040's budget is written in —
  a review, then a response. Every budget comparison in this entry uses this column.
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
| [#1461](https://github.com/fixpoint-labs/flow-state-dev/pull/1461) FIX-1244 spec | spec | **29** | **24** | **30** | **The worst overrun in this ledger.** design-off ×5 · over-engineered ×4 · docs-miss ×3 · stale-restatement ×3 · spec-ambiguity ×3 · nit ×43 | overclaim ×6 | 2 / 0 (both settled by **re-measurement**; the author's round-21 refutation of a reviewer was itself wrong) | **yes** — but the owner found it, not the review: *"resumeFromReview and unparkAndDrain. Why do we need both? … Is the wall of text in the spec really necessary?"* | **A hard stop after round 2.** BP-040 was in force and did not bind — see *scoring* |
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
claim that is not true, it is **45 and the second-largest.** The thesis holds on either reading;
the entry no longer depends on which.

**Corrections to this entry's own arithmetic, recorded rather than quietly fixed.** Earlier drafts
reported two different denominators for one corpus — "~195 classified findings" in one place and
"~145" in another — and read `overclaim`'s 23 as a share of a closed taxonomy that did not contain
it. Both figures were wrong; the rows total 198. An eight-fold spec row (#994) was also missing
from the overrun count. Every figure above now traces to a table in this entry, which is the
standard the entry sets for everything else.

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

**The trap is live in this repository today**, and it has an inverse face: deps installed but
`core`'s `dist` stale reports ~22 type errors in untouched files, which nearly got a correct fix
rejected. Cost this epic, from the author's record on #1675: **four fabricated measurements**, and
a worker came close to reporting an approved spec's central mechanism as broken. Filed as
**FIX-1032** (High, *Ready to Spec*), fix open at
[#1677](https://github.com/fixpoint-labs/flow-state-dev/pull/1677). A sibling instrument,
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
  worst spec overrun in this ledger's history happened **17 days after** BP-040 landed, on a branch
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
  dual-read missing three of its four readers. **Eight cycles, still the dominant class.**
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
  says the ledger is auto-derived from GitHub and Linear; cycle 8 was largely manual adjudication
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
   zero on nine of thirteen spec PRs and concentrated in four. If the gap widens, folds stop being
   a usable proxy for anything and the fold column should be retired rather than reinterpreted.
