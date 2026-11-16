---
title: Event Actors
type: catalog
description: Actors react to topics they watch; no controller.
---

# Event Actors

Some work has no plan. A message arrives, and whoever cares about it should react. A support desk reads Slack messages, and one actor tags the urgent ones while another pages someone when an alert comes in. Nobody tells them in what order to go.

`eventActors` is that setup. Each *actor* is a block plus a list of topic patterns it watches. When you emit an *entry*, an object shaped `{ type, topic, body }`, the entry is recorded in a shared log and every actor whose pattern matches it runs, four at a time by default. Each run of an actor is a *task*, a stored record of that run with the actor's name as its assignee. You add an actor without touching the others.

Use it when:

- agents react independently to the same stream of events,
- you want no central orchestrator deciding who goes next,
- new actors should plug in without changes to existing ones.

If a controller should read shared state and pick the next specialist each pass, use [Routed Specialists](./routed-specialists.md). If the roster is known up front and runs once, use [Parallel Tasks](./parallel-tasks.md).

## Install it

```bash
pnpm add @flow-state-dev/patterns
```

## Use it

The examples belong to a `feedback` flow on a support desk. An entry has a type, a topic and a body, and the topic is a dotted name. The schema below describes that shape.

```ts title="src/flows/feedback/blocks/entry-schema.ts"
import { z } from "zod";

export const entrySchema = z.object({
  type: z.string(),
  topic: z.string(),
  body: z.any(),
});
```

The *workspace* is the log the entries are recorded in. `entries` documents the entry shape, and nothing validates an emitted entry against it.

```ts title="src/flows/feedback/blocks/feedback-workspace.ts"
import { createEventActorsWorkspace } from "@flow-state-dev/patterns";
import { entrySchema } from "./entry-schema";

export const feedbackWorkspace = createEventActorsWorkspace({
  name: "feedback",
  entries: entrySchema,
});
```

Each actor's block receives the entry as its input. This one tags a Slack message, and hands back a new entry when the message sounds urgent. By default that returned entry is dropped; [Run one actor from another](#run-one-actor-from-another) turns it into a new entry.

```ts title="src/flows/feedback/blocks/slack-monitor.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { entrySchema } from "./entry-schema";

export const slackMonitor = handler({
  name: "slack-monitor",
  inputSchema: entrySchema,
  outputSchema: z.any(),
  execute: (entry) => {
    const text = String(entry.body?.text ?? "");
    if (/crash|broken|urgent/i.test(text)) {
      return { type: "event", topic: "alert.urgent", body: entry.body };
    }
    return { tagged: true };
  },
});
```

```ts title="src/flows/feedback/blocks/alert-watcher.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { entrySchema } from "./entry-schema";

export const alertWatcher = handler({
  name: "alert-watcher",
  inputSchema: entrySchema,
  outputSchema: z.any(),
  execute: (entry) => ({ paged: true, topic: entry.topic }),
});
```

`actor` pairs a block with the patterns it watches, and `eventActors` wires the actors to the workspace. The `name` of an actor must be unique in its `eventActors` call.

```ts title="src/flows/feedback/blocks/feedback.ts"
import { actor, eventActors } from "@flow-state-dev/patterns";
import { alertWatcher } from "./alert-watcher";
import { feedbackWorkspace } from "./feedback-workspace";
import { slackMonitor } from "./slack-monitor";

export const feedback = eventActors({
  name: "feedback",
  workspace: feedbackWorkspace,
  actors: [
    actor({ name: "slack-monitor", watch: ["observation:slack.*"], block: slackMonitor }),
    actor({ name: "alert-watcher", watch: ["event:alert.**"], block: alertWatcher }),
  ],
});
```

`feedback.emit` is a block that takes an entry. Use it as a flow's action block, or as a sequencer step:

