/**
 * The task board accepts `claudeCodeAgent` as a handed-off worker once its
 * conversation state is turned off (LAB-133). See `detached` in
 * `packages/claude-code/src/sdk/agent.ts` for what the option does and why.
 *
 * **Asserted here** rather than in `packages/claude-code` (which would take an
 * `@flow-state-dev/orchestration` dev dependency for one test) and rather than
 * only in the goal check (which needs a real model and the optional Agent SDK
 * peer, so it does not run in CI). The composition itself lives in the goal
 * check; this file builds the smallest board that exercises the refusal.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher, sequencer } from "@flow-state-dev/core";
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
function codingRun(options: { detached?: boolean }): TaskWorker {
  const toPrompt = sequencer({
    name: "lab133-coding-run",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.unknown(),
  }).step(
    // `detached: undefined` is the same as omitting it — the block's own
    // default applies — so the conditional spread bought nothing.
    claudeCodeAgent({
      model: "test-model",
      detached: options.detached,
    }).connectInput((input: { goal: string }) => ({ prompt: input.goal })),
  );
  return toPrompt as unknown as TaskWorker;
}

/**
 * The smallest flow that hands `implement` off to `block`: the refusal fires
 * where the entry's block is known — `defineFlow`, which gates the entry
 * behind the board — not at `taskBoard()`, which never sees the block.
 */
function flowHandingOffTo(kind: string, block: TaskWorker) {
  const board = taskBoard({
    name: kind,
    boardId: kind,
    collection: codingTasks,
    workers: {
      implement: dispatcher({
        name: `${kind}-hand-off`,
        type: "task",
        target: "implement",
        session: "per-task",
      }),
    },
  });
  return defineFlow({
    kind,
    actions: { drain: { block: board.drain } },
    tasks: { implement: { block } },
  });
}

describe("task board × claudeCodeAgent (hand-off)", () => {
  it("accepts the agent as a handed-off entry block when detached is set", () => {
    expect(() => flowHandingOffTo("coding", codingRun({ detached: true }))).not.toThrow();
  });

  it("still refuses the agent as a handed-off entry block with conversation state on", () => {
    // The contrast that makes the assertion above able to fail. Without it the
    // acceptance test would keep passing if the refusal were removed entirely,
    // proving nothing about the opt-out.
    expect(() => flowHandingOffTo("coding-default", codingRun({}))).toThrow(/sessionStateSchema/);
  });
});
