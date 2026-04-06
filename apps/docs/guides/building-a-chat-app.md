---
sidebar_position: 2
---

# Building a Chat App

This guide walks you through building a complete chat application from blocks to React UI to tests. Along the way, you'll understand what the framework does behind the scenes and how the concepts connect.

**What we're building:** A chat app where an LLM generates responses, a handler tracks message count in session state, and a React UI shows the conversation plus the count. Items stream in real time. Tests run without real LLM calls.

**Concepts we'll cover:** Generator slots (model, prompt, history, user), partial state schemas, sequencer composition, flow definition (kind, actions, userMessage, clientData), server registration, React hooks, and deterministic testing.

---

## 1. Define the blocks

### The generator — talks to the LLM

Generators are where AI happens. The framework manages the tool loop, streaming, and prompt assembly. You configure how the model receives context through four slots.

```ts title="src/flows/hello-chat/blocks/chat-gen.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant. Be concise and friendly.",
  inputSchema: z.object({ message: z.string() }),
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
});
```

**What each slot does:**

- **`model`** — The model ID. The framework resolves this at runtime via a model resolver (OpenAI, Anthropic, etc.). You can override it per request for testing or A/B runs.
- **`prompt`** — The system instruction. Sent first in every model call. Can be a string or a function `(input, ctx) => string` for dynamic prompts.
- **`history`** — Prior conversation messages. This is how the model remembers what was said before. The framework calls `ctx.session.items.llm()` to get completed messages in `{ role, content }` format, filters and formats them, and injects them into the prompt. Without this, each request would be stateless.
- **`user`** — The current user input. Extracted from the action input. In our case, it's `input.message`. The framework adds this as the final user-role message before calling the model.

The framework assembles the full prompt in order: prompt, context (if any), history, user. It handles tool calls, retries, and streaming. You focus on what goes in, not how it gets there.

**Optional slots:** You can add a `context` slot for extra data (e.g. retrieved documents). You can add `tools` to enable function calling. The generator will loop: call model, execute tool, call model again, until the model stops or hits a bound. All of that is framework-managed.

### The handler — tracks usage

Handlers are pure logic. No LLM. They validate, transform, and mutate state.

```ts title="src/flows/hello-chat/blocks/counter.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const counter = handler({
  name: "counter",
  inputSchema: z.any(),
  outputSchema: z.any(),
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
    return input;
  },
});
```

**Partial state schema:** The handler declares only `messageCount`. It doesn't need to know about other session state fields. This partial schema bubbles up to the flow level, where the framework merges it with any other blocks' declarations. The benefit: blocks stay portable and self-documenting. A counter block can be reused in flows that have different full schemas.

**`incState` is atomic:** Unlike `patchState` (which does a read-modify-write), `incState` is a single CAS-guarded operation. Safe under concurrent requests. If two messages arrive at once, the count increments correctly. Use `incState` for counters and other commutative updates. Use `patchState` when you need to set specific values.

---

## 2. Compose the pipeline and flow

### The sequencer — composition primitive

A sequencer chains blocks into a pipeline. Each step's output becomes the next step's input.

```ts
const pipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .then(chatGen)
  .then(counter);
```

**Why this order?** The generator produces the assistant response. The handler runs after, using that output (we pass it through) and the session context to increment the count. If we put the counter first, we'd count before the LLM replied. Order encodes data flow.

The sequencer is the composition primitive. It replaces the agent-vs-workflow split. You chain blocks. Conditional logic, parallelism, and error recovery come from sequencer methods like `thenIf`, `parallel`, and `rescue`. For a simple chat pipeline, `.then()` is all you need. As flows grow, you'll use more of the DSL.

### The flow definition

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { chatGen } from "./blocks/chat-gen";
import { counter } from "./blocks/counter";

const inputSchema = z.object({ message: z.string() });

const pipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .then(chatGen)
  .then(counter);

const chatFlow = defineFlow({
  kind: "hello-chat",
  requireUser: true,

  actions: {
    chat: {
      inputSchema,
      block: pipeline,
      userMessage: (input) => input.message,
    },
  },

  session: {
    stateSchema: z.object({
      messageCount: z.number().default(0),
    }),

    clientData: {
      messageCount: (ctx) => ctx.state.messageCount ?? 0,
    },
  },
});

export default chatFlow({ id: "default" });
```

**What each part means:**

- **`kind`** — The flow identifier. Becomes the URL path: `/api/flows/hello-chat/actions/chat`. Clients use it to target this flow.
- **`actions`** — The flow's public API. Each action is an entry point. Clients invoke them by name: `sendAction("chat", { message: "Hello" })`. The framework validates input against `inputSchema`, resolves the session, and executes the block.
- **`userMessage: (input) => input.message`** — Before block execution, the framework emits a user-role message item with this text. That way the conversation stream shows what the user said. Without it, you'd only see assistant messages.
- **`clientData`** — The sole gateway for exposing server state to clients. Raw state never leaves the server. Every `clientData` entry is client-visible. Here we expose `messageCount` so the UI can display it. The clientData functions run when the framework builds a state snapshot (e.g. after `request.completed`). The client fetches snapshots via `GET /api/flows/sessions/:sessionId/state`.

---

## 3. Set up the server

Register the flow. Get a complete REST API.

```ts title="app/api/flows/[...path]/route.ts"
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import chatFlow from "@/flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(chatFlow);

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

