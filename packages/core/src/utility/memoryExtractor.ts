import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
import type { AgentType } from "../items/types";
import { generator } from "../blocks";

export const memoryExtractorTypeSchema = z.enum([
  "fact",
  "preference",
  "constraint",
  "decision"
]);

export const memoryCandidateSchema = z.object({
  type: memoryExtractorTypeSchema,
  content: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.string().optional()
});

export const memoryExtractorOutputSchema = z.object({
  memories: z.array(memoryCandidateSchema)
});

export interface MemoryExtractorConfig<
  TOutputSchema extends ZodTypeAny = typeof memoryExtractorOutputSchema
> {
  name: string;
  model?: GeneratorConfig["model"];
  outputSchema?: TOutputSchema;
  /**
   * Identity for emitted items. Unset by default — extractor output is a
   * background step that flows via graph edges to a memory-write handler.
   * Set to `"trace"` for observability-only runs, or `"primary"` if the
   * extraction itself should be visible to the user.
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
 * Factory that returns a generator block for extracting durable memory candidates.
 */
export function memoryExtractor<
  TOutputSchema extends ZodTypeAny = typeof memoryExtractorOutputSchema
>(config: MemoryExtractorConfig<TOutputSchema>) {
  const outputSchema = config.outputSchema ?? memoryExtractorOutputSchema;

  return generator({
    name: config.name,
    model: config.model ?? "preset/fast",
    outputSchema,
    agentType: config.agentType,
    prompt: [
      "You extract durable memory candidates from user and assistant interactions.",
      "Extract only information worth persisting beyond the current request.",
      "Use memory types exactly as defined: fact, preference, constraint, decision.",
      "Prefer high-signal, stable statements over transient details.",
      "Do not invent details. If no durable memory is present, return an empty memories array.",
      "This extraction is stateless: do not perform writes or describe persistence behavior.",
      "Return output that exactly matches the required schema."
    ].join("\n"),
    user: (input) => toUserContent(input)
  });
}
