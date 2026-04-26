/**
 * chat-agent flow
 *
 * A multi-modal AI assistant demonstrating the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, clientData, and tool-use.
 *
 * Pipeline:
 *   applyRequestedMode → intentSelector → resolveThinkingStyle → thinkingStyleRouter
 *     ├─ default (or auto-classified default) → assistantGenerator (direct generation)
 *     ├─ plan-and-execute   → planAndExecute wrapping the assistant
 *     └─ supervisor         → supervisor wrapping the assistant
 *
 * `intentSelector` (FIX-421) decides which skills (if any) apply to the
 * turn before the main generator runs; matched skills are activated into
 * session state and injected into the system prompt by the skills
 * capability's active-skill body formatter.
 */
import {
  defineFlow,
  generator,
  handler,
  sequencer,
  utility,
} from "@flow-state-dev/core";

import { system as memorySystem } from "@thought-fabric/core/memory";
import { perspective, system as perspectiveSystem } from "@thought-fabric/core/identity";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import { responseAuditor } from "@flow-state-dev/patterns/response-auditor";
import { z } from "zod";
import {
  updateArtifact,
  updateArtifactInputSchema,
  eventQueueDemo,
  eventQueueDemoInputSchema,
  artifactListContext,
  voiceContext,
  createThinkingStyleRouter,
  autoClassifyStyle,
  thinkingStyleSchema,
  thinkingStyleSessionStateSchema,
  featuresCapability,
  intentSelectorBlock,
  artifactResources,
} from "./blocks";
import { modeSchema, featuresSchema } from "./schemas";
import { ASK_PROMPT, BUILD_PROMPT, INTERVIEW_PROMPT, DEBATE_PROMPT } from "./prompts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_ID = "preset/small";

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

const mem = memorySystem({
  model: MODEL_ID,
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

// ---------------------------------------------------------------------------
// Perspective (ask mode only)
// ---------------------------------------------------------------------------

const analyst = perspective({
  name: "analyst-perspective",
  description: "Analytical reasoning partner who decomposes problems and evaluates tradeoffs",
  salience: {
    amplify: ["assumptions", "tradeoffs", "edge cases", "constraints", "contradictions"],
    suppress: ["pleasantries", "filler", "hedging language"],
  },
  reasoning: {
    priorities: ["identify unstated assumptions", "surface tradeoffs", "check for missing constraints"],
    riskModel: "What could go wrong if we act on incomplete information?",
  },
  expertise: ["problem decomposition", "tradeoff analysis", "critical thinking"],
  communicationStyle: {
    tone: "direct and specific",
    emphasis: "answer first, then reasoning",
  },
});

const analystPerspective = perspectiveSystem(analyst, { model: MODEL_ID });

// ---------------------------------------------------------------------------
// Flow-level schemas
// ---------------------------------------------------------------------------

const thinkingStyleInputSchema = z
  .enum(["auto", "default", "plan-and-execute", "supervisor", "blackboard", "reactive-blackboard"])
  .default("default");

const inputSchema = z.object({
  message: z.string().min(1),
  mode: modeSchema,
  thinkingStyle: thinkingStyleInputSchema,
  features: featuresSchema.default({}),
});

const sessionStateSchema = z.object({
  mode: modeSchema,
  thinkingStyle: thinkingStyleSchema.optional(),
  resolvedModel: z.string().optional(),
  requestCount: z.number().default(0),
  lastAction: z.string().optional(),
  features: featuresSchema.default({}),
});

// Brand preference axis (FIX-425). Orthogonal to preferredModel (tier). Empty
// string is "no preference" — stored as empty so the field is always present
// in user state without forcing an initial choice on the user.
const PROVIDER_PREFERENCE_VALUES = ["", "anthropic", "openai", "google"] as const;
const providerPreferenceSchema = z.enum(PROVIDER_PREFERENCE_VALUES).default("");

const userStateSchema = z.object({
  displayName: z.string().default("Developer"),
  preferredModel: z.string().default(MODEL_ID),
  preferredProvider: providerPreferenceSchema,
});

// ---------------------------------------------------------------------------
// Assistant generator — shared across all thinking styles
// ---------------------------------------------------------------------------

const assistantGenerator = generator({
  name: "assistant-generator",
  userStateSchema: z.object({ preferredModel: z.string().default(MODEL_ID) }),
  sessionStateSchema: z.object({ mode: modeSchema.default("ask"), thinkingStyle: z.string().optional() }),

  // Capabilities: auto-install resources, context formatters, and tools.
  // mem.capability injects unified memory recall context.
  // p.capability injects perspective framing (static + accumulated presets).
  // Perspective context appears in all modes but accumulated state only
  // grows in ask mode (capture is gated via workIf below).
  uses: [mem.capability, featuresCapability, analystPerspective.capability],

  // Object-form context: each entry becomes its own XML tag in the rendered
  // system message. Capabilities (mem, perspective) contribute their own
  // tags; same-key contributions across sources aggregate cleanly. See
  // docs/fundamentals/generator-context.md for the full contract.
  context: { voice: voiceContext },

  inputSchema,
  history: { limit: 8 },
  user: (input) => input.message,
  search: true,
  maxIterations: 20,
  outputSchema: z.string(),

  prompt: (_input, ctx) => {
    switch (ctx.session.state.mode) {
      case "build": return BUILD_PROMPT;
      case "interview": return INTERVIEW_PROMPT;
      case "debate": return DEBATE_PROMPT;
      default: return ASK_PROMPT;
    }
  },

  agentType: "primary",
  model: (_input: any, ctx: any) => ctx.session.state.resolvedModel ?? MODEL_ID,
});

// ---------------------------------------------------------------------------
// Thinking style router (via factory — see blocks/thinking-styles.ts)
// ---------------------------------------------------------------------------

const modeInstructions = (_input: any, ctx: any): string => {
  switch (ctx.session.state.mode) {
    case "build": return BUILD_PROMPT;
    case "interview": return INTERVIEW_PROMPT;
    case "debate": return DEBATE_PROMPT;
    default: return ASK_PROMPT;
  }
};

const { thinkingStyleRouter } = createThinkingStyleRouter({
  assistantGenerator,
  modelId: (_input: any, ctx: any) => ctx.session.state.resolvedModel ?? MODEL_ID,
  history: { limit: 8 },
  context: { memory: mem.contextFormatter, artifacts: artifactListContext },
  uses: [featuresCapability],
  instructions: modeInstructions,
});

export { thinkingStyleRouter };

// ---------------------------------------------------------------------------
// Inline blocks (small, flow-level concerns)
// ---------------------------------------------------------------------------

const applyRequestedMode = handler({
  name: "apply-requested-mode",
  inputSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("ask") }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ mode: input.mode });
  },
});

