/**
 * `chatTyping` — handler block that surfaces a typing indicator on the
 * originating chat thread. Adapters that don't support typing degrade
 * to no-op via the Chat SDK; this block forwards the call regardless.
 * Use with `.tap()` per BP-012.
 */
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { getThreadForRequest } from "../thread-registry";

export const chatTyping = handler({
  name: "chat.typing",
  inputSchema: z.object({ label: z.string().optional() }),
  async execute(input, ctx) {
    const thread = getThreadForRequest(ctx.request.identity.id);
    if (thread === null) {
      throw new Error("chat.typing: no chat thread bound to this request.");
    }
    await thread.startTyping(input.label);
  },
});
