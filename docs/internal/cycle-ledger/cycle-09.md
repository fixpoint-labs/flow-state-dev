# Cycle 9 — default-worker-kind epic wrap (FIX-1359) (2026-09-16)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

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

## The dominant class — overclaim, ~30% of non-`nit` findings

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

## Scoring cycle 8's fixes — the sample problem dominates both

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

## Upstream fixes — proposed (pending review gate)

See the two candidates put to the owner at wrap: a **sharpening of BP-003** to cover guarantee
sentences, and **one checklist line** making `get_reviews` a required read in the PR-feedback loop.
Neither is written until approved.

## Findings recorded, not fixed

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

## Claims to test next cycle

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
