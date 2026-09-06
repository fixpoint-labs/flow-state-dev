/**
 * Lab B flow: seed a post as a claimable task, fan out wakes, apply L2 policy.
 *
 * L1 API used: `ctx.cap.replyBoard.tasks()` → `TaskCollectionRef.claim(workerId, { eligibility })`.
 * That is the same CAS claim `createClaimTask` / `taskBoard` drain uses.
 */
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { BOARD_NAME, postPayloadSchema, replyBoard } from "./board";
import { decideReply } from "./policy";
import { seedBoardPost } from "./seed";

export const policyModeSchema = z.enum(["on", "off"]);
export type PolicyMode = z.infer<typeof policyModeSchema>;

export const seedInputSchema = z.object({
  postId: z.string(),
  body: z.string(),
  addressedTo: z.string().optional(),
  needsReply: z.boolean().optional(),
});

export const receiveInputSchema = z.object({
  postId: z.string(),
  subscriberId: z.string(),
  policy: policyModeSchema,
});

export const receiveOutputSchema = z.object({
  postId: z.string(),
  subscriberId: z.string(),
  replied: z.boolean(),
  reason: z.string(),
});

export type ReceiveOutput = z.infer<typeof receiveOutputSchema>;

export const postInputSchema = seedInputSchema.extend({
  subscribers: z.array(z.string()).min(1),
  policy: policyModeSchema,
});

export const inspectInputSchema = z.object({
  postId: z.string(),
});

const seedPost = handler({
  name: "seed-post",
  inputSchema: seedInputSchema,
  outputSchema: z.object({ postId: z.string() }),
  uses: [replyBoard.capability],
  execute: async (input, ctx) => {
    const collection = await ctx.cap[BOARD_NAME].tasks();
    await seedBoardPost(collection, input);
    return { postId: input.postId };
  },
});

const receivePost = handler({
  name: "receive-post",
  inputSchema: receiveInputSchema,
  outputSchema: receiveOutputSchema,
  uses: [replyBoard.capability],
  execute: async (input, ctx): Promise<ReceiveOutput> => {
    const collection = await ctx.cap[BOARD_NAME].tasks();
    const row = collection.get(input.postId);
    if (row === undefined) {
      throw new Error(`unknown board post "${input.postId}"`);
    }

    const payload = postPayloadSchema.parse(row.input ?? {});

    if (input.policy === "off") {
      return {
        postId: input.postId,
        subscriberId: input.subscriberId,
        replied: true,
        reason: "no-policy",
      };
    }

    const decision = decideReply({
      subscriberId: input.subscriberId,
      addressedTo: payload.addressedTo,
      needsReply: payload.needsReply,
    });

    if (decision.action === "quiet") {
      return {
        postId: input.postId,
        subscriberId: input.subscriberId,
        replied: false,
        reason: decision.reason,
      };
    }

    const claimed = await collection.claim(input.subscriberId, {
      eligibility: (task) => task.id === input.postId,
    });
    if (claimed === null) {
      return {
        postId: input.postId,
        subscriberId: input.subscriberId,
        replied: false,
        reason: "lost-claim",
      };
    }

    await collection.complete(claimed.id, {
      subscriberId: input.subscriberId,
      text: `reply from ${input.subscriberId}`,
    });
    return {
      postId: input.postId,
      subscriberId: input.subscriberId,
      replied: true,
      reason: decision.reason,
    };
  },
});

const packWakes = handler({
  name: "pack-wakes",
  inputSchema: postInputSchema,
  outputSchema: z.object({
    postId: z.string(),
    wakes: z.array(receiveInputSchema),
  }),
  uses: [replyBoard.capability],
  execute: async (input, ctx) => {
    const collection = await ctx.cap[BOARD_NAME].tasks();
    await seedBoardPost(collection, input);
    return {
      postId: input.postId,
      wakes: input.subscribers.map((subscriberId) => ({
        postId: input.postId,
        subscriberId,
        policy: input.policy,
      })),
    };
  },
});

const wakeSubscriber = dispatcher({
  name: "wake-subscriber",
  type: "internal",
  target: "receive",
  inputSchema: receiveInputSchema,
  session: { key: (input) => input.subscriberId },
  payload: (input) => input,
});

const postAndFanout = sequencer({
  name: "post-and-fanout",
  inputSchema: postInputSchema,
})
  .step(packWakes)
  .forEach((packed) => packed.wakes, wakeSubscriber, { maxConcurrency: 16 });

const inspectPost = handler({
  name: "inspect-post",
  inputSchema: inspectInputSchema,
  outputSchema: z.object({
    postId: z.string(),
    status: z.string(),
    assignee: z.string().optional(),
    output: z.unknown().optional(),
  }),
  uses: [replyBoard.capability],
  execute: async (input, ctx) => {
    const collection = await ctx.cap[BOARD_NAME].tasks();
    const row = collection.get(input.postId);
    if (row === undefined) {
      throw new Error(`unknown board post "${input.postId}"`);
    }
    return {
      postId: row.id,
      status: row.status,
      ...(row.assignee !== undefined ? { assignee: row.assignee } : {}),
      ...(row.output !== undefined ? { output: row.output } : {}),
    };
  },
});

export const WORKFORCE_POC_B_KIND = "workforce-poc-b";

export const workforcePocBFlow = defineFlow({
  kind: WORKFORCE_POC_B_KIND,
  actions: {
    seed: {
      inputSchema: seedInputSchema,
      block: seedPost,
    },
    receive: {
      inputSchema: receiveInputSchema,
      block: receivePost,
    },
    post: {
      inputSchema: postInputSchema,
      block: postAndFanout,
    },
    inspect: {
      inputSchema: inspectInputSchema,
      block: inspectPost,
    },
  },
  internal: {
    actions: {
      receive: {
        inputSchema: receiveInputSchema,
        block: receivePost,
      },
    },
  },
})({ id: "default" });
