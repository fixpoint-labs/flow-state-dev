# Best Practices — Process & Docs

Situational BPs for execution process, wave artifacts, and documentation upkeep.
Load this file when planning work, closing out a wave, or touching READMEs.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-002: Wave-driven execution

- Status: Active
- Date: 2026-02-15
- Scope: Process — wave planning and execution.
- Rule:
  - Every implementation change must map to a wave task.
  - Each wave requires explicit deliverables and verification commands.

### BP-004: Public boundary first

- Status: Active
- Date: 2026-02-15
- Scope: Process — package/architecture sequencing.
- Rule:
  - Prioritize package boundaries and contracts before runtime implementation details.
  - Early waves should lock import/export shape before behavior depth.

### BP-005: Dual changelog requirement

- Status: Superseded (2026-05-19) by [BP-022: Release notes via Changesets](../best-practices.md#bp-022-release-notes-via-changesets)
- Date: 2026-02-15
- Scope: Process — release notes (historical).
- Rule (historical):
  - Each wave must maintain wave-local artifacts (`docs/waves/wave-1/wave-1.<letter>-journal.md`, `docs/waves/wave-1/wave-1.<letter>-changelog.md`).
  - Each wave must also add a concise summary entry to root `changelog.md`.
- Successor: BP-022 replaces the root-changelog half of this rule (the `changelog.md` entry). Wave-local journal and changelog artifacts remain required per AGENTS.md and `wave-process.md`.

### BP-006: Keep wave labels out of code and tests

- Status: Active
- Date: 2026-02-16
- Scope: Code & test hygiene.
- Rule:
  - Use wave identifiers in planning and documentation artifacts only.
  - Do not reference wave labels (for example `wave 1.x`) in runtime code, package code comments, or test assertions/titles.

### BP-008: Keep README onboarding-first and current

- Status: Active
- Date: 2026-02-16
- Scope: Docs — root README.
- Rule:
  - `README.md` is the first-stop onboarding document: project purpose, objectives, key concepts, setup, package responsibilities, and core commands.
  - Process-specific collaboration protocol (e.g. wave execution rules) lives in `AGENTS.md`, not `README.md`.
  - Update `README.md` in the same change set when onboarding-relevant facts change (new package/app, package responsibility changes, setup/command changes, or major architecture concept shifts).

### BP-009: Maintain package-level READMEs for public packages

- Status: Active
- Date: 2026-02-16
- Scope: Docs — package READMEs.
- Rule:
  - Maintain `README.md` in each public package directory (`packages/*`): purpose, current public API surface, basic usage, and package-local verification commands.
  - Update a package README in the same change set when that package's exported surface, runtime behavior, or setup scripts materially change.
