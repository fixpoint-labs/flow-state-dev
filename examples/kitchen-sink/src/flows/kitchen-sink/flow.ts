/**
 * Kitchen Sink Flow
 *
 * A multi-modal AI assistant that demonstrates the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, clientData, and tool-use.
 *
 * Architecture:
 *   Mode (chat | create) controls the assistant's behavioral prompt.
 *   Thinking style (chain-of-thought | plan-and-execute | supervisor)
 *   controls *how* the assistant executes — orthogonal to mode.
 *
 *   When thinking style is "auto", a two-tier detector (keyword heuristics
 *   then LLM classifier) resolves it before execution.
 *
 * Pipeline:
 *   applyRequestedMode → resolveThinkingStyle → thinkingStyleRouter
 *     ├─ chain-of-thought  → assistantPipeline (direct generation)
 *     ├─ plan-and-execute   → planAndExecute wrapping the assistant
 *     └─ supervisor         → supervisor wrapping the assistant
 *
 * Concepts demonstrated:
 *   - handler()   — synchronous blocks for data transforms and state mutations
 *   - generator() — LLM-backed blocks with structured output, tools, and repair
 *   - router()    — dynamic dispatch to different pipelines based on state
 *   - sequencer() — composing blocks into pipelines with .then/.thenIf/.map/.tap/.rescue
 *   - Partial state schemas — each block declares only the state it needs
 *   - Resources   — named, typed state containers (artifacts) scoped to a session
 *   - clientData  — derived client-facing values computed from scope state and resources
 *   - Emission API — blocks emit items explicitly via ctx.emitMessage(), ctx.emitComponent(), etc.
 *   - Unified memory — working + episodic + semantic memory via @thought-fabric/core's memory.system()
 */
import {
  defineFlow,
  generator,
  handler,
  router,
  sequencer,
  utility,
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  system as memorySystem,
} from "@thought-fabric/core/memory";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import { supervisor } from "@flow-state-dev/patterns/supervisor";
import { z } from "zod";
import {
  summarizeArtifacts,
  updateArtifact,
  updateArtifactInputSchema,
  eventQueueDemo,
  eventQueueDemoInputSchema,
  readArtifact,
  artifactListContext,
  voiceContext,
  autoClassifyStyle,
  thinkingStyleSchema,
  thinkingStyleSessionStateSchema,
} from "./blocks";
import {
  modeSchema,
  artifactResources,
} from "./schemas";

const MODEL_ID = "preset/fast";
const THINKING_MODEL_ID = "preset/balanced";

// Unified memory system: working memory + user-scoped episodic + semantic memory.
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
  .enum(["auto", "plan-and-execute", "supervisor", "chain-of-thought"])
  .default("auto");

const inputSchema = z.object({
  message: z.string().min(1),
  mode: modeSchema,
  thinkingStyle: thinkingStyleInputSchema,
});

// Session state: union of all partial schemas across blocks.
const sessionStateSchema = z.object({
  mode: modeSchema,
  thinkingStyle: thinkingStyleSchema.optional(),
  requestCount: z.number().default(0),
  lastAction: z.string().optional(),
});

// User state persists across sessions for a given user.
const userStateSchema = z.object({
  displayName: z.string().default("Developer"),
  preferredModel: z.string().default(MODEL_ID),
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const CHAT_PROMPT = `You are a helpful development assistant. You help users with tasks, answer questions, and search for information.

You have access to artifacts and can read or create them:
- Use read-artifact when users ask about existing artifacts or you need their content.
- Use update-artifact when users explicitly ask you to create or save something.

When users ask questions that require up-to-date information, use search.

Be concise and focused on being useful. Create artifacts when asked — not speculatively.
Never show artifact ids unless specifically asked.`;

const CREATE_PROMPT = `You are a creative development assistant. Your primary role is building artifacts.

When the user asks for anything that could be expressed as an artifact — code, documentation, a spec, a plan, a report, a list — create it immediately using update-artifact. Choose a descriptive id (kebab-case) and a clear title.

Prefer building over explaining. If you can produce a concrete artifact, do so rather than describing what you would build.

When users ask questions, answer them — but look for opportunities to produce something tangible. If an existing artifact is relevant, read it first with read-artifact before updating or building on it.

Never show artifact ids unless specifically asked.`;

// ---------------------------------------------------------------------------
// Blocks (inline)
// ---------------------------------------------------------------------------

// Writes the requested mode into session state.
const applyRequestedMode = handler({
  name: "apply-requested-mode",
  inputSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("chat") }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ mode: input.mode });
  },
});

// Resolves thinking style: applies manual selection (with diff check) or
// runs keyword + LLM auto-classification as a side effect when style is "auto".
const resolveThinkingStyle = sequencer({
  name: "resolve-thinking-style",
  inputSchema,
  outputSchema: z.never(),
})
  .tapIf((input, ctx) => (input.thinkingStyle !== "auto" && input.thinkingStyle !== ctx.session.state.thinkingStyle),
    handler({
      name: "apply-manual-style",
      inputSchema,
      sessionStateSchema: thinkingStyleSessionStateSchema,
      execute: async (input, ctx) => {
        await ctx.session.patchState({ thinkingStyle: input.thinkingStyle });
      },
    }),
  )
  .tapIf(
    (input) => input.thinkingStyle === "auto",
    autoClassifyStyle,
  );

