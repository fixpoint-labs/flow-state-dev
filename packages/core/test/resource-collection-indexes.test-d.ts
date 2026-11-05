/**
 * Compile-time checks for `indexes` on `defineResourceCollection` and
 * `findBy` on its ref: both declaration shapes are accepted, and `findBy`
 * takes a scalar value and returns the collection's refs.
 */
import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core";

export const work = defineResourceCollection({
  pattern: "work/**",
  scope: "user",
  stateSchema: z.object({ id: z.string(), tags: z.array(z.string()) }),
  indexes: {
    byTaskId: (_key, state) => state.id,
    byTag: { version: 2, value: (_key, state) => state.tags },
  },
});

export async function lookups(ref: ResourceCollectionRef<{ id: string }>): Promise<void> {
  const [row] = await ref.findBy("byTaskId", "task-1");
  row?.state.id satisfies string | undefined;
  await ref.findBy("byCount", 3);
  // @ts-expect-error an index is equality on a scalar
  await ref.findBy("byTaskId", { id: "task-1" });
}
