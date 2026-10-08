---
title: Configuration
sidebar_label: Configuration
description: Field catalog for taskBoard, goalSeekLoop, createSkillsLibrary, and skills.with.
---

# Configuration

The pages for [Task board](./task-board) and [Binding skills](../skills/binding) teach the shape. The tables below list each field: name, type, default, what it does.

Flow, runtime, and environment knobs that are not orchestration-specific live next to those concepts in Core. The [Configuration map](/docs/configuration/overview) is the index.

```ts
import { taskBoard } from "@flow-state-dev/orchestration/task-board";

const board = taskBoard({
  name: "research",
  workers: researcher,
  concurrency: 4,
  dispatcher: "topological",
  onIdle: "complete-or-blocked",
  initialTasks: [{ id: "brief", goal: "Write the research brief" }],
});
```

## `taskBoard` options

`taskBoard(config)` returns a handle. Mount `board.drain` as a sequencer step. The capability on `board.capability` is what sibling blocks put in `uses` to add or list tasks.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `name` | `string` | required | Outer sequencer name and prefix for internal blocks. Unique inside a flow if you mount more than one board. |
| `boardId` | `string` | omitted | Stable id. Required when any seat holds a task dispatcher. Renaming orphans live work keyed on the old value. |
| `dispatch` | dispatch object | omitted (inline) | Dispatch mode for a **uniform** worker (a single block). Do not set this on a registry board; declare it per worker instead. |
| `collection` | request spec, sequencer spec, `defineTaskCollection`, or factory | request-backed, `collectionId` = `name` | Where the task list lives. Omit it for the request default. |
| `workers` | one block, or a name → worker map | required | A single worker runs every claimed task. A registry routes by `task.assignee`. |
| `defaultWorker` | block or task dispatcher | omitted | Registry fallback for an unknown or missing assignee. A task dispatcher here hands each of those tasks off under the assignee it names, its `flowKind` may be a [function of the task](./task-board.md#sending-a-task-to-a-flow-chosen-per-task), and a task with no assignee fails. Omit it and a miss fails the task per `onError`. |
| `concurrency` | `number` | `4` | How many workers run in parallel. |
| `maxEnqueuedTasks` | `number \| null` | `100` | Cap on tasks added while others are still `pending`. `null` is unbounded. Only when the board builds its own collection. |
| `maxTotalTasks` | `number \| null` | `500` | Cap including completed and failed tasks. Those still count after they finish. Same supplied-collection rule as `maxEnqueuedTasks`. |
| `maxTotalRetries` | `number \| null` | `50` | Cumulative failure retries across every task. `0` means run once, never retry. `unblock` / `unpark` / `reclaim` do not spend this. |
| `dispatcher` | `"fifo"` \| `"topological"` \| `"priority"` \| instance | `"topological"` | How a ready task is picked. |
| `onIdle` | `"complete-or-blocked"` \| `"complete"` \| `"wait"` | `"complete-or-blocked"` | When the pool stops. See [Task board](./task-board#termination-onidle-modes). |
| `onReview` | `"hold"` \| `"exit"` | `"hold"` | Whether a task parked with `awaitReview` keeps the drain open. `"exit"` lets the drain return and leaves the task parked; `board.unparkAndDrain` hands the answer back and drains in the same request. Needs a `defineTaskCollection` collection, the default `onIdle`, and ids on `initialTasks`. See [Task board](./task-board#waiting-on-a-person-onreview). |
| `initialTasks` | `TaskInit[]` | omitted | Tasks seeded at board start. |
| `onError` | `"skip"` \| `"fail"` | `"skip"` | `"skip"` records the failure and lets siblings continue. `"fail"` fails the board. |
| `maxIterations` | `number` | `10000` | Per-worker loop cap. A circuit breaker if enqueue cycles never drain. |
| `shouldExit` | `(collection) => boolean` | omitted | Extra stop rule for `onIdle: "wait"`. Ignored in the other modes. |
| `idlePollMs` | `number` | `50` | Sleep when a claim returns nothing. |
| `toolCache` | `boolean` \| object | on when any worker tool is `cacheable` | Per-run tool-result memoization. `false` turns it off. |
| `flowPolicy` | `TaskFlowPolicy` | `declaredDepsOnly()` | Which prior-task observations a worker sees. See [Flow policy](./flow-policy). |

`maxEnqueuedTasks`, `maxTotalTasks`, and `maxTotalRetries` apply only when the board constructs the collection (the request or sequencer forms). Passing any of them next to a supplied `defineTaskCollection` or factory is a construction error: that collection already has its own caps.

### `toolCache` object

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `enabled` | `boolean` | `true` when any tool is `cacheable` | Master switch. |
| `defaultTtl` | `number` | omitted | TTL in ms for cacheable tools that do not set their own. |
| `maxEntries` | `number` | `5000` | LRU eviction ceiling. |
| `defaultScope` | `"run"` \| `"request"` \| `"session"` | `"run"` | Scope for tools that do not set their own. `"run"` lasts for one board run. |

Narrative for termination, dispatchers, registries, and backing: [Task board](./task-board).

## `goalSeekLoop` options

`goalSeekLoop` is a drain-then-judge loop over a board. `planAndExecute` and `parallelTasks` are built on it. The board must be request- or resource-backed.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `name` | `string` | required | Outer sequencer name and prefix for internal blocks. |
| `inputSchema` | Zod schema | `z.unknown()` | Public input of the outer sequencer. |
| `activeStatusMessage` | `string` | omitted | Status text emitted before the loop runs. |
| `board` | `TaskBoardHandle` | required | The board this loop drains. Request- or resource-backed only. |
| `stateSchema` | Zod schema | omitted | Extra fields merged into loop state. They do not collide with the loop's own keys. |
| `seed` | block or sequencer | omitted | Writes the first tasks onto the board before the first drain. Optional when `initialTasks` already seeded the board. |
| `afterDrain` | block | omitted | Runs after each drain, before the judge. |
| `judge` | block, sequencer, or function | required | Returns a verdict: `done`, `continue`, or `replan`. |
| `replanner` | block | omitted | Runs on a `replan` verdict that did not include an inline `tasks` array. |
| `maxAttemptsPerTask` | `number` | omitted | Default attempts for tasks the replanner adds. |
| `taskContext` | context supply | omitted | Context attached to replanned tasks. |
| `maxIterations` | `number` | required | Hard backstop: total drains. Must be a finite integer greater than `0`. |
| `finalize` | block or sequencer | omitted | Synthesizes the settled board. Omit to return the board projection as-is. |
| `onError` | `"skip"` \| `"fail"` | `"skip"` | Judge (and replanner) errors only. `"skip"` records `{ done, "judge-error" }`. `"fail"` fails the request. A seed or drain failure always fails the request. |

Narrative: [GoalSeekLoop](./goal-seek-loop).

## `createSkillsLibrary` options

`createSkillsLibrary(options)` builds the shared catalog. Bind it per generator with `skills.with({ ... })`.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `collection` | `string` | `"skills"` | Resource key for the skills collection. |
| `catalog` | tool map | omitted | The tools a bound generator can call, and the set a skill's `allowed-tools` is validated against. Which bindings contribute it, and what `registerCatalogTools: false` leaves you to do yourself: [What tools the generator gets](../skills/binding#what-tools-the-generator-gets). |
| `registerCatalogTools` | `boolean` | `true` | Whether a binding contributes `catalog` to the generator. `false` validates a skill's `allowed-tools` against the catalog without granting any of it, leaving registration to you. See [What tools the generator gets](../skills/binding#what-tools-the-generator-gets). |
| `initialSkills` | bundled skills | omitted | Seeded the first time a generator binds this library. Required if you bind skills by name. |
| `scope` | `"org"` \| `"user"` \| `"session"` | `"org"` | Where the skills collection lives. `"org"` shares seeded skills across users. |
| `collectionConfig` | `{ maxInstances?, prefix? }` | omitted | Collection sizing and mount prefix. |
| `itemVisibility` | visibility or list | omitted | Restrict bindings to blocks with a matching visibility. |

## `skills.with` options

Per-generator binding. Two generators, two different `active` sets, and neither sees the other's skill.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `active` | `string[]` | omitted | Skills preloaded from the start. Unknown names fail at build time. |
| `allowed` | `string[]` | omitted | Skills the load tool may pull; omitted, it may pull any skill in the library. Also the skills an `activeState` field may render with tools: an `activeState` binding with neither `allowed` nor `dynamicActivation` gets no catalog tools at all. When the catalog is contributed it is the whole `catalog`, not these skills' `allowed-tools`. See [What tools the generator gets](../skills/binding#what-tools-the-generator-gets). |
| `activeState` | `{ scope, field }` | this generator's block state | Where dynamic activations live. Set a named scope to share across generators or persist across turns. |

`dynamicActivation` and `catalogContext` are presets on the same `.with({ ... })` call, not fields on this table. `dynamicActivation` installs the `loadSkill` tool. `catalogContext` is on by default and puts the loadable skills' names and descriptions into the prompt beside it; set `catalogContext: false` to take that listing out and let the agent find skills through [discovery](./discovery) instead. Both belong in the same call — preset overrides replace rather than merge, so chaining `.presets()` and `.with()` drops whichever came first. See [Binding skills](../skills/binding).

Narrative for authoring a skill: [Authoring](../skills/authoring).
