# Changelog

All notable implementation-repo changes are recorded here as concise, wave-level summaries.

## 2026-02-27

### Server runtime logging improvements

- Added structured action/block execution logging in `@flow-state-dev/server` with default console output, bounded payload summaries, retry visibility, and terminal error logs.
- Added `RuntimeLogger` hooks (`logger` option on `runAction`/`executeBlock`) plus reusable helpers (`DEFAULT_RUNTIME_LOGGER`, `summarizeForLog`, `createExecutionLogContext`).
- Added execution-focused tests for retry/failure log coverage and log summarization helpers.
- Updated execution architecture and server package docs to describe runtime log behavior and customization.

## 2026-02-15

### Planning foundation

- Added Wave 1.a execution plan at `docs/waves/wave-1/wave-1.a.md` aligned to canonical Wave A.
- Added Wave 1.b execution plan at `docs/waves/wave-1/wave-1.b.md` aligned to canonical Wave B.
- Added reusable wave template at `docs/waves/WAVE_TEMPLATE.md`.
- Added living best-practices log at `docs/BEST_PRACTICES.md`.
- Added compact architecture cheat sheet at `docs/ARCHITECTURE_CHEAT_SHEET.compact.md`.
- Added implementation repo process guidance at `README.md`.
- Established dual changelog policy: per-wave journal/changelog plus root `changelog.md` summaries.
- Standardized wave naming to Phase 1-prefixed identifiers (`Wave 1.a`, `Wave 1.b`, ...) and renamed wave files accordingly.
- Grouped all Phase 1 wave artifacts under `docs/waves/wave-1/` (for example `docs/waves/wave-1/wave-1.a-changelog.md`).

### Wave 1.a implementation

