/**
 * Generators for the rich-text-component flow.
 *
 * Seven structurally identical generator blocks — schema + prompt → streamed
 * text. Co-located in one file because the parallelism is the point: the
 * framework's primitives collapse cleanly to "input → one generator → output"
 * without the agentic scaffolding that powers chat-agent.
 *
 * Streaming requires `agentType: "primary"` together with a string
 * `outputSchema`; the runtime gate at packages/core/src/blocks/generator.ts
 * checks both before flipping a generator into streamed-text mode.
 */
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

import {
  copyeditInputSchema,
  improveInputSchema,
  changeToneInputSchema,
  translateInputSchema,
  summarizeInputSchema,
  expandInputSchema,
  fixCodeInputSchema,
  personalizeInputSchema,
} from "./schemas";
import {
  COPYEDIT_PROMPT,
  IMPROVE_PROMPT,
  CHANGE_TONE_PROMPT,
  TRANSLATE_PROMPT,
  EXPAND_PROMPT,
  PERSONALIZE_PROMPT,
  summarizePrompt,
  fixCodePrompt,
} from "./prompts";
import { mem, MODEL_ID } from "./memory";

/** Fix grammar, spelling, and punctuation. Does not rephrase. */
export const copyeditGenerator = generator({
  name: "copyedit-generator",
  model: MODEL_ID,
  agentType: "primary",
  inputSchema: copyeditInputSchema,
  prompt: COPYEDIT_PROMPT,
  user: (input) => input.text,
  outputSchema: z.string(),
});

/** Improve clarity, flow, and word choice while preserving meaning and voice. */
export const improveGenerator = generator({
  name: "improve-generator",
  model: MODEL_ID,
  agentType: "primary",
  inputSchema: improveInputSchema,
  prompt: IMPROVE_PROMPT,
  user: (input) => input.text,
  outputSchema: z.string(),
});

/** Rewrite the text in the user-supplied tone. */
export const changeToneGenerator = generator({
  name: "change-tone-generator",
  model: MODEL_ID,
  agentType: "primary",
  inputSchema: changeToneInputSchema,
  prompt: CHANGE_TONE_PROMPT,
  user: (input) => `Target tone: ${input.tone}\n\n---\n\n${input.text}`,
  outputSchema: z.string(),
});

/** Translate into the user-supplied target language. */
export const translateGenerator = generator({
  name: "translate-generator",
  model: MODEL_ID,
  agentType: "primary",
  inputSchema: translateInputSchema,
  prompt: TRANSLATE_PROMPT,
  user: (input) => `Target language: ${input.language}\n\n---\n\n${input.text}`,
  outputSchema: z.string(),
});

/**
 * Summarize at the requested length. `length` is always concrete here because
 * the schema applies a Zod `.default("medium")` before the generator runs.
 */
export const summarizeGenerator = generator({
  name: "summarize-generator",
  model: MODEL_ID,
  agentType: "primary",
  inputSchema: summarizeInputSchema,
  prompt: (input) => summarizePrompt(input.length),
  user: (input) => input.text,
  outputSchema: z.string(),
});

/** Elaborate on the text, optionally guided by free-text context. */
export const expandGenerator = generator({
  name: "expand-generator",
  model: MODEL_ID,
  agentType: "primary",
  inputSchema: expandInputSchema,
  prompt: EXPAND_PROMPT,
  user: (input) =>
    input.context
      ? `Additional context:\n${input.context}\n\n---\n\n${input.text}`
      : input.text,
  outputSchema: z.string(),
});

/** Fix code; the optional language hint is folded into the system prompt. */
export const fixCodeGenerator = generator({
  name: "fix-code-generator",
  model: MODEL_ID,
  agentType: "primary",
  inputSchema: fixCodeInputSchema,
  prompt: (input) => fixCodePrompt(input.language),
  user: (input) => input.text,
  outputSchema: z.string(),
});

/**
 * Personalize the text using user-scoped memories captured by chat-agent.
 *
 * `mem` (the memory capability) auto-installs the working/episodic/semantic
 * memory resources and (via its default `context` preset) injects unified
 * recall output under a `<memory>` tag in the system context. The prompt
 * instructs the model to weave those facts in only where they naturally fit.
 *
 * Memories are user-scoped with no flow-isolation, so this reads the same
 * episodic + semantic store that chat-agent writes via `mem.captureFromItems`.
 */
export const personalizeGenerator = generator({
  name: "personalize-generator",
  model: MODEL_ID,
  agentType: "primary",
  uses: [mem],
  inputSchema: personalizeInputSchema,
  prompt: PERSONALIZE_PROMPT,
  user: (input) => input.text,
  outputSchema: z.string(),
});
