/**
 * How a worker flow takes a delegated post: the task entry a coordinator's
 * board hands a post row to, and what its ending tells the coordinator.
 *
 * A coordinator files one row on its conversation's board per delegate it
 * picks for a post, under every policy and in every round (`coordinator-flow.ts`).
 * The row carries the post in its server-written payload ({@link postRowSchema}):
 * who wrote it, the coordinator, the conversation's recent lines, its round,
 * the round's deadline when its answer can go back out, and the session it is
 * worked in, resolved when it was filed: the delegate's own session for that
 * conversation, or the session a workstream's record names. The board hands it
 * to {@link DELEGATED_POST_ENTRY} on the delegate's flow, in that session.
 *
 * **One fence.** The entry is a task entry, so the board's claim gate runs in
 * front of it: the row, its attempt and its assignee are verified, the run
 * names itself on the row, the lease is renewed while the turn runs, and the
 * row is settled with the turn's reply, or failed with its error. A second
 * settle (a stale attempt, a turn still running after a cancel) is refused by
 * the claim ticket. The conversation hears the ending once, through its
 * `onTaskSettled` entry, deduped like any task's notice. Nothing else decides
 * that an answer counts.
 *
 * **Which session takes it.** Only the session written on the row. A session
 * keyed for a delegate must be the one born naming the row's assignee for the
 * row's conversation; a session named by id must be that session. Any other
 * fails the row.
 *
 * **A post with a deadline.** When the answer can go back out to other
 * delegates (the coordinator's `rounds:`), the row carries its round's
 * deadline. At the deadline, while the turn is still running, the entry wakes
 * the conversation ({@link ROUND_DEADLINE_ACTION}) so it closes its overdue
 * rounds. The turn is not stopped: its answer, if it comes, still lands once,
 * and goes no further.
 *
 * **A post with the conversation's lines.** The row carries the coordinator
 * conversation's recent lines before the post (`coordinator-lines.ts`). The
 * entry notes them for the request, and {@link delegatedPostHistory} hands
 * them to the turn's model as one user-role message just before the post, on
 * that turn only. They are data from the conversation, never system text, so
 * a line written like an instruction carries no more authority than the post
 * itself. They are never the turn's stored message either, so the delegate's
 * own conversation never keeps them.
 *
 * A flow declares the entry with {@link delegatedPostEntry}, under
 * `task.actions`, around the turn it runs for any message. That is what makes
 * its workers delegates that take posts.
 */
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext, BlockDefinition, LLMMessage, RequestScopeHandle, TaskDispatchInput } from "@flow-state-dev/core/types";
import { taskLedgers, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { taskClaimTicketSchema, type TaskClaimTicket, type TaskCollectionRef, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt, conversationLedgerResources } from "../conversation-board/ledger";
import { sendOwedReports } from "../conversation-board/report-owed";
import { sendOwedNotices } from "../conversation-board/notice-delivery";
import { delegateRefSchema } from "../delegates/delegate-list";
import { DELEGATED_POST_ENTRY } from "../worker-task-entry";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY, WORKER_ID_STATE_KEY } from "../workers/keys";
import { COORDINATOR_FLOW, POST_CANCELLED_ACTION, ROUND_DEADLINE_ACTION } from "./coordinator-keys";
import { conversationLineSchema, type ConversationLine } from "./coordinator-lines";

/** What a delegate is handed. */
export const delegatedPostSchema = z.object({
  /** The post. */
  body: z.string(),
  /** Who wrote it: the conversation's user, or the delegates whose answers it passes on. */
  from: z.string(),
  /** The coordinator it came through: its worker id. */
  coordinator: z.string(),
  /**
   * When its round closes without what is still out, in epoch milliseconds.
   * Present only when its answer can go back out.
   */
  deadlineAt: z.number().int().optional(),
  /**
   * The coordinator conversation's recent lines before the post, oldest
   * first. Present only when there are any.
   */
  recent: z.array(conversationLineSchema).optional()
});

export type DelegatedPost = z.infer<typeof delegatedPostSchema>;

/** What a post row's `kind` says: the row is a post, not a task. */
export const POST_ROW = "post";

/**
 * A post row's server-written payload (`Task.sealed`): the post, and where and
 * for whom it is worked. Written only by the coordinator when it files the row.
 */
