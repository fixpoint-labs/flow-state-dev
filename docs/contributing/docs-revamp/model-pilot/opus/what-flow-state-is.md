---
title: What Flow State is
sidebar_label: What Flow State is
description: "An app is made of kits, kits are made of flows, and flows are made of blocks. What each layer is, and which one you change."
---

import Figure from "@site/src/components/Figure";
import LayersDrawing from "./figures/layers.svg";

# What Flow State is

Most agent frameworks hand you parts. Flow State hands you an app, and then lets you change any part of it.

An app built on Flow State is a server and the screens that talk to it. The server runs a team of AI workers, streams their answers to the browser, keeps what they need in your own database, and, on a store that persists, picks a run back up after a crash. All of it is TypeScript in your repository, so you can read every piece and replace any of them.

The app is built in layers. You start at the top and go down only as far as the change you want to make.

<Figure svg={LayersDrawing} caption="An app, its kits, their flows, and the blocks inside" description={"Four nested layers. The app is the outer box: one createFlowState call, its screens and its stores. Inside it sit kits, each a feature installed with one config object: workforce, which owns the workforce folder; harnesses, whose coding worker flow fills workforce's workerFlows slot; and a kit of your own. Each kit installs flows, and the app can list flows of its own beside them. Each flow is made of blocks of five kinds: handler, generator, evaluator, sequencer and router. Beside the layers is what you change at each: one line in the kits list to add a kit; a file in a kit's folder, its config or one of its slots to change a kit's feature; a flow of your own listed in flows; a block's code."} />

## An app

Every app has one server entry: a call to `createFlowState` that names the features it installs, the flows it adds of its own, and where it keeps its data.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { workforce } from "@flow-state-dev/workforce";
import { harnesses } from "@flow-state-dev/harness-manager";
import { triageFlow } from "./flows/triage";

export default createFlowState({
  kits: [
    workforce({ model: "openai/gpt-6-luna" }),
    harnesses({}),
  ],
  flows: [triageFlow],
  stores: sqliteStores({ filename: "app.db" }),
});
```

That object is the whole backend. A host adapter (Node, Next.js or Vercel) serves it over HTTP, and the `fsdev` command runs its flows from a terminal. Leave out `stores` and the app runs in memory: fine for trying things, gone on restart.

The screens are ordinary React. They read what they show through hooks that each kit's package exports.

## Kits

A **kit** is a feature you install with one config object. The workforce kit gives every user a roster of workers they can talk to and hand work to. The harnesses kit runs coding agents such as Claude Code, Codex and Cursor on a checkout of your code. A kit carries everything its feature needs: flows, the data they keep, and the screens' hooks.

Kits build on each other without knowing about each other. A kit can open a **slot**: a typed place that other kits fill when they install. Workforce opens a slot for the flows its workers can run on. The harnesses kit fills it with a coding worker flow, so once both kits are in the list, a worker in your folder can name that flow and write code. The order you list the kits in doesn't matter. If two kits put the same key in one slot, or a kit needs another kit that isn't installed, the app refuses to start and names the problem.

Some kits own a folder in your app. The workforce kit owns `workforce/`, and each worker in it is a Markdown file:

```md title="workforce/teams/support/workers/triage/WORKER.md"
---
description: Reads each new ticket and says who should take it.
model: openai/gpt-6-luna
---
You triage support tickets. Say whether the ticket is a bug, a billing
question or a feature request, and who on the team should take it.
```

The file is yours. You edit it like any other source file, and the kit reads the folder when the app starts. A file in that folder the kit doesn't understand stops the app starting, with the file named, so a typo never fails silently.

## Flows

A **flow** is a set of actions a client can call, plus the state those actions share. An action takes typed input and runs one block. Each conversation or job runs in a **session**, and a session keeps its own state and the stream of items its runs produced: messages, tool calls, progress.

Kits install flows, and you can write your own beside them. Here is a small one with a single action:

```ts title="flows/triage.ts"
import { defineFlow } from "@flow-state-dev/core";
import { triagePipeline } from "./triage-pipeline";

export const triageFlow = defineFlow({
  kind: "triage",
  actions: {
    triage: { block: triagePipeline },
  },
})();
```

Any flow runs from the terminal with no server and no browser. The answer streams back as items, the same ones a screen would get:

```bash
npx fsdev run triage triage -i '{"ticket":"I was charged twice this month"}'
```

That is also how a coding agent works on your app: it writes a flow, runs it, reads the output and fixes what it sees.

## Blocks

A **block** is one step of work with a typed input and a typed output. There are five kinds:

- **handler**: plain code. Read a file, call an API, update state.
- **generator**: a model call. It can stream text, return structured output, and call tools in a loop.
- **evaluator**: asks a model questions whose answers you already know the shape of (one of these options, a score, yes or no) and returns typed answers.
- **sequencer**: runs other blocks in order, in parallel, or in a loop.
- **router**: picks one block to run based on the input.

The `triagePipeline` above is a generator followed by a handler that counts the session's tickets:

```ts title="flows/triage-pipeline.ts"
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const ticket = z.object({ ticket: z.string() });
const verdict = z.object({
  kind: z.enum(["bug", "billing", "feature"]),
  owner: z.string(),
});

const classify = generator({
  name: "classify",
  model: "openai/gpt-6-luna",
  prompt: "Classify the support ticket and name who should take it.",
  inputSchema: ticket,
  outputSchema: verdict,
  user: (input) => input.ticket,
});

const countTriaged = handler({
  name: "count-triaged",
  inputSchema: verdict,
  sessionStateSchema: z.object({ triaged: z.number().default(0) }),
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ triaged: ctx.session.state.triaged + 1 });
  },
});

export const triagePipeline = sequencer({ name: "triage", inputSchema: ticket })
  .step(classify)
  .tap(countTriaged); // runs for its state change; the verdict stays the output
```

Every kit is built from these same five kinds. There is no `agent()` function: an agent is a generator with tools, and a team of agents is blocks composed in a flow. [Generators and tools](./generators-and-tools) shows how far that goes.

## Which layer you change

Start at the top and stop at the first layer that can make the change.

- **To change what a worker does**, edit its `WORKER.md`. Its instructions, model and tools are all in that file, and the app reads it when it starts.
- **To add a feature someone already built**, add its kit to `kits`, with its config.
- **To change how a kit's feature behaves for your app**, fill one of its slots with your own entry, or give it different config. You don't fork the kit.
- **To add something no kit does**, write a flow and list it in `flows`. It is served beside the kits' flows.
- **To change one step**, write or replace a block. A worker can run on a flow you wrote, so a block you write can end up behind a worker your users talk to.

You can build a working app without writing a block. When you do write one, it is the same kind of piece the kits are made of.

## What it won't do

- It isn't a hosted service. The server runs where you deploy it, and the data stays in the stores you configure.
- It doesn't hide the model calls. Each one is a generator or an evaluator in a flow you can open.
- A kit doesn't change another kit's code. It reaches another kit only through the slots that kit opens.

## Next

- [Run a starter](../start/run-a-starter) to get an app running in your browser.
- [Kits and slots](./kits-and-slots) for how kits install and fill each other's slots.
- [Tasks and boards](./tasks-and-boards) and [Workers](./workers) for how a team of workers gets work done.
