# flow-state-dev implementation repo

This repository is the clean implementation workspace for Phase 1.

## Planning docs

- Wave plans: `docs/waves/`
- Best practices: `docs/BEST_PRACTICES.md`
- Compressed architecture cheat sheet: `docs/ARCHITECTURE_CHEAT_SHEET.compact.md`
- Main changelog summary: `changelog.md`

## Wave planning rules

- Every execution wave must have a `docs/waves/wave-1/wave-1.<letter>.md` file.
- Each wave file must include:
  - objective and scope
  - explicit task list with file targets
  - deliverables with verification method
  - pass/fail gate checklist
- Each completed wave must update:
  - wave-local artifacts (`docs/waves/wave-1/wave-1.<letter>-journal.md`, `docs/waves/wave-1/wave-1.<letter>-changelog.md`)
  - root summary changelog (`changelog.md`)
- Waves can depend only on the prior phase-1 wave increment (for example: Wave 1.b depends on Wave 1.a), but should not assume undocumented context.
- If canonical docs conflict, `preperation/architecture/*` is authoritative over planning drafts.

## Best-practice update rule

When a new coding best practice is decided during review, update `docs/BEST_PRACTICES.md` in the same change set as the code/doc updates that adopt it.
