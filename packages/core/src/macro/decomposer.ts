import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
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
    model: config.model ?? "intent/plan",
    outputSchema,
    prompt: [
      "You are a task decomposition assistant.",
      "Break broad requests into executable tasks.",
      "Each task must include a stable unique id and a clear goal.",
      "Use deps only when a task depends on one or more prior task ids.",
      "Set priority when useful using high, medium, or low.",
      "Order tasks so dependencies can be executed correctly.",
      "Return output that exactly matches the required schema."
    ].join("\n"),
    user: (input) => toUserContent(input)
  });
}
