# FIX-2067 · Spike findings: TypeScript 5.7 → 6.0 → 7

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · **Spike findings**

Measurement spike, run 2026-10-20 on a local branch off `main` @ `364f5ba22`. The branch was never pushed, and its probe diffs are not retained: they mostly replayed per-package pins the implementation deletes. **The break lists and the alias recipe below are the reproducible record**, with [`timings.txt`](timings.txt) holding every timed run (runs marked `rc≠0` were probes in progress, not results). Phasing and the open fork are in [DECISIONS.md](../DECISIONS.md#open).

The one hunk an implementer needs, the root `package.json` alias pair:

```diff
- "typescript": "^5.7.3",
+ "@typescript/native": "npm:typescript@^7.0.2",
+ "typescript": "npm:@typescript/typescript6@^6.0.2",
```

## Machine
4 vCPU (Intel Xeon @ 2.10GHz, `nproc`=4), 15 GiB RAM, no swap. Node 22.22.2, pnpm 10.4.1, turbo 2.9.x (default concurrency 10). Firecracker VM. Compare timings with each other, not as absolute numbers.

## Pre-checks
- **No TS 6 or 7 entry point exists** in `package.json` or `scripts/`. No `tsgo`, `@typescript/native-preview` or `tsc6` references.
- **`scripts/typecheck.mjs` hardcodes** `tscPath = <root>/node_modules/.bin/tsc` (spawns `tsc -p <config> --noEmit` for `tsconfig.json` then `tsconfig.test.json`). It doesn't resolve through the `typescript` package, so whichever package owns the root `.bin/tsc` is what runs.
- **Not every package goes through typecheck.mjs.** 15 workspaces (apps/docs, kitchen-sink, pattern-benchmark, all examples, goals, all labs, integration-tests) run plain `tsc` from their own `node_modules/.bin`. **Today they run TS 5.9.3**, because they pin `^5.9.3` locally; the root and typecheck.mjs packages run 5.7.3, and apps/docs pins `~5.7.0`. The repo is already split across two TS versions.
- `turbo.json`: `typecheck` dependsOn `^build`, so a forced `turbo run typecheck` also rebuilds 28 packages. Every package build is `tsc -p tsconfig.json` (+ `add-esm-extensions.mjs`). No tsup/tsdown/api-extractor anywhere. Exceptions: `shift-manager` runs `vite build` before tsc, and `ui` runs `tsx scripts/build-registry.ts`.
- Lockfile `typescript@7.0.2` came in only through `fallow-type-aware` (optional dep of `fallow`). It isn't on the compile path.
- **TS 7 ships as the `typescript` package itself** (7.0.2 = `latest`). Its `bin/tsc` is a node shim that execs the per-platform Go binary (`@typescript/typescript-linux-x64` etc). `require("typescript")` exports **only** `{ version, versionMajorMinor }`; the rest is `typescript/unstable/*`. **There's no JS compiler API in 7.0** (the release notes promise a different API in 7.1).
- The official side-by-side route is the **`@typescript/typescript6`** package (6.0.2, bin `tsc6`, full 6.0 JS API), installed through npm aliases:
  ```json
  "@typescript/native": "npm:typescript@^7.0.2",
  "typescript": "npm:@typescript/typescript6@^6.0.2"
  ```
  `typescript-eslint`'s own error message on TS 7 points here. `@typescript/native-preview` (`tsgo`) is the old nightly channel; don't use it.

## Timings
All runs from the worktree root with the FSDEV_* env exported. "Cold" = first forced run including the 28 dependency builds; OS page cache was not dropped (couldn't be), so it's cold for turbo/tsc, not for disk. "Warm" = `--only` (typecheck tasks only, builds already present), forced. Peak mem = peak system "used" during the run minus the pre-run baseline (sum across all processes), plus the largest single process RSS seen. No run OOMed.

| | 5.7.3 (baseline) | 6.0.3 | 7.0.2 (side-by-side, green) |
|---|---|---|---|
| Cold: `npx turbo run typecheck --force` (28 builds + 47 typechecks) | **294.6s** | **224.9s** | **69.5s** ¹ |
| Warm: `npx turbo run typecheck --only --force` run 1 / 2 (/3) | **221.7 / 211.9 / 220.0s** | **200.7 / 200.6s** | **59.3 / 59.0s** (57–58s on bare 7.0.2 with 2 pkgs failing) |
| Full root `TURBO_FORCE=true pnpm typecheck` (turbo + 4 validators + goals guard) | ≈312s (composed: 294.6 + 17.3 validators) | ≈240s (composed: 224.9 + 15.1) | **76.4 / 77.3 / 78.5s measured** |
| `packages/core` alone, `node ../../scripts/typecheck.mjs` (both programs) | 15.0 / 14.8s | — | 2.6 / 2.7s |
| core `tsconfig.test.json` `--extendedDiagnostics` check time | 10.45s check, 12.58s total, 736 MB | — | 1.84s check, 2.37s total, 587 MB |
| Peak system memory delta, warm runs | 6.3–6.4 GB | 6.5–6.9 GB | 4.1–4.6 GB |
| Max single-process RSS | ~1.25 GB | ~1.2 GB | ~1.2 GB |
| Speedup vs 5.7, warm typecheck-only | 1.0× | ~1.07× | **~3.6×** |

¹ 72/74 tasks passed (goals + orchestration had errors but tsc ran to completion), so the timing stands.

TS 7 tuning probes (warm, typecheck-only, side-by-side):

| | wall | peak mem delta |
|---|---|---|
| default (`--checkers 4`), turbo concurrency 10 | 59.0–59.3s | 4.1–4.6 GB |
| default, `--concurrency=4` | 60.1s | 2.4 GB |
| default, `--concurrency=2` | 71.4s | 1.0 GB |
| `--checkers 1` added in typecheck.mjs, concurrency 10 | **52.7s** | 4.2 GB |
| `--checkers 1`, `--concurrency=4` | 54.8s | **2.2 GB** |
| core alone with `--checkers 1` | 4.1s (vs 2.7s default) | |

On this 4-core box turbo already saturates the CPUs, so tsgo's internal checkers just add contention: `--checkers 1` is ~11% faster across the repo and slower only for a single package run alone. Note: 15 workspaces call `tsc` directly, so the flag only reached the 32 typecheck.mjs packages in this probe.

Builds: TS 7 `pnpm build` from clean (no tsbuildinfo): core 1.8s vs 10.6s on 6, orchestration 1.6s vs 9.1s. Emitted `.js` is **byte-identical** between 6 and 7 (sourcemaps differ). 17/376 `.d.ts` in core and 21 in orchestration differ only in **union member and property order** (7's `stableTypeOrdering`), plus one spot where 7 prints `ZodTypeAny` instead of `z.ZodTypeAny` (the name is imported in that file, so it's valid). Published typings would churn cosmetically on the first 7 release.

## Break list — TS 6.0.3
The first pass reports only TS5101 (92×), because a deprecated option stops tsc before it type-checks anything. Each later layer only appeared after fixing the one above it, so the counts below come from successive probe runs.

| # | Cause | Where / count | Fix type | Example |
|---|---|---|---|---|
| 6.1 | **`baseUrl` deprecated** (TS5101, 92 errors = every tsc program extending base) | `tsconfig.base.json:16`; `apps/docs` inherits it from `@docusaurus/tsconfig` (still present in 3.10.2) | **config-only.** Delete `baseUrl`, prefix all 43 `paths` targets with `./` (TS5090 otherwise) | `tsconfig.json(3,3): error TS5101: Option 'baseUrl' is deprecated` |
| 6.2 | `paths` in per-package configs written relative to the old root `baseUrl` (TS2307, 37) | `packages/shift-manager/tsconfig.json` (`@/*`), `packages/ui/tsconfig.test.json` (`@/components/ui/*`, `@/lib/utils`) | **config-only**, rewrite relative to the declaring file (`./src/*`, `./.storybook/...`) | `'@/lib/utils'` ×22 |
| 6.3 | **`types` now defaults to `[]`**, so `@types/node` is no longer auto-included (TS2591 ×286, TS2503 `NodeJS` ×60, TS7006 ×34, TS2339 `unref` on number ×8, TS2322/2345 ×6) | 9 packages: tools, workspace, workforce, cursor, node, claude-code, harness-manager, orchestration, codex | **config-only**, `"types": ["node"]` in those 9 `tsconfig.json`. **Not** in base: client/react/ui/memory/thought-fabric don't depend on `@types/node` (TS2688 if you put it in base) | `src/exec.ts(18,26): TS2591 Cannot find name 'node:child_process'` |
| 6.4 | **`noUncheckedSideEffectImports` now true** (TS2882, 3) | kitchen-sink `app/layout.tsx:4`, `app/devtool/layout.tsx:1`; hello-chat `app/layout.tsx:3` (CSS imports) | **config-only** (`false`), or a `declare module "*.css"` shim | `side-effect import of './globals.css'` |
| 6.5 | **`strict` now defaults true** where a config doesn't set it | apps/docs (extends Docusaurus, no `strict`): TS7016 implicit-any `react` ×1 | **config-only**, `"strict": false` in docs (or add `@types/react`) | `src/pages/index.tsx(1,26) TS7016` |
| 6.6 | Declaration-portability error **TS2883** (inferred type names `CascadingRouterBlock` via `packages/orchestration/node_modules/...`) | `examples/guides/routing-with-evaluators` `src/flow.ts:36`, `src/route.ts:31` | **config-only** for this noEmit example (`declaration:false` + `declarationMap:false`); needs-code (explicit return type) if it ever emits | |
| 6.7 | **Unused `@ts-expect-error`** (TS2578, 10): 6 accepts calls that 5.7 rejected | engine ×7 (all tagged "source bug FIX-2053: FlowInstance refuses a configured flow"): `test/flow-registry-identity.test.ts:177`, `hire-plane-fence.test.ts:246`, `registry-routes.test.ts:186`, `registry/runtime-registration.test.ts:122,148,163,167`. core ×3: `test/client-projection.test.ts:218`, `test/resource.test.ts:58,68` | **needs-code.** Engine: delete the 7 directives (6 *and* 7 both accept, so the FIX-2053 bug no longer reproduces on new TS; worth confirming and closing FIX-2053). **Core: see A below** | |

Totals for 6: ~25 config lines across ~15 tsconfig files; 10 test-directive lines. No source code changes outside tests. No `moduleResolution`/`target`/`lib` breaks (base is already `Bundler`/`ESNext`/`ES2022`). `ignoreDeprecations: "5.0"` in base is harmless on 6 and 7.

Validators on 6: all pass (`validate-test-typecheck`, `validate-updater-purity`, `validate-side-chain-vocabulary`, `validate-package-boundaries`, goals `guard:control-shape`).

## Break list — TS 7.0.2 (on top of the 6 config fixes)
Everything 6 deprecates is a **hard error** in 7, so all of 6.1–6.6 are required for 7 as well. New on 7:

| # | Cause | Where / count | Fix type |
|---|---|---|---|
| 7.1 | **`baseUrl` removed** (TS5102, can't be silenced). Docusaurus' shared tsconfig still sets it | `apps/docs/tsconfig.json` (extends `@docusaurus/tsconfig`) | **config-only**, inline the Docusaurus config without `baseUrl` (`paths: {"@site/*": ["./*"]}`); verified passing |
| 7.2 | **No JS compiler API** in `typescript@7` (`require("typescript")` = version only) | Runtime: `scripts/validate-test-typecheck.mjs` (`ts.readConfigFile`, so `pnpm typecheck` fails), `goals/scripts/validate-control-shape.mts` (`ts.ScriptTarget`, `ts.forEachChild`...; also in `pnpm typecheck`), `packages/orchestration/test/tasks/task-notice.test.ts:51` (`ts.preProcessFile`; also a TS2339/TS7006 type error), `.omp/test/mailbox.test.mjs`, typescript-eslint (lint dies immediately: "typescript-eslint does not support TS 7.0") | **config-only via the side-by-side alias** (verified: all of these pass unchanged) |
| B | **`never` inference on `await p.catch(() => [])`** when `strict:false` + `strictNullChecks:true` (base config). The union `T[] \| never[]` gives `.find/.some/.filter` callbacks a `never` parameter (TS2339 ×6) | goals: `coordinators/hands-each-post-to-its-delegates/devteam.mts:124`, `projects/a-shared-project-has-one-owner-per-workstream/legs.mts:112`, `shift-manager/workers-message-each-other/legs.mts:114,224`, `workforce-privacy/two-users-share-a-project-and-nothing-else/legs.mts:331`, `people.mts:142` | **needs-code, tiny** (6 lines; probe used `.catch(() => [] as never)`, typed annotation is better). Bisected: turning on `strictFunctionTypes` fixes it, but that adds 32 new errors in goals alone, so annotate instead. **TS 6 with `--stableTypeOrdering` reproduces this**, so 6 can catch it early. 14 other `catch(() => [])` sites in the repo are unaffected. |
| A | **5.7 and 7 reject three core test calls that 6 accepts** (`render`+`contentTemplate`, `render`+`contentTemplateRef`, `expose`+`data`), so no `@ts-expect-error` state is green on both 6 and 7 | core `test/resource.test.ts:58,67/68`, `test/client-projection.test.ts:218` | **needs-code, tests only.** *Cause corrected after review:* `ResourceConfig` has **no** compile-time exclusion; only the runtime refuses these pairs. A plain contradictory `defineResource` call compiles on 5.7.3, 6.0.3 and 7.0.2. The 5.7/7 errors come from inference failing inside a generic `expect(() => …)` with an untyped callback parameter, and that also rejects valid configs (`content`+`render`). Typing the callback compiles on all three. Fix: rewrite the three tests to not lean on inference, keep `toThrow`, drop the directives. The false rejection is [FIX-2069](https://linear.app/fixpoint-labs/issue/FIX-2069). |

Validators/tools on 7 **without** the alias: `validate-test-typecheck` ✗ (TypeError reading `readFile`), goals guard ✗ (`ESNext` of undefined), lint ✗, orchestration task-notice test ✗. `validate-updater-purity` and `validate-side-chain-vocabulary` ✓: they use ts-morph, which bundles its own TypeScript (`@ts-morph/common` 0.29) and ignores the root `typescript`.

## Compiler-API consumers

| Consumer | What it uses | Works on 6? | Works on 7? | Must keep a JS-API TS alongside? |
|---|---|---|---|---|
| typescript-eslint 8.71.2 (latest 8.72.0) | parser → `typescript` `createSourceFile` (config is syntactic-only, no type-aware rules) | ✓ lint 34.6s clean (peer `>=4.8.4 <6.1.0`) | ✗ hard refusal | **Yes.** No release supports 7 (tracking typescript-eslint#10940, says ">=7.1"). Through the alias: ✓ 33.8s |
| `packages/workforce/src/codegen/typescript-module.ts` | **None.** An 18-line file exporting `typescriptExtension(entry)` (`.ts`/`.tsx` suffix check). No `typescript` import anywhere in `packages/workforce/src`. Not edited | ✓ | ✓ | No |
| `scripts/validate-test-typecheck.mjs` | `ts.readConfigFile`, `ts.parseJsonConfigFileContent`, `ts.sys`, `flattenDiagnosticMessageText` | ✓ | ✗ | **Yes** (✓ through the alias) |
| `goals/scripts/validate-control-shape.mts` (in `pnpm typecheck`) | `createSourceFile`, AST walk, `ts.is*` | ✓ | ✗ | **Yes** (✓ through the alias) |
| `packages/orchestration/test/tasks/task-notice.test.ts` | `ts.preProcessFile` (runtime + typecheck) | ✓ 18/18 | ✗ (runtime + TS2339) | **Yes** (✓ 18/18 and typechecks through the alias) |
| `.omp/test/mailbox.test.mjs`, `specs/**/poc/*` | `typescript` import | not run (POC / outside default discovery) | would fail | Yes if kept |
| ts-morph (`validate-updater-purity`, `validate-side-chain-vocabulary`, codemods) | bundled TS in `@ts-morph/common` | ✓ | ✓ (independent of root TS) | No |
| Storybook 10 (`packages/ui` `storybook:build`) | `typescript: { check: false }`, react-vite default docgen (babel `react-docgen`, not TS) | ✓ 28.5s | ✓ 26.4s | No |
| Package builds (`tsc -p tsconfig.json` + `add-esm-extensions.mjs`) | `tsc` CLI only; no tsup/tsdown/api-extractor/dts plugins | ✓ all 28 built | ✓ all 28 built, JS identical, .d.ts reorders only | No |
| vitest / tsx | esbuild transpile | ✓ | ✓ (unaffected) | No |
| fallow-type-aware (optional) | already pins `typescript@7.0.2` | n/a | n/a | No |

**Side-by-side verified end-to-end:** root `"@typescript/native": "npm:typescript@7.0.2"` + `"typescript": "npm:@typescript/typescript6@6.0.2"`; per-package pins also set to the typescript6 alias. Results: root `.bin/tsc` = 7.0.2 and `tsc6` = 6.0; `require("typescript").version` = 6.0.3; inside a package, `pnpm exec tsc` falls through to the root's 7 (package `.bin` has only `tsc6`). **`scripts/typecheck.mjs` needs no change.** The full `pnpm typecheck` is green in ~77s. The probe edited per-package package.json pins; the real change deletes them and keeps only the root.

## Candidate follow-ups, not this issue

- `tsc -b --builders` (7.0) in place of turbo's `^build` fan-out. Not measured.
- `erasableSyntaxOnly` (5.8): 0 enums, 0 namespaces, 8 parameter properties in the packages.
- `rewriteRelativeImportExtensions` (5.7) to replace `scripts/add-esm-extensions.mjs`, after a `.ts`-specifier codemod.
- `--checkers` / `--concurrency` tuning (7.0): `--checkers 1` was 11% faster here, `--concurrency 4` halved peak memory.

## Probe edits made in the spike worktree (uncommitted)
`tsconfig.base.json` (no baseUrl, `./` paths), 9 package tsconfigs (`types: ["node"]`, workforce's included; spike-only, not committed), shift-manager/ui-test paths, docs tsconfig inlined, kitchen-sink/hello-chat `noUncheckedSideEffectImports:false`, routing example `declaration(Map):false`, 7 engine directives deleted, 6 goals `.catch(() => [] as never)`, package.json pins and lockfile. `packages/workforce/src/codegen/typescript-module.ts` was read, never edited.
