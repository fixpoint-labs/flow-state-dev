/**
 * generateFlow — Single-shot generation.
 *
 * The simplest possible flow: takes an input, runs a single LLM call, returns
 * the output. No history, no tools, no session state. Use for summarization,
 * extraction, transformation, and other stateless generation tasks.
 *
 * @example
 * ```ts
 * import { generateFlow } from "@flow-state-dev/flows";
 *
 * // Text summarizer
 * const flow = generateFlow({
 *   prompt: "Summarize the following text concisely.",
 * })({ id: "summarizer" });
 *
 * // Structured extraction
 * const flow = generateFlow({
 *   prompt: "Extract entities from the text.",
 *   outputSchema: z.object({
 *     people: z.array(z.string()),
 *     places: z.array(z.string()),
 *   }),
 * })({ id: "entity-extractor" });
 * ```
 */
import type { ZodTypeAny } from "zod";
import {
  defineFlow,
  generator,
} from "@flow-state-dev/core";
import type { FlowType } from "@flow-state-dev/core";

import {
  DEFAULT_MODEL,
  textInputSchema,
} from "./shared";

/** Configuration options for {@link generateFlow}. */
export interface GenerateFlowConfig {
  /** LLM model identifier. Default: `"openai/gpt-4o-mini"`. */
  model?: string;
  /** System prompt for the generator. */
  prompt?: string;
  /** Structured output schema. Default: plain string (text streaming). */
  outputSchema?: ZodTypeAny;
}

/**
 * Creates a single-shot generation flow.
 *
 * Returns a `FlowType` with a single `generate` action accepting
 * `{ input: string }` by default. No conversation history, no tools,
 * no session state.
 */
export function generateFlow(config: GenerateFlowConfig = {}): FlowType {
  const {
    model = DEFAULT_MODEL,
    prompt = "You are a helpful assistant. Process the user's input and respond.",
    outputSchema,
  } = config;

  const gen = generator({
    name: "generate",
    model,
    prompt,
    inputSchema: textInputSchema,
    user: (input: { input: string }) => input.input,
    outputSchema,
  });

  return defineFlow({
    kind: "generate",
    requireUser: true,
    actions: {
      generate: {
        inputSchema: textInputSchema,
        block: gen,
        userMessage: (input: { input: string }) => input.input,
      },
    },
  });
}