```ts title="src/flows/feedback/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { feedback } from "./blocks/feedback";
import { entrySchema } from "./blocks/entry-schema";

export const feedbackFlow = defineFlow({
  kind: "feedback",
  requireUser: true,
  actions: {
    emit: {
      inputSchema: entrySchema,
      block: feedback.emit,
      userMessage: (input) => `${input.type}:${input.topic}`,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
});
```

Emitting `{ type: "observation", topic: "slack.message", body: { text: "Checkout is broken" } }` records the entry and runs `slack-monitor`. `alert-watcher` doesn't match, so it doesn't run. Putting `emit` in a flow adds the workspace to it. You declare nothing else.

`emit` finishes without an error once every actor it started has settled. Its output holds no actor results. To see what ran, read the log and the tasks, as [Seeing it run](#seeing-it-run) shows.

The log keeps the first entry for each type and topic. Emit a second `observation:slack.message` and the log shows the first one, body included, but `slack-monitor` runs on the second anyway.

## Topic patterns

A pattern is matched against `type:topic` as one string, for example `observation:slack.message`. The whole string must match.

| Pattern | Matches | Doesn't match |
| --- | --- | --- |
| `observation:*` | `observation:slack` | `observation:slack.msg` |
| `observation:**` | `observation:slack.msg.edit` | `event:slack` |
| `*:slack` | `observation:slack`, `event:slack` | `observation:slack.msg` |
| `observation:slack.*` | `observation:slack.message` | `observation:slack.a.b` |
| `**` | everything | nothing |

`*` matches within one segment, where `:` and `.` separate segments. `**` matches any number of segments. An actor with several patterns runs once per entry, whichever of them match. Two actors that match the same entry run in either order.

## Run one actor from another

By default an actor's output never becomes a new entry. Set `reEmit: true` on the `eventActors` call. An actor can then return an entry, an array of entries, or `{ entries: [...] }`, and each entry is recorded and goes to the actors that watch it. Anything else in the output is dropped.

With that set, the Slack message above runs `slack-monitor`, which returns an `event:alert.urgent` entry, and `alert-watcher` runs on it. A chain stops after `maxDepth` levels (default 3). `slack-monitor` runs at depth 1 and `alert-watcher` at depth 2. Entries returned at depth `maxDepth` are added to the log, but no actor runs on them.

## When an actor fails

A failing actor's task is marked failed. The other actors run as usual, `emit` finishes without an error, and a failed actor isn't retried.

A busy channel can hit a limit instead: one `emit` may create 500 tasks in all, with 100 waiting at once. An entry's tasks are created in one batch, so if they don't all fit, none of its actors run and `emit` errors. When an actor's returned entries would cross the limit, that actor's task fails and none of those entries reach an actor. Raise the limits, or pass `null` to remove them, with `maxTotalTasks` and `maxEnqueuedTasks`.

## Seeing it run

The log is a session resource stored under the key `eventedActors`. A client can read its `entries` array, and nothing else on it. Each recorded entry also streams an `rb-entry` data item, a structured record on the stream, with its `type`, `topic` and `body`.

The tasks live on the request, in the task collection `eventActors:<name>`, and end with it. A task's goal reads `slack-monitor on observation:slack.message` and its input is the entry. While `emit` runs, the stream carries a `task-change` item with the whole task each time one changes. The Checkout-is-broken run shows one `slack-monitor` task that completed.

## Change it

`concurrency` (default 4) is how many actors run at once. `maxDepth`, `reEmit`, `maxTotalTasks` and `maxEnqueuedTasks` are above. Every option and the exports for building your own `emit` are in the [patterns reference](../../reference/patterns.md).

## See also

- [Routed Specialists](./routed-specialists.md): a controller picks the next specialist
- [Parallel Tasks](./parallel-tasks.md): fan-out when the tasks are known up front
- [Supervisor](./supervisor.md): fan-out with a review on each result
- [Task board](../../concepts/tasks-and-boards.md): the stored list of tasks the actors run on
