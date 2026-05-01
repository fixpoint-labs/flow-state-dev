---
sidebar_position: 9
---

# Event Actors

`eventActors` is a stigmergic multi-agent coordination pattern. Actors declare which entry topics they watch (`type:topic` glob patterns), and when a matching entry is emitted, every matching actor's body runs concurrently. There is no controller — coordination is emergent. Adding an actor requires zero changes to existing actors.

Use it when:

- You have event-driven or continuous-monitoring problems
- Agents react independently to shared state changes
- You want decoupled coordination without a central orchestrator
- New agents should be pluggable without modifying existing ones

If you need a controller that reads shared state and picks the next specialist iteratively, use [Routed Specialists](./routed-specialists) instead.

## Block composition

```
emit(entry)
  → appendEntry          (write to workspace resource)
  → spawnInitialTasks    (one Task per matching actor, depth=1)
  → taskBoard.block      (concurrent drain — workers re-emit recursively)
```

Each actor task drains through a wrapped sequencer:

```
TaskWorkerInput
  → stashTaskId          (record taskId so reEmit can read its depth)
  → unwrapToEntry        (pass entry to user actor body)
  → actor.block          (user code — handler/generator/sequencer/router)
  → reEmitIfEnabled      (append output entries, spawn next-depth tasks)
```

The pattern composes the unified `taskBoard` substrate. Actor invocations live as `Task` records in a request-scoped `TaskCollection`; the entry log stays in a sibling writable session resource.

## Basic usage

```ts
import { createEventActorsWorkspace, actor, eventActors } from "@flow-state-dev/patterns/eventActors";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const entrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("observation"), topic: z.string(), body: z.any() }),
  z.object({ type: z.literal("event"), topic: z.string(), body: z.any() }),
]);

const rb = createEventActorsWorkspace({ name: "feedback", entries: entrySchema });

const slackMonitor = actor({
  name: "slack-monitor",
  watch: ["observation:slack.*"],
  block: handler({
    name: "slack-handler",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: (entry) => ({ processed: true, body: entry.body }),
  }),
});

const alertWatcher = actor({
  name: "alert-watcher",
  watch: ["event:alert.**"],
  block: handler({
    name: "alert-handler",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: (entry) => ({ alerted: true, body: entry.body }),
  }),
});

const feedback = eventActors({
  name: "feedback",
  workspace: rb,
  actors: [slackMonitor, alertWatcher],
});
```

Use `feedback.emit` in any sequencer to write entries with automatic fan-out:

```ts
import { sequencer } from "@flow-state-dev/core";

const pipeline = sequencer({ name: "main" })
  .then(someProcessingBlock)
  .then(feedback.emit);
```

## Config reference

### `createEventActorsWorkspace(config)`

Creates the entry-log resource.

```ts
createEventActorsWorkspace({
  name: string;            // Workspace name
  entries: ZodTypeAny;     // Documentation schema for entry shape
});
// Returns: { workspace: DefinedResource }
```

### `actor(config)`

Creates an actor descriptor (a plain frozen value, not a class).

```ts
actor({
  name: string;                // Unique actor name (= worker registry key)
  watch: string[];             // Glob patterns over `${type}:${topic}`
  block: BlockDefinition;      // Any block kind; receives the entry as input
});
// Returns: Actor (frozen)
```

### `eventActors(config)`

Wires actors to a workspace. Returns the configured `emit` block.

```ts
eventActors({
  name: string;
  workspace: { workspace: DefinedResource };  // from createEventActorsWorkspace()
  actors: Actor[];
  concurrency?: number;       // Default 16. Maximum concurrent workers in the underlying taskBoard.
  reEmit?: boolean;           // Default false. When true, actor outputs that match the entry shape become new dispatched entries.
  maxDepth?: number;          // Default 3. With reEmit, caps the recursive chain depth.
});
// Returns: { emit, workspace, actors }
```

## Topic matching

Patterns match against `${type}:${topic}` using glob syntax:

| Pattern | Matches | Doesn't match |
| --- | --- | --- |
| `observation:*` | `observation:slack` | `observation:slack.msg` |
| `observation:**` | `observation:slack.msg.edit` | `event:slack` |
| `*:slack` | `observation:slack`, `event:slack` | `observation:slack.msg` |
| `observation:slack.*` | `observation:slack.message` | `observation:slack.a.b` |
| `**` | everything | — |

`*` matches a single segment (between `:` or `.`). `**` matches any number of segments.

## reEmit

When `reEmit: true`, an actor's body output is normalized via `normalizeToEntries`. Any entry-shaped objects (`{ type, topic, body }`) — or `{ entries: [...] }` wrappers — are appended to the workspace and dispatched to any matching actors as new `Task`s with `metadata.depth = current + 1`. The chain continues until `depth > maxDepth`.

This is what makes the pattern reactive in the strongest sense: a single seed entry can cascade through multiple tiers of actors without explicit orchestration. The substrate's `taskBoard` is responsible for draining the cascade with bounded concurrency.

## Two-tier reactive/deliberative

The reactive vs. deliberative split is a user-land pattern, not a framework concept. Put a router at the top of an actor's body:

```ts
const feedbackMonitor = actor({
  name: "feedback_monitor",
  watch: ["observation:slack.message"],
  block: sequencer({ name: "monitor-pipeline" })
    .then(router({
      name: "classify",
      routes: [cheapHandler, expensiveGenerator],
      execute: (input) =>
        /crash|broken|urgent/i.test(input.body?.text ?? "")
          ? expensiveGenerator
          : cheapHandler,
    })),
});
```

## Failure isolation

Each actor task drains through `taskBoard` with `onError: "skip"` (the default). A failing actor records a failed `Task` and the rest of the chain continues. The substrate's CAS-safe claim ensures sibling actors are unaffected.

## Substrate notes

- Actor invocations are `Task` records in a request-scoped `TaskCollection` (`@flow-state-dev/tasks`). They show up in `<Plan />` and the devtool with the actor name as `task.assignee`.
- `task.metadata.depth` carries the reactive cascade depth. `task.metadata.type` and `task.metadata.topic` carry the matched entry.
- The entry log is a sibling session resource (writable, with `client.data` projection so renderers see live entries).

## Exported API

```ts
import {
  createEventActorsWorkspace,
  actor,
  eventActors,
} from "@flow-state-dev/patterns/eventActors";

// Schemas (for remixing)
import { eventActorsWorkspaceStateSchema } from "@flow-state-dev/patterns/eventActors";

// Utilities
import { matchTopic, compilePattern, normalizeToEntries } from "@flow-state-dev/patterns/eventActors";

// Helper blocks (for remixing)
import { createAppendEntry } from "@flow-state-dev/patterns/eventActors";
```

## See also

- [Routed Specialists](./routed-specialists) — controller-driven sibling pattern.
- Task Board (`@flow-state-dev/patterns/task-board`) — concurrent drain over a `TaskCollection` with dependency gating.
- [Parallel Tasks](./parallelTasks) — single-pass fan-out when tasks are known upfront.
- [Supervisor](./supervisor) — fan-out with review loop.
