/**
 * Thinking Style Resolution + Pipelines
 *
 * Resolves "auto" thinking style to a concrete style via:
 *   1. Keyword handler — fast heuristic scan, patches session state directly if match
 *   2. LLM classifier — intentClassifier fallback when no keyword matched
 *
 * Defines the three thinking-style pipelines (chain-of-thought, plan-and-execute,
 * supervisor) and the router that dispatches between them.
 */
import { generator, handler, router, sequencer, utility } from "@flow-state-dev/core";
import type { GeneratorSlot } from "@flow-state-dev/core";
import type { BlockDefinition, ScopeResourceConfig } from "@flow-state-dev/core/types";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import { supervisor } from "@flow-state-dev/patterns/supervisor";
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
// -------------------------------------------------------------------------

const messageSchema = z.object({ message: z.string() });

export const keywordHandler = handler({
  name: "keyword-style-handler",
  inputSchema: messageSchema,
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
  .then((input) => input.message, classifierBlock)
  .tap(applyClassifiedStyle);

// -------------------------------------------------------------------------
// Auto-classify sequencer (exported for use in flow.ts)
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

// -------------------------------------------------------------------------
// Thinking Style Router Factory
//
// Accepts the assistant generator and produces the router + pipelines.
// This factory pattern avoids circular dependencies between thinking-styles
// and flow.ts (where the assistant generator is defined).
// -------------------------------------------------------------------------

export interface ThinkingStyleRouterConfig {
  assistantGenerator: BlockDefinition<any, any>;
  modelId: string;
  context: GeneratorSlot<any, any>;
  tools: BlockDefinition<any, any>[];
  sessionResources: Record<string, ScopeResourceConfig>;
}

export function createThinkingStyleRouter(config: ThinkingStyleRouterConfig) {
  const { assistantGenerator, modelId, context, tools, sessionResources } = config;

  // Chain of Thought — direct generation.
  const cotPipeline = assistantGenerator;

  // Plan and Execute — decomposes into steps, executes, synthesizes.
  const paePipeline = planAndExecute({
    name: "pae-thinking",
    model: modelId,
    context,
    search: true,
    tools,
    sessionResources,
    enableReplanning: true,
  });

  // Supervisor — plan → dispatch workers → review → replan loop.
  // Dedicated worker generator: task-focused prompt, silent emit to avoid
  // polluting the conversation stream with per-task messages.
  const supervisorWorker = generator({
    name: "supervisor-worker",
    model: modelId,
    inputSchema: z.object({
      id: z.string(),
      goal: z.string(),
      feedback: z.string().optional(),
    }),
    outputSchema: z.string(),
    context,
    tools,
    sessionResources,
    search: true,
    emit: { messages: false },
    prompt: [
      "You are a focused task executor within a supervisor workflow.",
      "Complete the assigned task concisely and accurately.",
      "If feedback from a prior attempt is provided, address it directly.",
    ].join("\n"),
    user: (input) =>
      input.feedback
        ? `Task: ${input.goal}\n\nPrevious feedback: ${input.feedback}`
        : `Task: ${input.goal}`,
  });

  const supervisorPipeline = supervisor({
    name: "supervisor-thinking",
    worker: supervisorWorker,
    maxIterations: 3,
    maxConcurrency: 3,
    onSubTaskError: "skip",
    outputSchema: z.string(),
  });

  // Router — adapts flow input to each pipeline's expected shape via connectInput.
  // connectInput delegates through the original block's .run, so route
  // interception (e.g. testRouter) works transparently.
  const thinkingStyleRouter = router({
    name: "thinking-style-router",
    routes: [cotPipeline, paePipeline, supervisorPipeline],
    execute: (input, ctx) => {
      const style = ctx.session.state.thinkingStyle as string | undefined;
      switch (style) {
        case "plan-and-execute":
          return paePipeline.connectInput(() => ({ goal: input.message }));
        case "supervisor":
          return supervisorPipeline.connectInput(() => ({ goal: input.message }));
        default:
          return cotPipeline;
      }
    },
  });

  return { thinkingStyleRouter, cotPipeline, paePipeline, supervisorPipeline };
}
