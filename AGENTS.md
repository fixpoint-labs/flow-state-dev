# Agent Instructions (Implementation Repo)

These instructions define the collaboration protocol for agent-driven work in this repository.

## Startup reads

At the start of a new conversation in this repo, read:

- `docs/philosophy.md` — how we build FSD: the tenets (the apex of the grounding)
- `CLAUDE.md` — project orientation and key constraints
- `docs/contributing/best-practices.md` — implementation standards (the active BPs at the top of that file)
- `docs/contributing/architecture-reference.md` — quick reference for locked contracts
- Relevant docs in `docs/architecture/` for the task at hand

**Authority order**: `docs/philosophy.md` > `docs/architecture/*` > `docs/contributing/best-practices.md` > this file. When two in-repo docs disagree, the more specific one wins; when code and grounding disagree with no doc to settle it, that is a philosophy gap to surface, not to route around.

## Wave execution protocol

Use this protocol when work is wave-based:

- Waves have numbers and letters. Numbers represent the phase of wave we are in, letters indicate the major milestone. Wave plans live under `docs/internal/waves/wave-<number>/` and track what's targeted for each milestone.
- Keep wave plans under their wave number, currently at `docs/internal/waves/wave-1/` using `wave-1.<letter>.md`.
- Each wave file must include objective, scope, task breakdown, deliverables, and verification gates.
- Completed wave work must update:
  - `docs/internal/waves/wave-1/wave-1.<letter>-journal.md`
  - `docs/internal/waves/wave-1/wave-1.<letter>-changelog.md`

## Release notes

This repo uses Changesets for release coordination. Do not edit a root `changelog.md` — none exists.

**On every PR with user-facing impact:**

1. Run `pnpm changeset`. Pick the affected publishable package(s).
2. Pre-1.0: choose `patch` for non-breaking, `minor` for breaking. Never `major`.
3. Write a single user-facing sentence describing the change. Multi-paragraph or migration notes are fine when warranted.
4. Commit the generated `.changeset/<name>.md` file with the PR.

**Skip changesets** for internal-only changes (refactors, test-only edits, internal helpers, infra). State that explicitly in the PR description so a reviewer can verify, or run `pnpm changeset --empty` and commit the resulting empty fragment.

