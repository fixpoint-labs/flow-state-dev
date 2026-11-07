/**
 * The goal's stand-in for a service that delivers a message to a task's
 * session (as FIX-2535 will deliver a pull request's review): one flow, loaded
 * beside the lab's through `GOAL_FLOWS`, whose `deliver` action writes one row
 * to the user's message log and dispatches it to the session's
 * `onMessageReceived`, the way a worker's sent message is delivered. What the
 * session does with it is the lab's own code; nothing here touches the task.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { dispatchThroughSeam } from "@flow-state-dev/core/internal";
import { MESSAGE_RECEIVED_ENTRY, WORKER_MESSAGES_RESOURCE, workerMessagesResources, type WorkerMessageRow } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The flow's kind and id. */
export const GOAL_MAIL_FLOW = "goal-mail";

const deliverInput = z.object({ toSession: z.string(), toFlow: z.string(), from: z.string(), text: z.string() });

const deliver = handler({
  name: "goal-mail-deliver",
  inputSchema: deliverInput,
  outputSchema: z.object({ messageId: z.string(), dispatched: z.boolean(), refused: z.string().nullable() }),
  resources: workerMessagesResources,
  execute: async (input, ctx) => {
    const id = `msg_goal_${Date.now().toString(36)}`;
    const row: WorkerMessageRow = {
      id,
      from: input.from,
      to: "desk.coder",
      text: input.text,
      exchange: id,
      fromSession: ctx.session.identity.id,
      fromFlow: GOAL_MAIL_FLOW,
      toSession: input.toSession,
      toFlow: input.toFlow,
      hop: 1,
      status: "unconfirmed",
      at: Date.now(),
    } as WorkerMessageRow;
    const log = (ctx.resources as Record<string, any>)[WORKER_MESSAGES_RESOURCE];
    await log.getOrCreate(id, row);
    const outcome = await dispatchThroughSeam(ctx as never, {
      type: "internal",
      action: MESSAGE_RECEIVED_ENTRY,
      flowKind: input.toFlow,
      session: { id: input.toSession },
      payload: { messageId: id },
      from: GOAL_MAIL_FLOW,
    } as never);
    const refused = (outcome as { ok: boolean; refused?: string }).ok ? null : String((outcome as { refused?: string }).refused);
    return { messageId: id, dispatched: refused === null, refused };
  },
});

export default [
  defineFlow({ kind: GOAL_MAIL_FLOW, actions: { deliver: { inputSchema: deliverInput, block: deliver } } } as never)({ id: GOAL_MAIL_FLOW } as never) as { id: string },
];
