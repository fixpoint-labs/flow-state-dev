/**
 * ChannelFlow — the one channel kind the framework ships.
 *
 * The identity rule this whole module is built around: **one kind is one
 * instance, and one channel is one named session on it.** The flow declares
 * `cardinality: "singleton"`, so the registry admits exactly one instance and
 * its address is the kind (`flow.id === flow.kind`). A hundred channels are a
 * hundred sessions on that one instance; what differs per channel — its
 * members, its charter and its transcript — lives in that session's own state,
 * which is the framework's existing home for durable per-session facts.
 *
 * A factory rather than a bare flow because a block cannot ride in a
 * zod-parsed config bag, and `options.notify` is a block. `channelFlow` is the
 * built-in the binder seeds.
 *
 * What the transcript can prove, said once here so no reader has to infer it: a
 * session is bound to ONE user, so the server-derived `principal` on every line
 * of a given channel is the SAME value. The `author` label is caller-supplied,
 * stored with `authorVerified: false`, and is the only thing distinguishing
 * participants. The members check on `author` is a validity check against the
 * declared roster, not authentication.
 */

import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";

/** The built-in kind's name, and so the built-in instance's address. */
export const CHANNEL_KIND = "channel";

/** One line of a channel's transcript. Append-only; never rewritten. */
export const channelTranscriptLineSchema = z.object({
  /** Stable per-line id, minted at append. */
  id: z.string(),
  /** Epoch milliseconds at append. */
  at: z.number(),
  /**
   * The server-derived identity the post ran under. Constant for a given
   * channel — see the module header. Never caller-supplied.
   */
  principal: z.string(),
  /** The poster's claim about which seat wrote the line. Unverified. */
  author: z.string().optional(),
  /**
   * Always `false` in this floor. Spelled out rather than omitted so a reader
   * of a stored line cannot mistake the `author` field for a proven one.
   */
  authorVerified: z.literal(false),
  body: z.string()
});

export type ChannelTranscriptLine = z.infer<typeof channelTranscriptLineSchema>;

/**
 * The session state every channel on one instance shares.
 *
 * `members` and `instructions` are REQUIRED, and that is load-bearing rather
 * than incidental: a session the action path created (which writes empty state
 * and applies no schema defaults) carries neither, and that absence is exactly
 * what `channel-not-bound` tests. Giving either a `.default()` would make every
 * unbound session look like an empty channel.
 *
 * State and not metadata, deliberately: `SessionRecord.metadata`, `topic` and
 * `coordinate` carry no authority by declared contract, and `members` is read
 * on a refusal path.
 */
export const channelSessionStateSchema = z.object({
  /** The declared roster. Written once at open; read-only on the post path. */
  members: z.array(z.string()),
  /** The channel's charter — the `CHANNEL.md` body. */
  instructions: z.string(),
  transcript: z.array(channelTranscriptLineSchema).default([])
});

export type ChannelSessionState = z.infer<typeof channelSessionStateSchema>;

/** What a caller may put in a post. Closed: a caller has nowhere to put a `principal`. */
export const channelPostInputSchema = z
  .object({
    body: z.string().min(1),
    /** Optional, unverified claim about which seat is posting. */
    author: z.string().optional()
  })
  .strict();

export type ChannelPostInput = z.infer<typeof channelPostInputSchema>;

/** What `read` projects: the channel, not the session's machinery. */
export const channelReadOutputSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  members: z.array(z.string()),
  transcript: z.array(channelTranscriptLineSchema)
});

export type ChannelReadOutput = z.infer<typeof channelReadOutputSchema>;

/** Why a post was refused. Both are per-request refusals; the transcript is untouched. */
export type ChannelRefusalReason = "channel-not-bound" | "author-not-a-member";

/**
 * A post refused on the channel's own terms, as opposed to by the substrate.
 *
 * Carries `reason` so a caller can branch without matching on message text —
 * the same shape the dispatch seam's refusals use.
 */
export class ChannelPostRefusedError extends Error {
  readonly reason: ChannelRefusalReason;

  constructor(reason: ChannelRefusalReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "ChannelPostRefusedError";
    this.reason = reason;
  }
}

/**
 * Is this session a bound channel, or merely a session that exists?
 *
 * The shared instance answers for EVERY session id, and the action path is
 * create-or-get, so a caller naming an unused id gets a new, empty session on
 * the channel instance rather than a refusal. Boundness — not existence — is
 * therefore the test: `openChannels` writes `members` and `instructions`
 * together, and nothing else does.
 *
 * Exported for the binder, which answers a 409 on this same question — is a
 * channel open here, or merely a session? One definition, because a binder
 * that adopted on a different test than the fence refuses on would bind
 * sessions the fence still rejects. Not re-exported from the package root.
 */
