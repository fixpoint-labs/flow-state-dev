# Best Practices (Living)

Purpose:

- Capture implementation standards decided during planning/review.
- Keep decisions cumulative so future waves and agents follow the same bar.

Update policy:

- When user review establishes a new best practice, update this file in the same change set as the code/docs adopting it.
- Do not overwrite prior practices; append a new entry with status/date.
- If a practice is superseded, mark the old one `Superseded` and link the replacement entry.

---

## Active Practices

### BP-001: Canonical authority precedence

- Status: Active
- Date: 2026-02-15
- Rule:
  - If docs conflict, `preperation/architecture/*` is authoritative.
  - Planning docs and wave docs must reference canonical architecture sources.
- Why:
  - Prevents drift between wave execution and architecture contracts.

### BP-002: Wave-driven execution

- Status: Active
- Date: 2026-02-15
- Rule:
  - Every implementation change must map to a wave task.
  - Each wave requires explicit deliverables and verification commands.
- Why:
  - Enables autonomous run-to-completion execution with predictable verification.

### BP-003: Verification evidence is mandatory

- Status: Active
- Date: 2026-02-15
- Rule:
  - Every claimed deliverable must have an evidence path and pass criteria.
  - Wave close-out requires a journal and changelog under `docs/waves/`.
- Why:
  - Eliminates ambiguous “done” states.

### BP-004: Public boundary first

- Status: Active
- Date: 2026-02-15
- Rule:
  - Prioritize package boundaries and contracts before runtime implementation details.
  - Early waves should lock import/export shape before behavior depth.
- Why:
  - Reduces rework and cross-package breakage in later waves.

### BP-005: Dual changelog requirement

- Status: Active
- Date: 2026-02-15
- Rule:
  - Each wave must maintain wave-local artifacts (`docs/waves/wave-1/wave-1.<letter>-journal.md`, `docs/waves/wave-1/wave-1.<letter>-changelog.md`).
  - Each wave must also add a concise summary entry to root `changelog.md`.
- Why:
  - Wave-local docs preserve detail; root changelog preserves project-level continuity.

### BP-006: Keep wave labels out of code and tests

- Status: Active
- Date: 2026-02-16
- Rule:
  - Use wave identifiers in planning and documentation artifacts only.
  - Do not reference wave labels (for example `wave 1.x`) in runtime code, package code comments, or test assertions/titles.
- Why:
  - Keeps implementation surfaces domain-focused and avoids coupling runtime artifacts to temporary execution planning labels.

### BP-007: Concise API and file-level documentation

- Status: Active
- Date: 2026-02-16
- Rule:
  - Add a concise file header comment to implementation files that explains the file's role in the runtime.
  - Document 100% of exported methods/functions/classes with concise doc comments focused on contract and behavior.
  - Document important internal helpers when they carry non-obvious control flow, state transitions, or error semantics.
  - Keep comments high-signal and short; avoid restating obvious syntax.
- Why:
  - Improves onboarding speed and reduces misunderstanding as runtime orchestration complexity grows.

---

## Template For New Entries

```md
### BP-XXX: <Name>

- Status: Active | Superseded
- Date: YYYY-MM-DD
- Rule:
  - ...
- Why:
  - ...
- Superseded by: BP-YYY (optional)
```
