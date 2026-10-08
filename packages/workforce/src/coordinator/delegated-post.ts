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
 * goes no further. A post with no deadline reports nothing but its answer.
 *
 * A flow declares the entry with {@link delegatedPostEntry}, around the turn
 * it runs for any message. That is what makes its workers delegates that take
 * posts.
 */
import { dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { COORDINATOR_KIND, DELEGATE_ANSWER_ACTION, DELEGATE_MISSED_ACTION } from "./coordinator-keys";

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
  deadlineAt: z.number().int().optional()
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

const deliveryStateSchema = z.object({
  [DELIVERY_STATE]: z
    .object({ token: z.string(), coordinator: z.string(), deadlineAt: z.number().optional() })
    .optional(),
  [ENDED_STATE]: z.boolean().optional()
});

/** The delivery this request answers, as `markDelivery` noted it. */
const notedDelivery = (ctx: { readonly request: { readonly state: unknown } }) =>
  (ctx.request.state as z.infer<typeof deliveryStateSchema>)[DELIVERY_STATE];

/** How often the deadline watch looks whether the turn has ended. */
const WATCH_INTERVAL_MS = 100;

/** Note which delivery this request answers, so the answer after the turn hands back its token. */
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
        ...(post.deadlineAt === undefined ? {} : { deadlineAt: post.deadlineAt })
      }
    });
    return {};
  }
});

/** Note that the turn has ended, one way or the other. */
const markEnded = handler({
  name: "delegated-post-ended",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: deliveryStateSchema,
  execute: async (_value: unknown, ctx) => {
    await ctx.request.patchState({ [ENDED_STATE]: true });
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

/** Wait `ms`, or less when `signal` aborts first. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Wait until the turn ends or the post's deadline passes, whichever is first.
 *
 * @returns `late` when the deadline came while the turn was still running.
 */
const waitForDeadline = handler({
  name: "delegated-post-deadline-wait",
  inputSchema: delegatedPostSchema,
  outputSchema: z.object({ late: z.boolean() }),
  requestStateSchema: deliveryStateSchema,
  execute: async (post: DelegatedPost, ctx) => {
    // Only run on a post that has one (the `sideChainIf` below).
    const deadlineAt = post.deadlineAt!;
    for (;;) {
      if (ctx.request.state[ENDED_STATE] === true || ctx.signal.aborted) return { late: false };
      const left = deadlineAt - Date.now();
      if (left <= 0) return { late: true };
      await pause(Math.min(left, WATCH_INTERVAL_MS), ctx.signal);
    }
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
 *   out (a string, or `{ text }`). The worker's own door is usually it.
 */
export function delegatedPostEntry(turn: BlockDefinition<any, any>) {
  const block = sequencer({ name: "delegated-post", inputSchema: delegatedPostSchema })
    .tap(markDelivery)
    .sideChainIf((post: DelegatedPost) => post.deadlineAt !== undefined, watchDeadline)
    .step((post: DelegatedPost) => ({ message: delegatedPostMessage(post) }), turn)
    .step(toAnswer)
    .tap(markEnded)
    .step(answerDelegatedPost)
    .rescue([{ block: reportFailure }]);
  return {
    inputSchema: delegatedPostSchema,
    block,
    userMessage: (post: DelegatedPost) => delegatedPostMessage(post)
  };
}
