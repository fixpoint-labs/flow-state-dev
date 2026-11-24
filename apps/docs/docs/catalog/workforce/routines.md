---
title: Routines
type: catalog
description: "Work that starts on its own for a user: a task filed on a clock, or a worker woken by an event on something it follows, such as a pull request or a topic your app publishes."
---

# Routines

Some work should start without anyone asking. A lead should triage the open tickets every Monday at nine. It should hear when a review lands on the pull request it opened, and when a deploy fails.

A routine is that standing instruction. It belongs to one user, acts through one of their workers, and has exactly one trigger. A **clock** trigger files a task on a cron. An **event** trigger follows one pull request, issue, repository or topic, and each event on it that passes the routine's screens reaches the worker's conversation as a message from the service, such as `service:github`.

## What you get

- **Four verbs over both kinds:** `listRoutines`, `saveRoutine`, `pauseRoutine` and `deleteRoutine`. The user has them as actions on the roster flow, and a worker can have them as tools.
- **Screens** that decide which events get through: built-in ones, your app's own code, and a sentence a model judges.
- **Topics your own sessions publish on**, followed by routines the same way as a pull request.
- **A coordinator that hears what nobody else heard** on a pull request, issue or repository it follows.
- **Polling**, for an app with no public URL for a webhook.
- **A `routines` view** that lists the user's routines with no session.

## Install it

Routines come with the [workforce kit](./index.md). Give the kit a `routines` option: the schedule index clock routines fire from, and the providers whose events a routine can follow.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { githubSubscriptionProvider } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { githubTokenFor } from "./src/lib/github-tokens";
import { routineIndex } from "./src/lib/schedule-indexes";

const github = githubSubscriptionProvider({ token: (ctx) => githubTokenFor(ctx.session.identity) });

export default createFlowState({
  kits: [
    workforce({
      directory: "./workforce",
      github: { provider: github },
      routines: { index: routineIndex, providers: [github] },
    }),
  ],
});
```

`githubTokenFor` returns the signed-in user's own GitHub token from your app's store, and `routineIndex` is a SQLite or Postgres schedule index. Each lives in `src/lib/`. The tick that fires schedules reads `routineIndex` ([Schedules](../../reference/schedules.md#the-schedule-index)). Without an index, clock routines fire only when an outside cron calls the dispatch endpoint. `github` serves GitHub's webhook; [Receive GitHub webhooks](../../build/webhooks/github.md) sets it up.

## Use it

### Give a worker the tools

A worker gets the four tools when its file picks the `routines` capability:

```md title="workforce/teams/desk/workers/lead/WORKER.md"
---
description: Hands each request to a coder and keeps you posted.
delegates: [desk.coder]
capabilities:
  routines: [tools]
---

When the user asks for something on a schedule, save a clock routine. When you open
a pull request, follow it with an event routine so reviews reach you.
```

A worker reaches only the routines that act through it: the clock routines that file on its board and the event routines it hears. Any other id is refused with `not_yours`. The user reaches all of theirs.

### A routine on a clock

```json title="saveRoutine"
{
  "name": "monday-triage",
  "trigger": { "clock": { "cron": "0 9 * * 1", "timezone": "Europe/London" } },
  "task": { "filer": "desk.lead", "goal": "Triage the open tickets and file one task per bug." }
}
```

Each time it is due, the routine files the task on `desk.lead`'s board, in the user's conversation with it, and a delegate works it as any other [delegated task](./delegating-work.md). A worker can leave out `filer`, and the task lands on its own board. Saving the same `name` again replaces the routine.

Every verb answers `{ ok: true, routine }` or `{ ok: false, error }`, with the error starting with its code, such as `no_task:`. A clock routine's id is `clock:<name>`.

### A routine on an event

```json title="saveRoutine"
{
  "trigger": {
    "event": {
      "provider": "github",
      "thread": "github:acme/shop#412",
      "kinds": ["review", "check"],
      "interest": "Reviews asking for changes, and checks that fail."
    }
  }
}
```

An event routine takes no name and files no task. Its events reach the hearer's conversation as messages, and the worker decides what to do. From the roster action, the user names the hearer in `worker`. From a worker's tool, the worker hears. The id is `event:<subscription id>`. `interest` is required: one sentence of what the hearer wants, kept with the routine.

Read access is checked when the routine is saved and again on resume, on the user's own provider credentials. A user who can't read the pull request is refused.

### Screen what gets through

`screens` narrows what passes, and every listed screen must pass. `labels`, `words` and `allow` are built in. Two more come from your app.

**Custom screens** are your own code, declared once on the provider by name:

```ts title="src/lib/github.ts"
import { githubSubscriptionProvider } from "@flow-state-dev/workforce";
import { githubTokenFor } from "./github-tokens";

