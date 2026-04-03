/**
 * Plan Demo — kitchen-sink plan mode
 *
 * Pipeline: planner sequencer → [step executor × N] → synthesizer
 *
 * The planner is its own sequencer so memory context flows into decomposition
 * and memory capture runs after planning — not after each worker step.
 * Workers execute in isolation; only the planning stage is memory-aware.
 *
 * Each step stores its finding as task.result.summary. The <Plan /> card
 * shows per-task summaries as steps complete. After all steps, the built-in
 * synthesizer integrates findings into a final answer.
 */
import { generator, sequencer, utility } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { planAndExecute, planAndExecuteInputSchema } from "@flow-state-dev/patterns/plan-and-execute";

export const planDemoInputSchema = z.object({
  goal: z.string().min(1).describe("The goal to plan and execute"),
});

const MODEL = "openai/gpt-5.4-mini";

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------
// Returns { summary, success, reason?, sources? } — the evaluator reads the
// success signal to determine if the task produced meaningful output.
// Sources from web search are preserved in task.result for the synthesizer.

const stepExecutor = generator({
  name: "plan-demo-step-executor",
  model: MODEL,
  inputSchema: z.object({
    stepId: z.string(),
    goal: z.string(),
    dependencyResults: z.record(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    summary: z.string(),
    success: z.boolean(),
    reason: z.string().optional(),
    sources: z.array(z.object({
      title: z.string().optional(),
      url: z.string(),
    })).optional(),
  }),
  search: true,
  prompt: [
    "You are a focused research executor.",
    "Given a specific task, produce a substantive finding in 2-4 sentences with specific facts or insights.",
    "If prior task results are provided, build directly on that context rather than starting from scratch.",
    "Return a JSON object with:",
    "- summary: your substantive finding",
    "- success: true if you found meaningful information, false if the information was unavailable or missing",
    "- reason: (only if success is false) a brief explanation of why the task could not be completed",
    "- sources: list of { title?, url } for any web sources you consulted (omit if no search was performed)",
  ].join("\n"),
  user: (input) => {
    const parts = [`Task: ${input.goal}`];
    if (input.dependencyResults && Object.keys(input.dependencyResults).length > 0) {
      const context = Object.values(input.dependencyResults)
        .map((r) => {
          const obj = r as Record<string, unknown> | null | undefined;
          return obj && typeof obj === "object" && "summary" in obj
            ? String(obj.summary)
            : JSON.stringify(r);
        })
        .join("\n");
      parts.push(`\nContext from prior tasks:\n${context}`);
    }
    return parts.join("\n");
  },
  emit: { messages: false },
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
// Takes the flow's memory system so the planner sequencer can inject memory
// context into decomposition and capture the planning conversation afterward.
// Worker steps are intentionally excluded from memory tracking.

export interface PlanDemoMemory {
  contextFormatter: BlockDefinition<any, any> | ((input: unknown, ctx: any) => string | undefined | Promise<string | undefined>);
  captureFromItems: BlockDefinition<any, any>;
}

export function createPlanDemo(mem: PlanDemoMemory) {
  // Planner is its own sequencer: decompose with memory context, then
  // capture the planning exchange as a memory. Workers run outside this
  // sequencer so they are not analyzed.
  const planner = sequencer({
    name: "plan-demo-planner",
    inputSchema: planAndExecuteInputSchema,
  })
    .then(utility.decomposer({
      name: "plan-demo-decomposer",
      model: MODEL,
      context: [mem.contextFormatter as any],
    }))
    .work(mem.captureFromItems);

  return planAndExecute({
    name: "plan-demo",
    enableReplanning: true,
    planner,
    stepExecutor
  });
}
