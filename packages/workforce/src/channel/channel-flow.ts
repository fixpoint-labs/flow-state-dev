/**
 * ChannelFlow — the one channel kind the framework ships.
 *
 * The identity rule this whole module is built around: **one kind is one
 * instance, and one channel is one named session on it.** The flow declares
 * `cardinality: "singleton"`, so the registry admits exactly one instance and
 * its address is the kind (`flow.id === flow.kind`). A hundred channels are a
 * hundred sessions on that one instance; what differs per channel — its
 * members and its charter — lives in that session's own state, which is the
 * framework's existing home for durable per-session facts. Its transcript is
 * its posts: each post leaves one `channel-post` item on its own request, and
 * `read` rebuilds the transcript from those items.
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
 *
 * The same kind also serves a project's talk sessions: a session whose state
 * names a project (`resourceId`) is a person's way into that project's room,
 * and `post`, `read` and `answer` on it go to the room instead
 * (`../projects/talk.ts` is canonical). `join` and the internal `bind` exist
 * for them alone.
 */

import { defineFlow, dispatcher, handler, router, sequencer } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { ActionConfig, BlockContext, BlockDefinition, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { taskToolActions, taskToolSuffix } from "@flow-state-dev/orchestration";
import { taskSchema } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import {
  channelBoardId,
  channelBoardLedger,
  channelBoardNamesFor,
  resolveChannelBoard
} from "./channel-board";
import { emitChannelPostLine, readChannelPostLines } from "./channel-items";
import { incarnationOfRow } from "../roster/incarnation";
import { INVENTORY_RACE_ATTEMPTS, isWriteConflict } from "../roster/remove";
import {
  CHANNEL_POST_COMPONENT,
  channelTranscriptLineSchema,
  withoutRepeats,
  type ChannelTranscriptLine
} from "./channel-post-line";
import {
  keepLine,
  postCaseSchema,
  RECENT_LINES,
  ROUTE_BLOCK,
  ROUTE_LEDGER_STATE,
  routeLedgerStateSchema,
  routeRequestSchema,
  type ChannelRoute,
  type ChannelRouting,
  type PostCase,
  type RouteDecision
} from "./channel-route";
import {
  defineChannelInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipKey,
  seatInventoryRowSchema
} from "../inventory/collections";
import { roomLineKey, roomLineSchema, type RoomLine } from "../projects/collections";
import {
  recentTalkLines,
  recordTalkDelivery,
  TALK_RESOURCES,
  talkAnswer,
  talkBind,
  talkJoin,
  talkPost,
  talkProjectOf,
  talkReadFor,
  talkReadOutputSchema
} from "../projects/talk";
import type { TalkTemplateFacts } from "../projects/talk-template";
import type { SeatInventoryRow } from "../inventory/collections";

/** The built-in kind's name, and so the built-in instance's address. */
export const CHANNEL_KIND = "channel";

export { CHANNEL_POST_COMPONENT, channelTranscriptLineSchema, type ChannelTranscriptLine };

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
  /**
   * Lines a channel kept in state before each post became its own
   * `channel-post` item. Read-only: `read` returns them ahead of the posted
   * lines, and nothing writes here any more.
   */
  transcript: z.array(channelTranscriptLineSchema).default([]),
  /**
   * The project a talk session is about (`../projects/talk.ts`), or `null`. A
   * declared channel never sets it. It selects which project row a talk entry
   * checks, and grants nothing on its own. Nullable with a `null` default
   * (BP-023, BP-030), so a channel opened before it existed still parses.
   */
  resourceId: z.string().nullable().default(null)
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

/**
 * The internal action a seat's answer to a routed post goes through: the
 * built-in agent kind's landing and its post tool send a routed turn's answer
 * here, not to `post`. Declared only on a kind built with a route and a
 * notify slot, the only kind that routes a post.
 */
export const CHANNEL_ANSWER_ACTION = "answer";

/**
 * What an answer carries: the post it answers, the words, and the seat.
 * Closed, and never caller-addressed: a caller who could name a post could
 * take its one answer.
 */
export const channelAnswerInputSchema = z
  .object({
    postId: z.string().min(1),
    body: z.string().min(1),
    author: z.string().min(1),
    /**
     * The delivery's `answerToken`, handed back. Required on a project's talk
     * session, where the answer's author is the seat the token was issued to;
     * a declared channel ignores it.
     */
    token: z.string().min(1).optional()
  })
  .strict();

type ChannelAnswerInput = z.infer<typeof channelAnswerInputSchema>;

/**
 * The channel-session field recording the routed posts that have their
 * answer: the post's id, and the id of the line that answered it. Never
 * trimmed, so a post delivered again however late lands no second answer. It
 * grows by one entry per routed answer, beside the lines the channel keeps.
 */
const ANSWERED_POSTS_STATE = "channelAnsweredPosts";

/** A routed kind's channel state, as far as its appends go: the route ledger and the answered posts. */
const routedChannelStateSchema = routeLedgerStateSchema.extend({
  [ANSWERED_POSTS_STATE]: z.record(z.string(), z.string()).optional()
});

type RoutedChannelState = z.infer<typeof routedChannelStateSchema>;

/** What `read` projects: the channel, not the session's machinery. */
export const channelReadOutputSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  members: z.array(z.string()),
  /**
   * The board NAMES this channel declared — never the rows, which are a board
   * read. **Absent, not `[]`, on a channel that declares none**, so a channel
   * without boards projects exactly what it projected before boards existed.
   */
  boards: z.array(z.string()).optional(),
  transcript: z.array(channelTranscriptLineSchema)
});

export type ChannelReadOutput = z.infer<typeof channelReadOutputSchema>;

/**
 * Why a call on a channel was refused. Every one is a per-request refusal that
 * leaves the transcript — and the ledger — untouched.
 *
 * `board-not-declared` is the file path's own: a caller naming a board this
 * channel's `CHANNEL.md` did not declare. It is never another channel's board
 * being reached and refused, because the ledger id is minted from the
 * session's own identity and a name can only ever address this channel's.
 *
 * `board-needs-an-org` is the one a channel opened without an `orgId` meets.
 * A board is org-scoped storage, so there is no scope to read or write in and
 * the refusal says that rather than letting the resource registry report the
 * board as unregistered, which sends an author to check a registration that is
 * fine. Same shape as an org-scoped document read in an org-less channel.
 */
export type ChannelRefusalReason =
  | "channel-not-bound"
  | "author-not-a-member"
  | "board-not-declared"
  | "board-needs-an-org";

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
 * Answered against the WHOLE declared schema rather than by checking that the
 * two keys are present. A presence check calls `{ members: [42], instructions:
 * "x" }` a channel: the post path would admit it, `openChannels` would skip it
 * as already open, and it would fail its declared schemas on every later
 * read — bound to nothing, and repairable by nothing. A state the schema
 * cannot parse is not a channel.
 *
 * Exported for the binder, which asks this same question of a 409 — is a
 * channel open here, or merely a session? One definition, because a binder
 * reading boundness differently from the fence would leave sessions the fence
 * still rejects. What the binder then DOES with the answer is its own and
 * narrower: it releases an id only when this kind's own empty session holds it.
 * Not re-exported from the package root.
 */
export function boundChannel(
  state: Readonly<Record<string, unknown>>
): ChannelSessionState | undefined {
  const parsed = channelSessionStateSchema.safeParse(state);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The line a post makes, or the channel's refusal. Writes nothing: each append
 * keeps the line itself.
 */
function lineFor(input: ChannelPostInput, ctx: BlockContext): ChannelTranscriptLine {
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

  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    // The server's value. BP-031: never the caller's, and the input schema is
    // closed so there is no caller value to take.
    principal: ctx.session.identity.userId ?? ctx.session.identity.id,
    ...(input.author === undefined ? {} : { author: input.author }),
    authorVerified: false as const,
    body: input.body
  };
}

/** The append: the whole of what the post entry's queue hold covers. */
const appendPost = handler({
  name: "channel-append-post",
  inputSchema: channelPostInputSchema,
  outputSchema: channelTranscriptLineSchema,
  sessionStateSchema: routeLedgerStateSchema,
  execute: async (input: ChannelPostInput, ctx): Promise<ChannelTranscriptLine> => {
    const line = lineFor(input, ctx);
    // A route ledger left by a kind built with a route would miss this line,
    // and every line after it, so it goes before the line is kept. Once: the
    // next post finds none, and posts on a channel that never had one write
    // nothing.
    if (ctx.session.state[ROUTE_LEDGER_STATE] !== undefined) {
      await ctx.session.atomicState(() => ({ [ROUTE_LEDGER_STATE]: undefined }));
    }
    // The line is this request's own item, and that item is the record: a
    // client reads a channel by filtering its session's items to
    // `channel-post`, the way it reads any conversation. Nothing is copied into
    // state — a second record of the post could only disagree with the first.
    // A kind built with a route is the one exception, and keeps only what its
    // route reads (`appendRoutedPostFor`).
    await emitChannelPostLine(ctx, line);
    return line;
  }
});

