/**
 * The fan-out slot the built-in channel kind is built with.
 *
 * Here rather than under `flows/channels/`, and that is the point: this is a
 * block handed to the framework's own factory, not a channel kind of this
 * app's own. `fsdev gen` walks `flows/channels/` and would have put a file
 * there on the generated `channelKinds` map, where the binder would have read
 * it as a kind a `CHANNEL.md` can name in its `flow:` line. The top level of
 * `workforce/` is not walked, so a block that belongs to the built-in lives
 * here and stays off that map.
 *
 * Deliberately the simplest thing that is still real: one message item per
 * declared member per post, so the fan-out is visible in the stream without a
 * model or an external address book. A real app puts a dispatcher here,
 * pointed at each recipient kind it declares.
 */
import { handler } from "@flow-state-dev/core";
import { channelNotifyInputSchema, type ChannelNotifyInput } from "@flow-state-dev/workforce";
import { z } from "zod";

/** One notification per declared member per post. */
export const notifyMember = handler({
  name: "kitchen-sink-notify-member",
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({ notified: z.string() }),
  execute: (input: ChannelNotifyInput, ctx) => {
    ctx.emit.message(`[${input.channelId}] → ${input.member}: ${input.body}`, {
      transient: true,
    });
    return { notified: input.member };
  },
});

export default notifyMember;
