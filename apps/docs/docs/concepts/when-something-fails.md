---
title: When something fails
type: concept
description: A block fails by throwing. The caller gets an error item with no stack trace, you catch it with a rescue on the step, and you hear about it through a hook.
---

import Figure from "@site/src/components/Figure";
import PathOfAnError from "./figures/the-path-of-an-error.svg";

# When something fails

Code in a flow fails the way any TypeScript does: it throws. Flow State adds no error channel, no result type to check and no status to set. What it decides is where a throw goes next: to a fallback you attach to the step, or, with none, back to the caller as a plain error message. Hooks tell you about failures, so you can log them or send them to an error tracker.

The example is a support desk. A block is one unit of work: a function, a model call, or a chain of them. `handleTicket` is a sequencer, a block that runs other blocks in order. It looks up the customer's order with `lookUpOrder`, then has a model write the reply with `draftReply`.

<Figure svg={PathOfAnError} caption="The path of an error" description={"On the left, a solid box for the sequencer handleTicket, holding two steps. lookUpOrder is marked in red as throwing. draftReply below it is marked as never running. A black arrow labelled THROWS leaves lookUpOrder, with a red bar across it for the failure, and runs to a box on the right for what the caller sees on the stream: an error item marked FAILED in red, carrying the message you threw and no stack trace, and then request.failed ending the stream. A second arrow runs down from that box to a box for what runs after the item is sent. In it, onErrored is highlighted as the place you listen, and errorCapture is named beneath it for your error tracker. Two notes say that nothing catches the throw, so the sequencer stops and the request ends failed, and that the hooks run after the caller has the item, so they cannot change it."} />

## A block throws

```ts title="src/flows/support/blocks/look-up-order.ts"
import { FlowError, handler } from "@flow-state-dev/core";
import { z } from "zod";

export const lookUpOrder = handler({
  name: "look-up-order",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ status: z.string() }),
  execute: async ({ orderId }) => {
    const res = await fetch(`https://orders.example.com/${orderId}`);
    if (!res.ok) {
      throw new FlowError(`No order ${orderId}`, {
        code: "order_not_found",
        details: { orderId },
      });
    }
    const order = (await res.json()) as { status: string };
    return { status: order.status };
  },
});
```

`FlowError` is an `Error` that carries a `code` and `details` you choose. A plain `throw new Error(...)` works too, with a generic code. [Error shapes and codes](../reference/errors.md) lists the fields.

`draftReply` is a generator, a block that calls a model. It takes the text of a message and returns the model's reply as a string.

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Be brief and specific.",
  inputSchema: z.string(),
  user: (input) => input,
});
```

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { draftReply } from "./draft-reply";
import { lookUpOrder } from "./look-up-order";

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ orderId: z.string() }),
})
  .step(lookUpOrder)
  .step((order) => `The order is ${order.status}.`, draftReply);
