/**
 * MailboxFlow — the one mailbox kind the framework ships.
 *
 * The identity rule this whole module is built around: **one kind is one
 * instance, and one mailbox is one named session on it.** The flow declares
 * `cardinality: "singleton"`, so the registry admits exactly one instance and
 * its address is the kind (`flow.id === flow.kind`). A hundred mailboxes are a
 * hundred sessions on that one instance; what differs per mailbox — its
 * members and its charter — lives in that session's own state, which is the
 * framework's existing home for durable per-session facts. Its transcript is
 * its posts: each post leaves one `mailbox-post` item on its own request, and
 * `read` rebuilds the transcript from those items.
 *
 * A factory rather than a bare flow because a block cannot ride in a
 * zod-parsed config bag, and `options.notify` is a block. `mailboxFlow` is the
 * built-in the binder seeds.
 *
 * What the transcript can prove, said once here so no reader has to infer it: a
 * session is bound to ONE user, so the server-derived `principal` on every line
 * of a given mailbox is the SAME value. The `author` label is caller-supplied,
 * stored with `authorVerified: false`, and is a display claim, not a proof of
 * who wrote the line. The members check on `author` is a validity check against
 * the declared roster, not authentication. Whether a line is a seat's — and so
 * wakes nobody — is `seatAuthored`, set only by the seat post action and the
 * answer entry. A `post`, public or dispatched, never sets it.
 *
 * The same kind also serves a project's talk sessions: a session whose state
 * names a project (`resourceId`) is a person's way into that project's room,
 * and `post`, `read` and `answer` on it go to the room instead
 * (`../projects/talk.ts` is canonical). `join` and the internal `bind` exist
 * for them alone.
 */

import { defineFlow, dispatcher, handler, router, sequencer } from "@flow-state-dev/core";
import { deepEqual, readCommitted, withOutcome } from "@flow-state-dev/core/helpers";
import type { ActionConfig, BlockContext, BlockDefinition, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { taskToolActions, taskToolSuffix } from "@flow-state-dev/orchestration";
import { taskSchema } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import {
  MAILBOX_TASK_LISTS_ID,
  mailboxBoardId,
  mailboxBoardLedger,
  mailboxBoardNamesFor,
  mailboxTaskListsCollection,
  resolveMailboxBoard,
  resolveMailboxTaskList
} from "./mailbox-board";
import { emitMailboxPostLine, readMailboxPostLines } from "./mailbox-items";
import {
  subscribedFields,
  unsubscribedFields,
  workersByListRecordSchema,
  type MembershipFields
} from "./mailbox-membership";
import { incarnationOfRow } from "../roster/incarnation";
import { seatAddress, splitSeatAddress } from "../roster/address";
import { defineHiredRosterCollection } from "../roster/collections";
import { INVENTORY_RACE_ATTEMPTS, isWriteConflict } from "../roster/remove";
import {
  MAILBOX_POST_COMPONENT,
  mailboxTranscriptLineSchema,
  withoutRepeats,
  type MailboxTranscriptLine
} from "./mailbox-post-line";
import {
  keepLine,
  postCaseSchema,
  RECENT_LINES,
  ROUTE_BLOCK,
  ROUTE_LEDGER_STATE,
  routeLedgerStateSchema,
  routeRequestSchema,
  type MailboxRoute,
  type MailboxRouting,
  type PostCase,
  type RouteDecision
} from "./mailbox-route";
import {
  defineMailboxInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipKey,
  seatInventoryRowSchema
} from "../inventory/collections";
import { PROJECTS_COLLECTION, roomLineKey, roomLineSchema, type RoomLine } from "../projects/collections";
import {
  recentTalkLines,
  markTalkDelivered,
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
import { isTemplateMailbox, type TalkTemplateFacts } from "../projects/talk-template";
import type { SeatInventoryRow } from "../inventory/collections";

/** The built-in kind's name, and so the built-in instance's address. */
export const MAILBOX_KIND = "mailbox";

export { MAILBOX_POST_COMPONENT, mailboxTranscriptLineSchema, type MailboxTranscriptLine };

/**
 * The session state every mailbox on one instance shares.
 *
 * `members` and `instructions` are REQUIRED, and that is load-bearing rather
 * than incidental: a session the action path created (which writes empty state
 * and applies no schema defaults) carries neither, and that absence is exactly
 * what `mailbox-not-bound` tests. Giving either a `.default()` would make every
 * unbound session look like an empty mailbox.
 *
 * State and not metadata, deliberately: `SessionRecord.metadata`, `topic` and
 * `coordinate` carry no authority by declared contract, and `members` is read
 * on a refusal path.
 */
export const mailboxSessionStateSchema = z.object({
  /**
   * Who is on the mailbox. Written at open, from the file or by the run-time
   * opener, and changed after only by the internal subscribe and unsubscribe
   * entries. Read-only on the post path.
   */
  members: z.array(z.string()),
  /** The mailbox's charter — the `MAILBOX.md` body. */
  instructions: z.string(),
  /**
   * Lines a mailbox kept in state before each post became its own
   * `mailbox-post` item. Read-only: `read` returns them ahead of the posted
   * lines, and nothing writes here any more.
   */
  transcript: z.array(mailboxTranscriptLineSchema).default([]),
  /**
   * The project a talk session is about (`../projects/talk.ts`), or `null`. A
   * declared mailbox never sets it. It selects which project row a talk entry
   * checks, and grants nothing on its own. Nullable with a `null` default
   * (BP-023, BP-030), so a mailbox opened before it existed still parses.
   */
  resourceId: z.string().nullable().default(null),
  /**
   * `"runtime"` for a mailbox set up while the app ran, with no file; `null`
   * for one opened from a `MAILBOX.md`, and on a session written before the
   * field existed (BP-023, BP-030).
   */
  origin: z.literal("runtime").nullable().default(null),
  /**
   * The task lists this mailbox holds in its own session, beside the boards
   * its file builds onto the kind. Each is a ledger over `<mailboxId>/<list>`
   * of the one run-time collection (`mailbox-board.ts`). `null` when it holds
   * none, which is every mailbox a file opened.
   */
  taskLists: z.array(z.string()).nullable().default(null),
  /**
   * Per task list, the workers the subscribe and unsubscribe entries added to
   * and removed from it. A removal is kept even when nothing added the worker,
   * so taking a worker off a list holds against the file's own say-so.
   * `null` until either entry first records one. Read through
   * `taskListWorkers`, never directly.
   */
  workersByList: workersByListRecordSchema.nullable().default(null)
});

export type MailboxSessionState = z.infer<typeof mailboxSessionStateSchema>;

/** What a caller may put in a post. Closed: a caller has nowhere to put a `principal`. */
export const mailboxPostInputSchema = z
  .object({
    body: z.string().min(1),
    /** Optional, unverified claim about which seat is posting. */
    author: z.string().optional()
  })
  .strict();

export type MailboxPostInput = z.infer<typeof mailboxPostInputSchema>;

/**
 * The internal action a seat's answer to a routed post goes through: the
 * built-in agent kind's landing and its post tool send a routed turn's answer
 * here, not to `post`. Declared only on a kind built with a route and a
 * notify slot, the only kind that routes a post.
 */
export const MAILBOX_ANSWER_ACTION = "answer";

/**
 * The internal action a seat's own mailbox post goes through. A cross-flow
 * `post` is not this: `internal` is the generic address, and a claimed
 * `author` on it does not mark the line a seat's.
 */
export const MAILBOX_SEAT_POST_ACTION = "seatPost";

/**
 * What an answer carries: the post it answers, the words, and the seat.
 * Closed, and never caller-addressed: a caller who could name a post could
 * take its one answer.
 */
export const mailboxAnswerInputSchema = z
  .object({
    postId: z.string().min(1),
    body: z.string().min(1),
    author: z.string().min(1),
    /**
     * The delivery's `answerToken`, handed back. Required on a project's talk
     * session, where the answer's author is the seat the token was issued to;
     * a declared mailbox ignores it.
     */
    token: z.string().min(1).optional()
  })
  .strict();

type MailboxAnswerInput = z.infer<typeof mailboxAnswerInputSchema>;

/**
 * The mailbox-session field recording the routed posts that have their
 * answer: the post's id, and the id of the line that answered it. Never
 * trimmed, so a post delivered again however late lands no second answer. It
 * grows by one entry per routed answer, beside the lines the mailbox keeps.
 */
const ANSWERED_POSTS_STATE = "mailboxAnsweredPosts";

/** A routed kind's mailbox state, as far as its appends go: the route ledger and the answered posts. */
const routedMailboxStateSchema = routeLedgerStateSchema.extend({
  [ANSWERED_POSTS_STATE]: z.record(z.string(), z.string()).optional()
});

type RoutedMailboxState = z.infer<typeof routedMailboxStateSchema>;

/** What `read` projects: the mailbox, not the session's machinery. */
export const mailboxReadOutputSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  members: z.array(z.string()),
  /**
   * The board NAMES this mailbox declared, then the task lists its session
   * holds — never the rows, which are a board read. **Absent, not `[]`, on a
   * mailbox that holds none**, so a mailbox
   * without boards projects exactly what it projected before boards existed.
   */
  boards: z.array(z.string()).optional(),
  transcript: z.array(mailboxTranscriptLineSchema)
});

export type MailboxReadOutput = z.infer<typeof mailboxReadOutputSchema>;

/**
 * Why a call on a mailbox was refused. Every one is a per-request refusal that
 * leaves the transcript — and the ledger — untouched.
 *
 * `board-not-declared` is the file path's own: a caller naming a board this
 * mailbox's `MAILBOX.md` did not declare. It is never another mailbox's board
 * being reached and refused, because the ledger id is minted from the
 * session's own identity and a name can only ever address this mailbox's.
 *
 * `board-needs-an-org` is the one a mailbox opened without an `orgId` meets.
 * A board is org-scoped storage, so there is no scope to read or write in and
 * the refusal says that rather than letting the resource registry report the
 * board as unregistered, which sends an author to check a registration that is
 * fine. Same shape as an org-scoped document read in an org-less mailbox.
 */
export type MailboxRefusalReason =
  | "mailbox-not-bound"
  | "author-not-a-member"
  | "board-not-declared"
  | "board-needs-an-org"
  | "mailbox-is-a-template";

/**
 * A post refused on the mailbox's own terms, as opposed to by the substrate.
 *
 * Carries `reason` so a caller can branch without matching on message text —
 * the same shape the dispatch seam's refusals use.
 */
export class MailboxPostRefusedError extends Error {
  readonly reason: MailboxRefusalReason;

