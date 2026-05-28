/**
 * `chatPost` — handler block that posts a message to the originating
 * chat thread. Compose with `.tap()` per BP-012 since the block
 * performs an external side effect and has no return value worth
 * threading further down the sequencer.
 *
 * Reads the inbound `Thread` from the per-request registry the adapter
 * populates on dispatch. Throws if no thread is bound to the request
 * (e.g. the block ran outside a chat-originated dispatch).
 */
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { getThreadForRequest } from "../thread-registry";

export const chatPost = handler({
  name: "chat.post",
  inputSchema: z.object({
    text: z.string().optional(),
    markdown: z.string().optional(),
  }),
  async execute(input, ctx) {
    const thread = getThreadForRequest(ctx.request.identity.id);
    if (thread === null) {
      throw new Error("chat.post: no chat thread bound to this request.");
    }
    const hasText = typeof input.text === "string" && input.text.length > 0;
    const hasMd = typeof input.markdown === "string" && input.markdown.length > 0;
    if (!hasText && !hasMd) {
      throw new Error("chat.post: requires one of `text` or `markdown`.");
    }
    if (hasMd) {
      await thread.post({ markdown: input.markdown! });
    } else {
      await thread.post(input.text!);
    }
  },
});
