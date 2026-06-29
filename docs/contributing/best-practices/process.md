# Best Practices — Process & Docs

Situational BPs for execution process, change tracking, and documentation
upkeep. Load this file when scoping a change or touching READMEs.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-002: Spec-driven execution

- Status: Active
- Date: 2026-02-15 (updated 2026-06-28: spec-driven)
- Scope: Process — scoping and tracking a change.
- Rule:
  - Every implementation change maps to a spec linked to its Linear issue.
  - Each spec carries explicit deliverables and verification steps.
- Why: Ties every change to a reviewable unit of intent with its own acceptance criteria, so execution stays accountable to a tracked requirement.

### BP-004: Public boundary first

- Status: Active
- Date: 2026-02-15
- Scope: Process — package/architecture sequencing.
- Rule:
  - Prioritize package boundaries and contracts before runtime implementation details.
  - Lock import/export shape before behavior depth.
- Why: Settling the public surface early reduces cross-package churn and rework later.

### BP-005: Dual changelog requirement

- Status: Superseded (2026-05-19) by [BP-022: Release notes via Changesets](../best-practices.md#bp-022-release-notes-via-changesets)
- Date: 2026-02-15
- Scope: Process — release notes (historical).
- Rule (historical): a pre-Changesets requirement to keep per-milestone changelog artifacts plus a root `changelog.md`. Fully superseded by BP-022 (Changesets); retained only as a numbered placeholder.

### BP-006: Keep planning/tracking labels out of code and tests

- Status: Active
- Date: 2026-02-16 (updated 2026-06-28: generalized to all tracking labels)
- Scope: Code & test hygiene.
- Rule:
  - Keep planning/tracking labels — spec IDs, Linear refs, milestone names — in planning and documentation artifacts only.
  - Do not reference them in runtime code, package code comments, or test assertions/titles.
- Why: Tracking labels rot in code and couple runtime artifacts to transient planning state.

### BP-008: Keep README onboarding-first and current

- Status: Active
- Date: 2026-02-16
- Scope: Docs — root README.
- Rule:
  - `README.md` is the first-stop onboarding document: project purpose, objectives, key concepts, setup, package responsibilities, and core commands.
  - Process-specific collaboration protocol lives in `AGENTS.md`, not `README.md`.
  - Update `README.md` in the same change set when onboarding-relevant facts change (new package/app, package responsibility changes, setup/command changes, or major architecture concept shifts).
- Why: The README is the first thing a new developer reads; stale onboarding misleads from minute one.

### BP-009: Maintain package-level READMEs for public packages

- Status: Active
- Date: 2026-02-16
- Scope: Docs — package READMEs.
- Rule:
  - Maintain `README.md` in each public package directory (`packages/*`): purpose, current public API surface, basic usage, and package-local verification commands.
  - Update a package README in the same change set when that package's exported surface, runtime behavior, or setup scripts materially change.
- Why: Docs next to the code that owns each contract reduce integration friction and drift.

### BP-037: Author specs as versioned docs, reviewed as a PR, synced with Linear

- Status: Active
- Date: 2026-06-29
- Scope: Process — spec authoring (`fsd:create-spec`).
- Rule:
  - Write each spec to `docs/specs/<ISSUE-ID>.md` and open a spec PR for it (separate from the implementation PR) so the project's automated reviewers critique the design before any code is written.
  - The repo spec and the Linear spec document are the same content — keep them in sync; any edit to one mirrors to the other in the same change.
  - On spec-PR review: apply clear, obvious fixes directly (to both copies); for debatable or judgment-call feedback, surface it to the user rather than silently accepting.
- Why: Reviewing the spec before implementation catches design problems when they're cheapest to fix — a doc edit, not a code rewrite.