  constructor(reason: MailboxRefusalReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "MailboxPostRefusedError";
    this.reason = reason;
  }
}

/**
 * Is this session a bound mailbox, or merely a session that exists?
 *
 * The shared instance answers for EVERY session id, and the action path is
 * create-or-get, so a caller naming an unused id gets a new, empty session on
 * the mailbox instance rather than a refusal. Boundness — not existence — is
 * therefore the test: `openMailboxes` writes `members` and `instructions`
 * together, and nothing else does.
 *
 * Answered against the WHOLE declared schema rather than by checking that the
 * two keys are present. A presence check calls `{ members: [42], instructions:
 * "x" }` a mailbox: the post path would admit it, `openMailboxes` would skip it
 * as already open, and it would fail its declared schemas on every later
 * read — bound to nothing, and repairable by nothing. A state the schema
 * cannot parse is not a mailbox.
 *
 * Exported for the binder, which asks this same question of a 409 — is a
 * mailbox open here, or merely a session? One definition, because a binder
 * reading boundness differently from the fence would leave sessions the fence
 * still rejects. What the binder then DOES with the answer is its own and
 * narrower: it releases an id only when this kind's own empty session holds it.
 * Not re-exported from the package root.
 */
export function boundMailbox(
  state: Readonly<Record<string, unknown>>
): MailboxSessionState | undefined {
  const parsed = mailboxSessionStateSchema.safeParse(state);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Refuse a mailbox action on a session whose id is now a project talk
 * template's `MAILBOX.md` (`mintFor:`). The session it had as a mailbox may
 * survive in the store, still bound; a template is never a mailbox, so its
 * `post`, `read` and `answer` are refused rather than served from that state.
 */
function refuseTemplateMailbox(ctx: { session: { identity: { id: string } } }): void {
  const id = ctx.session.identity.id;
  if (isTemplateMailbox(PROJECTS_COLLECTION, id)) {
    throw new MailboxPostRefusedError(
      "mailbox-is-a-template",
      `"${id}" is declared as a project talk template (\`mintFor:\`), not a mailbox. A project's room is ` +
        "reached through a member's talk session (`join`)."
    );
  }
}

/**
 * The open mailbox this session is, after the template fence: every mailbox
 * action that acts on its mailbox (post, read, answer, the board actions and
 * the inventory registration) finds it here, so none of them serves a session
 * whose id is now a project talk template's. `undefined` when the session is
 * not a bound mailbox; each caller refuses that in its own words.
 */
function openMailboxOf(ctx: { session: { identity: { id: string }; state: Readonly<Record<string, unknown>> } }) {
  refuseTemplateMailbox(ctx);
  return boundMailbox(ctx.session.state);
}

/**
 * The line a post makes, or the mailbox's refusal. Writes nothing: each append
 * keeps the line itself.
 */
function lineFor(input: MailboxPostInput, ctx: BlockContext, seatAuthored: boolean): MailboxTranscriptLine {
  const mailbox = openMailboxOf(ctx);
  if (mailbox === undefined) {
    throw new MailboxPostRefusedError(
      "mailbox-not-bound",
      `session "${ctx.session.identity.id}" is not an open mailbox. A mailbox's session is ` +
        `opened by \`openMailboxes\`; naming an id nobody opened creates an empty session, not a mailbox.`
    );
  }

  // A validity check against the declared roster, NOT authentication. The
  // claim stays unverified either way; this only stops a line naming a seat
  // the mailbox has never heard of.
  if (input.author !== undefined && !mailbox.members.includes(input.author)) {
    throw new MailboxPostRefusedError(
      "author-not-a-member",
      `"${input.author}" is not a member of mailbox "${ctx.session.identity.id}". ` +
        `Members: ${mailbox.members.length > 0 ? mailbox.members.join(", ") : "(none)"}.`
    );
  }

  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    // The server's value. BP-031: never the caller's, and the input schema is
    // closed so there is no caller value to take.
    principal: ctx.session.identity.userId ?? ctx.session.identity.id,
    ...(input.author === undefined ? {} : { author: input.author }),
    ...(seatAuthored ? { seatAuthored: true as const } : {}),
    authorVerified: false as const,
    body: input.body
  };
}

/**
 * The append: the whole of what the post entry's queue hold covers.
 *
 * `seatAuthored` is which entry this handler serves. The seat post action
 * passes true. Public `post` and a dispatched `post` pass false. It is not
 * read from `input`.
 */
function appendPostFor(seatAuthored: boolean) {
  return handler({
    name: seatAuthored ? "mailbox-append-seat-post" : "mailbox-append-post",
    inputSchema: mailboxPostInputSchema,
    outputSchema: mailboxTranscriptLineSchema,
    sessionStateSchema: routeLedgerStateSchema,
    execute: async (input: MailboxPostInput, ctx): Promise<MailboxTranscriptLine> => {
      const line = lineFor(input, ctx, seatAuthored);
      // A route ledger left by a kind built with a route would miss this line,
      // and every line after it, so it goes before the line is kept. Once: the
      // next post finds none, and posts on a mailbox that never had one write
      // nothing.
      if (ctx.session.state[ROUTE_LEDGER_STATE] !== undefined) {
        await ctx.session.atomicState(() => ({ [ROUTE_LEDGER_STATE]: undefined }));
      }
      // The line is this request's own item, and that item is the record: a
      // client reads a mailbox by filtering its session's items to
      // `mailbox-post`, the way it reads any conversation. Nothing is copied into
      // state — a second record of the post could only disagree with the first.
      // A kind built with a route is the one exception, and keeps only what its
      // route reads (`appendRoutedPostFor`).
      await emitMailboxPostLine(ctx, line);
      return line;
    }
  });
}

/** What a routed kind's append hands on: the line, and for a person's post on a routed mailbox, its case. */
const keptPostSchema = z.object({ line: mailboxTranscriptLineSchema, postCase: postCaseSchema.optional() });

type KeptPost = z.infer<typeof keptPostSchema>;

/**
 * Keep one line on a kind built with a route. The rule: **the mailbox's state
 * is written with each line, in one write just before its item, and the
 * engine keeps every item a request emits on that request's record, even when
 * the request then fails.** So the route's ledger (`mailbox-route.ts`) holds
 * every line the mailbox shows, including one whose post failed after its
 * item was emitted, and a line that could not enter the ledger is never
 * emitted. The one gap is a store that loses the request's own record too:
 * the ledger then holds a line the mailbox does not.
 *
 * For an answer, the same write marks its post answered, and is where a second
 * answer is refused: the mark is read and set in the one atomic write, so of
 * two answers to one post only the first to be written is emitted, and the
 * other writes nothing.
 *
 * Every line, on every mailbox of the kind, goes into the ledger, under the
 * post queue, so the ledger takes the mailbox's lines in order. Kept whether or
 * not the mailbox is routed, so a mailbox whose file drops `routing:` and later
 * restores it has every line in the ledger. A person's post while it is not
 * routed becomes the last post with no route, so it holds nothing. A kind
 * built without a route keeps no ledger, and drops one left from before
 * (`appendPostFor`).
 *
 * A mailbox's first line with no ledger starts one from the lines in the
 * request's history window, the same window `read` sees, with no post to hold
 * for. On a busy mailbox that window can hold fewer than 20 lines.
 *
 * @param answerPostId For an answer, the id of the post it answers.
 * @returns What was kept, with a person's post's case; `undefined` when the
 *   post `answerPostId` names has its answer already, and nothing was written.
 */
