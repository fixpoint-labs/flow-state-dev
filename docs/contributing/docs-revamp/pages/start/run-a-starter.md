---
title: Run a starter
type: start
description: Clone the repository, add one model key and talk to a team of AI workers in your browser.
---

import Figure from "@site/src/components/Figure";
import WhatJustStarted from "./figures/what-just-started.svg";

# Run a starter

An agent app is more than a model call. It needs pages to talk on, a server that streams answers, and somewhere to keep the conversations. A starter is that app already put together, so you begin with something running and change it from there.

The Teammates starter is a small team of AI workers: Chief of Staff, researcher and writer. A worker is an agent with a name and a brief that you write in a file. You talk to one at a time, in a browser tab. Three coding agents sit behind the team and take code changes in the background: a worker hands them the change. They are not on the worker list. This page takes about ten minutes.

{/* Screenshot, ./figures/running-app.png: the worker list, one conversation, one answer streaming. Waits for the starter's final screens. */}

## What you need

Node.js 22 or newer with pnpm, and one model key. The repository's README has the exact versions. Coding-agent sign-ins are listed there too; you do not need them to talk to a worker.

## Get the starter

The starters run from a clone of the repository.

```bash
git clone https://github.com/fixpoint-labs/flow-state-dev
cd flow-state-dev
pnpm install
pnpm build:assets   # one time: builds the DevTool, a browser inspector for runs
```

The Teammates starter is the `labs/teammates` folder. To build your own app on it, fork the repository and work there.

## Add your model key

Put the key in a file named `.env.local` at the repository root, or set it in your shell.

```bash title=".env.local"
OPENAI_API_KEY=sk-...
```

A file named `.env` is not read. Git ignores `.env.local`, so the key stays out of your commits. A key already set in your shell wins over the file. `AI_GATEWAY_API_KEY` works too. A key for another provider is not enough on its own, because some of the starter's own calls always use an OpenAI model. The [environment reference](../reference/environment.md) lists where the key is read from. [Models](../concepts/models.md) and the [model reference](../reference/models.md) cover other providers.

## Run it

```bash
pnpm --filter @flow-state-dev/teammates dev
```

Open the address on the banner's `App:` line, `http://localhost:4200` by default. Ctrl+C stops it. The DevTool's address is on the banner's `DevTool:` line. It reads `not served` until `pnpm build:assets` has run. The dev script runs `fsdev dev`; the [CLI reference](../reference/cli.md) covers what it starts.

## Talk to a worker

Pick a worker from the list. Each has a single conversation that goes on between visits.

An empty conversation offers lines to start with. Click "What can the team do for me?" and it fills the box without sending. Press Enter to send. The answer streams in as it is written, and a tool the worker uses shows in the conversation as it uses it.

When Chief of Staff asks researcher for something, a line such as *Messaged researcher* appears in its conversation. Open it to see researcher's turn.

### If a worker does not answer

Look at the conversation first. A failed turn shows its reason and a Retry, and a missing or wrong key is the usual cause ([Errors](../reference/errors.md)). The app reads your key when it starts, so restart it after changing the key ([environment reference](../reference/environment.md)).

Then check the terminal for an error. If the page shows a connection screen instead of the worker list, the server has stopped: restart it, and the screen reconnects by itself ([CLI reference](../reference/cli.md)).

## What you are looking at

<Figure svg={WhatJustStarted} caption="What just started on your machine" description={"Three columns. Your browser holds the starter's pages and a conversation. The app's server process holds the pages, the flow API at /api/flows and the workers. Your store holds your conversation with Chief of Staff, highlighted, one conversation per worker, in the file .fsdev/teammates.sqlite. The store is hatched, which marks what outlives the request. An arrow numbered 01 runs from the browser to the server: the page calls, and answers stream back. An arrow numbered 02 runs from the server to the store: the server saves each conversation, so a restart keeps it."} />

The workers are files. Each one is a folder with a `WORKER.md` in the starter's `workforce/` folder, at `labs/teammates/workforce/teams/teammates/workers/<name>/WORKER.md`. Here is researcher, shortened to its first paragraph and the tools it reads and searches with:

```md title="workforce/teams/teammates/workers/researcher/WORKER.md"
---
name: researcher
description: Finds facts for the team, in the working folder's files and on the web, and replies to whoever asked.
tools: [globProjectSource, readProjectSource, grepProjectSource, search, fetch]
---

You find facts: dates, prices, what a document or the code says. Look them up, never guess: read the
working folder's files with `globProjectSource`, `grepProjectSource` and `readProjectSource`, and
search the web with `search` and `fetch`. Say where each fact came from: the file's path, or the
page's URL.
```

The list shows each worker's `name`, and the Markdown below the frontmatter is its instructions ([`WORKER.md` reference](../reference/worker-md.md)). To change what researcher is told, edit that body in its `WORKER.md`. The starter does not watch files, so the change applies the next time you start it. Add a folder and the team has a new worker ([the workforce folder](../reference/workforce-folder.md)).

Conversations survive a restart, and so do a turn a crash cut off (listed as interrupted) and the task it started. They are kept in a SQLite file, by default `labs/teammates/.fsdev/teammates.sqlite`, which git ignores. Each worker has one conversation per user, and the starter runs as one user, so it is yours. Stopping the server clears nothing. To start from nothing, stop the server and delete the `.fsdev/` folder in `labs/teammates` ([Stores](../reference/stores.md), [Pause, resume and replay](../reference/durable-execution.md)).

## Next

- [Workers](../concepts/workers.md) covers the file, each user's copy of a worker, and how to hire another.
- [Persistence](../concepts/persistence.md) is about what the store keeps and the choices beyond SQLite.
- [How it fits together](../concepts/how-it-fits-together.md) goes through the layers behind this app.
