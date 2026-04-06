/**
 * Thinking Style Auto-Detector (FIX-311)
 *
 * Two-tier detection that resolves "auto" thinking style to a concrete style:
 *   1. Keyword handler — fast heuristic scan, no LLM call
 *   2. LLM classifier — intentRouter fallback when keywords are ambiguous
 *
 * After detection, writes the resolved style to session.state.thinkingStyle.
 * Both tiers are exported individually for remixability.
 */
import {
  handler,
  sequencer,
  utility,
} from "@flow-state-dev/core";
import { z } from "zod";

// -------------------------------------------------------------------------
// Schemas
// -------------------------------------------------------------------------

export const thinkingStyleSchema = z.enum([
  "plan-and-execute",
  "supervisor",
  "chain-of-thought",
]);

export type ThinkingStyle = z.infer<typeof thinkingStyleSchema>;

export const thinkingStyleSessionStateSchema = z.object({
  thinkingStyle: thinkingStyleSchema.optional(),
});

const detectorStateSchema = z.object({
  selectedStyle: thinkingStyleSchema.nullable().default(null),
});

// -------------------------------------------------------------------------
// Keyword lists — named constants for extensibility
// -------------------------------------------------------------------------

export const SUPERVISOR_KEYWORDS = [
  "coordinate",
  "delegate",
  "assign",
  "orchestrate",
  "multiple agents",
  "sub-agent",
  "team of",
];

export const PLAN_KEYWORDS = [
  "plan",
  "steps",
  "step by step",
  "break down",
  "decompose",
  "tasks",
  "outline",
  "roadmap",
  "phase",
];

export const COT_KEYWORDS = [
  "think through",
  "reason",
  "why",
  "explain",
  "analyze",
  "consider",
  "evaluate",
  "pros and cons",
];

// -------------------------------------------------------------------------
// Tier 1 — Keyword Handler
// -------------------------------------------------------------------------

const messageSchema = z.object({ message: z.string() });

export const keywordHandler = handler({
  name: "keyword-style-handler",
  inputSchema: messageSchema,
  outputSchema: messageSchema,
  sequencerStateSchema: detectorStateSchema,
  execute: async (input, ctx) => {
    const message = input.message.toLowerCase();

    if (SUPERVISOR_KEYWORDS.some((kw) => message.includes(kw))) {
      await ctx.sequencer!.patchState({ selectedStyle: "supervisor" });
      return input;
    }
    if (PLAN_KEYWORDS.some((kw) => message.includes(kw))) {
      await ctx.sequencer!.patchState({ selectedStyle: "plan-and-execute" });
      return input;
    }
    if (COT_KEYWORDS.some((kw) => message.includes(kw))) {
      await ctx.sequencer!.patchState({ selectedStyle: "chain-of-thought" });
      return input;
    }

    // No match — leave selectedStyle null for Tier 2.
    return input;
  },
});

// -------------------------------------------------------------------------
// Tier 2 — LLM Classifier (intentRouter)
//
// Exported as a standalone block for remixability.
// -------------------------------------------------------------------------

export const classifierBlock = utility.intentRouter({
  name: "thinking-style-classifier",
  categories: {
    "plan-and-execute": {
      description: `
        The message asks the AI to complete a structured, multi-step task where
        decomposing the work into discrete subtasks before executing would produce
        a better result. Examples: writing a report, implementing a feature,
        generating a comprehensive document, producing complex structured output.
      `,
      handler: handler({
        name: "select-pae",
        sessionStateSchema: thinkingStyleSessionStateSchema,
        execute: async (_input, ctx) => {
          await ctx.session.patchState({ thinkingStyle: "plan-and-execute" });
        },
      }),
    },
    supervisor: {
      description: `
        The message describes a task that naturally requires coordinating multiple
        specialized concerns in parallel or sequentially, where different aspects
        of the work benefit from independent sub-agent treatment. Examples:
        research + synthesis pipelines, code review across multiple dimensions,
        cross-domain analysis tasks.
      `,
      handler: handler({
        name: "select-supervisor",
        sessionStateSchema: thinkingStyleSessionStateSchema,
        execute: async (_input, ctx) => {
          await ctx.session.patchState({ thinkingStyle: "supervisor" });
        },
      }),
    },
    "chain-of-thought": {
      description: `
        The message is a direct question, a reasoning task, an explanation request,
        or anything where a single high-quality response with visible reasoning
        is more appropriate than task decomposition. Examples: answering questions,
        comparing options, explaining concepts, debugging, short creative tasks.
      `,
      handler: handler({
        name: "select-cot",
        sessionStateSchema: thinkingStyleSessionStateSchema,
        execute: async (_input, ctx) => {
          await ctx.session.patchState({ thinkingStyle: "chain-of-thought" });
        },
      }),
    },
  },
  fallback: handler({
    name: "select-cot-fallback",
    sessionStateSchema: thinkingStyleSessionStateSchema,
    execute: async (_input, ctx) => {
      await ctx.session.patchState({ thinkingStyle: "chain-of-thought" });
    },
  }),
  confidenceThreshold: 0.65,
});

// -------------------------------------------------------------------------
// Resolve — runs Tier 1, then Tier 2 if needed, writes to session state.
// -------------------------------------------------------------------------

const resolveStyle = handler({
  name: "resolve-thinking-style",
  inputSchema: messageSchema,
  outputSchema: messageSchema,
  sequencerStateSchema: detectorStateSchema,
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    const selected = ctx.sequencer!.state.selectedStyle;
    if (selected !== null) {
      await ctx.session.patchState({ thinkingStyle: selected });
    } else {
      // Tier 2 — LLM classifier writes session state via its own handlers.
      await classifierBlock.run(input.message, ctx);
    }
    return input;
  },
});

// -------------------------------------------------------------------------
// Composed auto-detector sequencer
// -------------------------------------------------------------------------

/**
 * Runs Tier 1 (keyword) then Tier 2 (LLM) if needed.
 * After this block completes, session.state.thinkingStyle is set.
 *
 * Input: `{ message: string }`
 * Output: `{ message: string }` (passthrough)
 */
export const thinkingStyleDetector = sequencer({
  name: "thinking-style-detector",
  inputSchema: messageSchema,
  stateSchema: detectorStateSchema,
})
  .then(keywordHandler)
  .then(resolveStyle);