/** What a routed kind's append hands on: the line, and for a person's post on a routed channel, its case. */
const keptPostSchema = z.object({ line: channelTranscriptLineSchema, postCase: postCaseSchema.optional() });

type KeptPost = z.infer<typeof keptPostSchema>;

/**
 * Keep one line on a kind built with a route. The rule: **the channel's state
 * is written with each line, in one write just before its item, and the
 * engine keeps every item a request emits on that request's record, even when
 * the request then fails.** So the route's ledger (`channel-route.ts`) holds
 * every line the channel shows, including one whose post failed after its
 * item was emitted, and a line that could not enter the ledger is never
 * emitted. The one gap is a store that loses the request's own record too:
 * the ledger then holds a line the channel does not.
 *
 * For an answer, the same write marks its post answered, and is where a second
 * answer is refused: the mark is read and set in the one atomic write, so of
 * two answers to one post only the first to be written is emitted, and the
 * other writes nothing.
 *
 * Every line, on every channel of the kind, goes into the ledger, under the
 * post queue, so the ledger takes the channel's lines in order. Kept whether or
 * not the channel is routed, so a channel whose file drops `routing:` and later
 * restores it has every line in the ledger. A person's post while it is not
 * routed becomes the last post with no route, so it holds nothing. A kind
 * built without a route keeps no ledger, and drops one left from before
 * (`appendPost`).
 *
 * A channel's first line with no ledger starts one from the lines in the
 * request's history window, the same window `read` sees, with no post to hold
 * for. On a busy channel that window can hold fewer than 20 lines.
 *
 * @param answerPostId For an answer, the id of the post it answers.
 * @returns What was kept, with a person's post's case; `undefined` when the
 *   post `answerPostId` names has its answer already, and nothing was written.
 */
async function keepRoutedLine(
  ctx: BlockContext<Record<string, unknown>, RoutedChannelState>,
  line: ChannelTranscriptLine,
  answerPostId?: string
): Promise<{ postCase?: PostCase } | undefined> {
  const seed = ctx.session.state[ROUTE_LEDGER_STATE] ?? {
    lines: withoutRepeats([
      ...(boundChannel(ctx.session.state)?.transcript ?? []),
      ...readChannelPostLines(ctx, channelTranscriptLineSchema)
    ]).slice(-RECENT_LINES)
  };
  // The outcome comes back from the invocation that committed: `atomicState`
  // may run its mutator more than once.
  const kept = await withOutcome(
    (mutator: (state: RoutedChannelState) => RoutedChannelState) => ctx.session.atomicState(mutator),
    (state: RoutedChannelState) => {
      const answered = state[ANSWERED_POSTS_STATE] ?? {};
      if (answerPostId !== undefined && Object.hasOwn(answered, answerPostId)) return { state: {}, result: undefined };
      const next = keepLine(state[ROUTE_LEDGER_STATE] ?? seed, line);
      return {
        state: {
          [ROUTE_LEDGER_STATE]: next.ledger,
          ...(answerPostId === undefined ? {} : { [ANSWERED_POSTS_STATE]: { ...answered, [answerPostId]: line.id } })
        },
        result: next.postCase === undefined ? {} : { postCase: next.postCase }
      };
    }
  );
  if (kept !== undefined) await emitChannelPostLine(ctx, line);
  return kept;
}

/**
 * The append on a kind built with a route: the line, kept by
 * {@link keepRoutedLine}. On a channel that declares `routing:`, a person's
 * post comes out with its case.
 */
const appendRoutedPostFor = (routing: Readonly<Record<string, ChannelRouting>>) =>
  handler({
    name: "channel-append-routed-post",
    inputSchema: channelPostInputSchema,
    outputSchema: keptPostSchema,
    sessionStateSchema: routedChannelStateSchema,
    execute: async (input: ChannelPostInput, ctx): Promise<KeptPost> => {
      const line = lineFor(input, ctx);
      const postCase = (await keepRoutedLine(ctx, line))?.postCase;
      return postCase === undefined || routing[ctx.session.identity.id] === undefined ? { line } : { line, postCase };
    }
  });

/**
 * A seat's answer to a routed post: the post's one answer, or nothing (`null`)
 * when it has one. Checked like a post (`lineFor`), so a refused answer writes
 * nothing, then kept by {@link keepRoutedLine}, whose one write refuses a
 * second answer. Two deliveries of one post land one line; a hand-off refused
 * before it got here, or refused here, leaves the post to be answered again.
 */
const appendAnswer = handler({
  name: "channel-append-answer",
  inputSchema: channelAnswerInputSchema,
  outputSchema: channelTranscriptLineSchema.nullable(),
  sessionStateSchema: routedChannelStateSchema,
  execute: async ({ postId, body, author }: ChannelAnswerInput, ctx): Promise<ChannelTranscriptLine | null> => {
    const line = lineFor({ body, author }, ctx);
    return (await keepRoutedLine(ctx, line, postId)) === undefined ? null : line;
  }
});

/**
 * The clean projection. Deliberately not `ctx.session.items.client()`.
 *
 * A factory because the declared board names come from the roster the KIND was
 * built with, filtered to this session's own id — not from session state. That
 * is what makes an edited `CHANNEL.md` reach a channel that is already open:
 * the list is re-derived from the file on the next bind.
 *
 * The transcript is the lines a channel kept in state before posts became
 * items, then the posted lines, each id once. The posted half comes from the
 * session's history window (50 requests by default, and a post with a notify
 * slot uses two), so on a busy channel `read` returns the recent lines. A page
 * reads every post from the session's items instead.
 */
const readChannelFor = (boardIds: readonly string[]) =>
  handler({
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
      const boards = channelBoardNamesFor(ctx.session.identity.id, boardIds);
      return {
        id: ctx.session.identity.id,
        ...(ctx.session.metadata.description === undefined
          ? {}
          : { description: ctx.session.metadata.description }),
        members: channel.members,
        // Omitted rather than `[]` when this channel holds none — see the
        // schema. The rows never come back here either way: reading a board is
        // a board read.
        ...(boards.length === 0 ? {} : { boards }),
        transcript: withoutRepeats([...channel.transcript, ...readChannelPostLines(ctx, channelTranscriptLineSchema)])
      };
    }
  });

/** The ledger shape the two board actions use: the substrate's ref. */
type ChannelTaskLedger = Exclude<Awaited<ReturnType<typeof resolveChannelBoard>>, undefined>;

/** What filing one row takes. Closed, as the post input is. */
export const channelFileTaskInputSchema = z
  .object({
    /** The board's LOCAL name, as the `CHANNEL.md` declared it. */
    board: z.string().min(1),
    goal: z.string().min(1),
    title: z.string().min(1).optional(),
    context: z.string().optional(),
    /**
     * The board's routing key for this row. **Not a seat**: which seat it
     * reaches is the seat-side board's wiring.
     */
    assignee: z.string().min(1).optional(),
    priority: z.number().optional(),
    maxAttempts: z.number().int().min(1).optional(),
    labels: z.array(z.string()).optional(),
    input: z.unknown().optional(),
    /** Optional, unverified claim about which member is filing. */
    author: z.string().optional()
  })
  .strict();

export type ChannelFileTaskInput = z.infer<typeof channelFileTaskInputSchema>;

/** What filing one row hands back: where it landed, and which row it is. */
export const channelFileTaskOutputSchema = z.object({
  board: z.string(),
  /** The minted ledger id — the same string a seat declares. */
  boardId: z.string(),
  taskId: z.string(),
  status: z.string()
});

export type ChannelFileTaskOutput = z.infer<typeof channelFileTaskOutputSchema>;

/** What reading one board takes. */
export const channelReadBoardInputSchema = z.object({ board: z.string().min(1) }).strict();

/**
 * One row as this channel publishes it — an **allowlist**, not the task minus a
 * field.
 *
 * `readBoard` is a public action whose output reaches a model's context, so
 * **schema membership is itself a publication**. An omit-list would publish
 * every field a later revision adds to `Task` by default, and the field that
 * prompted this one (`claimedBy`, carrying a session, request and tenant id)
 * was itself added after the type existed. Naming what goes out inverts that:
 * a new field stays in until somebody decides otherwise.
 *
 * One execution coordinate goes out: `run`, the handed-off run working the
 * task (FIX-1668), so a reader can open that run. It names a session and a
 * request and grants nothing — opening either still passes the server's
 * owner check.
 *
 * Left out, and why: `claimedBy`, `leaseUntil` and `leaseDurationMs` are the
 * claim's execution coordinates — where the claim was made and how long it
 * holds, not what the work is.
 * `retryLedger`, `abandonments` and `incarnationId` are the substrate's own
 * bookkeeping. `revision`, `writeLog` and `writeLogTruncated` are write
 * provenance, answered by the substrate's own API rather than by a board read.
 * `SERVER_ONLY_TASK_FIELDS` in `change-event.ts` is canonical for the first of
 * those; this covers the one boundary the substrate's emitter does not.
 */
