/**
 * FIX-2220 — `goalSeekLoop` resumes, in a later request, after the person answers.
 *
 * A pass ends waiting on the user: the task's worker asked midway, so the
 * loop stops without judging. The person answers after that request has
 * ended. The next run of the loop over the same user-scoped board must take
 * the turn the answer earned, on the task's same attempt, and judge the
 * finished work: never the half-done task, and never a re-seeded one.
 *
 * Only full `runAction` composition reaches this: three requests, one durable
 * board between them. A request-backed board, which the unit harnesses use,
 * is gone by the time the answer lands.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, openRowHolds } from "@flow-state-dev/orchestration/tasks";
import {
  askMidway,
  goalSeekLoop,
  taskBoard,
  taskWorkerInputSchema,
  GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE,
  type TaskBoardHandle,
  type Verdict,
} from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

const USER_ID = "u_goal_seek_answer";
const NAME = "answered-later";

/** The loop's termination record, read from a request's items. */
function readTermination(items: unknown[]): { reason?: string; iterations?: number } | undefined {
  const item = [...items]
    .reverse()
    .find(
      (i) =>
        (i as { type?: string }).type === "component" &&
        (i as { component?: string }).component === GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE,
    ) as { data?: { reason?: string; iterations?: number } } | undefined;
  return item?.data;
}

function buildFlow() {
  const ledger = defineTaskCollection({ id: NAME, scope: "user" });
  // The board's capability, for its own worker to read the board it is on.
  const { capability } = taskBoard({
    name: `${NAME}-board`,
    collection: ledger,
    workers: handler({ name: `${NAME}-probe`, inputSchema: taskWorkerInputSchema, outputSchema: z.unknown(), execute: () => null }),
  });
  const seen = { turns: 0, judgedOn: [] as Array<{ status: string; attempts: number }> };
  const board: TaskBoardHandle<any, any, any> = taskBoard({
    name: `${NAME}-board`,
    collection: ledger,
    initialTasks: [{ id: "a", goal: "write the report" }],
    workers: handler({
      name: `${NAME}-w`,
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.unknown(),
      uses: [capability],
      execute: async (_input, ctx) => {
        seen.turns += 1;
        if (seen.turns > 1) return { answer: "whole" };
        await askMidway(ctx, await (ctx.cap as any)[capability.name].tasks(), [{ prompt: "Which region?" }]);
        return { answer: "partial" };
      },
    }),
  });
  const loop = goalSeekLoop({
    name: NAME,
    board,
    judge: ({ collection }): Verdict => {
      const row = collection.get("a")!;
      seen.judgedOn.push({ status: row.status, attempts: row.attempts });
      return { decision: "done", reason: "converged" };
    },
    maxIterations: 3,
  });
  const answer = handler({
    name: `${NAME}-answer`,
    inputSchema: z.object({ message: z.string() }),
    uses: [capability],
    execute: async (input, ctx) => {
      const tasks = await (ctx.cap as any)[capability.name].tasks();
      const [hold] = openRowHolds(tasks.get("a"));
      return tasks.answer("a", { questionId: hold!.id, message: input.message, from: "user", by: USER_ID });
    },
  });
  const flow = defineFlow({
    kind: `${NAME}-flow`,
    actions: {
      plan: { inputSchema: z.unknown(), block: loop },
      answer: { inputSchema: z.object({ message: z.string() }), block: answer },
    },
  } as never)();
  return { flow, seen };
}

describe("goalSeekLoop: a later run after the person answers", () => {
  it("takes the owed turn on the same attempt, then judges the finished task", async () => {
    const { flow, seen } = buildFlow();
    const stores = createInMemoryStores();
    const run = (actionName: string, input: unknown) =>
      runAction({
        flow,
        actionName,
        input,
        sessionId: "s_1",
        userId: USER_ID,
        orgId: DEFAULT_ORG_ID,
        stores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      } as never) as Promise<{ error?: unknown; items: unknown[] }>;

    const first = await run("plan", {});
    expect(first.error).toBeUndefined();
    expect(readTermination(first.items)).toMatchObject({ reason: "waiting-on-a-user", iterations: 0 });

    expect((await run("answer", { message: "eu-west" })).error).toBeUndefined();

    const later = await run("plan", {});
    expect(later.error).toBeUndefined();
    expect(seen.turns).toBe(2);
    expect(seen.judgedOn).toEqual([{ status: "completed", attempts: 1 }]);
    expect(readTermination(later.items)).toMatchObject({ reason: "converged", iterations: 1 });
  });
});
