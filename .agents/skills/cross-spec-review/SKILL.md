---
name: cross-spec-review
context: fork
agent: general-purpose
description: Review a SET of specs against each other for mutual coherence — the coherence lens (audit-coherence) raised from one change to the set of specs an epic produced in parallel. Catches inter-spec conflicts before any of them is implemented: overlapping or duplicated scope, contradictory decisions, colliding API/naming surface, one spec assuming what another removes, and cross-issue dependency or PR-plan collisions. Read-only — returns a ranked conflict report to the caller (normally epic-lifecycle), which walks the user through the decisions and routes the alignment. Runs ONLY on specs the user has already approved as individually good, so it never aligns a good spec to an unvalidated one.
argument-hint: "<the spec set — issue IDs or spec PR#s, e.g. FIX-1 FIX-2 FIX-3>"
---

# Cross-Spec Review

An epic running several issues in parallel produces several specs at once. Each spec is
authored in isolation and reviewed on its own merits — so each can be locally excellent
while the *set* is incoherent: two specs claim the same surface, one decides a shape a
sibling contradicts, one assumes behavior another spec is removing. That mutual
incoherence is invisible to per-spec review, and it is the single failure this project
guards against (`docs/philosophy.md`, "the two failures"; tenet 1). This skill is the
coherence lens (`audit-coherence`) pointed at a *batch of specs* instead of the code.

**Output is a report only.** No edits, no PR comments, no Linear changes. The caller —
normally `epic-lifecycle` — owns the user walkthrough and the alignment; this skill just
finds the conflicts and hands them back.

> **When an epic-spec already coordinates the set** (see
> [`docs/contributing/orchestration.md`](../../../docs/contributing/orchestration.md)),
> coherence is mostly built in *up front*, so this skill narrows to a **conformance check**
> with a reduced procedure:
> 1. **Read the current epic-spec first** — from the same source order `issue-spec`
>    uses: the `epic/<name>` branch head while the epic PR is open (else the Epic issue's
>    attached Linear document), plus the epic PR thread. The epic-agent may have folded in
>    feedback the issue specs haven't picked up yet; skip this and you can report "clean"
>    while the specs have drifted from the latest epic direction.
> 2. Check each issue spec **adheres** to the epic's objective, themes, and decisions.
> 3. Flag **residual inter-spec conflicts** the epic didn't settle.
>
> This is the **normal path** — a parallel spec set comes from an `epic-lifecycle` run, and
> that always has an epic. Reach for the full batch sweep (below) only in the standalone case
> where a set of specs genuinely has no epic above it.

## The gate — run only on validated specs

**Do not run this until the user has approved the specs in the set as individually good.**
Aligning specs to each other only helps if each is already sound; cross-aligning to a spec
that's still wrong propagates the flaw into its siblings. So the precondition is:

- Every spec in the set has cleared its own spec-approval gate (Part I + Part II present
  and signed off — see `issue-spec`), **and**
- The user has explicitly approved running the cross-spec pass.

