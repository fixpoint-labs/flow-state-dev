---
title: Pausing, resuming and surviving a crash
type: concept
description: A run is a record in a store, not a process, so it can wait for a person for days or pick up after a crash, and the work that finished is not done twice.
---

import Figure from "@site/src/components/Figure";
import RunThatStopsAndStarts from "./figures/a-run-that-stops-and-starts.svg";

# Pausing, resuming and surviving a crash

A run that calls a model and a few tools can take a while, and some of its steps should not happen until a person says yes. A process can also die halfway through. Flow State treats both the same way: a run is a record in a store, not a process. What has finished is written down, so a run can stop, wait as long as it needs, and carry on in any process that can read the store.

The example is a support desk's reply. A customer asks for $250 back, and a refund over $100 needs approval before it goes out. The flow runs `cleanMessage`, a block that tidies the customer's text, then `draftReply`, a block that asks a model and lets it call tools, which are functions the model can run: here `lookUpOrder` and `issueRefund`.

<Figure svg={RunThatStopsAndStarts} caption="A run that stops and starts" description={"A timeline in three columns joined by arrows that mean then. On the left, the first part of the run, in one process, with a dashed outline because it lasts one action run: cleanMessage and lookUpOrder are hatched because their outputs are recorded, and issueRefund asks whether to refund $250. In the middle, the wait, hatched because it is stored and outlives the request: the finished outputs, the open question and the status suspended, with the note that a restart can happen here. On the right, the second part of the run, in any process, also dashed: cleanMessage and lookUpOrder reuse their recorded outputs, and issueRefund, highlighted, picks up here."} />

## A reply that needs approval

The pause is one call in the tool.

```ts title="src/flows/support/tools/issue-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const issueRefund = handler({
  name: "issue-refund",
  description: "Refund an order. Use it when the customer asks for their money back.",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  outputSchema: z.object({ refunded: z.boolean() }),
  execute: async (input, ctx) => {
    if (input.amount > 100) {
      await ctx.suspend!({
        reason: "user_approval",
        message: `Refund $${input.amount} on ${input.orderId}?`,
      });
    }
    // Your payments call goes here, after the answer. Give it a stable
    // idempotency key: a crash before this tool's output is saved runs it again.
    return { refunded: true };
  },
});
```

Add `tools: [lookUpOrder, issueRefund]` to `draftReply`, importing both from `../tools/`. `ctx.suspend` is the pause. It is typed as optional on the context, so the example writes `ctx.suspend!`. A refund of $100 or less never reaches it, because `execute` is ordinary TypeScript.

## Pausing

When a tool calls `ctx.suspend`, the run stops at that step and waits. No thread or connection is held, and on serverless the function returns instead of timing out. The browser receives a `suspension` item carrying the message. The [durable execution reference](../reference/durable-execution.md) lists the request's status while paused, what the stream sends, and how a deadline expires it.

Where is the run while it waits? In the store: the request, its items so far, the open question and each finished block's recorded output.

## Resuming

The answer is one call from the screen. `useSuspensions` lists what is waiting and approves it.

```tsx title="src/lib/pending-refunds.tsx"
import { useSession, useSuspensions } from "@flow-state-dev/react";

export function PendingRefunds({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const { pending, approve } = useSuspensions(session, { reasons: ["user_approval"] });
  return (
    <ul>
      {pending.map(({ item }) => (
        <li key={item.suspensionId}>
          {item.message}
          <button onClick={() => approve(item.suspensionId)}>Approve</button>
        </li>
      ))}
    </ul>
  );
}
```

Render it under the `FlowProvider` that names the `support` flow. Approving continues the same request under the same id, and the continuation streams into `session.items`. The log reads in order: the items before the pause, the `suspension` item, a `suspension_resume` item recording who answered and how, then the items after.

Only the user whose request it is can answer it. The [durable execution reference](../reference/durable-execution.md) lists what a refused answer returns.

## What does not run twice

On resume, a block that already finished reuses its recorded output instead of running again. The answer can come a day later, after a deploy, in a new process over the same store. Here is what that process runs:

- `cleanMessage` and `lookUpOrder` are not run again. The order is not looked up twice.
- The model is not asked again for the turns it already answered.
- `issueRefund` runs again from its top, because it is the block that paused. The [durable execution reference](../reference/durable-execution.md) covers what that run does.

So put the side effect after `ctx.suspend`, as the tool does. Anything a tool did before pausing would happen twice. The same page lists the guards for a side effect that has to run before the pause.

## A crash is the same shape

A process that dies mid-run leaves its request unfinished. When the server is back, the request is offered to its user to continue.

```ts title="src/lib/continue-lost-turns.ts"
import { createClient } from "@flow-state-dev/client";

export async function continueLostTurns(userId: string) {
  const fsd = createClient({ userId, baseUrl: "http://localhost:3000" });
  for (const lost of await fsd.requests.interrupted()) {
    await lost.continue();
  }
}
```

`continue()` keeps the request id and reuses every finished output. If the process died right after `lookUpOrder`, the order is not looked up again. The [durable execution reference](../reference/durable-execution.md) covers what runs again and how to guard it.

A pause is not a crash. A suspended request is waiting for an answer and needs no continue.

## A second message while it waits

While the refund waits, the customer sends another message on the same session. It runs: a paused request does not hold up the session. The [concurrency reference](../reference/concurrency.md) lists the policies and how the answer is treated when it arrives.

## What it needs

A store that persists. `createFlowState` with no `stores` keeps everything in memory, so a crash loses the run with the process, and a pause there is refused. The [durable execution reference](../reference/durable-execution.md) gives the error.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: sqliteStores({ filename: "support.db" }),
});
```

There is no separate setting to enable it. The [stores reference](../reference/stores.md) lists the defaults for `fsdev dev` and `fsdev run`. `support` is the flow defined in `src/flows/support/flow.ts`, shown in [Flows and actions](./flows-and-actions.md).

## What it gets you

- **A wait holds no process or connection.** While the refund waits, the run is a record in the store. Storage is the only cost.
- **The answer can come after a restart or a deploy.** A pause with no deadline does not expire, and the same request continues.
- **Finished work is not repeated.** After approval, or after a crash, the order is not looked up again and the model is not asked again for turns it finished.
- **One log tells the story.** The items before the pause, who answered, and the items after are one ordered list on one request.

## How it fits with the others

A pause is not a background queue. Nothing runs while it waits, and what waits is one request. [Background work](./background-work.md) covers work that runs while nobody is watching, and a task board, a stored list of work that runs in the background, can pause a task for a user the same way.

## Next

- [Persistence](./persistence.md) covers the stores that hold a pause, and which to pick.
- [Generators and tools](./generators-and-tools.md) covers the model and the tools that call `ctx.suspend`.
- [Background work](./background-work.md) covers runs that start without a request.
- [Durable execution reference](../reference/durable-execution.md) lists the options and returns of `ctx.suspend`, the four ways to answer, refusals, deadlines and retention.
