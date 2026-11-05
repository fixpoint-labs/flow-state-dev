/**
 * Test fixture: the quick start's flow shape — a generator asking for
 * `intent/chat`, found by directory discovery under `src/flows/`. The
 * fixture has no `fsdev.config.*`, so nothing declares the intent; its
 * `lib/flowstate.ts` stands for the file an adopter put the runtime in.
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
