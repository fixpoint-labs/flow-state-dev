/**
 * Supervisor pipeline — plan → dispatch workers → review → replan loop.
 *
 * Uses a dedicated worker generator: a task-focused system prompt
 * (`supervisor-worker.prompt.md`) with a TS `user:` builder that formats the
 * task goal, prior-task deps, and feedback. Workers emit silently (history:
 * false) so per-task messages don't pollute the conversation stream.
 */
import { generator } from "@flow-state-dev/core";
import { supervisor } from "@flow-state-dev/patterns/supervisor";
import { z } from "zod";
import { loadPrompt } from "../../../shared/prompts";
import type { PipelineConfig } from "./config";

const supervisorWorkerPrompt = loadPrompt(
  "run/thinking-styles/prompts/supervisor-worker.prompt.md",
);

/** Build the `supervisor-thinking` pipeline from the resolved router config. */
export function createSupervisorPipeline(config: PipelineConfig) {
  const { modelId, context, workerContext, uses, workerUses, history, instructions } = config;

  const supervisorWorker = generator({
    name: "supervisor-worker",
    model: modelId,
    inputSchema: z.object({
      taskId: z.string(),
      goal: z.string(),
      context: z.string().optional(),
      input: z.unknown().optional(),
      deps: z.record(z.unknown()).optional(),
      attempts: z.number().int().nonnegative().default(0),
      feedback: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
    outputSchema: z.string(),
    context: workerContext,
    ...(workerUses ? { uses: workerUses as any } : {}),
    search: true,
    itemVisibility: { client: true, history: false },
    prompt: supervisorWorkerPrompt.prompt,
    user: (input) => {
      const parts = [`Task: ${input.goal}`];
      // FIX-827: prefer the first-class `context` field; fall back to the
      // legacy `input`-as-context hack transitionally.
      const context =
        input.context ?? (typeof input.input === "string" ? input.input : undefined);
      if (typeof context === "string") parts.push(`\nContext: ${context}`);
      if (input.deps !== undefined && Object.keys(input.deps).length > 0) {
        const sections = Object.entries(input.deps).map(([depId, value]) => {
          if (typeof value === "string") return `From ${depId}:\n${value}`;
          if (value === null || typeof value !== "object") {
            return `From ${depId}: ${JSON.stringify(value)}`;
          }
          const obj = value as Record<string, unknown>;
          const summary =
            "summary" in obj && typeof obj.summary === "string"
              ? obj.summary
              : JSON.stringify(value);
          const sources = Array.isArray(obj.sources)
            ? (obj.sources as Array<{ title?: string; url: string }>).filter(
                (s) => typeof s?.url === "string" && s.url.length > 0,
              )
            : [];
          const sourceLines = sources
            .map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.url}`)
            .join("\n");
          const sourcesPart =
            sourceLines.length > 0
              ? `\nSources used in this task:\n${sourceLines}`
              : "";
          return `From ${depId}:\n${summary}${sourcesPart}`;
        });
        parts.push(
          `\nContext from prior tasks:\n${sections.join("\n\n---\n\n")}`,
        );
      }
      if (input.feedback) parts.push(`\nPrevious feedback: ${input.feedback}`);
      return parts.join("\n");
    },
  });

  return supervisor({
    name: "supervisor-thinking",
    worker: supervisorWorker,
    instructions,
    maxConcurrency: 3,
    onSubTaskError: "skip",
    outputSchema: z.string(),
    context,
    history,
    uses,
  });
}
