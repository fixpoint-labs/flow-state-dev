---
name: fsd:cross-spec-review
context: fork
agent: general-purpose
description: Review a SET of specs against each other for mutual coherence — the coherence lens (fsd:audit-coherence) raised from one change to a batch of specs a fleet produced in parallel. Catches inter-spec conflicts before any of them is implemented: overlapping or duplicated scope, contradictory decisions, colliding API/naming surface, one spec assuming what another removes, and cross-issue dependency or PR-plan collisions. Read-only — returns a ranked conflict report to the caller (the fleet), which walks the user through the decisions and routes the alignment. Runs ONLY on specs the user has already approved as individually good, so it never aligns a good spec to an unvalidated one.
argument-hint: "<the spec set — issue IDs or spec PR#s, e.g. FIX-1 FIX-2 FIX-3>"
---

# Cross-Spec Review

A fleet running several issues in parallel produces several specs at once. Each spec is
authored in isolation and reviewed on its own merits — so each can be locally excellent
while the *set* is incoherent: two specs claim the same surface, one decides a shape a
sibling contradicts, one assumes behavior another spec is removing. That mutual
incoherence is invisible to per-spec review, and it is the single failure this project
guards against (`docs/philosophy.md`, "the two failures"; tenet 1). This skill is the
coherence lens (`fsd:audit-coherence`) pointed at a *batch of specs* instead of the code.

**Output is a report only.** No edits, no PR comments, no Linear changes. The caller —
normally `fsd:issue-fleet` — owns the user walkthrough and the alignment; this skill just
finds the conflicts and hands them back.

> **When an epic-spec already coordinates the set** (see `fsd:issue-fleet` → "Epic
> coordination"), coherence is mostly built in *up front* — the issue specs aligned to a
> shared direction as they were written. There, this skill's job narrows to a **conformance
> check**: did the specs actually stay true to the epic and to each other? Reach for the
> full batch sweep when there's no epic; use it as the lighter conformance pass when there is.

## The gate — run only on validated specs

**Do not run this until the user has approved the specs in the set as individually good.**
Aligning specs to each other only helps if each is already sound; cross-aligning to a spec
that's still wrong propagates the flaw into its siblings. So the precondition is:

- Every spec in the set has cleared its own spec-approval gate (Part I + Part II present
  and signed off — see `fsd:create-spec`), **and**
- The user has explicitly approved running the cross-spec pass.

The fleet enforces this gate (it invokes this skill; see `fsd:issue-fleet` → "Cross-spec
coherence"). If invoked standalone, confirm both conditions before reading anything.

## What you're given

The **spec set** — a list of issue IDs / spec PR#s. For each, read the current spec text
(the spec PR head copy while the PR is open, else the Linear document — same reconciliation
rule as `fsd:implement-issue` Step 1). Read the whole spec, both parts: Part I carries the
scope and decisions; Part II carries the API surface, sequence, and PR plan where most
collisions live.

## What to look for (across the set, not within one)

Sweep every pair (and, where relevant, the whole set) for:

- **Overlapping / duplicated scope.** Two specs solving the same problem, or each building
  half of one thing without knowing about the other. One should absorb the other, or they
  should split on a clean seam (tenet 2 — composition, not duplication).
- **Contradictory decisions.** A numbered Decision in one spec that a sibling's Decision
  reverses or undercuts (different store, different boundary, different default for the
  same surface).
- **Colliding API / naming surface.** Two specs adding the same export, capability, item
  type, route, or vocabulary term — or the *same* concept under two different names
  (divergent naming is incoherence even when nothing literally collides).
- **Assumption conflicts.** One spec relies on behavior, a field, or a shape that another
  spec in the set removes, renames, or changes. The classic parallel-work break.
- **Cross-issue dependency / sequencing conflicts.** Spec A's plan assumes Spec B lands
  first while B assumes the reverse; or two PR plans (Part II §8) target the same files in
  a way that will collide on merge regardless of issue-level independence.
- **Philosophy drift as a set.** The batch, taken together, pulls the framework in two
  directions at once, or several specs each add a near-duplicate primitive that should be
  one. Name it — this is the coherence auditor's core job at batch altitude.

Reuse `fsd:audit-coherence`'s judgment for *what counts as* incoherence; the only
difference here is the unit is a set of specs, not a code slice. Where the docs
(`docs/philosophy.md` → architecture → best-practices) settle which of two conflicting
choices is right, say which wins and why; where nothing disambiguates, flag it as a
decision the user must make (that's a philosophy gap, not yours to resolve).

## Report (compact — the fleet holds this, not the spec texts)

Return a ranked table, worst mutual-incoherence first. For each conflict:

```
conflict: <one line — what disagrees>
specs:    <ISSUE-A> ↔ <ISSUE-B> (↔ <ISSUE-C> …)
kind:     scope-overlap | decision-conflict | surface-collision | assumption-conflict | dependency-conflict | drift
where:    <the section/decision/API in each spec that collides>
recommend: <the resolution, and which spec(s) should change to land it>
decision-needed?: NO (docs settle it — <which doc>) | YES (<the call the user must make, with options>)
```

End with a one-line verdict: **COHERENT** (no changes needed) or **N conflicts — M need a
user decision**. Keep the whole report to a screen; if it would run longer, you're pulling
in spec detail that belongs in the specs, not here — tighten to the conflicts.

## Boundaries

- **Read-only.** You do not edit specs, comment on PRs, or touch Linear. You surface
  conflicts and recommend resolutions; the fleet applies them (dispatching a spec worker to
  update a spec directly, or leaving a PR comment on the spec PR to be picked up in its
  review rounds) after the user decides.
- **Mutual coherence only.** Whether any single spec is *good* is that spec's own review
  (`fsd:create-spec` review, `fsd:review`). You assume each is already validated — you check
  only whether they agree with each other.
- **Not a merge gate.** Your report feeds decisions; the stop-before-implement gate on each
  issue still belongs to the fleet.
