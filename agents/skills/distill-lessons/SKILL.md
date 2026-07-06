---
name: fsd:distill-lessons
description: Reflect on a completed, reviewed, or reworked change, extract the transferable lessons (not project trivia), and propose best-practice updates. Use after a PR was reworked or heavily reviewed, after a hard bug, or after a design you reversed — especially to learn from your OWN work being changed. Part of the self-testing-and-improving loop. Gates hard against best-practice bloat; writes to docs/contributing/best-practices.md only after user review.
argument-hint: "<what to reflect on, e.g. 'PR #651' or 'the FIX-788 rework' or 'this session'>"
---

# Distill Lessons

You are turning a finished piece of work into durable, transferable judgment —
the kind that changes how an agent approaches an *unrelated* task next time, and
codifying the worthwhile part as a best practice. This is the reflection half of
the self-improvement loop: tests prove the code works; this proves the *approach*
got better.

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

Assign each survivor a home — and prefer the lightest one that fits:

- **Universal principle** → a new BP in the **Universal Practices** section of
  `best-practices.md`, written at full generality, `Scope: Universal`. Mirror its
  one-liner into the `CLAUDE.md` "Best practices" Universal list (the always-loaded
  surface).
- **Use-case-specific** → a new BP in the matching
  `best-practices/<category>.md` file (process / blocks / generators / resources /
  react / engine — add a new category file only if none fits), with a `Scope:`
  line that *names the situation it applies to*. Add its index row to the
  Situational index in `best-practices.md` **and** the situational list in
  `CLAUDE.md`. Or, for a niche lesson, a note appended to the closest existing BP,
  or an example inside a relevant skill — a niche lesson rarely earns its own BP.
- **Already-covered-but-fuzzy** → an edit that sharpens the existing BP, not a
  new number.
- **Drop / defer** → record it in the PR or a short note, not the BP doc. This is
  the most common outcome and that's correct.

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
  *had* the right discipline (necessity check, compose-don't-build, fix-at-the-
  right-layer) and applied it to the headline but not the glue. Those produce the
  most universal rules, because they're about *consistency of judgment*, not a new
  fact.
