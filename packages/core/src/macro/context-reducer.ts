import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
import { generator } from "../blocks";

export const contextReducerDistillOutputSchema = z.object({
  distilled: z.string(),
  keyPoints: z.array(z.string())
});

export const contextReducerDenoiseOutputSchema = z.object({
  cleaned: z.string(),
  removedCategories: z.array(z.string()).optional()
});

export const contextReducerCompressOutputSchema = z.object({
  compressed: z.string(),
  compressionRatio: z.number().optional(),
  dropped: z.array(z.string()).optional()
});

const CONTEXT_REDUCER_INSTRUCTIONS = {
  distill: [
    "You are a context distillation assistant.",
    "Extract the highest-signal ideas from the source material.",
    "Prioritize meaning, decisions, constraints, and implications over wording fidelity.",
    "Group similar points and eliminate redundancy while preserving critical nuance."
  ],
  denoise: [
    "You are a context denoising assistant.",
    "Remove irrelevant, repetitive, or low-value content from the source.",
    "Preserve original intent, ordering, and structure wherever possible.",
    "Keep details that materially change interpretation or execution."
  ],
  compress: [
    "You are a context compression assistant.",
    "Reduce the source to fit strict token or length budgets.",
    "Retain required facts, identifiers, constraints, and action-critical details.",
    "Use controlled lossiness and explicitly signal what was dropped when relevant."
  ]
} as const;

export type ContextReducerMode = keyof typeof CONTEXT_REDUCER_INSTRUCTIONS;

export interface ContextReducerConfig<
  TOutputSchema extends ZodTypeAny = typeof contextReducerDistillOutputSchema
> {
  name: string;
  mode?: ContextReducerMode;
  model?: GeneratorConfig["model"];
  outputSchema?: TOutputSchema;
}

function toUserContent(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify(input, null, 2);
}

function getDefaultOutputSchema(mode: ContextReducerMode): ZodTypeAny {
  if (mode === "distill") {
    return contextReducerDistillOutputSchema;
  }

  if (mode === "denoise") {
    return contextReducerDenoiseOutputSchema;
  }

  return contextReducerCompressOutputSchema;
}

/**
 * Factory that returns a generator block for context reduction across distill, denoise, and compress strategies.
 */
export function contextReducer<
  TOutputSchema extends ZodTypeAny = typeof contextReducerDistillOutputSchema
>(config: ContextReducerConfig<TOutputSchema>) {
  const mode = config.mode ?? "distill";
  const outputSchema = config.outputSchema ?? getDefaultOutputSchema(mode);

  return generator({
    name: config.name,
    model: config.model ?? "preset/fast",
    outputSchema,
    prompt: [
      ...CONTEXT_REDUCER_INSTRUCTIONS[mode],
      "Return output that exactly matches the required schema."
    ].join("\n"),
    user: (input) => toUserContent(input)
  });
}
