/**
 * channel flow — the framework's built-in ChannelFlow, registered here so the
 * kitchen-sink hosts channels end to end.
 *
 * One kind is one instance: this registers `channel` once, and every channel is
 * a named session on it (`engineering.standup`, `engineering.triage`). The
 * per-channel facts — members, charter, transcript — live in that session's
 * state, written when the channel is opened.
 *
 * The notify slot here is deliberately the simplest thing that is still real:
 * it emits one message item per declared member per post, so a fan-out is
 * visible in the stream without a model or an external address book. A real app
 * puts a dispatcher here, pointed at each recipient kind it declares.
 */
import { handler } from "@flow-state-dev/core";
import {
  channelNotifyInputSchema,
  createChannelFlow,
  type ChannelNotifyInput,
} from "@flow-state-dev/workforce";
import { z } from "zod";

const notifyMember = handler({
  name: "kitchen-sink-notify-member",
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({ notified: z.string() }),
  execute: (input: ChannelNotifyInput, ctx) => {
    ctx.emit.message(
      `[${input.channelId}] → ${input.member}: ${input.body}`,
      { transient: true },
    );
    return { notified: input.member };
  },
});

const channelFlow = createChannelFlow({ notify: notifyMember });

export default channelFlow;
