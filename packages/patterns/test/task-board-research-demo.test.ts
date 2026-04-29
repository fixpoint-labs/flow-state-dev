/**
 * Research Board demo (FIX-446).
 *
 * The reference scenario the spec calls out: "watch a research team
 * self-organize against a task board." Three worker types
 * (`market-analyst`, `financial-analyst`, `synthesizer`), a dependency
 * chain (synthesize after both analyses complete), executed end-to-end
 * via the topological dispatcher.
 *
 * This test stands in for the full kitchen-sink demo until the
 * `<Plan />` UI lands (FIX-445); the substrate produces the live
 * `task_change` stream this test asserts on.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import type { TaskWorker } from "@flow-state-dev/tasks";

import { taskBoard } from "../src/task-board";

interface AnalysisInput {
  topic: string;
}

interface SynthesisInput {
  topic: string;
}

interface SynthesisDeps {
  market: { findings: string };
  financial: { findings: string };
}

function makeAnalyst(role: "market" | "financial"): TaskWorker {
  return handler({
    name: `${role}-analyst`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input: { input?: AnalysisInput }) => {
      // Simulate I/O latency so concurrent dispatch has something to
      // overlap. Without a yield, the JS event loop runs the two
      // analyses serially even with concurrency=2.
      await new Promise((r) => setTimeout(r, 5));
      return {
        findings: `${role}: ${input.input?.topic ?? "unknown"} analysis`,
      };
    },
  });
}

function makeSynthesizer(boardCollectionLookup: () => Map<string, unknown>): TaskWorker {
  return handler({
    name: "synthesizer",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input: { input?: SynthesisInput }) => {
      // The synthesizer reads its inputs from the board's completed
      // outputs. In a real flow it would walk `task.deps` and call
      // `collection.get(depId).output`; for the demo we mirror outputs
      // into a side-channel map keyed by task id.
      const outputs = boardCollectionLookup();
      const market = outputs.get("market-1") as SynthesisDeps["market"] | undefined;
      const financial = outputs.get("financial-1") as
        | SynthesisDeps["financial"]
        | undefined;
      return {
        report: `synthesis(${input.input?.topic ?? "unknown"}): ${market?.findings ?? "?"} | ${financial?.findings ?? "?"}`,
      };
    },
  });
}

describe("taskBoard - research-board demo", () => {
  it("dispatches 3 worker types through a dep chain", async () => {
    const outputs = new Map<string, unknown>();

    const trackingMarket = handler({
      name: "tracking-market",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input: { taskId: string; input?: AnalysisInput }) => {
        const out = await makeAnalyst("market").run(input as never, {} as never);
        outputs.set(input.taskId, out);
        return out;
      },
    });

    const trackingFinancial = handler({
      name: "tracking-financial",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input: { taskId: string; input?: AnalysisInput }) => {
        const out = await makeAnalyst("financial").run(input as never, {} as never);
        outputs.set(input.taskId, out);
        return out;
      },
    });

    const synth = makeSynthesizer(() => outputs);

    const board = taskBoard({
      name: "research-board",
      collection: { collectionId: "research" },
      concurrency: 3,
      dispatcher: "topological",
      workers: {
        "market-analyst": trackingMarket,
        "financial-analyst": trackingFinancial,
        synthesizer: synth,
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

    // The substrate emits a `task_change` per lifecycle transition. The
    // last seen status per task is the terminal one.
    const statusByTask = new Map<string, string>();
    let synthesisCompletedAfterAnalyses = false;
    let marketCompleted = false;
    let financialCompleted = false;
    for (const item of result.items as Array<{
      type?: string;
      kind?: string;
      task?: { id: string; status: string };
    }>) {
      if (item.type !== "task_change" || item.task === undefined) continue;
      statusByTask.set(item.task.id, item.task.status);
      if (item.kind === "completed") {
        if (item.task.id === "market-1") marketCompleted = true;
        if (item.task.id === "financial-1") financialCompleted = true;
        if (
          item.task.id === "synthesis-1" &&
          marketCompleted &&
          financialCompleted
        ) {
          synthesisCompletedAfterAnalyses = true;
        }
      }
    }

    expect(statusByTask.get("market-1")).toBe("completed");
    expect(statusByTask.get("financial-1")).toBe("completed");
    expect(statusByTask.get("synthesis-1")).toBe("completed");
    expect(synthesisCompletedAfterAnalyses).toBe(true);

    const synthesisOutput = outputs.get("synthesis-1");
    // No synthesis output cached for the synthesizer's own task — but
    // the substrate stamps `output` on the task itself. Verify via the
    // last task_change for that task.
    const synthesisTaskItems = (
      result.items as Array<{
        type?: string;
        task?: { id: string; output?: unknown };
      }>
    )
      .filter((i) => i.type === "task_change" && i.task?.id === "synthesis-1")
      .map((i) => i.task!.output);
    const finalOutput = synthesisTaskItems[synthesisTaskItems.length - 1] as
      | { report?: string }
      | undefined;
    expect(finalOutput?.report).toContain("market:");
    expect(finalOutput?.report).toContain("financial:");
    expect(synthesisOutput).toBeUndefined(); // not mirrored
  });
});
