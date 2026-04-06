/**
 * Kitchen Sink Flow
 *
 * A multi-modal AI assistant that demonstrates the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, clientData, and tool-use.
 *
 * What this flow does:
 *   A user sends a message with an optional mode ("chat", "create", or "plan").
 *   A router inspects the input mode to pick the right pipeline. The assistant
 *   pipeline calls an LLM generator with tool access to read/write artifacts,
 *   where the prompt adapts to the current mode. The plan pipeline decomposes
 *   the goal into steps, executes them with web search, and synthesizes findings
 *   — optionally saving the result as an artifact.
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
  utility
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  system as memorySystem
} from "@thought-fabric/core/memory";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
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
  thinkingRouter,
  thinkingStyleSchema,
  thinkingStyleSessionStateSchema,
} from "./blocks";
import {
  modeSchema,
  artifactResources,
} from "./schemas";

const MODEL_ID = "openai/gpt-5.4-mini";

// Unified memory system: working memory + user-scoped episodic + semantic memory.
// Provides a single capture pipeline, cross-store recall, and context formatter.
// Semantic memory distills repeated episodic experiences into stable knowledge
// (facts, preferences, patterns) via LLM-based consolidation.
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

// Session state lives for the duration of a session. Every block that reads
// or writes session state declares a partial schema of just the fields it
// uses; the flow-level schema is the union of all those slices.
const sessionStateSchema = z.object({
  mode: modeSchema,
  thinkingStyle: thinkingStyleSchema.optional(),
  requestCount: z.number().default(0),
  lastAction: z.string().optional()
});

// User state persists across sessions for a given user.
const userStateSchema = z.object({
  displayName: z.string().default("Developer"),
  preferredModel: z.string().default(MODEL_ID)
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

// Writes the requested mode into session state before the pipeline continues.
// This is a passthrough handler — it returns its input unchanged, but has a
// side-effect (state mutation). Silent by default (no client/LLM emissions).
const applyRequestedMode = handler({
  name: "apply-requested-mode",
  inputSchema: inputSchema,
  outputSchema: inputSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("chat") }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ mode: input.mode });
    return input;
  }
});

// When the user manually selects a thinking style (not "auto"), write it
// directly into session state. When "auto" is selected, the thinkingRouter
// block will resolve the style instead.
const applyThinkingStyle = handler({
  name: "apply-thinking-style",
  inputSchema,
  outputSchema: inputSchema,
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    if (input.thinkingStyle !== "auto") {
      await ctx.session.patchState({ thinkingStyle: input.thinkingStyle });
    }
    return input;
  }
});

// Bookkeeping handler: increments a request counter in session state.
// Silent by default — no client or LLM emissions.
const incrementRequestCount = handler({
  name: "increment-request-count",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({
    requestCount: z.number().default(0),
    lastAction: z.string().optional()
  }),
  execute: async (input, ctx) => {
    const count = ctx.session.state.requestCount ?? 0;
    await ctx.session.patchState({
      requestCount: count + 1,
      lastAction: "run"
    });
    return input;
  }
});

// Auto-generate a session title from recent conversation messages.
// Runs as background work — doesn't block the client response.
const autoTitle = utility.sessionTitleGenerator({
  name: "auto-title",
  model: MODEL_ID
});

// Assistant generator — single block for both chat and create modes.
// The prompt is a function so it re-evaluates on each tool loop step,
// picking the right behavioral contract from session state.
const assistantGenerator = generator({
  name: "assistant-generator",
  model: (_input, ctx) => (ctx.user?.state.preferredModel as string | undefined) ?? MODEL_ID,
  userStateSchema: z.object({ preferredModel: z.string().default(MODEL_ID) }),
  sessionStateSchema: z.object({ mode: modeSchema.default("chat") }),
  sessionResources: artifactResources,

  context: [
    mem.contextFormatter,
    artifactListContext,
    voiceContext,
  ] as any[],

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
  providerOptions: { openai: { reasoningSummary: "detailed" } },
});

// ---------------------------------------------------------------------------
// Pipelines (sequencers)
// ---------------------------------------------------------------------------

// Single pipeline for chat and create — the generator's prompt adapts to mode.
const assistantPipeline = sequencer({ name: "assistant-pipeline", inputSchema })
  .then(assistantGenerator)
  .work(mem.captureFromItems);

const planMode = planAndExecute({
  name: "plan-mode",
  model: MODEL_ID,
  context: [mem.contextFormatter, artifactListContext] as any,
  search: true,
  tools: [readArtifact, updateArtifact],
  sessionResources: artifactResources,
  enableReplanning: true,
}).work(mem.captureFromItems);

const planPipeline = sequencer({ name: "plan-pipeline", inputSchema })
  .map((input) => ({ goal: input.message }))
  .then(planMode);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const modeRouter = router({
  name: "mode-router",
  inputSchema: inputSchema,
  outputSchema: z.string(),
  routes: [assistantPipeline, planPipeline],
  execute: (input) => input.mode === "plan" ? planPipeline : assistantPipeline,
});

// Conditionally runs the thinking router when "auto" is selected.
// Wraps the router so the pipeline value (full input) passes through unchanged.
const autoThinkingStyleRouter = handler({
  name: "auto-thinking-style-router",
  inputSchema,
  outputSchema: inputSchema,
  execute: async (input, ctx) => {
    if (input.thinkingStyle === "auto") {
      await thinkingRouter.run({ message: input.message }, ctx);
    }
    return input;
  }
});

// Top-level run sequencer: handles steps common to all modes.
const runSequencer = sequencer({ name: "run", inputSchema })
  .then(applyRequestedMode)
  .then(applyThinkingStyle)
  .then(autoThinkingStyleRouter)
  .then(modeRouter)
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
      userMessage: (input) => input.message
    },
    saveArtifact: {
      inputSchema: updateArtifactInputSchema,
      block: updateArtifact
    },
    "event-queue": {
      inputSchema: eventQueueDemoInputSchema,
      block: eventQueueDemo
    },
  },

  session: {
    stateSchema: sessionStateSchema,
    resources: artifactResources,
    clientData: {
      artifacts: async (ctx) => {
        const artifacts = ctx.resources.artifacts as unknown as ResourceCollectionRef<{ title: string; summary: string; updatedAt: number }>;
        const instances = artifacts.list();
        return Promise.all(instances.map(async (ref) => {
          const content = await ref.readContent() ?? "";
          return {
            id: ref.name.replace("artifacts/", ""),
            title: ref.state.title ?? "Untitled",
            summary: ref.state.summary ?? "",
            content,
            updatedAt: ref.state.updatedAt
          };
        }));
      },
      modeStatus: (ctx) => ({
        currentMode: modeSchema.parse(ctx.state.mode ?? "chat"),
        thinkingStyle: (ctx.state.thinkingStyle as string | undefined) ?? undefined,
        requestCount: Number(ctx.state.requestCount ?? 0)
      })
    }
  },

  user: {
    stateSchema: userStateSchema,
    clientData: {
      preferences: (ctx) => ({
        displayName: String(ctx.state.displayName ?? "Developer"),
        preferredModel: String(ctx.state.preferredModel ?? MODEL_ID)
      })
    }
  }
});

const flow = kitchenSinkFlow({ id: "default" });

export default flow;
