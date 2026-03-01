# Development Setup

Guide for setting up the Flow State Dev monorepo for local development.

## Prerequisites

- **Node.js** >= 18 (Node 20+ recommended)
- **pnpm** 10.4.1 (`corepack enable && corepack prepare pnpm@10.4.1`)

## Initial Setup

```bash
git clone https://github.com/fixpoint-labs/flow-state-dev
cd implementation
pnpm install
pnpm typecheck
pnpm test
```

All three commands should pass cleanly before starting any work.

## Monorepo Structure

```
packages/
  core/          Isomorphic builders, types, item taxonomy
  server/        Execution runtime, stores, SSE streaming, routes
  client/        Isomorphic API client (actions, sessions, streams)
  react/         React hooks and renderers
  testing/       Test harnesses and mocks
  cli/           Terminal interface (fsdev)
apps/
  devtool/       First-party inspector app
  docs/          Documentation site (Docusaurus)
examples/
  hello-chat/    Minimal canonical chat flow
  kitchen-sink/  Comprehensive feature reference
docs/
  architecture/  Framework architecture reference
  contributing/  This directory
  internal/      Wave plans, journals, process artifacts
```

## Common Commands

| Command | Scope | Purpose |
|---------|-------|---------|
| `pnpm test` | All packages | Run all tests |
| `pnpm typecheck` | All packages | TypeScript type checking |
| `pnpm lint` | All packages | Lint (currently stubbed) |
| `pnpm test:watch` | All packages | Watch mode tests |
| `pnpm --filter @flow-state-dev/core test` | Single package | Test one package |
| `pnpm --filter @flow-state-dev/server typecheck` | Single package | Typecheck one package |
| `pnpm --filter @flow-state-dev/example-kitchen-sink dev` | Example | Run kitchen-sink dev server |

## Build Order

Packages have a dependency hierarchy. When building from scratch:

```
1. core           (no internal deps)
2. server         (depends on core)
   client         (no internal deps — can build in parallel with server)
3. react          (depends on core + client)
   testing        (depends on core + server)
4. cli            (depends on core + server + testing)
```

Some packages have dependency-aware build scripts that build their upstream deps first.

## Testing

Tests use **Vitest** across all packages:

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @flow-state-dev/testing test

# Watch mode (all packages)
pnpm test:watch

# Watch mode (single package)
pnpm --filter @flow-state-dev/core test:watch
```

The testing package (`@flow-state-dev/testing`) provides framework-specific harnesses:
- `testBlock`, `testSequencer`, `testRouter`, `testFlow` — block/flow test helpers
- `mockGenerator`, `createMockModelResolver` — generator mocking
- `testItems`, `snapshotTrace` — assertion utilities

## TypeScript Configuration

- `tsconfig.base.json` at the repo root defines base settings and path mappings
- Each package has its own `tsconfig.json` extending the base
- `scripts/typecheck.mjs` provides offline TypeScript checking (handles registry unavailability)

## Key Files to Know

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent collaboration protocol and code style rules |
| `README.md` | Project overview and onboarding |
| `changelog.md` | Wave completion summaries |
| `docs/architecture/` | Framework architecture reference |
| `docs/contributing/best-practices.md` | Implementation standards (BP-001–BP-009) |
| `docs/contributing/architecture-reference.md` | Quick reference for locked contracts |
| `docs/internal/waves/` | Wave plans, journals, changelogs |

## Example Flows

The best way to understand the framework is to read the example flows:

- **hello-chat** (`examples/hello-chat/src/flows/hello-chat/flow.ts`): Minimal chat flow showing generator, handler, sequencer, and defineFlow patterns
- **kitchen-sink** (`examples/kitchen-sink/src/flows/kitchen-sink/flow.ts`): Comprehensive example covering all 4 block kinds, router, tools, resources, projections, and lifecycle hooks

## Package-Level READMEs

Each package has its own README with:
- Package purpose and public API surface
- Quick usage examples
- Package-local scripts

See `packages/*/README.md`.
