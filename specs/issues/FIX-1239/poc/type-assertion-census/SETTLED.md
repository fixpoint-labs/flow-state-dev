# Type-assertion census · settled counts

The spec-era measurement. These counts are authoritative; implementers do not re-run the
census as a gate ([D1](../../DECISIONS.md#d1)).

**Measured:** `main` at `4f2e13ed`, by `census.mjs` beside this file, after `pnpm packages:build`.
`packages/` is unchanged between that commit and this spec branch.

**Negative control:** `--plant` on core finds 9 of 9 planted sites, including one live alias for
each pinned constraint (`true`, `false`, `never`).

## Totals

**214 type-level assertions in 9 packages.** 128 `@ts-expect-error` directives, 65 hand-rolled
aliases (`Assert`, `Expect`, `IsTrue` pin `true`; `IsFalse` pins `false`; `AssertNever`, `NoneOf`
pin `never`), 21 `expectTypeOf`.

| package | sites | compiled today | live | failing | dead | vacuous |
|---|---:|---:|---:|---:|---:|---:|
| claude-code | 3 | 3 | 3 | 0 | 0 | 0 |
| client | 3 | 1 | 3 | 0 | 0 | 0 |
| core | 151 | 111 | 141 | 5 | 5 | 0 |
| harness-manager | 1 | 0 | 1 | 0 | 0 | 0 |
| memory | 5 | 4 | 5 | 0 | 0 | 0 |
| orchestration | 17 | 13 | 17 | 0 | 0 | 0 |
| patterns | 1 | 0 | 1 | 0 | 0 | 0 |
| react | 21 | 21 | 21 | 0 | 0 | 0 |
| workforce | 12 | 11 | 12 | 0 | 0 | 0 |
| **total** | **214** | **164** | **204** | **5** | **5** | **0** |

- **Compiled today: 164, all live.** By home: 48 in `.test-d.ts` files, 115 in `src/**/*.type-test.ts`,
  1 inline in `workforce/src/worker-capabilities.ts`.
- **Not compiled today: 50, in 26 test files.** In the program #3433 proposes: 40 live, 5 failing, 5 dead.
  All 21 `expectTypeOf` sites are among them.
- **Compiled after FIX-1343: 213.** The census's model of #3433's program opens all 214; the one
  #3433 defers is `workforce/test/codegen.test.ts:419` (a directive, live, suppresses TS2540). It is
  deferred to [FIX-2016](https://linear.app/fixpoint-labs/issue/FIX-2016), not covered.
- **0 with an `any` subject.**

## The 10 wrong sites

All in `packages/core/test/`, all uncompiled today.

| site | verdict | what it claims |
|---|---|---|
| `prefetch-mode.test.ts:56` | failing (TS2554) | a lazy collection's `list()` returns `Promise<ResourceRef<…>[]>` |
| `prefetch-mode.test.ts:62` | failing (TS2344) | an eager collection's `list()` is sync, `ResourceRef<…>[]` |
| `prefetch-mode.test.ts:66` | failing (TS2344) | an eager collection's `count()` is sync, `number` |
| `projected-resource-collection.test.ts:125` | failing (TS2554) | a projected collection infers to `ProjectedResourceCollectionRef<{ ticker; shares }>` |
| `projected-resource-collection.test.ts:148` | failing (TS2344) | `expose: ["ticker"]` projects client data to `{ ticker: string }` |
| `resource-collection.test.ts:88` | dead | omitting `scope` is a type error (the directive sits one line off it) |
| `esm-extensions-check.test.ts:2` | dead | the `.mjs` import has no declarations (multi-line import; the error is not on the next line) |
| `model-strings-check.test.ts:2` | dead | the same |
| `publish-set-check.test.ts:2` | dead | the same |
| `side-chain-vocabulary-check.test.ts:2` | dead | the same |

Five further directives (`changeset-refs`, `isolation-coordinate`, `reserved-names`, `spec-folder`,
`updater-purity` `-check.test.ts`) only silence a missing `.mjs` declaration (TS7016). They are live,
and they are not assertions about a type.