export const postRowSchema = delegatedPostSchema.extend({
  kind: z.literal(POST_ROW),
  /** The user's post this row hands on. Answers going back out keep its id, in a later round. */
  postId: z.string().min(1),
  /** The round it was handed on in: 0 for a user's post. */
  round: z.number().int().min(0),
  /** The delegate record it went to. */
  delegate: delegateRefSchema,
  /**
   * The session it is worked in: the delegate's own session for this
   * conversation, by key, or the session a workstream record's target
   * resolved to, by id.
   */
  session: z.union([z.object({ key: z.string().min(1) }).strict(), z.object({ id: z.string().min(1) }).strict()])
});

export type PostRow = z.infer<typeof postRowSchema>;

type SealedRow = { readonly sealed?: Readonly<Record<string, unknown>> } | undefined;

/** Whether a row is a post row, by its payload's `kind`, whether or not the rest of the payload reads. */
export function isPostRow(row: SealedRow): boolean {
  return row?.sealed?.kind === POST_ROW;
}

/**
 * A row's post, when the row is a post row whose payload reads; `undefined`
 * for any other row, and for a post row whose payload doesn't
 * ({@link isPostRow} tells those two apart).
 */
export function postRowOf(row: SealedRow): PostRow | undefined {
  if (!isPostRow(row)) return undefined;
  const parsed = postRowSchema.safeParse(row!.sealed);
  return parsed.success ? parsed.data : undefined;
}

/** A delegated post as the delegate's turn reads it. */
export function delegatedPostMessage(post: DelegatedPost): string {
  return `${post.from}, through ${post.coordinator}: ${post.body}`;
}

/** Request state: the post this request works, and its row. Set before the turn. */
const TAKEN_POST_STATE = "delegatedPost";
/** Request state: whether the turn has ended, answered or failed, so the deadline watch can stop. */
const ENDED_STATE = "delegatedPostEnded";

const takenPostStateSchema = z.object({
  [TAKEN_POST_STATE]: z
    .object({
      taskId: z.string(),
      partition: z.string(),
      /** The gate's claim, so a cancelled run's row can be ended under it (`delegatedPostOnFinished`). */
      claim: taskClaimTicketSchema,
      coordinator: z.string(),
      deadlineAt: z.number().optional(),
      recent: z.array(conversationLineSchema).optional()
    })
    .optional(),
  [ENDED_STATE]: z.boolean().optional()
});

type NotedPost = NonNullable<z.infer<typeof takenPostStateSchema>[typeof TAKEN_POST_STATE]>;

/** The post this request works, as `markPost` noted it. */
const notedPost = (ctx: { readonly request: { readonly state: unknown } }): NotedPost | undefined =>
  (ctx.request.state as z.infer<typeof takenPostStateSchema> | undefined)?.[TAKEN_POST_STATE];

/**
 * The deadline watch waiting in each request, by request: `markEnded` wakes
 * the one for its request, so a watch waits on one timer and never polls.
 * Process-local on purpose: a side chain runs in the process that runs its
 * request.
 */
const watches = new Map<string, () => void>();

/** One request's key in {@link watches}: its id and its incarnation. */
const watchKey = (ctx: { readonly request: Pick<RequestScopeHandle, "identity" | "incarnation"> }) =>
  `${ctx.request.identity.id} ${ctx.request.incarnation}`;

/** The claim the gate put on its state, with the ledger partition the row was read in. */
function claimOf(ctx: BlockContext): (TaskClaimTicket & { partition: string }) | undefined {
  const ticket = taskClaimTicketSchema.safeParse(ctx.sequencer?.state?.currentClaim);
  return ticket.success && typeof ticket.data.partition === "string"
    ? (ticket.data as TaskClaimTicket & { partition: string })
    : undefined;
}

/**
 * Why the running session isn't the one written on the row, or `undefined`
 * when it is. A keyed session is the one born naming the row's assignee for
 * the row's conversation, and no task; a session by id is that session.
 */
function wrongSession(ctx: BlockContext, post: PostRow, assignee: string, partition: string): string | undefined {
  if ("id" in post.session) {
    return post.session.id === ctx.session.identity.id ? undefined : "it is worked in another of your sessions";
  }
  const state = ctx.session.state as Record<string, unknown>;
  if (state[TASK_ID_STATE_KEY] !== undefined) return "this session works a task, not posts";
  if (state[WORKER_ID_STATE_KEY] !== assignee) return `this session runs another worker, not "${assignee}"`;
  if (state[FILING_SESSION_STATE_KEY] !== partition) return "this session takes posts from another conversation";
  return undefined;
}

