/**
 * Hello Chat Flow
 *
 * The minimal @flow-state-dev example: a single-action chat flow that sends
 * user messages to an LLM and streams the response back token-by-token.
 *
 * This is a good starting point for understanding the framework's core
 * concepts before moving on to the kitchen-sink reference app:
 *   - generator() — wraps an LLM call (defaults to z.string() text output)
 *   - handler()   — synchronous logic (here: incrementing a counter)
 *   - sequencer() — composes blocks into a linear pipeline
 *   - defineFlow() — ties actions, state, and scopes into a registerable flow
 *   - Scope state schemas — blocks get typed access to session state
 *   - userMessage — emits a user-role MessageItem in the conversation stream
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const MODEL_ID = "openai/gpt-6-luna";

export const chatInputSchema = z.object({
  message: z.string().min(1)
});

// Shared by the counter and the flow that exposes it.
export const sessionStateSchema = z.object({
  messageCount: z.number().default(0)
});

// Generator block: sends the user's message to an LLM and returns the text.
//
// By omitting outputSchema, the generator defaults to z.string() which enables
// real-time text streaming. The framework emits assistant MessageItems
// automatically for text generators.
const chatGenerator = generator({
  name: "chat-generator",
  model: MODEL_ID,
  prompt: "You are a helpful, concise assistant.",
  inputSchema: chatInputSchema,
  // history slot: load prior conversation from persisted request items.
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
  providerOptions: {
    openai: {
      reasoningSummary: "detailed"
    }
  }
});

// Handler block: increments the message counter after each exchange.
const incrementMessageCount = handler({
  name: "increment-message-count",
  inputSchema: z.string(),
  sessionStateSchema,
  execute: async (_input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
  },
});

// Pipeline: generator → counter. `.tap()` runs the counter for its state
// change only — the generator's text stays the pipeline's output. The counter
// still emits its own block_trace; that trace just carries no output value.
const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema: chatInputSchema })
  .step(chatGenerator)
  .tap(incrementMessageCount);

// Flow definition: one action ("chat"), session-scoped state.
// userMessage extracts the display text from the action input so the
// framework emits a user-role MessageItem in the conversation stream.
const helloChatFlow = defineFlow({
  kind: "hello-chat",
  requireUser: true,
  actions: {
    chat: {
      block: chatPipeline,
      userMessage: (input) => input.message
    }
  },
  session: {
    stateSchema: sessionStateSchema,
    client: { expose: ["messageCount"] }
  }
});

const flow = helloChatFlow();

export default flow;
