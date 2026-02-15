# Changelog

All notable implementation-repo changes are recorded here as concise, wave-level summaries.

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
