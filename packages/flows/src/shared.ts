/**
 * Shared schemas, defaults, and types used across default flow factories.
 */
import { z } from "zod";

/** Default model used when no model is specified. Cheap, fast, good for demos. */
export const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** Standard chat input schema: a single user message string. */
export const chatInputSchema = z.object({
  message: z.string().min(1),
});

/** Input for setPreferredModel action. */
export const setPreferredModelInputSchema = z.object({
  preferredModel: z.string().min(1),
});

/** Component flow input: content to transform with optional extra instruction. */
export const componentInputSchema = z.object({
  content: z.string().min(1),
  instruction: z.string().optional(),
});

/** Session state for flows that track message counts. */
export const messageCountStateSchema = z.object({
  messageCount: z.number().default(0),
});

/** User state for flows that support model preference. */
export const preferredModelUserStateSchema = z.object({
  preferredModel: z.string().optional(),
});
