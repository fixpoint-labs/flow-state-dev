/**
 * Kitchen Sink Flow
 *
 * A multi-modal AI assistant demonstrating the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, clientData, and tool-use.
 *
 * Pipeline:
 *   applyRequestedMode → resolveThinkingStyle → thinkingStyleRouter
 *     ├─ default (or auto-classified default) → assistantGenerator (direct generation)
 *     ├─ plan-and-execute   → planAndExecute wrapping the assistant
 *     └─ supervisor         → supervisor wrapping the assistant
 */
import {
  defineFlow,
  generator,
  handler,
  sequencer,
  utility,
} from "@flow-state-dev/core";

import { system as memorySystem } from "@thought-fabric/core/memory";
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
  artifactResources,
} from "./blocks";
import { modeSchema, featuresSchema } from "./schemas";
import { ASK_PROMPT, BUILD_PROMPT } from "./prompts";

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

const userStateSchema = z.object({
  displayName: z.string().default("Developer"),
  preferredModel: z.string().default(MODEL_ID),
});

// ---------------------------------------------------------------------------
// Assistant generator — shared across all thinking styles
// ---------------------------------------------------------------------------

const assistantGenerator = generator({
  name: "assistant-generator",
  userStateSchema: z.object({ preferredModel: z.string().default(MODEL_ID) }),
  sessionStateSchema: z.object({ mode: modeSchema.default("ask"), thinkingStyle: z.string().optional() }),

  // Capabilities: auto-install resources, context formatters, and tools.
  // mem.capability includes a context preset that injects unified memory recall.
  // artifactsCapability provides artifact resources + context + tools.
  uses: [mem.capability, featuresCapability],

  context: [voiceContext],

  inputSchema,
  history: { limit: 8 },
  user: (input) => input.message,
  search: true,
  maxIterations: 20,
  outputSchema: z.string(),

  prompt: (_input, ctx) =>
    ctx.session.state.mode === "build" ? BUILD_PROMPT : ASK_PROMPT,

  emit: { messages: true, reasoning: true },
  model: (_input: any, ctx: any) => ctx.session.state.resolvedModel ?? MODEL_ID,
});

// ---------------------------------------------------------------------------
// Thinking style router (via factory — see blocks/thinking-styles.ts)
// ---------------------------------------------------------------------------

const { thinkingStyleRouter } = createThinkingStyleRouter({
  assistantGenerator,
  modelId: (_input: any, ctx: any) => ctx.session.state.resolvedModel ?? MODEL_ID,
  history: { limit: 8 },
  context: [mem.contextFormatter, artifactListContext],
  uses: [featuresCapability],
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
    const resolved = ctx.resolveModel.resolveId(preferred);
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

const biasCheck = sequencer({ name: "bias-check", inputSchema: z.string() })
  .map((aiResponse: string, ctx) => ({
    userInput: String(
      (ctx.parent?.input as Record<string, unknown>)?.message ?? "",
    ),
    response: aiResponse,
  }))
  .thenIf(
    (_input, ctx) =>
      Boolean(
        (ctx.session?.state as Record<string, unknown>)?.features &&
          (
            (ctx.session?.state as Record<string, unknown>)
              ?.features as Record<string, unknown>
          )?.biasCheck,
      ),
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

// ---------------------------------------------------------------------------
// Run sequencer
// ---------------------------------------------------------------------------

const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(applyFeatures)
  .tap(resolveModel)
  .tap(resolveThinkingStyle)
  .then(thinkingStyleRouter)
  .work(biasCheck)
  .work(mem.captureFromItems)
  .work(autoTitle)

  .tap(incrementRequestCount);

// ---------------------------------------------------------------------------
// Flow definition
// ---------------------------------------------------------------------------

const kitchenSinkFlow = defineFlow({
  kind: "kitchen-sink",
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
    "event-queue": {
      inputSchema: eventQueueDemoInputSchema,
      block: eventQueueDemo,
    },
  },

  session: {
    stateSchema: sessionStateSchema,
    resources: { ...artifactResources, ...mem.sessionResources },
    clientData: {
      modeStatus: (ctx) => ({
        currentMode: modeSchema.parse(ctx.state.mode ?? "ask"),
        thinkingStyle:
          (ctx.state.thinkingStyle as string | undefined) ?? null,
        resolvedModel:
          (ctx.state.resolvedModel as string | undefined) ?? null,
        requestCount: Number(ctx.state.requestCount ?? 0),
        features: ctx.state.features ?? { biasCheck: false, bashTool: true, search: true, fetch: true, crawl: true },
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
      }),
    },
  },
});

const flow = kitchenSinkFlow({ id: "default" });

export default flow;
