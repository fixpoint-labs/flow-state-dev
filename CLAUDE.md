# General Personality
You are not a sycophant. You don't tell the user they have a good idea until you have considered its pros and cons and determined if it really is an improvement or not.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Tests verify intent, not just behavior

Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## 6. Surface conflicts, don't average them

If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## 7. Read before you write

Before adding code, read exports, immediate callers, shared utilities.
If unsure why existing code is structured a certain way, ask.

## 8. Match the codebase's conventions, even if you disagree

Conformance > taste inside the codebase.
If you think a convention is harmful, surface it. Don't fork it silently.
---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# @flow-state-dev — Implementation Repo

`@flow-state-dev` is a TypeScript block-based AI workflow framework. This is the active implementation workspace for Phase 1 (Foundation).

## Orientation

**Read first (every session):**
1. `docs/architecture/overview.md` — System architecture and package roles
2. `docs/contributing/architecture-reference.md` — Locked contracts quick reference
3. `AGENTS.md` — Process protocol and code style rules

**Verifying flow changes**: When you change flow logic, the default verification is `fsdev run` (see `AGENTS.md` → "Verifying flow changes during development"). Reach for `pnpm test` only for unit-level changes; reach for kitchen-sink in a browser only for UI-layer changes.

**Read when relevant:**
- `docs/architecture/items.md` — **Read before touching items, rendering, or the stream.** Complete item type registry, classification, and rendering contracts.
- `docs/architecture/*.md` — Deep dives into blocks, flows, state, streaming, execution, etc.
- `docs/contributing/best-practices.md` — Process and documentation standards (BP-001–BP-009)
- `changelog.md` — What waves have shipped
- `packages/*/README.md` — Per-package API docs

## Package Map

| Package | Purpose |
|---------|---------|
| `@flow-state-dev/core` | Isomorphic builders, type contracts, item taxonomy |
| `@flow-state-dev/server` | Execution runtime, stores, SSE streaming, HTTP routes |
| `@flow-state-dev/client` | Isomorphic API client (actions, sessions, streams) |
| `@flow-state-dev/react` | React hooks and renderers (wraps client) |
| `@flow-state-dev/testing` | Test harnesses and mocks |
| `@flow-state-dev/integration-tests` | Tier 1 flow integration suite (private) |
| `@flow-state-dev/cli` | Terminal interface (`fsdev`) |
| `@flow-state-dev/devtool` | Pre-built DevTool assets for `fsdev dev` |
| `@flow-state-dev/store-sqlite` | SQLite-backed persistent store |
| `@flow-state-dev/vercel` | Vercel deployment adapter (SSE shaping, heartbeats, runtime config) |
| `@flow-state-dev/tools` | Reusable tool blocks |
| `@flow-state-dev/patterns` | Higher-level composition patterns |
| `@flow-state-dev/memory` | Cross-turn memory system (working / episodic / semantic / digest tiers) |
| `@flow-state-dev/ui` | Component registry for flow UIs |
| `@thought-fabric/core` | Cognitive architecture primitives (attention, identity) |
| `apps/devtool` | DevTool source app (builds into `@flow-state-dev/devtool`) |
| `apps/docs` | Documentation site (Docusaurus) |

## Documentation Structure

```
docs/
  architecture/     Framework architecture reference (13 docs)
  contributing/     Development setup, best practices, wave process
  internal/         Wave plans, journals, changelogs (process artifacts)
```

## Skills Library

Development task skills live in `.claude/skills/`. Use these when performing common development tasks:

### Workflow skills
| Skill | Purpose |
|-------|---------|
| `create-spec` | Research and write implementation specs for Linear issues |
| `implement-issue` | Implement a Linear issue from its spec document |
| `quick-fix` | Log a bug to Linear and fix it immediately |
| `create-issue-and-commit` | Create a Linear issue for work already done, commit and PR |
| `debug-flow` | Debug flow execution via CLI traces and NDJSON logs |
| `linear-triage` | Review and prioritize Linear issues |
| `plan-day` | Identify unblocked tasks and generate a daily work plan |

### Development skills
| Skill | Purpose |
|-------|---------|
| `create-block` | Create a new block (handler, generator, utility, router) with tests |
| `create-pattern` | Create a multi-block composable pattern with tests and docs |
| `add-flow` | Create a new flow definition with actions, scopes, resources, and capabilities |
| `write-block-tests` | Write or update vitest tests for blocks and patterns |
| `add-store-adapter` | Create a new persistence store adapter package |
| `add-docs-page` | Add a page to the Docusaurus documentation site |

## Capabilities

