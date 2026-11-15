---
title: Build with your coding agent
type: start
description: Hand a coding agent the docs and the skills, and it can write a flow, run it, read what happened and fix it.
---

import Figure from "@site/src/components/Figure";
import TheLoop from "./figures/the-loop.svg";

# Build with your coding agent

A coding agent writes code quickly and checks it badly, unless it has something to run. Flow State gives it something. A flow, the backend piece you write, runs from a terminal with one command that prints what happened, one JSON event per line. The agent writes the flow, runs it, reads the events and fixes what failed. There is no browser to click through and no server to start.

This page sets that up. You give the agent the docs and the skills, ask for a change, and watch the loop close.

## Why the loop works

`fsdev run` runs one action of a flow the way your server would, without starting one. It prints one JSON event per line, so an agent can parse the output and read the result. [The CLI reference](../reference/cli.md) has the output and exit codes. A generator, the block that calls a model, needs its provider's key in `.env.local` for the run to work, and [the environment reference](../reference/environment.md) lists the keys.

<Figure svg={TheLoop} caption="The loop an agent runs on its own" description={"Four boxes in a ring, joined by arrows. Write: change the flow, a block or the actions it serves. Run, drawn with a dashed outline because it lasts one action run: fsdev run research chat, in one process with no server. Read: the events, highlighted as the idea to leave with, which tell the agent which block failed and why. Fix: change what failed, then run it again, with an arrow back to write. A note says nothing in the ring waits for a user; the agent goes round until the run completes."} />

## Give your agent the docs

The docs site publishes an index for agents at `/llms.txt`, and serves every page as Markdown at its URL plus `.md`. Start the agent there.

```text title="Prompt"
Read https://flow-state.dev/llms.txt before you write any Flow State code.
Each page it lists is also available as Markdown.
```

## Give it the skills

A skill is a Markdown file a coding agent loads when a task calls for it. The Flow State repository keeps its skills under `.agents/skills/`. Copy a skill's folder into your agent's skills folder to use it. There is no installer for these.

- `debug-flow` teaches the run-and-read half of this loop: the event traces, the logs, running one block alone and a table of common failures.
- `diagnose` is the bug loop that calls `debug-flow`.
- `create-block` and `add-flow` cover writing the code.

`install-fsd` is separate. A coding agent runs it to add Flow State to an existing app, as [Add to an existing app](./add-to-an-existing-app.md) describes.

{/* Reconcile at cutover: starter-bundled skills pack and agent instructions file are not in any starter yet. */}

## Ask for a change

The change below is to the research pipeline from [What Flow State is](./what-flow-state-is.md). Its flow serves the `assistant` generator as the `chat` action:

```ts title="src/flows/research/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { assistant } from "./blocks/assistant";

const research = defineFlow({
  kind: "research",
  actions: {
    chat: { block: assistant, userMessage: (input) => input.message },
  },
});

export default research();
```

Say what you want and how to check it.

```text title="Prompt"
In the research flow, drop duplicate search queries before runSearches.
Run the flow with fsdev run and fix anything that fails.
```

The change should be one new block and one new step:

```ts title="src/flows/research/blocks/dedupe-queries.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const queries = z.object({ queries: z.array(z.string()) });

export const dedupeQueries = handler({
  name: "dedupe-queries",
  inputSchema: queries,
  outputSchema: queries,
  execute: async (input) => ({ queries: [...new Set(input.queries)] }),
});

export default dedupeQueries;
```

```diff title="src/flows/research/blocks/assistant.ts"
+import { dedupeQueries } from "./dedupe-queries";

 const research = sequencer({ name: "research", inputSchema: z.object({ topic: z.string() }) })
   .step(planQueries)
+  .step(dedupeQueries)
   .step(runSearches)
```

Then the agent runs it. `--capture` also writes the whole run to one file, which is easy to diff between attempts.

```bash title="Terminal"
pnpm fsdev run research chat -i '{"message": "compare acme and globex"}' --capture run.json
```

## When it gets stuck

Every block that runs leaves a `block_trace` item with its name, status, input and output. A failed block's trace ends with `"status": "failed"` and an `error`. That is the step to look at. [The items reference](../reference/items.md) lists the fields.

Say the agent's first try has `planQueries` return its list as `query`, so `dedupeQueries` gets input it can't accept. The run fails, and the trace says where. The sequencer that holds the block fails too, so the filter keeps only the handler's trace.

```bash title="Terminal"
jq -c '.events[] | select(.type=="item_done" and .item.type=="block_trace" and .item.status=="failed" and .item.blockKind=="handler")
  | {block: .item.blockName, error: .item.error}' run.json
```

```json title="Output"
{"block":"dedupe-queries","error":{"message":"Block \"dedupe-queries\" input validation failed at \"queries\": Required","code":"execution_error"}}
```

The agent knows which block to fix and what it said. To rerun that block without the rest of the flow, use `fsdev block` with the block's file and an input. The file has to default-export the block, as the one above does. [The CLI reference](../reference/cli.md) describes what it prints.

```bash title="Terminal"
pnpm fsdev block src/flows/research/blocks/dedupe-queries.ts -i '{"queries": ["acme", "acme"]}'
```

A `suspended` event means the run is waiting for a user, so it is not done, even though it exits 0. The [CLI reference](../reference/cli.md) covers the other flags and cases.

The loop checks a flow's logic. Checking how a page looks takes a browser, and pure helpers are better covered by tests.

## Next

- [Testing](../concepts/testing.md) covers tests for blocks and flows, with no server and no model.
- [CLI reference](../reference/cli.md) lists every flag and exit code.
- [Items reference](../reference/items.md) describes the shape of each event.
