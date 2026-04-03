/**
 * Plan Demo — kitchen-sink action
 *
 * Demonstrates the plan-and-execute pattern with emitPlanSnapshot:
 *   1. A planner LLM decomposes the goal into tasks
 *   2. Each task is executed sequentially (dependencies respected)
 *   3. emitPlanSnapshot emits plan state into the chat stream after the plan
 *      is saved and after each task completes — rendered inline by <Plan />
 *
 * Shows: resource-backed plan state, inline plan progress snapshots, and
 * the step executor pattern.
 *
 * Register with planResources in the flow's session resources:
 *   session: { resources: { ...artifactResources, ...planResources } }
 */
import { handler, generator } from "@flow-state-dev/core";
import { z } from "zod";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";

export const planDemoInputSchema = z.object({
  goal: z.string().min(1).describe("The goal to plan and execute"),
});

const MODEL = "openai/gpt-5.4-mini";

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------
// Receives { planId, stepId, goal } and generates a brief result for the task.

const stepExecutorGenerator = generator({
  name: "plan-demo-step-executor",
  model: MODEL,
  inputSchema: z.object({
    planId: z.string(),
    stepId: z.string(),
    goal: z.string(),
  }),
  outputSchema: z.object({
    summary: z.string(),
  }),
  prompt: [
    "You are a task executor. You receive a single task goal and produce a concise result.",
    "Keep your response to 1-2 sentences. Focus on what was accomplished.",
    "Return your result as a JSON object with a 'summary' field.",
  ].join("\n"),
  user: (input) => `Task: ${input.goal}`,
  emit: { messages: false },
});

// Wraps the generator so each completed step emits a brief message inline.
const stepExecutor = handler({
  name: "plan-demo-step",
  inputSchema: z.object({
    planId: z.string(),
    stepId: z.string(),
    goal: z.string(),
  }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async (input, ctx) => {
    const result = await stepExecutorGenerator.run(input, ctx as any) as { summary: string };
    ctx.emitMessage(`**${input.goal}**\n\n${result.summary}`);
    return result;
  },
});

// ---------------------------------------------------------------------------
// Plan demo block
// ---------------------------------------------------------------------------

export const planDemo = planAndExecute({
  name: "plan-demo",
  planId: "demo",
  enableReplanning: false,
  stepExecutor,
});