async function keepRoutedLine(
  ctx: BlockContext<Record<string, unknown>, RoutedMailboxState>,
  line: MailboxTranscriptLine,
  answerPostId?: string
): Promise<{ postCase?: PostCase } | undefined> {
  const seed = ctx.session.state[ROUTE_LEDGER_STATE] ?? {
    lines: withoutRepeats([
      ...(boundMailbox(ctx.session.state)?.transcript ?? []),
      ...readMailboxPostLines(ctx, mailboxTranscriptLineSchema)
    ]).slice(-RECENT_LINES)
  };
  // The outcome comes back from the invocation that committed: `atomicState`
  // may run its mutator more than once.
  const kept = await withOutcome(
    (mutator: (state: RoutedMailboxState) => RoutedMailboxState) => ctx.session.atomicState(mutator),
    (state: RoutedMailboxState) => {
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
  if (kept !== undefined) await emitMailboxPostLine(ctx, line);
  return kept;
}

/**
 * The append on a kind built with a route: the line, kept by
 * {@link keepRoutedLine}. On a mailbox that declares `routing:`, a person's
 * post comes out with its case.
 */
const appendRoutedPostFor = (routing: Readonly<Record<string, MailboxRouting>>, seatAuthored: boolean) =>
  handler({
    name: seatAuthored ? "mailbox-append-routed-seat-post" : "mailbox-append-routed-post",
    inputSchema: mailboxPostInputSchema,
    outputSchema: keptPostSchema,
    sessionStateSchema: routedMailboxStateSchema,
    execute: async (input: MailboxPostInput, ctx): Promise<KeptPost> => {
      const line = lineFor(input, ctx, seatAuthored);
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
  name: "mailbox-append-answer",
  inputSchema: mailboxAnswerInputSchema,
  outputSchema: mailboxTranscriptLineSchema.nullable(),
  sessionStateSchema: routedMailboxStateSchema,
  execute: async ({ postId, body, author }: MailboxAnswerInput, ctx): Promise<MailboxTranscriptLine | null> => {
    const line = lineFor({ body, author }, ctx, true);
    return (await keepRoutedLine(ctx, line, postId)) === undefined ? null : line;
  }
});

/**
 * The clean projection. Deliberately not `ctx.session.items.client()`.
 *
 * A factory because the declared board names come from the roster the KIND was
 * built with, filtered to this session's own id — not from session state. That
 * is what makes an edited `MAILBOX.md` reach a mailbox that is already open:
 * the list is re-derived from the file on the next bind.
 *
 * The transcript is the lines a mailbox kept in state before posts became
 * items, then the posted lines, each id once. The posted half comes from the
 * session's history window (50 requests by default, and a post with a notify
 * slot uses two), so on a busy mailbox `read` returns the recent lines. A page
 * reads every post from the session's items instead.
 */
const readMailboxFor = (boardIds: readonly string[]) =>
  handler({
    name: "mailbox-read",
    inputSchema: z.object({}).strict(),
    outputSchema: mailboxReadOutputSchema,
    execute: async (_input, ctx): Promise<MailboxReadOutput> => {
      const mailbox = openMailboxOf(ctx);
      if (mailbox === undefined) {
        throw new MailboxPostRefusedError(
          "mailbox-not-bound",
          `session "${ctx.session.identity.id}" is not an open mailbox.`
        );
      }
      const boards = listsHeld(mailboxBoardNamesFor(ctx.session.identity.id, boardIds), mailbox);
      return {
        id: ctx.session.identity.id,
        ...(ctx.session.metadata.description === undefined
          ? {}
          : { description: ctx.session.metadata.description }),
        members: mailbox.members,
        // Omitted rather than `[]` when this mailbox holds none — see the
        // schema. The rows never come back here either way: reading a board is
        // a board read.
        ...(boards.length === 0 ? {} : { boards }),
        transcript: withoutRepeats([...mailbox.transcript, ...readMailboxPostLines(ctx, mailboxTranscriptLineSchema)])
      };
    }
  });

/**
 * Every list a mailbox holds: its file's boards, then the lists its session
 * holds that are not also a board's name. A file board wins a shared name, so
 * resolving a name and listing the names agree on which ledger it is.
 */
function listsHeld(boards: readonly string[], mailbox: MailboxSessionState): string[] {
  return [...boards, ...(mailbox.taskLists ?? []).filter((list) => !boards.includes(list))];
}

/** The ledger shape the two board actions use: the substrate's ref. */
type MailboxTaskLedger = Exclude<Awaited<ReturnType<typeof resolveMailboxBoard>>, undefined>;

/** What filing one row takes. Closed, as the post input is. */
export const mailboxFileTaskInputSchema = z
  .object({
    /** The board's LOCAL name, as the `MAILBOX.md` declared it. */
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

export type MailboxFileTaskInput = z.infer<typeof mailboxFileTaskInputSchema>;

/** What filing one row hands back: where it landed, and which row it is. */
export const mailboxFileTaskOutputSchema = z.object({
  board: z.string(),
  /** The minted ledger id — the same string a seat declares. */
  boardId: z.string(),
  taskId: z.string(),
  status: z.string()
});

export type MailboxFileTaskOutput = z.infer<typeof mailboxFileTaskOutputSchema>;

/** What reading one board takes. */
export const mailboxReadBoardInputSchema = z.object({ board: z.string().min(1) }).strict();

/**
 * One row as this mailbox publishes it — an **allowlist**, not the task minus a
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
export const mailboxBoardRowSchema = taskSchema.pick({
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
export const mailboxReadBoardOutputSchema = z.object({
  board: z.string(),
  boardId: z.string(),
  tasks: z.array(mailboxBoardRowSchema)
});

export type MailboxReadBoardOutput = z.infer<typeof mailboxReadBoardOutputSchema>;

/**
 * Resolve the ledger a caller named, against the mailbox's OWN declared list.
 *
 * Two fences in one place, in the order an author wants to hear them: the
 * session must be an open mailbox, and the name must be one this mailbox
 * declared. The id is then minted from `ctx.session.identity.id` — never from
 * the payload — so a caller naming a board another mailbox declared addresses
 * this mailbox's id and simply misses it (BP-031). There is no input through
 * which another mailbox's rows can be selected.
 *
 * The ledger is resolved ONCE per request and handed to the caller, rather than
 * re-walking the resource registry per operation for an answer that cannot
 * change inside a request.
 */
async function ledgerNamed(
  ctx: BlockContext,
  boardIds: readonly string[],
  name: string
): Promise<{ boardId: string; mailbox: MailboxSessionState; ledger: MailboxTaskLedger }> {
  const mailbox = openMailboxOf(ctx);
  if (mailbox === undefined) {
    throw new MailboxPostRefusedError(
      "mailbox-not-bound",
      `session "${ctx.session.identity.id}" is not an open mailbox. A mailbox's session is ` +
        `opened by \`openMailboxes\`; naming an id nobody opened creates an empty session, not a mailbox.`
    );
  }

  const mailboxId = ctx.session.identity.id;
  const boards = mailboxBoardNamesFor(mailboxId, boardIds);
  const held = listsHeld(boards, mailbox);
  if (!held.includes(name)) {
    throw new MailboxPostRefusedError(
      "board-not-declared",
      `mailbox "${mailboxId}" declares no board "${name}". ` +
        `Boards: ${held.length > 0 ? held.join(", ") : "(none)"}. A board is declared in the ` +
        `mailbox's own \`MAILBOX.md\`, and its ledger id is minted from this mailbox's id.`
    );
  }

  // Before resolving, because an org-less request has no org scope at all and
  // the registry would report the board as unregistered — true, but it names
  // the wrong cause. A board is org-scoped storage by construction.
  if (ctx.org === undefined) {
    throw new MailboxPostRefusedError(
      "board-needs-an-org",
      `mailbox "${mailboxId}" holds board "${name}", but this mailbox is open without an ` +
        `organization. A board is org-scoped storage, so there is nothing to read or write ` +
        `in. Open the mailbox with an \`orgId\` (or as a caller whose verified identity ` +
        `carries one) and the board resolves.`
    );
  }

  const boardId = mailboxBoardId(mailboxId, name);

  // Caught rather than tested for: the resource registry THROWS on a key it
  // does not hold, so an `undefined` check alone is a branch that never runs
  // and a message nobody ever reads. Both outcomes land here and produce the
  // same refusal.
  // A file board first, then the session's own list of that name: the same
  // order `listsHeld` names them in.
  let ledger: MailboxTaskLedger | undefined;
  try {
    ledger = boards.includes(name)
      ? await resolveMailboxBoard(ctx, boardId)
      : await resolveMailboxTaskList(ctx, mailboxId, name);
  } catch {
    ledger = undefined;
  }
  if (ledger === undefined) {
    throw new MailboxPostRefusedError(
      "board-not-declared",
      `mailbox "${mailboxId}" declares board "${name}", but its ledger is not registered on ` +
        `this flow. The mailbox kind is built holding every board its roster minted, so this ` +
        `means the kind was built from a different roster than the one that opened this mailbox.`
    );
  }
  return { boardId, mailbox, ledger };
}

/**
 * File one row onto a board this mailbox holds.
 *
 * The roster check on `author` is the **same check a post meets, in the same
 * words** — and it is a validity check against the declared roster, not
 * authentication. `author` is optional and unverified, so a caller that omits
 * it is not checked at all, on this path exactly as on the post path. Filing is
 * not members-only, and this action does not pretend it is: the per-caller
 * identity that would make it so does not exist on the mailbox session
 * contract.
 */
const fileTaskFor = (boardIds: readonly string[]) =>
  handler({
    name: "mailbox-file-task",
    inputSchema: mailboxFileTaskInputSchema,
    outputSchema: mailboxFileTaskOutputSchema,
    execute: async (input: MailboxFileTaskInput, ctx): Promise<MailboxFileTaskOutput> => {
      const { boardId, mailbox, ledger } = await ledgerNamed(ctx, boardIds, input.board);

      // A validity check against the declared roster, NOT authentication. The
      // claim stays unverified either way; this only stops a row naming a seat
      // the mailbox has never heard of.
      if (input.author !== undefined && !mailbox.members.includes(input.author)) {
        throw new MailboxPostRefusedError(
          "author-not-a-member",
          `"${input.author}" is not a member of mailbox "${ctx.session.identity.id}". ` +
            `Members: ${mailbox.members.length > 0 ? mailbox.members.join(", ") : "(none)"}.`
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

/** Read one board this mailbox holds. */
const readBoardFor = (boardIds: readonly string[]) =>
  handler({
    name: "mailbox-read-board",
    inputSchema: mailboxReadBoardInputSchema,
    outputSchema: mailboxReadBoardOutputSchema,
    execute: async (
      input: z.infer<typeof mailboxReadBoardInputSchema>,
      ctx
    ): Promise<MailboxReadBoardOutput> => {
      const { boardId, ledger } = await ledgerNamed(ctx, boardIds, input.board);
      return {
        board: input.board,
        boardId,
        // The allowlist above is the redaction: `pick` drops `claimedBy` and
        // every other coordinate with it, and parsing also strips the handle's
        // `items()` method, so what comes back is the row rather than a live
        // handle.
        tasks: ledger.list().map((task) => mailboxBoardRowSchema.parse(task))
      };
    }
  });

/**
 * One board's eight task tools as actions, for a mailbox that declared
 * `boardActions: true` (FIX-1629).
 *
 * The same guarded verbs a seat's model holds through `mailboxBoardTaskTools`,
 * so a refusal is the verb's own and comes back as `{ ok: false, error }`. The
 * one thing added is the fence a mailbox needs and a board on its own flow
 * does not: every mailbox shares this flow, so `cancelTask_eng_feature_work`
 * is callable on every mailbox's session. The resolver refuses unless the
 * session IS the board's mailbox, then reaches the ledger through
 * {@link ledgerNamed} — the same checks `fileTask` and `readBoard` make —
 * before any row is read.
 */
function boardTaskActionsFor(boardIds: readonly string[], boardId: string) {
  // A board id is `<mailboxId>.<name>`, and a name carries no dot.
  const split = boardId.lastIndexOf(".");
  const mailboxId = boardId.slice(0, split);
  const name = boardId.slice(split + 1);
  return taskToolActions(boardId, async (ctx) => {
    if (ctx.session.identity.id !== mailboxId) {
      throw new MailboxPostRefusedError(
        "board-not-declared",
        `board "${boardId}" belongs to mailbox "${mailboxId}", and this is mailbox ` +
          `"${ctx.session.identity.id}". A board's task actions work only in its own mailbox's session.`
      );
    }
    return (await ledgerNamed(ctx, boardIds, name)).ledger;
  });
}

/**
 * What the fan-out entry is handed: enough to say which post is being
 * delivered, and for a person's post on a routed mailbox, its case as the
 * post kept it. Internal-only entry, so no caller writes the case.
 */
const mailboxFanOutInputSchema = z.object({
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  author: z.string().optional(),
  /**
   * The post arrived on the internal seat entry. Set by that entry when it
   * builds this payload. A caller's `author` never sets it.
   */
  seatAuthored: z.literal(true).optional(),
  postCase: postCaseSchema.optional()
});

export type MailboxFanOutInput = z.infer<typeof mailboxFanOutInputSchema>;

/**
 * What a notify block is handed, once per declared member per post, or once
 * in all for a routed post.
 *
 * `seatAuthored`, `routed` and `recent` are set by the mailbox's own fan-out
 * and nothing else: a caller's post has no field that reaches them.
 */
export const mailboxNotifyInputSchema = z.object({
  /** The mailbox's session id. */
  mailboxId: z.string(),
  /** The declared member this delivery is addressed to. */
  member: z.string(),
  postId: z.string(),
  body: z.string(),
  principal: z.string(),
  /** The poster's unverified claim. Display only; it does not withhold a wake. */
  author: z.string().optional(),
  /**
   * The mailbox marked this delivery as a seat's own post or answer. Copied
   * from the internal entry. Absent on a public post, including one that
   * claims an `author`.
   */
  seatAuthored: z.literal(true).optional(),
  /**
   * `true` when the mailbox's route picked this member, the one member the
   * post is delivered to; and on a project's talk session, for each of the
   * template's seats, every one of which answers into the room. Absent on
   * every other delivery. A kind that hears posts decides what it does with
   * the mark; the built-in agent kind posts its reply into the mailbox, which
   * on a talk session is the project's room.
   */
  routed: z.boolean().optional(),
  /**
   * On a routed delivery, the mailbox's last lines before the post (up to
   * 20), oldest first: the ones the route read. On a talk session's delivery,
   * the room's last lines before the post, up to 20. Absent on every other
   * delivery.
   */
  recent: z.array(mailboxTranscriptLineSchema).optional(),
  /**
   * On a talk session's delivery, the token for this seat's answer: issued to
   * this member alone, and handed back as the answer's `token`. The answer's
   * author is the seat it was issued to. Absent on every other delivery.
   */
  answerToken: z.string().optional()
});

export type MailboxNotifyInput = z.infer<typeof mailboxNotifyInputSchema>;

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
const mailboxRefusalNoteSchema = z.object({
  delivered: z.literal(false),
  reason: z.string()
});

/**
 * Absorb one member's delivery refusal so the remaining members are still
 * attempted, carrying the reason out as this block's own output.
 *
 * **Nothing about a mailbox's session is written here.** A delivery outcome
 * is not a mailbox fact to widen every mailbox's declared state with, so the
 * reason travels in this request's own item log, alongside the rest of the
 * fan-out's trace, and nowhere else. (`ctx.session.appendJournal` re-reads the
 * record and commits at its version, so it would no longer erase a post that
 * landed in between; the item log is kept because that is where the trace is.)
 */
const noteDeliveryRefusal = handler({
  name: "mailbox-delivery-refused",
  inputSchema: z.unknown(),
  outputSchema: mailboxRefusalNoteSchema,
  execute: async (error: unknown) => ({
    delivered: false as const,
    reason: `mailbox delivery refused: ${error instanceof Error ? error.message : String(error)}`
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
 * flat one: a mailbox makes no session write that is not a state delta.
 */
const noteHandOffRefusal = handler({
  name: "mailbox-hand-off-refused",
  inputSchema: z.unknown(),
  outputSchema: mailboxRefusalNoteSchema,
  execute: async (error: unknown) => ({
    delivered: false as const,
    reason: `mailbox fan-out not started: ${error instanceof Error ? error.message : String(error)}`
  })
});

// ---------------------------------------------------------------------------
// The live inventory's writer half
// ---------------------------------------------------------------------------

/**
 * The action the boot binder dispatches into each open mailbox's OWN session,
 * so the mailbox writes its own row.
 *
 * **Pinned.** `openInventory` names this string, and a mailbox kind a caller
 * hand-rolled must declare an action under it — the same way it must declare
 * `cardinality: "singleton"`. A kind that does not is a per-mailbox failure the
 * binder names, never a mailbox silently missing from the inventory.
 */
export const INVENTORY_REGISTER_MAILBOX = "registerMailboxInInventory";

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
 * talk templates (`mintFor:`), naming their ids, so a mailbox row an earlier
 * boot wrote under one of those ids is retired: a template is never a mailbox,
 * so a row advertising it as one is wrong rather than merely old.
 *
 * **Pinned**, and internal-only like {@link INVENTORY_REGISTER_SEATS}: its whole
 * input is ids to delete, with nothing to check them against.
 */
export const INVENTORY_RETIRE_MAILBOXES = "retireMailboxesInInventory";

/**
 * The internal entry the run-time opener runs once a mailbox it set up is
 * open: the mailbox writes its own inventory row, marked `origin: "runtime"`,
 * and its membership rows. Re-running it rewrites the same rows, which is how
 * a retried setup repairs a row that never landed.
 *
 * Internal only, like the two below: the app reaches it, a client never does.
 */
export const MAILBOX_SET_UP_ACTION = "setUp";

/**
 * The internal entry that adds workers to a mailbox, and with `worksTaskList`
 * records them as working its task lists. The one way members grow after a
 * mailbox opens. A versioned write of the session, then the rows follow.
 */
export const MAILBOX_SUBSCRIBE_ACTION = "subscribe";

/**
 * The internal entry that takes workers off a mailbox and off its task lists,
 * recording each removal. Their open tasks stay where they are.
 */
export const MAILBOX_UNSUBSCRIBE_ACTION = "unsubscribe";

/** What subscribing takes: worker names, and whether they work the mailbox's lists. */
const subscribeInputSchema = z
  .object({ workers: z.array(z.string().min(1)).min(1), worksTaskList: z.boolean().optional() })
  .strict();

/** What unsubscribing takes: worker names. */
const unsubscribeInputSchema = z.object({ workers: z.array(z.string().min(1)).min(1) }).strict();

/** What a membership change reports: the members it left. */
/** What a membership entry returns: the members the mailbox now holds. */
export const membershipChangedSchema = z.object({ members: z.array(z.string()) });

/** Nothing a caller supplies reaches the mailbox's row. */
const registerMailboxInputSchema = z.object({}).strict();

/** What setting a mailbox up adds to its row: the line saying what it is for, written once. */
const setUpInputSchema = z.object({ description: z.string().min(1).optional() }).strict();

/** What a registration reports back: the row it wrote, so a caller can read it without a second read. */
export const inventoryMailboxRegisteredSchema = z.object({
  id: z.string(),
  kind: z.string(),
  members: z.array(z.string()),
  origin: z.literal("runtime").nullable()
});

/** The roster's seats, as the binder holds them. */
const registerSeatsInputSchema = z
  .object({ seats: z.array(seatInventoryRowSchema) })
  .strict();

/** What the seat write reports: how many rows landed. */
export const inventorySeatsRegisteredSchema = z.object({ written: z.number() });

/** The ids of the roster's talk templates, whose mailbox rows are retired. */
const retireMailboxesInputSchema = z.object({ ids: z.array(z.string().min(1)) }).strict();

/** What the retirement reports: how many mailbox rows it removed. */
export const inventoryMailboxesRetiredSchema = z.object({ retired: z.number() });

/** The stored row is not one this boot may replace. */
class NotTheBootsRow extends Error {}

/** The stored row moved after the roster was read against it; read both again. */
class RowMovedSinceRosterRead extends Error {}

/**
 * Whether a boot's row may replace the row stored at its address.
 *
 * A runtime hire's row (`hired: true`) is replaced by the same hire: a hired
 * row carrying the same incarnation (`null` matching only `null`, a row from
 * before incarnations). It is also replaced by the hire the roster holds at
 * the address now (`rosterIncarnation`), because a row of another incarnation
 * is then a hire the roster no longer has: what a fire that stopped between
 * its two deletes leaves (FIX-1621). Without that, a replacement hire that
 * stopped before publishing its own row could never publish it at a boot,
 * and a team list would leave it out on every restart. A boot that read an
 * older roster carries an incarnation the roster no longer holds, so it
 * still replaces nothing of a newer hire's.
 *
 * A declared seat's row is replaced only by a declared row, and a boot's
 * hired row never replaces it. A row from before `hired` existed is replaced
 * by a declared row, and by a hired one as above.
 *
 * @param rosterIncarnation The incarnation of the roster row at the address,
 *   read in this attempt; `undefined` when there is none, or when the boot
 *   cannot read it (a user-owned seat's row is its owner's alone).
 */
function bootMayReplace(
  stored: Record<string, unknown>,
  row: SeatInventoryRow,
  rosterIncarnation: string | null | undefined
): boolean {
  if (row.hired === true) {
    if (stored.hired === false) return false;
    const incarnation = row.incarnation ?? null;
    return incarnationOfRow(stored) === incarnation || rosterIncarnation === incarnation;
  }
  return stored.hired !== true;
}

/**
 * The incarnation of the roster row at a hired seat's address, as stored now,
 * for {@link bootMayReplace}. `undefined` when the address has no roster row,
 * and for a user-owned address (`<org>.~<user>.<seatId>`), whose roster row
 * is owner-private and so not the boot's to read.
 *
 * As stored now, not as this request first read it: a fire and a replacement
 * hire can both land between the two, and a boot judging by the older row
 * would put a fired hire's row back over the replacement's. A row deleted
 * since it was read throws `resource_deleted`, which the caller takes as
 * "not the boot's to write".
 */
async function rosterIncarnationAt(
  roster: ResourceCollectionRef,
  orgId: string,
  address: string
): Promise<string | null | undefined> {
  const seatId = splitSeatAddress(orgId, address);
  if (seatId === undefined || seatAddress(orgId, seatId) !== address) return undefined;
  const current = await roster.getOptional(seatId);
  if (current === undefined) return undefined;
  return readCommitted(current, (state) => incarnationOfRow(state as Record<string, unknown>));
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
 * checked again, against a roster read again for that attempt. A row removed
 * after it was read is not written back.
 *
 * @returns whether the row landed.
 */
async function publishBootSeatRow(
  seats: ResourceCollectionRef,
  roster: ResourceCollectionRef,
  orgId: string,
  row: SeatInventoryRow
): Promise<boolean> {
  for (let attempt = 0; attempt < INVENTORY_RACE_ATTEMPTS; attempt += 1) {
    const stored = await seats.getOptional(row.id);
    try {
      if (stored === undefined) {
        await seats.create(row.id, row);
        return true;
      }
      const rosterIncarnation = row.hired === true ? await rosterIncarnationAt(roster, orgId, row.id) : undefined;
      const seen = incarnationOfRow(stored.state as Record<string, unknown>);
      await stored.updateState((current) => {
        // The roster was read with `seen` stored. The write's own retry hands
        // this a newer row without reading the roster again, so a row of
        // another incarnation goes back round the loop for a fresh read of
        // both rather than being judged by the older roster.
        const now = incarnationOfRow(current);
        if (rosterIncarnation !== undefined && now !== seen && now !== (row.incarnation ?? null)) {
          throw new RowMovedSinceRosterRead();
        }
        if (!bootMayReplace(current, row, rosterIncarnation)) throw new NotTheBootsRow();
        return row;
      });
      return true;
    } catch (error) {
      if (error instanceof NotTheBootsRow) return false;
      if (error instanceof RowMovedSinceRosterRead) continue;
      if ((error as { code?: unknown }).code === "resource_deleted") return false;
      if (!isWriteConflict(error)) throw error;
    }
  }
  throw new Error("the row kept changing under this boot.");
}

/**
 * The two collections a mailbox writes its own rows to, declared once so every
 * block of one flow that writes them declares the same object.
 */
const MAILBOX_ROW_COLLECTIONS = {
  mailboxes: defineMailboxInventoryCollection(),
  memberships: defineMembershipIndexCollection()
};

/** What {@link publishMailboxRows} needs of a block's context: the session, and the two collections. */
type InventoryWriteContext = {
  session: { identity: { id: string } };
  resources: { mailboxes: ResourceCollectionRef; memberships: ResourceCollectionRef };
};

/**
 * Write one mailbox's inventory rows from its own session state: its mailbox
 * row, then a membership row per member, then delete the rows of `removed`.
 *
 * The mailbox's OWN session state, and nothing else. The binder carries no
 * members, deliberately: a roster's `members:` is what a file said when it
 * was last read, and an edit to it never reaches a session that is already
 * open. Copying it here would republish that file-time answer under a live
 * name.
 *
 * The mailbox row goes FIRST. It is what `discover` lists, so a membership
 * row that fails to land leaves the mailbox listed with its session's
 * members, never with the members of the change before. A membership row is
 * an index of the same fact, rewritten from the session on the next change.
 * Neither write is transactional with the other, so a failure partway leaves
 * whatever landed before it; the next change or boot writes it all again.
 *
 * `description` is a run-time mailbox's purpose, from its setup; it is
 * written when the row is created and never after.
 *
 * Every member's key is built up front, before anything is written.
 * `membershipKey` throws on a member id that can never be one, and that
 * failure is permanent, not flaky, so it must not land after some rows are
 * already committed.
 */
async function publishMailboxRows(
  ctx: InventoryWriteContext,
  kind: string,
  mailbox: MailboxSessionState,
  removed: readonly string[],
  description?: string
) {
  const id = ctx.session.identity.id;
  const members = [...mailbox.members];
  const origin = mailbox.origin;
  const membershipKeys = members.map((seatId) => membershipKey(seatId, id));
  const removedKeys = removed.filter((seatId) => !members.includes(seatId)).map((seatId) => membershipKey(seatId, id));

  // `openedAt` is create-only, so a second boot does not restamp a mailbox
  // that has been open since the first one.
  // `description`, when given, is create-only too: it is what the setup said.
  await ctx.resources.mailboxes.upsert(
    id,
    { id, kind, members, origin },
    { openedAt: new Date().toISOString(), ...(description === undefined ? {} : { description }) }
  );
  for (let i = 0; i < members.length; i++) {
    await ctx.resources.memberships.upsert(membershipKeys[i]!, { seatId: members[i]!, mailboxId: id });
  }
  for (const key of removedKeys) await ctx.resources.memberships.delete(key);

  return { id, kind, members, origin };
}

/**
 * The two blocks that write the live inventory, built for one mailbox kind.
 *
 * Built per kind rather than once, because a mailbox row records **which kind
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
 *   `defineMailboxFlow` passes its own; a hand-rolled kind passes the same
 *   string it passed `defineFlow({ kind })`, and a row carrying the wrong one
 *   is that kind's bug in the same way a mismatched `cardinality` is.
 * @returns Both entries, keyed by their action name. The blocks declare the
 *   collections they touch, so installing an entry installs its collection
 *   too. **Split them across `actions` and `internal.actions` — do not spread
 *   the whole return into `actions`.** `registerSeats`'s whole input is
 *   caller-supplied row data with nothing to check it against, so a public
 *   caller could write fabricated seat rows; `registerMailbox` has no such
 *   risk (empty input, derives its row from the mailbox's own session state),
 *   so it is the one safe to leave public. `defineMailboxFlow`'s own built-in
 *   kind makes exactly this split — read it there for the mechanics.
 *
 * @example
 *   const writer = inventoryWriterActions("briefing");
 *   defineFlow({
 *     kind: "briefing",
 *     cardinality: "singleton",
 *     session: { stateSchema: briefingState },
 *     actions: { ...myActions, registerMailboxInInventory: writer.registerMailboxInInventory },
 *     internal: {
 *       actions: {
 *         registerSeatsInInventory: writer.registerSeatsInInventory,
 *         retireMailboxesInInventory: writer.retireMailboxesInInventory
 *       }
 *     }
 *   });
 */
export function inventoryWriterActions(kind: string) {
  // Fresh per call, but for the two the membership entries also write. Two
  // collections declared from one factory share storage — a collection is
  // addressed by its pattern and scope, never by object identity — but one
  // flow must declare one object per accessor key, and the built-in kind
  // declares these two on both its registration and its membership entries.
  const { mailboxes, memberships } = MAILBOX_ROW_COLLECTIONS;
  const seats = defineSeatInventoryCollection();
  // Read by the seat write only, to tell a fired hire's leftover row from a
  // newer hire's (see `bootMayReplace`). Lazy, so the row is read when the
  // write asks for it rather than when the request starts.
  const roster = { ...defineHiredRosterCollection(), prefetchMode: "lazy" as const };

  const registerMailbox = handler({
    name: "mailbox-register-in-inventory",
    inputSchema: registerMailboxInputSchema,
    outputSchema: inventoryMailboxRegisteredSchema,
    resources: { mailboxes, memberships },
    execute: async (_input, ctx) => {
      const mailbox = openMailboxOf(ctx);
      if (mailbox === undefined) {
        throw new MailboxPostRefusedError(
          "mailbox-not-bound",
          `session "${ctx.session.identity.id}" is not an open mailbox, so there is no ` +
            `membership to publish. A mailbox's session is opened by \`openMailboxes\`, and the ` +
            `inventory binder runs after it.`
        );
      }
      if (ctx.org === undefined) {
        throw new Error(
          `mailbox "${ctx.session.identity.id}" cannot register in the inventory: it is open ` +
            `without an organization, and the inventory is org-scoped storage. Open the mailbox ` +
            `with an \`orgId\` and it registers.`
        );
      }

      return publishMailboxRows(ctx as unknown as InventoryWriteContext, kind, mailbox, []);
    }
  });

  const registerSeats = handler({
    name: "inventory-register-seats",
    inputSchema: registerSeatsInputSchema,
    outputSchema: inventorySeatsRegisteredSchema,
    resources: { seats, roster },
    execute: async (input, ctx) => {
      if (ctx.org === undefined) {
        throw new Error(
          "the seat rows cannot be written: this request carries no organization, and the " +
            "inventory is org-scoped storage. Run the seat write under the same `orgId` the " +
            "mailboxes were opened with."
        );
      }

      const orgId = ctx.org.identity.orgId ?? ctx.org.identity.id;
      const problems: string[] = [];
      let written = 0;
      for (const row of input.seats) {
        try {
          if (await publishBootSeatRow(ctx.resources.seats, ctx.resources.roster, orgId, row)) written += 1;
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

  const retireMailboxes = handler({
    name: "inventory-retire-mailboxes",
    inputSchema: retireMailboxesInputSchema,
    outputSchema: inventoryMailboxesRetiredSchema,
    resources: { mailboxes, memberships },
    execute: async (input, ctx) => {
      if (ctx.org === undefined) {
        throw new Error(
          "the retired mailbox rows cannot be removed: this request carries no organization, and " +
            "the inventory is org-scoped storage. Run it under the same `orgId` the mailboxes were opened with."
        );
      }
      // What to delete comes from the membership rows themselves, never from
      // the mailbox row's `members`: registration can leave a membership row
      // the mailbox row no longer lists, and the mailbox row may already be
      // gone. The index is keyed seat-first (`<seatId>/<mailboxId>`), so no
      // prefix reaches one mailbox's rows; the closest the store gets is one
      // listing of the index per run, kept to the retiring ids' rows before
      // anything is deleted. This runs once per boot, and only when the roster
      // carries a template.
      const retiring = new Set(input.ids);
      const stale = (await ctx.resources.memberships.list()).filter((ref) => retiring.has(ref.state.mailboxId));
      // Every membership row first, the mailbox rows last: a run that fails
      // partway leaves the mailbox row standing, and the next run lists and
      // finishes whatever is left either way.
      for (const ref of stale) {
        await ctx.resources.memberships.delete(membershipKey(ref.state.seatId, ref.state.mailboxId));
      }
      let retired = 0;
      for (const id of input.ids) {
        if ((await ctx.resources.mailboxes.getOptional(id)) === undefined) continue;
        await ctx.resources.mailboxes.delete(id);
        retired += 1;
      }
      return { retired };
    }
  });

  return {
    [INVENTORY_REGISTER_MAILBOX]: {
      block: registerMailbox,
      description:
        "Publish this mailbox's row and its membership rows into the org's live inventory, " +
        "from the mailbox's own session state. Boot machinery: takes no input, and re-running " +
        "it writes the same rows."
    },
    [INVENTORY_REGISTER_SEATS]: {
      block: registerSeats,
      description:
        "Write the org's seat rows into the live inventory. Boot machinery, called once by " +
        "`openInventory` with the roster it was hired from."
    },
    [INVENTORY_RETIRE_MAILBOXES]: {
      block: retireMailboxes,
      description:
        "Remove the mailbox rows of ids the roster now declares as project talk templates. Boot " +
        "machinery, called once by `openInventory`."
    }
  };
}

/**
 * The three internal entries that change a mailbox after it opens, built for
 * one kind: set up, subscribe and unsubscribe.
 *
 * Each changes the session with one versioned write (`atomicState`), which the
 * runtime re-runs on the state a conflict hands back, so two changes at once
 * both land and neither is lost. The change is computed from that fresh state
 * every time (`mailbox-membership.ts`), never from what the request first read.
 * Then, on a kind carrying the inventory, the rows follow the session.
 *
 * Internal only. Members, task lists and who works them are what a post's wake
 * and a list's hand-off read, so the app reaches these entries and a client
 * never does.
 */
/** How many times a membership change publishes before it leaves the rows to the next change or boot. */
const PUBLISH_PASSES = 4;

function membershipEntriesFor(kind: string, boardIds: readonly string[], inventory: boolean) {
  const resources = inventory ? { resources: MAILBOX_ROW_COLLECTIONS } : {};

  /** The open mailbox this entry may change, or a refusal naming why not. */
  const changeable = (ctx: BlockContext): MailboxSessionState => {
    const mailbox = openMailboxOf(ctx);
    if (mailbox === undefined) {
      throw new MailboxPostRefusedError(
        "mailbox-not-bound",
        `session "${ctx.session.identity.id}" is not an open mailbox, so it has no members to change.`
      );
    }
    if (talkProjectOf(ctx.session.state) !== undefined) {
      throw new Error(
        `session "${ctx.session.identity.id}" is a project's talk session. Its room's members are the ` +
          "project's, changed on the project, not here."
      );
    }
    return mailbox;
  };

  /** Write the rows from the state the session now holds, on a kind carrying the inventory. */
  const publish = async (
    ctx: BlockContext,
    mailbox: MailboxSessionState,
    removed: readonly string[],
    description?: string
  ) => {
    if (!inventory) return;
    if (ctx.org === undefined) {
      throw new Error(
        `mailbox "${ctx.session.identity.id}" cannot write its inventory rows: it is open without an ` +
          "organization, and the inventory is org-scoped storage."
      );
    }
    await publishMailboxRows(ctx as unknown as InventoryWriteContext, kind, mailbox, removed, description);
  };

  /** One versioned membership write, then the rows. */
  const change = async (
    ctx: BlockContext,
    next: (current: MailboxSessionState, lists: readonly string[]) => MembershipFields | undefined,
    removed: readonly string[]
  ) => {
    const opened = changeable(ctx);
    const write = (mutator: (state: Readonly<Record<string, unknown>>) => Partial<Record<string, unknown>>) =>
      ctx.session.atomicState(mutator);
    const written =
      (await withOutcome(
        write,
        (state: Readonly<Record<string, unknown>>) => {
          // Fresh on every run, including the re-run a version conflict makes.
          const current = boundMailbox(state) ?? opened;
          const fields = next(current, listsHeld(mailboxBoardNamesFor(ctx.session.identity.id, boardIds), current));
          return {
            state: fields ?? {},
            result: fields === undefined ? current : { ...current, ...fields }
          };
        }
      )) ?? opened;
    // Published even when nothing changed: a retry of a change whose rows never
    // landed (the write committed, the request died before this line) repairs them.
    //
    // The rows follow the session as committed, not this request's copy: a
    // change that committed after this one can publish before it, and this
    // one's rows would then land last and stale. So after each publish, read
    // the session again (a write that changes nothing re-reads the store) and
    // publish again until the rows match it. Whichever publish lands last
    // checked the session after it landed.
    let published = written;
    let gone = [...removed];
    for (let pass = 0; pass < PUBLISH_PASSES; pass++) {
      await publish(ctx, published, gone);
      const committed = (await withOutcome(write, (state: Readonly<Record<string, unknown>>) => ({
        state: {},
        result: boundMailbox(state)
      }))) ?? published;
      if (deepEqual(committed.members, published.members)) break;
      gone = [...gone, ...published.members];
      published = committed;
    }
    return { members: written.members };
  };

  const setUp = handler({
    name: "mailbox-set-up",
    inputSchema: setUpInputSchema,
    outputSchema: membershipChangedSchema,
    ...resources,
    execute: async (input: z.infer<typeof setUpInputSchema>, ctx) => {
      const mailbox = changeable(ctx as unknown as BlockContext);
      if (mailbox.origin !== "runtime") {
        throw new Error(
          `mailbox "${ctx.session.identity.id}" was opened from a file. Setting up is for a mailbox ` +
            "opened while the app runs; a file's mailbox registers through `openInventory`."
        );
      }
      // A repair passes no description; the session keeps the one its setup gave.
      const description = input.description ?? ctx.session.metadata.description;
      await publish(ctx as unknown as BlockContext, mailbox, [], description);
      return { members: mailbox.members };
    }
  });

  const subscribe = handler({
    name: "mailbox-subscribe",
    inputSchema: subscribeInputSchema,
    outputSchema: membershipChangedSchema,
    ...resources,
    execute: (input: z.infer<typeof subscribeInputSchema>, ctx) =>
      change(
        ctx as unknown as BlockContext,
        (current, lists) => subscribedFields(current, input.workers, input.worksTaskList === true, lists),
        []
      )
  });

  const unsubscribe = handler({
    name: "mailbox-unsubscribe",
    inputSchema: unsubscribeInputSchema,
    outputSchema: membershipChangedSchema,
    ...resources,
    execute: (input: z.infer<typeof unsubscribeInputSchema>, ctx) =>
      change(ctx as unknown as BlockContext, (current, lists) => unsubscribedFields(current, input.workers, lists), input.workers)
  });

  return {
    [MAILBOX_SET_UP_ACTION]: { block: setUp },
    [MAILBOX_SUBSCRIBE_ACTION]: { block: subscribe },
    [MAILBOX_UNSUBSCRIBE_ACTION]: { block: unsubscribe }
  };
}

export interface DefineMailboxFlowOptions {
  /**
   * The fan-out slot: a block run once per declared member per post, outside
   * the post's queue hold. Absent by default — a mailbox with no slot lands
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
   * The MINTED ledger ids of every board this roster's mailboxes declared —
   * `<mailboxId>.<boardName>`, never a local name.
   *
   * Supplied by `mailboxInstances` from the roster it is validating, not by an
   * app: a board is declared in a `MAILBOX.md`, and an id is minted from where
   * that file sits. Absent, this kind holds no board and carries neither board
   * action — which is exactly the shape it had before boards existed.
   *
   * One flat list for every mailbox on the instance, because a mailbox kind is
   * a singleton and its sessions are the mailboxes: each session filters the
   * list down to its own by id, and a board id splits into its mailbox and its
   * name unambiguously (a board name carries no dot).
   */
  boards?: readonly string[];

  /**
   * The mailboxes that declared `boardActions: true`, by mailbox id. Each of
   * their boards gets the eight task tools as actions, named
   * `<tool>_<board id with dots as underscores>`. Supplied by
   * `mailboxInstances` from the roster, as `boards` is, never by an app.
   *
   * Off by default, because anyone who can reach a mailbox can then settle
   * or reassign its rows. A mailbox not listed keeps exactly the actions it
   * had before.
   */
  boardActions?: readonly string[];

  /**
   * Carry the live inventory's writer half — the two actions
   * {@link inventoryWriterActions} builds, and the collections they write.
   *
   * Absent by default, and absent means absent: no collection is declared, no
   * action exists, and a mailbox behaves exactly as it did before the inventory
   * existed. An entry that is only there to do nothing is worse than none,
   * which is how the fan-out slot beside it works too.
   *
   * Supplied by `mailboxInstances({ inventory: true })` for the built-in, so an
   * app turns the inventory on at one call rather than by rebuilding the kind.
   */
  inventory?: boolean;

  /**
   * The route, from `routeByPurpose(seats, { model })`. A mailbox on this kind
   * that declares `routing:` sends each person's post to one member, the one
   * the route picks, instead of to every member. A mailbox without the line
   * fans out as before. Needs `notify`: the route picks a member, and the
   * notify block delivers to it.
   */
  route?: MailboxRoute;

  /**
   * Each routed mailbox's `routing:`, by mailbox id. Supplied by
   * `mailboxInstances` from the roster, as `boards` is, never by an app: it is
   * read from the files at every boot and never stored, so an edited
   * `routing:` reaches an open mailbox at the next boot.
   */
  routing?: Readonly<Record<string, MailboxRouting>>;

  /**
   * The talk template this kind's project talk sessions run under: the seats
   * a post in a project's room wakes, and the room's charter. Supplied by
   * `mailboxInstances` from the org-level default or a `MAILBOX.md` marked
   * `mintFor:`, as `boards` is, never by an app. Built onto the kind at every
   * boot and never written into a session, so an edited template reaches
   * every project's room at the next boot. Absent, a talk post wakes nobody.
   */
  template?: TalkTemplateFacts;
}

/**
 * What {@link defineMailboxFlow} returns: the flow factory, plus the one thing
 * `mailboxInstances` needs of it.
 *
 * `withBoards` is NOT on {@link MailboxKind}, and that is the point. A kind a
 * caller wrote is zero-arg and stays zero-arg; handing board ids through the
 * public kind contract would be a permanent widen bought for no consumer that
 * exists. Instead, a kind that CAN hold boards is one this function built, and
 * a record pairing `boards:` with any other kind is refused by name at bind.
 */
export type MailboxFlowFactory = ReturnType<typeof defineFlow> & {
  /** The same kind, rebuilt holding these minted board ids. */
  withBoards: (boards: readonly string[]) => MailboxFlowFactory;
  /** The same kind, rebuilt with each routed mailbox's `routing:`, by mailbox id. */
  withRouting: (routing: Readonly<Record<string, MailboxRouting>>) => MailboxFlowFactory;
  /** The same kind, rebuilt exposing these mailboxes' board task actions. */
  withBoardActions: (mailboxIds: readonly string[]) => MailboxFlowFactory;
  /** The same kind, rebuilt holding a project talk template's seats and charter. */
  withTemplate: (template: TalkTemplateFacts) => MailboxFlowFactory;
};

/** Is this mailbox kind one {@link defineMailboxFlow} built? */
export function holdsBoards(kind: unknown): kind is MailboxFlowFactory {
  return (
    typeof kind === "function" &&
    typeof (kind as Partial<MailboxFlowFactory>).withBoards === "function"
  );
}

/** The key a kind {@link defineMailboxFlow} built with a route carries that route under. */
const KIND_ROUTE = Symbol("mailbox-kind-route");

/**
 * The route a mailbox kind was built with, or `undefined` for a kind built
 * without one, or one {@link defineMailboxFlow} did not build. The binder reads
 * it to check a `routing:` line. Not re-exported from the package root.
 */
export function routeOf(kind: unknown): MailboxRoute | undefined {
  return typeof kind === "function" ? (kind as { [KIND_ROUTE]?: MailboxRoute })[KIND_ROUTE] : undefined;
}

/** The key a kind {@link defineMailboxFlow} built with a notify slot carries `true` under. */
const KIND_WAKES = Symbol("mailbox-kind-wakes");

/**
 * Was this mailbox kind built with a notify slot, so a post can wake anyone?
 * `false` for a kind built without one, or one {@link defineMailboxFlow} did
 * not build. The binder reads it to refuse a talk template whose seats would
 * never be woken. Not re-exported from the package root.
 */
export function wakesSeats(kind: unknown): boolean {
  return typeof kind === "function" && (kind as { [KIND_WAKES]?: boolean })[KIND_WAKES] === true;
}

/**
 * Build a mailbox kind.
 *
 * Every kind built here carries the same identity contract the registry
 * enforces: `cardinality: "singleton"`, so `flow.id === flow.kind`. A custom
 * kind passed through `mailboxInstances`'s `kinds` map must carry it too.
 *
 * @param options `notify`: the per-member fan-out block, absent by default.
 *   `route`: from `routeByPurpose`, for mailboxes that declare `routing:`.
 *   `boards`, `routing` and `boardActions`: supplied by the binder from the roster.
 * @returns The flow factory. Call it (no arguments) to mint the one instance.
 */
export function defineMailboxFlow(options: DefineMailboxFlowOptions = {}): MailboxFlowFactory {
  const notify = options.notify;
  const boardIds = [...(options.boards ?? [])].sort();

  // Only `routeByPurpose` makes a route, so the order a post is placed in, the
  // one-call cap and the record hold on every routed mailbox. The route
  // carries its block under a key only this package holds.
  const routeBlock = options.route?.[ROUTE_BLOCK];
  if (options.route !== undefined && routeBlock === undefined) {
    throw new Error("defineMailboxFlow: `route` must be what routeByPurpose(seats, { model }) returned.");
  }
  if (routeBlock !== undefined && notify === undefined) {
    throw new Error(
      "defineMailboxFlow: a `route` needs a `notify` block to deliver to. Pass the wake as well: " +
        "`defineMailboxFlow({ notify: wakeMemberSeats(seats), route })`."
    );
  }
  const routing = options.routing ?? {};

  // One declaration object per minted id, always from the memo. Two separate
  // `defineTaskCollection` calls sharing an id share ROWS and not POLICY — the
  // handed-off assignee freeze is a WeakSet on the declaration — so the seat's
  // board and the mailbox's own writes must pass one value.
  const boardResources = Object.fromEntries(
    boardIds.map((id) => [id, mailboxBoardLedger(id)])
  );

  // Built once per kind, not per request. Present on every kind, board or no
  // board: a mailbox can hold a task list in its own session, which no file
  // declares and the kind cannot know about when it is built.
  const readMailbox = readMailboxFor(boardIds);
  const fileTask = fileTaskFor(boardIds);
  const readBoard = readBoardFor(boardIds);

  // Only for the boards of mailboxes that opted in. Built from the minted ids,
  // so a mailbox with no board, or one that did not opt in, adds nothing.
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
          `\`<tool>_${taskToolSuffix(id)}\`. Rename a mailbox or a board.`
      );
    }
  }
  const boardTaskActions = Object.assign(
    {},
    ...actionBoards.map((id) => boardTaskActionsFor(boardIds, id))
  ) as Record<string, ActionConfig>;

  // Built on the FACTORY, never behind a `kind === "mailbox"` test inside the
  // block: what the inventory promises is that EVERY open mailbox has a row,
  // and a kind check in there would make that false for every kind but this
  // one. What decides whether the rows are written is whether the app asked.
  const inventoryActions =
    options.inventory === true ? inventoryWriterActions(MAILBOX_KIND) : undefined;
  const membershipEntries = membershipEntriesFor(MAILBOX_KIND, boardIds, options.inventory === true);

  /**
   * This mailbox's `routing:` fallback, when the route places this post: a
   * person's post (not `seatAuthored`) to a mailbox that declares the line, on
   * a kind built with a route. A seat's post is never routed; it fans out as
   * unrouted. A claimed `author` is not that mark.
   */
  const fallbackFor = (post: MailboxFanOutInput, ctx: BlockContext): string | undefined =>
    routeBlock === undefined || post.seatAuthored === true
      ? undefined
      : routing[ctx.session.identity.id]?.fallback;

  // Iterated from the session's own declared roster, read here rather than
  // carried in the payload: the roster is the mailbox's, and a caller-supplied
  // copy would be caller-controllable input on a delivery path (BP-031).
  const rosterDeliveries = (post: MailboxFanOutInput, ctx: BlockContext): MailboxNotifyInput[] =>
    (boundMailbox(ctx.session.state)?.members ?? []).map((member) => ({
      mailboxId: ctx.session.identity.id,
      member,
      postId: post.postId,
      body: post.body,
      principal: post.principal,
      ...(post.author === undefined ? {} : { author: post.author }),
      ...(post.seatAuthored === true ? { seatAuthored: true as const } : {})
    }));

  /** A routed post's delivery: the one member the route picked, or none when it placed the post with nobody. */
  const routedDeliveries = ({ post, member, recent }: RouteDecision, ctx: BlockContext): MailboxNotifyInput[] =>
    member === undefined
      ? []
      : [
          {
            mailboxId: ctx.session.identity.id,
            member,
            postId: post.postId,
            body: post.body,
            principal: post.principal,
            ...(post.author === undefined ? {} : { author: post.author }),
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
  const fanOutHead = sequencer({ name: "mailbox-fan-out", inputSchema: mailboxFanOutInputSchema });
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
                ({ postCase, ...post }: MailboxFanOutInput, ctx: BlockContext) => ({
                  post,
                  fallback: fallbackFor(post, ctx),
                  recent: postCase?.recent ?? [],
                  ...(postCase?.holder === undefined ? {} : { holder: postCase.holder })
                }),
                (request: { fallback?: string }) => request.fallback !== undefined,
                sequencer({ name: "mailbox-routed-delivery", inputSchema: routeRequestSchema })
                  .step(routeBlock)
                  .map((decision: RouteDecision, ctx) => routedDeliveries(decision, ctx as BlockContext))
              ],
              roster: [
                (post: MailboxFanOutInput) => post,
                (post: MailboxFanOutInput, ctx: BlockContext) => fallbackFor(post, ctx) === undefined,
                handler({
                  name: "mailbox-roster-delivery",
                  inputSchema: mailboxFanOutInputSchema,
                  outputSchema: z.array(mailboxNotifyInputSchema),
                  execute: rosterDeliveries
                })
              ]
            })
            .forEach((deliveries: MailboxNotifyInput[]) => deliveries, deliver);

  // Hands the append off to a SEPARATE request so the queue hold covers the
  // append only. Fan-out latency must not count against the next poster's
  // 30s queue-wait budget — past it the waiting post is dropped, never written.
  const handOff =
    fanOut === undefined
      ? undefined
      : dispatcher({
          name: "mailbox-hand-off",
          action: "onPosted",
          inputSchema: mailboxFanOutInputSchema,
          // The mailbox's own session. `{ id }`, never `{ key }`: a key-derived
          // child id is hashed with the parent session and lineage, so it
          // cannot name a shared mailbox.
          session: { id: (_input, ctx) => ctx.session.identity.id }
        }).rescue([{ block: noteHandOffRefusal }]);

  const fanOutOf = (line: MailboxTranscriptLine): MailboxFanOutInput => ({
    postId: line.id,
    body: line.body,
    principal: line.principal,
    ...(line.author === undefined ? {} : { author: line.author }),
    ...(line.seatAuthored === true ? { seatAuthored: true as const } : {})
  });

  /**
   * One mailbox post. Public `post` and a dispatched `post` share the
   * non-seat append. The seat post action is the only one that passes
   * `seatAuthored`, and it does not read that from `input`.
   */
  const mailboxPostFor = (seatAuthored: boolean) => {
    const appendPlain = appendPostFor(seatAuthored);
    if (handOff === undefined) return appendPlain;
    const head = sequencer({
      name: seatAuthored ? "mailbox-post-internal" : "mailbox-post",
      inputSchema: mailboxPostInputSchema,
      outputSchema: mailboxTranscriptLineSchema
    });
    if (routeBlock === undefined) return head.step(appendPlain).tap(fanOutOf, handOff);
    return head
      .step(appendRoutedPostFor(routing, seatAuthored))
      .tap(
        ({ line, postCase }: KeptPost) => ({ ...fanOutOf(line), ...(postCase === undefined ? {} : { postCase }) }),
        handOff
      )
      .map(({ line }: KeptPost) => line);
  };
  const post = mailboxPostFor(false);
  const seatLine = mailboxPostFor(true);

  // A seat's answer to a routed post, on the only kind that routes one: the
  // line, handed off like any seat's line, or nothing when the post has its
  // answer already.
  const answer =
    handOff === undefined || routeBlock === undefined
      ? undefined
      : sequencer({ name: "mailbox-answer", inputSchema: mailboxAnswerInputSchema })
          .step(appendAnswer)
          .tapIf((line: MailboxTranscriptLine | null) => line !== null, fanOutOf, handOff);

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
  // request, as a mailbox's fan-out is, so the post queue's hold covers the
  // append only. Each delivery is routed: every seat's reply lands in the
  // room through this session's `answer`. Declared only when there is a seat
  // to wake and a notify block to wake it with.
  const templateSeats = [...(options.template?.seats ?? [])];
  const talkDeliveries = handler({
    name: "mailbox-talk-deliveries",
    inputSchema: talkFanOutInputSchema,
    outputSchema: z.array(mailboxNotifyInputSchema),
    resources: TALK_RESOURCES,
    execute: async (posted: TalkFanOutInput, ctx): Promise<MailboxNotifyInput[]> => {
      const recent = await recentTalkLines(ctx as unknown as BlockContext, posted.projectId, posted.seq);
      const postId = roomLineKey(posted.projectId, posted.seq);
      // One wake per seat; each is recorded, woken and marked in its own
      // rescued run (`talkDeliver`), so one seat's failure is that seat's alone.
      return templateSeats.map((member) => ({
        mailboxId: ctx.session.identity.id,
        member,
        postId,
        body: posted.body,
        principal: posted.principal,
        routed: true,
        recent
      }));
    }
  });
  // One delivery per post, seat and session, recorded `pending` before the
  // seat is woken and marked `delivered` after (`talkDelivered`): its token is
  // how the seat's answer proves which seat it speaks for. A replay wakes a
  // still-pending delivery again with its token; a delivered one comes back
  // with no token and is not woken.
  const talkRecorded = handler({
    name: "mailbox-talk-recorded",
    inputSchema: mailboxNotifyInputSchema,
    outputSchema: mailboxNotifyInputSchema,
    resources: TALK_RESOURCES,
    execute: async (delivery: MailboxNotifyInput, ctx): Promise<MailboxNotifyInput> => {
      const answerToken = await recordTalkDelivery(ctx as unknown as BlockContext, {
        projectId: talkProjectOf(ctx.session.state) as string,
        postId: delivery.postId as string,
        seat: delivery.member,
        sessionId: delivery.mailboxId
      });
      return answerToken === undefined ? delivery : { ...delivery, answerToken };
    }
  });
  const toWake = (delivery: MailboxNotifyInput): boolean => delivery.answerToken !== undefined;
  // After a seat's wake has been dispatched: its delivery stops being one a
  // replay would wake again.
  const talkDelivered = handler({
    name: "mailbox-talk-delivered",
    inputSchema: mailboxNotifyInputSchema,
    outputSchema: z.object({ delivered: z.literal(true) }),
    resources: TALK_RESOURCES,
    execute: async (delivery: MailboxNotifyInput, ctx) => {
      await markTalkDelivered(ctx as unknown as BlockContext, {
        postId: delivery.postId as string,
        seat: delivery.member,
        sessionId: delivery.mailboxId
      });
      return { delivered: true as const };
    }
  });
  // One seat's record, wake and mark, rescued together: a failed record, or a
  // refused or failed wake, skips the mark, so the delivery stays `pending`
  // (or unrecorded) for a replay, and the failure is that seat's alone. `notify` runs bare here rather than as `deliver`,
  // whose own rescue would turn the refusal into a success the mark follows.
  const talkDeliver =
    notify === undefined
      ? undefined
      : sequencer({ name: "mailbox-talk-deliver", inputSchema: mailboxNotifyInputSchema })
          .step(talkRecorded)
          .tapIf(toWake, notify)
          .stepIf(toWake, talkDelivered)
          .rescue([{ block: noteDeliveryRefusal }]);
  // Every seat attempted, then any refused one reported: a fan-out with a seat
  // left `pending` did not complete, and says so.
  const talkSettled = handler({
    name: "mailbox-talk-settled",
    inputSchema: z.array(z.unknown()),
    outputSchema: z.object({ woken: z.number() }),
    execute: async (outcomes: unknown[]) => {
      const refused = outcomes.filter(
        (outcome): outcome is { delivered: false; reason: string } =>
          typeof outcome === "object" && outcome !== null && (outcome as { delivered?: unknown }).delivered === false
      );
      if (refused.length > 0) {
        throw new Error(
          `${refused.length} of ${outcomes.length} seat wakes were not dispatched and stay pending for a replay:\n  - ` +
            refused.map((outcome) => outcome.reason).join("\n  - ")
        );
      }
      return { woken: outcomes.length };
    }
  });
  const talkFanOut =
    talkDeliver === undefined || templateSeats.length === 0
      ? undefined
      : sequencer({ name: "mailbox-talk-fan-out", inputSchema: talkFanOutInputSchema })
          .step(talkDeliveries)
          .forEach((deliveries: MailboxNotifyInput[]) => deliveries, talkDeliver)
          .step(talkSettled);
  const talkPostEntry =
    talkFanOut === undefined
      ? talkPost
      : sequencer({ name: "mailbox-talk-post", inputSchema: mailboxPostInputSchema, outputSchema: roomLineSchema })
          .step(talkPost)
          .tap(
            (line: RoomLine): TalkFanOutInput => ({
              projectId: line.projectId,
              seq: line.seq,
              body: line.body,
              principal: line.userId
            }),
            dispatcher({
              name: "mailbox-talk-hand-off",
              action: TALK_POSTED_ACTION,
              inputSchema: talkFanOutInputSchema,
              session: { id: (_input, ctx) => ctx.session.identity.id }
            }).rescue([{ block: noteHandOffRefusal }])
          );

  const postEntry = router({
    name: "mailbox-post-entry",
    inputSchema: mailboxPostInputSchema,
    outputSchema: z.union([mailboxTranscriptLineSchema, roomLineSchema]),
    routes: [anyBlock(post), anyBlock(talkPostEntry)],
    execute: (_input, ctx) => {
      if (isTalk(ctx)) return anyBlock(talkPostEntry);
      refuseTemplateMailbox(ctx);
      return anyBlock(post);
    }
  });

  const talkRead = talkReadFor(options.template);

  const readInputSchema = z.object({ after: z.number().int().min(0).optional() }).strict();
  const readEntry = router({
    name: "mailbox-read-entry",
    inputSchema: readInputSchema,
    outputSchema: z.union([mailboxReadOutputSchema, talkReadOutputSchema]),
    routes: [anyBlock(readMailbox), anyBlock(talkRead)],
    // A mailbox's read takes no cursor: it returns the recent transcript.
    execute: (input, ctx) => {
      if (isTalk(ctx)) return anyBlock(talkRead).connectInput(() => ({ after: input.after ?? 0 }));
      refuseTemplateMailbox(ctx);
      return anyBlock(readMailbox).connectInput(() => ({}));
    }
  });

  // On a kind without a route there is no mailbox answer, so a talk session's
  // is the only path; anywhere else it refuses `talk-not-bound`.
  const answerEntry =
    answer === undefined
      ? talkAnswer
      : router({
          name: "mailbox-answer-entry",
          inputSchema: mailboxAnswerInputSchema,
          outputSchema: z.union([mailboxTranscriptLineSchema.nullable(), roomLineSchema.nullable()]),
          routes: [anyBlock(answer), anyBlock(talkAnswer)],
          execute: (_input, ctx) => {
            if (isTalk(ctx)) return anyBlock(talkAnswer);
            refuseTemplateMailbox(ctx);
            return anyBlock(answer);
          }
        });

  const flow = defineFlow({
    kind: MAILBOX_KIND,
    // Not a preference: it is the declared mechanism for "one kind means one
    // thing". The registry throws `singleton-id-mismatch` unless id === kind.
    cardinality: "singleton",
    session: { stateSchema: mailboxSessionStateSchema },
    // The ledgers, and nothing else: no board, no drain, no task entry. A
    // mailbox HOLDS rows; running them stays on the seat's side of the fence,
    // and `defineFlow` asks nothing of a flow that declares only a collection.
    // And the one collection every run-time task list lives in, on every kind,
    // for the reason the two board actions are on every kind.
    resources: { ...boardResources, [MAILBOX_TASK_LISTS_ID]: mailboxTaskListsCollection() },
    actions: {
      post: {
        block: postEntry,
        description:
          "Post a line to this mailbox. The mailbox is the session; `author` is an unverified claim. " +
          "On a project's talk session, the line goes to the project's room, members only.",
        // Keyed on the session by default, so two posts on ONE mailbox
        // serialise and posts on two mailboxes never contend.
        concurrency: "queue"
      },
      read: {
        block: readEntry,
        // Names boards only on a kind that holds one: this string is what a
        // model is told the action does, and a boardless kind returns no
        // `boards` key at all.
        description:
          "Read this mailbox's recent transcript lines, members, description and the names of the task " +
          "lists it holds; `after` is ignored. On a project's talk session, read the room's lines after " +
          "`after`, members only."
      },
      join: {
        block: talkJoin,
        description:
          "Join a project's room. Members only. Returns your one talk session on the project: the one " +
          "the project already lists for you, or this session, now bound."
      },
      fileTask: {
        block: fileTask,
        description:
          "File a row onto one of this mailbox's task lists. `author` is an unverified claim, " +
          "checked against the roster and never proof of who called."
      },
      readBoard: {
        block: readBoard,
        description: "Read the rows on one of this mailbox's task lists."
      },
      ...boardTaskActions,
      // `registerMailbox` only. It takes a closed, empty input and derives the
      // row entirely from `ctx.session.state` — the mailbox's own,
      // already-open state — so a caller cannot make it write anything but
      // that mailbox's true members, and calling it early or twice is
      // harmless. Public because the door that reaches it is the app's own
      // action client at boot, and an internal dispatch resolves from a
      // different map.
      //
      // `registerSeats` is deliberately NOT here — see `internal.actions`
      // below for why.
      ...(inventoryActions === undefined
        ? {}
        : { [INVENTORY_REGISTER_MAILBOX]: inventoryActions[INVENTORY_REGISTER_MAILBOX] })
    },
    internal: {
      actions: {
        // `read`, the board actions, and `post` are the same blocks a client
        // reaches. A dispatched `post` is not a seat: `internal` is the
        // generic cross-flow address. A seat's own line is `seatPost`, and
        // only that entry sets `seatAuthored`.
        //
        // Both registrations are required, and so is repeating `concurrency`:
        // `resolveEntry` reads one map per dispatch type and never falls
        // through to another, so a name in `actions` is unreachable by an
        // internal dispatch, and the arbiter reads `concurrency` off whichever
        // entry it resolved. Sharing the block ref is the whole dedupe there is.
        post: { block: postEntry, concurrency: "queue" },
        [MAILBOX_SEAT_POST_ACTION]: { block: seatLine, concurrency: "queue" },
        // Here only, never in `actions`: the answer names the post it answers,
        // so a caller who could reach it could take that post's one answer.
        // On the post queue's key (the session), so answers and posts are one
        // line at a time.
        [MAILBOX_ANSWER_ACTION]: { block: answerEntry, concurrency: "queue" as const },
        read: { block: readEntry },
        // `bind` is here only: it names its project, and the trusted callers
        // that reach it are a project's create and the app's own code.
        bind: { block: talkBind },
        join: { block: talkJoin },
        fileTask: { block: fileTask },
        readBoard: { block: readBoard },
        // Beside `fileTask` and `readBoard`, so another flow's dispatch lands on
        // the same implementation a caller reaches.
        ...boardTaskActions,
        // Here only, never in `actions`: who is on a mailbox decides who a post
        // wakes, so the app changes it and a client never does.
        ...membershipEntries,
        // `registerSeats` lives ONLY here, never in the public `actions` map
        // above. Unlike `registerMailbox`, it has no session state to derive
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
              [INVENTORY_RETIRE_MAILBOXES]: inventoryActions[INVENTORY_RETIRE_MAILBOXES]
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
  // which is what stops "give this mailbox a board" and "wake its members"
  // from being two mutually exclusive ways to configure one kind.
  const factory = Object.assign(flow, {
    withBoards: (boards: readonly string[]) => defineMailboxFlow({ ...options, boards }),
    withRouting: (routing: Readonly<Record<string, MailboxRouting>>) =>
      defineMailboxFlow({ ...options, routing }),
    withBoardActions: (boardActions: readonly string[]) =>
      defineMailboxFlow({ ...options, boardActions }),
    withTemplate: (template: TalkTemplateFacts) => defineMailboxFlow({ ...options, template })
  }) as MailboxFlowFactory;
  if (options.route !== undefined) Object.assign(factory, { [KIND_ROUTE]: options.route });
  if (options.notify !== undefined) Object.assign(factory, { [KIND_WAKES]: true });
  return factory;
}

/**
 * The built-in kind, seeded by `mailboxInstances` when the app names none.
 *
 * An app registers nothing to use mailboxes. A custom kind is the rare escape
 * hatch, passed through the `kinds` map at boot.
 */
export const mailboxFlow = defineMailboxFlow();
