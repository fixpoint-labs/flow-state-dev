/**
 * A channel kind of this app's own, declared by living in
 * `workforce/flows/channels/`.
 *
 * Nothing registers it. `fsdev gen` walks this folder and puts it on the
 * `channelKinds` map under its basename, `digest`, which is the name a
 * `CHANNEL.md` names in its `flow:` line. The flow's own `kind` has to agree
 * with that basename, the same way a worker kind's does.
 *
 * `cardinality: "singleton"` is the whole of a channel kind's identity
 * contract: one kind is one instance, and every channel naming it is a session
 * on that instance. A channel kind left at the default would be refused.
 *
 * **Why this one diverges, and why it is the only one here.** The framework's
 * built-in kind already covers a standup, a direct message and an announcement
 * channel — those differ by their members and their charter, not by their
 * workflow. What genuinely differs here is `read`: a standing noticeboard's
 * transcript grows without bound and nobody wants the whole of it, so this
 * kind returns the tail. That is the test for writing a kind at all.
 *
 * **It holds no board, and that is the rule rather than an omission.** Boards
 * are handed to the built-in kind at bind time, and a kind written by hand is
 * zero-arg by contract — so there is nowhere to hand it the ledgers a roster
 * minted. A `CHANNEL.md` pairing `boards:` with `flow: digest` is refused by
 * name when the roster binds.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { CHANNEL_POST_COMPONENT } from "@flow-state-dev/workforce";
import { z } from "zod";

/**
 * How many lines `read` returns. A noticeboard is read for what is current, so
 * the tail is the whole projection rather than a page of a longer list — there
 * is no cursor and no way to ask for more.
 */
const DIGEST_TAIL = 5;

/**
 * One notice. Deliberately the smallest line that is still a record: who
 * claimed to write it, when, and what it said.
 *
 * `authorVerified` is always `false` and is spelled out rather than omitted,
 * for the reason the built-in kind spells it out — a stored line must not let
 * a reader mistake the `author` claim for a proven one.
 */
const digestLineSchema = z.object({
  id: z.string(),
  at: z.number(),
  author: z.string().optional(),
  authorVerified: z.literal(false),
  body: z.string(),
});

/** One notice, as it is stored and as `read` hands it back. */
type DigestLine = z.infer<typeof digestLineSchema>;

/**
 * The session state every channel on this kind carries.
 *
 * All three keys are the ones the channel binder writes at open. A key this
 * schema does not declare is stripped on the way in and the channel comes up
 * missing it — session create does not refuse a state-schema mismatch — so the
 * three here are a contract with the binder, not a convenience.
 *
 * `members` and `instructions` are required for the reason the built-in kind
 * requires them: a session something else created carries neither, and that
 * absence is what tells an open channel from an empty session.
 *
 * `transcript` holds only the notices a channel kept in state before each post
 * became its own `channel-post` item. Nothing writes it any more; `read`
 * counts it ahead of the posted notices.
 */
const digestStateSchema = z.object({
  members: z.array(z.string()),
  instructions: z.string(),
  transcript: z.array(digestLineSchema).default([]),
});

/** What a caller may put in a notice. Closed — there is nowhere for an id. */
const digestPostInputSchema = z
  .object({
    body: z.string().min(1),
    author: z.string().optional(),
  })
  .strict();

/** What `read` projects: the newest notices, and who the channel is for. */
const digestReadOutputSchema = z.object({
  id: z.string(),
  members: z.array(z.string()),
  /** Newest first, and never more than {@link DIGEST_TAIL}. */
  notices: z.array(digestLineSchema),
  /** How many notices the channel holds in total, tail or not. */
  total: z.number(),
});

/**
 * The notices this session's posts left, oldest first: its `channel-post`
 * items inside the history window. Inside a block each item arrives wrapped,
 * so the component and its data sit under `payload`.
 */
function postedNotices(ctx: BlockContext): DigestLine[] {
  return ctx.session.items.all({ itemTypes: ["component"] }).flatMap((item) => {
    const payload = item.payload as { component?: unknown; data?: unknown } | undefined;
    if (payload?.component !== CHANNEL_POST_COMPONENT) return [];
    const line = digestLineSchema.safeParse(payload.data);
    return line.success ? [line.data] : [];
  });
}

/** Is this session state a `digest` channel somebody opened? */
function openDigest(
  state: unknown,
): { members: string[]; transcript: DigestLine[] } | undefined {
  const parsed = digestStateSchema.safeParse(state);
  return parsed.success
    ? { members: parsed.data.members, transcript: parsed.data.transcript }
    : undefined;
}

const post = handler({
  name: "digest-post",
  inputSchema: digestPostInputSchema,
  outputSchema: digestLineSchema,
  execute: async (input, ctx): Promise<DigestLine> => {
    const channel = openDigest(ctx.session.state);
    if (channel === undefined) {
      throw new Error(
        `session "${ctx.session.identity.id}" is not an open digest channel. A channel's ` +
          `session is opened by \`openChannels\`; naming an id nobody opened creates an empty ` +
          `session, not a channel.`,
      );
    }

    // A validity check against the declared roster, not authentication — the
    // claim stays unverified either way. It only stops a notice naming a seat
    // this channel has never heard of.
    if (input.author !== undefined && !channel.members.includes(input.author)) {
      throw new Error(
        `"${input.author}" is not a member of channel "${ctx.session.identity.id}".`,
      );
    }

    const line: DigestLine = {
      id: crypto.randomUUID(),
      at: Date.now(),
      ...(input.author === undefined ? {} : { author: input.author }),
      authorVerified: false as const,
      body: input.body,
    };

    // The notice is this request's own item, the same way the built-in kind
    // keeps a line, so a page shows this channel exactly as it shows any other.
    ctx.emit.component(CHANNEL_POST_COMPONENT, line);
    return line;
  },
});

const read = handler({
  name: "digest-read",
  inputSchema: z.object({}).strict(),
  outputSchema: digestReadOutputSchema,
  execute: async (_input, ctx) => {
    const channel = openDigest(ctx.session.state);
    if (channel === undefined) {
      throw new Error(`session "${ctx.session.identity.id}" is not an open digest channel.`);
    }
    // The divergence this kind exists for: the tail, newest first, never the
    // whole transcript. `total` is reported so a reader can tell a short
    // channel from a truncated one; it counts what this read can see, which
    // on a long-lived channel is the notices inside the history window.
    const notices = [...channel.transcript, ...postedNotices(ctx)];
    return {
      id: ctx.session.identity.id,
      members: channel.members,
      notices: notices.reverse().slice(0, DIGEST_TAIL),
      total: notices.length,
    };
  },
});

export default defineFlow({
  kind: "digest",
  cardinality: "singleton",
  session: { stateSchema: digestStateSchema },
  actions: {
    post: {
      block: post,
      description: "Post a notice. `author` is an unverified claim.",
      // Keyed on the session, so two notices on one channel serialise.
      concurrency: "queue",
    },
    read: {
      block: read,
      description: `Read this channel's ${DIGEST_TAIL} most recent notices, newest first.`,
    },
  },
});
