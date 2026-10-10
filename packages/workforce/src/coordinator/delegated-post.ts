/**
 * How a worker flow takes a delegated post: the internal entry a coordinator
 * dispatches to, and the answer it hands back.
 *
 * A coordinator delivers a post into the delegate's own session (one per
 * coordinator conversation per delegate, created naming the delegate), on the
 * entry {@link DELEGATED_POST_ENTRY}. The delegate runs one turn on it and
 * hands the reply back to the delivering conversation with the delivery's
 * token, and nothing else: who answered, which post and which round all come
 * from the delivery the token names.
 *
 * **A post with a deadline.** When the answer can go back out to other
 * delegates (the coordinator's `rounds:`), the post carries its round's
 * deadline. Then the entry also tells the coordinator when it has no answer:
 * at once when its turn fails, and at the deadline while its turn is still
 * running. The turn is not stopped: its answer, if it comes, still lands, and
 * goes no further. A run cancelled before its answer went back reports that
 * too, from the flow's request `onFinished` ({@link delegatedPostOnFinished}).
 * A post with no deadline reports nothing but its answer.
 *
 * **A post with the conversation's lines.** A post carries the coordinator
 * conversation's recent lines before it (`coordinator-lines.ts`). The entry
 * notes them for the request, and {@link delegatedPostHistory} hands them to
 * the turn's model as one user-role message just before the post, on that
 * turn only. They are data from the conversation, never system text, so a
 * line written like an instruction carries no more authority than the post
 * itself. They are never the turn's stored message either, so the delegate's
 * own conversation never keeps them.
 *
 * A flow declares the entry with {@link delegatedPostEntry}, around the turn
 * it runs for any message. That is what makes its workers delegates that take
 * posts.
 */
import { dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, LLMMessage, RequestScopeHandle } from "@flow-state-dev/core/types";
import { z } from "zod";
import { DELEGATED_POST_ENTRY } from "../worker-task-entry";
import { COORDINATOR_KIND, DELEGATE_ANSWER_ACTION, DELEGATE_MISSED_ACTION } from "./coordinator-keys";
import { conversationLineSchema, linesField, type ConversationLine } from "./coordinator-lines";

