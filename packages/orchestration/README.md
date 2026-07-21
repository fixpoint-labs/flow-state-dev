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
three backings — request-state (the `taskBoard` default; survives block boundaries
within a request), block-scoped state (per board invocation — `backing: "sequencer"`
is the common case), or resource-collection (outlives the request: a user's queue, an
org work pool — declare one with `defineTaskCollection`). Every mutation emits a
`task-change` component item.

```ts
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";

const collection = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "plan" });
await collection.addTask({ id: "research", goal: "research the topic" });
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

`taskBoard({ name, collection, workers, ... })` returns `{ drain, collectionId, capability }`.
Mount `board.drain` in a sequencer. `workers` is a single uniform worker or a
`{ [assignee]: block }` registry; each task's `assignee` routes it. Config:
`concurrency` (default 4), `dispatcher` (default `"topological"`),
`onIdle` (`"complete-or-blocked"` default | `"complete"` | `"wait"`), `initialTasks`,
`onError`, and `maxIterations` (loop-cap, default 10000). Per-task retries are set
via `maxAttempts` on each task (`TaskInit`), not on the board. See the
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

### Per-generator binding (`createSkillsLibrary`)

`createSkillsCapability` activates skills into session-global state shared by
every generator. To bind a skill to **one** generator instead — no shared bag,
no cross-agent bleed — use `createSkillsLibrary` and configure the binding where
the generator is defined:

```ts
import { createSkillsLibrary } from "@flow-state-dev/orchestration";

const skills = createSkillsLibrary({ catalog, initialSkills });

// Preload a skill (inline-only), fails loud on a typo:
generator({ uses: [skills.with({ active: ["detailed-analysis"] })] });

// Let the agent load a skill mid-turn, stored in this generator's block state
// (the binding installs the block-state field for you):
generator({
  uses: [skills.with({ allowed: ["deep-research"], dynamicActivation: true })],
});

// Let the agent fork a skill into a child that inherits the conversation up to
// the fork point, works in isolation, and returns only its result. The child's
// model is set on the library via `forkModelId` (a capability tool can't read
// the host generator's resolved model):
generator({ uses: [skills.with({ allowed: ["deep-research"], fork: true })] });
```

See [Per-generator binding](https://flow-state.dev/docs/skills/binding) for the
`active` / `allowed` / `activeState` surface, and [Fork skills](https://flow-state.dev/docs/skills/fork)
for the `fork` preset and history inheritance.

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