/**
 * Read the post off the row the gate verified, check that this session is the
 * one written on it, and note it for the request: the row, so its ending can
 * be told, and the lines it came with, so the turn's model is shown them.
 */
const markPost = handler({
  name: "delegated-post-mark",
  inputSchema: taskWorkerInputSchema,
  outputSchema: postRowSchema,
  requestStateSchema: takenPostStateSchema,
  execute: async (task: TaskWorkerInput, ctx): Promise<PostRow> => {
    if (!isPostRow(task)) throw new Error(`Task "${task.taskId}" isn't a delegated post, so this entry doesn't take it.`);
    const parsed = postRowSchema.safeParse(task.sealed);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(payload)"}: ${issue.message}`);
      throw new Error(`Post row "${task.taskId}" carries a post this entry can't read (${issues.join("; ")}).`);
    }
    const post = parsed.data;
    const claim = claimOf(ctx as never);
    if (claim === undefined) {
      throw new Error(`"${DELEGATED_POST_ENTRY}" runs only behind its claim gate, and found no claim the gate verified.`);
    }
    await ctx.request.patchState({
      [TAKEN_POST_STATE]: {
        taskId: task.taskId,
        partition: claim.partition,
        claim,
        coordinator: post.coordinator,
        ...(post.deadlineAt === undefined ? {} : { deadlineAt: post.deadlineAt }),
        ...(post.recent === undefined || post.recent.length === 0 ? {} : { recent: post.recent })
      }
    });
    const wrong = wrongSession(ctx as never, post, post.delegate.worker, claim.partition);
    if (wrong !== undefined) throw new Error(`This session doesn't take the post from ${post.coordinator}: ${wrong}.`);
    // The board takes back a row whose lease lapsed, whatever its `maxAttempts`.
    // A post has one attempt: the first run stopped without ending its row, so
    // this one ends it rather than handing the post to the delegate again.
    if (claim.attempt > 1) {
      throw new Error(`A post has one attempt, and an earlier run on this one stopped without an answer, so it isn't worked again.`);
    }
    return post;
  }
});

/**
 * A delegated post's lines as the turn's model reads them: one user-role
 * message, `Recent lines in the conversation with <coordinator> before this
 * post, oldest first:` and then `- <from>: <text>` per line. `undefined` on
 * any other turn and on a post with no lines.
 */
function delegatedPostLinesMessage(ctx: { readonly request: { readonly state: unknown } }): LLMMessage | undefined {
  const taken = notedPost(ctx);
  const recent: readonly ConversationLine[] = taken?.recent ?? [];
  if (taken === undefined || recent.length === 0) return undefined;
  return {
    role: "user",
    content: [
      `Recent lines in the conversation with ${taken.coordinator} before this post, oldest first:`,
      ...recent.map((line) => `- ${line.from}: ${line.text}`)
    ].join("\n")
  };
}

/**
 * A generator's `history` for a turn that may answer a delegated post: the
 * session's history, as `history: true` reads it, with the post's lines as
 * one user-role message between the earlier turns and this turn's own items,
 * so just before the post. Resolved for each model call and never stored, so
 * the delegate's own conversation never keeps the lines; on any other turn,
 * and on a post with no lines, it is the session's history unchanged.
 *
 * Use it in place of `history: true` on the generator inside the turn you
 * hand {@link delegatedPostEntry}. The built-in `agent` flow's turn does.
 */
export async function delegatedPostHistory(_input: unknown, ctx: BlockContext): Promise<LLMMessage[]> {
  const lines = delegatedPostLinesMessage(ctx);
  const history = await ctx.session.items.history();
  if (lines === undefined) return history;
  // `history()` is the earlier turns with this request's own items after them.
  const earlier = await ctx.session.items.history({ includeInFlight: false });
  return [...history.slice(0, earlier.length), lines, ...history.slice(earlier.length)];
}

/** Note that the turn has ended, one way or the other, and wake this request's deadline watch. */
const markEnded = handler({
  name: "delegated-post-ended",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: takenPostStateSchema,
  execute: async (_value: unknown, ctx) => {
    await ctx.request.patchState({ [ENDED_STATE]: true });
    watches.get(watchKey(ctx))?.();
    return {};
  }
});

/** The turn's reply, the row's output. An empty reply is a failed turn. */
const toAnswer = handler({
  name: "delegated-post-answer",
  inputSchema: z.unknown(),
  outputSchema: z.string().min(1),
  requestStateSchema: takenPostStateSchema,
  execute: (reply: unknown, ctx): string => {
    const body = typeof reply === "string" ? reply : (reply as { text?: unknown } | null)?.text;
    if (typeof body !== "string" || body.trim().length === 0) {
      throw new Error(
        `This worker's turn on a post from ${notedPost(ctx)?.coordinator ?? "its coordinator"} ended with an empty reply, so nothing was answered.`
      );
    }
    return body;
  }
});

