/**
 * Test fixture: a generator asking for `intent/chat`, found by directory
 * discovery under `src/flows/`. No `fsdev.config.*` sits beside it.
 */
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const chat = generator({
  name: "chat",
  model: "intent/chat",
  prompt: "You are a helpful assistant.",
  inputSchema,
  user: (input) => input.message,
});

export default defineFlow({
  kind: "intent-chat",
  actions: {
    chat: { inputSchema, block: chat },
  },
})();
