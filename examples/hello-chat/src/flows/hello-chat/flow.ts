/**
 * Hello Chat Flow
 *
 * The minimal @flow-state-dev example: a single-action chat flow that sends
 * user messages to an LLM and streams the response back token-by-token.
 *
 * This is a good starting point for understanding the framework's core
 * concepts before moving on to the kitchen-sink example:
 *   - generator() — wraps an LLM call (defaults to z.string() text output)
 *   - handler()   — synchronous logic (here: incrementing a counter)
 *   - sequencer() — composes blocks into a linear pipeline
 *   - defineFlow() — ties actions, state, and scopes into a registerable flow
 *   - Partial state schemas — blocks declare only the state fields they use
 *   - userMessage — emits a user-role MessageItem in the conversation stream
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const MODEL_ID = "openai/gpt-5-mini";

export const chatInputSchema = z.object({
  message: z.string().min(1)
});

// Flow-level session state schema. In this simple flow there's only one field,
// but the pattern is the same as in larger flows: each block declares a partial
// slice, and the flow-level schema is the full picture.
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
  history: (_input, ctx) => ctx.session.items.history(),
  user: (input) => input.message,
  emit: {
    reasoning: true
  },
  providerOptions: {
    openai: {
      reasoningSummary: "detailed"
    }
  }
});

// Handler block: increments the message counter after each exchange.
// Declares a partial sessionStateSchema with only { messageCount } — it doesn't
// need to know about any other session state fields that might exist at the
// flow level. This keeps the block reusable and self-documenting about its
// state dependencies.
const incrementMessageCount = handler({
  name: "increment-message-count",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    const count = ctx.session.state.messageCount ?? 0;
    await ctx.session.patchState({ messageCount: count + 1 });
    return input;
  },
});

// Pipeline: generator → counter. The sequencer pipes the generator's
// text output directly into the handler's input.
const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema: chatInputSchema })
  .then(chatGenerator)
  .then(incrementMessageCount);

// Flow definition: one action ("chat"), session-scoped state.
// userMessage extracts the display text from the action input so the
// framework emits a user-role MessageItem in the conversation stream.
const helloChatFlow = defineFlow({
  kind: "hello-chat",
  requireUser: true,
  actions: {
    chat: {
      inputSchema: chatInputSchema,
      block: chatPipeline,
      userMessage: (input: z.infer<typeof chatInputSchema>) => input.message
    }
  },
  session: {
    stateSchema: sessionStateSchema
  }
});

const flow = helloChatFlow({ id: "default" });

export default flow;
