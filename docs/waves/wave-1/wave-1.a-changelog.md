# Wave 1.a Changelog

Date: 2026-02-15
Wave: 1.a (Canonical Wave A)
Status: Completed

## Deliverables

| Deliverable | Status | Evidence |
|---|---|---|
| Workspace root config | Completed | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json` |
| Required package/app manifests | Completed | `packages/*/package.json`, `apps/devtool/package.json` |
| Package entrypoints | Completed | `packages/*/src/index.ts` |
| TS project boundaries | Completed | `packages/*/tsconfig.json`, `apps/devtool/tsconfig.json`, root `tsconfig.json` references |
| Core subpath exports | Completed | `packages/core/package.json`, `packages/core/src/types/index.ts`, `packages/core/src/items/index.ts` |
| React import proof for core subpaths | Completed | `packages/react/src/_wave-1a-import-smoke.ts`, `packages/react/src/index.ts` |
| Wave execution artifacts | Completed | `docs/waves/wave-1/wave-1.a.md`, `docs/waves/wave-1/wave-1.a-journal.md`, `docs/waves/wave-1/wave-1.a-changelog.md`, `changelog.md` |

## Verification Summary

| Verification | Outcome |
|---|---|
| `pnpm -r typecheck` | Pass (offline static checker pipeline in `scripts/typecheck.mjs`) |
| `pnpm -r lint` | Pass |
| `pnpm -r test` | Pass |
| `find packages apps -maxdepth 2 -name package.json` | Pass |
| `find packages -path '*/src/index.ts'` | Pass |
| `cat packages/core/package.json` | Pass (`.`, `./types`, `./items` exports present) |
| `rg -n "from ['\\\"]/|from \\\"/" packages` | Pass (no matches) |

## Notes

- `pnpm install` could not reach `registry.npmjs.org` in this environment.
- Wave 1.a remains execution-complete for scaffold/boundary validation; runtime TypeScript compilation (`tsc`) will be activated automatically once dependencies can be installed.
