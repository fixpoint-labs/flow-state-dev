/**
 * Test fixture: a chat-shaped flow that stops for a person before it answers.
 * Used by the `fsdev chat` local store tests.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const approve = handler({
  name: "approval-ask",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input, ctx) => {
    await ctx.suspend!({ reason: "user_approval", message: `Send "${input.message}"?` });
    return { reply: `sent: ${input.message}` };
  },
});

export default defineFlow({
  kind: "approval",
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: approve,
    },
  },
})();
