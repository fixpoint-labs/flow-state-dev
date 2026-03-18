# @flow-state-dev — Implementation Repo

`@flow-state-dev` is a TypeScript block-based AI workflow framework. This is the active implementation workspace for Phase 1 (Foundation).

## Orientation

**Read first (every session):**
1. `docs/architecture/overview.md` — System architecture and package roles
2. `docs/contributing/architecture-reference.md` — Locked contracts quick reference
3. `AGENTS.md` — Process protocol and code style rules

**Read when relevant:**
- `docs/architecture/*.md` — Deep dives into blocks, flows, state, streaming, execution, etc.
- `docs/contributing/best-practices.md` — Implementation standards (BP-001–BP-009)
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
| `@thought-fabric/core` | Cognitive architecture primitives (attention, memory, identity) |
| `apps/devtool` | First-party inspector app |
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

Phase 1 (Foundation): Waves 1.a–1.k complete. Remaining: 1.l (CLI), 1.m (devtool), 1.n (cross-package validation).

## @thought-fabric/core Conventions

- **Subpath exports**: Domains expose `@thought-fabric/core/<domain>` (e.g., `@thought-fabric/core/memory`). Named exports only (tree-shakeable). No default namespace objects.
- **Naming — word order encodes category**: `workingMemory[Verb]` = block/item (prefix first). `[verb]WorkingMemory` = helper (verb first). The inversion signals the category without needing docs.
- **Naming examples**: `workingMemoryCapture` (block), `workingMemoryResource` (resource), `workingMemoryContextFormatter` (formatter), `addWorkingMemory` (helper), `workingMemoryItems` (accessor)
- **Context formatters**: Use `[domain]ContextFormatter` naming. Always assign to `context` as an array: `context: [workingMemoryContextFormatter]`
- **Build dependency**: `@thought-fabric/core` depends on `@flow-state-dev/core` — build core first (`pnpm --filter @flow-state-dev/core build`)

## Coding Conventions

- **Common helper functions (e.g., `deepEqual`, formatting utilities, etc) should live in a common use-case specific helpers or common utils file rather than inline in files. We want to avoid having duplicate copies of utils spread out throughout our package/app codebases.

## Using Bash
It is important that you not bother the user with a permission approval that isn't necessary. Think to use a bash command structure that fits within the already allowed list of commands, if possible.
