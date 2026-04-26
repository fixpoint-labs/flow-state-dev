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