/**
 * Wait until the turn ends or the post's deadline passes, whichever is first:
 * one timer to the deadline, cleared when `markEnded` wakes the watch or the
 * request is cancelled.
 *
 * @returns `late` when the deadline came while the turn was still running.
 */
const waitForDeadline = handler({
  name: "delegated-post-deadline-wait",
  inputSchema: postRowSchema,
  outputSchema: z.object({ late: z.boolean() }),
  requestStateSchema: takenPostStateSchema,
  execute: async (post: PostRow, ctx) => {
    const key = watchKey(ctx);
    const late = await new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (isLate: boolean) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        watches.delete(key);
        resolve(isLate);
      };
      const onAbort = () => finish(false);
      // Registered before the state is read: a turn that ends in between still wakes it.
      watches.set(key, () => finish(false));
      if (ctx.request.state[ENDED_STATE] === true || ctx.signal.aborted) return finish(false);
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      // Only run on a post that has a deadline (the `sideChainIf` below).
      const left = Math.max(0, post.deadlineAt! - Date.now());
      timer = setTimeout(() => finish(ctx.request.state[ENDED_STATE] !== true), left);
    });
    return { late };
  }
});

/**
 * Send `action` to the conversation that filed this post: its stamped sender,
 * never an id from the row. Best effort: a refused or thrown send is dropped,
 * and each caller says what makes up for it.
 */
async function sendToCoordinator(ctx: BlockContext, action: string, payload: unknown, from: string): Promise<void> {
  try {
    await dispatchThroughSeam(ctx, { type: "internal", action, flowKind: COORDINATOR_FLOW, session: { from: true }, payload, from });
  } catch {
    // Dropped: see the caller.
  }
}

/**
 * Wake the conversation that filed the post: its stamped sender, never an id
 * from the row. A plain wake, with nothing in it: the conversation closes
 * every round past its deadline. A refused or thrown wake is left: the
 * conversation's next wake closes the round all the same.
 */
const wakeAtDeadline = handler({
  name: "delegated-post-deadline-wake",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  execute: async (_value: unknown, ctx) => {
    // Unsent, the round closes at the conversation's next wake.
    await sendToCoordinator(ctx as never, ROUND_DEADLINE_ACTION, {}, "delegated-post-deadline-wake");
    return {};
  }
});

/** Beside the turn: at the deadline, if the turn hasn't ended, wake the conversation. The turn goes on. */
const watchDeadline = sequencer({ name: "delegated-post-deadline", inputSchema: postRowSchema })
  .step(waitForDeadline)
  .tapIf((watched: { late: boolean }) => watched.late, wakeAtDeadline);

/** Hand the turn's failure back as itself, after the watch was stopped. */
const failAgain = handler({
  name: "delegated-post-failed",
  inputSchema: z.unknown(),
  outputSchema: z.never(),
  execute: (error: unknown): never => {
    throw error;
  }
});

/** When the turn fails, stop the deadline watch. The row fails with the turn's error. */
const endOnFailure = sequencer({ name: "delegated-post-end-on-failure", inputSchema: z.unknown() })
  .tap(markEnded)
  .step(failAgain);

/**
 * The ledger a post entry's gate reads a post row from: the conversation
 * ledger at the partition the claim names, at the running user's scope. Which
 * session may work the row is checked against the row itself, after the gate.
 */
async function postLedgers(
  ledgerId: string,
  ctx: BlockContext,
  partition: string | undefined
): Promise<TaskCollectionRef | undefined> {
  if (ledgerId !== CONVERSATION_LEDGER_ID || partition === undefined) return undefined;
  return conversationLedgerAt(ctx, partition);
}

/**
 * Tell the conversation the ending its post row owes: the stamped sender of
 * this request, on the coordinator's flow, never an address from the row. A
 * send that is refused or lost leaves the notice owed on the row, and the
 * conversation's next touch of its board sends it.
 */
