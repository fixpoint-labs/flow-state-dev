import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const MODEL_ID = "openai/gpt-5.4-mini";

const chatInputSchema = z.object({ message: z.string().min(1) });

const sessionStateSchema = z.object({ messageCount: z.number().default(0) });

const chatGenerator = generator({
  name: "chat-generator-2",
  model: MODEL_ID,
  inputSchema: chatInputSchema,
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});

const incrementMessageCount = handler({
  name: "increment-message-count-2",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema,
  execute: async (input, ctx) => {
    const count = ctx.session.state.messageCount ?? 0;
    await ctx.session.patchState({ messageCount: count + 1 });
    return input;
  },
});

const chatPipeline = sequencer({ name: "chat-pipeline-2", inputSchema: chatInputSchema })
  .step(chatGenerator)
  .step(incrementMessageCount);

const chatbot2Flow = defineFlow({
  kind: "chatbot2",
  requireUser: true,
  actions: {
    chat: {
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: sessionStateSchema,
  },
});

export default chatbot2Flow({ id: "default" });