const resolveThinkingStyle = sequencer({
  name: "resolve-thinking-style",
  inputSchema,
  outputSchema: z.never(),
})
  .tapIf(
    (input) => input.thinkingStyle !== "auto",
    handler({
      name: "apply-manual-style",
      inputSchema,
      sessionStateSchema: thinkingStyleSessionStateSchema,
      execute: async (input, ctx) => {
        if (input.thinkingStyle !== ctx.session.state.thinkingStyle) {
          await ctx.session.patchState({ thinkingStyle: input.thinkingStyle });
        }
      },
    }),
  )
  .tapIf(
    (input) => input.thinkingStyle === "auto",
    autoClassifyStyle,
  );

const incrementRequestCount = handler({
  name: "increment-request-count",
  sessionStateSchema: z.object({
    requestCount: z.number().default(0),
    lastAction: z.string().optional(),
  }),
  execute: async (_input, ctx) => {
    const count = ctx.session.state.requestCount ?? 0;
    await ctx.session.patchState({
      requestCount: count + 1,
      lastAction: "run",
    });
  },
});

const autoTitle = utility.sessionTitleGenerator({
  name: "auto-title",
  model: MODEL_ID,
});

const applyFeatures = handler({
  name: "apply-features",
  inputSchema,
  sessionStateSchema: z.object({ features: featuresSchema.default({}) }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ features: input.features });
  },
});

// Resolve the model once per request so downstream blocks and clientData can
// Resolve the preset to its primary concrete model string (e.g.
// "preset/medium" → "anthropic/claude-sonnet-4-6") so downstream blocks
// and clientData can read ctx.session.state.resolvedModel.
const resolveModel = handler({
  name: "resolve-model",
  inputSchema,
  userStateSchema,
  sessionStateSchema: z.object({ resolvedModel: z.string().optional() }),
  execute: async (_input, ctx) => {
    const preferred = ctx.user?.state.preferredModel ?? MODEL_ID;
    // Empty preferredProvider ("") means "no preference" — resolveId leaves
    // the preset's natural order intact. Otherwise the string reorders the
    // preset's candidate list before the first-available walk.
    const preferredProvider = ctx.user?.state.preferredProvider ?? "";
    const resolved = ctx.resolveModel.resolveId(preferred, {
      prefer: preferredProvider === "" ? undefined : preferredProvider,
    });
    await ctx.session.patchState({ resolvedModel: resolved });
  },
});

// Bias check pipeline — runs in background after the router produces output.
// Wraps biasAnalyzer in responseAuditor for threshold filtering + UI display.
// Skips the LLM calls entirely when the feature is disabled.