export const channelBoardRowSchema = taskSchema.pick({
  id: true,
  goal: true,
  title: true,
  context: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  assignee: true,
  run: true,
  deps: true,
  priority: true,
  input: true,
  output: true,
  error: true,
  feedback: true,
  labels: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true
});

/** What reading one board gives back: the rows, and nothing about the conversation. */
export const channelReadBoardOutputSchema = z.object({
  board: z.string(),
  boardId: z.string(),
  tasks: z.array(channelBoardRowSchema)
});

export type ChannelReadBoardOutput = z.infer<typeof channelReadBoardOutputSchema>;

/**
 * Resolve the ledger a caller named, against the channel's OWN declared list.
 *
 * Two fences in one place, in the order an author wants to hear them: the
 * session must be an open channel, and the name must be one this channel
 * declared. The id is then minted from `ctx.session.identity.id` — never from
 * the payload — so a caller naming a board another channel declared addresses
 * this channel's id and simply misses it (BP-031). There is no input through
 * which another channel's rows can be selected.
 *
 * The ledger is resolved ONCE per request and handed to the caller, rather than
 * re-walking the resource registry per operation for an answer that cannot
 * change inside a request.
 */
async function ledgerNamed(
  ctx: BlockContext,
  boardIds: readonly string[],
  name: string
): Promise<{ boardId: string; channel: ChannelSessionState; ledger: ChannelTaskLedger }> {
  const channel = boundChannel(ctx.session.state);
  if (channel === undefined) {
    throw new ChannelPostRefusedError(
      "channel-not-bound",
      `session "${ctx.session.identity.id}" is not an open channel. A channel's session is ` +
        `opened by \`openChannels\`; naming an id nobody opened creates an empty session, not a channel.`
    );
  }

  const channelId = ctx.session.identity.id;
  const held = channelBoardNamesFor(channelId, boardIds);
  if (!held.includes(name)) {
    throw new ChannelPostRefusedError(
      "board-not-declared",
      `channel "${channelId}" declares no board "${name}". ` +
        `Boards: ${held.length > 0 ? held.join(", ") : "(none)"}. A board is declared in the ` +
        `channel's own \`CHANNEL.md\`, and its ledger id is minted from this channel's id.`
    );
  }

  // Before resolving, because an org-less request has no org scope at all and
  // the registry would report the board as unregistered — true, but it names
  // the wrong cause. A board is org-scoped storage by construction.
  if (ctx.org === undefined) {
    throw new ChannelPostRefusedError(
      "board-needs-an-org",
      `channel "${channelId}" holds board "${name}", but this channel is open without an ` +
        `organization. A board is org-scoped storage, so there is nothing to read or write ` +
        `in. Open the channel with an \`orgId\` (or as a caller whose verified identity ` +
        `carries one) and the board resolves.`
    );
  }

  const boardId = channelBoardId(channelId, name);

  // Caught rather than tested for: the resource registry THROWS on a key it
  // does not hold, so an `undefined` check alone is a branch that never runs
  // and a message nobody ever reads. Both outcomes land here and produce the
  // same refusal.
  let ledger: ChannelTaskLedger | undefined;
  try {
    ledger = await resolveChannelBoard(ctx, boardId);
  } catch {
    ledger = undefined;
  }
  if (ledger === undefined) {
    throw new ChannelPostRefusedError(
      "board-not-declared",
      `channel "${channelId}" declares board "${name}", but its ledger is not registered on ` +
        `this flow. The channel kind is built holding every board its roster minted, so this ` +
        `means the kind was built from a different roster than the one that opened this channel.`
    );
  }
  return { boardId, channel, ledger };
}

/**
 * File one row onto a board this channel holds.
 *
 * The roster check on `author` is the **same check a post meets, in the same
 * words** — and it is a validity check against the declared roster, not
 * authentication. `author` is optional and unverified, so a caller that omits
 * it is not checked at all, on this path exactly as on the post path. Filing is
 * not members-only, and this action does not pretend it is: the per-caller
 * identity that would make it so does not exist on the channel session
 * contract.
 */
const fileTaskFor = (boardIds: readonly string[]) =>
  handler({
    name: "channel-file-task",
    inputSchema: channelFileTaskInputSchema,
    outputSchema: channelFileTaskOutputSchema,
    execute: async (input: ChannelFileTaskInput, ctx): Promise<ChannelFileTaskOutput> => {
      const { boardId, channel, ledger } = await ledgerNamed(ctx, boardIds, input.board);

      // A validity check against the declared roster, NOT authentication. The
      // claim stays unverified either way; this only stops a row naming a seat
      // the channel has never heard of.
      if (input.author !== undefined && !channel.members.includes(input.author)) {
        throw new ChannelPostRefusedError(
          "author-not-a-member",
          `"${input.author}" is not a member of channel "${ctx.session.identity.id}". ` +
            `Members: ${channel.members.length > 0 ? channel.members.join(", ") : "(none)"}.`
        );
      }

      // The row id is minted, never supplied — the same call `addTask` makes.
      // A caller-chosen id would let one caller collide with a row another
      // already filed, and the substrate reports that collision in the store's
      // own words, naming the ledger key. Neither door offers it.
      const task = await ledger.addTask({
        goal: input.goal,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.context === undefined ? {} : { context: input.context }),
        ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
        ...(input.labels === undefined ? {} : { labels: input.labels }),
        ...(input.input === undefined ? {} : { input: input.input }),
        // Carried with the same disclaimer a transcript line carries, rather
        // than dropped: a caller that supplied a label should find it again,
        // and a reader of the row must not mistake it for a proven one.
        ...(input.author === undefined
          ? {}
          : { metadata: { author: input.author, authorVerified: false } })
      });

      return { board: input.board, boardId, taskId: task.id, status: task.status };
    }
  });

/** Read one board this channel holds. */
const readBoardFor = (boardIds: readonly string[]) =>
  handler({
    name: "channel-read-board",
    inputSchema: channelReadBoardInputSchema,
    outputSchema: channelReadBoardOutputSchema,
    execute: async (
      input: z.infer<typeof channelReadBoardInputSchema>,
      ctx
    ): Promise<ChannelReadBoardOutput> => {
      const { boardId, ledger } = await ledgerNamed(ctx, boardIds, input.board);
      return {
        board: input.board,
        boardId,
        // The allowlist above is the redaction: `pick` drops `claimedBy` and
        // every other coordinate with it, and parsing also strips the handle's
        // `items()` method, so what comes back is the row rather than a live
        // handle.
        tasks: ledger.list().map((task) => channelBoardRowSchema.parse(task))
      };
    }
  });

/**
 * One board's eight task tools as actions, for a channel that declared
 * `boardActions: true` (FIX-1629).
 *
 * The same guarded verbs a seat's model holds through `channelBoardTaskTools`,
 * so a refusal is the verb's own and comes back as `{ ok: false, error }`. The
 * one thing added is the fence a channel needs and a board on its own flow
 * does not: every channel shares this flow, so `cancelTask_eng_feature_work`
 * is callable on every channel's session. The resolver refuses unless the
 * session IS the board's channel, then reaches the ledger through
 * {@link ledgerNamed} — the same checks `fileTask` and `readBoard` make —
 * before any row is read.
 */
function boardTaskActionsFor(boardIds: readonly string[], boardId: string) {
  // A board id is `<channelId>.<name>`, and a name carries no dot.
  const split = boardId.lastIndexOf(".");
  const channelId = boardId.slice(0, split);
  const name = boardId.slice(split + 1);
  return taskToolActions(boardId, async (ctx) => {
    if (ctx.session.identity.id !== channelId) {
      throw new ChannelPostRefusedError(
        "board-not-declared",
        `board "${boardId}" belongs to channel "${channelId}", and this is channel ` +
          `"${ctx.session.identity.id}". A board's task actions work only in its own channel's session.`
      );
    }
    return (await ledgerNamed(ctx, boardIds, name)).ledger;
  });
}

/**
 * What the fan-out entry is handed: enough to say which post is being
 * delivered, and for a person's post on a routed channel, its case as the
 * post kept it. Internal-only entry, so no caller writes the case.
 */
const channelFanOutInputSchema = z.object({
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional(),
  postCase: postCaseSchema.optional()
});

