---
sidebar_position: 8
---

# Reactive Blackboard

The Reactive Blackboard is a stigmergic multi-agent coordination pattern. Actors declare which entry topics they watch, and when a matching entry is written, their body block runs automatically in the background. There is no controller, no loop, no central decision point. Coordination is emergent: adding a new actor requires zero changes to existing actors.

Use it when:
- You have event-driven or continuous-monitoring problems
- Agents react independently to shared state changes
- You want decoupled coordination without a central orchestrator
- New agents should be pluggable without modifying existing ones

If you need a controller that reads shared state and decides which specialist to invoke next, use [Blackboard](./blackboard) instead. Both patterns are siblings under the same composable patterns library.

## Block composition

```
entry input
  → append entry to resource
  → forEachBackground(matched actors → actor.body)
    ↑ writer continues immediately
    ↓ each matched actor runs in background
```

The entire propagation graph lives inside FSD's flow tree. Tracing, heartbeats, cancellation, and replay all work without any external runtime.

## Basic usage

```ts
import { reactiveBlackboard, actor, mesh } from "@flow-state-dev/patterns/reactive-blackboard";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

// 1. Define your entry schema
const entrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("observation"), topic: z.string(), body: z.any() }),
  z.object({ type: z.literal("event"), topic: z.string(), body: z.any() }),
]);

// 2. Create the blackboard
const rb = reactiveBlackboard({ name: "feedback", entries: entrySchema });

// 3. Define actors
const slackMonitor = actor({
  name: "slack-monitor",
  watch: ["observation:slack.*"],
  body: handler({
    name: "slack-handler",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: (entry) => {
      console.log("Slack observation:", entry.body);
      return { processed: true };
    },
  }),
});

const alertWatcher = actor({
  name: "alert-watcher",
  watch: ["event:alert.**"],
  body: handler({
    name: "alert-handler",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: (entry) => {
      console.log("Alert:", entry.body);
      return { alerted: true };
    },
  }),
});

// 4. Wire everything together
const feedback = mesh({
  name: "feedback",
  blackboard: rb,
  actors: [slackMonitor, alertWatcher],
});
```

Use `feedback.emit` in any sequencer to write entries with automatic fan-out:

```ts
import { sequencer } from "@flow-state-dev/core";

const pipeline = sequencer({ name: "main" })
  .then(someProcessingBlock)
  .then(feedback.emit);  // Appends entry + fans out to matching actors
```

## Config reference

### `reactiveBlackboard(config)`

Creates the entry resource.

```ts
reactiveBlackboard({
  name: string;            // Instance name
  entries: ZodTypeAny;     // Schema for entry objects
});
// Returns: { blackboard: DefinedResource }
```

### `actor(config)`

Creates an actor descriptor. A plain value, not a class.

```ts
actor({
  name: string;                // Unique actor name
  watch: string[];             // Glob patterns over `${type}:${topic}`
  body: BlockDefinition;       // Any block kind
});
// Returns: Actor (frozen)
```

### `mesh(config)`

Wires actors to a blackboard. Returns the configured emit block.

```ts
mesh({
  name: string;
  blackboard: { blackboard: DefinedResource };  // From reactiveBlackboard()
  actors: Actor[];
  concurrency?: number;       // Default: 16
});
// Returns: { emit, blackboard, actors }
```

## Topic matching

Patterns match against `${type}:${topic}` using glob syntax:

| Pattern | Matches | Doesn't match |
|---------|---------|---------------|
| `observation:*` | `observation:slack` | `observation:slack.msg` |
| `observation:**` | `observation:slack.msg.edit` | `event:slack` |
| `*:slack` | `observation:slack`, `event:slack` | `observation:slack.msg` |
| `observation:slack.*` | `observation:slack.message` | `observation:slack.a.b` |
| `**` | everything | -- |

`*` matches a single segment (between `:` or `.`). `**` matches any number of segments.

## Two-tier reactive/deliberative

The reactive vs. deliberative split is a user-land pattern, not a framework concept. Put a router at the top of an actor's body:

```ts
const feedbackMonitor = actor({
  name: "feedback_monitor",
  watch: ["observation:slack.message"],
  body: sequencer({
    name: "monitor-pipeline",
  })
    .then(router({
      name: "classify",
      inputSchema: z.any(),
      outputSchema: z.any(),
      routes: [cheapHandler, expensiveGenerator],
      execute: (input) => {
        const text = input.body?.text ?? "";
        return /crash|broken|urgent/i.test(text)
          ? expensiveGenerator
          : cheapHandler;
      },
    })),
});
```

Actors that don't need the split just use a handler or generator directly.

## Failure isolation

Each actor's body runs as an independent background sidechain. If one actor throws, the others continue. The writer's flow is never affected by actor failures. Failed dispatches are logged but don't propagate.

## Exported API

```ts
// Factories
import { reactiveBlackboard, actor, mesh } from "@flow-state-dev/patterns/reactive-blackboard";

// Schemas (for remixing)
import { reactiveBlackboardStateSchema, emitControlSchema } from "@flow-state-dev/patterns/reactive-blackboard";

// Utilities
import { matchTopic, compilePattern } from "@flow-state-dev/patterns/reactive-blackboard";

// Helper blocks (for remixing)
import { createAppendEntry } from "@flow-state-dev/patterns/reactive-blackboard";
```

## When to use Reactive Blackboard vs. Blackboard

**Reactive Blackboard** (this pattern): No controller. Actors subscribe to topics and react when matching entries are written. Coordination is emergent. Best for event-driven systems, continuous monitoring, and broadcast/notification scenarios where you want agents to react independently.

**[Blackboard](./blackboard)**: Controller-driven. An LLM controller reads shared state and picks which specialist to invoke next, in a loop. Best for incremental synthesis, directed problem-solving, and tasks where a "what's next" decision is needed on each iteration.

## See also

- [Blackboard](./blackboard) -- the controller-driven sibling pattern
- [Coordinator](./coordinator) -- single-pass fan-out (use when tasks are known upfront)
- [Supervisor](./supervisor) -- fan-out with review loop (use when quality review is needed)
