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
  optionally with an `agents:` field that installs a private delegation board,
  the `taskTools` surface, and `runBoard` — the skill assigns work as tasks and
  drains the board.

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
`defaultWorker` (optional fallback for a task whose assignee is unmatched or
omitted — reached only on a miss, declared workers untouched),
`concurrency` (default 4), `dispatcher` (default `"topological"`),
`onIdle` (`"complete-or-blocked"` default | `"complete"` | `"wait"`), `initialTasks`,
`onError`, `maxIterations` (loop-cap, default 10000), and the two creation caps
`maxEnqueuedTasks` (default 100 — tasks addable while others are `pending`,
refreshes on drain) and `maxTotalTasks` (default 500 — lifetime count incl.
terminal, never refunded). Both take a positive integer or `null` (explicitly
unbounded); omission reapplies the default. They apply only when the board
constructs its own collection — a supplied `collection` is left alone and passing
both is a construction error, so configure caps on `getOrCreateTaskCollection`'s
sequencer/request backing instead. Existing declarative boards inherit the
defaults. Per-task retries are set via `maxAttempts` on each task (`TaskInit`),
not on the board. See the
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

A skill that declares an `agents:` field turns on **delegation** (or force it on
with `delegation: true` even with no `agents:`). An agent is a prompt-driven
teammate — defined inline (`prompt` / `prompt-ref`) inside the skill, or referenced
from the registry (`agent-ref`). Every delegation board also gets an on-demand
**default worker**: it materializes on demand and runs any task whose assignee is
unset, so a task with no named agent still runs — and an empty roster still
delegates. Assignment is checked against the declared roster as the task is
created: `addTask` (and `assignTask`/`updateTask`) reject an assignee that names
no declared agent, returning the available agents so the caller can correct it,
instead of letting a mistyped name fall through to the default worker at drain
time. A board with no declared agents has no roster to check and accepts any
assignee. Binding the skill installs a private
task board (own-state, scoped to that generator), the eight `taskTools` (`addTask`,
`assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`,
`listTasks`), `runBoard`, and a guidance context. The generator orchestrates by
planning a graph with `addTask` (assignee, deps, structured input) and calling
`runBoard` once — the board drains under concurrency with dependency gating and
returns every task's output. There is no per-agent tool the generator calls
directly; draining the board is the sole execution path. Agents materialize at
runtime, so `agent-ref` agents resolve through the library's
`agentRegistry`/`materializeAgent` options and runtime-activated skills contribute
their tools too. With no delegation board resolvable, a stray `taskTools` call
returns `{ ok: false, error: "no_delegation_board" }` rather than throwing. The
board is bounded by default: `addTask` is refused past 100 tasks enqueued at once
(`{ ok: false, error: "enqueued_task_cap_exceeded" }` — drain with `runBoard` to
free slots, though tasks stranded behind a failed dep stay `pending` and hold
theirs) or 500 over the board's lifetime (`total_task_cap_exceeded`, never
refunded by draining), tunable via `createSkillsLibrary`'s `maxEnqueuedTasks` /
`maxTotalTasks` (`null` = unbounded).

> **Which surfaces are capped.** The caps come from the code that CONSTRUCTS the
> collection, so they cover boards the skills library installs and boards
> `taskBoard` builds itself — not the capability surface on its own. Wiring the
> exported `taskTools` singleton by hand (`uses: [taskTools]`) resolves the host
> generator's own-state board through a bare, **uncapped** collection: `addTask`
> there is unbounded. That is deliberate — a hand-wired capability has no
> construction site to take cap options from — but do not read "delegation is
> capped" as "`taskTools` is capped". For a bounded board on that path, build the
> collection yourself with
> `getOrCreateTaskCollection({ …, maxTotalTasks, maxEnqueuedTasks })` and hand a
> resolver for it to `createTaskToolsCapability(resolver)`. That resolver must
> target the host generator's own state via `ctx.parent` (each tool runs as a
> child block, so `ctx.sequencer` is the wrong container) and name the board's
> `stateKey` — see
> [Delegation](https://flow-state.dev/docs/skills/delegation#board-and-overrides)
> for the full recipe.

```ts
// "research-lead" declares agents: → delegation installs automatically.
generator({ uses: [skills.with({ active: ["research-lead"] })] });
```

An inline agent may set `context-supply: conversation` to inherit the parent
conversation up to the point it is dispatched (fork-like), bounded to the last
several turns by default (a turn count, not a token budget), while its own steps
stay out of the host's history (output keeps `history: false`). Omitting the
field is the default: the agent is isolated and sees only its task input — there
is no `isolated` value to set. It applies to `prompt` / `prompt-ref` agents;
setting it on an `agent-ref` agent fails loud. See
[Context supply](https://flow-state.dev/docs/orchestration/context-supply).

For a graph fixed in code (seeded `initialTasks`, custom collection, tuned
dispatcher), put a `taskBoard(...).drain` or a `goalSeekLoop` in the generator's
`tools:` — any block can be a tool, and only the finalized result re-enters the
caller's history.

See [Per-generator binding](https://flow-state.dev/docs/skills/binding) for the
`active` / `allowed` / `activeState` surface and
[Delegation](https://flow-state.dev/docs/skills/delegation) for the `agents:` shape.

## Documentation

- [Authoring a delegating skill](https://flow-state.dev/guides/agents-command-the-board)
- [Orchestration overview](https://flow-state.dev/docs/orchestration/overview)
- [Task substrate](https://flow-state.dev/docs/orchestration/task-substrate)
- [Task board](https://flow-state.dev/docs/orchestration/task-board)
- [Flow policy](https://flow-state.dev/docs/orchestration/flow-policy)
- [Skills](https://flow-state.dev/docs/skills/overview)

## Running tests

```bash
pnpm --filter @flow-state-dev/orchestration test
```
