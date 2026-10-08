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
 * A flow declares the entry with {@link delegatedPostEntry}, around the turn
 * it runs for any message. That is what makes its workers delegates that take
 * posts.
 */
import { dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { COORDINATOR_KIND, DELEGATE_ANSWER_ACTION } from "./coordinator-keys";

/** What a delegate is handed. */
export const delegatedPostSchema = z.object({
  /** The delivery's token. The answer hands it back. */
  token: z.string().min(1),
  /** The post. */
  body: z.string(),
  /** Who wrote it: the conversation's user. */
  from: z.string(),
  /** The coordinator it came through: its worker id. */
  coordinator: z.string()
});

export type DelegatedPost = z.infer<typeof delegatedPostSchema>;

/** What a delegate hands back. Closed: there is nowhere to put a round, an author or a post. */
export const delegatedAnswerSchema = z.object({ token: z.string().min(1), body: z.string().min(1) }).strict();

export type DelegatedAnswer = z.infer<typeof delegatedAnswerSchema>;

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

/** Request state: the delivery this request answers. Set from the entry's input, before the turn. */
const DELIVERY_STATE = "delegatedPost";

const deliveryStateSchema = z.object({
  [DELIVERY_STATE]: z.object({ token: z.string(), coordinator: z.string() }).optional()
});

/** Note which delivery this request answers, so the answer after the turn hands back its token. */
const markDelivery = handler({
  name: "delegated-post-mark",
  inputSchema: delegatedPostSchema,
  outputSchema: z.object({}),
  requestStateSchema: deliveryStateSchema,
  execute: async (post: DelegatedPost, ctx) => {
    await ctx.request.patchState({ [DELIVERY_STATE]: { token: post.token, coordinator: post.coordinator } });
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
 * The internal entry that makes a flow's workers delegates that take posts:
 * spread it as `internal.actions[DELEGATED_POST_ENTRY]`.
 *
 * @param turn The flow's turn for one message, `{ message }` in and the reply
 *   out (a string, or `{ text }`). The worker's own door is usually it.
 */
export function delegatedPostEntry(turn: BlockDefinition<any, any>) {
  const block = sequencer({ name: "delegated-post", inputSchema: delegatedPostSchema })
    .tap(markDelivery)
    .step((post: DelegatedPost) => ({ message: delegatedPostMessage(post) }), turn)
    .step(toAnswer)
    .step(answerDelegatedPost);
  return {
    inputSchema: delegatedPostSchema,
    block,
    userMessage: (post: DelegatedPost) => delegatedPostMessage(post)
  };
}
