/**
 * Thinking Style Resolution + Pipelines
 *
 * Resolves "auto" thinking style to a concrete style via:
 *   1. Keyword handler — fast heuristic scan, patches session state directly if match
 *   2. LLM classifier — intentClassifier fallback when no keyword matched
 *
 * Defines five concrete pipelines (default, plan-and-execute, supervisor,
 * blackboard, reactive-blackboard) and the router that dispatches between them.
 */
import { generator, handler, router, sequencer, utility } from "@flow-state-dev/core";
import type { GeneratorSlot, UsesSlot } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import { supervisor } from "@flow-state-dev/patterns/supervisor";
import { blackboard, createBlackboard } from "@flow-state-dev/patterns/blackboard";
import {
  reactiveBlackboard,
  actor,
  mesh,
} from "@flow-state-dev/patterns/reactive-blackboard";
import { z } from "zod";

// -------------------------------------------------------------------------
// Schemas
// -------------------------------------------------------------------------

export const thinkingStyleSchema = z.enum([
  "plan-and-execute",
  "supervisor",
  "blackboard",
  "reactive-blackboard",
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

export const REACTIVE_BLACKBOARD_KEYWORDS = [
  "reactive blackboard",
  "reactive analysis",
  "parallel analysis",
  "multiple angles",
  "different angles",
  "simultaneous perspectives",
  "concurrent analysis",
  "parallel perspectives",
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
    } else if (REACTIVE_BLACKBOARD_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "reactive-blackboard";
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
    "reactive-blackboard": `
      The message asks for analysis where multiple independent perspectives should
      examine the problem in parallel — reacting simultaneously rather than being
      orchestrated by a controller. Each perspective fires independently and
      results are synthesized at the end. Examples: "analyze this from multiple
      angles", "give me parallel perspectives", "examine this simultaneously from
      different viewpoints", "concurrent analysis from different angles".
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
  /** Capabilities to install on all default pattern blocks. */
  uses?: UsesSlot;
}

export function createThinkingStyleRouter(config: ThinkingStyleRouterConfig) {
  const { assistantGenerator, modelId, context, uses } = config;

  // Default — direct generation.
  const defaultPipeline = assistantGenerator;

  // Plan and Execute — decomposes into steps, executes, synthesizes.
  const paePipeline = planAndExecute({
    name: "pae-thinking",
    model: modelId,
    context,
    history: config.history,
    search: true,
    uses,
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
    ...(uses ? { uses: uses as any } : {}),
    search: true,
    emit: { messages: false, toolCalls: false },
    prompt: [
      "You are a focused task executor within a supervisor workflow.",
      "Complete the assigned task concisely and accurately.",
      "If feedback from a prior attempt is provided, address it directly.",
      "IMPORTANT: Your text response IS the task deliverable. Return all substantive content as your response text — do not write it to files instead.",
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
    uses,
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
      sessionResources: { blackboard: bbBoard },
      ...(uses ? { uses: uses as any } : {}),
      context,
      history: config.history,
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
    uses,
    maxIterations: 8,
    maxHistory: 20,
    initialState: (input: unknown) => ({
      goal: (input as { message?: string })?.message ?? "",
    }),
    outputSchema: z.string(),
  });

  // -----------------------------------------------------------------------
  // Reactive Blackboard — parallel actor fan-out with no controller.
  // Three actors react to the user's query simultaneously. Each brings
  // a different perspective. A synthesizer merges their contributions.
  // -----------------------------------------------------------------------

  const rbEntrySchema = z.object({
    type: z.string(),
    topic: z.string(),
    body: z.any(),
  });

  const rb = reactiveBlackboard({ name: "reactive", entries: rbEntrySchema });

  function rbActor(actorConfig: {
    name: string;
    role: string;
    prompt: string;
  }) {
    const gen = generator({
      name: `${actorConfig.name}-gen`,
      model: modelId,
      outputSchema: z.string(),
      sessionResources: { reactiveBoard: rb.blackboard },
      ...(uses ? { uses: uses as any } : {}),
      context,
      history: config.history,
      search: true,
      emit: { messages: false, toolCalls: false },
      prompt: actorConfig.prompt,
      user: (input: any) =>
        typeof input === "string" ? input : (input.body ?? JSON.stringify(input)),
    });

    const writeBack = handler({
      name: `${actorConfig.name}-write`,
      inputSchema: z.string(),
      outputSchema: z.any(),
      sessionResources: { reactiveBoard: rb.blackboard },
      execute: async (output: string, ctx) => {
        const state = ctx.session.resources.reactiveBoard.state as {
          entries: Array<Record<string, unknown>>;
        };
        await ctx.session.resources.reactiveBoard.patchState({
          entries: [
            ...state.entries,
            { type: "observation", topic: actorConfig.role, body: output },
          ],
        });
        ctx
          .emitComponent(
            "rb-actor",
            {
              actor: actorConfig.name,
              role: actorConfig.role,
              contribution: output,
            },
            { key: actorConfig.name },
          )
          .done();
        return { actor: actorConfig.name, contributed: true };
      },
    });

    return actor({
      name: actorConfig.name,
      watch: ["request:**"],
      body: sequencer({ name: actorConfig.name, inputSchema: z.any() })
        .then(gen)
        .then(writeBack),
    });
  }

  const rbExplorer = rbActor({
    name: "rb-explorer",
    role: "explorer",
    prompt: [
      "You are an Explorer within a parallel analysis team.",
      "Your job is to investigate the question broadly: gather relevant",
      "information, identify key concepts, surface context the other",
      "analysts might miss, and find supporting evidence or examples.",
      "Be thorough but concise. Focus on breadth over depth.",
    ].join("\n"),
  });

  const rbAnalyst = rbActor({
    name: "rb-analyst",
    role: "analyst",
    prompt: [
      "You are an Analyst within a parallel analysis team.",
      "Your job is to reason deeply about the question: identify patterns,",
      "draw inferences, evaluate trade-offs, and produce structured",
      "insights. Build a logical argument. Where the explorer gathers,",
      "you synthesize.",
    ].join("\n"),
  });

  const rbChallenger = rbActor({
    name: "rb-challenger",
    role: "challenger",
    prompt: [
      "You are a Challenger within a parallel analysis team.",
      "Your job is to stress-test the obvious answers: find gaps,",
      "counter-arguments, edge cases, and hidden assumptions.",
      "Be constructive but rigorous. If something seems too simple,",
      "explain why. Identify what could go wrong.",
    ].join("\n"),
  });

  const rbMesh = mesh({
    name: "reactive-thinking",
    blackboard: rb,
    actors: [rbExplorer, rbAnalyst, rbChallenger],
    concurrency: 3,
  });

  const rbSynthesizer = generator({
    name: "rb-synthesizer",
    model: modelId,
    outputSchema: z.string(),
    sessionResources: { reactiveBoard: rb.blackboard },
    ...(uses ? { uses: uses as any } : {}),
    context,
    history: config.history,
    search: true,
    emit: { messages: true, reasoning: true },
    prompt: [
      "You are a synthesis agent. Three independent analysts examined",
      "the user's question in parallel — an Explorer (breadth), an Analyst",
      "(depth), and a Challenger (stress-testing). Their contributions",
      "are shown below.",
      "",
      "Produce a coherent, well-rounded response that integrates their",
      "perspectives. Highlight areas of agreement, acknowledge tensions",
      "or gaps the Challenger raised, and give the user a comprehensive",
      "answer. Do not mention the analysts or the internal process.",
    ].join("\n"),
    user: (_input: any, ctx: any) => {
      const state = ctx.session.resources.reactiveBoard.state as {
        entries: Array<{ type: string; topic: string; body: string }>;
      };
      const entries = state.entries ?? [];
      const request = entries.find((e) => e.type === "request");
      const observations = entries.filter((e) => e.type === "observation");

      const parts: string[] = [];
      if (request) parts.push(`Original question: ${request.body}`);
      for (const obs of observations) {
        parts.push(`## ${obs.topic}\n${obs.body}`);
      }
      return parts.join("\n\n---\n\n") || "No contributions were gathered.";
    },
  });

  const reactiveBlackboardPipeline = sequencer({
    name: "reactive-blackboard-thinking",
    inputSchema: z.any(),
  })
    .map((input: any) => ({
      type: "request",
      topic: "query",
      body: input.message ?? input,
    }))
    .then(rbMesh.emit)
    .then(rbSynthesizer);

  // Router — adapts flow input to each pipeline's expected shape via connectInput.
  // connectInput delegates through the original block's .run, so route
  // interception (e.g. testRouter) works transparently.
  const thinkingStyleRouter = router({
    name: "thinking-style-router",
    routes: [defaultPipeline, paePipeline, supervisorPipeline, blackboardPipeline, reactiveBlackboardPipeline],
    execute: (input, ctx) => {
      const style = ctx.session.state.thinkingStyle as string | undefined;
      switch (style) {
        case "plan-and-execute":
          return paePipeline.connectInput(() => ({ goal: input.message }));
        case "supervisor":
          return supervisorPipeline.connectInput(() => ({ goal: input.message }));
        case "blackboard":
          return blackboardPipeline.connectInput(() => input);
        case "reactive-blackboard":
          return reactiveBlackboardPipeline.connectInput(() => input);
        default:
          return defaultPipeline;
      }
    },
  });

  return { thinkingStyleRouter, defaultPipeline, paePipeline, supervisorPipeline, blackboardPipeline, reactiveBlackboardPipeline };
}
