// FIX-2771 D1.
/**
 * The worker messages view, on the roster flow at user scope: a worker's open
 * messages, and the row and the answer of each message an app has on screen,
 * read through the message log's two declared indexes (`message-log.ts`),
 * never the whole log, so what a run reads doesn't grow with the log.
 *
 * A message is open while it is on its way (`unconfirmed`), or while its
 * sender asked for a reply that hasn't come (`isOpenMessage`); the `open`
 * index finds it under its sender and its recipient. A screen's lines show
 * three facts of the log, all answered here: a message to a worker still on
 * its way, a reply a worker still waits for, and whether a line on screen was
 * answered (`ids`: each one's row, and its answer through `inReplyTo`).
 *
 * Rows are the log's own schema. Every read is in the caller's own user
 * scope, so another user's worker or message id answers as an unknown one.
 * The client's handle is `workerMessagesViewRef`
 * (`worker-messages-view-ref.ts`), which holds no block.
 */
import { defineView, handler, type ViewDefinition } from "@flow-state-dev/core";
import type { BlockDefinition, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  IN_REPLY_TO_INDEX,
  messageLogOf,
  OPEN_MESSAGES_INDEX,
  WORKER_MESSAGES_RESOURCE,
  workerMessageResourceStateSchema,
  workerMessagesCollection,
  type WorkerMessageResourceState
} from "./message-log";

// BP-042.
/** The most messages on screen one run answers for: each costs a row read and an index lookup. */
const MAX_IDS = 50;

const inputSchema = z.object({
  /** The worker whose open messages are read, sent or received. */
  worker: z.string().min(1),
  /** The messages on screen: each one's row and its answer come back, open or not. */
  ids: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).max(MAX_IDS).optional()
});
const outputSchema = z.array(workerMessageResourceStateSchema);

/** The worker messages view, as {@link defineWorkerMessagesView} builds it. Import as a type in client code. */
export type WorkerMessagesView = ViewDefinition<BlockDefinition<typeof inputSchema, typeof outputSchema>, "user">;

/** The reads the view makes of the log: by index and by id. Exported for its test; not on the package root. */
export type WorkerMessageLog = Pick<ResourceCollectionRef<WorkerMessageResourceState>, "findBy" | "getOptional">;

/**
 * The worker's open rows, and each of `ids`' row and answers, each once,
 * oldest first. Exported for its test; not on the package root.
 */
export async function readWorkerMessages(log: WorkerMessageLog, input: z.infer<typeof inputSchema>): Promise<WorkerMessageResourceState[]> {
  const [open, onScreen] = await Promise.all([
    log.findBy(OPEN_MESSAGES_INDEX, input.worker),
    Promise.all(
      (input.ids ?? []).map(async (id) => {
        const [message, answers] = await Promise.all([log.getOptional(id), log.findBy(IN_REPLY_TO_INDEX, id)]);
        return [...(message === undefined ? [] : [message]), ...answers];
      })
    )
  ]);
  const byId = new Map<string, WorkerMessageResourceState>();
  for (const ref of [...open, ...onScreen.flat()]) byId.set(ref.state.id, ref.state as WorkerMessageResourceState);
  return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The worker messages view. Install it in the roster flow's `views`. */
export function defineWorkerMessagesView(): WorkerMessagesView {
  return defineView({
    scope: "user",
    key: (message) => message.id,
    block: handler({
      name: "workforce-worker-messages",
      inputSchema,
      outputSchema,
      resources: { [WORKER_MESSAGES_RESOURCE]: workerMessagesCollection },
      execute: async (input, ctx) => readWorkerMessages(messageLogOf(ctx), input)
    })
  });
}
