/**
 * Input schemas for the rich-text-component flow's actions.
 *
 * Every action takes `text` (required, non-empty). Multi-field actions extend
 * the base. `summarize.length` defaults to "medium" via Zod so the prompt
 * function can treat it as a total mapping.
 */
import { z } from "zod";

/** Copyedit, improve, and personalize take only text. The other actions extend this schema. */
export const textInputSchema = z.object({ text: z.string().min(1) });

/** Single-shot tone change: rewrite in the user-supplied tone (free-text). */
export const changeToneInputSchema = textInputSchema.extend({
  tone: z.string().min(1),
});

/** Single-shot translate: target language is free-text (e.g. "Spanish"). */
export const translateInputSchema = textInputSchema.extend({
  language: z.string().min(1),
});

/** Single-shot summarize: optional length defaults to "medium". */
export const summarizeInputSchema = textInputSchema.extend({
  length: z.enum(["short", "medium", "long"]).default("medium"),
});

/** Single-shot expand: optional free-text context to guide elaboration. */
export const expandInputSchema = textInputSchema.extend({
  context: z.string().optional(),
});

/** Single-shot fixCode: optional language hint for the model. */
export const fixCodeInputSchema = textInputSchema.extend({
  language: z.string().optional(),
});
