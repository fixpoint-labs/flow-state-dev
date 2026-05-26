---
sidebar_position: 9
---

# Generator context

Generator blocks assemble the model's input from four slots: `prompt`, `context`, `history`, and `user`. The `context` slot is where dynamic, per-turn material goes — documents, retrieved memory, tool descriptions, anything that varies turn-to-turn or comes from a capability rather than the developer's prompt prose.

This page covers the two ways to author `context`: the original array form, and the newer object form with XML tag aggregation.

## When to use which form

- **Array form** is the lowest ceremony. Use it when you have one or two static blobs to attach and you don't need to coordinate with capabilities. Each entry becomes its own system message.
- **Object form** is for two situations:
  1. You want sections of the prompt clearly delimited with XML tags (Anthropic's prompt-engineering guidance prefers this for long contexts on Claude).
  2. Multiple sources contribute related material to the same logical section — for example, two capabilities each adding documents — and you want them aggregated under one cohesive `<documents>` block instead of scattered across separate sections.

The two forms can sit side by side in the same generator, both as sibling array entries.

## Array form

```ts
import { generator } from "@flow-state-dev/core";

generator({
  prompt: "You are a research assistant.",
  context: [
    "Static blob of background information.",
    (input, ctx) => `Per-turn dynamic context for ${input.topic}`,
  ],
  // ...
});
```

Each entry resolves to a string and emits as its own system message after the prompt. Functions are called with `(input, ctx)` at run time.

## Object form

```ts
generator({
  prompt: "You are a research assistant.",
  context: {
    documents: [doc1, doc2],
    userPreferences: () => loadPrefs(),
    memory: {
      shortTerm: shortTermItems,
      longTerm: () => loadLongTerm(),
    },
  },
});
```

Renders to a single combined system message:

```
You are a research assistant.

<documents>
  ...doc1...
  ...doc2...
</documents>
<user-preferences>
  ...
</user-preferences>
<memory>
  <short-term>...</short-term>
  <long-term>...</long-term>
</memory>
```

### Tag-name normalization

Authoring keys can be `camelCase`, `snake_case`, or `kebab-case`. All three normalize to kebab-case before aggregation, so contributions to the same logical name from different files or different capabilities collapse into the same tag:

```ts
context: [
  { userPreferences: "from one source" },
  { user_preferences: "from another" },
  { "user-preferences": "from a third" },
]
// → <user-preferences>... all three values ...</user-preferences>
```

### Value types

| Value             | Behavior                                                                |
|-------------------|-------------------------------------------------------------------------|
| `string`          | Becomes leaf content under the tag.                                     |
| `string[]`        | Each element becomes a separate line under the tag.                     |
| nested object     | Becomes nested XML tags. Recursive — nest as deeply as needed.          |
| function          | Resolved with `(input, ctx)` at render time. Return value re-enters these rules (can return a string, array, nested object, or `null`). |
| `null` / `undefined` | Placeholder. Reserves first-insertion order but emits nothing if no contributor fills it. |

Object values produce nested tags, **not** JSON. If you want JSON content inside a tag, serialize explicitly:

```ts
context: {
  // Nested tags
  memory: { recent: items },
  // JSON content
  preferences: JSON.stringify({ theme: "dark", lang: "en" }),
}
```

### Cross-source aggregation

When the generator's own `context`, a static capability preset, and a dynamic capability resolver all contribute to the same key, their values aggregate inside a single tag in author order. The model sees one cohesive `<documents>` block instead of three scattered ones.

```ts
const sourceA = defineCapability({
  name: "source-a",
  presets: { defaults: { context: () => ({ documents: "from A" }) } },
});

const sourceB = defineCapability({
  name: "source-b",
  presets: { defaults: { context: () => ({ documents: "from B" }) } },
});

generator({
  context: { documents: "from generator itself" },
  uses: [sourceA, sourceB],
});
// → <documents>
//     from generator itself
//     from A
//     from B
//   </documents>
```

### Type mismatches throw

If one source contributes `{ documents: "scalar" }` and another contributes `{ documents: { recent: x } }` — a string-vs-nested-object collision on the same key — render fails with a clear error. Pick one shape per logical key.

### Placeholder ordering

Authors who want to declare top-level layout up front can use `null` placeholders. The placeholder reserves its position in the rendered output; if no contributor fills it, the tag is omitted entirely.

```ts
context: {
  documents: null,    // reserved as the first tag
  memory: null,       // reserved as the second tag
  // capabilities can fill these and add more keys after
}
```

This doubles as documentation of the tags this generator's prompt is designed around.

### Reserved tag names

Some names collide with framework-emitted tags or model-conditioned protocol tokens (Anthropic's tool-use protocol, role markers, etc.). Using one of these as a context key throws at render time:

```
active-skill, thinking, answer, tool-use, tool-result, function-calls,
invoke, parameter, system, user, assistant, role, message
```

The list is checked against the canonical (kebab-case) form, so `tool_use` and `tool-use` both match.

A note on `role`: the aggregator also accepts pre-built AI-SDK messages — objects whose `role` is one of `"system" | "user" | "assistant" | "tool"` and that carry a `content` field — and passes them through to the messages array unchanged. Any other object with a `role` key (for example, `{ role: () => "Analyst" }` or `{ role: "manager", content: "..." }`) is rejected with an explicit error that names the offending tag. If you want a tag literally named `role`, you can't — pick a different name (`agent-role`, `persona`, etc.).

### Escaping in string leaves

`<`, `>`, and `&` in string leaf values are HTML-escaped (`&lt;`, `&gt;`, `&amp;`) so user data containing angle brackets isn't read by the model as a tag boundary. Nested-tag emission is unaffected — the renderer always knows which case it's in.

If you have content where you specifically want raw passthrough, render it to a string yourself and route it via the array form.

## Composition with `prompt`

The rendered system message places the developer-authored `prompt` first, then a blank line, then the rendered XML block:

```
${prompt}

${rendered tagged context}
```

Plain string entries from the array form follow as additional system messages, in author order. This means `prompt` stays single-author prose written by the generator's developer; `context` is the multi-author surface where capabilities can write without stepping on each other.

## Helpers

The XML helpers used internally are also exported for direct use:

```ts
import { xmlTag, renderTaggedContext, validateTagName, RESERVED_TAG_NAMES } from "@flow-state-dev/core/prompt";
```

They're stable, pure functions — useful if you ever want to compose XML strings outside a generator slot.

## User slot

The `user` slot resolves to the user-role message representing this turn's input. It's the generator-side complement to the action-level `userMessage`.

### What the user slot does

The slot sits in the assembled `messages` array after `history` and before any tool calls. The slot function receives the block input and returns either a string (wrapped into `{ role: "user", content: <string> }` internally) or a pre-shaped LLM message (passed through as-is). Like the other slots, it can also be a static value or an array of entries.

### Relationship to `userMessage`

`userMessage` is defined on the action. It emits a durable `MessageItem` with `role: "user"` to the response stream. Transports, replay, and observability all read that item. It feeds future turns' `history` because past requests' items flow back through `session.items.history()`.

`user` is defined on the generator. It resolves the current turn's user-role message at generator runtime, when the model is being called.

They serve complementary contracts. Wiring both to the same source is safe. The framework deduplicates equivalent user-role content at message assembly, so the model sees the user's turn exactly once even when both surfaces resolve to identical text.

### When to use which

Action-wrapped flows — the standard chat-agent shape — typically wire both. `userMessage: (input) => input.message` on the action keeps the durable item correct. `user: (input) => input.message` on the generator keeps the generator's own definition complete, so the same block works in a sequencer composition or a unit test without an action wrapper above it. The framework dedup is what makes this redundancy safe.

Sub-generators and worker blocks usually set `user` only, with content derived from state, tool output, or a reformulation of the input. They have no enclosing `userMessage` of equivalent content, so the dedup is a no-op for them.

### Examples

Chat-agent shape — both surfaces wired:

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";

const chat = generator({
  name: "chat",
  model: "openai/gpt-5.4-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: { limit: 8 },
  user: (input) => input.message
});

defineFlow({
  kind: "chat-app",
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: chat,
      userMessage: (input) => input.message
    }
  }
});
```

Worker shape — `user` only, content derived from task state:

```ts
const worker = generator({
  name: "worker",
  model: "openai/gpt-5.4-mini",
  prompt: "Execute the assigned task.",
  agentType: "sub",
  user: (input, ctx) => `Task: ${input.description}\nWorkspace:\n${ctx.cap.workspace.summary()}`
});
```

## Conversation history windowing

When `history` is enabled on a generator, the framework assembles the LLM-ready history from the session's prior requests. The window is measured in **conversational turns**, not raw protocol messages. A turn is one user request and the assistant response that followed it — including any tool calls the assistant made along the way. Asking for "the last 8" gives you the last 8 turns, not the last 8 wire messages.

This matters because a single tool-heavy turn can produce many protocol messages. Each tool call expands into an assistant `tool-call` message plus a `tool` result message. If a budget counted raw messages, four tool calls in one turn could quietly evict the prior user message from the window. Counting by turn keeps the conversation intact and lets tool traffic ride along inside the turn it belongs to.

### When history is enabled

```ts
import { generator } from "@flow-state-dev/core";

