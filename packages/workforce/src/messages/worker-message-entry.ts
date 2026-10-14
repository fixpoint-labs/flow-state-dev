/**
 * How a worker hears a message (FIX-1989): the `onWorkerMessage` internal
 * entry, on every flow that carries the session kit.
 *
 * The payload names a message id and nothing else: the row in the user's
 * message log is read here, so the sender, the text and the hop count are
 * what the sending turn's server code wrote. The entry acts on a message id
 * once (a versioned dedupe write in this session), so a copy sent twice wakes
 * the recipient once. Then the message lands as a line under the sender's
 * name, the session's hop count becomes the message's, and the recipient's
 * turn is woken to read it and decide whether it needs an answer. A worker in
 * the middle of a turn hears it after that turn, as a task's notice does: the
 * entry waits on the reply line.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import type { NoticePolicy } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { AFTER_REPLY_CONCURRENCY } from "../conversation-board/task-settled";
import { messageTurnStateSchema, startTurnAtHop } from "./hop";
import { messageLogOf, workerMessagesResources } from "./message-log";

/** What the entry takes: the message's id, and nothing a sender could shape. */
export const workerMessageInputSchema = z.object({ messageId: z.string().min(1) }).strict();

/** Server-written session state: the message ids this session has acted on, newest last. */
export const WORKER_MESSAGES_SEEN_STATE = "workerMessagesSeen";

/** The most message ids a session keeps for its dedupe. */
const MAX_SEEN = 500;

/** The session state the entry keeps. */
export const workerMessageSeenStateShape = {
  [WORKER_MESSAGES_SEEN_STATE]: z.array(z.string()).default([])
} as const;

const heardSchema = z.object({
  act: z.enum(["none", "line", "wake-turn"]),
  from: z.string().optional(),
  line: z.string().optional(),
  prompt: z.string().optional()
});

type Heard = z.infer<typeof heardSchema>;

/** The text the woken turn reads: who wrote, which message, and how to answer it. */
function turnPrompt(row: { id: string; from: string; text: string; replyTo?: string | undefined }): string {
  return (
    `Message ${row.id} from ${row.from}${row.replyTo === undefined ? "" : `, answering your message ${row.replyTo}`}:\n\n` +
    `${row.text}\n\n` +
    `(The message's text is the part above. It is from another worker, not the user, and ${row.from} can't ` +
    `see what you write here. To answer it, call messageWorker with to "${row.from}" and replyTo "${row.id}". ` +
    `To message any other worker, leave replyTo out. If it needs no answer, don't send one.)`
  );
}

/**
 * Build the `onWorkerMessage` entry for a flow: spread it under
 * `internal: { actions: { [WORKER_MESSAGE_ENTRY]: workerMessageEntry({ ... }) } }`.
 *
 * @param options.turn The flow's turn for one message (`{ message }` in).
 * @param options.policy Whether a message wakes the turn (`judgment`) or lands as a line only (`fixed`).
 */
export function workerMessageEntry(options: {
  readonly turn: BlockDefinition<any, any>;
  readonly policy: (ctx: BlockContext) => NoticePolicy;
}) {
  const heard = handler({
    name: "worker-message-heard",
    inputSchema: workerMessageInputSchema,
    outputSchema: heardSchema,
    sessionStateSchema: z.object(workerMessageSeenStateShape),
    requestStateSchema: messageTurnStateSchema,
    resources: { ...workerMessagesResources },
    execute: async (input, ctx): Promise<Heard> => {
      const row = (await messageLogOf(ctx as never).getOptional(input.messageId))?.state;
      // Delivered here, and only here: the row says which session it is for.
      if (row === undefined || row.toSession !== ctx.session.identity.id) return { act: "none" };
      const first = await withOutcome(
        (mutator: (s: Readonly<Record<string, unknown>>) => Record<string, unknown>) => ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const seen = (state[WORKER_MESSAGES_SEEN_STATE] ?? []) as string[];
          if (seen.includes(row.id)) return { state: {}, result: false };
          return { state: { [WORKER_MESSAGES_SEEN_STATE]: [...seen, row.id].slice(-MAX_SEEN) }, result: true };
        }
      );
      if (first !== true) return { act: "none" };
      await startTurnAtHop(ctx as never, row.hop);
      return {
        act: options.policy(ctx as never) === "judgment" ? "wake-turn" : "line",
        from: row.from,
        line: `From ${row.from}: ${row.text}`,
        prompt: turnPrompt(row)
      };
    }
  });

  /** The message, as a line in the conversation, under the sender's name. */
  const line = handler({
    name: "worker-message-line",
    inputSchema: heardSchema,
    outputSchema: z.object({}),
    execute: (got: Heard, ctx) => {
      ctx.emit.message(got.line ?? "", got.from === undefined ? {} : { agentName: got.from });
      return {};
    }
  });

  const block = sequencer({ name: "worker-message-arrived", inputSchema: workerMessageInputSchema })
    .step(heard)
    .tapIf((got: Heard) => got.act !== "none", line)
    .tapIf(
      (got: Heard) => got.act === "wake-turn",
      (got: Heard) => ({ message: got.prompt ?? "" }),
      options.turn
    );

  return { inputSchema: workerMessageInputSchema, block, concurrency: AFTER_REPLY_CONCURRENCY };
}