export function boundChannel(
  state: Readonly<Record<string, unknown>>
): ChannelSessionState | undefined {
  if (!Array.isArray(state.members) || typeof state.instructions !== "string") return undefined;
  return {
    members: state.members as string[],
    instructions: state.instructions,
    transcript: Array.isArray(state.transcript) ? (state.transcript as ChannelTranscriptLine[]) : []
  };
}

/** The append: the whole of what the post entry's queue hold covers. */
const appendPost = handler({
  name: "channel-append-post",
  inputSchema: channelPostInputSchema,
  outputSchema: channelTranscriptLineSchema,
  execute: async (input: ChannelPostInput, ctx): Promise<ChannelTranscriptLine> => {
    const channel = boundChannel(ctx.session.state);
    if (channel === undefined) {
      throw new ChannelPostRefusedError(
        "channel-not-bound",
        `session "${ctx.session.identity.id}" is not an open channel. A channel's session is ` +
          `opened by \`openChannels\`; naming an id nobody opened creates an empty session, not a channel.`
      );
    }

    // A validity check against the declared roster, NOT authentication. The
    // claim stays unverified either way; this only stops a line naming a seat
    // the channel has never heard of.
    if (input.author !== undefined && !channel.members.includes(input.author)) {
      throw new ChannelPostRefusedError(
        "author-not-a-member",
        `"${input.author}" is not a member of channel "${ctx.session.identity.id}". ` +
          `Members: ${channel.members.length > 0 ? channel.members.join(", ") : "(none)"}.`
      );
    }

    const line: ChannelTranscriptLine = {
      id: crypto.randomUUID(),
      at: Date.now(),
      // The server's value. BP-031: never the caller's, and the input schema is
      // closed so there is no caller value to take.
      principal: ctx.session.identity.userId ?? ctx.session.identity.id,
      ...(input.author === undefined ? {} : { author: input.author }),
      authorVerified: false as const,
      body: input.body
    };

    // Commutative, so two appends that raced never clobber one another and this
    // floor needs no compare-and-swap.
    await ctx.session.pushState("transcript", line);
    return line;
  }
});

/** The clean projection. Deliberately not `ctx.session.items.client()`. */
const readChannel = handler({
  name: "channel-read",
  inputSchema: z.object({}).strict(),
  outputSchema: channelReadOutputSchema,
  execute: async (_input, ctx): Promise<ChannelReadOutput> => {
    const channel = boundChannel(ctx.session.state);
    if (channel === undefined) {
      throw new ChannelPostRefusedError(
        "channel-not-bound",
        `session "${ctx.session.identity.id}" is not an open channel.`
      );
    }
    return {
      id: ctx.session.identity.id,
      ...(ctx.session.metadata.description === undefined
        ? {}
        : { description: ctx.session.metadata.description }),
      members: channel.members,
      transcript: channel.transcript
    };
  }
});

/** What the fan-out entry is handed: enough to say which post is being delivered. */
const channelFanOutInputSchema = z.object({
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional()
});

export type ChannelFanOutInput = z.infer<typeof channelFanOutInputSchema>;

/** What a notify block is handed, once per declared member per post. */
export const channelNotifyInputSchema = z.object({
  /** The channel's session id. */
  channelId: z.string(),
  /** The declared member this delivery is addressed to. */
  member: z.string(),
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional()
});

export type ChannelNotifyInput = z.infer<typeof channelNotifyInputSchema>;

/**
 * Record one member's delivery refusal without touching the transcript or the
 * roster.
 *
 * The journal and not session state: a delivery outcome is not a channel fact,
 * and widening the declared state shape to hold one would put it in every
 * channel's schema forever. Pruning a member whose deliveries fail is roster
 * behaviour and is out of this floor.
 */
const recordDeliveryRefusal = handler({
  name: "channel-record-delivery-refusal",
  inputSchema: z.unknown(),
  outputSchema: z.object({ recorded: z.literal(true) }),
  execute: async (error: unknown, ctx) => {
    await ctx.session.appendJournal({
      text: `channel delivery refused: ${error instanceof Error ? error.message : String(error)}`,
      source: "channel-fan-out"
    });
    return { recorded: true as const };
  }
});

/**
 * Record a refused hand-off — the fan-out request could not be started at all.
 *
 * Reached on a host whose dispatcher hands work to an external queue, where a
 * delivery into an existing session refuses `external-dispatcher` by name. The
 * post is already appended and stays appended: a client post on such a host
 * still works, and only the waking does not.
 */
const recordHandOffRefusal = handler({
  name: "channel-record-hand-off-refusal",
  inputSchema: z.unknown(),
  outputSchema: z.object({ recorded: z.literal(true) }),
  execute: async (error: unknown, ctx) => {
    await ctx.session.appendJournal({
      text: `channel fan-out not started: ${error instanceof Error ? error.message : String(error)}`,
      source: "channel-post"
    });
    return { recorded: true as const };
  }
});