**Reference:** [`docs/contributing/release-notes-workflow.md`](docs/contributing/release-notes-workflow.md) covers when to write what, the multi-package case, common mistakes, and what happens at release time. [BP-022](docs/contributing/best-practices.md#bp-022-release-notes-via-changesets) is the rule.

## Implementation guardrails

- Do not reference wave labels in runtime code or tests.
- Keep exported API surfaces documented with concise, high-signal comments.
- Preserve canonical package boundaries (`core`, `server`, `client`, `react`, `testing`, `cli`).
- **Working memory is session-only — never commit it.** Orchestration state (the fleet board, per-issue handle caches, any coordination scratch) lives in the **gitignored `.orchestration/`** directory. Never `git add`, commit, or open a PR for these files — commit only the actual issue work, in the issue's own worktree/branch. A PR whose diff is a board / status / scratch file is a bug; don't open it, and if one exists, close it.

> **Orchestration reference.** How the fleet, epics, and issue lifecycles compose — roles, gates (draft→ready, `spec approved`, `epic approved`), and the epic-spec — is defined once, with diagrams, in `docs/contributing/orchestration.md`. The orchestration skills and worker agents reference it.

## Model tiering — match the model to where judgment lives

We front-load architectural judgment (spec authoring, the coherence / Philosophy-Skeptic review lens, the challenger). Once the decisions are made, execution and fetching are the token-heavy, low-judgment bulk — run those on cheaper models. The rule:

**Opus coordinates and judges · Sonnet executes decided work · Haiku fetches and scouts.**

| Tier | Model | Roles |
|---|---|---|
| Judgment | **Opus** (default) | the orchestrators (thin, cheap to keep smart), `fsd:create-spec` authoring/research, epic-spec authoring/coordination (`epic-agent`), the **coherence** review lens (`fsd:audit-coherence`) + **restraint** (`fsd:second-look`), the **challenger**, ambiguous debugging, necessity/refinement calls |
| Decided execution | **Sonnet** | implementing a task from an approved spec (`spec-implementer`), the **completeness** + **correctness** review lenses, straightforward PR-feedback fixes, tests for a named behaviour |
| Mechanical | **Haiku** | read-only orientation (`scout` / `fsd:zoom-out`), status/handle fetches (fleet & lifecycle refreshes), simple lookups, boilerplate/formatting |

**The guardrail that makes downgrading safe:** a cheaper-tier worker *escalates a genuine un-decided decision rather than inventing one*. `spec-implementer` (Sonnet) stops and reports a blocker when it hits an architectural fork the spec didn't settle; `scout` (Haiku) returns facts and defers any judgment. Downgrade only where the decision is already made — never where the work is still deciding.

**Upward escalation — first-class, slice-only, and human-gated.** The default judgment tier is Opus, and it does *not* escalate a whole phase to a costlier model. But when Opus hits a *single, bounded* decision it judges genuinely beyond it — one where both horns are defensible on the tenets and being wrong is expensive to reverse — it may escalate **that one decision** to a **Fable** sub-agent, passing only the *slice*: the specific fork, the options, and the context needed to decide. Never the whole task. Fable returns an adjudication; the owning agent still decides and surfaces to the human — Fable advises, it does not decide. Three guards, in order:

- **Structural (anti-over-escalation).** Escalation *requires* isolating the decision to a self-contained slice. If it can't be reduced to a slice, it isn't a Fable call — it's ordinary work, or a human escalation.
- **Human approval (cost).** Fable is a paid escalation and is **never invoked automatically.** The owning coordinator surfaces the proposal — the slice, why it's Fable-worthy, and the rough cost — and waits for a yes (`AskUserQuestion`) before spawning it. A sub-agent that can't prompt (a worker, a review lens) *proposes* the escalation in its report and hands the slice up; the coordinator owns the ask. The human declining is also the over-escalation backstop — if the agent over-proposes, nothing is spent. Approval is per-invocation while we learn whether Fable earns its premium.
- **The asymmetry is deliberate.** This is the top tier's counterpart to the downward guardrail: an *executor* that hits a decision beyond it **stops and reports** to the owner (never resolving it inline, which would bypass the spec/human gate); the *owner* (Opus) escalates a slice to Fable. We do **not** add inline Sonnet→Opus or Haiku→Sonnet escalation — the executor's job is to surface the fork, not resolve it with a borrowed brain.

First trial surface: the single hardest conflict in `fsd:cross-spec-review` (it flags a `fable-candidate`; the fleet obtains approval and invokes). Whether Fable earns its premium is *measured* by the cycle-ledger (`fsd:distill-lessons`), not assumed.

Set the tier declaratively with `model:` on a worker agent (`.claude/agents/*.md`) or `model:` / `effort:` on a skill; or per-dispatch via the Agent tool's model override. Standing worker agents: **`spec-implementer`** (Sonnet), **`scout`** (Haiku), **`issue-manager`** (Sonnet — files/organizes Linear issues for discovered gaps and blockers; see below).

**File discovered work, don't scope-creep it.** When work surfaces a gap, a follow-up, or a blocker that isn't the current task's job, file it through the **`issue-manager`** agent (related to the current issue, in the current project — it duplicate-checks, writes it PM-shaped, wires blocked-by/blocks/relates/parent, and returns a ready/blocked verdict). Under the fleet, a filed *unblocked, related* issue can be pulled into the active set (still gated at its own spec-approval).

## Verifying flow changes during development

When you change flow logic, the default verification path is `fsdev run`, not `pnpm test` and not opening kitchen-sink in a browser. The CLI runs the full `runAction` engine against the same stores and execution context the production server uses, with structured NDJSON events on stdout and `[flow-state] *` runtime logs on stderr. It is the fastest way to confirm a change works as intended.

When the app under test ships an `fsdev.config.ts` (FIX-784), `fsdev run` uses its wiring — the app's model resolver and store profiles — instead of CLI defaults. Run it from the app directory, since config search is cwd-only (`cd apps/kitchen-sink && pnpm fsdev run ...`). The repo-root invocation stays on directory discovery.

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

**When the result lives in a resource, not the stream.** `fsdev run`'s NDJSON records items and events, not resource VALUES (only change notifications). When an app's outcome is a stored resource — e.g. the trading-desk's decision-of-record, which also lives in a PGlite store rather than a readable file — a single `fsdev run` shows you the stream but not the decision. Pair it with a zero-model **read action** that projects the resource back out, captured to a file: `fsdev run <flow> analyze --capture … --quiet` then `fsdev run <flow> <readAction> --capture … --quiet`, then read the second capture's `result.output`. The trading-desk's headless verification is the worked example — reach for the **`fsd:verify-trading-desk`** skill, which encodes the two-step, the record→replay cost ladder, and the result-field reference.

**When something breaks**, switch into the `debug-flow` skill — it has the failure-pattern matrix and the `fsdev block` isolation workflow. This section is for confirming a change works; `debug-flow` is for diagnosing why one doesn't.

## Adding test coverage

Three tiers, picked by what kind of regression you want to catch:

| Layer | Where | Use when |
|---|---|---|
| Block / router / sequencer unit | `packages/<pkg>/test/*.test.ts` via `testBlock`, `testRouter`, `testSequencer` | A single block's logic — state changes, output shape, error paths. Default tier for new code. |
| Flow integration | `packages/integration-tests/src/scenarios/*.test.ts` via `testFlow` | A regression that only emerges from full `runAction` composition: pattern factory wiring, claim systems, dispatcher loops, multi-pattern interactions, session resume across runs. |
| Tier 2/3 (Playwright UI, real-LLM smoke) | Not yet on main | UI rendering, real-network behavior. Out of scope for most changes. |

**Reach for `packages/integration-tests/` when**:

- You fix a bug in a pattern factory (`supervisor`, `taskBoard`, `planAndExecute`, `eventActors`, `routedSpecialists`, `coordinator`) where the bug only manifests when the pattern runs end-to-end with mocked generators. The supervisor + task-board claim-system regression is the canonical example.
- You add a new pattern factory whose composition would benefit from a multi-block scenario test.
- You change the request lifecycle (`runAction`, scope seeding, session journal, store contracts, resume) — add a scenario that exercises the new contract.
- You change `mockGenerator` or `testFlow` semantics — extend the existing scenarios or add one that pins the new behavior.

**Don't** put block-level assertions there. If a new test would only need `testBlock`, it belongs in the producing package's `test/` directory.

**Authoring** is described in `apps/docs/docs/testing/flow-integration-tests.md` and `packages/integration-tests/README.md`. Pattern: synthetic fixture flow under `src/scenarios/fixtures/` + scenario file under `src/scenarios/`. Use `unmockedGeneratorPolicy: "error"` so missing mocks surface as a loud throw with the offending block name. Scripts use predicate entries (`{ when, then }`) for concurrent workers and plain steps for ordered conversations.

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
Update when a change affects a core concept — block execution, state ops, streaming behavior, scope semantics, server routes, or client contract. These are the authoritative in-repo reference for framework developers; keep them in sync with the code.

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