// Adapter: bridges biasAnalyzer (userInput/aiResponse → BiasAnalyzerOutput)
// to the responseAuditor contract (userInput/response → AnalyzerResult).
const biasAnalyzerAdapter = sequencer({
  name: "bias-adapter",
  inputSchema: z.object({ userInput: z.string(), response: z.string() }),
})
  .map((input: { userInput: string; response: string }) => ({
    userInput: input.userInput,
    aiResponse: input.response,
  }))
  .then(biasAnalyzer({ model: MODEL_ID }))
  .map((output: Record<string, unknown>) => {
    const annotations = (output.annotations as Array<Record<string, unknown>>) ?? [];
    const severity = output.severity as string;
    return {
      analyzerId: output.analyzerId as string,
      category: output.category as string,
      score: output.score as number,
      shouldSurface: (output.score as number) >= 0.3,
      annotations: annotations.map((a) => ({
        type: a.biasType as string,
        label: (a.biasType as string).replace(/_/g, " "),
        severity: severity as "info" | "warning" | "critical",
        description: a.description as string,
        evidence: a.evidence as string | undefined,
      })),
      supplementary: {
        summary: output.summary,
        label: output.label,
        sycophancyScore: output.sycophancyScore,
        counterArguments: output.counterArguments,
      },
    };
  });

const auditor = responseAuditor({
  analyzers: [biasAnalyzerAdapter],
  threshold: 0.3,
});

const biasCheck = sequencer({ 
  name: "bias-check", 
  inputSchema: z.string()
})
  .map((aiResponse: string, ctx) => ({
    userInput: String(
      (ctx.parent?.input as Record<string, unknown>)?.message ?? "",
    ),
    response: aiResponse,
  }))
  .thenIf(
    (_input, ctx) => !!(ctx.session.state.features as any).biasCheck,      
    auditor,
  )
  .tap((result: unknown, ctx) => {
    // Emit component item when auditor produced surfaced results.
    if (result && typeof result === "object" && "surfacedResults" in result) {
      const data = result as {
        surfacedResults: unknown[];
        results: unknown[];
        overallScore: number;
      };
      if (data.surfacedResults.length > 0) {
        ctx.emitComponent(
          "audit-annotation",
          data as unknown as Record<string, unknown>,
        );
      }
    }
  });

const setPreferredModelInputSchema = z.object({
  preferredModel: z.string().min(1),
});

const setPreferredModelHandler = handler({
  name: "set-preferred-model",
  inputSchema: setPreferredModelInputSchema,
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ preferredModel: input.preferredModel });
  },
});

const setPreferredProviderInputSchema = z.object({
  preferredProvider: providerPreferenceSchema,
});

const setPreferredProviderHandler = handler({
  name: "set-preferred-provider",
  inputSchema: setPreferredProviderInputSchema,
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ preferredProvider: input.preferredProvider });
  },
});

// ---------------------------------------------------------------------------
// Run sequencer
// ---------------------------------------------------------------------------

const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(applyFeatures)
  .tap(resolveModel)
  // FIX-421: up-front skill router. Decides activeSkills before the
  // generator runs; results land on `session.state.__activeSkills` for
  // the skills capability's active-skill formatter to render.
  .tap(intentSelectorBlock)
  .tap(resolveThinkingStyle)
  .then(thinkingStyleRouter)
  .work(biasCheck)
  .workIf(
    (ctx) => ctx.session.state.mode === "ask",
    (response: string) => ({ content: response }),
    analystPerspective.capture,
  )
  .work(mem.captureFromItems)
  .work(autoTitle)

  .tap(incrementRequestCount);

// ---------------------------------------------------------------------------
// Flow definition
// ---------------------------------------------------------------------------

const chatAgentFlow = defineFlow({
  kind: "chat-agent",
  requireUser: true,

  voice: {
    tts: {
      model: "tts-1",
      voice: "alloy",
    },
  },

  actions: {
    run: {
      inputSchema,
      block: runSequencer,
      userMessage: (input) => input.message,
    },
    saveArtifact: {
      inputSchema: updateArtifactInputSchema,
      block: updateArtifact,
    },
    setPreferredModel: {
      inputSchema: setPreferredModelInputSchema,
      block: setPreferredModelHandler,
    },
    setPreferredProvider: {
      inputSchema: setPreferredProviderInputSchema,
      block: setPreferredProviderHandler,
    },
    "event-queue": {
      inputSchema: eventQueueDemoInputSchema,
      block: eventQueueDemo,
    },
  },

  session: {
    stateSchema: sessionStateSchema,
    clientData: {
      modeStatus: (ctx) => ({
        currentMode: modeSchema.parse(ctx.state.mode ?? "ask"),
        thinkingStyle:
          (ctx.state.thinkingStyle as string | undefined) ?? null,
        resolvedModel:
          (ctx.state.resolvedModel as string | undefined) ?? null,
        requestCount: Number(ctx.state.requestCount ?? 0),
        features: ctx.state.features ?? { biasCheck: false, search: true, fetch: true, crawl: true },
      }),
    },
  },

  user: {
    stateSchema: userStateSchema,
    resources: mem.userResources,
    clientData: {
      preferences: (ctx) => ({
        displayName: String(ctx.state.displayName ?? "Developer"),
        preferredModel: String(ctx.state.preferredModel ?? MODEL_ID),
        preferredProvider: String(ctx.state.preferredProvider ?? ""),
      }),
    },
  },
});

const flow = chatAgentFlow({ id: "default" });

export default flow;
