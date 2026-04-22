import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
import type { AgentType } from "../items/types";
import { generator } from "../blocks";

export const analyzerFindingSchema = z.object({
  criterion: z.string(),
  assessment: z.string(),
  severity: z.enum(["critical", "warning", "info"]).optional(),
  evidence: z.string().optional()
});

export const analyzerOutputSchema = z.object({
  findings: z.array(analyzerFindingSchema),
  score: z.number().optional(),
  recommendation: z.string().optional()
});

const DEFAULT_CRITERIA = ["quality", "risk", "coverage", "confidence"] as const;

export interface AnalyzerConfig<
  TOutputSchema extends ZodTypeAny = typeof analyzerOutputSchema
> {
  name: string;
  model?: GeneratorConfig["model"];
  criteria?: string[];
  outputSchema?: TOutputSchema;
  /**
   * Identity for emitted items. Unset by default — analysis output flows via
   * graph edges only. Set to `"primary"` to surface findings to the user, or
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
 * Factory that returns a generator block for artifact analysis and critique.
 */
export function analyzer<
  TOutputSchema extends ZodTypeAny = typeof analyzerOutputSchema
>(config: AnalyzerConfig<TOutputSchema>) {
  const criteria = config.criteria ?? [...DEFAULT_CRITERIA];
  const outputSchema = config.outputSchema ?? analyzerOutputSchema;

  return generator({
    name: config.name,
    model: config.model ?? "preset/fast",
    outputSchema,
    agentType: config.agentType,
    prompt: [
      "You are an analysis assistant.",
      "Evaluate the provided artifact against each criterion and return structured findings.",
      "For each finding, include criterion, assessment, severity (critical|warning|info when relevant), and concise evidence when available.",
      "Criteria to evaluate:",
      ...criteria.map((criterion, index) => `${index + 1}. ${criterion}`),
      "If useful, include an overall score and recommendation.",
      "Return output that exactly matches the required schema."
    ].join("\n"),
    user: (input) => toUserContent(input)
  });
}
