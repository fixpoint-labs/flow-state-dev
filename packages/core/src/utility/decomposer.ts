import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig, GeneratorHistoryConfig, GeneratorSlot } from "../blocks";
import type { ItemVisibility } from "../items/types";
import { generator } from "../blocks";

export const decomposerTaskSchema = z.object({
  id: z.string(),
  // Concise label, distinct from `goal`. `z.string().nullable()` (not
  // optional) per BP-016: generator outputs must be OpenAI strict-mode
  // compatible, so the key is always present and `null` signals "absent".
  title: z.string().nullable(),
  goal: z.string(),
  // Readable per-task support text the worker needs to act on this task.
  // Nullable for the same BP-016 reason; seeding treats `null` as absent.
  context: z.string().nullable(),
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
   * via graph edges only. Set to `"primary"` to surface the plan to the user,
   * or `"trace"` for observability-only runs.
   */
  itemVisibility?: ItemVisibility;
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
    itemVisibility: config.itemVisibility,
    context: config.context,
    history: config.history,
    search: true,
    prompt: [
      "You are a task decomposition assistant.",
      "Break broad requests into executable tasks that an AI agent can complete autonomously.",
      "IMPORTANT: Never create tasks that ask a human for clarification or additional input.",
      "If the request is ambiguous, make reasonable assumptions and decompose based on the most likely intent.",
      "Each task must include a stable unique id and a clear goal.",
      "Set title to a short label (a few words) for the task; it's shown in the plan list. Use null if a separate label adds nothing over the goal.",
      "Set context to the concrete facts the task needs from the request or conversation — values, names, lists, constraints — copied verbatim where it matters (e.g. the actual items to process, not 'the listed items'). A worker only sees this task, not the original request, so inline what it needs. Use null when the goal is already self-contained.",
      "Use deps only when a task genuinely depends on the output of a prior task.",
      "Set priority when useful using high, medium, or low.",
      "Order tasks so dependencies can be executed correctly.",
      "Return output that exactly matches the required schema."
    ].join("\n"),
    user: (input) => toUserContent(input)
  });
}