async function tellCoordinator(ctx: BlockContext): Promise<number> {
  const taken = notedPost(ctx);
  if (taken === undefined) return 0;
  const ref = await conversationLedgerAt(ctx, taken.partition);
  const row = ref?.get(taken.taskId);
  if (ref === undefined || row === undefined) return 0;
  // What an errored post owes the Error Reporter goes out on the ending itself, not on the board's next touch.
  await sendOwedReports(ctx, ref, [row], { boardId: CONVERSATION_LEDGER_ID, partition: taken.partition }, "delegated-post-report");
  return sendOwedNotices(ctx, row, { session: { from: true }, flowKind: COORDINATOR_FLOW, from: "delegated-post-tell" });
}

const tell = handler({
  name: "delegated-post-tell",
  inputSchema: z.unknown(),
  outputSchema: z.object({ sent: z.number() }),
  resources: { ...conversationLedgerResources },
  requestStateSchema: takenPostStateSchema,
  execute: async (_input, ctx) => ({ sent: await tellCoordinator(ctx as never) })
});

/**
 * The task entry that makes a flow's workers delegates that take posts:
 * spread it as `task: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(turn) } }`.
 *
 * @param turn The flow's turn for one message, `{ message }` in and the reply
 *   out (a string, or `{ text }`). The worker's own door is usually it. Its
 *   model is shown the post's lines when its generator's `history` is
 *   {@link delegatedPostHistory}.
 */
export function delegatedPostEntry(turn: BlockDefinition<any, any>) {
  const from = taskLedgers({
    name: "delegated-post-tasks",
    resolve: postLedgers,
    uses: [defineCapability({ name: "delegated-post-ledgers", resources: { ...conversationLedgerResources } })],
    // The turn keeps the worker's own session state, the same shape for every post.
    allowSessionState: true
  });
  const block = sequencer({ name: "delegated-post", inputSchema: taskWorkerInputSchema })
    .step(markPost)
    .sideChainIf((post: PostRow) => post.deadlineAt !== undefined, watchDeadline)
    .step((post: PostRow) => ({ message: delegatedPostMessage(post) }), turn)
    .step(toAnswer)
    .tap(markEnded)
    .rescue([{ block: endOnFailure }]);
  return {
    block,
    from,
    /** The post as the delegate's user item: the gate's input is the dispatch, and the row its payload. */
    userMessage: (dispatch: TaskDispatchInput) => {
      const post = postRowOf(dispatch.payload as TaskWorkerInput);
      return post === undefined ? "" : delegatedPostMessage(post);
    },
    onCompleted: tell,
    onErrored: tell,
    // Each post is its own row, fenced by its claim: a later post to the same
    // delegate session runs beside a slow turn rather than waiting behind it.
    concurrency: "allow" as const
  };
}

/** What a flow's request `onFinished` hook is handed. */
const requestFinishedSchema = z.object({ actionName: z.string(), status: z.string() }).passthrough();

type RequestFinished = z.infer<typeof requestFinishedSchema>;

/** What a delegate tells its conversation when its run on a post was cancelled. */
export const postCancelledSchema = z.object({ taskId: z.string(), claim: taskClaimTicketSchema });

export type PostCancelled = z.infer<typeof postCancelledSchema>;

/**
 * Tell the conversation that filed the post that this run was cancelled,
 * with the claim it held: a cancelled request can't write, and a post has no
 * second attempt to wait a lease out for. Its stamped sender, never an id
 * from the row. A refused or thrown send leaves the row to its lease.
 */
const reportCancelled = handler({
  name: "delegated-post-cancelled",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: takenPostStateSchema,
  execute: async (_input, ctx) => {
    const taken = notedPost(ctx);
    if (taken === undefined) return {};
    const payload: PostCancelled = { taskId: taken.taskId, claim: taken.claim };
    // Unsent, the row's lease lapses and the board takes it back, and that
    // run ends it unworked (`markPost`: a post has one attempt).
    await sendToCoordinator(ctx as never, POST_CANCELLED_ACTION, payload, "delegated-post-cancelled");
    return {};
  }
});

/**
 * A delegate flow's request `onFinished`: when a delegated post's run was
 * cancelled, tell the coordinator, which ends its row, so the round doesn't
 * wait for its deadline. It acts only on the {@link DELEGATED_POST_ENTRY} entry
 * and an `aborted` request. Set it as the flow's `request.onFinished`; the
 * built-in `agent` flow does.
 */
export const delegatedPostOnFinished = sequencer({
  name: "delegated-post-finished",
  inputSchema: requestFinishedSchema
}).tapIf(
  (finished: RequestFinished, ctx) =>
    finished.status === "aborted" && finished.actionName === DELEGATED_POST_ENTRY && notedPost(ctx) !== undefined,
  reportCancelled
);
