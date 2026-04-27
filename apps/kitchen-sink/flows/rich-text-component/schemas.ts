/**
 * Input schemas for the rich-text-component flow's seven actions.
 *
 * Every action takes `text` (required, non-empty). Multi-field actions extend
 * the base. `summarize.length` defaults to "medium" via Zod so the prompt
 * function can treat it as a total mapping.
 */
import { z } from "zod";

const textBase = z.object({ text: z.string().min(1) });

/** Single-shot copyedit: fix grammar/spelling/punctuation only. */
export const copyeditInputSchema = textBase;

/** Single-shot improve: clarity / flow / impact while preserving intent. */
export const improveInputSchema = textBase;

/** Single-shot tone change: rewrite in the user-supplied tone (free-text). */
export const changeToneInputSchema = textBase.extend({
  tone: z.string().min(1),
});

/** Single-shot translate: target language is free-text (e.g. "Spanish"). */
export const translateInputSchema = textBase.extend({
  language: z.string().min(1),
});

/** Single-shot summarize: optional length defaults to "medium". */
export const summarizeInputSchema = textBase.extend({
  length: z.enum(["short", "medium", "long"]).optional().default("medium"),
});

/** Single-shot expand: optional free-text context to guide elaboration. */
export const expandInputSchema = textBase.extend({
  context: z.string().optional(),
});

/** Single-shot fixCode: optional language hint for the model. */
export const fixCodeInputSchema = textBase.extend({
  language: z.string().optional(),
});

/** Single-shot personalize: rewrite the text using user-scoped memories. */
export const personalizeInputSchema = textBase;
