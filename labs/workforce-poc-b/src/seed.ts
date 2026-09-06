/**
 * Write one board-post row onto the shared task collection.
 * Used by `seed` and by `post` (before fan-out). Not a lock.
 */
import type { TaskCollectionRef } from "@flow-state-dev/orchestration";
import { postPayloadSchema } from "./board";
import { parseAddress } from "./policy";

export function resolveAddress(body: string, explicit?: string): string | undefined {
  return explicit ?? parseAddress(body);
}

export async function seedBoardPost(
  collection: TaskCollectionRef,
  input: {
    postId: string;
    body: string;
    addressedTo?: string;
    needsReply?: boolean;
  }
): Promise<{ postId: string; addressedTo: string | undefined }> {
  const addressedTo = resolveAddress(input.body, input.addressedTo);
  await collection.addTask({
    id: input.postId,
    goal: input.body,
    assignee: addressedTo,
    input: postPayloadSchema.parse({
      body: input.body,
      ...(addressedTo !== undefined ? { addressedTo } : {}),
      ...(input.needsReply === true ? { needsReply: true } : {}),
    }),
    metadata: { kind: "board-post" },
  });
  return { postId: input.postId, addressedTo };
}
