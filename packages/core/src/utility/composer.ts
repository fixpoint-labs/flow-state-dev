import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
import type { AgentType } from "../items/types";
import { generator } from "../blocks";

export const composerOutputSchema = z.object({
  composed: z.string(),
  structure: z.array(z.string()).optional()
});

export interface ComposerConfig<
  TOutputSchema extends ZodTypeAny = typeof composerOutputSchema
> {
  name: string;
  model?: GeneratorConfig["model"];
  objectives?: string | string[];
  outputSchema?: TOutputSchema;
  /**
   * Identity for emitted items. Unset by default — composed output flows via
   * graph edges only. Set to `"primary"` to surface it to the user, or
   * `"trace"` for observability-only runs.
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
 * Factory that returns a generator block for assembling coherent output from structured parts.
 */
export function composer<
  TOutputSchema extends ZodTypeAny = typeof composerOutputSchema
>(config: ComposerConfig<TOutputSchema>) {
  const outputSchema = config.outputSchema ?? composerOutputSchema;
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
    agentType: config.agentType,
    prompt: [
      "You are a composition assistant.",
      "Assemble a coherent artifact from provided parts.",
      "Preserve required ordering and structural constraints when they are present.",
      "When useful, include a structure array that lists the assembled section order.",
      objectives === undefined
        ? undefined
        : `Focus the composition on these objectives:\n${objectives
            .map((objective, index) => `${index + 1}. ${objective}`)
            .join("\n")}`,
      "Return output that exactly matches the required schema."
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    user: (input) => toUserContent(input)
  });
}