**What you get:** Action execution, session management, SSE streaming with resume, and state snapshots. No route wiring.

**Key endpoints:**
- `POST /api/flows/hello-chat/actions/chat` — Execute the chat action (new or existing session)
- `GET /api/flows/hello-chat/requests/:requestId/stream` — SSE stream for that request
- `GET /api/flows/sessions/:sessionId/state` — State snapshot (clientData)

The catch-all route `[...path]` lets the framework handle routing internally. One file, full API. You can add a custom model resolver, store adapters, or middleware by passing options to `createFlowApiRouter`. See [Server Setup](/docs/server/setup) for details.

---

## 4. Build the React UI

The React hooks handle streaming, reconnection, and state sync. You render.

```tsx title="src/components/ChatApp.tsx"
import {
  FlowProvider,
  ItemRenderer,
  useFlow,
  useSession,
  useClientData,
} from "@flow-state-dev/react";

function ChatApp() {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser">
      <ChatUI />
    </FlowProvider>
  );
}

function ChatUI() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId, {
    items: { visibility: "ui" },
  });

  const clientData = useClientData(session, {
    session: ["messageCount"],
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const message = new FormData(form).get("message") as string;
    if (message.trim()) {
      session.sendAction("chat", { message });
      form.reset();
    }
  };

  return (
    <div>
      <header>
        <h1>Chat</h1>
        <span>{clientData.session?.messageCount ?? 0} messages</span>
      </header>

      <div>
        {session.items.map((item) => (
          <ItemRenderer key={item.id} item={item} />
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          name="message"
          placeholder="Type a message..."
          autoComplete="off"
        />
        <button type="submit" disabled={session.isStreaming}>
          {session.isStreaming ? "Thinking..." : "Send"}
        </button>
      </form>
    </div>
  );
}
```

**What each hook does:**

- **`FlowProvider`** sets up context. Every hook below it receives `flowKind` and `userId`. Child components use this to target the right flow and user. Wrap your app or a section of it.
- **`useFlow`** with `autoCreateSession: true` creates a session on mount if none exists. It tracks `activeSessionId` so you know which session to subscribe to.
- **`useSession`** connects to the SSE stream for that session. It delivers items in real time, provides `sendAction` and `isStreaming`, and re-renders when items or status change. The `visibility: "ui"` option filters to items the client should display (messages, components, etc.).
- **`useClientData`** reads from the latest state snapshot. You list which clientData keys to subscribe to. The hook refetches when the snapshot changes (e.g. after `request.completed`).

---

## 5. Write tests

No real LLM calls. No network. Deterministic results.

```ts title="src/flows/hello-chat/__tests__/flow.test.ts"
import { testFlow } from "@flow-state-dev/testing";
import chatFlow from "../flow";

test("chat action streams a response and increments count", async () => {
  const result = await testFlow({
    flow: chatFlow,
    action: "chat",
    input: { message: "Hello!" },
    userId: "testuser",
    generators: {
      chat: { output: "Hi there!" },
    },
  });

  // User message was emitted
  expect(result.items).toContainEqual(
    expect.objectContaining({ type: "message", role: "user" })
  );

  // Assistant message was emitted
  expect(result.items).toContainEqual(
    expect.objectContaining({ type: "message", role: "assistant" })
  );

  // State was updated
  expect(result.session.state.messageCount).toBe(1);
});

test("message count accumulates across requests", async () => {
  const result = await testFlow({
    flow: chatFlow,
    action: "chat",
    input: { message: "Second message" },
    userId: "testuser",
    seed: {
      session: { state: { messageCount: 3 } },
    },
    generators: {
      chat: { output: "Response" },
    },
  });

  expect(result.session.state.messageCount).toBe(4);
});
```

**Testing philosophy:** The test harness creates an isolated runtime with in-memory stores. It mocks generators by name: `generators.chat.output` replaces the real LLM call with that string. Same contracts as production: validation, session resolution, block execution, state persistence, lifecycle hooks. No flakiness from API latency or rate limits.

**Seeding state:** Use `seed.session`, `seed.user`, or `seed.project` to simulate scenarios. Here we start with `messageCount: 3` and verify the handler increments to 4. Useful for multi-turn flows, permission checks, and state-dependent behavior.

**Generator mocking:** The key in `generators` matches the block name. Our generator is named `"chat"`, so `generators.chat.output` replaces its output. For generators with tools, you can mock tool results too. See the [Testing docs](/docs/testing/testing-flows) for the full API.

---

## Next steps

- Add **[custom renderers](/docs/client/react)** to style messages, reasoning, and components
- Add **tools** to the generator for [function calling](/docs/fundamentals/blocks#generator--the-ai-block) (search, create artifacts, etc.)
- Use **[control flow patterns](/docs/sequencers/control-flow)** for conditional logic, parallelism, and error recovery
- Add **resources and clientData** for richer state. See the [kitchen-sink example](https://github.com/fixpoint-labs/flow-state-dev) for a full demonstration
