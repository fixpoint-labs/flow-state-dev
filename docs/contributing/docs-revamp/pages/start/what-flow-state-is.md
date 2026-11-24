---
title: What Flow State is
type: start
description: An app you run and own, built from kits you install and typed pieces you can write yourself.
---

import Figure from "@site/src/components/Figure";
import Layers from "./figures/layers.svg";

# What Flow State is

Most agent frameworks hand you parts. Flow State hands you an app.

Run a starter and you have a team of AI workers, which are agents you brief in plain files, and a page to talk to them on. Behind both is a backend that streams their answers, keeps what they learned and, when the app keeps its data in SQLite or Postgres, picks a run back up where it stopped after a crash. The code is in your repo: worker files, flows, the kits in your config, React pages. The data is in your database: conversations, tasks, state, memory and the workers a user edits inside the app.

If the server crashes mid-run, the restarted app marks the run interrupted. Continue it and, over the starters' SQLite store, the finished work is replayed instead of run again. Over in-memory stores durable execution is off unless you force it on, so that resume does not hold.

Then you change it. A worker is a Markdown file, so you rewrite its brief. A feature is a kit, a bundle an app installs, so you add a line. When you want something nobody has built yet, you write it from blocks, the same typed pieces the kits are made of.

<Figure svg={Layers} caption="What an app is made of" description={"Five layers, top to bottom. A starter, which you run: pages, a team of workers and config, all in your repo; you change a worker by editing its Markdown file. Kits, which you install: a feature in one line of config. An arrow means a kit fills a slot the other kit opened: claudeCode fills one in harnesses, and harnesses fills one in workforce. Kits are highlighted as the layer where features stack. Flows, which you call: actions, views, state and resources; every feature is a flow you can run from a terminal. Blocks, which you write: generator, handler, sequencer, router and evaluator, with one typed contract. The engine, which runs them: it serves, streams, stores and resumes; it comes with the framework and you host it."} />

You start at the top and go down only as far as you need.

## A starter is a whole app

A starter comes with React pages, a team of workers, and the flows they run on. The Teammates starter is a small team you talk to one at a time. Its workers message each other where you can see them, and hand code changes to a coding agent.

Each worker on that team is a file like this:

```md title="workforce/teams/teammates/workers/researcher/WORKER.md"
---
name: researcher
description: Finds facts for the team and says where each one came from.
tools: [search, fetch]
---

You find facts: dates, prices, what a document or the code says. Look them up,
never guess. Say where each fact came from.
```

Rewrite the brief, restart the app, and the researcher follows the new one. Add a folder with a second file and the team has a new worker.

Every file in `workforce/` must be used. A stray `notes.txt`, or a `WORKER.md` that does not parse, stops the app from starting, and the error names each one.

The running app never writes to that file. When Alice edits the researcher inside a deployed app, she gets her own copy under the same id, one row in her user scope in the app's store. Bob sees the standard worker; a worker in Alice's roster is visible only to her.

## A kit is a feature you install

The team, the task board its workers share and the coding agents they hand work to all come from kits. The starter lists them:

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { fetch, search } from "@flow-state-dev/tools";
import { workforce } from "@flow-state-dev/workforce/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";

// Where each coding run gets its own copy of this repo.
const workspace = localWorkspaceHost({
  root: "./runs",
  remotes: { allow: [] },
  localRepositories: [process.cwd()],
  source: () => ({ kind: "repo", repo: process.cwd() }),
});

export default createFlowState({
  kits: [
    // The tools a worker's `tools:` line can name.
    workforce({ directory: "./workforce", agent: { catalog: { search: search(), fetch: fetch() } } }),
    harnesses({ workspace }),
    claudeCode(),
  ],
});
```

To add a feature, add its kit's factory, called with its config, to `kits`. List order does not matter. `harnesses` requires `workforce`, and an app missing a required kit is refused at build.

A kit brings its flows, the files it reads from your repo, and its views, which are the lists and details your pages show. A kit can also leave openings, called slots, for other kits to fill. `harnesses` opens a slot for coding agents and `claudeCode` fills it. How a kit names the kits whose slots it fills is in the [Kits reference](../reference/kits.md).

Kits stack: `harnesses` fills slots in `workforce`, and `claudeCode` fills one `harnesses` opens.

## Kits are made of flows and blocks

Under every kit are flows. A flow is a self-contained part of your backend, with actions that clients call over HTTP. A client runs one of its actions, such as `chat`, and the flow streams results back as it produces them and keeps typed state between calls. Flows are built from blocks, and there are five kinds:

| Block | What it does |
| --- | --- |
| Generator | Calls a model |
| Handler | Runs your code |
| Sequencer | Chains blocks into steps |
| Router | Picks one block to run |
| Evaluator | Asks a model a typed question |

Blocks nest inside one another. Any block can also be handed to a model as a tool, a whole pipeline included:

```ts title="src/flows/research/blocks/assistant.ts"
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const planQueries = generator({
  name: "plan-queries",
  model: "openai/gpt-6-luna",
  prompt: "Write three search queries for the topic.",
  inputSchema: z.object({ topic: z.string() }),
  user: (input) => input.topic,
  outputSchema: z.object({ queries: z.array(z.string()) }),
});

const runSearches = handler({
  name: "run-searches",
  inputSchema: z.object({ queries: z.array(z.string()) }),
  outputSchema: z.string(),
  execute: async ({ queries }) => queries.map((q) => `Results for ${q}`).join("\n"), // your code calls a search API
});

const summarize = generator({
  name: "summarize",
  model: "openai/gpt-6-luna",
  prompt: "Summarize the search results.",
  inputSchema: z.string(),
  user: (results) => results,
});

const research = sequencer({ name: "research", inputSchema: z.object({ topic: z.string() }) })
  .step(planQueries)   // a generator: the model writes search queries
  .step(runSearches)   // a handler: your code runs them
  .step(summarize);    // a generator again

export const assistant = generator({
  name: "assistant",
  model: "openai/gpt-6-luna",
  prompt: "You help the user research a topic.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
  tools: [research],   // the whole pipeline is one tool call
});
```

You decide, step by step, where the model chooses and where your code does.

## You build it with an agent

Every flow runs from a terminal, with no server and no browser:

```bash
pnpm fsdev run hello-chat chat -i '{"message": "Hello!"}'
```

The run prints what happens as it happens ([CLI reference](../reference/cli.md)). A coding agent can write a flow, run it, read the output and fix it. [Build with your coding agent](./build-with-your-coding-agent.md) sets that up.

## Where it stands

Flow State is open source, written in TypeScript, and runs as a web service you host. It is an early preview. The starters are research software, and each one's README lists what isn't wired yet.

## Next

- [Run a starter](./run-a-starter.md) takes about ten minutes and one API key.
- [How it fits together](../concepts/how-it-fits-together.md) goes through the layers above, one at a time.
- [Add to an existing app](./add-to-an-existing-app.md) is the way in when you already have a product and want flows inside it.
