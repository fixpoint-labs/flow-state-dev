---
title: Testing
type: concept
description: A flow runs in your test process with only the model call replaced by a scripted reply, so a test needs no server, no database and no API key.
---

import Figure from "@site/src/components/Figure";
import WhatIsReal from "./figures/what-is-real-in-a-test.svg";

# Testing

An AI backend is awkward to test when every run needs a server, a database and a model that words its answer differently each time. Flow State's testing package runs a flow, the unit of backend a client calls, inside your test process, on in-memory storage. The one unpredictable part, the model call, is answered by a scripted reply.

A flow is made of blocks: named pieces of work, each with a typed input and output. A test can run one block alone, or a whole action, one of the named calls a flow exposes, from input to output.

The example is the support desk from [Blocks](./blocks.md). `handleTicket` is a sequencer, a block that runs other blocks in order, defined in `src/flows/support/blocks/handle-ticket.ts`. It runs `cleanMessage` to clean a customer's message, then `draftReply` has a model write the answer. Each block lives in its own file beside the flow, as it does on that page.

<Figure svg={WhatIsReal} caption="What is real in a test" description={"The handleTicket sequencer drawn as a large box that runs in the test process on in-memory stores. Inside it, a handler named cleanMessage hands its output to a generator named draftReply, and both run as written. Inside draftReply, highlighted, is a mockGenerator with one scripted reply: it is the only stand-in, and it takes the place of the model call. A note says the block code, the input and output checks, the state writes and the emitted items are real, while the model call is faked and there is no server and no network."} />

## A test with no model

The flow registers `handleTicket` as an action named `reply`:

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { handleTicket } from "./blocks/handle-ticket";

