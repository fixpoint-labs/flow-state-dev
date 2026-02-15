# Changelog

All notable implementation-repo changes are recorded here as concise, wave-level summaries.

## 2026-02-15

### Planning foundation

- Added Wave A execution plan at `docs/waves/wave-a.md` aligned to canonical Wave A.
- Added Wave B execution plan at `docs/waves/wave-b.md` aligned to canonical Wave B.
- Added reusable wave template at `docs/waves/WAVE_TEMPLATE.md`.
- Added living best-practices log at `docs/BEST_PRACTICES.md`.
- Added compact architecture cheat sheet at `docs/ARCHITECTURE_CHEAT_SHEET.compact.md`.
- Added implementation repo process guidance at `README.md`.
- Established dual changelog policy: per-wave journal/changelog plus root `changelog.md` summaries.
- Standardized wave naming to lettered identifiers (`Wave A`, `Wave B`, ...) and renamed wave files accordingly.

### Wave A implementation

- Initialized workspace root tooling with `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, and root `tsconfig.json` references.
- Scaffolded required Phase 1 package/app targets under `packages/*` and `apps/devtool` with manifests and TypeScript configs.
- Added minimal `src/index.ts` entrypoints for all six required packages plus `apps/devtool/src/index.ts`.
- Established canonical `@flow-state-dev/core` subpath exports for `.`, `./types`, and `./items` with corresponding source modules.
- Added React compile-time smoke import proof from `@flow-state-dev/core/types` and `@flow-state-dev/core/items`.
- Added offline Wave A typecheck verifier at `scripts/typecheck.mjs` due registry unavailability in this environment.
- Added Wave A execution artifacts: `docs/waves/wave-a-journal.md` and `docs/waves/wave-a-changelog.md`.