export const github = githubSubscriptionProvider({
  token: (ctx) => githubTokenFor(ctx.session.identity),
  screens: {
    interestModel: "openai/gpt-6-luna",
    custom: {
      namesTicket: {
        describe: "Only events that name a SHOP ticket, such as SHOP-123.",
        screen: (event) => (/\bSHOP-\d+\b/.test(`${event.title} ${event.text}`) ? undefined : "names no SHOP ticket"),
      },
    },
  },
});
```

A screen answers `undefined` to pass, or a string that refuses the event and is the reason. It may be async and read your app's data, declared in its `resources`. A screen that throws refuses as `custom:<name>: failed`. A routine lists one as `{ "screen": "custom", "name": "namesTicket" }`, and the `saveRoutine` description lists the ones you declared. An undeclared name is refused with `no_screen`.

**The `interest` screen** asks `interestModel` whether an event matches the routine's `interest` sentence. It runs after every code screen has passed, as one model call per event for all the routines that list it. If the call fails, those routines don't hear the event, refused as `interest: unjudged`, with no retry. A provider with no `interestModel` refuses a routine that lists `interest` with `no_interest_model`.

### Topics your sessions publish

A session can announce something once, on a topic your app declares, and every routine of the same user that follows the topic hears it, as a message from `service:internal`. Declare the topics on the kit:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import type { WorkerInstallation } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { z } from "zod";
import { deploysFlow } from "./src/flows/deploys/flow";

export default createFlowState({
  kits: [
    workforce({
      directory: "./workforce",
      internalEvents: {
        topics: {
          "deploy.finished": {
            kinds: ["succeeded", "failed"],
            data: z.object({ service: z.string(), sha: z.string() }),
            description: "A deploy finished.",
          },
        },
      },
    }),
  ],
  fill: {
    [workforce.slots.flows]: {
      deploys: (installation: WorkerInstallation) => [deploysFlow(installation)],
    },
  },
});
```

In a flow built on the installation, `internalEventsOf(installation)` from `@flow-state-dev/workforce/kit` gives `publishEvent`, the `resources` a block that calls it declares, and a `capability` that hands a worker flow the same verb as a tool, through `uses`:

```ts title="src/flows/deploys/flow.ts"
import { defineFlow, handler } from "@flow-state-dev/core";
import type { WorkerInstallation } from "@flow-state-dev/workforce";
import { internalEventsOf } from "@flow-state-dev/workforce/kit";
import { z } from "zod";

const deployed = z.object({ service: z.string(), sha: z.string() });

export function deploysFlow(installation: WorkerInstallation) {
  const internal = internalEventsOf(installation);
  const announceFailure = handler({
    name: "announce-failure",
    inputSchema: deployed,
    resources: internal.resources,
    execute: (input, ctx) =>
      internal.publishEvent(ctx, {
        topic: "deploy.finished",
        kind: "failed",
        title: `${input.service} failed to deploy`,
        text: `The deploy of ${input.service} at ${input.sha} failed.`,
        data: input,
      }),
  });
  return defineFlow({ kind: "deploys", actions: { announceFailure: { inputSchema: deployed, block: announceFailure } } });
}
```

A publish answers `{ published }` or `{ refused }`, never who heard. A routine follows the topic with `provider: "internal"` and `thread: "internal:deploy.finished"`, and `kinds: ["failed"]` hears only failures. An undeclared topic or event type is refused at publish and at save, naming the declared ones. An event reaches only the publisher's own user in the same tenant, and never the session that published it. A publish counts against the [message budget](./messaging.md#change-it), so sessions that wake each other with announcements stop where messages would.

### What nobody else heard

A [coordinator](./coordinators.md) can follow a pull request, issue or repository with `"unmatched": true` in its event trigger. It then hears an event only when no other routine heard it, and only the event types your app forwards. Anywhere else, `unmatched` is refused with `not_a_coordinator`.

