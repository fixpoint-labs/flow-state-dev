---
title: Utility blocks
type: reference
description: "The ready-made blocks in core's utility namespace: what each does, its options, its input and its output, plus the failure messages and trace shapes of the routers."
---

# Utility blocks

Some jobs come up in nearly every AI app: summarize this, sort this message into a category, merge these results, title this conversation. Each takes a model prompt, an output schema and a few lines of wiring, and writing them again in every flow leaves you with a dozen slightly different copies. Utility blocks are those jobs written once, as factories that return an ordinary block. You call the factory, give the block a name, and place it in a sequencer, router or flow like any block you wrote yourself.

Most call a model with a fixed prompt, so you set options such as the model and the shape of the output, and never write the prompt. A few call no model at all.

This page uses one app, a support desk. Its `support` flow sorts each ticket, a `{ message }`, with `routeTicket` and hands it to a reply block. Every utility is `utility.<factory>`, imported from the root of core. There is no `@flow-state-dev/core/utility` subpath.

```ts title="src/flows/support/blocks/route-ticket.ts"
import { utility } from "@flow-state-dev/core";
import { billingReply } from "./billing-reply";
import { technicalReply } from "./technical-reply";
import { humanReview } from "./human-review";

export const routeTicket = utility.intentRouter({
  name: "route-ticket",
  categories: {
    billing: { description: "Charges, invoices, refunds", handler: billingReply },
    technical: { description: "Errors, outages, how-to questions", handler: technicalReply },
  },
  confidenceThreshold: 0.7,
  fallback: humanReview,
});
```

The three handlers are ordinary blocks, each in its own file beside this one. Minimal versions, to make the example run:

```ts title="src/flows/support/blocks/billing-reply.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { draftReplyFor } from "../../../lib/replies";

export const billingReply = handler({
  name: "billing-reply",
  inputSchema: z.object({ message: z.string() }),
  execute: async (input) => ({ reply: await draftReplyFor(input.message) }),
});
```

```ts title="src/flows/support/blocks/technical-reply.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { draftReplyFor } from "../../../lib/replies";

export const technicalReply = handler({
  name: "technical-reply",
  inputSchema: z.object({ message: z.string() }),
  execute: async (input) => ({ reply: await draftReplyFor(input.message) }),
});
```

```ts title="src/flows/support/blocks/human-review.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { queueForHuman } from "../../../lib/queue";

export const humanReview = handler({
  name: "human-review",
  inputSchema: z.object({ message: z.string() }),
  execute: async (input) => {
    await queueForHuman(input);
    return { reply: "A person on our team will reply shortly." };
  },
});
```

## Find a block

| You want to | Use |
| --- | --- |
| Merge a list of artifacts without a model | `combiner` |
| Reshape any other value without a handler | `.map()` on a sequencer. No utility does it |
| Run one of several blocks chosen by a string you compute | `keyedRouter` |
| Run one of several blocks chosen by what a model says | `intentRouter`, or `cascadingRouter` for several questions or a confidence floor |
| Create or update an instance in a resource collection | `upsertResource` |
| Name a session from what was said in it | `sessionTitleGenerator` |

## All blocks

`Returns` is the kind of block the factory builds. Every factory takes a `name: string`. It is required except on `historySummary` and `consultSessionHistoryTool`, where it is optional.

| Factory | Returns | Calls a model | Default model |
| --- | --- | --- | --- |
| `contextReducer`, `memoryExtractor`, `summarizer`, `analyzer`, `intentClassifier` | generator | yes | `intent/utility` |
| `decomposer` | generator | yes | `openai/gpt-6-luna` |
| `combiner`, `upsertResource` | handler | no | none |
| `keyedRouter` | router | no | none |

| Factory | Returns | Calls a model | Default model |
| --- | --- | --- | --- |
| `intentRouter`, `consultSessionHistoryTool` | sequencer | yes | `intent/utility` |
| `cascadingRouter` | sequencer | the evaluators you pass | none, each evaluator carries its own |
| `sessionTitleGenerator` | sequencer | yes | `openai/gpt-6-luna` |
| `historySummary` | not a block: `{ capability, fold, resource }` | through the `summarize` block you pass | none |

`intent/utility` is an intent name your app maps to a real model. See [Models](../concepts/models.md).

## Generator utilities

