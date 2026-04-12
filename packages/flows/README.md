# @flow-state-dev/flows

Ready-to-use flow definitions for the most common AI application patterns. Each flow is a factory function that returns a configurable `FlowType`. Works out of the box with sensible defaults, customizable when you need it.

## Install

```bash
pnpm add @flow-state-dev/flows
```

## Flows

### `chatFlow` — Multi-turn Conversation

The most common pattern. Maintains conversation history across requests, streams text token-by-token, tracks message count in session state.

```typescript
import { chatFlow } from "@flow-state-dev/flows";

// Works with zero config
const flow = chatFlow()({ id: "my-chat" });

// Or configure it
const flow = chatFlow({
  model: "anthropic/claude-sonnet-4-20250514",
  prompt: "You are a coding assistant. Help users write better TypeScript.",
  tools: [searchTool, readFileTool],
  search: true,
  maxIterations: 15,
})({ id: "code-assistant" });
```

**Action:** `chat` with input `{ message: string }`

**Session state:** `{ messageCount: number }` — incremented after each exchange.

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"openai/gpt-4o-mini"` | LLM model identifier |
| `prompt` | `string` | Generic assistant prompt | System prompt |
| `tools` | `GeneratorTool[]` | `undefined` | Tool blocks for the LLM |
| `search` | `boolean \| GeneratorSearchConfig` | `undefined` | Web search grounding |
| `maxIterations` | `number` | `10` | Max tool-loop iterations |
| `voice` | `VoiceConfig` | `undefined` | Voice / TTS config |

### `agentFlow` — Tool-Using Task Agent

For agentic workflows where the LLM drives tool use to accomplish a goal. Higher default iteration limit, task-oriented defaults.

```typescript
import { agentFlow } from "@flow-state-dev/flows";

const flow = agentFlow({
  model: "anthropic/claude-sonnet-4-20250514",
  prompt: "You are a research agent. Find and synthesize information.",
  tools: [searchTool, readUrlTool, extractTool],
})({ id: "researcher" });
```

**Action:** `run` with input `{ goal: string }`

**Session state:** `{ taskCount: number }` — incremented after each task.

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"openai/gpt-4o-mini"` | LLM model identifier |
| `prompt` | `string` | Task-oriented agent prompt | System prompt |
| `tools` | `GeneratorTool[]` | **required** | Tool blocks (agents need tools) |
| `search` | `boolean \| GeneratorSearchConfig` | `undefined` | Web search grounding |
| `maxIterations` | `number` | `25` | Max tool-loop iterations |

### `generateFlow` — Single-Shot Generation

The simplest flow. One input, one LLM call, one output. No history, no tools, no session state. Use for summarization, extraction, transformation.

```typescript
import { generateFlow } from "@flow-state-dev/flows";

// Text summarizer
const flow = generateFlow({
  prompt: "Summarize the following text concisely.",
})({ id: "summarizer" });

// Structured extraction
import { z } from "zod";

const flow = generateFlow({
  prompt: "Extract entities from the text.",
  outputSchema: z.object({
    people: z.array(z.string()),
    places: z.array(z.string()),
    dates: z.array(z.string()),
  }),
})({ id: "entity-extractor" });
```

**Action:** `generate` with input `{ input: string }`

**Session state:** None.

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"openai/gpt-4o-mini"` | LLM model identifier |
| `prompt` | `string` | Generic assistant prompt | System prompt |
| `outputSchema` | `ZodTypeAny` | `undefined` (string) | Structured output schema |

## Customizing Beyond Config

Every flow factory returns a `FlowType`, which is callable with `FlowInstanceOptions` for deeper overrides. You can add actions, merge session state, attach middleware, and more:

```typescript
const flow = chatFlow({ model: "openai/gpt-4o" });

const instance = flow({
  id: "extended-chat",
  kind: "my-custom-chat",
  // Add extra actions alongside the built-in chat action
  actions: {
    reset: {
      inputSchema: z.object({}),
      block: resetHandler,
    },
  },
  // Merge additional session state
  session: {
    stateSchema: z.object({
      messageCount: z.number().default(0),
      topic: z.string().optional(),
    }),
  },
});
```

## Exported Schemas

Each flow's input and state schemas are exported for use in your own code:

```typescript
import {
  chatInputSchema,     // z.object({ message: z.string().min(1) })
  goalInputSchema,     // z.object({ goal: z.string().min(1) })
  textInputSchema,     // z.object({ input: z.string().min(1) })
  messageCountStateSchema,  // z.object({ messageCount: z.number().default(0) })
  taskCountStateSchema,     // z.object({ taskCount: z.number().default(0) })
  DEFAULT_MODEL,       // "openai/gpt-4o-mini"
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
