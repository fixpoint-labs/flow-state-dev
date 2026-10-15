/**
 * The message log (FIX-1989): the user-scoped collection the rows in
 * `log-row.ts` live in, and how a block reaches it. Beside it, the chain rows
 * the hop limit counts an exchange in (`hop.ts`).
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
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

/** Where the chain rows live, one per user's turn whose exchange sent a message. **Pinned**: persisted. */
export const MESSAGE_CHAINS_PATTERN = "workforce/message-chains/*";

/** The accessor a flow declares the chain rows under. */
export const MESSAGE_CHAINS_RESOURCE = "workforceMessageChains";

/** One chain: the ids of the messages sent in it, in the order their sends counted. */
export const messageChainRowSchema = z.object({ sent: z.array(z.string()).default([]) });

export type MessageChainRow = z.infer<typeof messageChainRowSchema>;

/**
 * The chain rows, at `workforce/message-chains/*` in the user's scope: an
 * exchange runs across whatever flows its workers run on. Server-only.
 */
export const messageChainsCollection = defineResourceCollection({
  pattern: MESSAGE_CHAINS_PATTERN,
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: messageChainRowSchema
});

/** The flow resources that install the log and the chain rows. */
export const workerMessagesResources = {
  [WORKER_MESSAGES_RESOURCE]: workerMessagesCollection,
  [MESSAGE_CHAINS_RESOURCE]: messageChainsCollection
} as const;

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

/** The chain rows, as the running block declared them. */
export function messageChainsOf(ctx: BlockContext): ResourceCollectionRef<MessageChainRow> {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[MESSAGE_CHAINS_RESOURCE];
  if (ref === undefined) {
    throw new Error(
      `The running flow doesn't declare the message chains ("${MESSAGE_CHAINS_RESOURCE}"). Spread the session kit's \`resources\` into the flow.`
    );
  }
  return ref as unknown as ResourceCollectionRef<MessageChainRow>;
}

/** A new message id. */
export function newMessageId(): string {
  return `msg_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