- **Prefer capabilities over manual plumbing.** Use `defineCapability` + `uses: [cap]` instead of manually spreading `tools`, `context`, `sessionResources` into blocks. Capabilities are self-contained, portable, and composable.
- **Factory pattern for configurable capabilities.** When a capability needs config (provider type, resource refs), export a factory: `createXCapability(options)` → `DefinedCapability`.
- **Prefer static capability entries over manual context functions.** If a capability already provides context presets, use the capability in `uses` rather than reimplementing its formatting in a `context` slot. Gate conditional behavior at the pipeline level (e.g., `workIf` on capture) instead of at the context injection level.
- **Dynamic `uses` for conditional capabilities.** `uses` arrays accept `(ctx) => CapabilityRef[]` functions. Static entries install resources at build time; dynamic entries add context/tools at runtime. Resources must be declared statically somewhere.
- **Presets for opt-in/opt-out.** Use presets to bundle context/tools that consumers can enable/disable: `cap.presets({ tools: false })`.
- **`ToolsSlot` and `UsesSlot`** are framework types exported from `@flow-state-dev/core` for factory interfaces.
- **Pattern factories accept `uses`.** `planAndExecute`, `supervisor`, `blackboard` all forward `uses` to their default internal generators.

## Key Architectural Constraints

- Block kinds: exactly `handler`, `generator`, `sequencer`, `router`
- Actions are flow-level: `defineFlow({ actions })`
- Required caller input: `userId`
- Streaming: SSE item/content model with sequence-number resume
- Generator provider: Vercel AI SDK in Phase 1
- Lifecycle hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)
- Package boundary: `react` wraps `client` — no transport logic in react
- Package boundary: `server` never depends on `client` or `react`
- Collection key resolution: `collection.create("key")` auto-prepends the pattern prefix. `ref.name` returns the full storage key (e.g., `"artifacts/my-doc"`). Strip the prefix for bare keys.
- Resource mutations emit `resource_change` SSE events via `onResourceChanged` in `createScopeResourceRegistry`. These are transient items — `useSession` checks for them before the transient filter.

## Authority Hierarchy

1. `docs/architecture/*` — Adapted reference docs
2. `docs/contributing/best-practices.md` — Implementation standards
3. `AGENTS.md` — Process protocol

If docs conflict, `preperation/architecture/*` wins.

## Commands

```bash
pnpm install          # Install all dependencies
pnpm typecheck        # TypeCheck all packages
pnpm test             # Run all tests
pnpm test:watch       # Watch mode
pnpm --filter @flow-state-dev/core test    # Test single package
pnpm --filter @thought-fabric/core test       # Test thought-fabric (builds core dep first)
pnpm --filter @thought-fabric/core typecheck  # Typecheck thought-fabric
```

## Writing Style (site content)

When writing blog posts, landing copy, or any prose for `apps/docs`, use this voice:

- **Audience is engineers.** No marketing speak. Write like you're explaining something to a peer, not selling to a buyer.
- **Short sentences. Varied rhythm.** Mix one-sentence paragraphs with longer ones. Don't let every sentence hit the same beat.
- **Minimal em-dashes.** Prefer commas, periods, or restructured sentences. Em-dashes are fine occasionally — not as a default connector.
- **No AI cadence.** Avoid: "X isn't just Y — it's Z", lists of three things that escalate nicely, sentences that start with "This", adjectives like "powerful/frictionless/seamless/first-class".
- **Introduce concepts for newcomers.** Don't assume the reader knows framework terms. When first mentioning something specific (a block kind, an API), briefly say what it does in plain terms.
- **Be direct about tradeoffs.** It's fine to say "this works for demos, not for production" or "we made a deliberate call here." Honest is better than polished.
- **Conclusions earn their place.** Don't end every section with a triumphant one-liner. If a point lands, it lands. If it needs a closer, keep it short and specific.
- **No internal issue or PR numbers.** Anything under `apps/docs/` is published documentation. Refer to features by what they are, not by their tracking ID. `FIX-421`, `PR #182`, Linear ticket links — none of these belong in user-facing prose. They go in commits, the repo-root `changelog.md`, and internal artifacts under `docs/internal/`.
- **Warm, not cold.** Reference docs can stay dry, but overviews, guides, and intros should read like a teammate walking you through it. A short framing sentence, an honest "why you'd reach for this," small acknowledgments of the reader's likely context. Engineer-direct still means human.
- **Sidebar labels never repeat the category name.** A `Memory` category should not contain a page literally labeled `Memory`. Use `sidebar_label: Overview` (or `Getting started`, etc.) in the page's frontmatter so the sidebar reads `Memory > Overview`, not `Memory > Memory`. Same rule for every category.
- **Use `openai/gpt-5.4-mini` in code examples** when a small/fast model is appropriate. Don't use legacy names like `gpt-4o-mini`, `gpt-4o`, `gpt-3.5-turbo`, etc. — they read as out of date.

