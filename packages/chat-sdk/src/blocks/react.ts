/**
 * `chatReact` — handler block that adds an emoji reaction to the
 * triggering message. Reads the inbound `Message` from the per-request
 * registry. Use with `.tap()` per BP-012.
 */
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import {
  getMessageForRequest,
  getThreadForRequest,
} from "../thread-registry";

export const chatReact = handler({
  name: "chat.react",
  inputSchema: z.object({ emoji: z.string() }),
  async execute(input, ctx) {
    const message = getMessageForRequest(ctx.request.identity.id);
    const thread = getThreadForRequest(ctx.request.identity.id);
    if (message === null || thread === null) {
      throw new Error(
        "chat.react: no chat message or thread bound to this request."
      );
    }
    await thread.adapter.addReaction(message.threadId, message.id, input.emoji);
  },
});
