# @flow-state-dev/orchestration

The orchestration substrate for flow-state-dev. One package, three layers that
build on each other:

- **Task substrate** — the `Task` schema and state machine, the storage-agnostic
  `TaskCollection`, and the dispatcher catalog.
- **Task board** — a concurrent drain over a `TaskCollection` with dependency
  gating and per-task worker routing. The orchestration primitive that
  `supervisor`, `parallelTasks`, and `planAndExecute` (in `@flow-state-dev/patterns`)
  are built on.
- **Skills** — user-editable `SKILL.md` folders injected as inline instructions,
  optionally with a `workers:` field that installs a private delegation board,
  the agent-callable `taskTools` surface, per-worker tools, and `runBoard`.

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

`taskBoard({ name, collection, workers, ... })` returns
`{ drain, collectionId, capability, backing, hasIdlessInitialTasks }`.
Mount `board.drain` in a sequencer. `workers` is a single uniform worker or a
`{ [assignee]: block }` registry; each task's `assignee` routes it. Config:
`concurrency` (default 4), `dispatcher` (default `"topological"`),
`onIdle` (`"complete-or-blocked"` default | `"complete"` | `"wait"`), `initialTasks`,
`onError`, and `maxIterations` (loop-cap, default 10000). Per-task retries are set
via `maxAttempts` on each task (`TaskInit`), not on the board. See the
[Task Board guide](https://flow-state.dev/docs/orchestration/task-board).

### goalSeekLoop

```ts
import { goalSeekLoop } from "@flow-state-dev/orchestration/task-board";
```

`goalSeekLoop({ name, board, seed?, judge, maxIterations, finalize?, ... })` wraps a
board's drain in an outer, judge-gated loop: seed → drain → judge → (replan) →
repeat → finalize. The `judge` returns a three-way `Verdict`
(`done`/`continue`/`replan`); `maxIterations` is a mandatory finite backstop, and
the loop lands with a typed `goal-seek-loop-termination` item rather than hanging.
It generalizes the `taskLoopBack` helper into a real primitive; the board must be
request- or resource-backed. `parallelTasks` and `planAndExecute` are expressed on
it. See the [GoalSeekLoop guide](https://flow-state.dev/docs/orchestration/goal-seek-loop).

## Skills and delegation

A skill is inline instructions injected into a generator's prompt. Bind skills to
**one** generator with `createSkillsLibrary` — no shared bag, no cross-agent bleed —
and configure the binding where the generator is defined:

```ts
import { createSkillsLibrary } from "@flow-state-dev/orchestration";

const skills = createSkillsLibrary({ catalog, initialSkills });

// Preload a skill, fails loud on a typo:
generator({ uses: [skills.with({ active: ["detailed-analysis"] })] });

// Let the agent load a skill mid-turn, stored in this generator's block state
// (the binding installs the block-state field for you):
generator({
  uses: [skills.with({ allowed: ["deep-research"], dynamicActivation: true })],
});
```

A skill that declares a `workers:` field turns on **delegation**. Binding it installs
a private task board (own-state, scoped to that generator), the eight `taskTools`
(`addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`,
`updateTask`, `listTasks`), one callable tool per worker, `runBoard`, and a guidance
context. The generator orchestrates: call a worker tool for a single unit of work
(result returns inline), or plan a graph with `addTask` (assignee, deps, structured
input) and call `runBoard` once — the board drains under concurrency with dependency
gating and returns every task's output. Workers materialize at runtime, so
`agent-ref` workers resolve through the library's `agentRegistry`/`materializeAgent`
options and runtime-activated worker skills contribute their tools too. With no
delegation board resolvable, a stray `taskTools` call returns
`{ ok: false, error: "no_delegation_board" }` rather than throwing.

```ts
// "research-lead" declares workers: → delegation installs automatically.
generator({ uses: [skills.with({ active: ["research-lead"] })] });
```

For a graph fixed in code (seeded `initialTasks`, custom collection, tuned
dispatcher), put a `taskBoard(...).drain` or a `goalSeekLoop` in the generator's
`tools:` — any block can be a tool, and only the finalized result re-enters the
caller's history.

See [Per-generator binding](https://flow-state.dev/docs/skills/binding) for the
`active` / `allowed` / `activeState` surface and
[Delegation](https://flow-state.dev/docs/skills/delegation) for the `workers:` shape.

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
