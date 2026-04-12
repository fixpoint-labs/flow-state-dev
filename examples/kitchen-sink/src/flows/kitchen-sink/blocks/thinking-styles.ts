/**
 * Thinking Style Resolution + Pipelines
 *
 * Resolves "auto" thinking style to a concrete style via:
 *   1. Keyword handler — fast heuristic scan, patches session state directly if match
 *   2. LLM classifier — intentClassifier fallback when no keyword matched
 *
 * Defines the three concrete pipelines (default, plan-and-execute, supervisor)
 * and the router that dispatches between them.
 */
import { generator, handler, router, sequencer, utility } from "@flow-state-dev/core";
import type { GeneratorSlot, ToolsSlot } from "@flow-state-dev/core";
import type { BlockDefinition, DeclaredResourceEntry } from "@flow-state-dev/core/types";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import { supervisor } from "@flow-state-dev/patterns/supervisor";
import { blackboard, createBlackboard } from "@flow-state-dev/patterns/blackboard";
import { z } from "zod";

// -------------------------------------------------------------------------
// Schemas
// -------------------------------------------------------------------------

export const thinkingStyleSchema = z.enum([
  "plan-and-execute",
  "supervisor",
  "blackboard",
  "default",
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

export const BLACKBOARD_KEYWORDS = [
  "blackboard",
  "shared workspace",
  "multiple perspectives",
  "expert perspectives",
  "multi-disciplinary",
  "research synthesis",
  "independent experts",
  "contribute independently",
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
    } else if (BLACKBOARD_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "blackboard";
    } else if (PLAN_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "plan-and-execute";
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
    blackboard: `
      The message asks for analysis or research where multiple independent expert
      perspectives should each contribute to a shared workspace incrementally.
      A controller decides which expert to consult next based on accumulated
      knowledge. Examples: document analysis from legal/technical/business angles,
      complex problem-solving requiring research + analysis + critique,
      multi-disciplinary review where each discipline contributes independently.
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
  history?: GeneratorSlot<any, any>;
  context: GeneratorSlot<any, any>;
  tools: ToolsSlot;

  sessionResources: Record<string, DeclaredResourceEntry>;
}

export function createThinkingStyleRouter(config: ThinkingStyleRouterConfig) {
  const { assistantGenerator, modelId, context, tools, sessionResources } = config;

  // Default — direct generation.
  const defaultPipeline = assistantGenerator;

  // Plan and Execute — decomposes into steps, executes, synthesizes.
  const paePipeline = planAndExecute({
    name: "pae-thinking",
    model: modelId,
    context,
    history: config.history,
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
    emit: { messages: false, toolCalls: false },
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
    context,
    history: config.history,
  });

  // Blackboard — multiple independent specialists contribute to a shared
  // resource workspace. A controller reads the workspace state and decides
  // which specialist to invoke next until the problem converges.
  const bbBoard = createBlackboard(z.object({
    goal: z.string().default(""),
    research: z.string().optional(),
    analysis: z.string().optional(),
    critique: z.string().optional(),
  }));

  function bbSpecialist(specConfig: {
    name: string;
    field: string;
    prompt: string;
  }) {
    const gen = generator({
      name: `${specConfig.name}-gen`,
      model: modelId,
      outputSchema: z.string(),
      sessionResources: { blackboard: bbBoard, ...sessionResources },
      context,
      tools,
      search: true,
      emit: { messages: false, toolCalls: false },
      prompt: specConfig.prompt,
      user: (_input: any, ctx: any) => {
        const state = ctx.session.resources.blackboard.state;
        return `Current blackboard state:\n${JSON.stringify(state, null, 2)}`;
      },
    });

    const writeBack = handler({
      name: `${specConfig.name}-write`,
      inputSchema: z.string(),
      outputSchema: z.any(),
      sessionResources: { blackboard: bbBoard },
      execute: async (output: string, ctx) => {
        await ctx.session.resources.blackboard.patchState({
          [specConfig.field]: output,
        });
        return { specialist: specConfig.name, contributed: true };
      },
    });

    return sequencer({ name: specConfig.name, inputSchema: z.any() })
      .then(gen)
      .then(writeBack);
  }

  const bbResearcher = bbSpecialist({
    name: "bb-researcher",
    field: "research",
    prompt: [
      "You are a research specialist within a blackboard collaboration.",
      "Your job is to gather information, find relevant data, evidence,",
      "and source material related to the goal on the blackboard.",
      "Review what other specialists have contributed and focus on",
      "filling knowledge gaps. Be thorough and cite sources when possible.",
    ].join("\n"),
  });

  const bbAnalyst = bbSpecialist({
    name: "bb-analyst",
    field: "analysis",
    prompt: [
      "You are an analytical specialist within a blackboard collaboration.",
      "Your job is to synthesize the research on the blackboard into structured",
      "analysis: identify patterns, draw conclusions, compare perspectives,",
      "and produce actionable insights. Build on what the researcher found.",
    ].join("\n"),
  });

  const bbCritic = bbSpecialist({
    name: "bb-critic",
    field: "critique",
    prompt: [
      "You are a critical review specialist within a blackboard collaboration.",
      "Your job is to identify gaps, weaknesses, counterarguments, and blind spots",
      "in the research and analysis on the blackboard. Be constructive but honest.",
      "Suggest what needs more investigation or where reasoning is weak.",
    ].join("\n"),
  });

  const blackboardPipeline = blackboard({
    name: "blackboard-thinking",
    blackboard: bbBoard,
    specialists: {
      "bb-researcher": bbResearcher,
      "bb-analyst": bbAnalyst,
      "bb-critic": bbCritic,
    },
    model: modelId,
    context,
    maxIterations: 8,
    maxHistory: 20,
    initialState: (input: unknown) => ({
      goal: (input as { message?: string })?.message ?? "",
    }),
    outputSchema: z.string(),
  });

  // Router — adapts flow input to each pipeline's expected shape via connectInput.
  // connectInput delegates through the original block's .run, so route
  // interception (e.g. testRouter) works transparently.
  const thinkingStyleRouter = router({
    name: "thinking-style-router",
    routes: [defaultPipeline, paePipeline, supervisorPipeline, blackboardPipeline],
    execute: (input, ctx) => {
      const style = ctx.session.state.thinkingStyle as string | undefined;
      switch (style) {
        case "plan-and-execute":
          return paePipeline.connectInput(() => ({ goal: input.message }));
        case "supervisor":
          return supervisorPipeline.connectInput(() => ({ goal: input.message }));
        case "blackboard":
          return blackboardPipeline.connectInput(() => input);
        default:
          return defaultPipeline;
      }
    },
  });

  return { thinkingStyleRouter, defaultPipeline, paePipeline, supervisorPipeline, blackboardPipeline };
}
