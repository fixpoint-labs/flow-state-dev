---
title: Generators
type: reference
description: "Every generator option and default, the forms the context slot takes, the order the model's input is assembled in, what ends a tool loop, how failed tool calls and output schemas behave, and what a generator records per call."
---

# Generators

A generator is the block that calls a model. You give it a prompt, the material the model should see this turn, and optionally tools it may call and a schema its answer must match. It assembles the model's input, runs the loop of model calls and tool calls, checks the answer, and returns text or a parsed object.

The examples use the `support` flow. `supportAgent` answers questions about an order and may call `lookUpOrder` and `issueRefund`, two handler blocks that each live in their own file under `tools/`.

```ts title="src/flows/support/tools/look-up-order.ts"
import { z } from "zod";
import { handler } from "@flow-state-dev/core";

export const lookUpOrder = handler({
  name: "look-up-order",
  description: "Look up where an order is. Use it when the customer gives an order id.",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.string(),
  execute: async (input) => `Order ${input.orderId} shipped Tuesday.`,
});
```

```ts title="src/flows/support/tools/issue-refund.ts"
import { z } from "zod";
import { handler } from "@flow-state-dev/core";

export const issueRefund = handler({
  name: "issue-refund",
  description: "Refund an order. Use it when the customer asks for money back.",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ reply: z.string(), refundCents: z.number() }),
  execute: async (input) => ({
    reply: `Refund issued for order ${input.orderId}.`,
    refundCents: 1200,
  }),
});
```

```ts title="src/flows/support/blocks/support-agent.ts"
import { z } from "zod";
import { generator } from "@flow-state-dev/core";
import { lookUpOrder } from "../tools/look-up-order";
import { issueRefund } from "../tools/issue-refund";

export const supportAgent = generator({
  name: "support-agent",
  model: "openai/gpt-6-luna",
  inputSchema: z.object({ message: z.string() }),
  prompt: "You answer order questions for Acme Support.",
  context: { customerPlan: "pro" },
  history: true,
  user: (input) => input.message,
  tools: [lookUpOrder, issueRefund],
  loop: { maxIterations: 6, answerOnLastStep: true },
  itemVisibility: { client: true, history: true },
});
```

