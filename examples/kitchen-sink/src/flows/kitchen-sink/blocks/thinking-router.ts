/**
 * Thinking Style Resolution (FIX-311)
 *
 * Resolves "auto" thinking style to a concrete style via:
 *   1. Keyword handler — fast heuristic scan, patches session state directly if match
 *   2. LLM classifier — intentClassifier fallback when no keyword matched
 *
 * autoClassifyStyle is the exported sequencer. Used by resolveThinkingStyle
 * in flow.ts when input.thinkingStyle === "auto".
 */
import { handler, sequencer, utility } from "@flow-state-dev/core";
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

const autoClassifyStateSchema = z.object({
  keywordMatched: z.boolean().default(false),
});

const classifierOutputSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  reasoning: z.string().optional(),
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
//
// When a keyword matches, patches session.state.thinkingStyle directly
// (if different) and sets sequencer.state.keywordMatched = true.
// When no match, leaves session state unchanged.
// -------------------------------------------------------------------------

const messageSchema = z.object({ message: z.string() });

export const keywordHandler = handler({
  name: "keyword-style-handler",
  inputSchema: messageSchema,
  outputSchema: messageSchema,
  sequencerStateSchema: autoClassifyStateSchema,
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    const message = input.message.toLowerCase();

    let matched: ThinkingStyle | null = null;
    if (SUPERVISOR_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "supervisor";
    } else if (PLAN_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "plan-and-execute";
    } else if (COT_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "chain-of-thought";
    }

    if (matched !== null) {
      await ctx.sequencer!.patchState({ keywordMatched: true });
      if (matched !== ctx.session.state.thinkingStyle) {
        await ctx.session.patchState({ thinkingStyle: matched });
      }
    }

    return input;
  },
});

// -------------------------------------------------------------------------
// Tier 2 — LLM Classifier
//
// classifierBlock: intentClassifier generator — returns { category, confidence }
// applyClassifiedStyle: reads the classifier output, applies threshold, patches state
// -------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.65;

export const classifierBlock = utility.intentClassifier({
  name: "thinking-style-classifier",
  categories: {
    "plan-and-execute": `
      The message asks the AI to complete a structured, multi-step task where
      decomposing the work into discrete subtasks before executing would produce
      a better result. Examples: writing a report, implementing a feature,
      generating a comprehensive document, producing complex structured output.
    `,
    supervisor: `
      The message describes a task that naturally requires coordinating multiple
      specialized concerns in parallel or sequentially, where different aspects
      of the work benefit from independent sub-agent treatment. Examples:
      research + synthesis pipelines, code review across multiple dimensions,
      cross-domain analysis tasks.
    `,
    "chain-of-thought": `
      The message is a direct question, a reasoning task, an explanation request,
      or anything where a single high-quality response with visible reasoning
      is more appropriate than task decomposition. Examples: answering questions,
      comparing options, explaining concepts, debugging, short creative tasks.
    `,
  },
});

const applyClassifiedStyle = handler({
  name: "apply-classified-style",
  inputSchema: classifierOutputSchema,
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    const parsed = thinkingStyleSchema.safeParse(input.category);
    const style: ThinkingStyle =
      input.confidence >= CONFIDENCE_THRESHOLD && parsed.success
        ? parsed.data
        : "chain-of-thought";
    if (style !== ctx.session.state.thinkingStyle) {
      await ctx.session.patchState({ thinkingStyle: style });
    }
  },
});

const llmClassifySequencer = sequencer({
  name: "llm-classify-style",
  inputSchema: messageSchema,
})
  .then(
    classifierBlock.connectInput((input: { message: string }) => input.message),
  )
  .then(applyClassifiedStyle);

// -------------------------------------------------------------------------
// Auto-classify sequencer
//
// Runs Tier 1 (keyword), then Tier 2 (LLM) only if no keyword matched.
// After this block, session.state.thinkingStyle is set.
// Input: { message: string }
// -------------------------------------------------------------------------

export const autoClassifyStyle = sequencer({
  name: "auto-classify-style",
  inputSchema: messageSchema,
  stateSchema: autoClassifyStateSchema,
})
  .then(keywordHandler)
  .thenIf(
    (_input, ctx) => !ctx.sequencer?.state.keywordMatched,
    llmClassifySequencer,
  );

