# @flow-state-dev/orchestration

The orchestration substrate for flow-state-dev. One package, three layers that
build on each other:

- **Task substrate** — the `Task` schema and state machine, the storage-agnostic
  `TaskCollection`, and the dispatcher catalog.
- **Task board** — a concurrent drain over a `TaskCollection` with dependency
  gating and per-task worker routing. The orchestration primitive that
  `supervisor`, `parallelTasks`, and `planAndExecute` (in `@flow-state-dev/patterns`)
  are built on.
- **Skills** — user-editable `SKILL.md` folders that materialize into runnable
  pattern boards, plus the agent-callable `taskTools` surface.

Layering: `core → orchestration → patterns`. This package depends only on
`@flow-state-dev/core` and never imports from `patterns` or `workforce`.

```bash
pnpm add @flow-state-dev/orchestration
```

## Task substrate

```ts
import { taskSchema, type Task } from "@flow-state-dev/orchestration";
```

A `Task` is the unified work-unit record: `id`, `goal`, `status`, `deps`, `lease`,
`attempts`, optional typed `input`/`output`. Status enum:
`pending | in_progress | blocked | awaiting_review | completed | errored | cancelled`.

```
pending ─┬─→ in_progress ─┬─→ completed
         │                 ├─→ errored
         │                 ├─→ awaiting_review ─┬─→ pending  (resumeFromReview)
         │                                       └─→ cancelled
         │                 └─→ pending          (reclaim — stale lease)
         ├─→ blocked ─→ pending  (unblock)
         └─→ cancelled
```

### TaskCollection

`getOrCreateTaskCollection` resolves a CAS-safe `TaskCollectionRef` over one of
three backings — sequencer-state (default, per board invocation), request-state
(survives block boundaries within a request), or resource-collection (outlives the
request: a user's queue, an org work pool). Every mutation emits a `task-change`
component item.

```ts
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";

const collection = getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "plan" });
await collection.addTask({ goal: "research the topic" });
await collection.addTask({ goal: "draft the post", deps: ["research"] });
```

### Dispatchers

`fifoDispatcher`, `topologicalDispatcher` (default — respects `deps`),
`priorityDispatcher`, `classifierDispatcher({ classify })`, and
`eventDispatcher({ topicFor })`. All delegate to `collection.claim`, so CAS retry
and lease stamping run uniformly.

## Task board

```ts
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
```

`taskBoard({ name, collection, workers, ... })` returns `{ block, collectionId, capability }`.
Mount `board.block` in a sequencer. `workers` is a single uniform worker or a
`{ [assignee]: block }` registry; each task's `assignee` routes it. Config:
`concurrency` (default 4), `dispatcher` (default `"topological"`),
`onIdle` (`"complete-or-blocked"` default | `"complete"` | `"wait"`), `initialTasks`,
`onError`, `maxAttemptsPerTask`. See the
[Task Board guide](https://flow-state.dev/docs/orchestration/task-board).

## Skills + taskTools

```ts
import { createSkillsCapability, taskTools } from "@flow-state-dev/orchestration";
import { defaultPatternRegistry } from "@flow-state-dev/patterns";

export const skillsCap = createSkillsCapability({
  catalog: { /* tool catalog */ },
  initialSkills,
  patternRegistry: defaultPatternRegistry, // enables `pattern: task-board` skills
});
```

`taskTools` exposes eight handler-shaped tools an agent calls by name —
`addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`,
`updateTask`, `listTasks` — that mutate the active pattern's board. With no pattern
active each returns `{ ok: false, error: "no_active_pattern" }` rather than throwing.
Composed by default whenever `patternRegistry` is set; pass `taskTools: false` to opt out.

The concrete `defaultPatternRegistry` (which wires `taskBoard`, `supervisor`,
`planAndExecute`, etc.) lives in `@flow-state-dev/patterns` and is injected at
runtime, so this package stays free of a dependency on `patterns`.

## Documentation

- [Orchestration overview](https://flow-state.dev/docs/orchestration/overview)
- [Task substrate](https://flow-state.dev/docs/orchestration/task-substrate)
- [Task board](https://flow-state.dev/docs/orchestration/task-board)
- [Flow policy](https://flow-state.dev/docs/orchestration/flow-policy)
- [Skills](https://flow-state.dev/docs/skills/overview)

## Running tests

```bash
pnpm --filter @flow-state-dev/orchestration test
```
