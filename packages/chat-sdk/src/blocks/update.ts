/**
 * `chatUpdate` — handler block that edits a previously-sent message.
 * Callers pass the `SentMessage` returned from a prior post (commonly
 * surfaced by the auto-stream bridge or a `chatPost` block whose output
 * was captured). Use with `.tap()` per BP-012.
 */
import { z } from "zod";
import { handler } from "@flow-state-dev/core";

interface EditableSentMessage {
  edit: (
    body: { text?: string; markdown?: string } | string
  ) => Promise<unknown>;
}

function isEditable(value: unknown): value is EditableSentMessage {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { edit?: unknown }).edit === "function"
  );
}

export const chatUpdate = handler({
  name: "chat.update",
  inputSchema: z.object({
    messageRef: z.any(),
    text: z.string().optional(),
    markdown: z.string().optional(),
  }),
  async execute(input) {
    if (!isEditable(input.messageRef)) {
      throw new Error(
        "chat.update: `messageRef` must be a SentMessage returned from thread.post."
      );
    }
    const hasMd = typeof input.markdown === "string" && input.markdown.length > 0;
    const hasText = typeof input.text === "string" && input.text.length > 0;
    if (!hasMd && !hasText) {
      throw new Error("chat.update: requires one of `text` or `markdown`.");
    }
    if (hasMd) {
      await input.messageRef.edit({ markdown: input.markdown });
    } else {
      await input.messageRef.edit(input.text!);
    }
  },
});
