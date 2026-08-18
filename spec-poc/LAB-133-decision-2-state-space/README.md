# LAB-133 spec-poc — Decision 2 state-space map

THROWAWAY. Never merges. Closes with spec PR #1320.

## What this settles

Decision 2's three-way ending table, and the coupling it rests on, run against a real
task board and a real detached runner (a scripted worker stands in for the Claude Code
agent block — this tests the *board and runner's* behaviour, not the SDK). Plus the
spec's §5 readback example, run against the real HTTP route.

## Setup (once)

`spec-poc/` deliberately carries no `package.json` (see `spec-poc/README.md`), so it has
no `node_modules` of its own. `@flow-state-dev/*` imports resolve via the root
`tsconfig.base.json` path map (this directory's `tsconfig.json` extends it, and
`TSX_TSCONFIG_PATH` points `tsx` at it), but a bare npm dependency like `zod` needs an
actual `node_modules` entry. One symlink, reusing the real one `pnpm install` already
built for the `goals/` workspace package:

```
mkdir -p spec-poc/LAB-133-decision-2-state-space/node_modules
ln -sf ../../../node_modules/.pnpm/zod@3.25.76/node_modules/zod \
  spec-poc/LAB-133-decision-2-state-space/node_modules/zod
```

(`node_modules` is git-ignored, so this doesn't ride the commit — recreate it locally
before running.)

## Run

```
TSX_TSCONFIG_PATH=spec-poc/LAB-133-decision-2-state-space/tsconfig.json pnpm tsx spec-poc/LAB-133-decision-2-state-space/route-map.mts
TSX_TSCONFIG_PATH=spec-poc/LAB-133-decision-2-state-space/tsconfig.json pnpm tsx spec-poc/LAB-133-decision-2-state-space/detached-three-way.mts
TSX_TSCONFIG_PATH=spec-poc/LAB-133-decision-2-state-space/tsconfig.json pnpm tsx spec-poc/LAB-133-decision-2-state-space/workstream-readback.mts
TSX_TSCONFIG_PATH=spec-poc/LAB-133-decision-2-state-space/tsconfig.json pnpm tsx spec-poc/LAB-133-decision-2-state-space/workstream-readback-sqlite.mts
```

Each prints a table, then the same data as raw JSON.

## Files

- `route-map.mts` — every task-board settlement route decision 2 touches or is adjacent
  to (`complete`, `fail` with/without/exhausting retry budget, `cancel`, a displaced
  claim), each run as a real 2-task board (target + a dependent with `deps: [target]`) so
  `depsSatisfied` and `task-board-meta`'s `terminationReason` are read off real execution,
  not re-derived. Inline dispatch — the recording mechanism (`recordSuccess`/`recordError`)
  is identical whether a worker runs inline or detached; only *where* it runs differs. The
  displaced-claim scenario forces a real lease lapse (a real 1.15s sleep past a 1s lease)
  rather than simulating one.
- `detached-three-way.mts` — the same three endings, this time through the actual
  `dispatch: { mode: "detached" }` hand-off (spawn → start gate → ticket re-mint → worker
  router → `recordSuccess`/`recordError`), plus the coupling-harm demonstration: give a
  task a retry allowance, have the worker signal an agent-side failure by *throwing*
  (the pre-decision-2 behaviour) instead of returning, and count how many genuinely
  separate detached child sessions get spawned for the same task.
- `workstream-readback.mts` — the spec's §5 example against the in-memory store.
- `workstream-readback-sqlite.mts` — the `include_items` half redone against
  `@flow-state-dev/store-sqlite` (`:memory:`), because the in-memory adapter is
  documented to ignore `withItems` (`packages/engine/src/stores/types.ts:362-367`,
  "adapters that store items inline ignore the flag") — it stores items inline, so the
  first run's "items present either way" result is a property of *that adapter*, not of
  the route. SQLite stores items in a separate table and does branch on the flag
  (`packages/store-sqlite/src/request-store.ts:434`).

## Headline result

Decision 2's *proposed* signal — an agent-side failure **returns** an errored handle —
routes through `recordSuccess` → `collection.complete()`, which is output-shape-blind: the
row ends up `status: "completed"`, indistinguishable from real success. A dependent task
with `deps: [target]` runs (the "failure" satisfied `depsSatisfied`), and the board's
`task-board-meta` completed item reports `terminationReason: "all-completed"`. A retry
budget set on the task (`maxAttempts: 5`) is never consulted — not because it was
correctly bypassed, but because `complete()` doesn't look at it. Reproduced twice: inline
(`route-map.mts`, scenario `agent-failure-RETURNS`) and through the real detached runner
(`detached-three-way.mts`, scenario `three-way-agent-failure-RETURNS`).

Two existing routes already have the shape decision 2's first row actually needs —
terminal, non-`completed`, `depsSatisfied`-blocking, no automatic retry: `cancel()`, and
`fail()` when the task carries no retry budget (or has exhausted it). Neither is what the
current proposal routes an agent-side failure through.
