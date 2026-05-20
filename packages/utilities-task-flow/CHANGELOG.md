# @flow-state-dev/utilities-task-flow

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-18 — Configurable downstream information flow on Task Board (FIX-610)

New package. Ships two independent layers that plug into `taskBoard` and the patterns built on it: a per-tool result cache and a per-task observation policy. Tool blocks opt into memoization via `cacheable: true` or `cacheable: { ttl, scope, keyFn, cacheIf }`. Identical calls within the configured scope (`run` / `request` / `session`) serve from cache; identical in-flight calls in one request coalesce to a single execution. Errors are never cached. `TaskBoardConfig.flowPolicy` controls which prior-task observations a freshly dispatched worker sees on its `TaskWorkerInput.priorWork` slot. Built-in policies: `flowPolicy.none`, `declaredDepsOnly`, `ancestors`, `recentTrajectory`, `allCompleted`, `compact`, `custom`.
