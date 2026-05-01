/**
 * Thinking Style Resolution + Pipelines
 *
 * Resolves "auto" thinking style to a concrete style via:
 *   1. Keyword handler — fast heuristic scan, patches session state directly if match
 *   2. LLM classifier — intentClassifier fallback when no keyword matched
 *
 * Defines five concrete pipelines (default, plan-and-execute, supervisor,
 * routed-specialists, reactive-blackboard) and the router that dispatches
 * between them.
 */
import { generator, handler, router, sequencer, utility } from "@flow-state-dev/core";
import type { GeneratorHistoryConfig, GeneratorSlot, UsesSlot } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import { supervisor } from "@flow-state-dev/patterns/supervisor";
import { routedSpecialists, createWorkspace } from "@flow-state-dev/patterns/routedSpecialists";
import {
  createEventActorsWorkspace,
  actor,
  eventActors,
} from "@flow-state-dev/patterns/eventActors";
import { z } from "zod";

// -------------------------------------------------------------------------
// Schemas
// -------------------------------------------------------------------------

export const thinkingStyleSchema = z.enum([
  "plan-and-execute",
  "supervisor",
  "routed-specialists",
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

export const REACTIVE_BLACKBOARD_KEYWORDS = [
  "reactive blackboard",
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
    } else if (REACTIVE_BLACKBOARD_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "reactive-blackboard";
    } else if (ROUTED_SPECIALISTS_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "routed-specialists";
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

/** Resolvable string — static or computed at runtime from input and context. */
type InstructionsSlot = string | ((input: any, ctx: any) => string | Promise<string>);

export interface ThinkingStyleRouterConfig {
  assistantGenerator: BlockDefinition<any, any>;
  /** Model ID string or a selectModel() resolver. */
  modelId: string | ((input: any, ctx: any) => any);
  history?: GeneratorHistoryConfig<any, any>;
  context: GeneratorSlot<any, any>;
  /** Capabilities to install on all default pattern blocks. */
  uses?: UsesSlot;
  /** Overall instructions passed to pattern sub-blocks (planner, controller, synthesizer). */
  instructions?: InstructionsSlot;
}

export function createThinkingStyleRouter(config: ThinkingStyleRouterConfig) {
  const { assistantGenerator, modelId, context, uses, instructions } = config;

  // Default — direct generation.
  const defaultPipeline = assistantGenerator;

  // Plan and Execute — decomposes into steps, executes, synthesizes.
  const paePipeline = planAndExecute({
    name: "pae-thinking",
    model: modelId as any,
    instructions,
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
      taskId: z.string(),
      goal: z.string(),
      input: z.unknown().optional(),
      deps: z.record(z.unknown()).optional(),
      attempts: z.number().int().nonnegative().default(0),
      feedback: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
    outputSchema: z.string(),
    context,
    ...(uses ? { uses: uses as any } : {}),
    search: true,
    agentType: "sub",
    prompt: [
      "You are a focused task executor within a supervisor workflow.",
      "Complete the assigned task concisely and accurately.",
      "If task context is provided, follow those guidelines while completing the task.",
      "If prior task results are provided, build directly on that context — reuse their findings and source URLs rather than re-discovering what an upstream task already established.",
      "When citing a fact that came from a source, include the URL inline as a Markdown link.",
      "If feedback from a prior attempt is provided, address it directly.",
      "IMPORTANT: Your text response IS the task deliverable. Return all substantive content as your response text — do not write it to files instead.",
    ].join("\n"),
    user: (input) => {
      const parts = [`Task: ${input.goal}`];
      if (typeof input.input === "string") parts.push(`\nContext: ${input.input}`);
      if (input.deps !== undefined && Object.keys(input.deps).length > 0) {
        const sections = Object.entries(input.deps).map(([depId, value]) => {
          if (typeof value === "string") return `From ${depId}:\n${value}`;
          if (value === null || typeof value !== "object") {
            return `From ${depId}: ${JSON.stringify(value)}`;
          }
          const obj = value as Record<string, unknown>;
          const summary =
            "summary" in obj && typeof obj.summary === "string"
              ? obj.summary
              : JSON.stringify(value);
          const sources = Array.isArray(obj.sources)
            ? (obj.sources as Array<{ title?: string; url: string }>).filter(
                (s) => typeof s?.url === "string" && s.url.length > 0,
              )
            : [];
          const sourceLines = sources
            .map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.url}`)
            .join("\n");
          const sourcesPart =
            sourceLines.length > 0
              ? `\nSources used in this task:\n${sourceLines}`
              : "";
          return `From ${depId}:\n${summary}${sourcesPart}`;
        });
        parts.push(
          `\nContext from prior tasks:\n${sections.join("\n\n---\n\n")}`,
        );
      }
      if (input.feedback) parts.push(`\nPrevious feedback: ${input.feedback}`);
      return parts.join("\n");
    },
  });

  const supervisorPipeline = supervisor({
    name: "supervisor-thinking",
    worker: supervisorWorker,
    instructions,
    maxConcurrency: 3,
    onSubTaskError: "skip",
    outputSchema: z.string(),
    context,
    history: config.history,
    uses,
  });

  // Routed Specialists — multiple independent specialists contribute to a
  // shared workspace resource. A controller reads the workspace state and
  // decides which specialist to invoke next until the problem converges.
  const workspace = createWorkspace(z.object({
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
      resources: { workspace },
      ...(uses ? { uses: uses as any } : {}),
      context,
      history: config.history,
      search: true,
      agentType: "sub",
      prompt: specConfig.prompt,
      user: (_input: any, ctx: any) => {
        const state = ctx.resources.workspace.state;
        return `Current workspace state:\n${JSON.stringify(state, null, 2)}`;
      },
    });

    const writeBack = handler({
      name: `${specConfig.name}-write`,
      inputSchema: z.string(),
      outputSchema: z.any(),
      resources: { workspace },
      execute: async (output: string, ctx) => {
        await ctx.resources.workspace.patchState({
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
      "You are a research specialist within a routed-specialists collaboration.",
      "Your job is to gather information, find relevant data, evidence,",
      "and source material related to the goal in the shared workspace.",
      "Review what other specialists have contributed and focus on",
      "filling knowledge gaps. Be thorough and cite sources when possible.",
    ].join("\n"),
  });

  const bbAnalyst = bbSpecialist({
    name: "bb-analyst",
    field: "analysis",
    prompt: [
      "You are an analytical specialist within a routed-specialists collaboration.",
      "Your job is to synthesize the research in the workspace into structured",
      "analysis: identify patterns, draw conclusions, compare perspectives,",
      "and produce actionable insights. Build on what the researcher found.",
    ].join("\n"),
  });

  const bbCritic = bbSpecialist({
    name: "bb-critic",
    field: "critique",
    prompt: [
      "You are a critical review specialist within a routed-specialists collaboration.",
      "Your job is to identify gaps, weaknesses, counterarguments, and blind spots",
      "in the research and analysis in the workspace. Be constructive but honest.",
      "Suggest what needs more investigation or where reasoning is weak.",
    ].join("\n"),
  });

  const routedSpecialistsPipeline = routedSpecialists({
    name: "routedSpecialists-thinking",
    workspace,
    specialists: {
      "bb-researcher": bbResearcher,
      "bb-analyst": bbAnalyst,
      "bb-critic": bbCritic,
    },
    instructions,
    model: modelId as any,
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
  // Reactive Blackboard — stigmergic multi-agent coordination.
  //
  // Actors produce granular entries (observations, findings, challenges)
  // that trigger other actors via topic-based watch patterns. The reactive
  // chain creates data-dependent fan-out: 1 request → N observations →
  // N×M findings → N×M×K challenges. The mesh's reEmit mechanism handles
  // appending entries and dispatching matching actors automatically.
  // -----------------------------------------------------------------------

  const rbEntrySchema = z.object({
    type: z.string(),
    topic: z.string(),
    body: z.any(),
  });

  const rb = createEventActorsWorkspace({ name: "reactive", entries: rbEntrySchema });

  // Shared output schema for actors that produce re-emittable entries.
  // Wrapped in an object because the AI SDK requires top-level "type: object".
  // The pattern's normalizeToEntries() unwraps { entries: [...] } automatically.
  const entryOutputSchema = z.object({
    entries: z.array(z.object({
      type: z.string(),
      topic: z.string(),
      body: z.string(),
    })),
  });

  // Helper: build the user prompt from the triggering entry + blackboard context.
  function rbUserPrompt(input: any, ctx: any): string {
    const state = ctx.resources.reactiveBlackboard.state as {
      entries: Array<{ type: string; topic: string; body: string }>;
    };
    const entries = state?.entries ?? [];
    const body = typeof input === "string"
      ? input
      : (input.body ?? JSON.stringify(input));

    const prior = entries
      .filter((e: any) => e.type !== "request")
      .map((e: any) => `[${e.type}:${e.topic}] ${e.body}`)
      .join("\n\n");

    return prior
      ? `Entry: ${body}\n\nPrior entries on the blackboard:\n${prior}`
      : `Entry: ${body}`;
  }

  // Explorer — watches requests, produces granular observations.
  const rbExplorer = actor({
    name: "rb-explorer",
    watch: ["request:**"],
    body: generator({
      name: "rb-explorer-gen",
      model: modelId,
      outputSchema: entryOutputSchema,
      resources: { reactiveBlackboard: rb.workspace },
      ...(uses ? { uses: uses as any } : {}),
      context,
      history: config.history,
      search: true,
      prompt: [
        "You are an Explorer in a reactive blackboard analysis.",
        "Investigate the question broadly: identify key concepts, gather",
        "evidence, surface context others might miss.",
        "",
        "Use your available tools to research the topic — search the web,",
        "fetch relevant pages, and gather real data before forming observations.",
        "Do not rely solely on your training data when current information",
        "would strengthen your observations.",
        "",
        "Return 2-4 distinct observations as a JSON array.",
        "Each entry must have: type \"observation\", a short descriptive",
        "topic slug (e.g. \"key-concept\", \"historical-context\"), and a",
        "body with your substantive observation. Focus on breadth — each",
        "observation should cover a different angle.",
      ].join("\n"),
      user: rbUserPrompt,
    }),
  });

  // Analyst — watches observations, produces findings (structured analysis).
  // Fires once per observation, so N observations → N analyst invocations.
  const rbAnalyst = actor({
    name: "rb-analyst",
    watch: ["observation:**"],
    body: generator({
      name: "rb-analyst-gen",
      model: modelId,
      outputSchema: entryOutputSchema,
      resources: { reactiveBlackboard: rb.workspace },
      ...(uses ? { uses: uses as any } : {}),
      context,
      history: config.history,
      search: true,
      prompt: [
        "You are an Analyst in a reactive blackboard analysis.",
        "You receive a specific observation from the Explorer.",
        "Analyze it in the context of the full blackboard state:",
        "identify patterns, draw inferences, evaluate trade-offs.",
        "",
        "Use your available tools to research specifics when the observation",
        "references claims, data, or topics that would benefit from verification",
        "or deeper investigation.",
        "",
        "Return 1-2 findings as a JSON array.",
        "Each entry must have: type \"finding\", a short descriptive",
        "topic slug (e.g. \"pattern-identified\", \"trade-off\"), and a",
        "body with your structured analysis.",
      ].join("\n"),
      user: rbUserPrompt,
    }),
  });

  // Challenger — watches findings, produces challenges.
  // Fires once per finding, stress-testing each conclusion.
  const rbChallenger = actor({
    name: "rb-challenger",
    watch: ["finding:**"],
    body: generator({
      name: "rb-challenger-gen",
      model: modelId,
      outputSchema: entryOutputSchema,
      resources: { reactiveBlackboard: rb.workspace },
      ...(uses ? { uses: uses as any } : {}),
      context,
      history: config.history,
      search: true,
      prompt: [
        "You are a Challenger in a reactive blackboard analysis.",
        "You receive a specific finding from the Analyst.",
        "Stress-test it: find gaps, counter-arguments, edge cases,",
        "hidden assumptions. Be constructive but rigorous.",
        "",
        "Use your available tools to find counter-evidence or alternative",
        "viewpoints that challenge the finding.",
        "",
        "Return 1 challenge as a JSON array with a single entry.",
        "The entry must have: type \"challenge\", a short descriptive",
        "topic slug (e.g. \"assumption-gap\", \"counter-evidence\"), and",
        "a body explaining the weakness or alternative perspective.",
      ].join("\n"),
      user: rbUserPrompt,
    }),
  });

  const rbMesh = eventActors({
    name: "reactive-thinking",
    workspace: rb,
    actors: [rbExplorer, rbAnalyst, rbChallenger],
    concurrency: 3,
    reEmit: true,
    maxDepth: 3,
  });

  const rbBasePrompt = [
    "You are a synthesis agent. A reactive analysis just completed.",
    "An Explorer produced observations, an Analyst turned each into",
    "findings, and a Challenger stress-tested each finding. All entries",
    "are shown below, grouped by tier.",
    "",
    "Produce a coherent, well-rounded response that integrates the",
    "full chain of reasoning. Highlight areas of agreement, acknowledge",
    "tensions or gaps the Challenger raised, and give the user a",
    "comprehensive answer. Do not mention the analysts or the process.",
  ];

  const rbSynthesizer = generator({
    name: "rb-synthesizer",
    model: modelId,
    outputSchema: z.string(),
    resources: { reactiveBlackboard: rb.workspace },
    ...(uses ? { uses: uses as any } : {}),
    context,
    history: config.history,
    search: true,
    prompt: [instructions, rbBasePrompt.join("\n")],
    agentType: "primary",
    activeStatusMessage: "Synthesizing all of the findings...",
    user: (_input: any, ctx: any) => {
      const state = ctx.resources.reactiveBlackboard.state as {
        entries: Array<{ type: string; topic: string; body: string }>;
      };
      const entries = state?.entries ?? [];
      const request = entries.find((e) => e.type === "request");
      const observations = entries.filter((e) => e.type === "observation");
      const findings = entries.filter((e) => e.type === "finding");
      const challenges = entries.filter((e) => e.type === "challenge");

      const parts: string[] = [];
      if (request) parts.push(`## Original Question\n${request.body}`);
      if (observations.length) {
        parts.push(`## Observations (${observations.length})\n` +
          observations.map((o) => `### ${o.topic}\n${o.body}`).join("\n\n"));
      }
      if (findings.length) {
        parts.push(`## Findings (${findings.length})\n` +
          findings.map((f) => `### ${f.topic}\n${f.body}`).join("\n\n"));
      }
      if (challenges.length) {
        parts.push(`## Challenges (${challenges.length})\n` +
          challenges.map((c) => `### ${c.topic}\n${c.body}`).join("\n\n"));
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
    routes: [defaultPipeline, paePipeline, supervisorPipeline, routedSpecialistsPipeline, reactiveBlackboardPipeline],
    execute: (input, ctx) => {
      const style = ctx.session.state.thinkingStyle as string | undefined;
      switch (style) {
        case "plan-and-execute":
          return paePipeline.connectInput(() => ({ goal: input.message }));
        case "supervisor":
          return supervisorPipeline.connectInput(() => ({ goal: input.message }));
        case "routed-specialists":
          return routedSpecialistsPipeline.connectInput(() => input);
        case "reactive-blackboard":
          return reactiveBlackboardPipeline.connectInput(() => input);
        default:
          return defaultPipeline;
      }
    },
  });

  return { thinkingStyleRouter, defaultPipeline, paePipeline, supervisorPipeline, routedSpecialistsPipeline, reactiveBlackboardPipeline };
}
