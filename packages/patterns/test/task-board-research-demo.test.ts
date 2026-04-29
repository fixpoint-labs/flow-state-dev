/**
 * Research Board demo (FIX-446).
 *
 * The reference scenario the spec calls out: "watch a research team
 * self-organize against a task board." Three worker types
 * (`market-analyst`, `financial-analyst`, `synthesizer`), a dependency
 * chain (synthesize after both analyses complete), executed
 * end-to-end via the topological dispatcher.
 *
 * Workers here are plain blocks with typed input/output schemas — no
 * `z.any()` escape hatches and no handler-wrapping-worker indirection
 * (BP-011). The synthesizer reads its dep outputs from the
 * collection's own state via `ctx.getTarget("research-board")` —
 * `task.deps` carries the dep ids and the substrate stamps `output`
 * on each completed task.
 *
 * Stands in for the kitchen-sink `<Plan />` demo until FIX-445 lands;
 * the substrate produces the live `task-change` component-item stream
 * that demo will subscribe to.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  type Task,
  type TaskWorker,
} from "@flow-state-dev/tasks";

import { taskBoard, taskWorkerInputSchema } from "../src/task-board";

// ---------------------------------------------------------------------------
// Typed worker schemas
// ---------------------------------------------------------------------------

const analysisInputSchema = z.object({ topic: z.string() });
const analysisOutputSchema = z.object({ findings: z.string() });
const synthesisInputSchema = z.object({ topic: z.string() });
const synthesisOutputSchema = z.object({ report: z.string() });

const analystWorkerInputSchema = taskWorkerInputSchema.extend({
  input: analysisInputSchema.optional(),
});
const synthWorkerInputSchema = taskWorkerInputSchema.extend({
  input: synthesisInputSchema.optional(),
});

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

function makeAnalyst(role: "market" | "financial"): TaskWorker {
  return handler({
    name: `${role}-analyst`,
    inputSchema: analystWorkerInputSchema,
    outputSchema: analysisOutputSchema,
    execute: (input) => ({
      findings: `${role}: ${input.input?.topic ?? "unknown"} analysis`,
    }),
  }) as TaskWorker;
}

/**
 * Synthesizer — looks up its dep outputs by reading the board's
 * collection state. The pattern stamps `task.deps` (id list) on each
 * task at creation; the substrate's `complete()` writes the worker's
 * output back to `task.output`. So the synthesizer walks
 * `claimedTask.deps` and reads `collection.get(depId).output`.
 */
function makeSynthesizer(): TaskWorker {
  return handler({
    name: "synthesizer",
    inputSchema: synthWorkerInputSchema,
    outputSchema: synthesisOutputSchema,
    execute: (input, ctx: BlockContext) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "sequencer",
        collectionId: "research",
        sequencer: ctx.getTarget("research-board")! as never,
      });
      const self = collection.get(input.taskId) as Task | undefined;
      const depOutputs = (self?.deps ?? [])
        .map((id) => collection.get(id))
        .filter((t): t is Task => t !== undefined)
        .map((t) => t.output as { findings?: string } | undefined);
      const findings = depOutputs.map((o) => o?.findings ?? "?").join(" | ");
      return {
        report: `synthesis(${input.input?.topic ?? "unknown"}): ${findings}`,
      };
    },
  }) as TaskWorker;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("taskBoard - research-board demo", () => {
  it("dispatches 3 worker types through a dep chain", async () => {
    const board = taskBoard({
      name: "research-board",
      collection: { collectionId: "research" },
      concurrency: 3,
      dispatcher: "topological",
      workers: {
        "market-analyst": makeAnalyst("market"),
        "financial-analyst": makeAnalyst("financial"),
        synthesizer: makeSynthesizer(),
      },
      initialTasks: [
        {
          id: "market-1",
          goal: "market analysis",
          assignee: "market-analyst",
          input: { topic: "fictional-corp" },
        },
        {
          id: "financial-1",
          goal: "financial analysis",
          assignee: "financial-analyst",
          input: { topic: "fictional-corp" },
        },
        {
          id: "synthesis-1",
          goal: "combined report",
          assignee: "synthesizer",
          deps: ["market-1", "financial-1"],
          input: { topic: "fictional-corp" },
        },
      ],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();

    // Walk the `task-change` component-item stream: assert all three
    // completed and that synthesis-1 completed AFTER both analyses (the
    // topological dispatcher's contract).
    const statusByTask = new Map<string, string>();
    let marketCompleted = false;
    let financialCompleted = false;
    let synthesisCompletedAfterAnalyses = false;
    let synthesisOutput: { report?: string } | undefined;

    for (const item of result.items as Array<{
      type?: string;
      component?: string;
      data?: {
        kind?: string;
        task?: { id: string; status: string; output?: unknown };
      };
    }>) {
      if (
        item.type !== "component" ||
        item.component !== "task-change" ||
        item.data?.task === undefined
      ) {
        continue;
      }
      const { kind, task } = item.data;
      statusByTask.set(task.id, task.status);
      if (kind === "completed") {
        if (task.id === "market-1") marketCompleted = true;
        if (task.id === "financial-1") financialCompleted = true;
        if (
          task.id === "synthesis-1" &&
          marketCompleted &&
          financialCompleted
        ) {
          synthesisCompletedAfterAnalyses = true;
          synthesisOutput = task.output as { report?: string };
        }
      }
    }

    expect(statusByTask.get("market-1")).toBe("completed");
    expect(statusByTask.get("financial-1")).toBe("completed");
    expect(statusByTask.get("synthesis-1")).toBe("completed");
    expect(synthesisCompletedAfterAnalyses).toBe(true);

    // The synthesizer composes its dep outputs by reading
    // `collection.get(depId).output` — verifies the pattern's
    // dependency-result-passing actually works through the substrate.
    expect(synthesisOutput?.report).toContain("market: fictional-corp");
    expect(synthesisOutput?.report).toContain("financial: fictional-corp");
  });
});
