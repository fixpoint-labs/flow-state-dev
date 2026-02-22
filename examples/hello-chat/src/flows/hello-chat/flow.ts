/**
 * Hello Chat Flow
 *
 * The minimal @flow-state-dev example: a single-action chat flow that sends
 * user messages to an LLM and tracks how many messages have been exchanged
 * in session state.
 *
 * This is a good starting point for understanding the framework's core
 * concepts before moving on to the kitchen-sink example:
 *   - generator() — wraps an LLM call with structured input/output schemas
 *   - handler()   — synchronous logic (here: incrementing a counter)
 *   - sequencer() — composes blocks into a linear pipeline
 *   - defineFlow() — ties actions, state, and scopes into a registerable flow
 *   - Partial state schemas — blocks declare only the state fields they use
 *   - Output channels — clientOutput and llmOutput control per-audience visibility
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const MODEL_ID = "gpt-4o-mini";

export const chatInputSchema = z.object({
  message: z.string().min(1)
});

export const chatOutputSchema = z.object({
  reply: z.string(),
  model: z.string()
});

// Flow-level session state schema. In this simple flow there's only one field,
// but the pattern is the same as in larger flows: each block declares a partial
// slice, and the flow-level schema is the full picture.
export const sessionStateSchema = z.object({
  messageCount: z.number().default(0)
});

// Generator block: sends the user's message to an LLM and parses the response
// into a structured output (reply + model name).
//
// Output channels:
//   clientOutput — what gets streamed to the client (just the reply text)
//   llmOutput    — what gets appended to conversation history for the LLM
const chatGenerator = generator({
  name: "chat-generator",
  model: MODEL_ID,
  prompt: "You are a helpful, concise assistant.",
  inputSchema: chatInputSchema,
  user: (input) => input.message,
  outputSchema: chatOutputSchema,
  clientOutput: (output) => ({ reply: output.reply }),
  llmOutput: (output) => output.reply
});

// Handler block: increments the message counter after each exchange.
// Declares a partial sessionStateSchema with only { messageCount } — it doesn't
// need to know about any other session state fields that might exist at the
// flow level. This keeps the block reusable and self-documenting about its
// state dependencies.
const incrementMessageCount = handler({
  name: "increment-message-count",
  inputSchema: chatOutputSchema,
  outputSchema: chatOutputSchema,
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    // ctx.session.state.messageCount is typed as `number` thanks to the
    // sessionStateSchema above — no Number() cast needed.
    const count = ctx.session?.state.messageCount ?? 0;
    await ctx.session?.patchState({ messageCount: count + 1 });
    return input;
  },
  // This block is invisible to both the client and the LLM — it's purely
  // internal bookkeeping.
  llmOutput: false,
  clientOutput: false
});

// Pipeline: generator → counter. The sequencer pipes the generator's
// structured output directly into the handler's input.
const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema: chatInputSchema })
  .then(chatGenerator)
  .then(incrementMessageCount);

// Flow definition: one action ("chat"), session-scoped state, no resources
// or projections. requireSession/requireUser mean the server will ensure
// scope handles exist before any block executes.
const helloChatFlow = defineFlow({
  kind: "hello-chat",
  requireSession: true,
  requireUser: true,
  actions: {
    chat: {
      inputSchema: chatInputSchema,
      block: chatPipeline
    }
  },
  session: {
    stateSchema: sessionStateSchema
  }
});

const flow = helloChatFlow({ id: "default" });

export default flow;
