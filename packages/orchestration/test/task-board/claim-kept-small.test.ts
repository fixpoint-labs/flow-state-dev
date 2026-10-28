/**
 * A drain's claim is kept with the request so a replay after a park reads it
 * back instead of claiming again (FIX-2082). What is kept is the row's id and
 * the attempt it was claimed on, never the row itself (BP-042): the replay
 * reads the row again and shows it as claimed.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import { asRuntime, type BlockContext, type ResourceCollectionRef } from "@flow-state-dev/core/types";
import { defineTaskCollection, getOrCreateTaskCollection, type Task, type TaskCollectionRef } from "../../src/tasks";
import { createClaimTask } from "../../src/task-board";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

function ctxWith(memo: Map<string, unknown>): BlockContext {
  return {
    emit: { component: () => undefined, status: () => undefined },
    _blockIdentity: { blockName: "claim", blockInstanceId: "req_1:root/step[0]/loop[0]/step[1]:0" },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "req_1" } },
    sequencer: createFakeSequencerState<Record<string, unknown>>({}),
    runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fn();
      memo.set(key, value);
      return value;
    }
  } as unknown as BlockContext;
}

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef> {
  const store = Object.assign(createFakeResourceCollection<JsonObject>("rows/**"), {
    config: defineTaskCollection({ id: "rows", scope: "user" })
  });
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "rows", collection: store as ResourceCollectionRef<JsonObject> });
}

describe("the claim a drain keeps with its request", () => {
  it("keeps the row's id and attempt, and a replay shows the row as claimed without claiming again", async () => {
    const memo = new Map<string, unknown>();
    const board = await boardOf(ctxWith(memo));
    const filed = await board.addTask({ goal: "outline", assignee: "writer", input: { big: "x".repeat(10_000) } });
    let claims = 0;
    const block = createClaimTask({
      name: "claim",
      collection: async () => board,
      dispatcher: {
        claim: async (collection: TaskCollectionRef, worker: string) => {
          claims += 1;
          return collection.claim(worker);
        }
      } as never,
      workerId: () => "w"
    });
    const run = (ctx: BlockContext) => asRuntime(block).run(undefined, ctx) as Promise<{ claimed: boolean; task?: Task }>;

    const first = await run(ctxWith(memo));
    expect(first).toMatchObject({ claimed: true, task: { id: filed.id, status: "in_progress", attempts: 1 } });
    const [kept] = [...memo.values()];
    expect(kept).toEqual({ claimedId: filed.id, attempts: 1 });

    // The row moves on (its child completes it) before the replay.
    await board.complete(filed.id, "done");
    const replay = await run(ctxWith(memo));
    expect(claims).toBe(1);
    expect(replay).toMatchObject({ claimed: true, task: { id: filed.id, status: "in_progress", attempts: 1, goal: "outline" } });
  });

  it("keeps a claim that found nothing as none, and a replay claims nothing either", async () => {
    const memo = new Map<string, unknown>();
    const board = await boardOf(ctxWith(memo));
    let claims = 0;
    const block = createClaimTask({
      name: "claim",
      collection: async () => board,
      dispatcher: {
        claim: async () => {
          claims += 1;
          return null;
        }
      } as never,
      workerId: () => "w"
    });
    const run = (ctx: BlockContext) => asRuntime(block).run(undefined, ctx) as Promise<{ claimed: boolean; task?: Task }>;
    expect(await run(ctxWith(memo))).toEqual({ claimed: false });
    expect([...memo.values()]).toEqual([null]);
    // A row filed since doesn't change what the replay of this pass claimed.
    await board.addTask({ goal: "later", assignee: "writer" });
    expect(await run(ctxWith(memo))).toEqual({ claimed: false });
    expect(claims).toBe(1);
  });
});
