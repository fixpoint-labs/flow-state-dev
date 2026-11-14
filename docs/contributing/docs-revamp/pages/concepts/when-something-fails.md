---
title: When something fails
type: concept
description: A block fails by throwing. The caller gets an error item with no stack trace, you catch it with a rescue on the step, and you hear about it through a hook.
---

import Figure from "@site/src/components/Figure";
import PathOfAnError from "./figures/the-path-of-an-error.svg";

# When something fails

Code in a flow fails the way any TypeScript does: it throws. Flow State adds no error channel, no result type to check and no status to set. What it decides is where a throw goes next, and there are three places. It goes back to the caller as a plain error message. It goes to a fallback you attach to the step, if you attached one. And it goes to a hook that tells you, so you can log it or send it to an error tracker.

The example is a support desk. `handleTicket` is a sequencer, a block that runs other blocks in order. It looks up the customer's order with `lookUpOrder`, then has a model write the reply with `draftReply`. A block is one unit of work: a function, a model call, or a chain of them.

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

`FlowError` is an `Error` with an optional `code`, `retryable`, `details` and `cause`. A plain `throw new Error(...)` works too. Flow State wraps it in a `FlowError` with the generic code `execution_error` and keeps the original as `cause`.

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

When `lookUpOrder` throws, the sequencer stops. `draftReply` never runs. The error goes up to the action that called `handleTicket`, and with nothing to catch it, the request ends `failed`.

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

`message` is the text you threw, `code` is your code, or `execution_error` for a plain throw, and `details` are what you passed. There is no stack trace. Where an error has a `cause`, `details.cause` lists its name and message only. So write the message as something a caller may read.

## Catching it in the flow

A `.rescue()` is how you handle a failure inside the flow. It takes a list of handlers, each a block, and an optional `when` list of error classes. The first handler that matches runs, and a handler with no `when` matches anything. The block receives the error as its input, and its output takes the place of the failed value.

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

In `handleTicket`, the last step becomes `draftReply.rescue([{ block: apologize }])`. `apologize` returns a string, the same shape as `draftReply`.

Put on a single step, the rescue is local. If `draftReply` throws, `apologize` runs, its text is the step's output, and the rest of the chain goes on. Put on the sequencer, as `handleTicket.rescue([...])`, it recovers the whole chain: the fallback's output is the sequencer's output and nothing after the failure runs.

A rescued failure is not an error to the caller. The request completes, with no `error` item.

## Hearing about it

`onErrored` is for code inside the flow. It is a block, set on an action, and it takes `{ requestId, actionName, error }`.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { handleTicket } from "./blocks/handle-ticket";
import { logFailure } from "./blocks/log-failure";

export default defineFlow({
  kind: "support",
  actions: { reply: { block: handleTicket, onErrored: logFailure } },
})();
```

`logFailure` is a handler block, in its own file, that logs the `requestId` and `error.code`. A hook runs after the caller has the item and the request is recorded `failed`, so it can watch the failure but not change it. A hook that throws is ignored.

`errorCapture` is for your error tracker. It is an option on the server, and it is off until you set it.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import * as Sentry from "@sentry/node";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: sqliteStores({ filename: "support.db" }),
  errorCapture: (event) => {
    if (!event.final) return;
    Sentry.captureException(event.error, {
      extra: { requestId: event.requestId },
    });
  },
});
```

The callback fires once for each block that failed, and once more for the request, with `final: true`, when the request ends failed. A failure that a rescue handled fires the first kind and never the second. Keep only `event.final` for one report per request that really failed. Skip it to hear about every failing block. Forward both and you report one failure twice.

[Sending errors to Sentry](../build/errors-to-sentry.md) goes through the tags and levels.

## What it gets you

- **A caller gets an item, not a crash.** The request settles as `failed`, and the stream carries the message you threw.
- **Nothing leaks beyond what the block threw.** No stack, no server paths.
- **A fallback stays local.** `draftReply` can fail while `lookUpOrder`'s result and the rest of `handleTicket` carry on.
- **One request, one report.** `final` gives your tracker a single event for each request that failed.
- **The failed run is kept.** The `error` item and everything the request emitted before the throw stay on its record in the store, as for a finished request. With `sqliteStores` they survive a restart. The in-memory store does not keep them.

## How it fits with the others

A throw is not the only way a run goes wrong. A retry policy on a block, continuing a request left `failed`, and a crash halfway through belong to [durable execution](../reference/durable-execution.md).

`.rescue()` is one of the ways [composition](./composition.md) joins blocks. Input and output checks on a [block](./blocks.md) fail it the same way a throw does.

## Next

- [Error shapes and codes](../reference/errors.md): every field of the error item and the capture event, and what each code means.
- [Sending errors to Sentry](../build/errors-to-sentry.md): a working adapter, with tags and levels.
- [Durable execution](../reference/durable-execution.md): retries, and continuing a failed request.
- [Composition](./composition.md): the other ways to join blocks.
