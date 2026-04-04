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
 * shows per-task summaries as steps complete. After all steps, the custom
 * synthesizer integrates findings into a final answer and can save it as an
 * artifact when the result is substantive.
 */
import { generator, sequencer, utility } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { planAndExecute, planAndExecuteInputSchema } from "@flow-state-dev/patterns/plan-and-execute";
import { readArtifact } from "./read-artifact";
import { updateArtifact } from "./update-artifact";
import { artifactResources } from "../schemas";
import { artifactListContext } from "./agent-context";

export const planDemoInputSchema = z.object({
  goal: z.string().min(1).describe("The goal to plan and execute"),
});

const MODEL = "openai/gpt-5.4-mini";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
// Takes the flow's memory system so both the planner and step executor can
// access memory context. Workers receive context for recall but are not
// captured into memory — only the planning stage is captured.

export interface PlanDemoMemory {
  contextFormatter: BlockDefinition<any, any> | ((input: unknown, ctx: any) => string | undefined | Promise<string | undefined>);
  captureFromItems: BlockDefinition<any, any>;
}

// ---------------------------------------------------------------------------
// Synthesizer prompt builder
// ---------------------------------------------------------------------------
// Extracted so it can be shared between the default synthesizer (in the
// patterns package) and this custom one without duplication.

function buildSynthesizerUserPrompt(input: {
  goal: string;
  completedSteps: number;
  tasks: Array<{ goal: string; status: string; result?: unknown; error?: string }>;
}): string {
  if (input.completedSteps === 0) {
    const failed = input.tasks.filter((t) => t.status === "failed");
    const firstError = failed[0]?.error ?? "unknown error";
    return [
      `Goal: ${input.goal}`,
      ``,
      `No research tasks completed. The plan encountered an error on the first task: ${firstError}`,
      `Downstream tasks were skipped as a result.`,
      `Acknowledge that you were unable to gather findings for this goal and briefly explain why based on the error above.`,
    ].join("\n");
  }

  const allSources: Array<{ title?: string; url: string }> = [];

  const findings = input.tasks
    .filter((t) => t.status === "completed")
    .map((t, i) => {
      const r = t.result as Record<string, unknown> | null | undefined;
      const summary =
        r && typeof r === "object" && "summary" in r
          ? String(r.summary)
          : JSON.stringify(r);
      if (r && typeof r === "object" && Array.isArray(r.sources)) {
        allSources.push(...(r.sources as Array<{ title?: string; url: string }>));
      }
      return `${i + 1}. ${t.goal}\n   ${summary}`;
    })
    .join("\n\n");

  const seen = new Set<string>();
  const uniqueSources = allSources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  const sourcesSection =
    uniqueSources.length > 0
      ? `\n\nSources:\n${uniqueSources.map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.url}`).join("\n")}`
      : "";

  return `Goal: ${input.goal}\n\nFindings:\n\n${findings}${sourcesSection}`;
}

export function createPlanDemo(mem: PlanDemoMemory) {
  // Step executor: receives memory context for recall so it can draw on prior
  // knowledge. Has read-only access to artifacts so steps can reference
  // existing work (e.g. "update the spec with these findings").
  // NOT captured into memory — workers shouldn't pollute episodic memory.
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
    sessionResources: { ...artifactResources },
    context: [mem.contextFormatter as any, artifactListContext],
    tools: [readArtifact],
    search: true,
    maxIterations: 5,
    prompt: [
      "You are a focused research executor.",
      "Given a specific task, produce a substantive finding in 2-4 sentences with specific facts or insights.",
      "Use the web to find information if needed, you have search capabilities available to you.",
      "If prior task results are provided, build directly on that context rather than starting from scratch.",
      "If an existing artifact is relevant to your task, use read-artifact to access it.",
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

  // Custom synthesizer: integrates findings and optionally saves the result
  // as an artifact when the output is substantive (report, analysis, plan).
  // Has full read+write artifact access; memory context available for recall.
  const synthesizer = generator({
    name: "plan-demo-synthesizer",
    model: MODEL,
    sessionResources: { ...artifactResources },
    context: [mem.contextFormatter as any, artifactListContext],
    inputSchema: z.object({
      goal: z.string(),
      tasks: z.array(z.object({
        id: z.string(),
        goal: z.string(),
        status: z.string(),
        result: z.unknown().optional(),
        error: z.string().optional(),
      })),
      completedSteps: z.number(),
      totalSteps: z.number(),
    }),
    outputSchema: z.string(),
    tools: [readArtifact, updateArtifact],
    prompt: [
      "You are synthesizing findings from a structured multi-step research process.",
      "Write a clear, direct final answer to the original goal.",
      "Integrate the findings into a coherent narrative — do not just summarize each step.",
      "Be specific and draw on the concrete facts gathered.",
      "If no findings are available, briefly explain that the research could not be completed and why, without asking the user for more information.",
      "",
      "If the result is a substantive document — a report, analysis, specification, or structured plan —",
      "save it as an artifact using update-artifact with a descriptive id (kebab-case) and a clear title.",
      "If it's a conversational answer or short response, just reply without saving.",
    ].join("\n"),
    user: (input) => buildSynthesizerUserPrompt(input),
    emit: { messages: true },
  });

  // Planner is its own sequencer: decompose with memory context so prior
  // conversations inform task decomposition, then capture the planning
  // exchange into memory. Workers run outside this sequencer.
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
    stepExecutor,
    synthesizer,
    sessionResources: { ...artifactResources },
  });
}
