# POC · can a request-dependent `uses` replace a static `createTask`?

Throwaway design evidence for [FIX-2538](../../SPEC.md) D2. Not production code, in no default
build, test, lint or knip discovery. Nothing outside this folder imports it.

## How to run it

It imports `../src` and `./helpers`, so it runs from `packages/core/test/`:

```bash
cp specs/issues/FIX-2538/poc/dynamic-uses-override/override.test.ts packages/core/test/zz-poc.test.ts
pnpm --filter @flow-state-dev/core exec vitest run test/zz-poc.test.ts   # 6 pass
rm packages/core/test/zz-poc.test.ts
```

No key, no model: a scripted model records the tools it was offered and runs `createTask`.

## What it showed (2026-11-05): REFUTED, adopt C

| Case | Result |
|---|---|
| A · static board `createTask` + a dynamic same-named one | Throws `two tools named "createTask"` (`assertUniqueToolNames`): `uses` concatenates, with no override |
| B · the wrapper as a catalog tool behind a `tools:` fence | **Silently dropped**; the unwrapped static `createTask` runs |
| C · the board tools resolved only per request | One `createTask`, the wrapped one, runs |
| D · a separate generator with fixed `tools: [wrapped]` | One `createTask`, the wrapped one, runs |
| E · static board + fixed `tools: [wrapped]` | Throws, as A |
