import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
import { generator } from "../blocks";

export const synthesizerOutputSchema = z.object({
  synthesis: z.string(),
  rationale: z.array(z.string())
});

export interface SynthesizerConfig<
  TOutputSchema extends ZodTypeAny = typeof synthesizerOutputSchema
> {
  name: string;
  model?: GeneratorConfig["model"];
  objectives?: string | string[];
  outputSchema?: TOutputSchema;
}

function toUserContent(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify(input, null, 2);
}

/**
 * Factory that returns a generator block for reconciling multiple inputs into one coherent artifact.
 */
export function synthesizer<
  TOutputSchema extends ZodTypeAny = typeof synthesizerOutputSchema
>(config: SynthesizerConfig<TOutputSchema>) {
  const outputSchema = config.outputSchema ?? synthesizerOutputSchema;
  const objectives =
    config.objectives === undefined
      ? undefined
      : Array.isArray(config.objectives)
        ? config.objectives
        : [config.objectives];

  return generator({
    name: config.name,
    model: config.model ?? "intent/synthesize",
    outputSchema,
    prompt: [
      "You are a synthesis assistant.",
      "Combine multiple intermediate artifacts into one coherent, non-redundant final output.",
      "When inputs overlap, deduplicate while preserving the strongest signal.",
      "When inputs conflict, explicitly resolve the disagreement using interpretive reasoning instead of ignoring it.",
      "Ensure the synthesis reads as a unified artifact, not a list of disconnected fragments.",
      objectives === undefined
        ? undefined
        : `Prioritize these synthesis objectives:\n${objectives
            .map((objective, index) => `${index + 1}. ${objective}`)
            .join("\n")}`,
      "Return output that exactly matches the required schema."
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    user: (input) => toUserContent(input)
  });
}