These six build generators. Input is any value: a string goes to the model as it is, anything else as 2-space-indented JSON, and none declares an `inputSchema`. All six take `model`, `outputSchema` and `itemVisibility`, and none takes `prompt`.

- **`outputSchema`** replaces the default output schema, and the block's output type follows it.
- **`itemVisibility`** is `{ client: boolean; history: boolean }`. What each setting does is on [Items and the stream](./items.md).

The table lists the options each takes beyond those three.

| Block | What it does | Other options | Output |
| --- | --- | --- | --- |
| `contextReducer` | Shrinks text in one of three modes | `mode`: `"distill"` (default), `"denoise"`, `"compress"` | By mode, next table |
| `memoryExtractor` | Proposes durable facts from a conversation. It stores nothing | none | `{ memories: { type, content, confidence?, source? }[] }` |
| `decomposer` | Splits a broad request into tasks an agent can finish unaided | `context`, `history` | `{ tasks: { id, title, goal, context, deps?, priority? }[] }` |
| `summarizer` | Summarizes at a chosen length | `granularity`: `"brief"` (default), `"detailed"`, `"executive"`; `objectives`: string or string list | `{ summary, keyPoints? }` |
| `analyzer` | Assesses the input against criteria | `criteria`: string list, default `["quality", "risk", "coverage", "confidence"]` | `{ findings: { criterion, assessment, severity?, evidence? }[], score?, recommendation? }` |
| `intentClassifier` | Picks one label for the input | `categories`: label to description, required, at least 2 | `{ category, confidence, reasoning }` |

`memoryExtractor` `type` is `"fact"`, `"preference"`, `"constraint"` or `"decision"`, and `confidence` runs 0 to 1. It returns an empty `memories` array when nothing durable is found. Storing the candidates is a block you write.

`decomposer` turns on the provider's web search, the only utility that does. `title` and `context` are strings or `null` and are always present. `deps` and `priority` (`"high"`, `"medium"`, `"low"`) are optional. `context` carries concrete values the task needs, because the block that works the task sees only its own task. The model is asked to avoid tasks that wait on a human and to order tasks so dependencies come first. The output is not checked for either. `history` lets it resolve references to earlier turns.

`analyzer` `severity` is `"critical"`, `"warning"` or `"info"`. The schema enforces no range on `score`.

`summarizer` fits `historySummary`'s `summarize` slot as it is.

`intentClassifier` throws at construction with fewer than two categories: `intentClassifier requires at least 2 categories in the "categories" map`. A `category` that is not one of the labels fails output validation with `Category must be one of: <labels>`. A custom `outputSchema` gets the same check and must produce an object with a string `category`, or it fails with `Output must include a category field`. `confidence` runs 0 to 1, and `reasoning` defaults to an empty string.

### `contextReducer` modes

| Mode | Asks the model for | Output |
| --- | --- | --- |
| `distill` | Decisions, constraints and implications, not wording | `{ distilled: string, keyPoints: string[] }` |
| `denoise` | The text without irrelevant or repeated content, in the original order | `{ cleaned: string, removedCategories?: string[] }` |
| `compress` | The text cut to a length the model judges fits, keeping facts, identifiers and constraints | `{ compressed: string, compressionRatio?: number, dropped?: string[] }` |

`compress` has no budget option. The model decides how far to cut.

## `combiner`

Deterministic merge, no model. Same input, same output. Options: `name`, `outputSchema`.

Input is an array of artifacts or `{ artifacts: unknown[] }`. Output is `{ combined: unknown, mergeNotes?: string[] }`.

| Input | `combined` |
| --- | --- |
| `[]` | `[]`, with a note that no artifacts were provided |
| Every artifact an array | The arrays concatenated, then deduplicated |
| Every artifact a plain object | Merged key by key in order. A key in both merges recursively, two arrays under one key concatenate and deduplicate, two different scalars keep the later one |
| Anything else | The artifacts in order, exact duplicates removed, with a note that types were mixed |

Deduplication compares values with object keys sorted, so key order does not matter. `mergeNotes` is always present for empty and mixed input. For arrays and objects it appears only when a note was written: `<path>: deduplicated array entries during merge.` when something was removed, and `<path>: conflicting values resolved by taking the later artifact.` when two scalars differed. `<path>` is `combined` or `combined.<key>.<key>`.

## `upsertResource`

