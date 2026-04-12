# @flow-state-dev/flows

Ready-to-use flow definitions for the most common AI application patterns. Each flow is a factory function that returns a configurable `FlowType`. Works out of the box with sensible defaults, customizable when you need it.

## Install

```bash
pnpm add @flow-state-dev/flows
```

## Flows

### `chatFlow` — Multi-turn Conversation

Full-featured chat agent with conversation history, model selection via user preference, capability support (memory, artifacts, etc.), tools, search, and voice. Includes a built-in `setPreferredModel` action so users can switch models at runtime.

```typescript
import { chatFlow } from "@flow-state-dev/flows";

// Works with zero config
const flow = chatFlow()({ id: "my-chat" });

// With model selection, tools, and memory
import { memory } from "@thought-fabric/core";

const mem = memory.system({ model: "openai/gpt-4o-mini", working: true });

const flow = chatFlow({
  model: "openai/gpt-4o",
  prompt: "You are a coding assistant.",
  tools: [searchTool, readFileTool],
  uses: [mem.capability],
  context: [mem.contextFormatter],
  historyLimit: 50,
})({ id: "code-assistant" });
```

**Actions:**

- `chat` — input `{ message: string }`. Send a message, get a streamed response.
- `setPreferredModel` — input `{ preferredModel: string }`. Switch the active model (persisted in user state).

**State:**

- Session: `{ messageCount: number }` — incremented after each exchange.
- User: `{ preferredModel?: string }` — the user's preferred model, honored via `selectModel`.

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"openai/gpt-4o-mini"` | Default LLM model identifier |
| `prompt` | `string` | Generic assistant prompt | System prompt |
| `tools` | `GeneratorTool[]` | `undefined` | Tool blocks for the LLM |
| `search` | `boolean \| GeneratorSearchConfig` | `undefined` | Web search grounding |
| `maxIterations` | `number` | `10` | Max tool-loop iterations |
| `voice` | `VoiceConfig` | `undefined` | Voice / TTS config |
| `uses` | `CapabilityRef[]` | `undefined` | Capabilities (memory, artifacts, etc.) |
| `context` | `GeneratorSlotEntry[]` | `undefined` | Context formatters for the system prompt |
| `historyLimit` | `number` | No limit | Max prior LLM messages in history |

### `componentFlow` — AI-Enabled UI Component

For UI components that have AI-powered actions: a text editor with "Improve Writing", "Make Shorter", "Fix Grammar" buttons, a content area with "Summarize", "Translate" actions, etc.

Each action is a named content transformation. The user provides content and optionally extra instructions; the LLM applies the action's prompt and returns the transformed text. No conversation history. Each action is single-shot.

```typescript
import { componentFlow } from "@flow-state-dev/flows";

const flow = componentFlow({
  actions: {
    improve: "Improve the writing quality while preserving meaning.",
    shorten: "Make this more concise without losing key information.",
    fixGrammar: "Fix grammar, spelling, and punctuation errors.",
    expand: "Expand with more detail and supporting examples.",
  },
})({ id: "text-editor" });

// With a base prompt and custom model
const flow = componentFlow({
  model: "anthropic/claude-sonnet-4-20250514",
  prompt: "You are a professional editor for technical documentation.",
  actions: {
    simplify: "Rewrite for a non-technical audience.",
    formalize: "Rewrite in a formal, professional tone.",
  },
})({ id: "doc-editor" });

// With structured output
import { z } from "zod";

const flow = componentFlow({
  actions: {
    improve: "Improve the writing.",
    extract: {
      prompt: "Extract key entities from the text.",
      outputSchema: z.object({ entities: z.array(z.string()) }),
    },
  },
})({ id: "smart-editor" });
```

**Input:** `{ content: string, instruction?: string }` — same schema for every action. The optional `instruction` field lets users add ad-hoc guidance per request.

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"openai/gpt-4o-mini"` | LLM model identifier |
| `prompt` | `string` | `undefined` | Base system prompt shared across all actions |
| `actions` | `Record<string, string \| ComponentActionConfig>` | **required** | Named actions (prompt string or config object) |

**`ComponentActionConfig`:**

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | Action-specific instruction appended to the base prompt |
| `outputSchema` | `ZodTypeAny` | Structured output schema (defaults to plain text) |

## Customizing Beyond Config

Every flow factory returns a `FlowType`, which is callable with `FlowInstanceOptions` for deeper overrides:

```typescript
const flow = chatFlow({ model: "openai/gpt-4o" });

const instance = flow({
  id: "extended-chat",
  kind: "my-custom-chat",
});
```

## Exported Schemas

Each flow's input and state schemas are exported for use in your own code:

```typescript
import {
  chatInputSchema,                // z.object({ message: z.string().min(1) })
  componentInputSchema,           // z.object({ content: z.string().min(1), instruction: z.string().optional() })
  setPreferredModelInputSchema,   // z.object({ preferredModel: z.string().min(1) })
  messageCountStateSchema,        // z.object({ messageCount: z.number().default(0) })
  preferredModelUserStateSchema,  // z.object({ preferredModel: z.string().optional() })
  DEFAULT_MODEL,                  // "openai/gpt-4o-mini"
} from "@flow-state-dev/flows";
```

## Testing

Flows work with `@flow-state-dev/testing` out of the box:

```typescript
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { chatFlow } from "@flow-state-dev/flows";

const mock = mockGenerator({
  name: "chat-generator",
  script: [{ text: "Mocked response." }],
});

const result = await testFlow({
  flow: chatFlow()({ id: "test" }),
  action: "chat",
  userId: "test-user",
  input: { message: "Hello" },
  generators: { "chat-generator": mock },
  models: { "openai/gpt-4o-mini": mock },
});

expect(result.status).toBe("completed");
```