The philosophy blog post (`apps/docs/blog/2026-03-06-philosophy.md`) is the reference example for this voice.

## Current Phase

Phase 1 (Foundation): Waves 1.a–1.l complete. 1.m (devtool: `fsdev dev` + `@flow-state-dev/devtool` package) shipped. Remaining: 1.n (cross-package validation).

## @thought-fabric/core Conventions

- **Subpath exports**: Domains expose `@thought-fabric/core/<domain>` (e.g., `@thought-fabric/core/attention`, `@thought-fabric/core/identity`). Named exports only (tree-shakeable). No default namespace objects.
- **Naming — word order encodes category**: `perspective[Verb]` = block/item (prefix first). `[verb]Perspective` = helper (verb first). The inversion signals the category without needing docs.
- **Naming examples**: `perspectiveObserve` (block), `perspectiveResource` (resource), `perspectiveContextFormatter` (formatter), `addPerspective` (helper)
- **Context formatters**: Use `[domain]ContextFormatter` naming. Always assign to `context` as an array: `context: [workingMemoryContextFormatter]`
- **Build dependency**: `@thought-fabric/core` depends on `@flow-state-dev/core` — build core first (`pnpm --filter @flow-state-dev/core build`)

## Coding Conventions

- **Common helpers** (`deepEqual`, formatting utilities, etc.) belong in a shared utils file — not inlined per-file. No duplicate copies across packages.

### Always-applied implementation rules

**File and export documentation** (BP-007)
- File header comment required: explain the file's role in the runtime.
- 100% of exported APIs documented with concise doc comments (contract + behavior, not syntax restatement).
- Document non-obvious internal helpers (complex control flow, error semantics).

**Handlers must not call blocks using block.run** (BP-011)
- Never instantiate or call a block inside a handler's `execute`.
- Compose as a sequencer: `.then(generator).then(handler)`.

**Handlers must never return input as output** (BP-014)
- `execute` must never `return input`. It pollutes the items log with redundant echoes.
- No meaningful output → use `.tap()`. Transforming input → return the transformation.

**Use `.tap()` for state-mutation-only blocks** (BP-012)
- Blocks that only mutate state: use `.tap()`, no `outputSchema`, no `return input`.

**Use conditional step variants instead of wrapper sequencers** (BP-015)
- `.workIf(condition, connector, block)` — not a wrapper sequencer with `.thenIf` inside `.work()`.
- `.tapIf(condition, block)` — not a gating handler that conditionally calls a block.
- `.thenIf(condition, block)` — not a wrapper sequencer with a `.map` + `.then`.
- All conditional variants accept an inline connector as a second argument for input adaptation. Don't create an intermediate sequencer just to `.map()` before a block.

**Input/output adaptation belongs inside the router** (BP-013)
- Use `connectInput(() => ...)` and `connectOutput(...)` inside the router's `execute`, not at block definition time.
- Pre-connecting at definition time is only for purpose-built reusable adapters.

**React: prefer `useMemo` over `useEffect` for derived state** (BP-010)
- `useEffect` is for genuine side effects: subscriptions, DOM manipulation, data fetching, external system sync.
- Comment every `useEffect` explaining what it does and why. Comment non-obvious logic.

**Generator outputSchemas must be OpenAI strict-compatible** (BP-016)
- No `z.record()` reachable from a generator output — use a fixed-shape `z.object({...})` or `z.array(z.object({ key, value }))` when keys are dynamic.
- No `z.optional()` / `z.default()` on outputs — use `z.nullable()` instead.
- No `z.union([...])` of differently-shaped variants. Collapse to a nullable single shape or split generators.
- Guard with a test: import `makeSchemaStrict` from `@flow-state-dev/core` and assert no `ZodOptional` / `ZodDefault` / `ZodRecord` / non-literal `ZodUnion` survives. See `examples/trading-desk/test/output-schemas-strict.spec.ts` for a copy-paste walker.

**Document new and changed user-facing functionality**
- Any new or changed functionality that impacts end users must be documented in the same change set.
- Update the relevant `packages/*/README.md` for public API changes.
- Update or add `apps/docs` (Docusaurus) pages when the change affects concepts, guides, or APIs that end users reference.

## Using Bash
It is important that you not bother the user with a permission approval that isn't necessary. Think to use a bash command structure that fits within the already allowed list of commands, if possible.