export default defineFlow({
  kind: "support",
  requireUser: true,
  actions: { reply: handleTicket },
})();
```

The test runs that action and gives the model a script:

```ts title="test/support.test.ts"
import { expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import flow from "../src/flows/support/flow";

it("replies to a customer", async () => {
  const result = await testFlow({
    flow,
    action: "reply",
    userId: "test-user",
    input: { message: "  where is my order  " },
    generators: {
      "draft-reply": mockGenerator({
        name: "draft-reply",
        script: [{ text: "Your order shipped." }],
      }),
    },
  });

  expect(result.status).toBe("completed");
  expect(result.output).toBe("Your order shipped.");
});
```

The mock is attached under the block's `name`, `"draft-reply"`, not its variable name. Everything else in the run is the real one: the input is checked, `cleanMessage` trims the message, and the reply comes back as an item, the unit a client receives from a run. A failed run does not throw; it returns `status: "failed"` and an `error`. The [testing reference](/docs/reference/api/testing) lists the options and result fields.

## Standing in for a generator

`mockGenerator` takes the block's name and a script, a list of replies used in order, one per call. A step is `{ text }` for a text reply or `{ structuredOutput }` for a generator that returns an object.

The mock also records what it was sent, so you can assert on the prompt without a model reading it:

```ts title="test/draft-prompt.test.ts"
import { expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import flow from "../src/flows/support/flow";

it("sends the cleaned message to the model", async () => {
  const draft = mockGenerator({ name: "draft-reply", script: [{ text: "Your order shipped." }] });
  await testFlow({
    flow,
    action: "reply",
    userId: "test-user",
    input: { message: "where is my order" },
    generators: { "draft-reply": draft },
  });

  expect(draft.calls[0].input).toContainEqual({ role: "user", content: "where is my order" });
});
```

A generator that names its model by id and has no mock fails the run with an error naming it, so a test cannot reach a provider by accident. A generator handed a model object directly skips the mocks and calls that model, so name models by id in code you test. A mock keeps its place in the script for as long as it exists, so build a new one in each test or call `reset()`. Attaching a mock by model id is in the [reference](/docs/reference/api/testing).

## Testing one block

`testBlock` runs a single block with no flow around it:

```ts title="test/clean-message.test.ts"
import { expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { cleanMessage } from "../src/flows/support/blocks/clean-message";

it("trims the message", async () => {
  const result = await testBlock(cleanMessage, { input: { message: "  hi  " } });

  expect(result.error).toBeNull();
  expect(result.output).toEqual({ text: "hi", truncated: false });
});
```

A failing block does not throw. The failure is on `result.error`, as in the [reference](/docs/reference/api/testing).

## What to assert on

Not the model's wording, because the script fixed it. Assert on what your code decides:

- **The output.** `result.output`, as above.
- **The items.** `result.items` is what a client would have received. `testItems(result.items).messages()` returns the messages; the other filters are in the [reference](/docs/reference/api/testing).
- **The state.** What the run wrote to state it keeps per session, per user or per org.

For state, seed the starting point and read the result. Say a handler counts a customer's tickets in session state:

```ts title="src/flows/support/blocks/count-ticket.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const countTicket = handler({
  name: "count-ticket",
  inputSchema: z.object({ message: z.string() }),
  sessionStateSchema: z.object({ ticketCount: z.number().default(0) }),
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ ticketCount: ctx.session.state.ticketCount + 1 });
  },
});
```

```ts title="test/count-ticket.test.ts"
import { expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { countTicket } from "../src/flows/support/blocks/count-ticket";

it("adds one to the count", async () => {
  const result = await testBlock(countTicket, {
    input: { message: "hi" },
    session: { state: { ticketCount: 5 } },
  });

  expect(result.state.session.ticketCount).toBe(6);
});
```

`testFlow` seeds the same scopes under `seed: { session: { state } }`. It returns no state, so pass your own `stores` and read the session back from them. Here a flow registers `countTicket` as an action named `count`:

```ts title="test/session-state.test.ts"
import { expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testFlow } from "@flow-state-dev/testing";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { countTicket } from "../src/flows/support/blocks/count-ticket";

const flow = defineFlow({
  kind: "support",
  requireUser: true,
  actions: { count: countTicket },
})();

it("adds one to the count", async () => {
  const stores = createInMemoryStores();
  await testFlow({
    flow,
    action: "count",
    userId: "test-user",
    input: { message: "hi" },
    seed: { session: { state: { ticketCount: 5 } } },
    stores,
  });

  const session = await stores.session.get("test-session");
  expect(session?.state).toMatchObject({ ticketCount: 6 });
});
```

`"test-session"` is the session id `testFlow` uses unless you pass `sessionId`. Pass the same `stores` to two `testFlow` calls and the second sees what the first wrote, so one test can cover two turns of a conversation. Give the mock one script step per turn.

## Checking the model's work: evals

A test checks that your code does what you wrote, against a scripted model. It cannot tell you whether the replies are any good, because the replies are scripted. An eval can: `evalBlock` scores a block's output across many cases, and calls a real model only when you hand it a `modelResolver`. Without one, a case that reaches a generator fails like any unmocked test. Datasets, scorers and the report are in the [reference](/docs/reference/api/testing).

## What it gets you

- **Fast runs with no key.** `handleTicket` runs in milliseconds, with no API key.
- **The same answer every time.** The mock returns the scripted step.
- **No accidental provider calls.** An unmocked generator fails the test and names the block.
- **The real run around the stand-in.** Input checks, block order, state writes and items are the same as in a real run.
- **Isolated tests.** Each call gets fresh in-memory stores unless you share `stores`.

## How it fits with the others

The stores are in memory, so what a persistent store does across a crash is not tested here. An eval scores one block or flow. A benchmark compares patterns, ways of splitting work across several blocks, against each other.

## Next

- [Blocks](./blocks.md) covers the kinds of block this page tests.
- [Flows and actions](./flows-and-actions.md) shows how an action becomes something to call.
- [Benchmarks](../build/benchmark-patterns.md) compares patterns on a fixed set of tasks.
- [`@flow-state-dev/testing` reference](/docs/reference/api/testing) lists every harness option, scorer and result field.
