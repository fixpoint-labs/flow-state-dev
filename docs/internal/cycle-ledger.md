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

## Cycle 2 — honest task substrate (2026-08)

Epic FIX-980. FIX-995, FIX-948 and FIX-992 merged; FIX-992 shipped as a three-PR
DAG (`a → (b ‖ c)`) after its fourth sub-PR was retired during spec review.

| PR | Kind | Rounds | Feedback classes | Design felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|
| [#1010](https://github.com/fixpoint-labs/flow-state-dev/pull/1010) spec FIX-992 | spec | **8** | missed-edge-case ×4 · design-off ×2 · spec-ambiguity | **yes** — round 4 killed round 3's `pending` reservation ("no owner"; a takeover indistinguishable from a hand-off) | Enumerate writers by a **re-run command**, not a maintained table — the table shipped wrong at 7 rows, then 9, then 10 |
| [#1035](https://github.com/fixpoint-labs/flow-state-dev/pull/1035) FIX-992 `a` | impl | **7** | missed-edge-case ×3 · docs-miss ×2 · over-engineered ×2 | no | A fixture that cannot fail is not coverage — see the class below |
| [#1039](https://github.com/fixpoint-labs/flow-state-dev/pull/1039) FIX-992 `b` | impl | **4** | missed-edge-case ×6 · docs-miss ×2 · nit ×3 | no | Same class; plus `noUnusedLocals` for the mechanical half |
| [#1036](https://github.com/fixpoint-labs/flow-state-dev/pull/1036) FIX-992 `c` | impl | **4** | missed-edge-case ×3 · docs-miss ×4 · over-engineered ×2 | no | Pin the behavioural claim as a test; prose drifts, assertions don't |
| [#1031](https://github.com/fixpoint-labs/flow-state-dev/pull/1031) FIX-948 | impl | 1 | design-off (owner: retry-budget default) | no | Owner set the bound (250 → 50); nothing upstream to fix |

`claims-looped`: **1** · `claims-settled`: **1** · verdicts: CONFIRMED ×1.

The settled claim was the observer-window premise behind a proposed request-record
sweep. The POC **confirmed** the window is the *default* concurrency path plus the CLI
and BullMQ cron — narrower coverage than the spec's table implied, and the fifth time on
that spec that an assumed audit boundary proved narrower than the real caller set. It
retired sub-PR `d` and unblocked two follow-ups. Settled at the second argument, not the
fourth.

### Testing Cycle 1's claims

- **Spec rounds-to-approval: 12 → 8.** One data point, same shape of problem
  (a substrate invariant with many writers). Directionally the claim holds; two cycles
  is not a trend.
- **`missed-edge-case` is still the top class** — 16 of ~40 findings, unchanged as a
  share. Cycle 1's fixes (B: name every writer at spec time; A: tenet 5 convergence
  clause) did not move it. **The reason is now visible and it is not spec breadth:**
  the writers *were* enumerated. What failed was that the enumeration method — a
  hand-maintained table, then a `grep` — could not report its own incompleteness.
- **NUL control bytes recurred a third time**, in `resource-registry.ts:619`, in a file
  three agents edited all cycle. Cycle 1 dropped this as "not a lesson — a gate," tracked
  as **FIX-944**, with the note *"documenting a trap does not prevent it."* Cycle 2
  confirms that verbatim: the trap was documented, in this very ledger, and a bare `grep`
  still silently reported nothing on the file being edited. **FIX-944 is the fix; a third
  recurrence is the argument for doing it.**

### The dominant class this cycle

> "Branch not reached" and "branch reached, behaves as documented" are
> indistinguishable if you only check that the assertion passed.

Eight instances, and **only two are tests** — which is why tenet 7's existing
"a test that can't fail is not a test" did not catch it:

| # | Instrument | How it reported success while skipping its input |
|---|---|---|
| 1 | a spy | narrowed the signature it stood in for; the dropped argument was the one under test |
| 2 | `grep` / `grep -I` | silently skips NUL-bearing files — a clean grep and a skipped one are identical |
| 3 | `tsconfig` `include` | `["src/**/*"]` in `engine` and `store-sqlite`; **nothing** typechecks `test/`, so genuine type errors there go unreported |
| 4 | a race gate | raced the read against two ticks then disarmed unconditionally — a slow read left the route unparked while every downstream assertion still passed |
| 5–8 | four test fixtures | asserted an artifact identical under the bug (stored state where the defect was *which hook fired*; a merged value an existing test already covered) |
| — | a red-check's own revert | `await (async () => {…});` never invokes the body — "failed four tests" while proving only that the code executes |

**Four of the fixtures were caught by their own authors**, mid-round, by asking what the
assertion could see. That is the discipline working; the cases it missed were the ones
where the *instrument*, not the assertion, was the thing that couldn't fail.

### Upstream fixes this cycle

| # | Change | Altitude | Justified by |
|---|---|---|---|
| A | **Tenet 7 generalizes past tests** (`docs/philosophy.md`) — a check that skipped its input is indistinguishable from one that passed; prove the instrument can fail. Plus two corollaries: assert where the defect is observable; pin the claim and prose becomes commentary | philosophy | the dominant class, all eight instances |

One change. Three of the four candidate classes converged on tenet 7, which is the
signal that they were one class seen from different angles rather than four lessons.

### Dropped

- **"Assert at the notification seam"** as a standalone entry. It is the actionable
  half of the class above and now rides tenet 7 as a corollary. A separate BP would
  have split one idea across two homes.
- **Documentation fan-out** as a consolidation rule — deliberately, because the
  evidence argues *against* the obvious fix. Three corrections needed six surfaces
  each, **after** a consolidation intended to prevent exactly that. The conclusion was
  negative: one-source-of-truth is the wrong remedy, since a code comment, an
  architecture reference, a user guide and a changelog have genuinely different
  audiences and collapsing them makes each worse — *a pointer that paraphrases is a
  copy*. The transferable part is that all three corrections were behavioural claims
  no test asserted, which is now tenet 7's second corollary. **A negative result is
  still a result; recording it stops the next cycle re-proposing the consolidation.**
- **`noUnusedLocals`.** Three orphaned imports across the family, all from removed
  code, all mechanically catchable. Not grounding — a repo config change, and not free:
  enabling it fails the build on **25** existing unused named imports across seven
  packages, so it needs a cleanup commit first. Knip does **not** cover this (it checks
  unused *files* and *broken* imports). File as an issue with the cleanup scoped.
- **Test dirs outside the typecheck programs.** Same shape one level up, wider blast
  radius — nothing has ever typechecked those files. Separate issue from the flag.

### Claim to test next cycle

`missed-edge-case` falls as a share of findings **because the instruments got
falsifiable**, not because specs got broader — Cycle 1's breadth fixes did not move it
and Cycle 2 explains why. If it stays flat again, the fix is at the wrong altitude a
second time and tenet 7's generalization is not reaching the loop. Independently:
FIX-944 lands, or NUL recurs a fourth time.