// Bookkeeping handler: increments a request counter in session state.
const incrementRequestCount = handler({
  name: "increment-request-count",
  sessionStateSchema: z.object({
    requestCount: z.number().default(0),
    lastAction: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    const count = ctx.session.state.requestCount ?? 0;
    await ctx.session.patchState({
      requestCount: count + 1,
      lastAction: "run",
    });
  },
});

// Auto-generate a session title from recent conversation messages.
const autoTitle = utility.sessionTitleGenerator({
  name: "auto-title",
  model: MODEL_ID,
});

// ---------------------------------------------------------------------------
// Assistant generator — shared across all thinking styles
//
// The prompt adapts to mode (chat/create). Thinking style changes which
// *pipeline* this generator is embedded in, not the generator itself.
// ---------------------------------------------------------------------------

const assistantGenerator = generator({
  name: "assistant-generator",
  model: (_input, ctx) => {
    const userModel = ctx.user?.state.preferredModel as string | undefined;
    if (userModel && userModel !== MODEL_ID) return userModel;
    const style = (ctx.session.state as Record<string, unknown>).thinkingStyle as string | undefined;
    return style === "chain-of-thought" ? THINKING_MODEL_ID : MODEL_ID;
  },
  userStateSchema: z.object({ preferredModel: z.string().default(MODEL_ID) }),
  sessionStateSchema: z.object({ mode: modeSchema.default("chat"), thinkingStyle: z.string().optional() }),
  sessionResources: artifactResources,

  context: [mem.contextFormatter, artifactListContext, voiceContext] as any[],

  inputSchema,
  history: (_input, ctx) => ctx.session.items.llm({ limit: 8 }),
  user: (input) => input.message,

  tools: [readArtifact, updateArtifact],
  search: true,
  maxIterations: 10,
  outputSchema: z.string(),

  prompt: (_input, ctx) =>
    ctx.session.state.mode === "create" ? CREATE_PROMPT : CHAT_PROMPT,

  emit: { messages: true, reasoning: true },
  providerOptions: (_, ctx) => {
    const style = ctx.session.state.thinkingStyle as string | undefined;
    if (style !== "chain-of-thought") return {};
    return {
      openai: { reasoningSummary: "detailed" },
      anthropic: { thinking: { budgetTokens: 10000 } },
    };
  },
});

// ---------------------------------------------------------------------------
// Thinking Style Pipelines
// ---------------------------------------------------------------------------

// Chain of Thought — direct generation. The simplest path.
const cotPipeline = assistantGenerator;

// Plan and Execute — decomposes the message into steps, executes them,
// then synthesizes findings. Uses the same tools/context as the assistant.
const paePipeline = sequencer({ name: "pae-pipeline", inputSchema })
  .map((input) => ({ goal: input.message }))
  .then(
    planAndExecute({
      name: "pae-thinking",
      model: MODEL_ID,
      context: [mem.contextFormatter, artifactListContext] as any,
      search: true,
      tools: [readArtifact, updateArtifact],
      sessionResources: artifactResources,
      enableReplanning: true,
    })
  )

// Supervisor — plan → dispatch workers → review → replan loop.
// The worker adapts the supervisor's { id, goal } input to the assistant generator.
const supervisorWorker = assistantGenerator.connectInput(
  (input: { id: string; goal: string; feedback?: string }) => ({
    message: input.feedback
      ? `${input.goal}\n\nPrevious feedback: ${input.feedback}`
      : input.goal,
    mode: "chat" as const,
    thinkingStyle: "chain-of-thought" as const,
  }),
);

const supervisorPipeline = sequencer({
  name: "supervisor-pipeline",
  inputSchema,
})
  .map((input) => ({ goal: input.message }))
  .then(
    supervisor({
      name: "supervisor-thinking",
      worker: supervisorWorker,
      maxIterations: 3,
      maxConcurrency: 3,
      onSubTaskError: "skip",
    })
  )

// ---------------------------------------------------------------------------
// Thinking Style Router — proper router() block
// ---------------------------------------------------------------------------

export const thinkingStyleRouter = router({
  name: "thinking-style-router",
  inputSchema,
  outputSchema: z.string(),
  routes: [cotPipeline, paePipeline, supervisorPipeline],
  execute: (_input, ctx) => {
    const style = ctx.session.state.thinkingStyle as string | undefined;
    switch (style) {
      case "plan-and-execute":
        return paePipeline;
      case "supervisor":
        return supervisorPipeline;
      default:
        return cotPipeline;
    }
  },
});

// ---------------------------------------------------------------------------
// Top-level run sequencer
// ---------------------------------------------------------------------------

const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(resolveThinkingStyle)
  .then(thinkingStyleRouter)
  .work(mem.captureFromItems)
  .work(autoTitle)
  .work(summarizeArtifacts)
  .then(incrementRequestCount);

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
    "event-queue": {
      inputSchema: eventQueueDemoInputSchema,
      block: eventQueueDemo,
    },
  },

  session: {
    stateSchema: sessionStateSchema,
    resources: { ...artifactResources, ...mem.sessionResources },
    clientData: {
      artifacts: async (ctx) => {
        const artifacts = ctx.resources.artifacts as unknown as ResourceCollectionRef<{
          title: string;
          summary: string;
          updatedAt: number;
        }>;
        const instances = artifacts.list();
        return Promise.all(
          instances.map(async (ref) => {
            const content = (await ref.readContent()) ?? "";
            return {
              id: ref.name.replace("artifacts/", ""),
              title: ref.state.title ?? "Untitled",
              summary: ref.state.summary ?? "",
              content,
              updatedAt: ref.state.updatedAt,
            };
          }),
        );
      },
      modeStatus: (ctx) => ({
        currentMode: modeSchema.parse(ctx.state.mode ?? "chat"),
        thinkingStyle:
          (ctx.state.thinkingStyle as string | undefined) ?? null,
        requestCount: Number(ctx.state.requestCount ?? 0),
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
