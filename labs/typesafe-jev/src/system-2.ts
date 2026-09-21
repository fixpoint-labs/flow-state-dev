/**
 * System 2 fallback: same question intent via structured generation.
 *
 * Used when the configured model is not evaluation-capable. Apps must
 * work without Jev. Confidence on choice/score is synthetic (1) — a
 * language model does not return TypeSafe's calibrated confidence.
 */

import { z } from "zod";
import { TypeSafeError } from "./errors";
import {
  DEFAULT_SYSTEM2_MODEL,
  type TypeSafeAnswer,
  type TypeSafeAnswers,
  type TypeSafeEvaluateOutput,
  type TypeSafeQuestion,
  type TypeSafeQuestions,
  type TypeSafeState,
} from "./schemas";

export interface StructuredAnswers {
  [id: string]:
    | { type: "boolean"; probability: number }
    | { type: "choice"; choice: string }
    | { type: "score"; score: number };
}

export type GenerateStructuredFn = (args: {
  model: string;
  schema: z.ZodType<StructuredAnswers>;
  prompt: string;
}) => Promise<StructuredAnswers>;

export interface System2EvaluateOptions {
  state: TypeSafeState;
  questions: TypeSafeQuestions;
  model?: string;
  generate?: GenerateStructuredFn;
}

/**
 * Answer the same questions through structured output.
 */
export async function system2Evaluate(
  options: System2EvaluateOptions,
): Promise<TypeSafeEvaluateOutput> {
  const model = options.model ?? DEFAULT_SYSTEM2_MODEL;
  const generate = options.generate ?? loadGenerateObject;
  const prompt = formatSystem2Prompt(options.state, options.questions);
  const schema = structuredAnswersSchema(options.questions);
  let raw: StructuredAnswers;
  try {
    raw = await generate({ model, schema, prompt });
  } catch (error) {
    if (error instanceof TypeSafeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeSafeError("http", `System 2 generateObject failed: ${message.slice(0, 500)}`);
  }
  return {
    model,
    answers: structuredToAnswers(options.questions, raw),
    path: "system-2",
    provider: "system-2",
  };
}

/** Zod schema a language model fills with one answer per question. */
export function structuredAnswersSchema(questions: TypeSafeQuestions): z.ZodType<StructuredAnswers> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [id, question] of Object.entries(questions)) {
    shape[id] = structuredAnswerSchema(question);
  }
  return z.object(shape);
}

function structuredAnswerSchema(question: TypeSafeQuestion): z.ZodTypeAny {
  if (question.type === "boolean" || question.type === "noul") {
    return z.object({
      type: z.literal("boolean"),
      probability: z.number().min(0).max(1),
    });
  }
  if (question.type === "choice") {
    const keys = Object.keys(question.criteria);
    const choiceSchema =
      keys.length > 0
        ? z.enum(keys as [string, ...string[]])
        : z.string();
    return z.object({
      type: z.literal("choice"),
      choice: choiceSchema,
    });
  }
  return z.object({
    type: z.literal("score"),
    score: z.number(),
  });
}

/** Map structured output onto the lab answer shapes. */
export function structuredToAnswers(
  questions: TypeSafeQuestions,
  raw: StructuredAnswers,
): TypeSafeAnswers {
  const answers: TypeSafeAnswers = {};
  for (const [id, question] of Object.entries(questions)) {
    const value = raw[id];
    if (value === undefined) continue;
    answers[id] = structuredToAnswer(question, value);
  }
  return answers;
}

function structuredToAnswer(
  question: TypeSafeQuestion,
  value: StructuredAnswers[string],
): TypeSafeAnswer {
  if (value.type === "boolean") {
    if (question.type === "noul") {
      return { type: "noul", noul: value.probability };
    }
    return { type: "boolean", probability: value.probability };
  }
  if (value.type === "choice") {
    return {
      type: "choice",
      choice: value.choice,
      probabilities: { [value.choice]: 1 },
      confidence: 1,
    };
  }
  const legend: Record<string, string> =
    question.type === "score"
      ? Object.fromEntries(question.criteria.map((label, index) => [String(index), label]))
      : {};
  return {
    type: "score",
    score: value.score,
    legend,
    probabilities: {},
    confidence: 1,
  };
}

/** Prompt that restates the evaluate contract for a language model. */
export function formatSystem2Prompt(state: TypeSafeState, questions: TypeSafeQuestions): string {
  const lines = [
    "Answer each question about the state. Return only the structured answers.",
    "",
    "State:",
    typeof state === "string" ? state : JSON.stringify(state),
    "",
    "Questions:",
  ];
  for (const [id, question] of Object.entries(questions)) {
    lines.push(`- ${id} (${question.type}): ${question.instructions}`);
    if (question.type === "choice") {
      for (const [key, description] of Object.entries(question.criteria)) {
        lines.push(`    ${key}: ${description ?? ""}`);
      }
    } else if (question.type === "score") {
      lines.push(`    levels: ${question.criteria.join(" | ")}`);
    } else if (question.criteria) {
      if (question.criteria.true) lines.push(`    true: ${question.criteria.true}`);
      if (question.criteria.false) lines.push(`    false: ${question.criteria.false}`);
    }
  }
  return lines.join("\n");
}

async function loadGenerateObject(
  args: Parameters<GenerateStructuredFn>[0],
): Promise<StructuredAnswers> {
  const ai = await import("ai");
  const generateObject = (
    ai as {
      generateObject?: (opts: {
        model: string;
        schema: z.ZodType<StructuredAnswers>;
        prompt: string;
      }) => Promise<{ object: StructuredAnswers }>;
    }
  ).generateObject;
  if (generateObject === undefined) {
    throw new TypeSafeError("http", "ai.generateObject is not available for the System 2 fallback.");
  }
  const result = await generateObject({
    model: args.model,
    schema: args.schema,
    prompt: args.prompt,
  });
  return result.object;
}
