---
title: Coordinators
type: catalog
description: One front door for a team of workers. A coordinator reads each message and hands it to the delegate that should answer.
---

import Figure from "@site/src/components/Figure";
import OneDoor from "./figures/one-door.svg";

# Coordinators

A team of specialist agents is awkward to talk to one at a time. Nobody should have to know which agent handles devices and which handles accounts before they type a question.

A coordinator is one agent that stands in front of the rest. Users talk only to it. It reads each message, hands it to the specialist who should answer, and the answer appears in the same conversation under the specialist's name. The specialists are its **delegates**. A coordinator is itself a **worker**, the named agent that Workforce runs from a Markdown file. Choosing who answers is a job of its own, so you can change how it chooses, or who it can choose from, without touching the specialists.

<Figure svg={OneDoor} caption="One door, several workers" description={"On the left, a box for a message from the user. An arrow labelled hands to runs to the middle box, the coordinator support.help, whose settings read routing best-fit and fallback support.general. A second arrow runs from the coordinator to one of four boxes on the right, support.devices, which is highlighted as the delegate it chose. The other three delegates, support.accounts, support.fsd and support.general, receive nothing for this message."} />

## What you get

- **One address.** Users open a conversation with `support.help` and never name a specialist.
- **Answers under the specialist's name.** The reply lands in the conversation as a message from the delegate that took it.
- **Four ways to choose**, set in the coordinator's file.
- **Every delegation is a task.** Each one shows in the user's task list and can be cancelled.

## Install it

Coordinators come with the Workforce kit.

```bash
pnpm add @flow-state-dev/workforce
```

The kit builds the coordinator flow when you give it a `coordinator` key:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";

export default createFlowState({
  kits: [
    workforce({
      agent: { model: "openai/gpt-6-luna" },
      coordinator: { routeModel: "openai/gpt-6-luna" },
    }),
  ],
});
```

`routeModel` is the model a coordinator asks to pick a delegate when it routes by best fit. The kit requires it whichever routing you use. The kit reads the `workforce/` folder from disk, so import it only in server code such as `fsdev.config.ts`. Without the `coordinator` key, a worker file that names `flow: coordinator` stops the app from starting. The [workforce reference](../../reference/workforce.md) lists every kit option.

## Use it

### The coordinator's file

```md title="workforce/teams/support/workers/help/WORKER.md"
---
description: Ask the support team anything.
flow: coordinator
delegates: [support.devices, support.accounts, support.fsd, support.general]
routing: best-fit
fallback: support.general
---

Ask here. The specialist whose subject fits your post answers it under its own name.
```

`flow: coordinator` makes it a coordinator. The folders give it the id `support.help`, and `delegates` lists the workers it can hand to, by id. Everything below the second `---` is the coordinator's own instructions.

A delegate has to be a worker on the user's own roster whose flow takes tasks. The [workforce reference](../../reference/workforce.md) has the limits on the list.

### Talking to it

You talk to a coordinator as you talk to any worker.

```ts title="src/lib/ask-help.ts"
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

export async function askHelp(userId: string, message: string) {
  const fsd = createClient({ userId, baseUrl: "" });
  const workforce = createWorkforceClient(fsd);

  const session = await workforce.ensureWorkerSession({ worker: "support.help" });

  return fsd.flow(session.flowKind).send("respond", { message }, { sessionId: session.id });
}
```

The delegate that took the message works it in a session of its own for this conversation, and its answer is added to the conversation with its worker id as the author.

### Choosing how it routes

`routing` takes one of four values.

- **`judgment`**, the default. The coordinator's own model reads the message and decides. It files a task for a delegate, as often as it likes, or answers the message itself.
- **`best-fit`**. One call to `routeModel` reads the message and the conversation's recent lines, and picks the delegate whose description fits.
- **`round-robin`** hands each message to the next delegate in list order.
- **`everyone`** hands it to every delegate that can take it.

The last two make no model call. The options that tune each routing are on the [workforce reference](../../reference/workforce.md).

**When nothing fits.** Under `judgment`, the coordinator answers the message itself. Under `best-fit`, a message it can't place goes to the `fallback:` delegate. With no fallback, or one that can't be reached, the coordinator's own turn takes the message, as it would under `judgment`. If that turn fails too, nobody takes it. The conversation shows `Nobody took this message: best fit couldn't place it, and the coordinator's own turn failed: <error>.` and the route record has `by: "unplaced"`.

Under `round-robin` and `everyone`, a message with no delegate that can take it (one on the user's roster whose flow takes tasks) gets `Nobody took this message: no delegate in this conversation can be reached.` What each routing tries first is on the reference.

### Letting delegates answer each other

By default a delegate's answer lands in the conversation and goes no further. Set `rounds` and each answer goes back out to the other delegates, by the same routing, for that many rounds:

```yaml title="workforce/teams/support/workers/help/WORKER.md"
rounds: 1
```

`rounds` runs from 0 to 3. An answer is never routed back to its author. More rounds means more delegate turns per message. When each answer goes out, for each routing, is on the [workforce reference](../../reference/workforce.md).

### Handing out tasks

Routing is one use of tasks. A coordinator can also hand a delegate a task of its own making. Its model has the task board's tools, such as `createTask`, and the assignee must be one of the conversation's delegates. [Delegating work](./delegating-work.md) covers filing, splitting and hearing how a task ended.

## Slots and views

A coordinator opens no slot and fills none in another kit. It serves one view, `listTasks_tasks`, the conversation's task list. It also emits one `coordinator-route` data item per routing decision, a structured record of who got the message and why. Your screen can pick these out of the conversation by their `dataType`, `coordinator-route`, and show them apart from messages.

## Change it

### Change who it can hand work to

`delegates` and `fallback` in the file are where each new conversation starts. A conversation copies them into its own state the first time its delegates are read or changed, which is its first message or its first delegate action. After that, changes stay in that conversation. Other conversations, including ones already open, don't see them, and the `WORKER.md` is never written. If you later edit `delegates:` in the file yourself, only conversations that haven't had a message or a delegate action yet pick it up.

```ts title="src/lib/change-delegates.ts"
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