export type ChannelFanOutInput = z.infer<typeof channelFanOutInputSchema>;

/**
 * What a notify block is handed, once per declared member per post, or once
 * in all for a routed post.
 *
 * `routed` and `recent` are set by the channel's own fan-out and nothing else:
 * a caller's post has no field that reaches them.
 */
export const channelNotifyInputSchema = z.object({
  /** The channel's session id. */
  channelId: z.string(),
  /** The declared member this delivery is addressed to. */
  member: z.string(),
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional(),
  /**
   * `true` when the channel's route picked this member, the one member the
   * post is delivered to; and on a project's talk session, for each of the
   * template's seats, every one of which answers into the room. Absent on
   * every other delivery. A kind that hears posts decides what it does with
   * the mark; the built-in agent kind posts its reply into the channel, which
   * on a talk session is the project's room.
   */
  routed: z.boolean().optional(),
  /**
   * On a routed delivery, the channel's last lines before the post (up to
   * 20), oldest first: the ones the route read. On a talk session's delivery,
   * the room's last lines before the post, up to 20. Absent on every other
   * delivery.
   */
  recent: z.array(channelTranscriptLineSchema).optional(),
  /**
   * On a talk session's delivery, the token for this seat's answer: issued to
   * this member alone, and handed back as the answer's `token`. The answer's
   * author is the seat it was issued to. Absent on every other delivery.
   */
  answerToken: z.string().optional()
});

export type ChannelNotifyInput = z.infer<typeof channelNotifyInputSchema>;

/** The internal entry a talk post hands its fan-out to, in the poster's own talk session. */
const TALK_POSTED_ACTION = "onTalkPosted";

/** What a talk post's fan-out is handed: the line as the room stored it. Internal-only entry. */
const talkFanOutInputSchema = z.object({
  projectId: z.string(),
  seq: z.number().int(),
  body: z.string(),
  principal: z.string()
});

type TalkFanOutInput = z.infer<typeof talkFanOutInputSchema>;

/** What a rescued delivery failure carries out: the reason, and nothing durable. */
const channelRefusalNoteSchema = z.object({
  delivered: z.literal(false),
  reason: z.string()
});

/**
 * Absorb one member's delivery refusal so the remaining members are still
 * attempted, carrying the reason out as this block's own output.
 *
 * **Nothing about a channel's session is written here.** A delivery outcome
 * is not a channel fact to widen every channel's declared state with, so the
 * reason travels in this request's own item log, alongside the rest of the
 * fan-out's trace, and nowhere else. (`ctx.session.appendJournal` re-reads the
 * record and commits at its version, so it would no longer erase a post that
 * landed in between; the item log is kept because that is where the trace is.)
 */
const noteDeliveryRefusal = handler({
  name: "channel-delivery-refused",
  inputSchema: z.unknown(),
  outputSchema: channelRefusalNoteSchema,
  execute: async (error: unknown) => ({
    delivered: false as const,
    reason: `channel delivery refused: ${error instanceof Error ? error.message : String(error)}`
  })
});

/**
 * Absorb a refused hand-off — the fan-out request could not be started at all.
 *
 * Reached on a host whose dispatcher hands work to an external queue with no
 * shared lease backend, where a delivery into an existing session refuses
 * `external-dispatcher` by name. The
 * post is already appended and stays appended: a client post on such a host
 * still works, and only the waking does not.
 *
 * Writes nothing to the session for the reason {@link noteDeliveryRefusal}
 * gives. This one runs inside the post's own request, where the queue hold
 * makes a journal write look safe — but "safe because nothing else is writing
 * right now" is not a property this flow can keep true, so the rule here is the
 * flat one: a channel makes no session write that is not a state delta.
 */
const noteHandOffRefusal = handler({
  name: "channel-hand-off-refused",
  inputSchema: z.unknown(),
  outputSchema: channelRefusalNoteSchema,
  execute: async (error: unknown) => ({
    delivered: false as const,
    reason: `channel fan-out not started: ${error instanceof Error ? error.message : String(error)}`
  })
});

// ---------------------------------------------------------------------------
// The live inventory's writer half
// ---------------------------------------------------------------------------

/**
 * The action the boot binder dispatches into each open channel's OWN session,
 * so the channel writes its own row.
 *
 * **Pinned.** `openInventory` names this string, and a channel kind a caller
 * hand-rolled must declare an action under it — the same way it must declare
 * `cardinality: "singleton"`. A kind that does not is a per-channel failure the
 * binder names, never a channel silently missing from the inventory.
 */
export const INVENTORY_REGISTER_CHANNEL = "registerChannelInInventory";

/**
 * The action the boot binder dispatches ONCE, carrying the roster's seats.
 *
 * **Pinned**, for the same reason. One run for the whole roster rather than one
 * per seat: a seat holds no session, so there is no per-seat place this has to
 * land, and the rows are a straight copy of what the binder already holds.
 *
 * Lives in `internal.actions`, never the public map — its whole input is the
 * row data, with nothing to check it against. Reachable only by the binder's
 * own direct, trusted `runAction({
    orgId: DEFAULT_ORG_ID, source: "internal", ... })` call.
 */
export const INVENTORY_REGISTER_SEATS = "registerSeatsInInventory";

/**
 * The action the boot binder dispatches ONCE when the roster carries project
 * talk templates (`mintFor:`), naming their ids, so a channel row an earlier
 * boot wrote under one of those ids is retired: a template is never a channel,
 * so a row advertising it as one is wrong rather than merely old.
 *
 * **Pinned**, and internal-only like {@link INVENTORY_REGISTER_SEATS}: its whole
 * input is ids to delete, with nothing to check them against.
 */
export const INVENTORY_RETIRE_CHANNELS = "retireChannelsInInventory";

/** Nothing a caller supplies reaches the channel's row. */
const registerChannelInputSchema = z.object({}).strict();

/** What a registration reports back: the row it wrote, so a caller can read it without a second read. */
export const inventoryChannelRegisteredSchema = z.object({
  id: z.string(),
  kind: z.string(),
  members: z.array(z.string())
});

/** The roster's seats, as the binder holds them. */
const registerSeatsInputSchema = z
  .object({ seats: z.array(seatInventoryRowSchema) })
  .strict();

/** What the seat write reports: how many rows landed. */
export const inventorySeatsRegisteredSchema = z.object({ written: z.number() });

/** The ids of the roster's talk templates, whose channel rows are retired. */
const retireChannelsInputSchema = z.object({ ids: z.array(z.string().min(1)) }).strict();

/** What the retirement reports: how many channel rows it removed. */
export const inventoryChannelsRetiredSchema = z.object({ retired: z.number() });

/** The stored row is not one this boot may replace. */
class NotTheBootsRow extends Error {}

/**
 * Whether a boot's row may replace the row stored at its address.
 *
 * A runtime hire's row (`hired: true`) is replaced only by the same hire: a
 * hired row carrying the same incarnation (`null` matching only `null`, a row
 * from before incarnations). A declared seat's row is replaced only by a
 * declared row, and a boot's hired row never replaces it. A row from before
 * `hired` existed is replaced by a declared row, and by a hired one carrying
 * its incarnation.
 */
function bootMayReplace(stored: Record<string, unknown>, row: SeatInventoryRow): boolean {
  if (row.hired === true) return stored.hired !== false && incarnationOfRow(stored) === (row.incarnation ?? null);
  return stored.hired !== true;
}

/**
 * Write one seat row from a boot's roster, only where it is still the boot's
 * to write.
 *
 * The roster the boot read can be older than the store: during a rolling
 * deploy another process may have fired the seat and hired a replacement, or
 * dropped a declaration and hired the same address. So the row is created
 * only where none was there when this action read the inventory, and
 * otherwise replaced only while {@link bootMayReplace} holds. The check runs
 * inside the version-checked write, so a row another writer put there since is
 * checked again. A row removed after it was read is not written back.
 *
 * @returns whether the row landed.
 */
async function publishBootSeatRow(seats: ResourceCollectionRef, row: SeatInventoryRow): Promise<boolean> {
  for (let attempt = 0; attempt < INVENTORY_RACE_ATTEMPTS; attempt += 1) {
    const stored = await seats.getOptional(row.id);
    try {
      if (stored === undefined) {
        await seats.create(row.id, row);
        return true;
      }
      await stored.updateState((current) => {
        if (!bootMayReplace(current, row)) throw new NotTheBootsRow();
        return row;
      });
      return true;
    } catch (error) {
      if (error instanceof NotTheBootsRow) return false;
      if ((error as { code?: unknown }).code === "resource_deleted") return false;
      if (!isWriteConflict(error)) throw error;
    }
  }
  throw new Error("the row kept changing under this boot.");
}

