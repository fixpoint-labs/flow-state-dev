---
name: distill-lessons
description: The self-improvement engine. Runs periodically to measure the development loop itself — an auto-derived cycle-ledger of review rounds + feedback classes from GitHub/Linear — and push the SMALLEST upstream fix that kills a recurring rework class (sharpen a tenet, sharpen an existing BP, or add a skill checklist line). Also runs per-PR to reflect on a reworked/reviewed change and extract the transferable lesson. Gates hard against best-practice bloat; writes to docs/philosophy.md or best-practices.md only after user review.
argument-hint: "<what to reflect on, e.g. 'PR #651' or 'the FIX-788 rework' or 'this session'>"
---

# Distill Lessons

You are turning a finished piece of work into durable, transferable judgment —
the kind that changes how an agent approaches an *unrelated* task next time, and
codifying the worthwhile part as a best practice. This is the reflection half of
the self-improvement loop: tests prove the code works; this proves the *approach*
got better.

## Two altitudes: the change, and the loop

- **The change (per PR).** Reflect on one reworked/reviewed change and extract the
  transferable lesson. This is the rest of this doc.
- **The loop (periodic).** Measure the *development loop itself* and improve it where
  it is most expensive. Higher-value, and what keeps the loop compounding instead of
  the BP list bloating. Run this every N cycles or on demand.

### The bias: sharpen the grounding, don't grow a registry

`docs/philosophy.md` now settles the grounding's shape, and it changes this skill's
default output. The lasting layer is the **tenets**; best practices are the *volatile,
few* tier; and **"most situational guidance is worked out per spec — reason from the
tenets plus the handful of established BPs, and name the 1–5 that fit *this* change. You
are not meant to consult, or grow, a large global registry."** So a distilled lesson
almost never becomes a *new* BP. In descending preference, a lesson lands as:

1. a **sharpened tenet** (only for a true philosophy gap — tenet 3 governs the grounding
   too: *"if it grows into a checklist, it has failed"*; sharpening a tenet is as gated as
   adding a BP, not a default),
2. a **sharpened existing BP** so it actually catches the class,
3. **per-spec guidance** — a lesson `issue-spec` reasons to *for this class of
   change*, carried in the spec, not the registry (the common home now),
4. **one checklist line** in a skill so the loop catches the class structurally, or
5. — rarely, and only past the Step-3 gate — a **new BP**.

Steps 4–7 below still describe how to author a BP, but that is the *last-resort branch*.
Reach for it only after 1–4 don't fit. Weigh the doc's detail accordingly: the machinery
is heavy because authoring a shared standard is rare and exacting, not because it's the
expected outcome.

### Measuring the loop — the cycle-ledger (auto-derived)

The loop's dominant cost is **review rework**: spec, implementation, and **epic** PRs that
take many rounds to converge. That cost is the signal — measure it from data you already
produce, don't add ceremony.

- **Auto-derive the ledger** from GitHub + Linear (GitHub MCP `pull_request_read` /
  review + comment endpoints; Linear for issue state history — see CLAUDE.md →
  "Linear access" for the channel). For each recent spec, implementation, **and epic** PR,
  record: **rounds-to-approval** (distinct review passes up to that
  artifact kind's endpoint — see the endpoint table below; *never* assume merge, since
  neither spec nor epic PRs merge), the **feedback classes** present (`design-off` · `missed-edge-case` ·
  `over-engineered` · `spec-ambiguity` · `philosophy-drift` · `docs-miss` ·
  `stale-restatement` · `nit` — the ledger header defines each),
  whether the design was flagged "felt off" (by a reviewer or the challenger), and one
  line: "what upstream change would have prevented this." Append to
  `docs/internal/cycle-ledger.md` (create it if absent; one row per PR).
- **Sample the epic PR, not only its children.** An epic-spec is a coordination artifact
  reviewed on its own PR, and it carries a rework class its child specs don't (cycle 2's
  `stale-restatement`, 11 of 18 findings, was entirely epic-PR review). Collect the epic PR
  itself alongside the children — at epic wrap that means the epic's own PR plus the child
  spec/implementation PRs. A collector that samples only children reports **zero** for a
  class that is alive, which reads as progress and is not.
