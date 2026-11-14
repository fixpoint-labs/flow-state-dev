---
title: Models
type: concept
description: A model is a string. You can name a purpose instead of a model, and list a second choice for when the first fails.
---

import Figure from "@site/src/components/Figure";
import FromABlockToAProvider from "./figures/from-a-block-to-a-provider.svg";

# Models

A generator is the block that calls a model, and the model is a string such as `openai/gpt-6-luna`: a provider, a slash, a model id. Models get renamed, replaced and rate-limited far more often than your code changes. A string written into every block turns each of those into a search.

So a block can name the job instead, and the app says in one place which models do that job, in order of preference. A request goes to the first model that works and moves to the next when it fails. Provider keys stay in the environment, out of your blocks.

The example on this page is a support desk. `classify` reads a ticket and wants a small, fast model. `reply` writes the answer and wants a better one.

<Figure svg={FromABlockToAProvider} caption="From a block to a provider" description={"On the left, a box for the generator classify, with the line model: intent/utility. An arrow labelled resolves to runs to the middle box, the app's mapping, models.intents, where the row utility is highlighted as the one place to change. Below it, two model strings are listed in order: anthropic/claude-haiku-5-5 and openai/gpt-6-luna. A solid arrow runs from the first string to the provider anthropic, which reads ANTHROPIC_API_KEY. A dashed arrow, used only if the first fails, runs from the second string to the provider openai, which reads OPENAI_API_KEY."} />

## A model string

```ts title="src/flows/support/blocks/classify.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const classify = generator({
  name: "classify",
  model: "openai/gpt-6-luna",
  prompt: "Label the ticket as billing, shipping or other.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});
```

Look at `model`. The part before the slash picks the provider, and the rest goes to it as written. With a key for that provider in the environment, such as `OPENAI_API_KEY`, the generator runs. A model string written out in full needs no `models` setting on `createFlowState`, only the key and the provider's package, such as `@ai-sdk/openai`. [Environment](../reference/environment.md) lists every key.

## Naming the job, not the model

Change `classify` to `model: "intent/utility"`. An intent is a name for a purpose, written `intent/` and a name you choose. The app maps each intent to an ordered list of model strings, in the `models` option of `createFlowState`. `supportFlow` is the support desk's flow, defined in `src/flows/support/flow.ts` beside its blocks:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import supportFlow from "./src/flows/support/flow";

export default createFlowState({
  flows: [supportFlow],
  models: {
    default: "openai/gpt-6-luna",
    intents: {
      utility: ["anthropic/claude-haiku-5-5", "openai/gpt-6-luna"],
      chat: ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol"],
    },
  },
});
```

Look at `intents`. `utility` is for classifying, extracting and other small jobs, and `chat` is for the answers a user reads. Nothing built in sits behind those names. Each list is yours, and moving the cheap model is an edit to `utility`, with no block touched.

`default` is one model string, required once any intent exists. It answers when a generator names an intent no one configured, and when no model in an intent's list has a key.

## When a model fails

An intent's list is the fallback. When the first model fails the call, for a rate limit or an outage, the next one answers, and the caller gets that answer, not the first error. If every model fails, the call throws. The [Models reference](../reference/models.md) says what the error holds.

A list does not need an intent. A generator can carry it directly, as `model: ["openai/gpt-6.1-sol", "anthropic/claude-sonnet-5-5"]`. An intent's list passes over a model whose provider has no key. A list written on the generator needs a key for every model in it. The [Models reference](../reference/models.md) covers the error a missing key raises and when.

## Letting the user choose

The model can depend on who is asking. A generator's `model` can be a function of its input and context, and `selectModel` is the tidy way to write one. Here `reply` keeps its purpose, `intent/chat`, and lets each user's preferred provider come first:

```ts title="src/flows/support/blocks/reply.ts"
import { generator, selectModel } from "@flow-state-dev/core";
import { z } from "zod";

export const reply = generator({
  name: "reply",
  model: selectModel("intent/chat", [
    { preferProvider: (_input, ctx) => ctx.user?.state.preferredProvider },
  ]),
  userStateSchema: z.object({ preferredProvider: z.string().optional() }),
  prompt: "Write a reply to the ticket.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});
```

The choice lives in user state, so it lasts across that user's sessions. An action your app defines writes it, and the next generation uses it. A preference for a provider you have no key for is skipped.

## What it gets you

- **One edit, every block.** Change `utility`, and `classify` and every other block that names `intent/utility` use the new model.
- **A key and a package are all a new machine needs.** With only `ANTHROPIC_API_KEY` set, `utility` runs the Anthropic model. With only `OPENAI_API_KEY`, the OpenAI one. Each provider's package has to be installed.
- **A failed call does not fail the request.** The next model in the list answers.
- **You can see which model answered.** Each item a generator produces records the model that ran, and the intent that chose it, if one did.

## How it fits with the others

Of the blocks that take a model string, generators take everything above, and evaluators take one string: no intents, no list. The coding-harness blocks (Codex, Cursor, Claude Code) take a model id for their own SDK instead. Nothing here is stored except a user's choice, in user state.

## Next

- [Models reference](../reference/models.md) has the string forms, gateways, retry settings, the fields that record which model answered, where a model can be set, prompt caching, reasoning settings and custom resolvers.
- [Environment reference](../reference/environment.md) lists every provider key and `FSDEV_*` variable.
- [Generators and tools](./generators-and-tools.md) covers the block that calls the model.
- [Persistence](./persistence.md) covers where user state is kept.
