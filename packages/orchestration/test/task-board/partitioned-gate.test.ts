/**
 * The claim gate over a ledger kept per partition: a dispatch's row is read at
 * the partition the dispatch names, and nowhere else (BR-21).
 *
 * Run as an action root over one in-memory partitioned ledger holding the same
 * task id, claimed, in two partitions, so an envelope can name either. The
 * happy path across two real flows is `hand-off-cross-flow.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core";
import type { ActionCore, BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "../../src/tasks";
import { createTaskGate, taskLedgers, taskWorkerInputSchema } from "../../src/task-board";
import { createFakeResourceCollection } from "../helpers";

const LEDGER = "gate-ledger";
const USER_ID = "alice";

async function harness() {
  const declared = defineTaskCollection({ id: LEDGER, scope: "user", partitionBy: () => "unused" });
  const store = Object.assign(createFakeResourceCollection<JsonObject>(`${LEDGER}/**`), {
    config: declared,
  }) as ResourceCollectionRef<JsonObject>;
  const ctx = {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_parent", userId: USER_ID } },
    request: { identity: { type: "request", id: "r_parent" } },
  } as unknown as BlockContext;
  const at = (partition: string | undefined, runCtx: BlockContext = ctx): Promise<TaskCollectionRef> =>
    getOrCreateTaskCollection({
      ctx: runCtx,
      backing: "resource",
      collectionId: LEDGER,
      collection: store,
      ...(partition !== undefined ? { partition } : {}),
    });

  for (const partition of ["conv-a", "conv-b"]) {
    const ref = await at(partition);
    await ref.addTask({ id: "t1", goal: `do it for ${partition}`, assignee: "work", input: {} });
    await ref.claim("drain", { leaseDurationMs: 60_000 });
  }

  const ran: string[] = [];
  const worker = handler({
    name: "gate-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ on: z.string() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(input.goal);
      return { on: input.goal };
    },
  });

  const flowFor = (gate: ReturnType<typeof taskLedgers>["gate"]) => {
    const entry = gate({ block: worker } as unknown as ActionCore, "work");
    return defineFlow({ kind: "gate-flow", actions: { work: entry } } as never)({ id: "gate-flow" });
  };
  const runStores = createInMemoryStores();
  /** Dispatch `rowOf`'s claim identity, naming `named` as the partition. */
  const run = async (
    flow: ReturnType<typeof flowFor>,
    rowOf: string,
    named: string | undefined,
    boardId = LEDGER
  ) => {
    const row = (await at(rowOf)).get("t1") as Task;
    return runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "work",
      input: {
        boardId,
        seat: "work",
        taskId: "t1",
        attempt: row.attempts,
        createdAt: row.createdAt,
        incarnationId: row.incarnationId,
        ...(named !== undefined ? { partition: named } : {}),
        payload: { taskId: "t1", goal: row.goal, attempts: row.attempts, input: {} },
      },
      userId: USER_ID,
      sessionId: `s_child_${Math.random()}`,
      stores: runStores,
      runtimeConfig: { modelResolver: createMockModelResolver({}) },
    });
  };
  const row = async (partition: string) => (await at(partition)).get("t1") as Task;
  return { at, ran, flowFor, run, row };
}

describe("a task entry served by a partitioned ledger (taskLedgers)", () => {
  const byPartition = (h: Awaited<ReturnType<typeof harness>>, seen: Array<string | undefined> = []) =>
    h.flowFor(
      taskLedgers({
        name: "door",
        resolve: async (_id, ctx, partition) => {
          seen.push(partition);
          return h.at(partition, ctx);
        },
      }).gate
    );

  it("reads and settles the row in the partition the dispatch names, and only there", async () => {
    const h = await harness();
    const seen: Array<string | undefined> = [];
    const result = await h.run(byPartition(h, seen), "conv-b", "conv-b");
    expect(result.error).toBeUndefined();
    expect(seen[0]).toBe("conv-b");
    expect(h.ran).toEqual(["do it for conv-b"]);
    expect((await h.row("conv-b")).status).toBe("completed");
    expect((await h.row("conv-a")).status).toBe("in_progress");
  });

  it("BR-21 · fails the claim check when the dispatch names another of the user's partitions", async () => {
    const h = await harness();
    // conv-a's claim, sent to conv-b's row of the same task id.
    await h.run(byPartition(h), "conv-a", "conv-b");
    expect(h.ran).toEqual([]);
    for (const partition of ["conv-a", "conv-b"]) {
      const row = await h.row(partition);
      expect(row.status).toBe("in_progress");
      expect(row.run).toBeUndefined();
    }
  });

  it("is refused when the dispatch names no partition", async () => {
    const h = await harness();
    const result = await h.run(byPartition(h), "conv-a", undefined);
    expect(JSON.stringify(result.error ?? result.output ?? "")).toMatch(/never read whole/);
    expect(h.ran).toEqual([]);
  });

  it("refuses a resolver that answers with another partition before reading a row", async () => {
    const h = await harness();
    const flow = h.flowFor(
      taskLedgers({ name: "door", resolve: async (_id, ctx) => h.at("conv-b", ctx) }).gate
    );
    const result = await h.run(flow, "conv-a", "conv-a");
    expect(JSON.stringify(result.error ?? result.output ?? "")).toMatch(/resolver answered with/);
    expect(h.ran).toEqual([]);
    expect((await h.row("conv-b")).run).toBeUndefined();
  });
});

describe("a board's own gate over a partitioned ledger", () => {
  const boardGate = (h: Awaited<ReturnType<typeof harness>>, partitioned: boolean) =>
    h.flowFor(
      createTaskGate({
        name: "board",
        boardId: LEDGER,
        // Never the right answer in a child: it names the child's own partition.
        collection: async () => {
          throw new Error("the gate resolved the board through the child's own context");
        },
        ...(partitioned ? { collectionInPartition: (ctx, partition) => h.at(partition, ctx) } : {}),
        onError: "skip",
      })
    );

  it("reads the row at the dispatch's partition, never through the child's own context", async () => {
    const h = await harness();
    const result = await h.run(boardGate(h, true), "conv-a", "conv-a");
    expect(result.error).toBeUndefined();
    expect(h.ran).toEqual(["do it for conv-a"]);
    expect((await h.row("conv-a")).status).toBe("completed");
    expect((await h.row("conv-b")).status).toBe("in_progress");
  });

  it("is refused when a partitioned board's dispatch names no partition", async () => {
    const h = await harness();
    const result = await h.run(boardGate(h, true), "conv-a", undefined);
    expect(JSON.stringify(result.error ?? result.output ?? "")).toMatch(/names none/);
    expect(h.ran).toEqual([]);
  });

  it("is refused when the dispatch names a partition the board's ledger does not keep", async () => {
    const h = await harness();
    const result = await h.run(boardGate(h, false), "conv-a", "conv-a");
    expect(JSON.stringify(result.error ?? result.output ?? "")).toMatch(/keeps no partitions/);
    expect(h.ran).toEqual([]);
  });
});
