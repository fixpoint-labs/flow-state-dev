import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

// A non-chat-shaped flow: its action requires a field the { message } a chat
// turn sends does not provide, so a turn against it fails validation.
const strictHandler = handler({
  name: "strict-handler",
  inputSchema: z.object({ ticket: z.string() }),
  outputSchema: z.string(),
  execute: async (input) => input.ticket,
});

const strictFlow = defineFlow({
  kind: "strict",
  actions: {
    run: {
      inputSchema: z.object({ ticket: z.string() }),
      block: strictHandler,
    },
  },
});

export default strictFlow({ id: "default" });
