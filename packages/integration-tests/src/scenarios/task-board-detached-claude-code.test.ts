/**
 * The task board accepts `claudeCodeAgent` as a detached worker once its
 * conversation state is turned off (LAB-133).
 *
 * This is the one behaviour that needs both packages in the same file, and it
 * is the whole reason the opt-out exists. The board refuses a detached worker
 * whose block — or any block composed under it — authors a
 * `sessionStateSchema`, because every detached worker in a flow becomes a route
 * on one shared Workstream flow. `claudeCodeAgent` authors one by default, so
 * before this option the composition could not be built at all.
 *
 * **Asserted here rather than in `packages/claude-code`** so a published vendor
 * package does not take a dev dependency on `@flow-state-dev/orchestration` for
 * one test, and **rather than only in the goal check** because the goal needs a
 * real model and the optional Agent SDK peer and therefore does not run in CI —
 * a construction refusal that started firing again would be invisible until
 * somebody ran the goal by hand. The composition itself still lives in the goal
 * check; this file builds the smallest board that exercises the refusal.
 *
 * The *rejecting* half is not re-pinned here: six tests in
 * `orchestration/test/task-board/task-board-detached-config.test.ts` already
 * cover it, one of them naming `sessionStateSchema` explicitly. What is new is
 * that a real block can now satisfy it.
 */
import { describe, expect, it } from "vitest";
import { sequencer } from "@flow-state-dev/core";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

const codingTasks = defineTaskCollection({ id: "lab133-coding", scope: "user" });

/**
 * The shape the goal check composes: an adapter turning the board's
 * `TaskWorkerInput` into the agent's required `{ prompt }`, then the agent.
 *
 * Composed rather than the bare block on purpose — the board's walk descends
 * into `childBlocks`, so a sequencer is what proves the opt-out survives
 * composition. A test that handed the board the bare handler would pass while
 * the real wiring still failed.
 */
function codingRun(options: { sessionState?: boolean }): TaskWorker {
  const toPrompt = sequencer({
    name: "lab133-coding-run",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.unknown(),
  }).step(
    claudeCodeAgent({
      model: "test-model",
      ...(options.sessionState === undefined ? {} : { sessionState: options.sessionState }),
    }).connectInput((input: { goal: string }) => ({ prompt: input.goal })),
  );
  return toPrompt as unknown as TaskWorker;
}

describe("task board × claudeCodeAgent (detached)", () => {
  it("accepts the agent as a detached worker when sessionState is off", () => {
    expect(() =>
      taskBoard({
        name: "coding",
        boardId: "coding",
        collection: codingTasks,
        workers: {
          implement: { worker: codingRun({ sessionState: false }), dispatch: { mode: "detached" } },
        },
      }),
    ).not.toThrow();
  });

  it("still refuses the agent as a detached worker with conversation state on", () => {
    // The contrast that makes the assertion above able to fail. Without it the
    // acceptance test would keep passing if the refusal were removed entirely,
    // proving nothing about the opt-out.
    expect(() =>
      taskBoard({
        name: "coding-default",
        boardId: "coding-default",
        collection: codingTasks,
        workers: {
          implement: { worker: codingRun({}), dispatch: { mode: "detached" } },
        },
      }),
    ).toThrow(/sessionStateSchema/);
  });
});
