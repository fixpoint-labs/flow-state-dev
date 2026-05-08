import { z, type ZodTypeAny } from "zod";
import type { GeneratorConfig } from "../blocks";
import type { AgentType } from "../items/types";
import { generator } from "../blocks";

export type IntentCategories = Record<string, string>;

export interface IntentClassifierOutput {
  category: string;
  confidence: number;
  reasoning: string;
}

export interface IntentClassifierConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  name: string;
  categories: IntentCategories;
  model?: GeneratorConfig["model"];
  outputSchema?: TOutputSchema;
  /**
   * Identity for emitted items. Unset by default — classification output
   * flows via graph edges only, which is the usual routing case. Set to
   * `"primary"` if you want the classification surfaced to the user, or
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

function createDefaultOutputSchema(categories: readonly string[]) {
  return z.object({
    category: z.string(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().default("")
  }).superRefine((value, ctx) => {
    if (!categories.includes(value.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Category must be one of: ${categories.join(", ")}`,
        path: ["category"]
      });
    }
  });
}

function withCategoryValidation<TOutputSchema extends ZodTypeAny>(
  outputSchema: TOutputSchema,
  categories: readonly string[]
) {
  return outputSchema.superRefine((value, ctx) => {
    if (typeof value !== "object" || value === null || !("category" in value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Output must include a category field",
        path: ["category"]
      });
      return;
    }

    const category = (value as { category?: unknown }).category;
    if (typeof category !== "string" || !categories.includes(category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Category must be one of: ${categories.join(", ")}`,
        path: ["category"]
      });
    }
  });
}

/**
 * Factory that returns a generator block for classifying input into a bounded category set.
 */
export function intentClassifier<
  TOutputSchema extends ZodTypeAny = ReturnType<typeof createDefaultOutputSchema>
>(config: IntentClassifierConfig<TOutputSchema>) {
  const categories = Object.entries(config.categories);

  if (categories.length < 2) {
    throw new Error('intentClassifier requires at least 2 categories in the "categories" map');
  }

  const categoryNames = categories.map(([name]) => name);
  const outputSchema = config.outputSchema === undefined
    ? createDefaultOutputSchema(categoryNames)
    : withCategoryValidation(config.outputSchema, categoryNames);

  return generator({
    name: config.name,
    model: config.model ?? "intent/utility",
    outputSchema,
    agentType: config.agentType,
    prompt: [
      "You are an intent classification assistant.",
      "Classify the user input into exactly one category from the provided list.",
      "Category options:",
      ...categories.map(([label, description]) => `- ${label}: ${description}`),
      "Return output that exactly matches the required schema. Confidence must be between 0 and 1."
    ].join("\n"),
    user: (input) => toUserContent(input)
  });
}
