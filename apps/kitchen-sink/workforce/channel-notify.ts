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
 *
 * **This slot is also where an app decides NOT to deliver.** The fan-out is
 * declared once on the kind, and a channel kind is a singleton, so every
 * channel on the built-in kind shares this one block — there is no per-channel
 * setting and a `CHANNEL.md` declares a closed list of keys that has none. What
 * a block does have is the whole of each delivery: which channel, which member
 * it is addressed to, and who wrote the post. That is enough to decline one.
 *
 * Be exact about what declining buys, because the difference matters to anyone
 * copying this: **the delivery does not happen, and the fan-out still runs.**
 * The sequencer is still dispatched once per post and still walks the roster.
 * Suppressing the dispatch itself is not something an app can do from here.
 */
import { handler } from "@flow-state-dev/core";
import { channelNotifyInputSchema, type ChannelNotifyInput } from "@flow-state-dev/workforce";
import { z } from "zod";

/** One notification per declared member per post — except back to the writer. */
export const notifyMember = handler({
  name: "kitchen-sink-notify-member",
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({ notified: z.string() }),
  execute: (input: ChannelNotifyInput, ctx) => {
    // Nobody is told about their own post. The fan-out addresses every declared
    // member, the writer included, and waking somebody to tell them what they
    // just wrote is noise in any channel — it is simply most obvious in a
    // two-member one, where "everybody except the writer" and "the other one"
    // are the same rule.
    //
    // **Compared on `author`, and that is forced rather than preferred.**
    // `principal` is the safer-looking field and it cannot do this job:
    // `channel-flow.ts` sets it to `ctx.session.identity.userId`, which is the
    // id the channel was OPENED under — the same value for every post to a
    // channel, whoever wrote it — while `member` is a seat id from `members:`.
    // The two are different namespaces, so `member === principal` is never true
    // and suppresses nothing. Measured rather than assumed: with the comparison
    // on `principal`, the fan-out still delivered to the writer in both
    // channels that have one. `author` is the only field that names the same
    // things `members:` does.
    //
    // The trust boundary, written down rather than left to be re-derived.
    // `author` is a caller-supplied claim the channel never verifies
    // (`authorVerified: false`), so somebody who can post here can withhold ONE
    // member's notification for ONE post by writing that member's name in it.
    // What bounds it:
    //
    //   - the post block already refuses an `author` who is not a declared
    //     member, so a claim can only ever name someone already on the roster;
    //   - it can only withhold a delivery, never forge one, and never reach a
    //     non-member;
    //   - it does not touch the transcript's server-derived `principal`, so the
    //     durable record is unaffected.
    //
    // **BP-031 does not apply.** That rule governs auth and routing decisions
    // taken from caller-controllable input. A notification skip grants no
    // access, routes nothing, and writes no durable record, so it is not one.
    //
    // The real gap is that the framework carries no verified per-member
    // identity — which is why `principal` cannot do this — and closing it means
    // changing `packages/workforce`, which is out of scope for this app. A
    // host that maps a verified principal onto a seat should compare that
    // instead.
    if (input.author !== undefined && input.member === input.author) {
      return { notified: "" };
    }

    ctx.emit.message(`[${input.channelId}] → ${input.member}: ${input.body}`, {
      transient: true,
    });
    return { notified: input.member };
  },
});

export default notifyMember;
