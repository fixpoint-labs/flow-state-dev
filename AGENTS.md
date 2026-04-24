# Agent Instructions (Implementation Repo)

These instructions define the collaboration protocol for agent-driven work in this repository.

## Startup reads

At the start of a new conversation in this repo, read:

- `CLAUDE.md` — project orientation and key constraints
- `docs/contributing/best-practices.md` — implementation standards (BP-001–BP-009)
- `docs/contributing/architecture-reference.md` — quick reference for locked contracts
- Relevant docs in `docs/architecture/` for the task at hand

For deeper canonical authority on edge cases, consult `../preperation/architecture/*`.

**Authority order**: `../preperation/architecture/*` > `docs/architecture/*` > `docs/contributing/best-practices.md` > this file.

## Wave execution protocol

Use this protocol when work is wave-based:

- Waves have numbers and letters. Numbers represent the phase of wave we are in, letters indicate the major milestone. Our `..preperation/architecture/IMPLEMENTATION_PLAN.md` tracks the waves we are targeting.
- Keep wave plans under their wave number, currently at `docs/internal/waves/wave-1/` using `wave-1.<letter>.md`.
- Each wave file must include objective, scope, task breakdown, deliverables, and verification gates.
- Completed wave work must update:
  - `docs/internal/waves/wave-1/wave-1.<letter>-journal.md`
  - `docs/internal/waves/wave-1/wave-1.<letter>-changelog.md`
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
   `GeneratorTool` objects manually. Use the public API surface.

5. **No identity handlers.** A handler that returns its input unchanged exists only to satisfy
   a type requirement. Find a better composition, or remove the step.

6. **Schemas belong with their blocks.** Define `inputSchema` and `outputSchema` in the same
   file as the block that uses them. Flow-level schemas (state, resources, clientData) belong
   in the flow file. If a schema is shared, reference it from the block file that originally
   defines it.

7. **React components are JSX, not function calls.** Use `<ItemsRenderer items={...} />`
   not `ItemsRenderer({ items: ... })`.

8. **Examples must be realistic.** Every block, every sequencer step, every tool should do
   something a real application would need. If a feature doesn't fit the example's use case,
   don't force it. Leave it for the example where it fits naturally.

## Documentation maintenance protocol

When making changes that affect the framework's behavior or API, update documentation in the same change set as the code change.

**Architecture docs** (`docs/architecture/`):
Update when a change affects a core concept — block execution, state ops, streaming behavior, scope semantics, server routes, or client contract. These docs are adapted from the canonical specs in `../preperation/architecture/` and serve as the in-repo reference for framework developers.

**Package READMEs** (`packages/*/README.md`):
Update when a package's exported surface, behavior, or setup commands materially change. Keep the structure consistent: Purpose → Quick Start → API Surface → Scripts.

**Contributing docs** (`docs/contributing/`):
- Update `best-practices.md` when a new implementation standard is adopted.
- Update `architecture-reference.md` when locked contracts change or new ones are established.
- Update `development-setup.md` when monorepo tooling, build order, or development workflow changes.

**User-facing docs** (`apps/docs/docs/`):
Update when integration patterns change — server setup, React hooks usage, testing approach, or new concepts are introduced. These docs are for developers building apps WITH the framework.

**Root files**:
- Update `README.md` when onboarding-relevant facts change (setup, package roles, key concepts).
- Update `CLAUDE.md` when project orientation, key constraints, or package roles change.
- Update this file (`AGENTS.md`) when process protocol or collaboration rules change.

## Cursor Cloud specific instructions

This is a pnpm monorepo (pnpm@10.4.1, Node 22). No Docker, databases, or external services are required. All tests use mocked generators — no API keys needed for `pnpm test`.

**Build order matters for typecheck.** `pnpm typecheck` requires `packages/core` to be built first (its `dist/` must exist). The update script handles this, but if you see TS6305 errors about missing output files, run `pnpm --filter @flow-state-dev/core build` before retrying. The full build order is: core → server + client → react + testing → cli (see `docs/contributing/development-setup.md`).

**Key commands** are documented in `CLAUDE.md` and `docs/contributing/development-setup.md`. Summary: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter <pkg> test`.

**Running reference/example apps** (`apps/kitchen-sink`, `examples/hello-chat`) requires `OPENAI_API_KEY` for real LLM calls but works without it via the CLI: `pnpm fsdev run hello-chat chat -i '{"message": "Hello"}'` falls back to mock generation.

**Docs site**: `cd apps/docs && npx docusaurus start --port 3000` (do not use `pnpm docs:dev` with extra `--` flags — argument forwarding breaks).