Writes one instance of a resource collection and returns nothing. It calls no model.

How the state is written, and where the instance lives, are on [Resources and collections](./resources.md).

| Option | Meaning |
| --- | --- |
| `name` | Block name |
| `inputSchema` | Zod schema of the input |
| `collectionKey` | Key of the target collection on `ctx.resources` |
| `key` | `(input) => string`, the instance key |
| `state` | `(input, ctx) => Record<string, unknown>`, the state to create or patch with |

| Optional | Meaning |
| --- | --- |
| `description` | Block description |
| `content` | `(input) => string \| undefined`, text written after the state. `undefined` writes nothing |
| `resources` | Resource declarations the block registers, so the block installs its own collection |
| `sequencerStateSchema` | The outer sequencer's state schema, when the block reads or writes sequencer state |

What `.tap(block)` and `.step(block)` pass on after a block that returns nothing is on [Sequencer methods](./sequencer-methods.md).

## `keyedRouter`

Runs `blocks[select(input, ctx)]`. It calls no model and does not adapt the input: the chosen block receives the router's input as it is. To hand a block a different shape, call `block.connectInput(...)` on it before you put it in `blocks`. More on what each branch receives is on [Sequencer methods](./sequencer-methods.md).

| Option | Meaning |
| --- | --- |
| `name` | Router name |
| `blocks` | `Record<string, Block>`. Two keys may name the same block |
| `select` | `(input, ctx) => string` |
| `fallback` | Block to run for an unregistered key |
| `inputSchema`, `outputSchema` | Optional |

An unregistered key runs `fallback`. With no `fallback`, it throws when the request runs: `[keyedRouter] no block registered under key "<key>" in router "<name>". Available: <keys>`, with the registered keys comma-separated.

Only own properties of `blocks` count. If `select` returns `"toString"` (or `"constructor"`, `"valueOf"`, `"__proto__"`), that key is unregistered like any other: the fallback runs, or the error above names `"toString"`.

An error thrown by `select` propagates unwrapped, with its own message.

## `intentRouter`

A sequencer that classifies the input, then runs the block for the category. Input is any value. Output is whatever the chosen block returns. Takes no `outputSchema` or `itemVisibility`.

| Option | Meaning |
| --- | --- |
| `name` | Router name |
| `categories` | `Record<string, { description: string, handler: Block }>`, at least 2 |
| `fallback` | Block for a low-confidence or unknown category |
| `confidenceThreshold` | Minimum classifier confidence |
| `model` | Passed to the classifier. Default `intent/utility` |

Routing runs in this order:

1. With `confidenceThreshold` set and the confidence below it, run `fallback`. With no `fallback`, throw `intentRouter "<name>" classified "<category>" with confidence <c>, below threshold <t>, and no fallback handler was provided`.
2. Otherwise run the handler for the category.
3. A category with no handler runs `fallback`, or throws `intentRouter "<name>" produced unknown category "<category>" and no fallback handler was provided`.

The comparison is strict: a confidence equal to the threshold passes. Without a threshold the top category always wins, at any confidence.

The routing errors are raised when a request runs, not when you call `intentRouter(...)`. Say `routeTicket` had no `fallback`, and a ticket is classified `billing` at 0.62. The request fails with `intentRouter "route-ticket" classified "billing" with confidence 0.62, below threshold 0.7, and no fallback handler was provided`. Fewer than two categories is the one construction error: `intentRouter requires at least 2 categories in the "categories" map`.

The chosen handler, or the fallback, receives the router's original input, not the classification. A handler's own `connectInput` applies to that original input. To see the classification itself, use `intentClassifier`.

## `cascadingRouter`

Walks a tree of evaluator questions and sends anything the model is not confident about to one `ambiguous` block. Options: `name`, `ambiguous` (required block), `root` (a level). The router has no `model`. Each evaluator named in `ask` carries its own.

| Type | Shape |
| --- | --- |
| `CascadeLevel` | `{ ask: evaluator block, on: string, branches: Record<optionKey, CascadeBranch> }` |
| `CascadeBranch` | `{ minConfidence?: number, block: Block }` or `{ minConfidence?: number, next: CascadeLevel }` |

The router's input is what the root evaluator accepts. The router returns what the chosen block returns, so every leaf and `ambiguous` should return one type.