/**
 * The two blocks that write the live inventory, built for one channel kind.
 *
 * Built per kind rather than once, because a channel row records **which kind
 * minted it** and a block cannot read its own flow's kind: `ctx.flow` is
 * narrowed to the create-time config bag and carries no name. So the kind is
 * closed over here, at the one place that also writes `kind:` onto the flow.
 *
 * Both blocks refuse an org-less request by name. The inventory is org-scoped
 * storage, so without an org there is nothing to write in — and the resource
 * registry would report the collection as unregistered, which sends a reader to
 * check a registration that is fine.
 *
 * @param kind The kind name the flow declaring these actions was built with.
 *   `defineChannelFlow` passes its own; a hand-rolled kind passes the same
 *   string it passed `defineFlow({ kind })`, and a row carrying the wrong one
 *   is that kind's bug in the same way a mismatched `cardinality` is.
 * @returns Both entries, keyed by their action name. The blocks declare the
 *   collections they touch, so installing an entry installs its collection
 *   too. **Split them across `actions` and `internal.actions` — do not spread
 *   the whole return into `actions`.** `registerSeats`'s whole input is
 *   caller-supplied row data with nothing to check it against, so a public
 *   caller could write fabricated seat rows; `registerChannel` has no such
 *   risk (empty input, derives its row from the channel's own session state),
 *   so it is the one safe to leave public. `defineChannelFlow`'s own built-in
 *   kind makes exactly this split — read it there for the mechanics.
 *
 * @example
 *   const writer = inventoryWriterActions("briefing");
 *   defineFlow({
 *     kind: "briefing",
 *     cardinality: "singleton",
 *     session: { stateSchema: briefingState },
 *     actions: { ...myActions, registerChannelInInventory: writer.registerChannelInInventory },
 *     internal: {
 *       actions: {
 *         registerSeatsInInventory: writer.registerSeatsInInventory,
 *         retireChannelsInInventory: writer.retireChannelsInInventory
 *       }
 *     }
 *   });
 */