`generator` and every other name on this page come from `@flow-state-dev/core`, except the text formatters listed under [Helpers](#helpers), which come from `@flow-state-dev/core/prompt`. The shared block fields, such as `inputSchema` and `onErrored`, are on [Blocks](./blocks.md). Tools are described on [Tools](./tools.md), and the concept behind generators is on [Generators and tools](../concepts/generators-and-tools.md).

## Options

Required: `name` and `prompt`. `model` is required unless a capability in `uses` supplies one. With neither, `generator()` throws `Generator "<name>" requires a model.` A block-level `model` wins over a capability's.

| Option | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | required | Block id. Also the default `agentName` when `itemVisibility` is set. |
| `model` | A model id, an array of ids, a model instance, or `(input, ctx) => ` any of those | required unless a capability supplies one | What to call. An array is a fallback group: each model gets two attempts, with a delay of 1,000 ms growing to 10,000 ms, before the next is tried. An empty array throws. A function runs once per run, with the block's input. |
| `prompt` | A string, `(input, ctx) => string \| null \| undefined`, an array of those, or a prompt file | required | The system prose. In an array, entries resolve in order, `null` and `undefined` are skipped, and the rest are joined with a newline. A whole prompt file supplies `name`, `description`, `user`, `caching`, `maxTokens` and `temperature`; a sibling field set on the config wins. |
| `context` | A string, a context object, a message, a function, or an array of those | none | Material added to the model's input each turn. See [The `context` slot](#the-context-slot). |
| `history` | `true`, an `ItemQuery`, or a slot (function or static messages) | none: no history is read | Earlier turns of the session. See [`history` and `user`](#history-and-user). |
| `user` | A string, `(input, ctx) => unknown`, a context object, or an array of those | none | This turn's user message. |
| `tools` | `GeneratorTool[]` or `(input, ctx) => GeneratorTool[]` | none | Blocks the model may call. See [Tools a generator is given](#tools-a-generator-is-given). |
| `uses` | A capability list. Entries may be `(ctx) => CapabilityRef[]` | none | Installs capabilities: their resources, state, context, tools, `model`, `providerOptions`, `caching` and `history` narrowing. |
| `itemVisibility` | `{ client: boolean; history: boolean }` | unset | Visibility for the `message`, `reasoning` and `tool_output` items the generator emits. `source` and `tool_call_progress` items are always `{ client: true, history: false }`, whatever is set here. Unset, the generator emits no conversational items: the model runs and the answer is returned. |
| `agentName` | `string` | the block `name` when `itemVisibility` is set, else none | Name stamped on emitted items. Generators that share one share a conversation; distinct names stay separate. |
| `search` | `true` or a `GeneratorSearchConfig` | off | Provider web search. See [`search`](#search). |
| `providerTools` | `ProviderTool[]`, built with `providerTool(name, tool)` | none | Provider-defined tools passed to the model unchanged. The provider runs them. They have no input check, no `tool_output` item and no retry. |
| `loop` | `{ maxIterations?, runTools?, answerOnLastStep? }` | none | The tool-loop policy. See [What ends a tool loop](#what-ends-a-tool-loop). |
| `maxIterations` | `number` | 8 | The same cap as `loop.maxIterations`, which wins when both are set. Minimum 1. |
| `maxTokens` | `number` | the model's own limit | Passed to every model call. |
| `repair` | `{ mode?, maxAttempts?, coerce? }` | `{ mode: "auto", maxAttempts: 1 }` with coercion on | Structured-output repair. See [Output schemas](#output-schemas). |
| `repairOutput` | `(candidate, error, state, ctx) => unknown` | built-in pass | Replaces the deterministic repair pass. What it returns is validated again. |
| `flowTools` | `ToolsConfig` | the flow's `tools` | Tool defaults and observers for this generator. `defineFlow({ tools })` merges into it: `defaults` merge field by field with the generator's value winning, and each observer is the generator's if set, else the flow's. |
| `retry` | `RetryPolicy` | none | Retries the whole run, covering assembly, loop, tools and repair, not one model call. `{ maxAttempts = 1, baseDelayMs = 0, maxDelayMs = 5000, retryableErrors }`, the delay doubling each attempt. A `FlowError` with `retryable: false` is not retried, so an `OutputValidationError` never is, and a suspension never is. |
| `providerOptions` | An object, or `(input, ctx) => object \| undefined` | none | Passed to the provider call, resolved once per run. A capability's value fills it when the block sets none. |
| `caching` | `{ enabled?, breakpoints?, ttl? }`, or a function returning one | `{ enabled: true, breakpoints: "auto", ttl: "5m" }` | Prompt caching. `breakpoints` is `"auto"` or `"manual"`; `ttl` is `"5m"` or `"1h"`. In `auto`, providers that need a marker get one at the end of a long enough system prefix. OpenAI, Google and DeepSeek cache without one. `{ enabled: false }` turns it off. |
| `describeTools` | `boolean` | `true` | Adds a `<tools>` list to the model's input: one `- name: description` line per tool that has a description. |
| `onCompleted` | `(output, ctx, meta: { model: ModelIdentity }) => void` | none | Runs after success. `meta.model` is the model that produced the output. A two-argument callback also works. |
| `stateSchema` and the scope schemas, `resources`, `connectInput` | as on a handler | none | A generator's `stateSchema` is its own request-scoped state, read in its callbacks as `ctx.self`, so it can accumulate across the tool loop. |

A generator with no `outputSchema` returns a `string`. With one, it returns the parsed value.

## The `context` slot

`context` takes one entry or an array. An entry is a string, a context object, a pre-built message, or a function `(input, ctx) => unknown` whose return value is treated as an entry. Top-level functions run once per run, and again before each later step of the tool loop when the generator has any function-valued `prompt`, `context` or `tools`.

| Form | Written as | What the model receives | Escaped |
|---|---|---|---|
| String | `context: "Plan: pro"` | One extra `system` message after the prompt's | No |
| Function returning a string | `context: (input, ctx) => "..."` | The same: its own `system` message | No |
| Pre-built message | `{ role: "system" \| "user" \| "assistant" \| "tool", content }` | Passed through unchanged, in author order. `role` must be one of those four and `content` must be present | No |
| Object of sections | `context: { documents: [a, b], userPrefs: "x" }` | One XML block per key, appended to the prompt message after a blank line | String leaves |
| Array | `["bare", { documents: "d" }, fn]` | Each element handled by its own row. Arrays flatten; `null`, `undefined` and empty strings are skipped | Per element |
| Capability contribution | A preset's `context` | Appended after the generator's own entries: static capability entries first, then entries from dynamic `uses`. Contributions to the same key join one tag | Per form |

### Object form

| Rule | Behaviour |
|---|---|
| Tag names | `camelCase`, `snake_case` and `kebab-case` keys normalize to `kebab-case` before aggregation, so `userPreferences` and `user_preferences` are one tag. |
| Valid names | After normalization a name must match `/^[a-z][a-z0-9-]*$/`. Anything else throws when rendered: `Invalid context tag name "1st"`. |
| Reserved names | `active-skill`, `thinking`, `answer`, `tool-use`, `tool-result`, `function-calls`, `invoke`, `parameter`, `system`, `user`, `assistant`, `role`, `message` throw: `Reserved context tag name "thinking"`. Checked after normalization, so `tool_use` is refused too. |
| A `role` key | An object with a `role` key that is not a valid message throws, naming the value. Rename the key to use it as a tag. |
| Value types | `string`: leaf text. `string[]`: one line each under the tag. Nested object: nested tags. Function: called with `(input, ctx)` and its result follows these rules. `null` or `undefined`: a placeholder. Other values go through `String(value)`. For JSON inside a tag, serialize it yourself. |
| Aggregation | Contributions to one key, from the generator and from capabilities, collect in author order inside one tag. |
| Placeholders | A `null` value reserves its position among the top-level keys. A tag nobody fills is left out of the output. |
| Type mismatch | A string and a nested object on the same key throw, in either order: `Context key "a" type mismatch`. |
| Escaping | In string leaves `&`, `<` and `>` become `&amp;`, `&lt;` and `&gt;`. Strings in the array form, and prompt text, are not escaped. |
| Rendering | Two-space indent per level. One `<tag>` block per top-level key, in first-seen order. |

### Helpers

`contextFn(schemas, fn)` returns a function that fits the slot. `fn` receives `{ session }`, `{ session, user }` or `{ session, user, org }`, plus the block context, and returns a string. The schemas argument only carries types: it is never run, so a Zod `.default()` is not applied and `session.x` can be `undefined`. As an array entry it becomes its own `system` message. As an object value it is wrapped in a tag and aggregates with other contributions to that key.

Text formatters from `@flow-state-dev/core/prompt` return strings, and drop falsy parts.

| Helper | Returns |
|---|---|
| `section(title \| { title, level }, ...content)` | `## title` (level 2 by default, clamped 1 to 6), then the non-falsy content lines |
| `list(items, { ordered?, bullet? })` | `- item` lines, or `1. item`. An empty string for no items |
| `keyValues(record)` | `key: value` per line. `null` and `undefined` values are skipped |
| `table(rows, { columns? })` | A Markdown table. Columns default to the union of keys in first-seen order. `\|` is escaped and newlines are flattened |
| `entries(record, (key, value) => MaybeString)` | One line per entry the formatter returns truthy for |
| `codeBlock(code, language?)` | A fenced block |
| `join(...parts)` | Falsy parts dropped, the rest joined by a blank line |
| `when(condition, content \| () => string)` | The content, or `undefined` |
| `xmlTag(name, content)` | `<name>` with indented content, or `""` for empty content. Does not escape |

The same subpath exports `renderTaggedContext(tagged, order, { indent?, escape? })`, `validateTagName(name)` and `RESERVED_TAG_NAMES`.

A prompt file whose template has a `<context>` block renders context itself from the resolved `context` slot and every capability contribution, keyed by tag name. The default append is skipped, and a key the template does not render is dropped.

## In what order is context assembled?

The model's message list, in order:

| # | Part | Role | Notes |
|---|---|---|---|
| 1 | `prompt`, a blank line, then the XML block from every object-form `context` entry | `system` | One message. Omitted when both are empty. |
| 2 | Bare-string and function-string `context` entries, and pre-built messages | `system`, or the message's own role | One message each, in author order. Static capability entries come after the generator's own. |
| 3 | The `<tools>` list, when `describeTools` is on and a tool has a description | `system` | The last system message. |
| 4 | `history` | As stored | Includes the current request's own items by default. |
| 5 | `user` | `user` | A string becomes `{ role: "user", content }`. Any other value is passed as a message. |

If `history` ends with a user message equal to the first `user` value, that `user` value is dropped, so the model sees the turn once. Equal means the same text, or the same multi-part content regardless of key order. A history line made of text plus file or image parts also matches a `user` string equal to its text: the `user` value is dropped and the history line, files included, is kept. A `user` slot that is a multi-part message with different content is not matched. Only the first `user` value is examined, and only when history is not empty. Wiring an action's `userMessage` and a generator's `user` to the same text is safe for this reason.

Before each step after the first, a generator with any function-valued `prompt`, `context` or `tools` rebuilds its system messages from current state and its current tool list. History, the user message and the step's tool calls and results are kept. A generator with only static slots resolves them once.

## `history` and `user`

| Value | Meaning |
|---|---|
| `history: true` | `ctx.session.items.history()` |
| `history: { limit: 8 }` | `ctx.session.items.history(query)` for any `ItemQuery`. An object with a `content` or `role` key is a static message instead |
| A function or array | A slot, used as given |

An `ItemQuery` has these fields:

| Field | Meaning |
|---|---|
| `includeTransient` | Default `false`. `true` includes transient items, which are sent to live consumers and never stored. |
| `itemTypes` | `string[]`. Keeps only items of these types. |
| `roles` | `("user" \| "assistant" \| "system" \| "developer" \| "tool")[]`. Keeps only message items with one of these roles. |
| `itemVisibility` | An `{ client, history }` pair. Keeps only items whose resolved visibility is exactly that pair. |
| `agentName` | `string` or `string[]`. Keeps only items stamped with one of these agent names. |
| `limit` | `number`, `{ turns: number }` or `{ tokens: number }`. In `history()` a bare number counts turns; in `all()` and `client()` it counts items. `{ tokens: N }` packs whole turns from the end until the next would not fit, and always includes the most recent prior turn, even over budget. |
| `includeInFlight` | Default `true`: items the current request has produced come after the prior turns. |
| `afterRequestId` | History only. Starts after that turn, applied before `limit`. |
| `earlierDocuments` | History only. How a file attached to an earlier turn reaches the model. `"window"` (default) re-sends the newest documents, up to one message's limits, and names the older ones. `"named"` sends none: each becomes one line with its name and id, which a model with the attachments capability's `readAttachment` tool can read on request. The request's own files and every image are unaffected. |

- How many prior turns a request loads is set by the flow's `session.historyWindow`, on [Flows and actions](./flows.md).
- Which item types enter history is on [Items and the stream](./items.md#which-items-does-the-model-see-on-the-next-turn).
- A summary of turns past the window comes from `utility.historySummary`, on [Utility blocks](./utility-blocks.md#historysummary).

`user` is a function, a static value or an array of those. It resolves once per run, before the loop, and array results flatten. A prompt file's `<user>` block fills it unless the config sets `user`.

## What ends a tool loop?

One step is one model call. Each step may ask for tool calls, which run before the next step starts.

| Condition | What happens |
|---|---|
| A step returns no tool calls and its `finishReason` is not `"tool-calls"` | The loop ends. A text answer is the text of every step, joined with a blank line. A structured answer comes from the final step alone. |
| The step cap is reached | The loop stops after `loop.maxIterations ?? maxIterations ?? 8` model calls, minimum 1. See [At the cap](#at-the-cap). |
| `loop.runTools: false` | The model may name a tool and nothing runs. The loop ends on the first step that returns a tool call, and the calls come back on the result. |
| A tool calls `ctx.suspend()` | The loop stops and the request suspends. How sibling calls finish and how a resume continues is on [Pause, resume and replay](./durable-execution.md#pausing-in-a-generator). |
| The request is aborted | The signal is checked at the start of every step. |
| A provider-run call (search, code execution) | The framework does not run it. A step whose only calls are provider-run ends the loop, unless its `finishReason` is `"tool-calls"`, in which case the loop continues. |

Several calls in one step run concurrently and all settle before the next step. The results go back in one assistant turn followed by one tool message per call, in call order.

### At the cap

What comes back depends on whether the run streams. A run streams when the output is plain text, the model can stream, and the generator sets `itemVisibility` or has tools.

| Run | At the cap |
|---|---|
| Not streamed, no step wrote text | Throws `Generator "<name>" did not produce output after N step(s)` |
| Not streamed, an earlier step wrote text | That text is the answer. Nothing throws |
| Streamed | Does not throw. Whatever text streamed is the answer, which can be `""` |

`loop.answerOnLastStep: true` (with `runTools` not `false` and a cap above 1) offers the model none of the generator's tools on the last step, so it answers in text. Provider tools stay. Without it the last step offers every tool, and a model that keeps looking things up ends on a tool call with nothing said.

## Tools a generator is given

| Topic | Behaviour |
|---|---|
| Forms | `tools: [a, b]` or `(input, ctx) => [a, b]`, resolved each run and again before each later step when a function. Any block is a tool: handler, sequencer, router, generator or evaluator. The model sees the block's `name`, `description` and `inputSchema`. |
| Resources | Resources a tool declares are installed in the flow only for tools in a static `tools` array. |
| Unique names | Two different blocks with one `name` in a resolved list throw when the generator runs: `Generator "<name>" has two tools named "<tool>"`. The same block twice is one tool. `.as({ name })` renames a copy. |
| The name the model sees | Characters outside `[a-zA-Z0-9_-]` become `_`, so `tf.memory/recall` is `tf_memory_recall`. Names that sanitize alike get the smallest free numeric suffix (`foo_bar`, `foo_bar_2`). `tool_output` items record both names. |
| Capability tools | A generator that declares `tools:` at all, including `tools: []`, drops every tool a capability in `uses` contributes through `tools`, unless the block names that tool itself. One that does not mention `tools` keeps them. A capability can also contribute `controlTools`, tools it needs for its own job, such as a skills loader. Those reach every generator that uses the capability whatever `tools:` says, and are valid only on generators. |
| A tool needing flow config | A tool whose `flowConfigSchema` the flow's config does not satisfy throws before the model is offered the list. |
| Caching results | `cacheable` on the tool block. Inert without a tool-cache store in scope. |
| `mapModelOutput(mapper)` | On a tool block, sets the string the model reads as the result. The structured output goes to items and the trace. A mapper that throws fails the run. |

### A failed tool call

| Case | What happens |
|---|---|
| The tool throws | The run continues. The model's next step receives a tool result of type `error-text` whose value is the error's message and nothing else. |
| The model's arguments fail the tool's `inputSchema` | `execute` does not run. The model receives `Block "<name>" input validation failed at "<path>": <message>` and may call again, which spends a step. |
| The model calls a name that is not a tool | Nothing runs. The result is `Model called unknown tool "<name>"` and the loop continues. |
| The tool suspends | Not a failure. The loop stops. The `tool_output` is `failed` with `error.code === "SUSPENSION"` until the answer arrives. |
| The tool exceeds `timeoutMs` | A thrown `tool:<name> timed out after <n>ms`, handled as any failed call. |

### Tool retry, timeouts and observers

Set on `defineFlow({ tools })` or the generator's `flowTools`.

| Field | Meaning |
|---|---|
| `defaults.retry` | `{ maxAttempts = 1, baseDelayMs = 0, maxDelayMs = unbounded, retryableErrors }`. The delay is `min(maxDelayMs, baseDelayMs * 2^(attempt - 1))`. A non-empty `retryableErrors` narrows retry to instances of those classes. A `FlowError`'s `retryable` flag is not read. Suspension errors are never retried. The input check runs inside each attempt, so bad input is checked once per attempt and `execute` never runs. |
| `defaults.timeoutMs` | Bounds each attempt. |
| `onToolStarted` | `(event, ctx) => void` or a block. Fires once per call. |
| `onToolCompleted` | Fires after success, with `output`. |
| `onToolErrored` | Fires once per failed call, after every retry attempt is used up, and before the failed `tool_output` item finishes. With `maxAttempts: 3` and a tool that always throws, the tool runs three times and `onToolErrored` fires once. |

The event is `ToolLifecycleEvent`: `{ toolName, input, output?, error?, cached? }`. For a call served from the tool cache, `onToolStarted` and `onToolCompleted` fire with `cached: true`, and `onToolErrored` never does, because errors are not cached. The generator's own `retry` option is a different mechanism: it repeats the whole run.

## Output schemas

Without an `outputSchema` the output is `z.string()` and the generator returns text. A text schema sends the model no structured-output schema. An object schema is sent as the structured-output schema.

| Topic | Behaviour |
|---|---|
| What counts as text | A bare `z.string()`, with or without checks such as `.min()`. `z.string().nullable()`, `.optional()` and `.refine()` are structured. |
| Strict-schema guard | `generator()` throws `StrictSchemaError` (`code: "strict_schema_error"`, `retryable: false`, `details.violations[]` of `path`, `typeName`, `reason`) when the schema contains a `z.record`, or a `z.union` or `z.discriminatedUnion` whose variants are not all literals, after optional, default and nullable wrappers are removed. The message starts `Generator "<name>" output schema is not OpenAI strict-mode compatible:`. The original schema, defaults and optionals included, is what validates the reply. `assertStrictCompatible` runs the same check. |
| Repair applies to | A reply that is not streamed. A streamed text reply is validated once, with no repair. |

### Repair, in order

| Step | What happens |
|---|---|
| 1 | The reply is validated. A pass returns the parsed value, with defaults applied. |
| 2 | In `repair.mode` `"fail"` and `"rescue"`, a failure throws `OutputValidationError` at once. Catch it with `.rescue()` on the block or sequencer. |
| 3 | In `"auto"`, up to `repair.maxAttempts` deterministic passes (default 1, `0` skips them). With `repairOutput` set it is called. Otherwise the built-in pass parses a string as JSON, else repairs it (trailing commas, unclosed braces, code fences) and parses, then unwraps `{ output: ... }`. Each pass is followed by validation. |
| 4 | The reply fails again, and `repair.coerce` is not `false`: one model call rewrites the reply to match the JSON Schema. The model is `repair.coerce.model`, or `intent/utility` by default. A failure of this call other than an abort is written to the server's console with `console.warn`, and the original validation error is thrown. The result goes through the deterministic pass and one more validation. |
| 5 | Otherwise the generator throws `OutputValidationError` and writes the candidate, truncated to 2,000 characters, to the server's console with `console.warn`. |

`OutputValidationError` has `code: "output_validation_error"`, `retryable: false`, and a message `Generator "<name>" output validation failed at "<path>": <message>` from the first Zod issue. Its `details` (`rawOutput`, `issues`, `phase`) are listed on [Errors](./errors.md), and appear on the block's trace `error.details`.

## `search`

`search: true` uses defaults. An object is a `GeneratorSearchConfig`. The provider is read from the resolved model, and its search tool is added beside `providerTools` and block tools.

| Field | Anthropic | OpenAI | Google, Vertex |
|---|---|---|---|
| `maxUses?: number` | `maxUses` | not used | not used |
| `allowedDomains?: string[]` | `allowedDomains` | not used | not used |
| `blockedDomains?: string[]` | `blockedDomains` | not used | not used |
| `userLocation?: { type: "approximate"; city?; region?; country?; timezone? }` | `userLocation` | `userLocation` | not used |
| `searchDepth?: "low" \| "medium" \| "high"` | not used | `searchContextSize` | not used |

A field the provider has no use for is dropped without an error. `search` adds nothing, and raises no error, when the provider is not Anthropic, OpenAI, Google or Vertex, or when the model does not expose provider search. In a model array, the first model that resolves a tool supplies it. Sources the provider returns become `source` items on a generator with `itemVisibility`.

`search` is separate from the `tools.search` block, which has its own `tier` and `searchDepth` (`"basic"` or `"advanced"`).

## What is recorded per call

Each run leaves items on the request that ran it. Which items exist depends on `itemVisibility` and on whether the model called tools. Item shapes are on [Items and the stream](./items.md).

| Recorded | When | Who sees it | How many |
|---|---|---|---|
| `message` (`role: "assistant"`) | A text generator with `itemVisibility` set. `in_progress`, then `completed` | The client if `itemVisibility.client`; later turns' `history` if `itemVisibility.history` | One per run. Text from several steps is one message |
| `reasoning` | The model streams reasoning | As `message` | One per run |
| `source` | `search` or provider tools return sources | The client, never history, whatever `itemVisibility` says | One per source |
| `tool_output` | Every tool call, whether or not `itemVisibility` is set. `in_progress`, then `completed` or `failed` | The client and history by `itemVisibility`, both by default | One per call, per step. Carries the call, `output`, `error` and `cached` when they apply, and `modelOutput` only when the tool has `mapModelOutput` |
| `tool_call_progress` | `itemVisibility` is set | The client, never history, whatever `itemVisibility` says. Transient: sent to live consumers, never stored in the session log | An in-progress and a completed item per call |
| `generator_step` | Each step that called tools | Nobody in a UI. Stored with the request | One per such step. Step 0 also carries the full assembled message list |
| `block_trace` | Every run | Developers, in the DevTool. Sent to a browser stream only when the client asks for trace items (`?include=trace`, or `includeTrace: true` in the JS client). See [Items and the stream](./items.md) | One per run, with the resolved model, usage, `output` and `error`. Each called tool block has its own `block_trace` |
| Spend | Every step | The caller of the request, and the DevTool | One usage report per step, plus one aggregate on the generator's `block_trace` |

- A streamed text reply's `block_trace.output` is a reference to the `message` item, not a copy of the text.
- A recorded value over 256 KiB serialized is stored as a placeholder. The limit and the placeholder shape are on [Items and the stream](./items.md).
- Everything sent to the model, `context` included, is in the trace's `generator` capture, and on a run with tool calls in the step-0 `generator_step`. What you put in `context` is recorded, so keep secrets out of it.
- A generator built from a prompt file records the file's raw source and frontmatter on its DevTool trace. An inline prompt records none.
- The model's identity (`{ actual, requested?, gateway? }`) is stamped on the generator's `message`, `reasoning`, `source`, `tool_output` and `tool_call_progress` items and on the generator's `block_trace`.