/** What a delegate is handed. */
export const delegatedPostSchema = z.object({
  /** The delivery's token. The answer hands it back. */
  token: z.string().min(1),
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

/** What a delegate hands back. Closed: there is nowhere to put a round, an author or a post. */
export const delegatedAnswerSchema = z.object({ token: z.string().min(1), body: z.string().min(1) }).strict();

export type DelegatedAnswer = z.infer<typeof delegatedAnswerSchema>;

/**
 * What a delegate hands back when it has no answer for a post with a
 * deadline: why its turn failed, or, with no `failed`, that the deadline came
 * while its turn was still running. Closed, like the answer.
 */
export const delegatedMissSchema = z
  .object({ token: z.string().min(1), failed: z.string().min(1).optional() })
  .strict();

export type DelegatedMiss = z.infer<typeof delegatedMissSchema>;

/** A delegated post as the delegate's turn reads it. */
export function delegatedPostMessage(post: DelegatedPost): string {
  return `${post.from}, through ${post.coordinator}: ${post.body}`;
}

/**
 * Hand an answer back to the conversation that delivered the post: the
 * stamped sender of this request, never an id the turn names.
 */
export const answerDelegatedPost = dispatcher({
  name: "answer-delegated-post",
  flowKind: COORDINATOR_KIND,
  action: DELEGATE_ANSWER_ACTION,
  inputSchema: delegatedAnswerSchema,
  session: { from: true },
  payload: (answer: DelegatedAnswer) => answer
});

/** Tell the conversation that delivered the post there is no answer for it, the same way. */
const missDelegatedPost = dispatcher({
  name: "miss-delegated-post",
  flowKind: COORDINATOR_KIND,
  action: DELEGATE_MISSED_ACTION,
  inputSchema: delegatedMissSchema,
  session: { from: true },
  payload: (miss: DelegatedMiss) => miss
});

/** Request state: the delivery this request answers. Set from the entry's input, before the turn. */
const DELIVERY_STATE = "delegatedPost";
/** Request state: whether the turn has ended, answered or failed, so the deadline watch can stop. */
const ENDED_STATE = "delegatedPostEnded";
/** Request state: whether the answer went back, so a cancel after it reports nothing. */
const ANSWERED_STATE = "delegatedPostAnswered";

const deliveryStateSchema = z.object({
  [DELIVERY_STATE]: z
    .object({
      token: z.string(),
      coordinator: z.string(),
      deadlineAt: z.number().optional(),
      recent: z.array(conversationLineSchema).optional()
    })
    .optional(),
  [ENDED_STATE]: z.boolean().optional(),
  [ANSWERED_STATE]: z.boolean().optional()
});

/** The delivery this request answers, as `markDelivery` noted it. */
const notedDelivery = (ctx: { readonly request: { readonly state: unknown } }) =>
  (ctx.request.state as z.infer<typeof deliveryStateSchema>)[DELIVERY_STATE];

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

/**
 * Note which delivery this request answers, so the answer after the turn
 * hands back its token, and the lines the post came with, so the turn's model
 * is shown them.
 */
const markDelivery = handler({
  name: "delegated-post-mark",
  inputSchema: delegatedPostSchema,
  outputSchema: z.object({}),
  requestStateSchema: deliveryStateSchema,
  execute: async (post: DelegatedPost, ctx) => {
    await ctx.request.patchState({
      [DELIVERY_STATE]: {
        token: post.token,
        coordinator: post.coordinator,
        ...(post.deadlineAt === undefined ? {} : { deadlineAt: post.deadlineAt }),
        ...linesField(post.recent)
      }
    });
    return {};
  }
});

/**
 * A delegated post's lines as the turn's model reads them: one user-role
 * message, `Recent lines in the conversation with <coordinator> before this
 * post, oldest first:` and then `- <from>: <text>` per line. `undefined` on
 * any other turn and on a post with no lines.
 */
function delegatedPostLinesMessage(ctx: { readonly request: { readonly state: unknown } }): LLMMessage | undefined {
  const delivery = notedDelivery(ctx);
  const recent: readonly ConversationLine[] = delivery?.recent ?? [];
  if (delivery === undefined || recent.length === 0) return undefined;
  return {
    role: "user",
    content: [
      `Recent lines in the conversation with ${delivery.coordinator} before this post, oldest first:`,
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
  requestStateSchema: deliveryStateSchema,
  execute: async (_value: unknown, ctx) => {
    await ctx.request.patchState({ [ENDED_STATE]: true });
    watches.get(watchKey(ctx))?.();
    return {};
  }
});

/** Note that the answer went back to the coordinator. */
const markAnswered = handler({
  name: "delegated-post-answered",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: deliveryStateSchema,
  execute: async (_value: unknown, ctx) => {
    await ctx.request.patchState({ [ANSWERED_STATE]: true });
    return {};
  }
});

/** The turn's reply as the answer: this delivery's token, and the reply. An empty reply is a failed turn. */
const toAnswer = handler({
  name: "delegated-post-answer",
  inputSchema: z.unknown(),
  outputSchema: delegatedAnswerSchema,
  requestStateSchema: deliveryStateSchema,
  execute: (reply: unknown, ctx): DelegatedAnswer => {
    // Set by `markDelivery`, the entry's first step.
    const delivery = ctx.request.state[DELIVERY_STATE]!;
    const body = typeof reply === "string" ? reply : (reply as { text?: unknown } | null)?.text;
    if (typeof body !== "string" || body.trim().length === 0) {
      throw new Error(
        `This worker's turn on a post from ${delivery.coordinator} ended with an empty reply, so nothing was answered.`
      );
    }
    return { token: delivery.token, body };
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
  inputSchema: delegatedPostSchema,
  outputSchema: z.object({ late: z.boolean() }),
  requestStateSchema: deliveryStateSchema,
  execute: async (post: DelegatedPost, ctx) => {
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

/** Beside the turn: at the deadline, if the turn hasn't ended, say so. The turn goes on. */
const watchDeadline = sequencer({ name: "delegated-post-deadline", inputSchema: delegatedPostSchema })
  .step(waitForDeadline)
  .stepIf(
    (watched: { late: boolean }) => watched.late,
    (_watched: { late: boolean }, ctx) => ({ token: notedDelivery(ctx)!.token }),
    missDelegatedPost
  );

/** Hand the turn's failure back as itself, after it was reported. */
const failAgain = handler({
  name: "delegated-post-failed",
  inputSchema: z.unknown(),
  outputSchema: z.never(),
  execute: (error: unknown): never => {
    throw error;
  }
});

/**
 * When the turn fails on a post with a deadline, say so at once, so its round
 * doesn't wait for the deadline. A cancelled request says nothing. Either way
 * the request still fails, with the turn's error.
 */
const reportFailure = sequencer({ name: "delegated-post-report-failure", inputSchema: z.unknown() })
  .tap(markEnded)
  .tapIf(
    (_error: unknown, ctx) => !ctx.signal.aborted && notedDelivery(ctx)?.deadlineAt !== undefined,
    (error: unknown, ctx) => ({
      token: notedDelivery(ctx)!.token,
      failed: error instanceof Error ? error.message : String(error)
    }),
    missDelegatedPost
  )
  .step(failAgain);

/**
 * The internal entry that makes a flow's workers delegates that take posts:
 * spread it as `internal.actions[DELEGATED_POST_ENTRY]`.
 *
 * @param turn The flow's turn for one message, `{ message }` in and the reply
 *   out (a string, or `{ text }`). The worker's own door is usually it. Its
 *   model is shown the post's lines when its generator's `history` is
 *   {@link delegatedPostHistory}.
 */
export function delegatedPostEntry(turn: BlockDefinition<any, any>) {
  const block = sequencer({ name: "delegated-post", inputSchema: delegatedPostSchema })
    .tap(markDelivery)
    .sideChainIf((post: DelegatedPost) => post.deadlineAt !== undefined, watchDeadline)
    .step((post: DelegatedPost) => ({ message: delegatedPostMessage(post) }), turn)
    .step(toAnswer)
    .tap(markEnded)
    .step(answerDelegatedPost)
    .tap(markAnswered)
    .rescue([{ block: reportFailure }]);
  return {
    inputSchema: delegatedPostSchema,
    block,
    userMessage: (post: DelegatedPost) => delegatedPostMessage(post)
  };
}

/** What a flow's request `onFinished` hook is handed. */
const requestFinishedSchema = z.object({ actionName: z.string(), status: z.string() }).passthrough();

type RequestFinished = z.infer<typeof requestFinishedSchema>;

/**
 * A delegate flow's request `onFinished`: when a delegated post's run was
 * cancelled before its answer went back, tell the coordinator, so the round
 * doesn't wait for its deadline. It acts only on the {@link DELEGATED_POST_ENTRY}
 * entry, on a post with a deadline, and on an `aborted` request. Set it as the
 * flow's `request.onFinished`; the built-in `agent` flow does.
 */
export const delegatedPostOnFinished = sequencer({
  name: "delegated-post-finished",
  inputSchema: requestFinishedSchema
}).stepIf(
  (finished: RequestFinished, ctx) =>
    finished.status === "aborted" &&
    finished.actionName === DELEGATED_POST_ENTRY &&
    notedDelivery(ctx)?.deadlineAt !== undefined &&
    (ctx.request.state as z.infer<typeof deliveryStateSchema>)[ANSWERED_STATE] !== true,
  (_finished: RequestFinished, ctx) => ({ token: notedDelivery(ctx)!.token, failed: "its run was cancelled" }),
  missDelegatedPost
);
