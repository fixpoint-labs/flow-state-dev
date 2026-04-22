import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig, GeneratorHistoryConfig, GeneratorSlot } from "../blocks";
import type { AgentType } from "../items/types";
import { generator } from "../blocks";

export const decomposerTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  deps: z.array(z.string()).optional(),
  priority: z.enum(["high", "medium", "low"]).optional()
});

export const decomposerOutputSchema = z.object({
  tasks: z.array(decomposerTaskSchema)
});

export interface DecomposerConfig<
  TOutputSchema extends ZodTypeAny = typeof decomposerOutputSchema
> {
  name: string;
  model?: GeneratorConfig["model"];
  outputSchema?: TOutputSchema;
  /** Additional context injected into the system prompt before decomposition. */
  context?: GeneratorSlot;
  /** History slot — provides conversation history so the decomposer can resolve references. */
  history?: GeneratorHistoryConfig;
  /**
   * Identity for emitted items. Unset by default — decomposed task lists flow
   * via graph edges only. Set to `"agent"` to surface the plan to the user,
   * or `"trace"` for observability-only runs.
   */
  agentType?: AgentType;
}

function toUserContent(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify(input, null, 2);
}

/**
 * Factory that returns a generator block for decomposing broad requests into executable tasks.
 */
export function decomposer<
  TOutputSchema extends ZodTypeAny = typeof decomposerOutputSchema
>(config: DecomposerConfig<TOutputSchema>) {
  const outputSchema = config.outputSchema ?? decomposerOutputSchema;

  return generator({
    name: config.name,
    model: config.model ?? "openai/gpt-5.4-mini",
    outputSchema,
    agentType: config.agentType,
    context: config.context,
    history: config.history,
    search: true,
    prompt: [
      "You are a task decomposition assistant.",
      "Break broad requests into executable tasks that an AI agent can complete autonomously.",
      "IMPORTANT: Never create tasks that ask a human for clarification or additional input.",
      "If the request is ambiguous, make reasonable assumptions and decompose based on the most likely intent.",
      "Each task must include a stable unique id and a clear goal.",
      "Use deps only when a task genuinely depends on the output of a prior task.",
      "Set priority when useful using high, medium, or low.",
      "Order tasks so dependencies can be executed correctly.",
      "Return output that exactly matches the required schema."
    ].join("\n"),
    user: (input) => toUserContent(input)
  });
}
