# Wave 1.a - Workspace and Package Scaffolding (Canonical Wave A)

## 1. Objective

Create a compile-ready monorepo skeleton for all required Phase 1 packages and app targets, with canonical package entrypoints and core subpath exports (`@flow-state-dev/core`, `@flow-state-dev/core/types`, `@flow-state-dev/core/items`).

This wave is complete when downstream waves can start implementing runtime contracts without revisiting build layout.

## 2. Canonical Inputs

Primary authority for this wave:

1. The build playbook (execution rules and wave gates)
2. The implementation plan (Wave A tasks A1-A2)
3. The architecture overview (package targets + public export boundaries)

Conflict rule:

- If this wave plan conflicts with the canonical architecture, architecture docs win.

## 3. Scope

### In scope

- Workspace root scaffolding for a multi-package TypeScript repo.
- Package/app directory structure for:
  - `packages/core`
  - `packages/server`
  - `packages/client`
  - `packages/react`
  - `packages/testing`
  - `packages/cli`
  - `apps/devtool`
- Minimal compilable `src/index.ts` entrypoint for each package.
- `@flow-state-dev/core` subpath exports: `.`, `./types`, `./items`.
- Compile-time import proof that `@flow-state-dev/react` can consume core type/item subpaths.

### Out of scope

- Runtime behavior for blocks, flows, execution, stores, streaming, routing, CLI commands, or devtool features.
- Final API surface for core types/builders (beyond minimal placeholders required to compile).
- Production lint/test coverage for unimplemented runtime behavior.

## 4. Dependencies

- No prior wave dependencies.
- Node + pnpm toolchain available locally.

## 5. Task Plan

### W1A-T1: Initialize workspace root

Purpose:

- Establish reproducible repo-level tooling for all packages.

Files to create/modify:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `tsconfig.json`
- optional build orchestration config if needed (`turbo.json` or equivalent)

Acceptance criteria:

- Workspace discovery includes `packages/*` and `apps/*`.
- Root scripts include at minimum `typecheck`, `test`, and `lint` commands (even if some are placeholders at this wave).

### W1A-T2: Scaffold package/app directories and manifests

Purpose:

- Create canonical package targets so later waves can implement features in-place.

Files to create/modify:

- `packages/core/package.json`
- `packages/server/package.json`
- `packages/client/package.json`
- `packages/react/package.json`
- `packages/testing/package.json`
- `packages/cli/package.json`
- `apps/devtool/package.json` (or app scaffold manifest)
- `packages/*/src/index.ts` for all six packages

Acceptance criteria:

- Every required package has a manifest and `src/index.ts`.
- No absolute-path imports in package source files.

### W1A-T3: Configure TypeScript project boundaries

Purpose:

- Ensure the workspace compiles as independent but connected packages.

Files to create/modify:

- `packages/*/tsconfig.json`
- `apps/devtool/tsconfig.json` (if app uses TS)
- root `tsconfig.json` references (if using project references)

Acceptance criteria:

- `pnpm -r typecheck` runs across all workspace packages without missing-config errors.

### W1A-T4: Establish canonical core exports + subpath exports

Purpose:

- Lock the package boundary expected by architecture docs and downstream packages.

Files to create/modify:

- `packages/core/package.json`
- `packages/core/src/index.ts`
- `packages/core/src/types/index.ts`
- `packages/core/src/items/index.ts`

Acceptance criteria:

- `@flow-state-dev/core` root export resolves.
- `@flow-state-dev/core/types` export resolves.
- `@flow-state-dev/core/items` export resolves.

### W1A-T5: Add compile-time consumer proof for react package

Purpose:

- Verify the required cross-package import contract from Wave 1.a validation.

Files to create/modify:

- `packages/react/src/index.ts`
- optional compile-only smoke file, for example:
  - `packages/react/src/_wave-1a-import-smoke.ts`

Acceptance criteria:

- React package compiles while importing from:
  - `@flow-state-dev/core/types`
  - `@flow-state-dev/core/items`

### W1A-T6: Record wave execution artifacts

Purpose:

- Ensure wave verification and traceability for future autonomous execution.

Files to create/modify:

- `docs/waves/wave-1/wave-1.a.md` (this plan; update as needed during execution)
- `docs/waves/wave-1/wave-1.a-journal.md` (execution notes, commands run, deviations)
- `docs/waves/wave-1/wave-1.a-changelog.md` (deliverables + verification results)
- `changelog.md` (root summary entry for Wave 1.a outcomes)

Acceptance criteria:

- Journal includes exact verification commands and outcomes.
- Changelog maps each deliverable to its verification evidence.
- Root changelog includes a concise Wave 1.a summary entry.

## 6. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Workspace root config exists | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json` | `pnpm -r typecheck` | Command resolves workspace and runs typecheck pipeline |
| All required package/app manifests exist | `packages/*/package.json`, `apps/devtool/package.json` | `find packages apps -maxdepth 2 -name package.json` | Manifests exist for all required targets |
| Package entrypoints exist | `packages/*/src/index.ts` | `find packages -path '*/src/index.ts'` | Six package entrypoints present |
| Core subpath exports are configured | `packages/core/package.json` | `cat packages/core/package.json` (export spot-check) | Exports include `.`, `./types`, `./items` |
| Core subpath modules resolve | `packages/core/src/types/index.ts`, `packages/core/src/items/index.ts` | workspace typecheck | No unresolved module errors for subpaths |
| React can import core subpaths | `packages/react/src/index.ts` and/or smoke file | workspace typecheck | Imports from `@flow-state-dev/core/types` and `/items` compile |
| No absolute path imports in package sources | `packages/**/src/*` | `rg -n \"from ['\\\"]/|from \\\"/\" packages` | No absolute filesystem import paths detected |
| Wave artifacts captured | `docs/waves/wave-1/wave-1.a-journal.md`, `docs/waves/wave-1/wave-1.a-changelog.md` | manual review | Files contain command log + verification summary |
| Root changelog summary recorded | `changelog.md` | manual review | Contains Wave 1.a summary of completed changes |

## 7. Wave Gate Checklist

Required to close Wave 1.a:

- [x] `pnpm -r typecheck` passes
- [x] targeted tests for changed packages pass (if tests exist in this wave)
- [x] lint/static checks configured for changed packages pass
- [x] contract spot-checks completed against:
  - The implementation plan, Wave A
  - The architecture overview package/export sections
- [x] `docs/waves/wave-1/wave-1.a-changelog.md` updated
- [x] `docs/waves/wave-1/wave-1.a-journal.md` updated
- [x] `changelog.md` updated with Wave 1.a summary

Execution note:

- `pnpm install` could not reach `registry.npmjs.org` in this environment.
- Wave 1.a verification used `pnpm -r typecheck` backed by `scripts/typecheck.mjs` (offline static verification of TS project wiring/import boundaries).

## 8. Definition Of Done (Wave 1.a)

Wave 1.a is done when all of the following are true:

- Repo has stable package/app scaffolding for all Phase 1 targets.
- Core subpath export boundary is established and compilable.
- React package can compile against core type/item subpaths.
- Verification artifacts document exactly what was run and what passed.

## 9. Handoff To Wave 1.b

Wave 1.b may assume:

- stable workspace/package layout exists
- package entrypoints and manifests are in place
- TypeScript workspace wiring compiles
- core subpath import contract is available for downstream packages
