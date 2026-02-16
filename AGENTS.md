# Agent Instructions (Implementation Repo)

These instructions define the collaboration protocol for agent-driven work in this repository.

## Startup reads

At the start of a new conversation in this repo, read:

- `docs/BEST_PRACTICES.md`
- `docs/ARCHITECTURE_CHEAT_SHEET.compact.md`
- Relevant canonical specs in `../preperation/architecture/` for the task at hand

If docs conflict, `../preperation/architecture/*` is authoritative.

## Wave execution protocol

Use this protocol when work is wave-based:

- Waves have numbers and letters. Numbers represent the phase of wave we are in, letters indicate the major milestone. Our `..preperation/architecture/IMPLEMENTATION_PLAN.md` tracks the waves we are targeting.
- Keep wave plans under their wave number, currently at `docs/waves/wave-1/` using `wave-1.<letter>.md`.
- Each wave file must include objective, scope, task breakdown, deliverables, and verification gates.
- Completed wave work must update:
  - `docs/waves/wave-1/wave-1.<letter>-journal.md`
  - `docs/waves/wave-1/wave-1.<letter>-changelog.md`
  - `changelog.md` (concise project-level summary)

## Implementation guardrails

- Do not reference wave labels in runtime code or tests.
- Keep exported API surfaces documented with concise, high-signal comments.
- Preserve canonical package boundaries (`core`, `server`, `client`, `react`, `testing`, `cli`).

## Documentation maintenance

- Update `docs/BEST_PRACTICES.md` when a new implementation standard is adopted.
- Update `README.md` when onboarding-relevant facts change (setup, package roles, key concepts, workflow entry points).
- Update `packages/*/README.md` when a package's exported surface, behavior, or package-local setup commands materially change.
