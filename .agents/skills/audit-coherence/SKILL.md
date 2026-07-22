---
name: fsd:audit-coherence
description: Sweep the codebase (or a slice of it) for INCOHERENCE — patterns that conflict with each other, drift from docs/philosophy.md, or disagree where no tenet disambiguates. Distinct from fsd:improve-codebase-architecture (deepening) and fsd:second-look (per-feature retrospective). Produces a ranked findings table that feeds pruning PRs and philosophy/BP refinement. Read-only; proposes, does not edit.
argument-hint: "<optional scope, e.g. a package, a subsystem, or 'streaming'>"
---

You are the coherence auditor. Across PRs, a codebase accretes cruft: two ways to do
the same thing, a pattern that drifted, a doc that no longer matches the code. Each
PR was locally reasonable; the whole lost its shape. **Incoherence is the primary
failure this project guards against** (`docs/philosophy.md`, "the two failures").
This skill hunts it directly.

This is not a bug hunt, not a deepening pass, and not a per-feature retrospective:

- **`fsd:improve-codebase-architecture`** finds *deepening* opportunities (shallow
  modules, capability-shaped wiring). That's "could this be better?"
- **`fsd:second-look`** re-examines *one* feature/PR for overbuild.
- **This skill** asks "do the parts *agree with each other and with what we say we
  believe*?" — coherence, at the codebase scale.

Read-only. You produce findings and proposals; you do not edit code or docs.

## Grounding

Read first: `docs/philosophy.md` (the tenets are your yardstick),
`docs/contributing/architecture-reference.md` (locked contracts), and the
architecture docs for the scope you're auditing. Authority order:
philosophy → `docs/architecture/*` → `docs/contributing/best-practices.md` → `AGENTS.md`.

## The three kinds of incoherence

Hunt all three. They differ in where the fix lands.

1. **Code-level conflict.** Two places solve the same problem differently — two
   patterns for the same job, duplicated helpers, a convention followed here and
   ignored there, a boundary drawn one way in package A and another in B. Fix: pick
   one (the more recent / more tested, per `CLAUDE.md` "surface conflicts"), converge
   the other, delete the loser. **Never average two patterns into a third.**

2. **Philosophy drift.** Code that contradicts a tenet: vendor/domain knowledge on
   the framework's public surface (tenet 4), a feature where composition would do
   (tenet 2), surface that never earned its place (tenet 3), a workaround repeated at
   call sites instead of fixed at the owning layer (tenet 5). Fix: realign the code to
   the tenet, or — if the code is right and the tenet is too blunt — sharpen the tenet.

3. **Philosophy gap.** The code is incoherent *and no tenet or architecture doc
   disambiguates it* — including a doc that disagrees with the code as-built (surface
   it; don't assume either wins). This is the highest-value find: it means the
   grounding itself has a hole. Fix: propose the tenet or contract that would settle
   it, then the code change. (This is the feedback path that makes the philosophy
   improve — route it to `fsd:distill-lessons`.)

## Workflow

1. **Scope.** Take the argument as the audit scope (a package, subsystem, or theme
   like "streaming" / "state"). No argument → propose a scope rather than boiling the
   ocean; a focused audit that finds real conflicts beats a shallow whole-repo pass.
2. **Map the patterns in scope.** For the target area, enumerate the recurring
   shapes: how blocks are composed, how state is modeled, how errors are handled, how
   resources are wired, naming conventions, boundary rules. Use `fsd:zoom-out` shape
   if the area is unfamiliar. Fan out with `Explore` sub-agents for a wide scope.
3. **Find the disagreements.** For each pattern, look for a second place that does it
   differently. For each tenet, look for code that strains it. For each architecture
   doc in scope, spot-check that the code still matches it (a doc/code mismatch is a
   philosophy gap, not an automatic doc-wins).
4. **Classify and rank each finding** by the three kinds above, and by blast radius
   (how many callers / how load-bearing the pattern). A conflict in a core primitive
   outranks one in a leaf.
5. **Verify before reporting.** Read the actual code for each finding — don't report
   a conflict you inferred from names. A finding that turns out coherent on inspection
   is dropped, not softened.

## Report

A ranked findings table, most-consequential first. For each:

- **Where** — file(s):line, and the pattern/tenet/doc in tension.
- **Kind** — code-conflict / philosophy-drift / philosophy-gap.
- **The incoherence** — what disagrees with what, concretely.
- **Proposed resolution** — converge to which shape, what to delete, or (for a gap)
  which tenet/contract to add or sharpen. Bias to subtract (tenet 3) and to refine an
  existing primitive over adding one (tenet 2). Never propose averaging.
- **Where the fix routes** — a pruning/refactor PR, or `fsd:distill-lessons` (for a
  philosophy gap → grounding change), or `fsd:improve-codebase-architecture` (if the
  clean fix is actually a deepening).

End with a one-line **coherence read** of the scope: is it broadly coherent with a
few local conflicts, or is there systemic drift that warrants a dedicated cleanup
sequence? Don't inflate — if the scope is coherent, say so. A finding you can't tie
to a concrete conflict is noise; drop it.

## Guardrails

- **Read-only.** Propose; don't edit. The user (or a follow-up PR) acts on the report.
- **Don't relitigate deliberate decisions.** Check `docs/internal/out-of-scope/`
  before flagging a "conflict" that was a conscious call.
- **Surface, don't average** — the cardinal rule. Every resolution picks a shape or
  proposes a tenet; none blends.
