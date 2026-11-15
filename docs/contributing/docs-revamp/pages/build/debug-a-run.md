---
title: Debug a run with the DevTool
type: tutorial
description: Follow one failing run in the DevTool from the session list to the block that failed, read what the model was told, and resolve a run that is waiting on approval.
---

import Figure from "@site/src/components/Figure";
import DevtoolPanels from "./figures/devtool-panels.svg";

# Debug a run with the DevTool

The DevTool is a page in your browser that shows what your flows did. A flow is a self-contained system in your app that clients call by action name. It is built from blocks, named pieces of work that are either your code or a model. Every run leaves a record of which blocks ran, what each one received and returned, and what each model was told. The DevTool reads that record.

Without it, a failed run is one error on top of a pile of steps, and you find the broken one by adding logging and running again. The record is already there, so the DevTool lays the run out as the tree of blocks it was, and you open the one that failed.

## What you will do

A support desk's `reply` action fails when it runs. You will start the DevTool, find the failed run, open the block that broke, fix it, then read what the model was told and where the session's state is shown. The last step resolves a run that is waiting for someone to approve it.

Here is the flow's pipeline, with the bug in it. First the blocks:

```ts title="src/flows/support/blocks/clean-message.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const cleanMessage = handler({
  name: "clean-message",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ text: z.string(), truncated: z.boolean() }),
  execute: async (input) => {
    const text = input.message.trim();
    return { text: text.slice(0, 2000), truncated: text.length > 2000 };
  },
});
```

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Be brief and specific.",
  inputSchema: z.string(),
  user: (input) => input,
  itemVisibility: { client: true, history: true },
});
```

Then the sequencer that joins them:

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { cleanMessage } from "./clean-message";
import { draftReply } from "./draft-reply";

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ message: z.string() }),
})
  .step(cleanMessage)
  .step(draftReply);
```

A sequencer is a block that runs other blocks in order. `cleanMessage` trims the customer's message and returns an object, `{ text, truncated }`. `draftReply` asks a model to write the answer and takes a string. Nothing between them turns one into the other. TypeScript accepts the file, and the run fails. The [Blocks](../concepts/blocks.md) page explains both blocks.

The flow gives the sequencer a `reply` action:

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { handleTicket } from "./blocks/handle-ticket";

export const supportFlow = defineFlow({
  kind: "support",
  actions: {
    reply: { block: handleTicket, inputSchema: z.object({ message: z.string() }) },
  },
});