Checked when you compile: `ask` accepts the router's input, `on` names a choice question of `ask`, each branch key is one of that question's options, and each leaf accepts the router's input.

### How a level decides

| The model | Result | Reason |
| --- | --- | --- |
| Chose an option with a branch, reported a confidence at or above that branch's `minConfidence` (or the branch has none) | The branch opens | none |
| Reported a confidence below `minConfidence` | `ambiguous` | `below-floor` |
| Reported no usable confidence | `ambiguous`, with or without a `minConfidence` | `no-confidence` |
| Chose an option with no branch, gave no answer to the routed question, or the answer is not a choice | `ambiguous` | `no-branch` |

A usable confidence is a finite number from 0 to 1. A floor is inclusive. A branch with no `minConfidence` opens on any reported confidence. There is no default floor and none for the whole tree. A choice's `probabilities` and a boolean's `probability` are never read as confidence. The branch check runs before the confidence check, so an option with no branch is `no-branch` even when no confidence came back.

How it fails on a provider error, a refusal or a cancel is on [Errors](./errors.md).

### Refused at build time

`cascadingRouter(...)` throws when called. Each message begins `cascadingRouter "<name>": `. `<path>` is `root`, then `root/<optionKey>` for each nested level.

| Cause | Message ends |
| --- | --- |
| No `ambiguous` | `ambiguous is required: the block every edge that doesn't open runs.` |
| A level's `ask` is not an evaluator | `the level at "<path>" must ask an evaluator block.` |
| `on` is not a question the evaluator asks | `routes on "<on>", which evaluator "<name>" doesn't ask.` |
| `on` is not a choice | `routes on "<on>", which is a <type> question, not a choice.` |
| A branch key is not an option of `on` | `branch "<path>/<key>": "<key>" is not an option of "<on>".` |

| Cause | Message ends |
| --- | --- |
| A branch has both `block` and `next`, or neither | `branch "<path>" needs exactly one of block or next.` |
| `block` is not a block | `branch "<path>": block is not a block.` |
| `minConfidence` outside 0 to 1, NaN or not a number | `branch "<path>": minConfidence must be between 0 and 1 (got <value>).` |
| A level contains itself | `the level at "<path>" is already inside itself; a tree can't loop.` |

Where an evaluator's `questions` is a function of the input, the option and question checks happen at the type level only.

### In the trace

Each level appears as a sequencer named `<name>/<path>`. Each level has three steps: the evaluator, a handler named `<name>/<path>/gate` that records the level's decision, and a router named `<name>/<path>/route`. The gate's recorded output is `{ input, verdict }`. A level on a branch that was not taken never runs and has no rows.

| Outcome | `verdict` |
| --- | --- |
| An edge opened | `{ level, on, edge, confidence }` |
| `ambiguous` | `{ level, on, ambiguous, choice? }`, where `ambiguous` is the reason from the table above and `choice` is present only when the answer was a choice with a string value |

For example, `{ level: "root", on: "team", ambiguous: "no-confidence", choice: "billing" }`. The evaluator's own row records its answer and any confidence. A leaf that suspends resumes on the same route without asking the evaluators again.

## Conversation utilities

| Block | What it does | Options | Output |
| --- | --- | --- | --- |
| `sessionTitleGenerator` | Writes a session title from recent turns | `model` (a model id string, default `openai/gpt-6-luna`), `messageLimit` (turns, default 4) | `{ title }` |
| `consultSessionHistoryTool` | Answers a question from another of the user's sessions | `name`, `model`, `budgetTokens`, `description`, `target` | A reading or a refusal |
| `historySummary` | Keeps a running summary of turns that left the history window | `summarize`, `name` | `{ capability, fold, resource }` |

### `sessionTitleGenerator`

A sequencer. Wire it into your chat sequencer with `.sideChain(block)`, so it runs after the answer and the reply is not delayed. Input is any value. Takes no `outputSchema` or `itemVisibility`.

`messageLimit` counts conversational turns, not messages. One turn is a user request and its answer, tool calls included, so the default of 4 reads the last four exchanges. The model is asked for 3 to 8 words, in sentence case.

The title is trimmed, then written with `ctx.session.setMetadata({ title })`, but only when it is non-empty and differs from the current title. Otherwise nothing is written. A write sends a `session.metadata.changed` event, and `useSession` in `@flow-state-dev/react` updates the session's `title` live.

