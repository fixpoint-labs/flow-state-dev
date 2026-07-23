# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. Assumes the vocabulary in [LANGUAGE.md](LANGUAGE.md) — **module**, **interface**, **seam**, **adapter**.

## Dependency categories

When assessing a candidate for deepening, classify its dependencies. The category determines how the deepened module is tested across its seam.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable — merge the modules and test through the new interface directly. No adapter needed.

**FSD examples:** most of `@flow-state-dev/core` (block builders, sequencer DSL, item type classification, schema utilities, capability factories), much of `@flow-state-dev/patterns` (factory composition), pure handlers, and any utility generator that doesn't touch a model. Tests are vitest specs co-located with the source (`foo.ts` → `foo.spec.ts`).

### 2. Local-substitutable

Dependencies that have local test stand-ins. Deepenable if the stand-in exists. The deepened module is tested with the stand-in running in the test suite. The seam is internal; no port at the module's external interface.

**FSD canonical example: store adapters.** The `StoreRegistry` interface in `@flow-state-dev/engine` is the seam; `@flow-state-dev/store-sqlite` and the built-in in-memory store are two real adapters. This is the textbook case of "two adapters = real seam" — the in-memory store exists *because* fast deterministic tests demand it. When deepening anything that touches persistence, the test loop uses the in-memory store via `@flow-state-dev/testing`.

### 3. Remote but owned (Ports & Adapters)

Your own services across a network boundary. Define a **port** (interface) at the seam. The deep module owns the logic; the transport is injected as an **adapter**. Tests use an in-memory adapter. Production uses an HTTP/SSE/queue adapter.

**FSD examples:** the server↔client streaming seam. The wire format (item/content/state_change events) is documented in `docs/architecture/streaming.md`; today's adapter is SSE; alternative transports would be additional adapters at the same port. When suggesting deepening here, frame the proposal as "the port is the item/content event stream — what new adapter does this enable?"

Recommendation shape: *"Define a port at the seam, implement the SSE adapter for production and an in-memory adapter for testing, so the logic sits in one deep module even though it's deployed across a network."*

### 4. True external (Mock)

Third-party services you don't control. The deepened module takes the external dependency as an injected port; tests provide a mock adapter.

**FSD example: LLM providers.** Generators resolve a model via `ctx.resolveModel()` and execute through the Vercel AI SDK — that's the true-external dependency. The `@flow-state-dev/testing` package provides a `mockGenerator` for tests (see `docs/architecture/blocks.md` and the testing package README). When deepening anything that calls a generator, tests use the mock; production wires the real provider.

## Seam discipline

- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a port unless at least two adapters are justified (typically production + test). A single-adapter seam is just indirection.
- **Internal seams vs external seams.** A deep module can have internal seams (private to its implementation, used by its own tests) as well as the external seam at its interface. Don't expose internal seams through the interface just because tests use them.

## Testing strategy: replace, don't layer

- Old unit tests on shallow modules become waste once tests at the deepened module's interface exist — delete them in the same commit as the refactor, not later.
- Write new tests at the deepened module's interface. The **interface is the test surface**.
- Tests assert on observable outcomes through the interface, not internal state.
- Tests should survive internal refactors — they describe behaviour, not implementation. If a test has to change when the implementation changes, it's testing past the interface.

**FSD test conventions** (match these when relocating tests):

- Co-locate `*.spec.ts` next to the source: `packages/<pkg>/src/.../foo.ts` → `packages/<pkg>/src/.../foo.spec.ts`. Don't pile all tests into a `__tests__` directory.
- Use `@flow-state-dev/testing` for block contexts, generator mocks, and pattern test harnesses. The `write-block-tests` skill encodes the conventions for the mock-context idiom.
- Cross-package or flow-level regressions go in `packages/integration-tests/` (Tier 1 suite).
- Generator output-schema invariants: import `makeSchemaStrict` from `@flow-state-dev/core` and assert no `ZodOptional`/`ZodDefault`/`ZodRecord`/non-literal `ZodUnion` survives (BP-016).
- Verify the refactor before declaring done: `pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test`. Root `pnpm typecheck` also runs the package-boundary validator (`scripts/validate-package-boundaries.mjs`) — use it after any cross-package refactor.
