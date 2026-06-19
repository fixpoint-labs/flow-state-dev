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
  SuspensionRejectedError,
  utility,
} from "@flow-state-dev/core";

import { system as memorySystem } from "@flow-state-dev/memory";
import { perspective, system as perspectiveSystem } from "@thought-fabric/core/identity";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import { AnalyzerResultSchema, responseAuditor } from "@flow-state-dev/patterns/response-auditor";
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
  context: { 
    todaysDate: new Date().toLocaleDateString(),
    voice: voiceContext
  },

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

  itemVisibility: { client: true, history: true },
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
  // responseAuditor collects each analyzer's output as an AnalyzerResult.
  // The terminal `.map` below hand-builds that shape; declaring it here
  // makes the sequencer's runtime exit gate reject any drift (e.g. a score
  // outside [0,1], or a renamed field) before it reaches the auditor.
  outputSchema: AnalyzerResultSchema,
})
  .map((input: { userInput: string; response: string }) => ({
    userInput: input.userInput,
    aiResponse: input.response,
  }))
  .step(biasAnalyzer({ model: MODEL_ID }))
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
  .stepIf(
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
// Durable human-in-the-loop approval gate (FIX-140 / FIX-141 / FIX-811 demo)
// ---------------------------------------------------------------------------
//
// A durable action that pauses for a human decision and showcases how a
// same-request continuation resumes. The pipeline is intentionally multi-step
// so the resume semantics are visible end to end:
//
//   prepareApproval  .step    — runs ONCE; on resume it is replayed (injected
//                               from the durable log, NOT re-executed), so the
//                               approvalId it mints stays identical across the
//                               suspend/resume boundary and its message is not
//                               re-emitted.
//   approvalGate     .step    — emits the prompt and calls ctx.suspend(); this
//                               is the block that re-runs on resume. Returns a
//                               structured decision so the sequencer can branch.
//   executeApproved  .tapIf   — post-approval work; runs ONLY when approved.
//   finalizeApproved .tapIf   — more post-approval work, to show the pipeline
//                               continuing in depth past the gate.
//   recordRejection  .tapIf   — runs ONLY when rejected; the post-approval
//                               blocks above are skipped.
//
// The branch blocks are `.tapIf` (side-effect/emit only) rather than `.stepIf`
// so they don't rewrite the threaded value — every branch condition reads the
// same gate decision (BP-015: conditional step variants, no wrapper sequencer).
// Kept off the main `run` pipeline so ordinary chat turns stay transient.

const approvalGateInputSchema = z.object({
  /** Human-readable description of the action awaiting approval. */
  request: z.string().min(1),
});

/** Optional note the operator can attach when resolving from the DevTool. */
const approvalResumeSchema = z.object({
  note: z.string().optional(),
});

/** Output of `prepareApproval`, threaded through the gate and branch steps. */
const preparedApprovalSchema = z.object({
  request: z.string(),
  /**
   * Id minted once, before the gate. On resume `prepareApproval` is injected
   * from the log (not re-run), so this stays identical across suspend/resume —
   * the visible proof that completed blocks don't re-execute on continuation.
   */
  approvalId: z.string(),
});

/** The gate's decision, threaded to the branch steps. */
const approvalDecisionSchema = preparedApprovalSchema.extend({
  approved: z.boolean(),
  note: z.string().nullable(),
});

// Pre-suspension step. Mints a stable approval id and announces the request.
// Replayed (not re-run) on resume — see the section header.
const prepareApproval = handler({
  name: "prepare-approval",
  inputSchema: approvalGateInputSchema,
  outputSchema: preparedApprovalSchema,
  execute: async (input, ctx) => {
    const approvalId = `appr_${crypto.randomUUID().slice(0, 8)}`;
    ctx.emit.message(`Preparing approval ${approvalId} for: "${input.request}"`);
    return { request: input.request, approvalId };
  },
});

const approvalGateStep = handler({
  name: "approval-gate",
  inputSchema: preparedApprovalSchema,
  outputSchema: approvalDecisionSchema,
  execute: async (input, ctx) => {
    // `ctx.suspend` is only present in a durable action running inside a
    // sequencer. On first run it throws a SuspensionError the sequencer catches
    // at this step boundary. On resume the operator's *action* decides the
    // outcome: "approve" makes ctx.suspend RETURN the resume data; "reject"
    // makes it THROW SuspensionRejectedError. Reaching past ctx.suspend means
    // approved — return a structured decision so the sequencer can branch.
    //
    // Emit the prompt directly — do NOT wrap it in ctx.runOnce. On resume the
    // gate re-runs from the top and re-emits this; the canonical item-log view
    // (collapseToCanonicalLog) drops the superseded run-1 copy so history /
    // useSession / the DevTool stream show it once. runOnce is for *awaited*
    // side effects (e.g. "charge the card once"), not emits.
    try {
      ctx.emit.message(`Approval ${input.approvalId} requested: "${input.request}"`);
      const data = (await ctx.suspend!({
        reason: "human_approval",
        message: `Approve action: "${input.request}"?`,
        resumeSchema: approvalResumeSchema,
      })) as z.infer<typeof approvalResumeSchema> | undefined;
      return { ...input, approved: true, note: data?.note ?? null };
    } catch (err) {
      if (err instanceof SuspensionRejectedError) {
        const note = (err.rejectionData as { note?: string } | undefined)?.note;
        return { ...input, approved: false, note: note ?? null };
      }
      throw err;
    }
  },
});

// Post-approval work — runs ONLY when approved. Emit-only, so `.tapIf` keeps the
// gate decision threaded for the later branch conditions.
const executeApproved = handler({
  name: "execute-approved",
  inputSchema: approvalDecisionSchema,
  execute: async (input, ctx) => {
    ctx.emit.message(
      `Executing approved action ${input.approvalId}: "${input.request}"…`
    );
  },
});

const finalizeApproved = handler({
  name: "finalize-approved",
  inputSchema: approvalDecisionSchema,
  execute: async (input, ctx) => {
    ctx.emit.message(
      `Done. "${input.request}" completed${input.note ? ` — ${input.note}` : ""} (approval ${input.approvalId}).`
    );
  },
});

// Rejection branch — runs ONLY when rejected. The post-approval blocks are
// skipped entirely.
const recordRejection = handler({
  name: "record-rejection",
  inputSchema: approvalDecisionSchema,
  execute: async (input, ctx) => {
    ctx.emit.message(
      `Rejected${input.note ? ` — ${input.note}` : ""}. "${input.request}" was not performed (approval ${input.approvalId}).`
    );
  },
});

// Exported (with its input schema) so the durable resume / approve-vs-reject
// branching can be driven in a focused test against the real runtime.
export const approvalGateInput = approvalGateInputSchema;
export const approvalGate = sequencer({
  name: "approval-gate-seq",
  inputSchema: approvalGateInputSchema,
  durable: true,
})
  .step(prepareApproval)
  .step(approvalGateStep)
  .tapIf((decision) => decision.approved, executeApproved)
  .tapIf((decision) => decision.approved, finalizeApproved)
  .tapIf((decision) => !decision.approved, recordRejection);

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
  .step(thinkingStyleRouter)
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
    // Durable HITL action: suspends for human approval, resolvable from the
    // DevTool Suspensions tab. `durable: true` makes ctx.suspend() available
    // and enables checkpoint-based resume (requires `durable: true` on the
    // FlowState runtime — see lib/flowstate.ts).
    requestApproval: {
      block: approvalGate,
      durable: true,
      userMessage: (input) => `Requesting approval: ${input.request}`,
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
            (ctx.state as {
              activeSkills?: Array<{ name: string; source?: string; mode?: string }>;
            }).activeSkills ?? [];
          return {
            currentMode: modeSchema.parse(ctx.state.mode ?? "ask"),
            thinkingStyle:
              (ctx.state.thinkingStyle as string | undefined) ?? null,
            requestCount: Number(ctx.state.requestCount ?? 0),
            features: ctx.state.features ?? { biasCheck: false, search: true, fetch: true, crawl: true },
            activeSkills: activeSkills.map((s) => ({
              name: s.name,
              source: s.source ?? "tool",
              ...(s.mode !== undefined ? { mode: s.mode } : {}),
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