export function inventoryWriterActions(kind: string) {
  // Fresh per call. Two collections declared from one factory share storage —
  // a collection is addressed by its pattern and scope, never by object
  // identity — so this costs nothing and keeps the declaration local to the
  // flow that installs it.
  const channels = defineChannelInventoryCollection();
  const memberships = defineMembershipIndexCollection();
  const seats = defineSeatInventoryCollection();

  const registerChannel = handler({
    name: "channel-register-in-inventory",
    inputSchema: registerChannelInputSchema,
    outputSchema: inventoryChannelRegisteredSchema,
    resources: { channels, memberships },
    execute: async (_input, ctx) => {
      const channel = boundChannel(ctx.session.state);
      if (channel === undefined) {
        throw new ChannelPostRefusedError(
          "channel-not-bound",
          `session "${ctx.session.identity.id}" is not an open channel, so there is no ` +
            `membership to publish. A channel's session is opened by \`openChannels\`, and the ` +
            `inventory binder runs after it.`
        );
      }
      if (ctx.org === undefined) {
        throw new Error(
          `channel "${ctx.session.identity.id}" cannot register in the inventory: it is open ` +
            `without an organization, and the inventory is org-scoped storage. Open the channel ` +
            `with an \`orgId\` and it registers.`
        );
      }

      const id = ctx.session.identity.id;
      // The channel's OWN session state, and nothing else. The binder carries
      // no members, deliberately: a roster's `members:` is what a file said
      // when it was last read, and an edit to it never reaches a session that
      // is already open. Copying it here would republish that file-time answer
      // under a live name.
      const members = [...channel.members];

      // Every member's key is built up front, before anything is written.
      // `membershipKey` throws on a member id that can never be one — and
      // that failure is permanent, not flaky, so it must not land after some
      // rows are already committed: a caller that retries a boot gets the
      // same throw on the same member every time, and a run that had already
      // written part of itself before hitting it would keep re-adding to a
      // half-written state instead of leaving nothing behind.
      const membershipKeys = members.map((seatId) => membershipKey(seatId, id));

      // The membership rows go FIRST, and the channel row that names them
      // goes last. Neither write is transactional with the other — a store
      // failure partway through the loop below still leaves whatever landed
      // before it — so the ordering is what stops the channel row from ever
      // claiming a member the index does not have: the row is only written
      // once every membership row it will name already exists. What it does
      // not buy: a membership row from an EARLIER successful run can still
      // outlive this run's channel row if this run's own loop fails partway
      // through. That row is stale, not contradictory, and nothing here
      // prunes stale rows in the first place (see `inventoryWriterActions`'s
      // header).
      for (let i = 0; i < members.length; i++) {
        await ctx.resources.memberships.upsert(membershipKeys[i], {
          seatId: members[i],
          channelId: id
        });
      }

      // `openedAt` is create-only, so a second boot does not restamp a channel
      // that has been open since the first one.
      await ctx.resources.channels.upsert(
        id,
        { id, kind, members },
        { openedAt: new Date().toISOString() }
      );

      return { id, kind, members };
    }
  });

  const registerSeats = handler({
    name: "inventory-register-seats",
    inputSchema: registerSeatsInputSchema,
    outputSchema: inventorySeatsRegisteredSchema,
    resources: { seats },
    execute: async (input, ctx) => {
      if (ctx.org === undefined) {
        throw new Error(
          "the seat rows cannot be written: this request carries no organization, and the " +
            "inventory is org-scoped storage. Run the seat write under the same `orgId` the " +
            "channels were opened with."
        );
      }

      const problems: string[] = [];
      let written = 0;
      for (const row of input.seats) {
        try {
          if (await publishBootSeatRow(ctx.resources.seats, row)) written += 1;
        } catch (error) {
          problems.push(
            `seat "${row.id}" — ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Every row is attempted before anything is reported: one seat the store
      // refuses is not an org with no seat inventory. The throw is what carries
      // the failure back out — a boot door hands back an action's return value
      // in a shape this package cannot read, so a `problems` field on the
      // output would reach nobody.
      if (problems.length > 0) {
        throw new Error(
          `${problems.length} of ${input.seats.length} seat rows could not be written:\n  - ` +
            problems.join("\n  - ")
        );
      }
      return { written };
    }
  });

  const retireChannels = handler({
    name: "inventory-retire-channels",
    inputSchema: retireChannelsInputSchema,
    outputSchema: inventoryChannelsRetiredSchema,
    resources: { channels, memberships },
    execute: async (input, ctx) => {
      if (ctx.org === undefined) {
        throw new Error(
          "the retired channel rows cannot be removed: this request carries no organization, and " +
            "the inventory is org-scoped storage. Run it under the same `orgId` the channels were opened with."
        );
      }
      // What to delete comes from the membership rows themselves, never from
      // the channel row's `members`: registration can leave a membership row
      // the channel row no longer lists, and the channel row may already be
      // gone. The index is keyed seat-first (`<seatId>/<channelId>`), so no
      // prefix reaches one channel's rows; the closest the store gets is one
      // listing of the index per run, kept to the retiring ids' rows before
      // anything is deleted. This runs once per boot, and only when the roster
      // carries a template.
      const retiring = new Set(input.ids);
      const stale = (await ctx.resources.memberships.list()).filter((ref) => retiring.has(ref.state.channelId));
      // Every membership row first, the channel rows last: a run that fails
      // partway leaves the channel row standing, and the next run lists and
      // finishes whatever is left either way.
      for (const ref of stale) {
        await ctx.resources.memberships.delete(membershipKey(ref.state.seatId, ref.state.channelId));
      }
      let retired = 0;
      for (const id of input.ids) {
        if ((await ctx.resources.channels.getOptional(id)) === undefined) continue;
        await ctx.resources.channels.delete(id);
        retired += 1;
      }
      return { retired };
    }
  });

  return {
    [INVENTORY_REGISTER_CHANNEL]: {
      block: registerChannel,
      description:
        "Publish this channel's row and its membership rows into the org's live inventory, " +
        "from the channel's own session state. Boot machinery: takes no input, and re-running " +
        "it writes the same rows."
    },
    [INVENTORY_REGISTER_SEATS]: {
      block: registerSeats,
      description:
        "Write the org's seat rows into the live inventory. Boot machinery, called once by " +
        "`openInventory` with the roster it was hired from."
    },
    [INVENTORY_RETIRE_CHANNELS]: {
      block: retireChannels,
      description:
        "Remove the channel rows of ids the roster now declares as project talk templates. Boot " +
        "machinery, called once by `openInventory`."
    }
  };
}

export interface DefineChannelFlowOptions {
  /**
   * The fan-out slot: a block run once per declared member per post, outside
   * the post's queue hold. Absent by default — a channel with no slot lands
   * posts and wakes nobody.
   *
   * The framework carries the policy and the app supplies the addresses.
   * Naming a recipient from stored data is refused by the dispatch substrate,
   * so a notify block declares its own targets; it never reads one out of the
   * members list and dispatches to it.
   *
   * Typed `BlockDefinition<any, any>` as every other factory in the repo types
   * a block slot (`goalSeekLoop`'s `seed`/`replanner`, `supervisor`'s
   * `worker`/`planner`): the two schema params stay open because a slot's block
   * brings its own. Core exports no block-slot type to use instead.
   */
  notify?: BlockDefinition<any, any>;

  /**
   * The MINTED ledger ids of every board this roster's channels declared —
   * `<channelId>.<boardName>`, never a local name.
   *
   * Supplied by `channelInstances` from the roster it is validating, not by an
   * app: a board is declared in a `CHANNEL.md`, and an id is minted from where
   * that file sits. Absent, this kind holds no board and carries neither board
   * action — which is exactly the shape it had before boards existed.
   *
   * One flat list for every channel on the instance, because a channel kind is
   * a singleton and its sessions are the channels: each session filters the
   * list down to its own by id, and a board id splits into its channel and its
   * name unambiguously (a board name carries no dot).
   */
  boards?: readonly string[];

  /**
   * The channels that declared `boardActions: true`, by channel id. Each of
   * their boards gets the eight task tools as actions, named
   * `<tool>_<board id with dots as underscores>`. Supplied by
   * `channelInstances` from the roster, as `boards` is, never by an app.
   *
   * Off by default, because anyone who can reach a channel can then settle
   * or reassign its rows. A channel not listed keeps exactly the actions it
   * had before.
   */
  boardActions?: readonly string[];

  /**
   * Carry the live inventory's writer half — the two actions
   * {@link inventoryWriterActions} builds, and the collections they write.
   *
   * Absent by default, and absent means absent: no collection is declared, no
   * action exists, and a channel behaves exactly as it did before the inventory
   * existed. An entry that is only there to do nothing is worse than none,
   * which is how the fan-out slot beside it works too.
   *
   * Supplied by `channelInstances({ inventory: true })` for the built-in, so an
   * app turns the inventory on at one call rather than by rebuilding the kind.
   */
  inventory?: boolean;

  /**
   * The route, from `routeByPurpose(seats, { model })`. A channel on this kind
   * that declares `routing:` sends each person's post to one member, the one
   * the route picks, instead of to every member. A channel without the line
   * fans out as before. Needs `notify`: the route picks a member, and the
   * notify block delivers to it.
   */
  route?: ChannelRoute;

  /**
   * Each routed channel's `routing:`, by channel id. Supplied by
   * `channelInstances` from the roster, as `boards` is, never by an app: it is
   * read from the files at every boot and never stored, so an edited
   * `routing:` reaches an open channel at the next boot.
   */
  routing?: Readonly<Record<string, ChannelRouting>>;

  /**
   * The talk template this kind's project talk sessions run under: the seats
   * a post in a project's room wakes, and the room's charter. Supplied by
   * `channelInstances` from the org-level default or a `CHANNEL.md` marked
   * `mintFor:`, as `boards` is, never by an app. Built onto the kind at every
   * boot and never written into a session, so an edited template reaches
   * every project's room at the next boot. Absent, a talk post wakes nobody.
   */
  template?: TalkTemplateFacts;
}

/**
 * What {@link defineChannelFlow} returns: the flow factory, plus the one thing
 * `channelInstances` needs of it.
 *
 * `withBoards` is NOT on {@link ChannelKind}, and that is the point. A kind a
 * caller wrote is zero-arg and stays zero-arg; handing board ids through the
 * public kind contract would be a permanent widen bought for no consumer that
 * exists. Instead, a kind that CAN hold boards is one this function built, and
 * a record pairing `boards:` with any other kind is refused by name at bind.
 */
export type ChannelFlowFactory = ReturnType<typeof defineFlow> & {
  /** The same kind, rebuilt holding these minted board ids. */
  withBoards: (boards: readonly string[]) => ChannelFlowFactory;
  /** The same kind, rebuilt with each routed channel's `routing:`, by channel id. */
  withRouting: (routing: Readonly<Record<string, ChannelRouting>>) => ChannelFlowFactory;
  /** The same kind, rebuilt exposing these channels' board task actions. */
  withBoardActions: (channelIds: readonly string[]) => ChannelFlowFactory;
  /** The same kind, rebuilt holding a project talk template's seats and charter. */
  withTemplate: (template: TalkTemplateFacts) => ChannelFlowFactory;
};

/** Is this channel kind one {@link defineChannelFlow} built? */
export function holdsBoards(kind: unknown): kind is ChannelFlowFactory {
  return (
    typeof kind === "function" &&
    typeof (kind as Partial<ChannelFlowFactory>).withBoards === "function"
  );
}

/** The key a kind {@link defineChannelFlow} built with a route carries that route under. */
const KIND_ROUTE = Symbol("channel-kind-route");

/**
 * The route a channel kind was built with, or `undefined` for a kind built
 * without one, or one {@link defineChannelFlow} did not build. The binder reads
 * it to check a `routing:` line. Not re-exported from the package root.
 */
export function routeOf(kind: unknown): ChannelRoute | undefined {
  return typeof kind === "function" ? (kind as { [KIND_ROUTE]?: ChannelRoute })[KIND_ROUTE] : undefined;
}

/** The key a kind {@link defineChannelFlow} built with a notify slot carries `true` under. */
const KIND_WAKES = Symbol("channel-kind-wakes");

/**
 * Was this channel kind built with a notify slot, so a post can wake anyone?
 * `false` for a kind built without one, or one {@link defineChannelFlow} did
 * not build. The binder reads it to refuse a talk template whose seats would
 * never be woken. Not re-exported from the package root.
 */
export function wakesSeats(kind: unknown): boolean {
  return typeof kind === "function" && (kind as { [KIND_WAKES]?: boolean })[KIND_WAKES] === true;
}

/**
 * Build a channel kind.
 *
 * Every kind built here carries the same identity contract the registry
 * enforces: `cardinality: "singleton"`, so `flow.id === flow.kind`. A custom
 * kind passed through `channelInstances`'s `kinds` map must carry it too.
 *
 * @param options `notify`: the per-member fan-out block, absent by default.
 *   `route`: from `routeByPurpose`, for channels that declare `routing:`.
 *   `boards`, `routing` and `boardActions`: supplied by the binder from the roster.
 * @returns The flow factory. Call it (no arguments) to mint the one instance.
 */
export function defineChannelFlow(options: DefineChannelFlowOptions = {}): ChannelFlowFactory {
  const notify = options.notify;
  const boardIds = [...(options.boards ?? [])].sort();

  // Only `routeByPurpose` makes a route, so the order a post is placed in, the
  // one-call cap and the record hold on every routed channel. The route
  // carries its block under a key only this package holds.
  const routeBlock = options.route?.[ROUTE_BLOCK];
  if (options.route !== undefined && routeBlock === undefined) {
    throw new Error("defineChannelFlow: `route` must be what routeByPurpose(seats, { model }) returned.");
  }
  if (routeBlock !== undefined && notify === undefined) {
    throw new Error(
      "defineChannelFlow: a `route` needs a `notify` block to deliver to. Pass the wake as well: " +
        "`defineChannelFlow({ notify: wakeMemberSeats(seats), route })`."
    );
  }
  const routing = options.routing ?? {};

  // One declaration object per minted id, always from the memo. Two separate
  // `defineTaskCollection` calls sharing an id share ROWS and not POLICY — the
  // handed-off assignee freeze is a WeakSet on the declaration — so the seat's
  // board and the channel's own writes must pass one value.
  const boardResources = Object.fromEntries(
    boardIds.map((id) => [id, channelBoardLedger(id)])
  );

  // Built once per kind, not per request, and only when this kind holds a
  // board: with no board there is nothing to file onto and nothing to read, so
  // there is no action rather than an action that always refuses.
  const readChannel = readChannelFor(boardIds);
  const fileTask = boardIds.length === 0 ? undefined : fileTaskFor(boardIds);
  const readBoard = boardIds.length === 0 ? undefined : readBoardFor(boardIds);

  // Only for the boards of channels that opted in. Built from the minted ids,
  // so a channel with no board, or one that did not opt in, adds nothing.
  const optedIn = new Set(options.boardActions ?? []);
  const actionBoards = boardIds.filter((id) => optedIn.has(id.slice(0, id.lastIndexOf("."))));
  // The qualifier is not injective (`eng.feature.work` and `eng_feature.work`
  // both give `eng_feature_work`), and one actions map holds every board's
  // actions. Merged, the later board's would silently replace the earlier's and
  // settle its rows on the wrong ledger. A board that did not opt in collides
  // too: its rows would be offered the opted-in board's actions under its own
  // suffix. So each opted-in board is checked against every board of the kind.
  for (const id of actionBoards) {
    const clash = boardIds.find((other) => other !== id && taskToolSuffix(other) === taskToolSuffix(id));
    if (clash !== undefined) {
      throw new Error(
        `boardActions: boards "${clash}" and "${id}" would both answer to the task actions ` +
          `\`<tool>_${taskToolSuffix(id)}\`. Rename a channel or a board.`
      );
    }
  }
  const boardTaskActions = Object.assign(
    {},
    ...actionBoards.map((id) => boardTaskActionsFor(boardIds, id))
  ) as Record<string, ActionConfig>;

  // Built on the FACTORY, never behind a `kind === "channel"` test inside the
  // block: what the inventory promises is that EVERY open channel has a row,
  // and a kind check in there would make that false for every kind but this
  // one. What decides whether the rows are written is whether the app asked.
  const inventoryActions =
    options.inventory === true ? inventoryWriterActions(CHANNEL_KIND) : undefined;

  /**
   * This channel's `routing:` fallback, when the route places this post: a
   * person's post (no `author`) to a channel that declares the line, on a kind
   * built with a route. A seat's post is never routed; it fans out as unrouted.
   */
  const fallbackFor = (post: ChannelFanOutInput, ctx: BlockContext): string | undefined =>
    routeBlock === undefined || post.author !== undefined
      ? undefined
      : routing[ctx.session.identity.id]?.fallback;

  // Iterated from the session's own declared roster, read here rather than
  // carried in the payload: the roster is the channel's, and a caller-supplied
  // copy would be caller-controllable input on a delivery path (BP-031).
  const rosterDeliveries = (post: ChannelFanOutInput, ctx: BlockContext): ChannelNotifyInput[] =>
    (boundChannel(ctx.session.state)?.members ?? []).map((member) => ({
      channelId: ctx.session.identity.id,
      member,
      postId: post.postId,
      body: post.body,
      principal: post.principal,
      ...(post.author === undefined ? {} : { author: post.author })
    }));

  /** A routed post's delivery: the one member the route picked, or none when it placed the post with nobody. */
  const routedDeliveries = ({ post, member, recent }: RouteDecision, ctx: BlockContext): ChannelNotifyInput[] =>
    member === undefined
      ? []
      : [
          {
            channelId: ctx.session.identity.id,
            member,
            postId: post.postId,
            body: post.body,
            principal: post.principal,
            routed: true,
            recent
          }
        ];

  // One member's failure is absorbed and the rest are still attempted;
  // membership is never changed by a delivery.
  const deliver = notify?.rescue([{ block: noteDeliveryRefusal }]);

  // Declared ONLY when a slot was supplied. With no slot there is nothing to
  // deliver, so there is no entry to declare and no dispatch to make — rather
  // than a declared entry that exists to do nothing.
  const fanOutHead = sequencer({ name: "channel-fan-out", inputSchema: channelFanOutInputSchema });
  const fanOut =
    deliver === undefined
      ? undefined
      : routeBlock === undefined
        ? fanOutHead.forEach(rosterDeliveries, deliver)
        : // Two arms, exhaustive by one test. A post the route places runs it
          // once, so its one evaluator call is never repeated per member, and
          // goes to that one member. Any other post fans out to the roster
          // and pays nothing for the route.
          fanOutHead
            .branch({
              routed: [
                ({ postCase, ...post }: ChannelFanOutInput, ctx: BlockContext) => ({
                  post,
                  fallback: fallbackFor(post, ctx),
                  recent: postCase?.recent ?? [],
                  ...(postCase?.holder === undefined ? {} : { holder: postCase.holder })
                }),
                (request: { fallback?: string }) => request.fallback !== undefined,
                sequencer({ name: "channel-routed-delivery", inputSchema: routeRequestSchema })
                  .step(routeBlock)
                  .map((decision: RouteDecision, ctx) => routedDeliveries(decision, ctx as BlockContext))
              ],
              roster: [
                (post: ChannelFanOutInput) => post,
                (post: ChannelFanOutInput, ctx: BlockContext) => fallbackFor(post, ctx) === undefined,
                handler({
                  name: "channel-roster-delivery",
                  inputSchema: channelFanOutInputSchema,
                  outputSchema: z.array(channelNotifyInputSchema),
                  execute: rosterDeliveries
                })
              ]
            })
            .forEach((deliveries: ChannelNotifyInput[]) => deliveries, deliver);

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
        }).rescue([{ block: noteHandOffRefusal }]);

  const fanOutOf = (line: ChannelTranscriptLine): ChannelFanOutInput => ({
    postId: line.id,
    body: line.body,
    principal: line.principal,
    ...(line.author === undefined ? {} : { author: line.author })
  });
  const postHead = sequencer({
    name: "channel-post",
    inputSchema: channelPostInputSchema,
    outputSchema: channelTranscriptLineSchema
  });

  // A tap: the post's own output stays the appended line, and the hand-off's
  // refusal is rescued rather than rolled back. The post's `channel-post` item
  // is the durable record; delivery is best-effort.
  const post =
    handOff === undefined
      ? appendPost
      : routeBlock === undefined
        ? postHead.step(appendPost).tap(fanOutOf, handOff)
        : postHead
            .step(appendRoutedPostFor(routing))
            .tap(
              ({ line, postCase }: KeptPost) => ({ ...fanOutOf(line), ...(postCase === undefined ? {} : { postCase }) }),
              handOff
            )
            .map(({ line }: KeptPost) => line);

  // A seat's answer to a routed post, on the only kind that routes one: the
  // line, handed off like any seat's line, or nothing when the post has its
  // answer already.
  const answer =
    handOff === undefined || routeBlock === undefined
      ? undefined
      : sequencer({ name: "channel-answer", inputSchema: channelAnswerInputSchema })
          .step(appendAnswer)
          .tapIf((line: ChannelTranscriptLine | null) => line !== null, fanOutOf, handOff);

  // A project's talk session is a session on this kind whose state names a
  // project (`resourceId`). `post`, `read` and `answer` keep one name each and
  // pick their path by that field: a talk session's lines go to the project's
  // room (`../projects/talk.ts`), every other session's take today's path,
  // unchanged. The field only selects; the talk path checks membership on the
  // project row before it touches the room.
  const isTalk = (ctx: { session: { state: Readonly<Record<string, unknown>> } }): boolean =>
    talkProjectOf(ctx.session.state) !== undefined;
  const anyBlock = (block: unknown) => block as BlockDefinition<any, any>;

  // A talk post wakes the template's seats, once each, under the poster: the
  // fan-out runs in the poster's own talk session, so each seat's
  // conversation is keyed per person per room. Handed off to a separate
  // request, as a channel's fan-out is, so the post queue's hold covers the
  // append only. Each delivery is routed: every seat's reply lands in the
  // room through this session's `answer`. Declared only when there is a seat
  // to wake and a notify block to wake it with.
  const templateSeats = [...(options.template?.seats ?? [])];
  const talkDeliveries = handler({
    name: "channel-talk-deliveries",
    inputSchema: talkFanOutInputSchema,
    outputSchema: z.array(channelNotifyInputSchema),
    resources: TALK_RESOURCES,
    execute: async (posted: TalkFanOutInput, ctx): Promise<ChannelNotifyInput[]> => {
      const recent = await recentTalkLines(ctx as unknown as BlockContext, posted.projectId, posted.seq);
      const postId = roomLineKey(posted.projectId, posted.seq);
      // One delivery per seat, recorded before the seat is woken: its token is
      // how the seat's answer proves which seat it speaks for.
      return Promise.all(
        templateSeats.map(async (member) => ({
          channelId: ctx.session.identity.id,
          member,
          postId,
          body: posted.body,
          principal: posted.principal,
          routed: true,
          recent,
          answerToken: await recordTalkDelivery(ctx as unknown as BlockContext, {
            projectId: posted.projectId,
            postId,
            seat: member,
            sessionId: ctx.session.identity.id
          })
        }))
      );
    }
  });
  const talkFanOut =
    deliver === undefined || templateSeats.length === 0
      ? undefined
      : sequencer({ name: "channel-talk-fan-out", inputSchema: talkFanOutInputSchema })
          .step(talkDeliveries)
          .forEach((deliveries: ChannelNotifyInput[]) => deliveries, deliver);
  const talkPostEntry =
    talkFanOut === undefined
      ? talkPost
      : sequencer({ name: "channel-talk-post", inputSchema: channelPostInputSchema, outputSchema: roomLineSchema })
          .step(talkPost)
          .tap(
            (line: RoomLine): TalkFanOutInput => ({
              projectId: line.projectId,
              seq: line.seq,
              body: line.body,
              principal: line.userId
            }),
            dispatcher({
              name: "channel-talk-hand-off",
              action: TALK_POSTED_ACTION,
              inputSchema: talkFanOutInputSchema,
              session: { id: (_input, ctx) => ctx.session.identity.id }
            }).rescue([{ block: noteHandOffRefusal }])
          );

  const postEntry = router({
    name: "channel-post-entry",
    inputSchema: channelPostInputSchema,
    outputSchema: z.union([channelTranscriptLineSchema, roomLineSchema]),
    routes: [anyBlock(post), anyBlock(talkPostEntry)],
    execute: (_input, ctx) => (isTalk(ctx) ? anyBlock(talkPostEntry) : anyBlock(post))
  });

  const talkRead = talkReadFor(options.template);

  const readInputSchema = z.object({ after: z.number().int().min(0).optional() }).strict();
  const readEntry = router({
    name: "channel-read-entry",
    inputSchema: readInputSchema,
    outputSchema: z.union([channelReadOutputSchema, talkReadOutputSchema]),
    routes: [anyBlock(readChannel), anyBlock(talkRead)],
    // A channel's read takes no cursor: it returns the recent transcript.
    execute: (input, ctx) =>
      isTalk(ctx)
        ? anyBlock(talkRead).connectInput(() => ({ after: input.after ?? 0 }))
        : anyBlock(readChannel).connectInput(() => ({}))
  });

  // On a kind without a route there is no channel answer, so a talk session's
  // is the only path; anywhere else it refuses `talk-not-bound`.
  const answerEntry =
    answer === undefined
      ? talkAnswer
      : router({
          name: "channel-answer-entry",
          inputSchema: channelAnswerInputSchema,
          outputSchema: z.union([channelTranscriptLineSchema.nullable(), roomLineSchema.nullable()]),
          routes: [anyBlock(answer), anyBlock(talkAnswer)],
          execute: (_input, ctx) => (isTalk(ctx) ? anyBlock(talkAnswer) : anyBlock(answer))
        });

  const flow = defineFlow({
    kind: CHANNEL_KIND,
    // Not a preference: it is the declared mechanism for "one kind means one
    // thing". The registry throws `singleton-id-mismatch` unless id === kind.
    cardinality: "singleton",
    session: { stateSchema: channelSessionStateSchema },
    // The ledgers, and nothing else: no board, no drain, no task entry. A
    // channel HOLDS rows; running them stays on the seat's side of the fence,
    // and `defineFlow` asks nothing of a flow that declares only a collection.
    resources: boardResources,
    actions: {
      post: {
        block: postEntry,
        description:
          "Post a line to this channel. The channel is the session; `author` is an unverified claim. " +
          "On a project's talk session, the line goes to the project's room, members only.",
        // Keyed on the session by default, so two posts on ONE channel
        // serialise and posts on two channels never contend.
        concurrency: "queue"
      },
      read: {
        block: readEntry,
        // Names boards only on a kind that holds one: this string is what a
        // model is told the action does, and a boardless kind returns no
        // `boards` key at all.
        description:
          boardIds.length === 0
            ? "Read this channel's recent transcript lines, members and description; `after` is ignored. " +
              "On a project's talk session, read the room's lines after `after`, members only."
            : "Read this channel's recent transcript lines, members, description and declared board names; " +
              "`after` is ignored. On a project's talk session, read the room's lines after `after`, members only."
      },
      join: {
        block: talkJoin,
        description:
          "Join a project's room. Members only. Returns your one talk session on the project: the one " +
          "the project already lists for you, or this session, now bound."
      },
      ...(fileTask === undefined || readBoard === undefined
        ? {}
        : {
            fileTask: {
              block: fileTask,
              description:
                "File a row onto one of this channel's boards. `author` is an unverified claim, " +
                "checked against the roster and never proof of who called."
            },
            readBoard: {
              block: readBoard,
              description: "Read the rows on one of this channel's boards."
            }
          }),
      ...boardTaskActions,
      // `registerChannel` only. It takes a closed, empty input and derives the
      // row entirely from `ctx.session.state` — the channel's own,
      // already-open state — so a caller cannot make it write anything but
      // that channel's true members, and calling it early or twice is
      // harmless. Public because the door that reaches it is the app's own
      // action client at boot, and an internal dispatch resolves from a
      // different map.
      //
      // `registerSeats` is deliberately NOT here — see `internal.actions`
      // below for why.
      ...(inventoryActions === undefined
        ? {}
        : { [INVENTORY_REGISTER_CHANNEL]: inventoryActions[INVENTORY_REGISTER_CHANNEL] })
    },
    internal: {
      actions: {
        // The same blocks a client reaches, so another flow's dispatch lands on
        // one implementation rather than a second spelling of it.
        //
        // Both registrations are required, and so is repeating `concurrency`:
        // `resolveEntry` reads one map per dispatch type and never falls
        // through to another, so a name in `actions` is unreachable by an
        // internal dispatch, and the arbiter reads `concurrency` off whichever
        // entry it resolved. Sharing the block ref is the whole dedupe there is.
        post: { block: postEntry, concurrency: "queue" },
        // Here only, never in `actions`: the answer names the post it answers,
        // so a caller who could reach it could take that post's one answer.
        // On the post queue's key (the session), so answers and posts are one
        // line at a time.
        [CHANNEL_ANSWER_ACTION]: { block: answerEntry, concurrency: "queue" as const },
        read: { block: readEntry },
        // `bind` is here only: it names its project, and the trusted callers
        // that reach it are a project's create and the app's own code.
        bind: { block: talkBind },
        join: { block: talkJoin },
        ...(fileTask === undefined || readBoard === undefined
          ? {}
          : { fileTask: { block: fileTask }, readBoard: { block: readBoard } }),
        // Beside `fileTask` and `readBoard`, so another flow's dispatch lands on
        // the same implementation a caller reaches.
        ...boardTaskActions,
        // `registerSeats` lives ONLY here, never in the public `actions` map
        // above. Unlike `registerChannel`, it has no session state to derive
        // from — a seat has no session — so its whole input IS the row data,
        // with nothing in this package to check it against. Public
        // reachability would let any principal that can reach this flow write
        // fabricated `{ id, kind }` pairs into the org's seat inventory.
        // `internal.actions` resolves from its own map (`resolveEntry`,
        // `@flow-state-dev/engine`) that a caller-addressed dispatch can never
        // reach — `dispatchTypeOf` maps every caller-facing transport source
        // to `public`, never to `internal` — so the only way in is a direct,
        // trusted `runAction({ source: "internal", ... })` call, which is
        // exactly what `openInventory`'s `run` door makes for this one
        // request (see `open-inventory.ts`). A hand-rolled kind that spreads
        // `inventoryWriterActions(kind)` must do the same split itself — see
        // that function's own doc comment.
        ...(inventoryActions === undefined
          ? {}
          : {
              [INVENTORY_REGISTER_SEATS]: inventoryActions[INVENTORY_REGISTER_SEATS],
              // Internal for the same reason: its input is ids to delete.
              [INVENTORY_RETIRE_CHANNELS]: inventoryActions[INVENTORY_RETIRE_CHANNELS]
            }),
        ...(fanOut === undefined
          ? {}
          : {
              // `allow`, deliberately: this is the work that must NOT sit
              // behind the post queue.
              onPosted: { block: fanOut, concurrency: "allow" as const }
            }),
        // A talk post's wake, for the same reason, and only on a kind holding
        // a template with seats to wake.
        ...(talkFanOut === undefined
          ? {}
          : { [TALK_POSTED_ACTION]: { block: talkFanOut, concurrency: "allow" as const } })
      }
    }
  });

  // The rebuild seam. `options` is closed over, so a kind configured with a
  // notify slot keeps it when the binder hands it the roster's board ids —
  // which is what stops "give this channel a board" and "wake its members"
  // from being two mutually exclusive ways to configure one kind.
  const factory = Object.assign(flow, {
    withBoards: (boards: readonly string[]) => defineChannelFlow({ ...options, boards }),
    withRouting: (routing: Readonly<Record<string, ChannelRouting>>) =>
      defineChannelFlow({ ...options, routing }),
    withBoardActions: (boardActions: readonly string[]) =>
      defineChannelFlow({ ...options, boardActions }),
    withTemplate: (template: TalkTemplateFacts) => defineChannelFlow({ ...options, template })
  }) as ChannelFlowFactory;
  if (options.route !== undefined) Object.assign(factory, { [KIND_ROUTE]: options.route });
  if (options.notify !== undefined) Object.assign(factory, { [KIND_WAKES]: true });
  return factory;
}

/**
 * The built-in kind, seeded by `channelInstances` when the app names none.
 *
 * An app registers nothing to use channels. A custom kind is the rare escape
 * hatch, passed through the `kinds` map at boot.
 */
export const channelFlow = defineChannelFlow();
