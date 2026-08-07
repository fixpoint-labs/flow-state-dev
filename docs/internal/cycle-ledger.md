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
| D | **direction artifact** named as the kind covering spec *and* epic PRs, so the review-bar scoring, the `nit` exclusion, the claims fields and the endpoint all reach both; endpoints given as one table (impl→merge · spec→approval · epic→epic close), in-flight epics scored as explicit partials | skill, scoring | makes epic round counts comparable **from the next epic onward** (#993 predates the rule and is labelled raw), and stops an epic's lifetime activity reading as rework |
| E | the epic-wrap lessons skip is **partial** — ledger rows always append **and always land as a draft rows-only PR**; only the grounding proposal is skippable | skill, wrap | survivor bias: a ledger holding only epics that had findings can't show an improvement — and rows that never leave the wrap worker's worktree are the same bias by another route |

**The fixes for this class took nine rounds to reach all their own writers, and that is the
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

Nine rounds, each the same error the fix is about, each caught by review and not by the author.

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
sufficient. Rounds 6 through 9 then repeated the shape four more times, each inside a *fix for the shape* —
and round 8 inside the very table that counts them.

**Nine rounds is no longer an anecdote about this change; it is the cycle's primary measurement,
and it does not say what the fixes claim.** Fix A and fix B were chosen on the theory that naming
the class in the grounding gets an agent to converge restatements without being told which ones.
This PR tested that theory on its own author, live, nine times — and the author needed an external
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
conclusion nine rounds already point at. Do not let a third cycle pass on reading 1 by default.

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

Stale-restatement findings fall as a share of epic-PR review, and no epic-spec commit whose subject is "propagate correction X" leaves knock-ons behind. **Measurable only because fixes C, D and E made epic PRs collectable, their rounds comparable, and a clean epic's row land at all** — score it against #993's **11-of-18 findings** baseline, which is the comparable axis. Do **not** score it against #993's round count: that is raw and pre-rule (see the note under the table). Treat a zero as suspect until you have confirmed the epic PR was actually sampled. Cycle 1's claim (`missed-edge-case` breadth, spec rounds from 12) is still open — this cycle produced one implementation PR (#1064, 2 rounds, no `missed-edge-case`), too small a sample to move it.
