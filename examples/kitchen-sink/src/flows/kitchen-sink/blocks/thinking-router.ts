/**
 * Thinking Style Auto-Router (FIX-311)
 *
 * Two-tier router that selects the best thinking style for a message:
 *   1. Keyword handler — fast heuristic scan, no LLM call
 *   2. LLM classifier — intentRouter fallback when keywords are ambiguous
 *
 * Both tiers and the composed router are exported for remixability.
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

const routerStateSchema = z.object({
  selectedStyle: thinkingStyleSchema.nullable().default(null),
});

export const thinkingStyleSessionStateSchema = z.object({
  thinkingStyle: thinkingStyleSchema.optional(),
});

// -------------------------------------------------------------------------
// Keyword lists — named constants for extensibility
// -------------------------------------------------------------------------

const SUPERVISOR_KEYWORDS = [
  "coordinate",
  "delegate",
  "assign",
  "orchestrate",
  "multiple agents",
  "sub-agent",
  "team of",
];

const PLAN_KEYWORDS = [
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

const COT_KEYWORDS = [
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
  sequencerStateSchema: routerStateSchema,
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
// Built as a standalone block so it can be imported independently.
// The thinkingRouter uses thenIf to skip it when Tier 1 already matched.
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
// Resolve style — runs Tier 2 if needed, then writes to session state
//
// When Tier 1 matched, selectedStyle is non-null and gets written to
// session state directly. When Tier 1 didn't match (selectedStyle is null),
// the LLM classifier runs and writes session state via its own handlers.
// -------------------------------------------------------------------------

const resolveStyle = handler({
  name: "resolve-thinking-style",
  inputSchema: messageSchema,
  outputSchema: messageSchema,
  sequencerStateSchema: routerStateSchema,
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    const selected = ctx.sequencer!.state.selectedStyle;
    if (selected !== null) {
      // Tier 1 matched — write the keyword result to session state.
      await ctx.session.patchState({ thinkingStyle: selected });
    } else {
      // Tier 2 — run LLM classifier (writes session state internally).
      await classifierBlock.run(input.message, ctx);
    }
    return input;
  },
});

// -------------------------------------------------------------------------
// Top-level thinking router
// -------------------------------------------------------------------------

export const thinkingRouter = sequencer({
  name: "thinking-router",
  inputSchema: messageSchema,
  stateSchema: routerStateSchema,
})
  .then(keywordHandler)
  .then(resolveStyle);
