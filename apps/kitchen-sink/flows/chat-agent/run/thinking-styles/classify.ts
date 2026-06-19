/**
 * Thinking-style classification (the `auto` resolution path).
 *
 * Resolves `"auto"` to a concrete style via two tiers:
 *   1. Keyword handler — fast heuristic scan; patches session state directly on match.
 *   2. LLM classifier — `intentClassifier` fallback when no keyword matched.
 *
 * The resolved-style schema/types live in `shared/schemas.ts`; this file owns
 * only the classifier-specific config (keyword lists + classifier output shape).
 */
import { handler, sequencer, utility } from "@flow-state-dev/core";
import { z } from "zod";
import {
  thinkingStyleSchema,
  thinkingStyleSessionStateSchema,
  type ThinkingStyle,
} from "../../shared/schemas";

const autoClassifyStateSchema = z.object({
  keywordMatched: z.boolean().default(false),
});

const classifierOutputSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  reasoning: z.string().default(""),
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

export const ROUTED_SPECIALISTS_KEYWORDS = [
  "routed specialists",
  "routed-specialists",
  "shared workspace",
  "multiple perspectives",
  "expert perspectives",
  "multi-disciplinary",
  "research synthesis",
  "independent experts",
  "contribute independently",
];

export const EVENTED_ACTORS_KEYWORDS = [
  "evented actors",
  "reactive analysis",
  "parallel analysis",
  "multiple angles",
  "different angles",
  "simultaneous perspectives",
  "concurrent analysis",
  "parallel perspectives",
  "explore",
  "challenge ideas"
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

export const DEBATE_KEYWORDS = [
  "debate",
  "argue both sides",
  "for and against",
  "pros and cons",
  "weigh the merits",
  "is this a good idea",
  "should we",
];


// -------------------------------------------------------------------------
// Tier 1 — Keyword Handler
// -------------------------------------------------------------------------

const messageSchema = z.object({ message: z.string() });

export const keywordHandler = handler({
  name: "keyword-style-handler",
  inputSchema: messageSchema,
  outputSchema: z.object({ matched: z.boolean() }),
  sequencerStateSchema: autoClassifyStateSchema,
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    const message = input.message.toLowerCase();

    let matched: ThinkingStyle | null = null;
    if (SUPERVISOR_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "supervisor";
    } else if (EVENTED_ACTORS_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "evented-actors";
    } else if (ROUTED_SPECIALISTS_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "routed-specialists";
    } else if (DEBATE_KEYWORDS.some((kw) => message.includes(kw))) {
      // DEBATE_KEYWORDS is more specific than PLAN_KEYWORDS — phrases
      // like "should we" should resolve to a debate, not a plan.
      matched = "moderated-debate";
    } else if (PLAN_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "plan-and-execute";
    }

    if (matched !== null) {
      await ctx.sequencer!.patchState({ keywordMatched: true });
      if (matched !== ctx.session.state.thinkingStyle) {
        await ctx.session.patchState({ thinkingStyle: matched });
      }
      return { matched: true };
    }

    // returning the match is for tracing purposes, we don't use the output
    return { matched: false };
  },
});

// -------------------------------------------------------------------------
// Tier 2 — LLM Classifier
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
    "routed-specialists": `
      The message asks for analysis or research where multiple independent expert
      perspectives should each contribute to a shared workspace incrementally.
      A controller decides which specialist to consult next based on accumulated
      knowledge. Examples: document analysis from legal/technical/business angles,
      complex problem-solving requiring research + analysis + critique,
      multi-disciplinary review where each discipline contributes independently.
    `,
    "evented-actors": `
      The message asks for analysis where multiple independent perspectives should
      examine the problem in parallel — reacting simultaneously rather than being
      orchestrated by a controller. Each perspective fires independently and
      results are synthesized at the end. Examples: "analyze this from multiple
      angles", "give me parallel perspectives", "examine this simultaneously from
      different viewpoints", "concurrent analysis from different angles".
    `,
    "moderated-debate": `
      The message asks for adversarial analysis — argue both sides of a
      proposition, weigh pros and cons, evaluate the merits of a decision. The
      user wants disagreement surfaced and a verdict rendered. Examples:
      "should we refactor X", "is microservices the right call here", "argue
      both sides of the SQL-vs-NoSQL question".
    `,
    default: `
      The message is a direct question, a reasoning task, an explanation request,
      or anything where a single high-quality response is more appropriate than
      task decomposition. Examples: answering questions, comparing options,
      explaining concepts, debugging, short creative tasks.
    `,
  },
});

const applyClassifiedStyle = handler({
  name: "apply-classified-style",
  inputSchema: classifierOutputSchema,
  outputSchema: z.object({ style: thinkingStyleSchema }),
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    const parsed = thinkingStyleSchema.safeParse(input.category);
    const style: ThinkingStyle =
      input.confidence >= CONFIDENCE_THRESHOLD && parsed.success
        ? parsed.data
        : "default";
    if (style !== ctx.session.state.thinkingStyle) {
      await ctx.session.patchState({ thinkingStyle: style });
    }
    // returning the style is for tracing purposes, we don't use the output
    return { style };
  },
});

const llmClassifySequencer = sequencer({
  name: "llm-classify-style",
  inputSchema: messageSchema,
})
  .step((input) => input.message, classifierBlock)
  .tap(applyClassifiedStyle);

// -------------------------------------------------------------------------
// Auto-classify sequencer (consumed by run/steps.ts → resolveThinkingStyle)
// -------------------------------------------------------------------------

export const autoClassifyStyle = sequencer({
  name: "auto-classify-style",
  inputSchema: messageSchema,
  stateSchema: autoClassifyStateSchema,
})
  .tap(keywordHandler)
  .tapIf(
    (_input, ctx) => !ctx.sequencer?.state.keywordMatched,
    llmClassifySequencer,
  );