Turn it on in two places: `coordinator: { routines: true }` on the kit, which gives the coordinator flow the four verbs as actions, and `forwards` on the service flow, such as `github: { provider: github, forwards: { kinds: ["issue", "comment"] } }`. With no `forwards`, nothing is forwarded. An event a screen couldn't judge, such as one refused `interest: unjudged`, is never forwarded.

Each forward is marked `addressed`, when the event mentions, assigns or asks a review of your app's agent handle, or `inferred`. The coordinator's `inferredWork:` decides what its turn may do with an inferred one: `observe`, the default, runs the turn and holds every task it files until the user says yes in Inbox, `auto` runs it as any other, and `off` lands it as a line with no model run. An addressed event runs in every mode. The [Workforce reference](../../reference/workforce.md#a-coordinators-file-keys) has the key.

### Polling when there is no public URL

A host with no public URL can't receive webhooks, so it polls. Give the kit `routines.poll` with a schedule index of its own, and set `poll: true` on GitHub's service flow:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";
import { github } from "./src/lib/github";
import { pollIndex, routineIndex } from "./src/lib/schedule-indexes";

export default createFlowState({
  kits: [
    workforce({
      directory: "./workforce",
      github: { provider: github, poll: true },
      routines: { index: routineIndex, providers: [github], poll: { index: pollIndex } },
    }),
  ],
});
```

The app polls once per user and pull request or repository, on that user's token, at most every five minutes, and events go through the same screens and delivery as a webhook's. An event routine can poll less often with `everyMinutes`: 5, 10, 15, 20, 30 or 60. Any other value is refused. Giving `poll.index` the same index as `routines.index` fails at start. Polls run on the schedule tick, which `fsdev run` doesn't run; [What calls the tick?](../../reference/schedules.md#what-calls-the-tick) lists the hosts that do.

### List, pause and delete

`pauseRoutine` takes `{ id, paused }`, and `paused: false` resumes. `deleteRoutine` takes `{ id }` and answers `{ ok: true }` or `{ ok: false, error }`. A screen reads the list from the `routines` view and sends a change to the routine collection:

```ts title="src/lib/routines.ts"
import type { Client } from "@flow-state-dev/client";
import { ROUTINE_VERBS, SCHEDULES_PATTERN, routinesView } from "@flow-state-dev/workforce/browser";

export const readRoutines = (client: Client) => client.view(routinesView, {});

export const pauseRoutine = (client: Client, id: string, paused: boolean) =>
  client.resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send(ROUTINE_VERBS.pause, { id, paused });
```

The view answers `{ routines }`, each in `listedRoutineSchema`'s shape: `id`, `name`, `worker`, `paused`, `trigger`, and `madeBy`, which says whether the user, a worker or the app made it. A clock routine also shows its `nextRunAt`. A send runs as the signed-in user, in their own session, so it needs no conversation open.

### The app's own routines

`routines.declared` lists routines your app gives every user, or one user with `owner`:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";
import { routineIndex } from "./src/lib/schedule-indexes";

export default createFlowState({
  kits: [
    workforce({
      directory: "./workforce",
      routines: {
        index: routineIndex,
        declared: [
          {
            id: "monday-triage",
            trigger: { clock: { cron: "0 9 * * 1", timezone: "Europe/London" } },
            task: { filer: "desk.lead", goal: "Triage the open tickets and file one task per bug." },
          },
        ],
      },
    }),
  ],
});
```

Each is written into a user's routines at the end of their first request to any worker or to the roster flow, and rewritten on the first request after you change it. The `routines` view lists it before it is written. The user may pause one, and the pause outlives a config change. Saving over it or deleting it is refused with `declared`. An entry that could never fire, such as a clock routine with no task, fails at start.

## Slots it opens

None.

## Slots it fills and views it serves

Routines fill no slot. The roster flow serves the `routines` view, with its handle `routinesView` from `@flow-state-dev/workforce/browser`. The routines live in two user-scope collections, `workforce/schedules/*` for clock routines and `workforce/subscriptions/*` for event routines.

## Change it

`createRoutinesCapability(installation)` builds the capability for a worker flow you write yourself: add it to the flow's `uses`. Its tools read the providers and index the kit was given.

## Next

- [Delegating work](./delegating-work.md): what happens to the task a clock routine files.
- [Messaging between workers](./messaging.md): the message budget a publish counts against.
- [Coordinators](./coordinators.md): the worker that hears unmatched events.
- [Schedules reference](../../reference/schedules.md): the tick, the schedule index and its backends.