export default supportFlow();
```

## 1. Open the DevTool

Install the CLI and the DevTool's pre-built page as dev dependencies.

```bash
pnpm add -D @flow-state-dev/fsdev @flow-state-dev/devtool --allow-build=better-sqlite3
```

The CLI stores runs in SQLite by default, and the flag lets pnpm 10.4 or later build that native module. Leave it off on pnpm 9, npm, yarn and bun.

Start the server from the project root.

```bash
pnpm fsdev dev
```

```text
DevTool server running at http://localhost:4200
Flows:  support
API:    http://localhost:4200/api/flows
Data:   .fsdev/data/fsdev.db (SQLite)
```

Your browser opens on the DevTool. The `Flows:` line should list `support`. If it exits with `No flows found`, the [CLI reference](../reference/cli.md) lists where it looks for flows and the flags that change that, along with the port and the browser.

<Figure svg={DevtoolPanels} caption="The DevTool's four panels" description={"Three columns. On the left, a box labelled sessions holds the support flow with two sessions listed, one open, and the buttons Refresh sessions and New session. In the middle, a box labelled items has the tabs Stream, Trace, Tasks and Suspensions, a request marked failed, a tree of three blocks (handle-ticket, then clean-message marked completed, then draft-reply marked failed and highlighted) and the action bar for sending the reply action. On the right, two boxes stacked: state, headed Session Context, with Client Data and Resources, and below it block detail for draft-reply, with sections Error and Input. The highlighted draft-reply row is the block that failed."} />

## 2. Find the run

A session is where a flow keeps a run of requests together. One call to an action is one request. The left rail lists your flows, with `support` among them. Select a session under it, or click `New session` to make one.

Pick the `reply` action in the action bar, type `{ "message": "Where is my order?" }` as the input, and click `Send action →`. The request appears in the middle with the status `failed`, and the live pill beside the session badge reads `Failed`.

The header shows `support` and a shortened session id.

If you make the failing run from the terminal with `fsdev run` instead, it belongs in this list. With no config, `fsdev run` and `fsdev dev` write the same SQLite file as the same user, `devuser`. But a running `fsdev dev` isn't told about writes as they happen, so the new session is missing until you reload the page or click `Refresh sessions`.

The DevTool acts as one user and lists only that user's sessions. A session a teammate created as a different user never appears in your list. The [CLI reference](../reference/cli.md) covers which user the DevTool acts as and how to link straight to a session.

## 3. Read the items

The `Stream` tab is open. It shows the request's items in the order they were emitted: messages, tool output, state changes, errors. An item is one unit of what a run produces, and [Sessions, items and streaming](../concepts/sessions-items-and-streaming.md) covers them. Here the stream ends with an `error` item, and its message begins `Block "draft-reply" input validation failed`.

Click the item. The right-hand panel names the block that emitted it, with its instance id, phase and status. The error was thrown by `draft-reply`, not by `handle-ticket`.

## 4. Open the block that failed

Open the `Trace` tab. Each request is a tree of block rows: a status square, the block's name, and a bar showing when it started and how long it took. Click the chevron to open the request if it is collapsed. `clean-message` is `completed`. `draft-reply` is red.

Under each row, one line reads `in` and `out` with a short preview of what the block received and returned. Hover for the full value.

Click `draft-reply`. The right-hand panel opens with a `Block` header showing the block's kind and name, its status and how long it took. Its sections include:

- **Error** has the message.
- **Output**, closed by default, is what a block returned. `draft-reply` has none, so click `clean-message` and open its Output: `{ text, truncated }`.

That object is what `draft-reply` was handed, and its row's `in` preview shows the same value. `draftReply` takes `z.string()`, so the mismatch is plain: it was handed an object. The [errors reference](../reference/errors.md) lists the other shapes a failed block's panel can show.

Fix it with a connector, a function between two steps that reshapes one block's output into the next block's input. In `handleTicket`, change the second step to `.step((cleaned) => cleaned.text, draftReply)`, which hands `draftReply` the string. Restart `fsdev dev` and reload the page. The DevTool reopens the session you had open; if it does not, select it. Send `reply` again. This time all three rows are `completed`.

Open `draft-reply` once more. A generator's panel shows what the model was told:

- **Prompt** is the prompt after it resolved: `You answer customer support messages. Be brief and specific.`
- **User Message** is what was sent this turn, the string the connector produced.
- **History** lists the earlier conversation sent along with it, and **Resolved Config** holds the model and its tools.

If these sections are missing, the [environment reference](../reference/environment.md) covers `FSDEV_TRACE_OBSERVABILITY`, the setting that records them.

## 5. Look at state and resources

The top of the right-hand rail is `Session Context`. It shows the session's state, and its refresh button is `Refresh state`. `Client Data` underneath holds what a browser would receive from it. The flow on this page declares no state, so both are empty; add the `ticketCount` from [State and scopes](../concepts/state-and-scopes.md) and it appears here.

Below it is `Resources`, which shows each resource's full state on the server. Add the `ticketNotes` collection from [Resources](../concepts/resources.md) and its notes are listed here. The [resources reference](../reference/resources.md) explains how this server copy differs from what a browser receives.

Both panels show state as it is when you look, not as it was when `draft-reply` failed. The DevTool keeps no history of earlier values.

On a non-local `--host`, the Resources panel and the Suspensions tab show a message that debug endpoints are disabled instead of their contents. The [CLI reference](../reference/cli.md) says why.

## 6. Resolve a paused run

A run can wait for a user to approve it. Suppose `draftReply` has an `issueRefund` tool that pauses for approval over $100, as in [Pausing, resuming and surviving a crash](../concepts/pausing-resuming-and-surviving-a-crash.md). [Put a human in the loop](./human-in-the-loop.md) builds that gate. A customer asks for a $250 refund and the request ends `suspended`, not `failed`.

In the `Stream` tab a `suspended` row appears, with the reason and message, highlighted while it is pending. Open the `Suspensions` tab. It lists the session's pauses with `Created`, `Flow`, `Reason` and `Status`, and a status filter.

Select the pending row. The panel shows the message the code passed to `ctx.suspend()`, then the pause's flow, action, reason and request. Below them are:

- a `Resume data (JSON)` box, left empty to send nothing,
- `Approve`, and
- `Reject`.

Click `Approve`. The request continues under the same id. The list refreshes, and the `Stream` tab shows a `suspension_resume` item and then the work after the pause, with no reload.

Three things can go differently:

- If you type resume data that isn't valid JSON, the panel shows `Resume data is not valid JSON.` and sends nothing. Fix the text and click again.
- If the server rejects the resolve, its error shows inline under the textarea.
- A suspension someone already resolved is read-only. It reads `This suspension is already resolved.` and has no `Approve` or `Reject` controls. Resolving does not delete the record: it stays in the list with its `approved` or `rejected` status.

A run you paused from `fsdev run` shows up here too, after a reload. How long a pause lasts, and which pauses cannot be resumed, is in the [durable execution reference](../reference/durable-execution.md).

## Where to go next

When something looks wrong, here is where to look.

- **A block did not get the input you expected.** Its row's `in` preview, and the Output of the block before it.
- **State did not update.** `Session Context`, then the state section of the sequencer.
- **An item shows here but not in your app.** The `Stream` tab also shows the framework's own trace items, which your app's client does not receive. [Items](../reference/items.md) lists them.
- **A generator returned the wrong shape.** `Raw output` and `Validation issues` on the failed block.
- **A tool block threw.** `Tool Call` and `Input` on the failed block.

From here:

- [Sessions, items and streaming](../concepts/sessions-items-and-streaming.md) explains what an item is.
- [Items](../reference/items.md) lists trace items and their shapes.
- [Put a human in the loop](./human-in-the-loop.md) builds the approval gate from step 6.
- [CLI](../reference/cli.md) has every `fsdev dev` flag, and `fsdev block`, which runs one block with the DevTool closed.