```

The function before `draftReply` turns the order into the text `draftReply` takes.

When `lookUpOrder` throws, the sequencer stops. `draftReply` never runs. The error goes up to the action, the named entry point a caller invokes (here `reply`), and with nothing to catch it, the request ends `failed`.

A model can also call `lookUpOrder` as a tool. A throw there does not fail the request. The model is told the tool failed, with the message, and carries on. [Generators and tools](./generators-and-tools.md) covers that path.

## What the caller sees

The stream ends with an item of type `error`, then `request.failed`.

```json
{
  "type": "error",
  "status": "failed",
  "message": "No order A-1042",
  "code": "order_not_found",
  "details": { "orderId": "A-1042" }
}
```

`message` is the text you threw, `code` is your code, and `details` are what you passed. There is no stack trace. Write the message as something a caller may read. The message of an error you did not write, such as a failed `fetch`, reaches the caller too. The [error item's fields](../reference/errors.md) are in Reference.

## Catching it in the flow

A `.rescue()` is how you handle a failure inside the flow. You give it a fallback block, and its output takes the place of the failed block's output. The [`.rescue()` row](../reference/sequencer-methods.md) lists the handler options, such as matching only some error classes.

Say a failed model call should become an apology, not an error.

```ts title="src/flows/support/blocks/apologize.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const apologize = handler({
  name: "apologize",
  inputSchema: z.custom<Error>(),
  outputSchema: z.string(),
  execute: async () =>
    "Sorry, a reply could not be written. A person will follow up.",
});
```

In `handleTicket`, the last step becomes `.step((order) => ..., draftReply.rescue([{ block: apologize }]))`, with the function unchanged. `apologize` receives the error and returns a string, as `draftReply` does.

Put on a single step, the rescue is local. If `draftReply` throws, `apologize` runs, its text is the step's output, and the rest of the chain goes on. Put on the sequencer, as `handleTicket.rescue([...])`, it recovers the whole chain: the fallback's output is the sequencer's output and nothing after the failure runs.

A rescued failure is not an error to the caller. The request completes, with no `error` item.

## Hearing about it

`onErrored` lets the flow itself react to a failure. It is a block, set on an action, and it takes `{ requestId, actionName, error }`.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { handleTicket } from "./blocks/handle-ticket";
import { logFailure } from "./blocks/log-failure";

export default defineFlow({
  kind: "support",
  actions: { reply: { block: handleTicket, onErrored: logFailure } },
})();
```

`logFailure` logs the `requestId` and `error.code`.

```ts title="src/flows/support/blocks/log-failure.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const logFailure = handler({
  name: "log-failure",
  inputSchema: z.object({
    requestId: z.string(),
    error: z.object({ code: z.string().optional() }),
  }),
  outputSchema: z.object({}),
  execute: async ({ requestId, error }) => {
    console.error(`request ${requestId} failed`, error.code);
    return {};
  },
});
```

`onErrored` runs only for a request that failed, so a rescued failure never reaches it. It runs after the caller has the item and the request is recorded as failed, so it can watch the failure but not change it. A hook that throws is ignored, and the original failure stands. The [`onErrored` row](../reference/errors.md) has the exact order.

`errorCapture` is for your error tracker. It is an option on the server, and it is off until you set it. The example logs where you would call your tracker.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: sqliteStores({ filename: "support.db" }),
  errorCapture: (event) => {
    if (!event.final) return;
    console.error("request failed", event.requestId, event.error.code);
  },
});
```

The callback fires for the block that threw, and once more for the request, with `final: true`, when the request ends failed. A failure a rescue handled fires the block event only, never the `final` one. To get one report for each request that failed, keep the `if (!event.final) return` check. Remove it and you also hear about each failing block, but a request that fails then reaches your tracker twice. [The capture event row](../reference/errors.md) has the details.

[Sending errors to Sentry](../build/errors-to-sentry.md) goes through the tags and levels.

## What it gets you

- **A caller gets an item, not a crash.** The request settles as `failed`, and the stream carries the message you threw.
- **No stack trace leaves the server.** The caller gets the message, code and details of what was thrown, with no stack and no server paths.
- **A fallback stays local.** `draftReply` can fail while `lookUpOrder`'s result and the rest of `handleTicket` carry on.
- **One request, one report.** `final` gives your tracker a single event for each request that failed.
- **The failed run is kept.** The request is stored with status `failed` and its error, beside the items it emitted before the throw and a trace of the block that threw, which the DevTool shows. The in-memory store loses it on restart; SQLite and Postgres keep it. [Stores](../reference/stores.md) has the rest.

## How it fits with the others

A throw is not the only way a run goes wrong. A retry policy on a block, continuing a request left `failed`, and a crash halfway through belong to [durable execution](../reference/durable-execution.md).

`.rescue()` is one of the ways [composition](./composition.md) joins blocks. Input and output checks on a [block](./blocks.md) fail it the same way a throw does.

## Next

- [Error shapes and codes](../reference/errors.md): every field of the error item and the capture event, and what each code means.
- [Sending errors to Sentry](../build/errors-to-sentry.md): a working adapter, with tags and levels.
- [Durable execution](../reference/durable-execution.md): retries, and continuing a failed request.
- [Composition](./composition.md): the other ways to join blocks.
