---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/react": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/memory": minor
"@flow-state-dev/vercel": minor
---

Remove deprecated exports, compatibility shims, and one runtime env-var fallback. These are not one kind of cut, so they are grouped below by what you actually have to do: **rename an import** (one of them also moves to a different package), **redesign against a different contract** (six names have no drop-in successor, and one of them will happily compile into something that does not work), or **change an environment variable**. Start with the last of those — `FSDEV_DEBUG_ITEMS` is the only removal here that will not fail your build, so it is worth reading even if you use none of the names below. (FIX-1209)

**Renamed — change the import, nothing else.** These were exact aliases of a live name:

| Removed | Use | Package |
|---|---|---|
| `ResourceHandle` | `ResourceRef` | `core` |
| `PlanStep` / `PlanStepSchema` | `PlanTask` / `PlanTaskSchema` | `patterns` |

**Renamed *and* moved — change the name and the package.** `CollectionItem` (`react`) was a deprecated alias exported only from `@flow-state-dev/react`. Its successor `CollectionItemHandle` is exported only from `@flow-state-dev/client`, where it already lived, so a name-only edit will not resolve:

```diff
- import type { CollectionItem } from "@flow-state-dev/react";
+ import type { CollectionItemHandle } from "@flow-state-dev/client";
```

Add `@flow-state-dev/client` to your dependencies if you only depended on `@flow-state-dev/react`. React deliberately does not re-export the type: it is how `CollectionListPage` and `CollectionItemState` already reach callers, and those appear in the same hook result signatures (`UseResourceCollectionResult`, `UseResourceCollectionListResult`, `UseResourceCollectionItemResult`). If you already import from `@flow-state-dev/client`, nothing changes there — `CollectionItem` was never exported from that package.

**Removed with no equivalent successor — a caller needs to redesign, not rename.** Where a live name is pointed at below, it is a *different contract*, not a drop-in:

- **`AgentType`** (`contracts`; also gone from `@flow-state-dev/core` and `@flow-state-dev/core/items`, which re-export it) — was `"primary" | "sub" | "trace"`. Its `@deprecated Use ItemVisibility` note was wrong: `ItemVisibility` is `{ client: boolean; history: boolean }`, a different concept with a different shape. Nothing replaces the three-way tag.
- **`ContextItem`** (`contracts`; also gone from `@flow-state-dev/core/items`, whose barrel re-exports `@flow-state-dev/contracts/items` — it was never on `@flow-state-dev/core`'s root entry) — the `context` item type is already out of the `OutputItem` union, so no item of this shape is emitted. The nearest live capability is the generator `context` slot, or `ctx.emit.message` with `{ history: true, client: false }` — a different mechanism, not a renamed type.
- **`reviewOutputSchema` / `ReviewOutput`** (`patterns`) — was one aggregate per review pass: `{ assessments: [{ taskId, verdict: "accepted" | "needs-revision" | "escalate", feedback, score }], needsReplanning, overallAssessment }`. The live `reviewerVerdictSchema` is one verdict per task: `{ decision: "approve" | "reject" | "needs-revision", feedback?, scores? }`. Different cardinality, different fields, different enum values. Swapping the name compiles and produces a reviewer that does not work.
- **`BasePlanSchema`, `BasePlanTaskSchema`, `BasePlan`, `BasePlanTask`, `PlanMeta`, `PlanTaskUpdate`** (`patterns`) — retired runtime shapes from before the orchestration substrate, when the patterns drove `plan-meta` / `plan-task` component items directly. Both patterns now run on `@flow-state-dev/orchestration` and emit `task-change` / `task-board-meta`. `Task` and the component-item payloads are the live surface, but they are a different model, not a rename of these.
- **`PRE_RANK_CAP`** (`memory`) — was `50`, over a pooled candidate set. `PRE_RANK_EPISODIC_CAP` is `30` and applies to episodes only; semantic facts pass through unconditionally. Different number and different scope, so a caller that imported the constant for parity needs to re-derive its own bound.
- **`heartbeatMs`** on `VercelHandlerOptions` (`vercel`) — the option was already ignored at runtime, so removing the field is a type error with no behaviour change. SSE heartbeats come from `@flow-state-dev/engine` for every live and GET-attach stream; configure the cadence with `createFlowApiRouter({ defaultSseHeartbeatMs })` or per-flow `defineFlow({ request: { sseHeartbeatMs } })`.

**Runtime behaviour change — `FSDEV_DEBUG_ITEMS` is no longer read** (`core`). Every other cut above is a compile-time name: delete it and a stale caller fails to build. This one is a `process.env` read resolved at runtime, so it fails quietly. `isTraceObservabilityEnabled()` previously fell back to `FSDEV_DEBUG_ITEMS` when `FSDEV_TRACE_OBSERVABILITY` was unset; it now falls through to the `NODE_ENV` default instead. A deployment still setting only `FSDEV_DEBUG_ITEMS` gets no build error and no runtime error — under `NODE_ENV=production` its trace observability simply switches off, and the one-shot deprecation warning that would have flagged this was itself suppressed in production, so such a deployment was never warned. **Set `FSDEV_TRACE_OBSERVABILITY` instead** — it takes the same `true` / `false` / `1` / `0` values.

**Internal cleanup — no consumer action.** Unused barrels and leaves with no public subpath: `core`'s `src/schema/index.ts` and the `items/{events,resolve-visibility,task-attribution}.ts` re-export leaves (the `@flow-state-dev/core/items` subpath itself is not removed), `engine`'s `src/context/index.ts` and `src/utils/index.ts`, `tools`' `src/bash/adapters/index.ts`, and `patterns`' `plan-and-execute/blocks/apply-replan.ts` leaf (`createApplyReplan` is still exported from `@flow-state-dev/patterns/plan-and-execute`). Also `vercel`'s `src/config.ts` and `src/heartbeat.ts`, neither of which was reachable — the package's `exports` map lists only `.`, `./pg`, `./schedules`, `./store` and `./next`, and neither module was re-exported from the root entry. Plus the DevTool `ContextItemView` renderer for the retired `context` item, and one private helper in `core`'s resource tools. Two removed *names* belong in this category rather than in a migration table above: `ToolBinding` (`core/src/blocks/generator.ts`) and `resolveNamespaceKey` (`core/src/types/collection-patterns.ts`). Both were aliases of a live name, but neither was reachable from a published subpath — `core`'s `exports` map has no `./blocks` entry, and the `./types` entry re-exports `resolveCollectionKey` without its alias — so no consumer could have imported either one, and there is no import for you to rename.
