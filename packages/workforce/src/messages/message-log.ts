/**
 * The message log (FIX-1989): the user-scoped collection the rows in
 * `log-row.ts` live in, and how a block reaches it.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { WORKER_MESSAGES_PATTERN, WORKER_MESSAGES_RESOURCE, workerMessageRowSchema, type WorkerMessageRow } from "./log-row";

export * from "./log-row";

/**
 * The log, at `workforce/messages/*` in the user's scope. Shared across flows:
 * a message runs between whatever flows its two workers run on, and the
 * roster flow declares it so an app reads it.
 */
export const workerMessagesCollection = defineResourceCollection({
  pattern: WORKER_MESSAGES_PATTERN,
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: workerMessageRowSchema,
  // The user's own rows, read by an app's Messages view; nobody writes them but the server.
  client: { state: { read: true } }
});

/** The flow resources that install the log. */
export const workerMessagesResources = { [WORKER_MESSAGES_RESOURCE]: workerMessagesCollection } as const;

/** The log, as the running block declared it. */
export function messageLogOf(ctx: BlockContext): ResourceCollectionRef<WorkerMessageRow> {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[WORKER_MESSAGES_RESOURCE];
  if (ref === undefined) {
    throw new Error(
      `The running flow doesn't declare the message log ("${WORKER_MESSAGES_RESOURCE}"). Spread the session kit's \`resources\` into the flow.`
    );
  }
  return ref as unknown as ResourceCollectionRef<WorkerMessageRow>;
}

/** A new message id. */
export function newMessageId(): string {
  return `msg_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
