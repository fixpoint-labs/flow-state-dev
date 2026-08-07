# Cycle ledger

Measurement instrument for the development loop, maintained by the `distill-lessons`
skill. One row per spec or implementation PR, derived from GitHub review data.

**The metric that matters:** rounds-to-approval and the share of findings in the
top recurring class, both trending **down** across cycles. Flat or rising means the
upstream fixes landed at the wrong altitude — move them, don't add more.

**Feedback classes:** `design-off` · `missed-edge-case` · `over-engineered` ·
`spec-ambiguity` · `philosophy-drift` · `docs-miss` · `nit`.

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

Scoped to **one artifact**, the epic-spec on [#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993), across six automated review rounds in a single session. Not a full-cycle sweep — the epic's implementation PRs haven't run yet — so this row measures the *coordination artifact*, which is where the session's rework actually was.

| PR | Kind | Rounds | Feedback classes | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|
| [#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993) durable-jobs epic-spec | epic | **6** (this session) | stale-restatement ×15 · design-off ×3 | **yes** — one binding rule directed the superseded design; one fix created a correctness defect | The correction re-derives every surface that restates the decision, not just the section that owns it |
| [#1064](https://github.com/fixpoint-labs/flow-state-dev/pull/1064) FIX-925 | impl | 2 | over-engineered ×1 (owner, load-bearing) · nit ×6 | **yes** — a declaration was re-declaring what the runtime already held twice | Ask what the runtime already knows before adding a declaration kind |
| [#1061](https://github.com/fixpoint-labs/flow-state-dev/pull/1061) FIX-1008 | spec | 2 | design-off ×1 (premise dissolved upstream) | **yes** — closed unmerged, issue cancelled | A spec whose motivating premise is owned by another doc re-checks it before round 2 |

### The dominant class: 15 of 18 findings

**A decision was corrected in the section that owns it, and the surfaces that restate it were not.** Every one was caught by review, never by the author — including three consecutive commits *whose entire subject was propagating a correction*, and one case where a gate added to a binding rule was missing from the index it governed **one commit later**.

The restating surfaces, enumerated only after the sixth round: prose · binding rules · milestone table · membership · execution sequence · blocked/lifecycle table · proposed-scope table · running index · open-question index · two diagrams · **the objective's completion-criteria table**.

That last one is the reason this matters beyond tidiness. Clause C3 (non-stranding) still gated on an issue that explicitly excludes recovery, so a coordinator could mark the objective satisfied and **wrap the epic with the mechanism unbuilt** — the exact failure the finding two rounds earlier had been filed to prevent.

**Two sub-shapes recur inside the class:**
- **A deferral rendered as a dependency** (3 instances). An accepted deferral and "blocked by X" are identical in a dependency column and mean opposite things: one starts when X lands, the other doesn't start at all.
- **A gate added to a rule but not to the index that governs it** (2 instances).

**Competing explanation, tested and rejected.** The doc also mirrors mutable external state (Linear issue status, PR status), which goes stale on its own. Real, but 4 of 15 — internal restatement drift beats it 10:4, and `epic-lifecycle` already tells the coordinator to refresh the index from PR handles each wake. That mechanism exists; it didn't fire because the edits were hand-made outside a wake.

### Same shape as cycle 1, different surface

Cycle 1's dominant class was *"an invariant guarded at one of its writers; the reviewer enumerated the rest."* Cycle 2's is *"a fact corrected at one of its restatements; the reviewer enumerated the rest."*

Cycle 1's fix was tenet 5's convergence clause — and that clause **already predicts this failure**, ending *"you're patching call sites, and review will keep finding more of them."* It didn't fire because it is phrased in code nouns (invariant, writers, guard, producers) and the surface here was a document. An agent can hold the discipline, write notes about the pattern, and still commit fresh instances of it, because it doesn't recognise a table as a writer.

### Upstream fixes landed this cycle

| # | Fix | Altitude | Targets |
|---|---|---|---|
| A | Tenet 5's convergence clause widened to cover what you *write down*, not only what executes (`docs/philosophy.md`) | philosophy | the dominant class, all 15 |
| B | `epic-lifecycle` fold step re-derives every restating surface from a changed decision, and names the two regressing sub-shapes | skill, fold-time | the same class, structurally, before review sees it |

### Dropped

- **"Verify a constraint you relocate to a new axis."** The session's most severe defect — a fix moved a constraint from reachability to scope and created silent cross-session task corruption. **One instance.** Severity is not recurrence; the gate is recurrence. Watch it.
- **"External state mirrored in prose goes stale."** 4 instances, but `epic-lifecycle` already owns the refresh. A mechanism that exists and wasn't used is not a guidance gap.
- **A consistency-check script / collapsing the tables to one canonical source.** The original hypothesis. Rejected on cost: the tables serve genuinely different readers (sequence, membership, blockers, criteria) and deriving them mechanically is a larger build than the class justifies. Revisit if fix B doesn't move the number.

### Claim to test next cycle

Stale-restatement findings fall as a share of epic-PR review, and no epic-spec commit whose subject is "propagate correction X" leaves knock-ons behind. Cycle 1's claim (`missed-edge-case` breadth, spec rounds from 12) is still open — this cycle produced no implementation PRs to measure it against.
