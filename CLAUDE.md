# General Personality
You are not a sycophant. You don't tell the user they have a good idea until you have considered its pros and cons and determined if it really is an improvement or not.

# @flow-state-dev — Implementation Repo

`@flow-state-dev` is a TypeScript block-based AI workflow framework. This is the active implementation workspace for Phase 1 (Foundation).

## Orientation

**Read first (every session):**
1. `docs/architecture/overview.md` — System architecture and package roles
2. `docs/contributing/architecture-reference.md` — Locked contracts quick reference
3. `AGENTS.md` — Process protocol and code style rules

**Read when relevant:**
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
| `@flow-state-dev/cli` | Terminal interface (`fsdev`) |
| `@flow-state-dev/devtool` | Pre-built DevTool assets for `fsdev dev` |
| `@thought-fabric/core` | Cognitive architecture primitives (attention, memory, identity) |
| `apps/devtool` | DevTool source app (builds into `@flow-state-dev/devtool`) |
| `apps/docs` | Documentation site (Docusaurus) |

## Documentation Structure

```
docs/
  architecture/     Framework architecture reference (9 docs)
  contributing/     Development setup, best practices, wave process
  internal/         Wave plans, journals, changelogs (process artifacts)
```

## Key Architectural Constraints

- Block kinds: exactly `handler`, `generator`, `sequencer`, `router`
- Actions are flow-level: `defineFlow({ actions })`
- Required caller input: `userId`
- Streaming: SSE item/content model with sequence-number resume
- Generator provider: Vercel AI SDK in Phase 1
- Lifecycle hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)
- Package boundary: `react` wraps `client` — no transport logic in react
- Package boundary: `server` never depends on `client` or `react`

## Authority Hierarchy

1. `../preperation/architecture/*` — Canonical specs (highest authority)
2. `docs/architecture/*` — Adapted reference docs
3. `docs/contributing/best-practices.md` — Implementation standards
4. `AGENTS.md` — Process protocol

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

The philosophy blog post (`apps/docs/blog/2026-03-06-philosophy.md`) is the reference example for this voice.

## Current Phase

Phase 1 (Foundation): Waves 1.a–1.l complete. 1.m (devtool: `fsdev dev` + `@flow-state-dev/devtool` package) shipped. Remaining: 1.n (cross-package validation).

## @thought-fabric/core Conventions

- **Subpath exports**: Domains expose `@thought-fabric/core/<domain>` (e.g., `@thought-fabric/core/memory`). Named exports only (tree-shakeable). No default namespace objects.
- **Naming — word order encodes category**: `workingMemory[Verb]` = block/item (prefix first). `[verb]WorkingMemory` = helper (verb first). The inversion signals the category without needing docs.
- **Naming examples**: `workingMemoryCapture` (block), `workingMemoryResource` (resource), `workingMemoryContextFormatter` (formatter), `addWorkingMemory` (helper), `workingMemoryItems` (accessor)
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

**Input/output adaptation belongs inside the router** (BP-013)
- Use `connectInput(() => ...)` and `connectOutput(...)` inside the router's `execute`, not at block definition time.
- Pre-connecting at definition time is only for purpose-built reusable adapters.

**React: prefer `useMemo` over `useEffect` for derived state** (BP-010)
- `useEffect` is for genuine side effects: subscriptions, DOM manipulation, data fetching, external system sync.
- Comment every `useEffect` explaining what it does and why. Comment non-obvious logic.

**Document new and changed user-facing functionality**
- Any new or changed functionality that impacts end users must be documented in the same change set.
- Update the relevant `packages/*/README.md` for public API changes.
- Update or add `apps/docs` (Docusaurus) pages when the change affects concepts, guides, or APIs that end users reference.

## Using Bash
It is important that you not bother the user with a permission approval that isn't necessary. Think to use a bash command structure that fits within the already allowed list of commands, if possible.
