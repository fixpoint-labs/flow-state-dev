# FIX-2934 · The workspace package has one export

**Spec** · [Decisions](DECISIONS.md) · epic [FIX-2927](../../epics/FIX-2927/SPEC.md)

## Before and after

| A team that… | Today | After |
|---|---|---|
| **writes a harness** | Imports `privateTempRoot` from `@flow-state-dev/workspace/internal`, a subpath marked "not a public API" that Codex and Cursor use anyway | Imports it from `@flow-state-dev/workspace`, with its contract documented |
| **holds a checkout across a run** | harness-manager marks its lock live with `refreshLock` from the same internal subpath, while `acquireLock` and `releaseLock` come from the root | Takes all three lock functions from the root export |

## The goal, and how we'll know it's met

**`@flow-state-dev/workspace` publishes one entry point, and the two helpers other packages
need are part of it.**

| How we verify | |
|---|---|
| **Signal** | `rg 'workspace/internal'` finds nothing outside `specs/` and `docs/internal/`. `package.json` lists one export in `exports` and in `publishConfig.exports`. `packages/workspace/test/lock.spec.ts` and the harness-manager checkout-lease tests pass, importing from the root |
| **Control that must fail** | Today's tree: the `rg` finds three imports and `package.json` lists `./internal` twice |

No goal check through `fsdev run` applies: this is an export move with no observable runtime
change.

## What changes

- `packages/workspace/src/index.ts` exports `refreshLock` beside `acquireLock` and
  `releaseLock`, and `privateTempRoot`. Each keeps its doc comment; `privateTempRoot`'s says it
  is for files a harness hands its agent outside any checkout.
- `packages/workspace/src/internal.ts` is deleted, with the `./internal` entries in `exports` and
  `publishConfig.exports`.
- `harness-manager/src/workspace.ts`, `codex/src/turn-images.ts` and
  `cursor/src/workspace-alias.ts` import from `@flow-state-dev/workspace`.
- The `./internal` line in `docs/contributing/docs-revamp/pages/catalog/tools/workspace.facts.md`
  is corrected.
- A changeset for `@flow-state-dev/workspace` (minor): the subpath is gone, the two functions
  are on the root.

## What stays as it is

What `refreshLock` and `privateTempRoot` do. The checkout lease stays in harness-manager.

## What's already here, and the debt

**Builds on:** the lock module already public on the root (`acquireLock`, `releaseLock`,
`tryAcquireLock`). **Adds:** nothing new, two exports move. **Debt: net down,** one subpath gone.

## Sign off

D1 in [DECISIONS.md](DECISIONS.md): `refreshLock` goes public rather than becoming a host
method.
