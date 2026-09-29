<!-- Verbatim snapshot. Do not edit, reflow, or fold. -->

# Linear project `content`, as read

**Read** 2026-09-29 from the Linear project
[Framework simplification & cleanup](https://linear.app/fixpoint-labs/project/framework-simplification-and-cleanup-9b341cda1f92)
· field `updatedAt` **2026-08-22T17:53:19.922Z** · **2201 characters**

Everything between the two rules below is the project's `content` field exactly as the API
returned it, before the project-spec was first mirrored over it. What was folded into the
four documents and what was left behind is recorded in the first-build commit and the PR.

The project's separate one-line `description` field is not overwritten by the mirror. It
read, verbatim:

> Editorial + structural simplification of @flow-state-dev driven by the first-principles review and validation passes (docs/internal/review*).

---

Editorial + structural simplification of `@flow-state-dev`, scoped from the first-principles review and validation passes. The framework's identity is reframed as **production-grade with progressive disclosure** — power preserved, intro experience tightened.

## Source documents

Two sets of reports under `docs/internal/`:

* `review/00-team-synthesis.md` — original six-reviewer findings
* `review/01-newcomer-dx.md` … `06-cross-cutting-simplification.md` — per-angle deep dives
* `review-validation/00-validation-synthesis.md` — recalibrated action plan after maintainer pushback
* `review-validation/01-state-scopes-validated.md` … `06-identity-and-progressive-disclosure.md` — per-pushback validations

The validation synthesis supersedes the original synthesis on every contested point. Read it first.

## Scope

19 issues across three tiers:

* **Tier 1 — Cleanup** (1 issue, 1 PR): pure deletes and edits, no API impact.
* **Tier 2 — Editorial** (9 issues): docs reorganization, intro/quick-start/sidebar rewrites, identity statement, project→org sweep. The bulk of the user-visible payoff. Parallelizable.
* **Tier 3 — Refactors** (9 issues): focused refactors that preserve public APIs. Includes the type-level firewall on `BlockDefinition.run`, clientData privacy fix, trace channel separation, and internal library substitutions.

## Sequencing notes

* Tier 1 ships first; small.
* Tier 2 items run in parallel.
* T3.1 (handler discipline) lands before or alongside T3.4 (trace channel).
* T3.2 (`runFlow`) lands early in Tier 3 so subsequent work has a sanctioned programmatic entry point.
* T3.4 wants a design doc before opening the PR — biggest item, multi-package impact.

## Out of scope (deliberately)

* Collapsing the four block kinds.
* Collapsing the four state scopes.
* Removing capabilities, skills, tools, ui, or thought-fabric.
* Cutting the sequencer DSL public surface beyond `validate()` and `background()`.
* "Expose all + hidden list" clientData default (rejected — private-by-default is the chosen direction).

The validation team retracted these from the original review after going to the code. See `review-validation/00-validation-synthesis.md` for the evidence.

---
