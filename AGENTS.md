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

## Code style rules for examples

1. **Trust the type system.** If you declared an `inputSchema` on a block, the input is typed.
   Do not re-validate, re-parse, or defensively check typed values. If types are wrong, fix
   the types in `packages/core`.

2. **No wrapper functions for simple property access.** `input.message` does not need a
   `readMessage(input)` helper. `ctx.session.state.mode` does not need a
   `parseModeFromScope(ctx)` wrapper.

3. **No invented APIs.** Before calling a method, verify it exists in the package source.
   `ctx.session.appendJournal()` and `ctx.session.messages.ui()` do not exist. If you
   need functionality that doesn't exist, flag it as a gap — do not pretend it exists.

4. **No internal API access.** Never reach into `block.config.execute`. Never construct
   `ToolBinding` objects manually. Use the public API surface.

5. **No identity handlers.** A handler that returns its input unchanged exists only to satisfy
   a type requirement. Find a better composition, or remove the step.

6. **Schemas belong with their blocks.** Define `inputSchema` and `outputSchema` in the same
   file as the block that uses them. Flow-level schemas (state, resources, projections) belong
   in the flow file. If a schema is shared, reference it from the block file that originally
   defines it.

7. **React components are JSX, not function calls.** Use `<ItemsRenderer items={...} />`
   not `ItemsRenderer({ items: ... })`.

8. **Examples must be realistic.** Every block, every sequencer step, every tool should do
   something a real application would need. If a feature doesn't fit the example's use case,
   don't force it. Leave it for the example where it fits naturally.

## Documentation maintenance

- Update `docs/BEST_PRACTICES.md` when a new implementation standard is adopted.
- Update `README.md` when onboarding-relevant facts change (setup, package roles, key concepts, workflow entry points).
- Update `packages/*/README.md` when a package's exported surface, behavior, or package-local setup commands materially change.
