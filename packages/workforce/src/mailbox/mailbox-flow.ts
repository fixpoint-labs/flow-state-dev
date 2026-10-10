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
 */

import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { readCommitted, withOutcome } from "@flow-state-dev/core/helpers";
import type { ActionConfig, BlockContext, BlockDefinition, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { taskToolActions, taskToolSuffix } from "@flow-state-dev/orchestration";
import { taskSchema } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import {
  mailboxBoardId,
  mailboxBoardLedger,
  mailboxBoardNamesFor,
  resolveMailboxBoard
} from "./mailbox-board";
import { emitMailboxPostLine, readMailboxPostLines } from "./mailbox-items";
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
  /** The declared roster. Written once at open; read-only on the post path. */
  members: z.array(z.string()),
  /** The mailbox's charter — the `MAILBOX.md` body. */
  instructions: z.string(),
  /**
   * Lines a mailbox kept in state before each post became its own
   * `mailbox-post` item. Read-only: `read` returns them ahead of the posted
   * lines, and nothing writes here any more.
   */
  transcript: z.array(mailboxTranscriptLineSchema).default([])
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
    author: z.string().min(1)
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
   * The board NAMES this mailbox declared — never the rows, which are a board
   * read. **Absent, not `[]`, on a mailbox that declares none**, so a mailbox
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
  | "unknown-assignee";

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
 * The line a post makes, or the mailbox's refusal. Writes nothing: each append
 * keeps the line itself.
 */
function lineFor(input: MailboxPostInput, ctx: BlockContext, seatAuthored: boolean): MailboxTranscriptLine {
  const mailbox = boundMailbox(ctx.session.state);
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
      const mailbox = boundMailbox(ctx.session.state);
      if (mailbox === undefined) {
        throw new MailboxPostRefusedError(
          "mailbox-not-bound",
          `session "${ctx.session.identity.id}" is not an open mailbox.`
        );
      }
      const boards = mailboxBoardNamesFor(ctx.session.identity.id, boardIds);
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
     * The worker this task is for, by its name as `discover` lists it, or a
     * name a board over this list declares as its own. Checked when the kind
     * was built with `checkAssignee`.
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
  const mailbox = boundMailbox(ctx.session.state);
  if (mailbox === undefined) {
    throw new MailboxPostRefusedError(
      "mailbox-not-bound",
      `session "${ctx.session.identity.id}" is not an open mailbox. A mailbox's session is ` +
        `opened by \`openMailboxes\`; naming an id nobody opened creates an empty session, not a mailbox.`
    );
  }

  const mailboxId = ctx.session.identity.id;
  const held = mailboxBoardNamesFor(mailboxId, boardIds);
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
  let ledger: MailboxTaskLedger | undefined;
  try {
    ledger = await resolveMailboxBoard(ctx, boardId);
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
const fileTaskFor = (
  boardIds: readonly string[],
  checkAssignee: DefineMailboxFlowOptions["checkAssignee"]
) =>
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

      // A task for a worker nobody has is refused here, while the filer is
      // still in the turn that can correct it, rather than failing at hand-over.
      if (input.assignee !== undefined && checkAssignee !== undefined) {
        const refused = checkAssignee(input.assignee, boardId, ctx);
        if (refused !== undefined) {
          throw new MailboxPostRefusedError("unknown-assignee", refused);
        }
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
   * post is delivered to. Absent on every other delivery. A kind that hears
   * posts decides what it does with the mark; the built-in agent kind posts
   * its reply into the mailbox.
   */
  routed: z.boolean().optional(),
  /**
   * On a routed delivery, the mailbox's last lines before the post (up to
   * 20), oldest first: the ones the route read. Absent on every other
   * delivery.
   */
  recent: z.array(mailboxTranscriptLineSchema).optional()
});

export type MailboxNotifyInput = z.infer<typeof mailboxNotifyInputSchema>;

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

/** Nothing a caller supplies reaches the mailbox's row. */
const registerMailboxInputSchema = z.object({}).strict();

/** What a registration reports back: the row it wrote, so a caller can read it without a second read. */
export const inventoryMailboxRegisteredSchema = z.object({
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

/**
 * Write one seat row from a boot. A seat's row is its standard worker's, the
 * same on every process, so a later boot's write replaces an earlier one's.
 */
async function publishBootSeatRow(seats: ResourceCollectionRef, row: SeatInventoryRow): Promise<void> {
  await seats.upsert(row.id, row);
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
 *       actions: { registerSeatsInInventory: writer.registerSeatsInInventory }
 *     }
 *   });
 */
export function inventoryWriterActions(kind: string) {
  // Fresh per call. Two collections declared from one factory share storage —
  // a collection is addressed by its pattern and scope, never by object
  // identity — so this costs nothing and keeps the declaration local to the
  // flow that installs it.
  const mailboxes = defineMailboxInventoryCollection();
  const memberships = defineMembershipIndexCollection();
  const seats = defineSeatInventoryCollection();

  const registerMailbox = handler({
    name: "mailbox-register-in-inventory",
    inputSchema: registerMailboxInputSchema,
    outputSchema: inventoryMailboxRegisteredSchema,
    resources: { mailboxes, memberships },
    execute: async (_input, ctx) => {
      const mailbox = boundMailbox(ctx.session.state);
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

      const id = ctx.session.identity.id;
      // The mailbox's OWN session state, and nothing else. The binder carries
      // no members, deliberately: a roster's `members:` is what a file said
      // when it was last read, and an edit to it never reaches a session that
      // is already open. Copying it here would republish that file-time answer
      // under a live name.
      const members = [...mailbox.members];

      // Every member's key is built up front, before anything is written.
      // `membershipKey` throws on a member id that can never be one — and
      // that failure is permanent, not flaky, so it must not land after some
      // rows are already committed: a caller that retries a boot gets the
      // same throw on the same member every time, and a run that had already
      // written part of itself before hitting it would keep re-adding to a
      // half-written state instead of leaving nothing behind.
      const membershipKeys = members.map((seatId) => membershipKey(seatId, id));

      // The membership rows go FIRST, and the mailbox row that names them
      // goes last. Neither write is transactional with the other — a store
      // failure partway through the loop below still leaves whatever landed
      // before it — so the ordering is what stops the mailbox row from ever
      // claiming a member the index does not have: the row is only written
      // once every membership row it will name already exists. What it does
      // not buy: a membership row from an EARLIER successful run can still
      // outlive this run's mailbox row if this run's own loop fails partway
      // through. That row is stale, not contradictory, and nothing here
      // prunes stale rows in the first place (see `inventoryWriterActions`'s
      // header).
      for (let i = 0; i < members.length; i++) {
        await ctx.resources.memberships.upsert(membershipKeys[i], {
          seatId: members[i],
          mailboxId: id
        });
      }

      // `openedAt` is create-only, so a second boot does not restamp a mailbox
      // that has been open since the first one.
      await ctx.resources.mailboxes.upsert(
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
            "mailboxes were opened with."
        );
      }

      const problems: string[] = [];
      let written = 0;
      for (const row of input.seats) {
        try {
          await publishBootSeatRow(ctx.resources.seats, row);
          written += 1;
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
    }
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
   * Checked before `fileTask` files a task that names an assignee: answer
   * `undefined` to file it, or the sentence to refuse with. Pass the worker
   * lookup's check — `createWorkerLookup(...).filingCheck(aliases)` — so a
   * task can't be filed for a worker nobody has. Absent, any assignee is
   * filed as written.
   */
  checkAssignee?: (assignee: string, listId: string, ctx: BlockContext) => string | undefined;

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

  // Built once per kind, not per request, and only when this kind holds a
  // board: with no board there is nothing to file onto and nothing to read, so
  // there is no action rather than an action that always refuses.
  const readMailbox = readMailboxFor(boardIds);
  const fileTask = boardIds.length === 0 ? undefined : fileTaskFor(boardIds, options.checkAssignee);
  const readBoard = boardIds.length === 0 ? undefined : readBoardFor(boardIds);

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

  const flow = defineFlow({
    kind: MAILBOX_KIND,
    // Not a preference: it is the declared mechanism for "one kind means one
    // thing". The registry throws `singleton-id-mismatch` unless id === kind.
    cardinality: "singleton",
    session: { stateSchema: mailboxSessionStateSchema },
    // The ledgers, and nothing else: no board, no drain, no task entry. A
    // mailbox HOLDS rows; running them stays on the seat's side of the fence,
    // and `defineFlow` asks nothing of a flow that declares only a collection.
    resources: boardResources,
    actions: {
      post: {
        block: post,
        description: "Post a line to this mailbox. The mailbox is the session; `author` is an unverified claim.",
        // Keyed on the session by default, so two posts on ONE mailbox
        // serialise and posts on two mailboxes never contend.
        concurrency: "queue"
      },
      read: {
        block: readMailbox,
        // Names boards only on a kind that holds one: this string is what a
        // model is told the action does, and a boardless kind returns no
        // `boards` key at all.
        description:
          boardIds.length === 0
            ? "Read this mailbox's recent transcript lines, members and description."
            : "Read this mailbox's recent transcript lines, members, description and declared board names."
      },
      ...(fileTask === undefined || readBoard === undefined
        ? {}
        : {
            fileTask: {
              block: fileTask,
              description:
                "File a row onto one of this mailbox's boards. `author` is an unverified claim, " +
                "checked against the roster and never proof of who called."
            },
            readBoard: {
              block: readBoard,
              description: "Read the rows on one of this mailbox's boards."
            }
          }),
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
        post: { block: post, concurrency: "queue" },
        [MAILBOX_SEAT_POST_ACTION]: { block: seatLine, concurrency: "queue" },
        // Here only, never in `actions`: the answer names the post it answers,
        // so a caller who could reach it could take that post's one answer.
        // On the post queue's key (the session), so answers and posts are one
        // line at a time.
        ...(answer === undefined ? {} : { [MAILBOX_ANSWER_ACTION]: { block: answer, concurrency: "queue" as const } }),
        read: { block: readMailbox },
        ...(fileTask === undefined || readBoard === undefined
          ? {}
          : { fileTask: { block: fileTask }, readBoard: { block: readBoard } }),
        // Beside `fileTask` and `readBoard`, so another flow's dispatch lands on
        // the same implementation a caller reaches.
        ...boardTaskActions,
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
          : { [INVENTORY_REGISTER_SEATS]: inventoryActions[INVENTORY_REGISTER_SEATS] }),
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

  // The rebuild seam. `options` is closed over, so a kind configured with a
  // notify slot keeps it when the binder hands it the roster's board ids —
  // which is what stops "give this mailbox a board" and "wake its members"
  // from being two mutually exclusive ways to configure one kind.
  const factory = Object.assign(flow, {
    withBoards: (boards: readonly string[]) => defineMailboxFlow({ ...options, boards }),
    withRouting: (routing: Readonly<Record<string, MailboxRouting>>) =>
      defineMailboxFlow({ ...options, routing }),
    withBoardActions: (boardActions: readonly string[]) =>
      defineMailboxFlow({ ...options, boardActions })
  }) as MailboxFlowFactory;
  if (options.route !== undefined) Object.assign(factory, { [KIND_ROUTE]: options.route });
  return factory;
}

/**
 * The built-in kind, seeded by `mailboxInstances` when the app names none.
 *
 * An app registers nothing to use mailboxes. A custom kind is the rare escape
 * hatch, passed through the `kinds` map at boot.
 */
export const mailboxFlow = defineMailboxFlow();
