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
  - Each wave must maintain wave-local artifacts (`wave-<letter>-journal.md`, `wave-<letter>-changelog.md`).
  - Each wave must also add a concise summary entry to root `changelog.md`.
- Why:
  - Wave-local docs preserve detail; root changelog preserves project-level continuity.

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
