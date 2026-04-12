/**
 * Shared schemas, defaults, and types used across all default flow factories.
 */
import { z } from "zod";

/** Default model used when no model is specified. Cheap, fast, good for demos. */
export const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** Standard chat input schema: a single user message string. */
export const chatInputSchema = z.object({
  message: z.string().min(1),
});

/** Standard goal-oriented input schema for agent flows. */
export const goalInputSchema = z.object({
  goal: z.string().min(1),
});

/** Standard text input schema for single-shot generation flows. */
export const textInputSchema = z.object({
  input: z.string().min(1),
});

/** Session state for flows that track message/request counts. */
export const messageCountStateSchema = z.object({
  messageCount: z.number().default(0),
});

/** Session state for flows that track task counts. */
export const taskCountStateSchema = z.object({
  taskCount: z.number().default(0),
});
