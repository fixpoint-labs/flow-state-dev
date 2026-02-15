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