- Initialized workspace root tooling with `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, and root `tsconfig.json` references.
- Scaffolded required Phase 1 package/app targets under `packages/*` and `apps/devtool` with manifests and TypeScript configs.
- Added minimal `src/index.ts` entrypoints for all six required packages plus `apps/devtool/src/index.ts`.
- Established canonical `@flow-state-dev/core` subpath exports for `.`, `./types`, and `./items` with corresponding source modules.
- Added React compile-time smoke import proof from `@flow-state-dev/core/types` and `@flow-state-dev/core/items`.
- Added offline Wave 1.a typecheck verifier at `scripts/typecheck.mjs` due registry unavailability in this environment.
- Added Wave 1.a execution artifacts: `docs/waves/wave-1/wave-1.a-journal.md` and `docs/waves/wave-1/wave-1.a-changelog.md`.

### Wave 1.b implementation

- Implemented canonical core type contracts in `packages/core/src/types/*` for blocks, flows, state/scopes, and resources/projections.
- Implemented canonical item/content/stream event contracts in `packages/core/src/items/*` aligned to item-first streaming architecture.
- Added shared schema typing helpers in `packages/core/src/schema/*` and wired type/item exports through core entrypoints.
- Added compile-only type smoke checks at `packages/core/src/types/tests/sequencer-connectors.type-test.ts` and `packages/core/src/types/tests/flow-state-inference.type-test.ts`.
- Added `zod` dependency to `packages/core/package.json` for canonical schema typing.
- Updated React smoke import proof to consume real core type/item exports via `packages/react/src/_wave-1a-import-smoke.ts`.
- Added Wave 1.b execution artifacts: `docs/waves/wave-1/wave-1.b-journal.md` and `docs/waves/wave-1/wave-1.b-changelog.md`.
- Synced Wave 1.b stream event typings to updated canonical docs by adding request/user stream event base unions and `scope.state.changed` user-stream event types in `packages/core/src/items/events.ts`.

### Wave 1.c implementation

- Added Wave 1.c execution plan at `docs/waves/wave-1/wave-1.c.md` aligned to canonical Wave C.
- Implemented shared block runtime helper in `packages/core/src/blocks/internal/build-block.ts` with metadata wiring, schema validation, retry handling, and `connectInput`/`connectOutput` rebinding.
- Implemented canonical runtime builders in `packages/core/src/blocks/*`:
  - `handler` in `packages/core/src/blocks/handler.ts`
  - loop-capable `generator` with repair support in `packages/core/src/blocks/generator.ts`
  - sequencer runtime + DSL signatures in `packages/core/src/blocks/sequencer.ts` and `packages/core/src/blocks/sequencer-methods.ts`
  - `router` with route-candidate validation in `packages/core/src/blocks/router.ts`
- Added blocks barrel exports in `packages/core/src/blocks/index.ts` and wired runtime builder exports at `packages/core/src/index.ts`.
- Added sequencer DSL type smoke coverage at `packages/core/src/types/tests/sequencer-dsl.type-test.ts`.
- Added Wave 1.c execution artifacts: `docs/waves/wave-1/wave-1.c-journal.md` and `docs/waves/wave-1/wave-1.c-changelog.md`.

### Wave 1.d implementation

- Added Wave 1.d execution plan at `docs/waves/wave-1/wave-1.d.md` aligned to canonical Wave D.
- Implemented `defineFlow` runtime with callable `FlowType`, shallow merge-based instance overrides, and Phase 1 `requireUser=true` enforcement in `packages/core/src/flow/defineFlow.ts`.
- Added flow runtime barrel export at `packages/core/src/flow/index.ts` and wired root exports in `packages/core/src/index.ts`.
- Wired flow-level tools defaults/hooks into generator action execution by merging flow + instance tools and binding to generator blocks.
- Added Wave 1.d unit tests in `packages/core/test/flow.test.ts` and extended export smoke coverage in `packages/core/test/blocks.test.ts`.
- Added Wave 1.d execution artifacts: `docs/waves/wave-1/wave-1.d-journal.md` and `docs/waves/wave-1/wave-1.d-changelog.md`.

### Unit test infrastructure

- Added workspace Vitest baseline config at `vitest.config.ts`.
- Added `vitest` dev dependency and root `test:watch` script in `package.json`.
- Replaced placeholder `test` scripts with Vitest commands in all packages and `apps/devtool`.
- Added initial package-level unit test files under `packages/*/test/*.test.ts` and `apps/devtool/test/index.test.ts` to verify each workspace target has runnable test coverage.

## 2026-02-16

### Process updates

- Added BP-006 to `docs/BEST_PRACTICES.md`: keep wave labels out of runtime code/tests and reserve them for planning/docs artifacts.
- Added BP-007 to `docs/BEST_PRACTICES.md`: require concise file-level/API documentation for exported methods and important internal runtime helpers.
- Added BP-008 to `docs/BEST_PRACTICES.md`: keep `README.md` onboarding-first and update it whenever onboarding-relevant facts change.
- Reworked `README.md` into a developer onboarding entrypoint (project overview, objectives, key concepts, setup, package responsibilities, command references, and docs map).
- Refined `README.md` to be evaluator-friendly for new users by adding stronger value framing (`why this exists`, `why this repo may be worth your time`), clear maturity status, and a concrete `start here` onboarding path.
- Added `AGENTS.md` to hold agent collaboration protocol and moved wave execution guidance out of `README.md`.

### Wave 1.e implementation

- Added Wave 1.e execution plan at `docs/waves/wave-1/wave-1.e.md` aligned to canonical Wave E.
- Implemented server context runtime and context types in `packages/server/src/context/createExecutionContext.ts` and `packages/server/src/context/types.ts`, including require-user/session enforcement and composed scope handles.
- Implemented CAS primitives and versioned state container/state-op helpers in `packages/server/src/stores/cas.ts` and `packages/server/src/stores/state-container.ts`.
- Implemented filesystem and in-memory store adapters for `session`, `request`, `user`, and `project` scopes under `packages/server/src/stores/filesystem/*` and `packages/server/src/stores/memory/*`.
- Added server store barrel exports in `packages/server/src/stores/index.ts` and wired server root exports in `packages/server/src/index.ts`.
- Added Wave 1.e unit tests in `packages/server/test/context.test.ts`, `packages/server/test/state-container.test.ts`, and `packages/server/test/stores.test.ts`.
- Added Wave 1.e execution artifacts: `docs/waves/wave-1/wave-1.e-journal.md` and `docs/waves/wave-1/wave-1.e-changelog.md`.

### Wave 1.f implementation

- Added Wave 1.f execution plan at `docs/waves/wave-1/wave-1.f.md` aligned to canonical Wave F.
- Implemented streaming runtime modules in `packages/server/src/streaming/response-emitter.ts`, `packages/server/src/streaming/sse.ts`, `packages/server/src/streaming/encode-event.ts`, and `packages/server/src/streaming/resume.ts`.
- Added Wave 1.f middleware-readiness seam support in streaming internals via `packages/server/src/streaming/types.ts` and `packages/server/src/streaming/internal/seams.ts`, with no-op-safe interception points in emitter/encoder paths.
- Added streaming barrel exports at `packages/server/src/streaming/index.ts` and wired streaming exports through `packages/server/src/index.ts`.
- Added streaming unit tests in `packages/server/test/streaming.test.ts` (including no-op seam parity) and expanded server export smoke tests in `packages/server/test/index.test.ts`.
- Consolidated shared store pagination helper into `packages/server/src/stores/shared.ts` and reused it in memory/filesystem helper modules.
- Added Wave 1.f execution artifacts: `docs/waves/wave-1/wave-1.f-journal.md` and `docs/waves/wave-1/wave-1.f-changelog.md`.

### Wave 1.g implementation

- Added Wave 1.g execution plan at `docs/waves/wave-1/wave-1.g.md` aligned to canonical Wave G.
- Implemented error model and normalization utilities in `packages/server/src/errors/flow-error.ts` and `packages/server/src/errors/normalize-error.ts`.
- Implemented execution runtime modules in `packages/server/src/execution/*`, including retry engine, block-kind dispatch wrappers, rescue routing, work queue convergence, and request action runner lifecycle integration.
- Added internal execution seam metadata and no-op seam hooks in `packages/server/src/execution/types.ts` and `packages/server/src/execution/internal/seams.ts`.
- Added execution barrel exports in `packages/server/src/execution/index.ts` and wired server root exports in `packages/server/src/index.ts`.
- Added Wave 1.g unit tests in `packages/server/test/execution.test.ts` and expanded server export smoke checks in `packages/server/test/index.test.ts`.
- Added Wave 1.g execution artifacts: `docs/waves/wave-1/wave-1.g-journal.md` and `docs/waves/wave-1/wave-1.g-changelog.md`.

### Wave 1.h implementation

- Added Wave 1.h execution plan at `docs/waves/wave-1/wave-1.h.md` aligned to canonical Wave H.
- Implemented server flow registry in `packages/server/src/registry/flow-registry.ts`, plus registry exports in `packages/server/src/registry/index.ts`.
- Implemented canonical catch-all path parser and endpoint handlers in `packages/server/src/routes/parseFlowRoute.ts` and `packages/server/src/routes/http-handlers.ts`.
- Implemented catch-all route adapter in `packages/server/src/routes/createFlowApiRouter.ts` with internal no-op request bootstrap seam hooks for future middleware context enrichment.
- Added route exports in `packages/server/src/routes/index.ts` and wired registry/routes through `packages/server/src/index.ts`.
- Added Wave 1.h unit coverage in `packages/server/test/registry-routes.test.ts` and expanded server export smoke checks in `packages/server/test/index.test.ts`.
- Added Wave 1.h execution artifacts: `docs/waves/wave-1/wave-1.h-journal.md` and `docs/waves/wave-1/wave-1.h-changelog.md`.

## 2026-02-19

### Wave 1.i implementation

- Added Wave 1.i execution plan at `docs/waves/wave-1/wave-1.i.md` aligned to canonical Wave I.
- Implemented client transport APIs in `packages/client/src/*`, including action/session/state APIs and request/user SSE clients with resume controls.
- Implemented typed flow-bound client helpers in `packages/client/src/action-client/executeAction.ts` and package exports in `packages/client/src/index.ts`.
- Implemented React wrappers and render surfaces in `packages/react/src/*`, including `useProjections`, simplified `useSession`, context-driven renderer resolution, and `useBlockContext`.
- Aligned core/server contracts to the React direction (`renderKey`, `clientOutput`/`llmOutput`, grouped client projections, filtered session snapshot projections).
- Added Wave 1.i unit coverage in `packages/client/test/*` and `packages/react/test/*`.
- Updated client/react package scripts in `packages/client/package.json` and `packages/react/package.json` for deterministic dependency-build-aware typecheck/test execution.
- Updated `README.md` maturity section to reflect implemented client/react package surfaces.
- Added Wave 1.i execution artifacts: `docs/waves/wave-1/wave-1.i-journal.md` and `docs/waves/wave-1/wave-1.i-changelog.md`.

### Wave 1.j implementation

- Added Wave 1.j execution plan at `docs/waves/wave-1/wave-1.j.md` aligned to canonical Wave J.
- Implemented testing harness runtime in `packages/testing/src/runtime/createTestContext.ts` with seeded in-memory stores, target lookup support, and state-change capture.
- Implemented canonical testing utilities in `packages/testing/src/test-utilities/*`:
  - `testBlock`
  - `testSequencer`
  - `testRouter`
  - `testFlow`
  - `testItems`
- Implemented snapshot trace utility in `packages/testing/src/snapshot/snapshotTrace.ts`.
- Implemented scripted generator mocks in `packages/testing/src/mocks/mockGenerator.ts`.
- Expanded testing package exports in `packages/testing/src/index.ts` and added Wave 1.j test coverage in `packages/testing/test/*`.
- Added Wave 1.j execution artifacts: `docs/waves/wave-1/wave-1.j-journal.md` and `docs/waves/wave-1/wave-1.j-changelog.md`.

### Wave 1.k implementation

- Added Wave 1.k execution plan at `docs/waves/wave-1/wave-1.k.md` aligned to canonical Wave K.
- Corrected Wave 1.k implementation per authoritative correction document by deleting the legacy web example target and replacing it with canonical `examples/*` packages.
- Added `examples/hello-chat` with a minimal generator flow, session projection, React usage sample, and flow tests.
- Added `examples/kitchen-sink` with all four block kinds, session resources/projections, user projections, router-by-context, sequencer DSL coverage, React block-renderer usage, and flow/block tests.
- Updated runtime/test infrastructure to support corrected examples:
  - persisted scope resources in execution context
  - resource-backed projection compute context in session-state route
  - `fsd:block_output` emission for block execution results
  - router selection safety for sequencer routes (thenable edge)
  - nested `state` + `resources` seeding for testing harness helpers
- Added Wave 1.k execution artifacts: `docs/waves/wave-1/wave-1.k-journal.md` and `docs/waves/wave-1/wave-1.k-changelog.md`.

### Documentation updates

- Added package-level onboarding docs:
  - `packages/client/README.md`
  - `packages/react/README.md`
  - `packages/server/README.md`
  - `packages/testing/README.md`
- Added best-practice standard for package README maintenance in `docs/BEST_PRACTICES.md` (BP-009).
- Expanded `packages/react/README.md` with hook-by-hook usage documentation (`useFlow`, `useSession`, `useProjections`, `useAction`, `useRequestStream`) and context renderer guidance.
- Renamed client builders to `createClient` and `createTypedClient` in `packages/client/src/action-client/executeAction.ts` and `packages/client/src/index.ts`, and updated related client/react tests and docs.
- Kept untyped session action execution as `session.sendAction(...)` in `packages/react/src/hooks/useSession.ts` until typed session actions are introduced.
- Updated `packages/client/README.md` for snapshot query options (`include_items`, scope-grouped `projections`).
- Replaced `packages/testing/README.md` scaffold notes with concrete API documentation for Wave 1.j testing utilities.
- Updated root `README.md` documentation map to link directly to package-level READMEs.

### Block execution and generator model correction

- Refactored core block execution contract so framework behavior lives on `block.run(...)` in `packages/core/src/blocks/internal/build-block.ts`, with `config.execute` left as user-provided logic only.
- Added generator model abstraction types in `packages/core/src/types/model.ts` and wired `resolveModel` onto `BlockContext` in `packages/core/src/types/block.ts`.
- Reworked generator runtime in `packages/core/src/blocks/generator.ts` to:
  - remove hidden test-context mock hooks
  - resolve models through `ctx.resolveModel(modelId, blockName)`
  - execute model-requested tool blocks via `tool.run(...)`
  - remove legacy `generate` callback fallback so model resolution is the only generation path
- Updated core block dispatch internals to use `run()`:
  - `packages/core/src/blocks/sequencer.ts`
  - `packages/core/src/blocks/router.ts`
- Updated server runtime to call `run()` and wire model resolution:
  - execution dispatch/executors in `packages/server/src/execution/*`
  - context wiring in `packages/server/src/context/*`
  - route/action bootstrap options in `packages/server/src/routes/*` and `packages/server/src/execution/types.ts`
- Migrated testing mocks to the model boundary:
  - added `createMockModelResolver` in `packages/testing/src/mocks/mockGenerator.ts`
  - removed hidden context-property injection from `packages/testing/src/runtime/createTestContext.ts`
  - added `models` fallback mocking support in `packages/testing/src/test-utilities/types.ts`
- Updated unit tests across `packages/core/test/*`, `packages/server/test/*`, and `packages/testing/test/*` to validate the new `run()` and model-resolver behavior.
- Updated onboarding docs for changed public behavior in:
  - `README.md`
  - `packages/server/README.md`
  - `packages/testing/README.md`
- Added AI SDK adapter and tests:
  - new server utility `createAiSdkModelResolver` (`packages/server/src/models/createAiSdkModelResolver.ts`)
  - new server tests using `MockLanguageModelV3` from `ai/test` (`packages/server/test/ai-sdk-model-resolver.test.ts`)
- Fixed `testFlow` generator mocking parity with `testBlock` by adding `generators` / `models` / `unmockedGeneratorPolicy` options and forwarding them through a mock model resolver.
- Added built-in production resolver wiring:
  - new `createDefaultModelResolver` using Vercel AI Gateway (`packages/server/src/models/createDefaultModelResolver.ts`)
  - `createExecutionContext` now defaults to this resolver when `modelResolver` is omitted, so generator blocks call AI SDK without explicit app wiring.
- Expanded AI SDK resolver behavior/tests:
  - added best-effort structured-output handling from `outputSchema` (JSON response format hint + JSON text parsing fallback)
  - added adapter-call assertions for `maxTokens`, `signal`, tools, and prompt forwarding in `packages/server/test/ai-sdk-model-resolver.test.ts`.

- Updated root docs to reference `examples/hello-chat` and `examples/kitchen-sink`.
