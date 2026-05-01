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
  - `changelog.md` (concise project-level summary — see Changelog style below)

## Changelog style

`changelog.md` is read by humans scanning what shipped — not by reviewers auditing how. Keep it tight.

**Audience and depth.** Write for a contributor or user catching up on the project, not for the reviewer of the originating PR. Implementation rationale, decision lineage, file paths, exact test counts, "out of scope" sections, and references to other tickets belong in the PR description, the wave journal, or the Linear comment — not here.

**Shape of an entry:**

- One H3 per shipped change, dated under the H2 of the day it landed on `main`.
- 3–6 bullets. Each bullet is one or two short sentences conveying a single user-facing fact: a new API, a renamed concept, a behavior change, a doc location. If you can't summarize at this level, the entry probably needs to be split or trimmed.
- Lead each bullet with the fact, not bolded preamble. Inline `code` for symbol names is fine; bolded category labels at the start of every bullet are not.
- No file paths, line numbers, LOC counts, test counts, or "Tests" / "Out of scope" sections. If a doc page is genuinely worth pointing readers at, name it; don't list every README that got a sentence updated.

**One entry per PR, not per intermediate decision.** Mid-PR refinements get folded into the single entry for that PR. If a follow-up PR materially revises a feature whose entry is still in the same release window, prefer extending or rewriting the original entry rather than adding a "follow-up" entry that documents the diff.

**When in doubt, look at the older entries.** The 2026-04-11 (`fsdev dev`, `defineCapability`, View Sequencer State) and 2026-03-20 (Resource Namespaces) entries are the reference style. The recent verbose entries were a regression — don't repeat them.

## Implementation guardrails

- Do not reference wave labels in runtime code or tests.
- Keep exported API surfaces documented with concise, high-signal comments.
- Preserve canonical package boundaries (`core`, `server`, `client`, `react`, `testing`, `cli`).

## Verifying flow changes during development

When you change flow logic, the default verification path is `fsdev run`, not `pnpm test` and not opening kitchen-sink in a browser. The CLI runs the full `runAction` engine against the same stores and execution context the production server uses, with structured NDJSON events on stdout and `[flow-state] *` runtime logs on stderr. It is the fastest way to confirm a change works as intended.

**Pick the right tool for the kind of change:**

| You changed… | Reach for |
|---|---|
| Block logic, sequencer composition, router branching, generator wiring, tool-loop behavior, resource state ops, scope plumbing | `fsdev run` |
| Pure helpers, type definitions, store contracts, isolated block units | `pnpm test` (vitest) |
| Component rendering, streaming display, theming, prompt-input UI, hydration | Open kitchen-sink in a browser |

If a single change spans more than one row, run them in that order: `fsdev run` first to confirm the flow still composes, then vitest, then the browser.

**Common invocations:**

```bash
# Smoke a flow with one input — fastest possible feedback loop
pnpm fsdev run hello-chat chat -i '{"message":"hello"}'

# Reuse a session across invocations to test multi-turn behavior
pnpm fsdev run kitchen-sink chat-agent -i '{"message":"now what?","mode":"ask"}' --session test-multi-1

# Seed session state before running (e.g. to test recovery from a specific state)
pnpm fsdev run kitchen-sink chat-agent -i '{...}' --seed-session ./fixtures/state.json

# Override the model — useful for cheap iteration or to force a specific path
pnpm fsdev run kitchen-sink chat-agent -i '{...}' --model openai/gpt-4o-mini

# Capture the full stream + result to a file you can grep/jq later
pnpm fsdev run kitchen-sink chat-agent -i '{...}' --capture /tmp/run.json

# Suppress runtime logs when you only want the NDJSON
pnpm fsdev run hello-chat chat -i '{"message":"hi"}' --quiet
```

**Reading the output efficiently.** Two streams matter:

- **stderr** carries `[flow-state] *` runtime logs (action start/complete, block lifecycle, retries, errors). Skim this for the *shape* of execution. On by default at `info` level; pass `--quiet` to suppress or `--log-level debug` to include nested-block events.
- **stdout** carries NDJSON events. Each line is a JSON object; types are `item_added`, `content_delta`, `state_change`, `flow_complete`, `error`. Pipe to `jq` to filter:

  ```bash
  # Final result only
  pnpm fsdev run ... 2>/dev/null | jq -c 'select(.type=="flow_complete")'

  # All errors
  pnpm fsdev run ... 2>/dev/null | jq -c 'select(.type=="error")'

  # Just the assistant message text
  pnpm fsdev run ... 2>/dev/null | jq -r 'select(.type=="content_delta") | .delta' | tr -d '\n'
  ```

**When something breaks**, switch into the `debug-flow` skill — it has the failure-pattern matrix and the `fsdev block` isolation workflow. This section is for confirming a change works; `debug-flow` is for diagnosing why one doesn't.

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

**Running reference/example apps** (`apps/kitchen-sink`, `examples/hello-chat`) requires a provider key for the model the flow uses. `hello-chat` is wired to `openai/gpt-5-mini`, so `pnpm fsdev run hello-chat chat -i '{"message":"hi"}'` needs `OPENAI_API_KEY` (or an `AI_GATEWAY_API_KEY` that resolves OpenAI). There is no mock fallback in `createModelResolver` — without a configured provider, generator blocks fail with `No provider available for "<provider>"`. For provider-free smoke tests, use `pnpm test` (mocks every generator) or write a flow that uses no generator blocks and run it through `fsdev run`.

**Docs site**: `cd apps/docs && npx docusaurus start --port 3000` (do not use `pnpm docs:dev` with extra `--` flags — argument forwarding breaks).
