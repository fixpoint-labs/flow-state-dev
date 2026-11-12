---
title: What Flow State is
sidebar_label: What Flow State is
type: concept
description: An app is made of kits, kits are made of flows, and flows are made of blocks. Start at the top and go down only as far as your change needs.
---

import Figure from "@site/src/components/Figure";
import LayersDrawing from "./figures/layers.svg";

# What Flow State is

Most agent frameworks hand you parts. Flow State hands you an app.

Run a starter and you have a team of AI workers, a page to talk to them on, and a backend that streams their answers and keeps their state in your database. The code is in your repo. The data is in your stores.

Then you change it. A worker is a Markdown file, so you rewrite its brief. A feature is a kit, so you add a line. When you want something nobody has built, you write it from the same typed pieces the kits are made of.

That gives four layers: an app, made of kits, made of flows, made of blocks. You work from the top and stop as soon as the change you want is made. Nobody has to read the bottom layer to use the top one.

<Figure svg={LayersDrawing} caption="The four layers, and what you change at each" description={"Four stacked layers. The app holds one createFlowState config, your screens and your own flows; you change it by editing files and the config. Kits sit beneath it: workforce, harnesses and kits you write, installed with one line each, with arrows showing one kit filling a slot that another kit opens. Flows sit beneath the kits: named actions with state and resources, served as an HTTP API and runnable from a terminal. Blocks are the bottom layer: handler, generator, evaluator, sequencer and router. On the right, the change you make at each layer: edit a file or a line of config, add a kit, write a flow, write a block."} />

## An app

An app is one config object, some screens, and the flows you wrote yourself.

```ts
export default createFlowState({
  kits: [
    workforce({ model: "openai/gpt-6-luna" }),
    harnesses({ claudeCode: {} }),
  ],
  flows: [deskFlow],
  stores: { default: { primary: sqliteStores({ filename }) } },
});
```

`createFlowState` is the server half. It serves every flow over HTTP, streams what they produce, and saves their state to the stores you name. A host adapter (Node, Next.js, Vercel) puts it on the network. The screens are ordinary React, talking to it through the client.

## Kits

A kit is a feature you install with one line. `workforce` gives the app its team: workers you describe in Markdown, conversations with them, and a task board behind the conversation. `harnesses` adds coding agents (Claude Code, Codex, Cursor) as workers that can take a coding task.

A kit can carry:

- **Flows.** What it serves. Its resources, views and capabilities ride on those flows.
- **A folder in your repo.** Workforce reads worker files from `workforce/`. The kit scaffolds starter files there once, and from then on you own them. A file in that folder the kit can't use stops the app from starting, with the file named.
- **Slots.** Typed places that other kits fill. Workforce has a slot for worker flows. `harnesses` fills it with a coding worker, and workforce never learns that `harnesses` exists.

A kit lists the kits it needs with `requires`, and the app can list kits in any order. What kits put in a slot is merged and checked: a key supplied twice is refused, naming both kits. A kit that fills a slot can declare slots of its own, so features build on each other without knowing about each other.

You can write a kit the same way the framework's are written:

```ts
export const mission = defineKit({
  name: "mission",
  requires: [workforce],
  contributes: () => ({
    [workforce.slots.workerFlows]: { planner: plannerFlow },
  }),
  install: () => ({ flows: [missionBoardFlow] }),
});
```

`contributes` is what the kit puts in other kits' slots. `install` returns the flows it serves.

## Flows

A flow is a named set of actions plus the state around them. The server serves a flow's actions as endpoints. A session holds one conversation's state and the items it produced. The same flow runs without a server, from a terminal.

```ts
const chat = generator({
  name: "chat",
  model: "openai/gpt-6-luna",
  prompt: "You are a helpful, concise assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
});

export default defineFlow({
  kind: "hello-chat",
  actions: { chat: { block: chat } },
})();
```

```bash
npx fsdev run hello-chat chat -i '{"message":"hi"}'
```

`fsdev run` runs the action in-process and prints each event as a line of JSON. There is no server and no browser. It is also how a coding agent checks its own work: write a flow, run it, read the events, fix what they show.

## Blocks

Every action runs one block. There are five kinds, and all of them share one typed contract: an input schema, an output schema, a function.

- A **handler** is plain code. Validate, transform, write state.
- A **generator** calls a model. Give it tools and it becomes the loop most people mean by "agent".
- An **evaluator** puts questions to a model whose possible answers you know, and returns typed answers your code can branch on.
- A **sequencer** runs blocks in order, in parallel, or in a loop.
- A **router** picks which block runs next.

There is no `agent()` function in Flow State. An agent is a generator with tools, sometimes inside a sequencer.

## Which layer you change

- **Change what a worker is told to do:** edit its `WORKER.md` file.
- **Turn a feature on, or change its settings:** edit a line in `kits: [...]`.
- **Add behavior the app doesn't have:** write a flow and add it to `flows`.
- **Add a step inside a flow:** write a block.
- **Package a feature as a unit an app installs:** write a kit.

Start with the first line that fits and go down only when it doesn't. Most changes never leave the top two.

## What it won't do

Flow State doesn't host your app. You pick where the server runs and which database holds the state. What a kit serves is flows made of blocks, so you can read it, replace it, or write the same thing yourself.

Next, [Tasks and boards](./tasks-and-boards) covers how work is handed out, and [Workers](./workers) covers the team that does it.