- **The metric that matters:** rounds-to-approval and `design-off` frequency trending
  **down** across cycles. That downward trend *is* the proof the harness is improving.
  Flat or rising means the upstream fixes aren't landing where the rework actually is.
- **Score direction artifacts against the review bar, not against comment volume.** A
  **direction artifact** is a PR whose job is to settle an approach rather than ship code —
  **spec PRs and epic PRs both**. Each runs on a budget of two rounds, and most of its
  feedback is *expected* to be below the bar — recorded as implementer notes, not folded in
  (see [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review").
  So for **either kind**: count a round only where a round was actually *spent*, class a
  below-the-bar comment as `nit` and **exclude `nit` from the rework signal**, and treat a
  **third round** — which by rule requires a genuine direction-level finding — as the real
  flag. Ten notes on a two-round spec is a healthy review, not rework; reading it as rework
  would produce grounding changes aimed at noise. Implementation PRs keep the ordinary
  scoring.

  This matters most for an epic PR, which stays open for the epic's whole life: without the
  `nit` exclusion and the spent-round rule, its total measures **lifetime activity** rather
  than review rework, and every bot pass and issue-local comment inflates it.
- **Each artifact kind ends its count somewhere different — use the right endpoint.**

  | Kind | `rounds-to-approval` ends at | Why not the obvious one |
  |---|---|---|
  | implementation PR | merge | — |
  | spec PR | its approval | spec PRs are never merged |
  | epic PR | **epic close** (the wrap, when this skill runs anyway) | never merges, *and* its objective gate lands near the **start** while direction feedback continues for the epic's whole life — record the gate as a marker, not the endpoint |

  An epic still in flight is scored as a **partial** and labelled as one (`6 (in flight)`),
  never compared against a closed epic's total; a partial read as a total is how an epic that
  got worse looks like one that improved.
- **Record `claims-settled` — the flip-flop class and whether settling it worked.** A spec
  round spent re-arguing the *same factual claim* is the most expensive review pattern we have,
  and it now has a designated cure: a POC settlement ([`orchestration.md`](../../../docs/contributing/orchestration.md)
  → "Settling a disputed claim"). So the ledger carries, **per direction artifact — spec PR or
  epic PR** (an epic PR loops claims too, and `epic-agent` can request the same settlement):
  `claims-looped` (distinct
  behavioral claims argued in **two or more** rounds), `claims-settled` (how many went to a POC),
  and each verdict (`CONFIRMED` / `REFUTED` / `INCONCLUSIVE`). Two things to read off it, and
  they cut in opposite directions:
  - **Is it working?** `claims-looped` should trend **down** and settlements should be landing
    at round two rather than round four. A `REFUTED` verdict is a *win* — the loop was hiding a
    real design error that argument wasn't finding.
  - **Is it over-firing?** A rising `claims-settled` with mostly `CONFIRMED` verdicts means POCs
    are being spent to re-confirm premises that were never actually in doubt — the trigger has
    slipped from "a loop formed" to "someone asserted something." That's the failure mode to
    flag upstream, and it's why both numbers are recorded and not just the second.
  Repeated `INCONCLUSIVE` is a third signal: the claims being handed to POCs aren't empirical,
  which is a triage problem in `issue-spec` 6.5.1, not a POC problem.

### The unit of improvement — the recurring class, not the incident

Do **not** mint a BP per incident — that is exactly how the BP list bloated. Cluster
the ledger by feedback class, find the **recurring** ones, and for the top class
propose the *single smallest upstream change that stops it recurring*, preferring, in
order:

1. **Sharpen a tenet** in `docs/philosophy.md` — when the class is a philosophy gap
   (often surfaced by `audit-coherence`).
2. **Sharpen an existing BP** so it actually catches the class.
3. **Add one checklist line to a skill** (`issue-spec` / `issue-implement` / a review
   prompt) so the loop catches the class structurally, before review does.
4. **Only then**, rarely, a new BP — and only if it clears the gate below.

Success is measured, not asserted: the class's rate in later ledgers should fall. If
it doesn't, the fix landed at the wrong altitude — move it up or down and try again.
Present the ledger analysis and the proposed upstream fix to the user (the Step 6
review gate applies to loop-level changes too).

## Core principle

**The richest lesson lives in the delta between what you shipped and what
survived.** A change that was reworked, reversed, or heavily reviewed is a
natural experiment: same goal, two solutions, and the second one tells you what
the first got wrong. Run this *on your own reworked work*, not just on others' —
the point is to catch the disciplines you already hold but failed to apply.

**Not every insight is a best practice.** A best-practices doc that captures
everything captures nothing. Most lessons are situational; few are universal.
The gate (Step 3) exists to throw most candidates away.

## When to use

- **Periodically — the loop mode.** To measure the development loop and kill a
  recurring rework class at its source. This is the primary, highest-value use; the
  per-change triggers below feed it.
- A PR was **reworked** — by a reviewer, a maintainer, or a later you. The diff
  between your first cut and what merged is the goldmine.
- A review found a **real bug** (not a style nit), or a design you committed to
  was **reversed**.
- A **hard bug** whose root cause generalizes (a footgun a class of future work
  will hit).
- You notice yourself thinking "I knew better than that" — that's a discipline
  you hold but didn't apply; codify the trigger.

Not for: routine merges with no surprises, or capturing a fact that's already an
existing BP / architecture contract (sharpen the existing entry instead).

## Workflow

### 1. Pick the source and gather the delta

Identify the work (a PR number, a branch/diff range, a session). Then reconstruct
the **delta**, which is where the lesson lives:

- Your **original approach** (what you shipped first).
- The **review comments** (which were real bugs vs. nits?).
- The **rework** — what a reviewer/maintainer/owner *changed or deleted*, and the
  commit messages / changeset prose explaining why.
- The **final state**.

`git log`, `git diff <yours>..<final>`, the PR's review threads, and the
changeset are the inputs. The single most informative artifact is usually
"what got deleted" — deleted code is code that didn't need to exist.

### 2. Extract candidate lessons

Write each candidate as a **transferable pattern**, not a description of this PR.
The test: *"Would this change how an agent approaches an unrelated task?"*

- If the lesson only makes sense with this codebase's nouns, it's probably trivia
  (or at most a narrow, codebase-specific BP).
- If it's about engineering judgment — where a fix belongs, what to build vs.
  compose, a class of bug — it generalizes.

Phrase each as either a **cautionary rule** ("don't X / when you see X, ask Y")
or a **positive pattern** ("prefer X"). Both are valid.

### 3. Gate each candidate (this is where most get cut)

For every candidate, answer four questions. Drop it unless it clears all four:

1. **Generalizable?** Applies beyond this one instance.
2. **Grounded in a real incident?** Has it bitten before, or will it bite a
   *class* of future work? Being able to name the concrete incident is your
   *gate* for adding it — not text you keep. If you can't name one, it's an
   opinion, not a standard.
3. **Not already covered?** Read `docs/contributing/best-practices.md` (universal + index) and the relevant `docs/contributing/best-practices/<category>.md` (BP-001…)
   and the `CLAUDE.md` behavioral guidelines. If an existing BP/guideline says
   it, **don't duplicate** — propose *sharpening the existing entry* instead.
4. **What altitude?** Be honest:
   - **Universal** — every agent, every task, any package (rare).
   - **Use-case-specific** — a domain, a runtime, a situation (e.g. async
     concurrency, a particular subsystem). The common case.

If two or more candidates are facets of one underlying principle, merge them.

### 4. Shape the survivors

Assign each survivor a home — **prefer the lightest one that fits**, in the ladder order
from "The bias" above. Reach down the list only when the one above genuinely doesn't fit:

- **Philosophy gap** → a **sharpened tenet** in `docs/philosophy.md` — only when the class
  is a true grounding gap (often surfaced by `audit-coherence`) and no tenet already
  covers it. Gated like any grounding change; keep the tenet deep, not a checklist.
- **Already-covered-but-fuzzy** → an edit that **sharpens the existing BP** (or tenet), not
  a new number. A near-duplicate weakens both.
- **Situational, worked per spec** → **guidance `issue-spec` reasons to for this class
  of change**, carried in the spec rather than a standing entry. The common home — this is
  the "reason from the tenets per spec, don't grow the registry" path.
- **Structural** → **one checklist line** in a skill (`issue-spec` / `issue-implement` / a
  review prompt) so the loop catches the class before review does.
- **Drop / defer** → record it in the PR or a short note, not the BP doc. This is the most
  common outcome and that's correct.
- **New BP (last resort)** → only when the lesson is a genuinely reusable standard that
  none of the above expresses, and it clears the Step-3 gate. Home it per the
  BP-authoring branch (Steps 5–7): **Universal** → `best-practices.md` Universal section +
  the `CLAUDE.md` mirror; **use-case-specific** → the matching `best-practices/<category>.md`
  + both indexes. If you're reaching here more than rarely, re-read "The bias."

State, for the record, which candidates you dropped and why — the discipline of
cutting is the point.

### 5. Draft in house style

Keep entries **terse**: the rule plus a **one-sentence `Why`** stating its
purpose — when it applies and what it prevents (a few bullets only if genuinely
needed). The `Why` is purpose, not evidence — don't write a proof or incident
dump. Use the template at the bottom of `best-practices.md`:

```
### BP-XXX: <name>
- Status: Active
- Date: YYYY-MM-DD
- Scope: Universal | <the situation it applies to>
- Rule:
  - <imperative, concrete; name the trigger and the action>
- Why: <one sentence: the rule's purpose and when it applies>
```

- **Number sequentially** after the last existing BP. **Append; never overwrite.**
  If you're replacing an older BP, mark the old one `Superseded (date) by …` and
  link forward — don't delete it.
- Ground the rule in a real incident as your *gate* for adding it (Step 3), but
  keep the proof out of the entry — the `Why` is a one-sentence purpose, not the incident.
- Match the voice: terse imperative Rule bullets.

### 6. Review gate (required — do not skip)

Best practices are shared standards. The doc's own update policy: *a practice is
established by user review.* Present to the user, before writing:

- Each proposed BP (rule + why, in full).
- Its altitude call (universal vs. the situation it's scoped to).
- The candidates you **dropped** and why — so the user can pull one back.

Get confirmation. If the user reshapes (merge two, scope one tighter, drop one),
apply it. Only then write.

### 7. Write and land

- Write the approved entries to their home (Universal → `best-practices.md` +
  `CLAUDE.md` mirror; situational → `best-practices/<category>.md` + both indexes,
  per Step 4). Number sequentially after the last existing BP across all files —
  numbers are global IDs.
- If a "shipping" change adopts the BP in the same breath, update it in the same
  change set (BP update policy). A BP-doc-only change is internal — `pnpm
  changeset --empty` or state "no changeset needed" (BP-022).
- If the repo keeps a skills/BP index that references entries by number or name
  (e.g. the `CLAUDE.md` skills table for a new skill), update it so the addition
  is discoverable.
- Land per the repo's branch/PR norms. Process-doc changes are usually a separate,
  small PR — keep them off an unrelated feature PR unless the BP and the code
  adopting it ship together.

## Guidelines

- **Cut aggressively.** If you're proposing more than two or three BPs from one
  change, you're probably over-capturing. The best outcome is often "one sharp
  universal rule, two dropped, one folded into an existing BP."
- **Ground it, but don't prove it.** A real incident behind the rule is your gate
  for adding it — an ungrounded rule rots into ignored boilerplate. But keep the
  written entry terse: the rule, not the proof.
- **Sharpen before you add.** A near-duplicate of an existing BP weakens both.
  Edit the original.
- **The meta-lesson is the highest-value one.** Watch for the pattern where you
  *had* the right discipline — a tenet you already hold: earn every addition (tenet 3),
  compose over features (tenet 2), fix at the owning layer (tenet 5) — and applied it to
  the headline but not the glue. Those are the highest-value catches, because they're
  about *consistency of judgment* against the tenets, not a new fact — and the fix is
  almost always to sharpen how a tenet or skill is applied, not to mint a BP.
