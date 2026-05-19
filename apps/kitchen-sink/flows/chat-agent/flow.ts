/**
 * chat-agent flow
 *
 * A multi-modal AI assistant demonstrating the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, clientData, and tool-use.
 *
 * Pipeline:
 *   applyRequestedMode → skillActivator → resolveThinkingStyle → thinkingStyleRouter
 *     ├─ default (or auto-classified default) → assistantGenerator (direct generation)
 *     ├─ plan-and-execute   → planAndExecute wrapping the assistant
 *     └─ supervisor         → supervisor wrapping the assistant
 *
 * `skillActivator` (FIX-421) decides which skills (if any) apply to the
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

import { system as memorySystem } from "@flow-state-dev/memory";
import { perspective, system as perspectiveSystem } from "@thought-fabric/core/identity";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import { responseAuditor } from "@flow-state-dev/patterns/response-auditor";
import { z } from "zod";
import {
  updateArtifact,
  taskQueueDemo,
  artifactListContext,
  voiceContext,
  createThinkingStyleRouter,
  autoClassifyStyle,
  thinkingStyleSchema,
  thinkingStyleInputSchema,
  thinkingStyleSessionStateSchema,
  featuresCapability,
  skillActivatorBlock,
  bashCap,
} from "./blocks";
import { modeSchema, featuresSchema } from "./schemas";
import { ASK_PROMPT, BUILD_PROMPT, INTERVIEW_PROMPT, DEBATE_PROMPT } from "./prompts";
import {
  KITCHEN_SINK_MODELS,
  DEFAULT_KITCHEN_SINK_MODEL,
} from "../../lib/models";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default model for internal generators (memory, perspective, summarizer,
 * auto-title). Internal generators are not user-controllable — they always
 * run on this concrete model. The user-facing chat generator reads the
 * user's `selectedModel` from user state instead.
 */
const MODEL_ID = DEFAULT_KITCHEN_SINK_MODEL;

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

const mem = memorySystem({
  model: MODEL_ID,
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
  // Enables the rolling-summary digest tier. Without this the unified
  // memory formatter has nothing to render in the system prompt's
  // <memory> section once working memory drifts past capacity. The digest
  // refreshes after consolidation/prune actually mutate the semantic store
  // (see `withDigestRegenerate`), not on every turn.
  digest: true,
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

const inputSchema = z.object({
  message: z.string().min(1),
  mode: modeSchema,
  thinkingStyle: thinkingStyleInputSchema,
  features: featuresSchema.default({}),
});

const sessionStateSchema = z.object({
  mode: modeSchema,
  thinkingStyle: thinkingStyleSchema.optional(),
  requestCount: z.number().default(0),
  lastAction: z.string().optional(),
  features: featuresSchema.default({}),
});

/**
 * Schema for the kitchen-sink model selector input. Only models that appear
 * in the catalog are accepted by `setSelectedModel`.
 */
const selectedModelSchema = z
  .enum(KITCHEN_SINK_MODELS)
  .default(DEFAULT_KITCHEN_SINK_MODEL);

const userStateSchema = z.object({
  displayName: z.string().default("Developer"),
  selectedModel: z.string().default(DEFAULT_KITCHEN_SINK_MODEL),
  thinkingEnabled: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Assistant generator — shared across all thinking styles
// ---------------------------------------------------------------------------

const assistantGenerator = generator({
  name: "assistant-generator",
  userStateSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("ask"), thinkingStyle: z.string().optional() }),

  // Capabilities: auto-install resources, context formatters, and tools.
  // mem.capability defaults: `digest`, `working`, `recall` all on — renders
  // the rolling digest + working-memory entries under <memory> and installs
  // the agent-invocable recall tool. Workers further down opt out of the
  // two context presets via `.presets({ digest: false, working: false })`.
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
  // `ctx.user` may be absent in test harnesses without a configured user
  // scope, so fall back to the catalog default rather than relying on the
  // Zod default alone.
  model: (_input: any, ctx: any) =>
    ctx.user?.state.selectedModel ?? DEFAULT_KITCHEN_SINK_MODEL,
  // Anthropic-only — OpenAI and Google ignore this namespace, so the toggle
  // is a no-op for non-Anthropic models until per-provider reasoning
  // mappings land (FIX-517).
  providerOptions: (_input: any, ctx: any) =>
    ctx.user?.state.thinkingEnabled
      ? { anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } } }
      : {},
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
  modelId: (_input: any, ctx: any) =>
    ctx.user?.state.selectedModel ?? DEFAULT_KITCHEN_SINK_MODEL,
  history: { limit: 8 },
  context: { memory: mem.contextFormatter, artifacts: artifactListContext },
  uses: [featuresCapability],
  // Worker generators in the supervisor / routed-specialists / evented-actors
  // pipelines disable the digest + working memory section presets so the
  // parent's memory blob isn't replicated into every worker prompt. The
  // recall tool stays installed (default-on `recall` preset) so workers can
  // still look up specifics on demand. workerContext drops the `memory` key
  // for the same reason — the formerly manual installation would otherwise
  // re-inject the formatter regardless of preset.
  workerUses: [
    featuresCapability,
  ],
  workerContext: { artifacts: artifactListContext },
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

/** Input for the `setSelectedModel` action. */
const setSelectedModelInputSchema = z.object({
  selectedModel: selectedModelSchema,
});

/** Persists the user's concrete-model selection to user state. */
const setSelectedModelHandler = handler({
  name: "set-selected-model",
  inputSchema: setSelectedModelInputSchema,
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ selectedModel: input.selectedModel });
  },
});

