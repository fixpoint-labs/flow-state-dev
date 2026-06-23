/**
 * Supervisor pipeline — plan → dispatch workers → review → replan loop.
 *
 * Uses a dedicated worker generator whose prompt lives entirely in
 * `supervisor-worker.prompt.md`: the `<system>` role plus a `<user>` template
 * that lays out the task goal, prior-task deps, and feedback. The deps shape
 * handling stays typed in TS via the `normalizeDeps` filter (see
 * `shared/prompt-filters.ts`); the template owns the layout. Workers emit
 * silently (history: false) so per-task messages don't pollute the stream.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
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
    // <system> + <user> both come from the prompt file. The <user> template
    // formats goal / context / prior-task deps / feedback (FIX-827: prefers the
    // first-class `context` field, falling back to the legacy `input`-as-context
    // hack) — see supervisor-worker.prompt.md.
    ...definePromptFile(supervisorWorkerPrompt),
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
