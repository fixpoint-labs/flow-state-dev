// FIX-1989.
/**
 * The message log: the user-scoped collection the rows in
 * `log-row.ts` live in, and how a block reaches it. Beside it, the chain rows
 * the hop limit counts an exchange in (`hop.ts`).
 */
import { defineResourceCollection } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { isOpenMessage, WORKER_MESSAGES_PATTERN, WORKER_MESSAGES_RESOURCE, workerMessageResourceStateSchema, type WorkerMessageResourceState } from "./log-row";

export * from "./log-row";

// FIX-2771 D1.
/** The index a message is found by under its sender and its recipient while it is open (`isOpenMessage`). */
export const OPEN_MESSAGES_INDEX = "open";

// FIX-2771 D1.
/** The index an answer is found by under the id of the message it answers. */
export const IN_REPLY_TO_INDEX = "inReplyTo";

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
  stateSchema: workerMessageResourceStateSchema,
  // The user's own rows, read by an app's Messages view; nobody writes them but the server.
  client: { state: { read: true } },
  // FIX-2771 D1: what the worker messages view finds rows by. Changing what an
  // index function returns for rows already stored needs a `version` bump on
  // its declaration (`{ version: 2, value }`): the bump is what rebuilds the
  // index from the rows (`ResourceIndexDeclaration`).
  indexes: {
    [OPEN_MESSAGES_INDEX]: (_key, message) => (isOpenMessage(message) ? [message.from, message.to] : null),
    [IN_REPLY_TO_INDEX]: (_key, message) => message.inReplyTo
  }
});

// FIX-2775.
/** The log's definition, for a browser read of the caller's own messages: `useResource(workerMessagesResource, { all: true })`. */
export const workerMessagesResource = workerMessagesCollection;

/** Where the chain rows live, one per user's turn whose exchange sent a message. **Pinned**: persisted. */
export const MESSAGE_CHAINS_PATTERN = "workforce/message-chains/*";

/** The accessor a flow declares the chain rows under. */
export const MESSAGE_CHAINS_RESOURCE = "workforceMessageChains";

/** One chain: the ids of the messages sent in it, in the order their sends counted. */
const messageChainResourceStateSchema = z.object({ sent: z.array(z.string()).default([]) });

export type MessageChainResourceState = z.infer<typeof messageChainResourceStateSchema>;

/**
 * The chain rows, at `workforce/message-chains/*` in the user's scope: an
 * exchange runs across whatever flows its workers run on. Server-only.
 */
export const messageChainsCollection = defineResourceCollection({
  pattern: MESSAGE_CHAINS_PATTERN,
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: messageChainResourceStateSchema
});

/** The flow resources that install the log and the chain rows. */
export const workerMessagesResources = {
  [WORKER_MESSAGES_RESOURCE]: workerMessagesCollection,
  [MESSAGE_CHAINS_RESOURCE]: messageChainsCollection
} as const;

/** The log, as the running block declared it. */
export function messageLogOf(ctx: BlockContext): ResourceCollectionRef<WorkerMessageResourceState> {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[WORKER_MESSAGES_RESOURCE];
  if (ref === undefined) {
    throw new Error(
      `The running flow doesn't declare the message log ("${WORKER_MESSAGES_RESOURCE}"). Spread the session factory's \`resources\` into the flow.`
    );
  }
  return ref as unknown as ResourceCollectionRef<WorkerMessageResourceState>;
}

/** The chain rows, as the running block declared them. */
export function messageChainsOf(ctx: BlockContext): ResourceCollectionRef<MessageChainResourceState> {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[MESSAGE_CHAINS_RESOURCE];
  if (ref === undefined) {
    throw new Error(
      `The running flow doesn't declare the message chains ("${MESSAGE_CHAINS_RESOURCE}"). Spread the session factory's \`resources\` into the flow.`
    );
  }
  return ref as unknown as ResourceCollectionRef<MessageChainResourceState>;
}

/** A new message id. */
export function newMessageId(): string {
  return `msg_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
