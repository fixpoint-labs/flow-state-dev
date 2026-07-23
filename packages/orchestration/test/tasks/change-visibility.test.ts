/**
 * FIX-918 — `getOrCreateTaskCollection({ changeVisibility })`.
 *
 * A task board that runs *inside* a tool-wrapped drain must not leak its
 * per-transition `task-change` component items into the calling generator's
 * LLM history (potentially O(tasks × transitions) items per single tool call).
 * The board still needs those items client-side so the live `<Plan />` UI
 * updates. `changeVisibility` lets the caller stamp `{ client: true, history:
 * false }` on the change stream to get exactly that.
 */

import { describe, it, expect } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { getOrCreateTaskCollection } from "../../src/tasks";

interface ChangeItem {
  type?: string;
  component?: string;
  itemVisibility?: { client?: boolean; history?: boolean };
}

/** Build a handler that seeds + completes a task on a request-backed board. */
function makeBoardMutator(changeVisibility?: { client: boolean; history: boolean }) {
  return handler({
    name: "mutate-board",
    inputSchema: z.unknown(),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (_input, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId: "vis",
        ...(changeVisibility ? { changeVisibility } : {}),
      });
      // Two additions → two `task-change` emits, no illegal transition.
      await collection.addTask({ goal: "do a thing" });
      await collection.addTask({ goal: "do another thing" });
      return { ok: true };
    },
  });
}

describe("getOrCreateTaskCollection — changeVisibility (FIX-918)", () => {
  it("stamps history:false on task-change emits when set (client stays true)", async () => {
    const result = await testBlock(
      makeBoardMutator({ client: true, history: false }),
      { input: undefined },
    );
    expect(result.error).toBeNull();

    const changes = (result.items as ChangeItem[]).filter(
      (i) => i.type === "component" && i.component === "task-change",
    );
    expect(changes.length).toBeGreaterThan(0);
    for (const item of changes) {
      expect(item.itemVisibility?.history).toBe(false);
      // Still delivered to the client so the live board UI updates.
      expect(item.itemVisibility?.client).toBe(true);
    }
  });

  it("does not force history:false by default (backward-compatible)", async () => {
    const result = await testBlock(makeBoardMutator(), { input: undefined });
    expect(result.error).toBeNull();

    const changes = (result.items as ChangeItem[]).filter(
      (i) => i.type === "component" && i.component === "task-change",
    );
    expect(changes.length).toBeGreaterThan(0);
    // No explicit override → the emit does not carry a history:false stamp
    // from this option (default visibility applies).
    for (const item of changes) {
      expect(item.itemVisibility?.history).not.toBe(false);
    }
  });
});
