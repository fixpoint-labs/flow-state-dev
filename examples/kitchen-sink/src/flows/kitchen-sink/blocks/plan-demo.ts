/**
 * Plan Demo — kitchen-sink plan mode
 *
 * Pipeline: planner → [step executor × N] → synthesizer
 *
 * Each step runs silently and stores its finding as task.result.summary.
 * The <Plan /> card shows per-task summaries as steps complete.
 * After all steps, a synthesizer integrates the findings into a final answer.
 */
import { generator, utility } from "@flow-state-dev/core";
import { z } from "zod";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";

export const planDemoInputSchema = z.object({
  goal: z.string().min(1).describe("The goal to plan and execute"),
});

const MODEL = "openai/gpt-5.4-mini";

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------
// Runs silently. Result (task.result.summary) is displayed inside the <Plan />
// card as each task completes — no separate chat messages emitted.

const stepExecutor = generator({
  name: "plan-demo-step-executor",
  model: MODEL,
  inputSchema: z.object({ planId: z.string(), stepId: z.string(), goal: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
  prompt: [
    "You are a focused research executor.",
    "Given a specific task, produce a substantive finding in 2-4 sentences with specific facts or insights.",
    "Return a JSON object with a 'summary' field.",
  ].join("\n"),
  user: (input) => `Task: ${input.goal}`,
  emit: { messages: false },
});

// ---------------------------------------------------------------------------
// Plan block
// ---------------------------------------------------------------------------

export const planDemo = planAndExecute({
  name: "plan-demo",
  planId: "demo",
  enableReplanning: false,
  planner: utility.decomposer({ name: "plan-demo-planner", model: MODEL }),
  stepExecutor,
});