### `consultSessionHistoryTool`

Returns a tool for a generator's `tools`, a sequencer named by `name` (default `consultSessionHistory`).

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | `consultSessionHistory` | The tool name the model calls |
| `model` | `intent/utility` | Model that writes the answer |
| `budgetTokens` | 24,000 | Hard cap on history tokens read |
| `description` | Built in | What the model reads about the tool |
| `target` | By session id | `{ inputSchema, resolve(input, ctx) }` for a wrapper that names the session its own way. `inputSchema` must carry `question`. `resolve` returns `{ ok: true, sessionId, of }` or `{ ok: false, error }` |

Default input is `{ sessionId: string, question: string }`, strict, `question` 1 to 2,000 characters. Exported as `utility.consultSessionHistoryInputSchema`. Output is one of:

| Output | Shape |
| --- | --- |
| A reading | `{ reading, of, asOf, turnsRead, earlierTurnsLeftOut, cut, running }` |
| A refusal | `{ ok: false, error }` |

`asOf` is `{ requestId, at }` for the newest settled turn read, or `null`. `earlierTurnsLeftOut` is true when older turns were not read. `cut` is true when turns were dropped or the newest trimmed to fit `budgetTokens`. `running` is true when a turn is in progress there. A running, suspended or waiting turn is never in the reading. The reading is capped at 8,000 characters.

Refusals, none of which runs a model:

| `error` | When |
| --- | --- |
| `self: that is this conversation, and its history is already yours.` | The id is the asking session |
| `no_session: no conversation "<id>" of yours.` | The session does not exist or belongs to another user, org or tenant. The cases read alike. The host adds `(This host can't read another conversation.)` when it cannot read session history |
| What `target.resolve` returned | `resolve` returned `{ ok: false, error }` |

A session with no finished turns returns a reading of `That conversation has no finished turns to read yet.` with `turnsRead: 0`, and no model runs. Turns are read newest first until the budget is full. The answering generator's items stay out of the asking session's history and client view. The tool reads only the calling user's sessions and writes to, runs and wakes nothing.

### `historySummary`

Not a block. `utility.historySummary({ summarize, name? })` returns three parts.

| Part | Use |
| --- | --- |
| `capability` | Goes in the answering generator's `uses`. Presets `context` (adds the summary in an `<earlier-conversation>` section) and `history` (reads history from after the last summarized turn) are both on by default. `capability.presets({ history: false })` keeps the summary and reads the whole window |
| `fold` | A step to run before the answering generator, as `.tap(earlier.fold)`. A turn that reaches the oldest quarter of the history window is folded, up to a quarter of the window's turns at a time. An unsettled turn is folded once it settles |
| `resource` | The session-scoped resource that holds the summary |

`summarize` is a block taking `{ summary: string | null, turns: LLMMessage[] }` and returning `{ summary: string, keyPoints? }`. `name` is the resource's accessor name and storage key, default `historySummary`.

If `summarize` throws, the fold step catches it, logs a warning and keeps the previous summary, and the next turn tries again. Turns that leave the history window in the meantime mark the summary `complete: false`. If turns have left the window and no fold has run, the `context` preset throws `historySummary "<name>": turns have left the history window and no fold has run`. The stored summary is capped at 8,000 characters, key points under a `Key points:` header.

## What is stored

Only `upsertResource`, `sessionTitleGenerator` and `historySummary` keep anything. The rest return values and write nothing.

| Part | Owner | Visible to | Stored | How many |
| --- | --- | --- | --- | --- |
| `upsertResource`'s instance | The collection you declare | What that collection's `client` config exposes | Where the collection's scope and store put it | One per `key(input)` value |
| `sessionTitleGenerator`'s title | The session, as metadata `title` | Clients reading the session (`useSession`, `session?.title`) | The session's metadata | One per session, replaced by later runs |

`historySummary`'s resource is session-scoped and holds the summary. Clients see only `throughRequestId` (the last turn summarized), `complete` and `folds` (how many folds have run), never the summary's text.

## Next

- [Blocks](../concepts/blocks.md) for the five block kinds these factories return.
- [Route with an evaluator](../build/route-with-an-evaluator.md) for `cascadingRouter` built step by step.
- [Models](../concepts/models.md) for mapping `intent/utility` to a model.
- [Patterns](./patterns.md) for larger compositions built from blocks like these.