export async function reshuffle(userId: string) {
  const fsd = createClient({ userId, baseUrl: "" });
  const workforce = createWorkforceClient(fsd);
  const session = await workforce.ensureWorkerSession({ worker: "support.help" });
  const help = fsd.flow(session.flowKind);
  const options = { sessionId: session.id };

  await help.send("addDelegate", { worker: "support.billing", note: "Invoices and refunds" }, options);
  await help.send("removeDelegate", { worker: "support.fsd" }, options);
}
```

`support.billing` has to be on the user's roster and take tasks, or the call is refused and nothing changes. The note is optional. It is what best fit reads to decide whether this delegate fits a message, ahead of the worker's description. Setting `editsOwnDelegates: true` in the file gives the coordinator's own model the same actions as tools.

### Make your own flow a delegate

A worker on the built-in `agent` flow, and another coordinator, takes a coordinator's tasks with no setup. A worker flow of your own does once it declares the `contributor` role and its `work` task entry is built with `workerTaskEntry`. Like every worker flow, it also needs an `onMessageReceived` entry, built with `messageReceivedEntry`, so other workers can message it. If the flow is missing any of the three, the app does not start.

```ts title="src/flows/refunds/flow.ts"
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  messageReceivedEntry,
  promptedMessageTurn,
  workerConfigSchema,
  workerFlow,
  workerTaskEntry,
} from "@flow-state-dev/workforce";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const turn = handler({
  name: "refunds-turn",
  inputSchema,
  execute: async ({ message }) => `Refund started for: ${message}`,
});

export const refunds = workerFlow(
  (installation) =>
    defineFlow({
      kind: "refunds",
      configSchema: workerConfigSchema(),
      session: installation.session(),
      resources: { ...installation.resources },
      actions: { respond: { inputSchema, block: turn, userMessage: (input) => input.message } },
      task: { actions: { work: workerTaskEntry({ name: "refunds-task", turn }) } },
      internal: {
        actions: {
          onMessageReceived: messageReceivedEntry({
            installation,
            flowKind: "refunds",
            turn: promptedMessageTurn(turn),
          }),
        },
      },
    }),
  { roles: ["contributor"] },
);
```

`turn` is one message in, one answer out: each task runs as one turn in a task session of its own, and what it returns is the task's result. Register the flow in the kit as `generated: { workerFlows: { refunds } }`, beside `coordinator`. Then add a worker file with `flow: refunds`, say `support.refunds`, and list it in the coordinator's `delegates`.

To replace the coordinator flow, register your own under the name `coordinator` in `workerFlows` and drop the kit's `coordinator` key. The kit's `coordinator` key also takes `agent`, the built-in agent's options for the coordinator's own turn.

## Next

- [Delegating work](./delegating-work.md), for how a task is filed, split and reported.
- [Workers](../../concepts/workers.md), for the file every coordinator is written in.
- [Tasks and boards](../../concepts/tasks-and-boards.md), the list a delegation is stored on.
- [The workforce reference](../../reference/workforce.md), for every routing option and what a route record holds.