generator({
  prompt: "You are a chat assistant.",
  model: "openai/gpt-5.4-mini",
  history: { limit: 8 },
});
```

Omitting `history` skips history assembly entirely. `history: true` includes every prior conversational item in the session, unbounded.

### Numeric limit

`{ limit: 8 }` keeps the last 8 turns. Tool calls inside those turns ride along full-fidelity, so the model sees what tools ran and with what arguments. Items from the in-flight request — anything produced this turn so far — are always included, regardless of the limit. That guarantee is what makes "try again" after a mid-turn failure work: the retried turn can still see the user's last message and any partially completed tool state.

The bare `number` form has different meanings across views: in `items.history()` it counts turns, in `items.all()` and `items.client()` it counts items. Use the explicit `{ turns: N }` form when you want to be unambiguous in new code:

```ts
history: { limit: { turns: 8 } }
```

### Token-aware limit

`{ limit: { tokens: 20_000 } }` packs whole turns from the end of the conversation until the next one would not fit. Turns are never split across the budget boundary. If the most recent prior turn alone exceeds the budget, it is included anyway — an empty window is worse than a single oversized turn.

```ts
history: { limit: { tokens: 20_000 } }
```

### When to use which

Numeric turn limits are cheap and predictable: pick one when the conversation shape is uniform and you have a rough sense of how many turns of context the model needs. Token limits are the right choice when individual turns vary a lot in size (long retrieved documents, large tool outputs) and you care more about the model's context budget than the turn count.

### Edge cases

A turn whose items are entirely sub-agent output, or any other items that don't contribute to LLM history, still counts against `{ turns: N }` but contributes no messages. This keeps the windowing logic at the request level. If sub-agent-heavy turns become common in your flow, prefer a token budget.

Tool-aware compaction (rewriting older tool calls into shorter summaries) and goal-aware pruning (dropping turns that aren't relevant to the current goal) are deliberately not part of this default. They belong to higher-level patterns that layer on top of this windowing primitive.

## Authoring the prompt as an external file

A generator's `prompt` can live in a separate `.md` file instead of inline TypeScript. The body is a LiquidJS template, so it can read the generator's input, the block context, and the resolved config. See [Prompts as Markdown](./generator-prompts-markdown.md) for the full format.

The context model carries over with one addition worth knowing here. By default the framework still appends the aggregated XML context after the rendered system prompt, exactly as described above. If the template includes a `<context>` block, that default append is suppressed and the template owns the context position: it can reorder keys, conditionally include them, or restructure them.

The template reads the aggregated context through `config.context`, a `Record<string, string>` keyed by XML tag name. That map is the post-resolution result of the `context:` slot plus every capability contribution. It is a read surface for rendering, not a second place to author context. You still declare context on the `context:` slot; the template only reads the computed result.