The coordinator enforces this gate (it invokes this skill; see `epic-lifecycle` → "Cross-spec
coherence"). If invoked standalone, confirm both conditions before reading anything.

## What you're given

The **spec set** — a list of issue IDs / spec PR#s. For each, read the current spec text
(the spec PR head copy while the PR is open, else the Linear document — same reconciliation
rule as `issue-implement` Step 1). Read the whole spec, both parts: Part I carries the
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

Reuse `audit-coherence`'s judgment for *what counts as* incoherence; the only
difference here is the unit is a set of specs, not a code slice. Where the docs
(`docs/philosophy.md` → architecture → best-practices) settle which of two conflicting
choices is right, say which wins and why; where nothing disambiguates, flag it as a
decision the user must make (that's a philosophy gap, not yours to resolve).

## Flagging a hard conflict for Fable adjudication (proposal only)

Most conflicts you adjudicate yourself, or they're `decision-needed` calls the user makes
directly. A few are *genuinely hard*: high blast radius (the resolution reshapes surface
across several specs), both resolutions defensible on the tenets, costly to reverse. For
**at most the one or two hardest**, you may **flag a Fable-adjudication candidate** — you
do **not** invoke Fable yourself. You're read-only and can't prompt, and Fable is a paid
escalation that requires the user's approval, which only the coordinator can obtain (see
`AGENTS.md` → model tiering, upward escalation).

- Mark the conflict `fable-candidate: YES` and include the **self-contained slice**: the
  conflicting spec excerpts, the exact decision, and the tenets in tension — so the coordinator
  can hand it to Fable (on approval) without re-deriving it.
- If you can't reduce it to a slice, it isn't a candidate — leave it as an ordinary
  `decision-needed` conflict. That inability is the structural guard; the human-approval
  gate at the coordinator is the cost guard.

## Flagging a POC settlement (also a proposal — but a cheap one)

Some conflicts aren't a judgment call at all: they're a **disagreement about how the system
behaves**. The classic is the assumption conflict — spec A relies on ordering being preserved
where spec B asserts it isn't; one of them is simply wrong about the code, and no amount of
cross-reading tells you which. Don't adjudicate those from the spec texts, and don't hand the
user a decision that a five-minute run answers.

- **Read the code before you flag one.** Two specs disagreeing is already two assertions, but
  the cheap resolution is usually a file: check the implementation, its tests, and
  `docs/architecture/*` first. If the code settles it, say which spec is wrong and cite the
  code — that's an ordinary recommendation, not a POC. Flag `poc-candidate` only when the
  disagreement **survives** that read.
- Mark the conflict **`poc-candidate: YES`** with the **claim slice** — `claim` (as "X does /
  does not Y"), `load` (what in each spec depends on it), `falsify` (the observation that would
  disprove it). The coordinator dispatches a `poc-agent`; the verdict resolves the conflict
  factually and both specs align to it.
- **Unlike `fable-candidate`, this needs no user approval** — a throwaway POC is cheap and
  blocks nothing, where Fable is a paid escalation. That makes it cheap to fire, not free:
  expect **zero or one** per review, and only where reading the code left the question open.
- **A conflict is `fable-candidate` OR `poc-candidate`, never both.** Fable adjudicates when
  both resolutions are *defensible on the tenets* — a values question. A POC settles when one
  side is *factually wrong* — a reality question. If you can't tell which you're looking at,
  ask whether a run could change anyone's mind: if yes it's a POC, if no it's a decision.
- The same rule as always: if you can't reduce it to a slice, it isn't a candidate — leave it
  as an ordinary `decision-needed` conflict.

## Report (compact — the coordinator holds this, not the spec texts)

Return a ranked table, worst mutual-incoherence first. For each conflict:

```
conflict: <one line — what disagrees>
specs:    <ISSUE-A> ↔ <ISSUE-B> (↔ <ISSUE-C> …)
kind:     scope-overlap | decision-conflict | surface-collision | assumption-conflict | dependency-conflict | drift
where:    <the section/decision/API in each spec that collides>
recommend: <the resolution, and which spec(s) should change to land it>
decision-needed?: NO (docs settle it — <which doc>) | YES (<the call the user must make, with options>)
poc-candidate: NO | YES (claim: <X does/does not Y> · load: <what depends on it in each spec> · falsify: <what would disprove it>)
fable-candidate: NO | YES (<the self-contained slice — excerpts, the decision, tenets in tension>)
```

End with a one-line verdict: **COHERENT** (no changes needed) or **N conflicts — M need a
user decision, K are empirical (POC)**. Keep the whole report to a screen; if it would run longer, you're pulling
in spec detail that belongs in the specs, not here — tighten to the conflicts.

## Boundaries

- **Read-only.** You do not edit specs, comment on PRs, or touch Linear. You surface
  conflicts and recommend resolutions; the coordinator applies them (dispatching a spec worker to
  update a spec directly, or leaving a PR comment on the spec PR to be picked up in its
  review rounds) after the user decides.
- **Mutual coherence only.** Whether any single spec is *good* is that spec's own review
  (`issue-spec` review, `review`). You assume each is already validated — you check
  only whether they agree with each other.
- **Not a merge gate.** Your report feeds decisions; the stop-before-implement gate on each
  issue still belongs to the coordinator.
