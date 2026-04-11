import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
import { generator } from "../blocks";

export const summarizerOutputSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()).optional()
});

const GRANULARITY_INSTRUCTIONS = {
  brief: "Write a concise 1-2 sentence summary that captures only the core takeaway.",
  detailed: "Write a detailed paragraph-level summary that preserves important context and nuance.",
  executive: "Write an executive summary focused on key decisions and actionable recommendations."
} as const;

export type SummarizerGranularity = keyof typeof GRANULARITY_INSTRUCTIONS;

export interface SummarizerConfig<
  TOutputSchema extends ZodTypeAny = typeof summarizerOutputSchema
> {
  name: string;
  model?: GeneratorConfig["model"];
  granularity?: SummarizerGranularity;
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
 * Factory that returns a generator block for concise input summarization.
 */
export function summarizer<
  TOutputSchema extends ZodTypeAny = typeof summarizerOutputSchema
>(config: SummarizerConfig<TOutputSchema>) {
  const granularity = config.granularity ?? "brief";
  const outputSchema = config.outputSchema ?? summarizerOutputSchema;
  const instruction = GRANULARITY_INSTRUCTIONS[granularity];
  const objectives =
    config.objectives === undefined
      ? undefined
      : Array.isArray(config.objectives)
        ? config.objectives
        : [config.objectives];

  return generator({
    name: config.name,
    model: config.model ?? "preset/fast",
    outputSchema,
    prompt: [
      "You are a summarization assistant.",
      instruction,
      objectives === undefined
        ? undefined
        : `Focus the summary on these objectives:\n${objectives
            .map((objective, index) => `${index + 1}. ${objective}`)
            .join("\n")}`,
      "Return output that exactly matches the required schema."
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    user: (input) => toUserContent(input)
  });
}