export interface CreateChannelFlowOptions {
  /**
   * The fan-out slot: a block run once per declared member per post, outside
   * the post's queue hold. Absent by default — a channel with no slot lands
   * posts and wakes nobody.
   *
   * The framework carries the policy and the app supplies the addresses.
   * Naming a recipient from stored data is refused by the dispatch substrate,
   * so a notify block declares its own targets; it never reads one out of the
   * members list and dispatches to it.
   */
  notify?: BlockDefinition<any, any>;
}

/**
 * Build a channel kind.
 *
 * Every kind built here carries the same identity contract the registry
 * enforces: `cardinality: "singleton"`, so `flow.id === flow.kind`. A custom
 * kind passed through `channelInstances`'s `kinds` map must carry it too.
 *
 * @param options `notify`: the per-member fan-out block, absent by default.
 * @returns The flow factory. Call it (no arguments) to mint the one instance.
 */
export function createChannelFlow(options: CreateChannelFlowOptions = {}) {
  const notify = options.notify;

  // Declared ONLY when a slot was supplied. With no slot there is nothing to
  // deliver, so there is no entry to declare and no dispatch to make — rather
  // than a declared entry that exists to do nothing.
  const fanOut =
    notify === undefined
      ? undefined
      : sequencer({
          name: "channel-fan-out",
          inputSchema: channelFanOutInputSchema
        })
          // Iterated from the session's own declared roster, read here rather
          // than carried in the payload: the roster is the channel's, and a
          // caller-supplied copy would be caller-controllable input on a
          // delivery path (BP-031).
          .forEach(
            (post: ChannelFanOutInput, ctx): ChannelNotifyInput[] => {
              const channel = boundChannel(ctx.session.state);
              return (channel?.members ?? []).map((member) => ({
                channelId: ctx.session.identity.id,
                member,
                postId: post.postId,
                body: post.body,
                principal: post.principal,
                ...(post.author === undefined ? {} : { author: post.author })
              }));
            },
            // One member's failure is recorded and the rest are still
            // attempted; membership is never changed by a delivery.
            notify.rescue([{ block: recordDeliveryRefusal }])
          );

  // Hands the append off to a SEPARATE request so the queue hold covers the
  // append only. Fan-out latency must not count against the next poster's
  // 30s queue-wait budget — past it the waiting post is dropped, never written.
  const handOff =
    fanOut === undefined
      ? undefined
      : dispatcher({
          name: "channel-hand-off",
          action: "onPosted",
          inputSchema: channelFanOutInputSchema,
          // The channel's own session. `{ id }`, never `{ key }`: a key-derived
          // child id is hashed with the parent session and lineage, so it
          // cannot name a shared channel.
          session: { id: (_input, ctx) => ctx.session.identity.id }
        }).rescue([{ block: recordHandOffRefusal }]);

  const post =
    handOff === undefined
      ? appendPost
      : sequencer({
          name: "channel-post",
          inputSchema: channelPostInputSchema,
          outputSchema: channelTranscriptLineSchema
        })
          .step(appendPost)
          // A tap: the post's own output stays the appended line, and the
          // hand-off's refusal is rescued rather than rolled back. The
          // transcript is the durable record; delivery is best-effort.
          .tap(
            (line: ChannelTranscriptLine): ChannelFanOutInput => ({
              postId: line.id,
              body: line.body,
              principal: line.principal,
              ...(line.author === undefined ? {} : { author: line.author })
            }),
            handOff
          );

  return defineFlow({
    kind: CHANNEL_KIND,
    // Not a preference: it is the declared mechanism for "one kind means one
    // thing". The registry throws `singleton-id-mismatch` unless id === kind.
    cardinality: "singleton",
    session: { stateSchema: channelSessionStateSchema },
    actions: {
      post: {
        block: post,
        description:
          "Post a line to this channel. The channel is the session; `author` is an unverified claim.",
        // Keyed on the session by default, so two posts on ONE channel
        // serialise and posts on two channels never contend.
        concurrency: "queue"
      },
      read: {
        block: readChannel,
        description: "Read this channel's transcript, members and description."
      }
    },
    internal: {
      actions: {
        // The same blocks a client reaches, so another flow's dispatch lands on
        // one implementation rather than a second spelling of it.
        post: { block: post, concurrency: "queue" },
        read: { block: readChannel },
        ...(fanOut === undefined
          ? {}
          : {
              // `allow`, deliberately: this is the work that must NOT sit
              // behind the post queue.
              onPosted: { block: fanOut, concurrency: "allow" as const }
            })
      }
    }
  });
}

/**
 * The built-in kind, seeded by `channelInstances` when the app names none.
 *
 * An app registers nothing to use channels. A custom kind is the rare escape
 * hatch, passed through the `kinds` map at boot.
 */
export const channelFlow = createChannelFlow();