/** Input for the `setThinkingEnabled` action. */
const setThinkingEnabledInputSchema = z.object({
  thinkingEnabled: z.boolean(),
});

/** Persists the user's extended-thinking toggle to user state. */
const setThinkingEnabledHandler = handler({
  name: "set-thinking-enabled",
  inputSchema: setThinkingEnabledInputSchema,
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ thinkingEnabled: input.thinkingEnabled });
  },
});

// ---------------------------------------------------------------------------
// Run sequencer
// ---------------------------------------------------------------------------

const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(applyFeatures)
  // FIX-421: up-front skill router. Decides activeSkills before the
  // generator runs; results land on `session.state.activeSkills` for
  // the skills capability's active-skill formatter to render.
  .tap(skillActivatorBlock)
  .tap(resolveThinkingStyle)
  .then(thinkingStyleRouter)
  .work(biasCheck)
  .workIf(
    // Skip capture when the assistant produced no text (e.g. a turn that
    // ended in a tool call only). The perspective system already no-ops on
    // empty content, but gating here avoids dispatching a background block
    // we know has nothing to do.
    (response, ctx) =>
      ctx.session.state.mode === "ask" && response.length > 0,
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
      block: runSequencer,
      userMessage: (input) => input.message,
    },
    saveArtifact: {
      block: updateArtifact,
    },
    setSelectedModel: {
      block: setSelectedModelHandler,
    },
    setThinkingEnabled: {
      block: setThinkingEnabledHandler,
    },
    "task-queue": {
      block: taskQueueDemo,
    },
  },

  session: {
    stateSchema: sessionStateSchema,
    client: {
      derived: {
        modeStatus: (ctx) => {
          // `activeSkills` is contributed by the skills capability's
          // session-state schema (framework merges all schemas at flow
          // registration). Project to the surface shape the top-bar UI
          // wants — name + source tier, drop the rest.
          const activeSkills =
            (ctx.state as { activeSkills?: Array<{ name: string; source?: string }> })
              .activeSkills ?? [];
          return {
            currentMode: modeSchema.parse(ctx.state.mode ?? "ask"),
            thinkingStyle:
              (ctx.state.thinkingStyle as string | undefined) ?? null,
            requestCount: Number(ctx.state.requestCount ?? 0),
            features: ctx.state.features ?? { biasCheck: false, search: true, fetch: true, crawl: true },
            activeSkills: activeSkills.map((s) => ({
              name: s.name,
              source: s.source ?? "tool",
            })),
          };
        },
      },
    },
  },

  // FIX-435: resources live in a single flat flow.resources map; their
  // intrinsic scope routes them to the right storage layer.
  resources: { ...(mem.userResources ?? {}) },

  // Tear down the bash sandbox at request end. Required when the bash
  // provider is MOAT (otherwise containers accumulate across requests);
  // a no-op for `local` / `just-bash` / `vercel`. Wired unconditionally
  // so swapping the provider via env vars doesn't reintroduce a leak.
  request: { onFinished: bashCap.cleanupBlock },

  user: {
    stateSchema: userStateSchema,
    client: {
      derived: {
        preferences: (ctx) => ({
          displayName: ctx.state.displayName,
          selectedModel: ctx.state.selectedModel,
          thinkingEnabled: ctx.state.thinkingEnabled,
        }),
      },
    },
  },
});

const flow = chatAgentFlow({ id: "default" });

export default flow;
