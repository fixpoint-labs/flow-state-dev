/**
 * Kitchen Sink Flow
 *
 * A multi-modal AI assistant that demonstrates the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, clientData, and tool-use.
 *
 * What this flow does:
 *   A user sends a message with an optional mode ("chat" or "plan"). A router
 *   inspects session state to pick the right pipeline. The chat pipeline
 *   analyzes input, optionally enriches it with artifact context, calls an LLM
 *   generator with tool access to read/write artifacts, and tracks request
 *   counts. The plan pipeline adds planning instructions and includes a rescue
 *   fallback for errors.
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
 */
import {
  defineFlow,
  generator,
  handler,
  router,
  sequencer
} from "@flow-state-dev/core";
import { z } from "zod";
import {
  analyzeInput,
  analysisOutputSchema,
  formatReport,
  readArtifact,
  updateArtifact,
  updateArtifactInputSchema
} from "./blocks";
import {
  modeSchema,
  artifactResourceStateSchema
} from "./schemas";
import {
  rlmPipeline,
  contextResourceStateSchema
} from "@flow-state-dev/patterns";

const MODEL_ID = "gpt-5-mini";
// ---------------------------------------------------------------------------
// Flow-level schemas
// ---------------------------------------------------------------------------
// These define the "full picture" of state, resources, and clientData that
// the flow exposes to the runtime and to clients. Individual blocks only see
// the slices they declare.

const inputSchema = z.object({
  message: z.string().min(1),
  mode: modeSchema.default("chat"),
  context: z.string().optional()
});

// Session state lives for the duration of a session. Every block that reads
// or writes session state declares a partial schema of just the fields it
// uses; the flow-level schema is the union of all those slices.
const sessionStateSchema = z.object({
  mode: modeSchema.default("chat"),
  requestCount: z.number().default(0),
  lastAction: z.string().optional()
});

// User state persists across sessions for a given user.
const userStateSchema = z.object({
  displayName: z.string().default("Developer"),
  preferredModel: z.string().default(MODEL_ID)
});

// Generator outputs plain text — reasoning comes from the provider's native
// reasoning tokens, and artifact modifications are tracked deterministically
// via resource state (the update-artifact tool writes to session resources).

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

// Generator block: calls an LLM with structured output, tool access, and
// auto-repair. This is the main "AI" block in the flow.
//
// Key features demonstrated:
//   - userStateSchema: declares a partial user state slice ({ preferredModel })
//     so the model callback gets typed access without knowing the full schema
//   - tools: handler blocks exposed as LLM-callable functions
//   - describeTools: (default true) auto-injects tool descriptions into context
//   - Dynamic context: function-typed context entries are re-resolved before
//     each step of the tool loop via the AI SDK's prepareStep callback, so the
//     LLM always sees fresh state (e.g., an up-to-date artifact list)
//   - emit.reasoning: reasoning comes from the provider's native tokens, not
//     from asking the LLM to generate a reasoning field
//   - providerOptions: enables detailed reasoning summaries from OpenAI models
const agentGenerator = generator({
  name: "agent-generator",
  userStateSchema: z.object({ preferredModel: z.string().default(MODEL_ID) }),
  sessionResourceSchemas: z.object({ artifacts: artifactResourceStateSchema }),
  model: (_input, ctx) => ctx.user?.state.preferredModel ?? MODEL_ID,

  prompt: `You are a helpful development assistant. You help users create, read, and manage project artifacts.

When users ask you to create or write something, save it as an artifact using the update-artifact tool. Choose a short, descriptive id (kebab-case) and a clear title.

When users ask about existing artifacts, use the read-artifact tool to fetch the full content before responding.

Be concise and helpful. Never show the artifact id unless specifically asked to do so.`,

  context: [
    // Dynamic: current artifact list, re-evaluated each tool loop step so
    // the LLM sees artifacts created by earlier tool calls in the same turn.
    (_input, ctx) => {
      const artifacts = ctx.session.resources.artifacts;
      const state = artifacts?.state;
      if (!state?.order?.length) {
        return "No artifacts exist yet in this session.";
      }
      const list = state.order
        .map((id: string) => `- ${id}: ${state.byId[id]?.title ?? "Untitled"}`)
        .join("\n");
      return `Current artifacts:\n${list}`;
    }
  ],

  inputSchema: analysisOutputSchema,
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
  tools: [readArtifact, updateArtifact],
  maxIterations: 5,
  outputSchema: z.string(),
  emit: {
    messages: true,
    reasoning: true
  },
  providerOptions: {
    openai: { reasoningSummary: "detailed" }
  }
});

// Bookkeeping handler: increments a request counter in session state.
// This block declares only { requestCount, lastAction } — it doesn't know
// about the "mode" field, and it doesn't need to.
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

// Rescue fallback: runs when the plan pipeline throws.
// rescue() catches errors matching `when` predicates and routes to a fallback
// block, preventing the entire action from failing.
const planFallback = handler({
  name: "plan-fallback",
  inputSchema: z.unknown(),
  outputSchema: z.string(),
  execute: async () =>
    "Plan generation failed. Please try again with a simpler goal."
});

// ---------------------------------------------------------------------------
// Pipelines (sequencers)
// ---------------------------------------------------------------------------
// Sequencers compose blocks into linear pipelines. Each step's output feeds
// into the next step's input. The DSL methods:
//   .then(block)          — run a block
//   .thenIf(pred, block)  — run conditionally
//   .map(fn)              — transform the value without a block
//   .tap(fn)              — side-effect without changing the value
//   .rescue([...])        — catch errors and route to fallback blocks

const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .then(applyRequestedMode)
  .then(analyzeInput)
  .thenIf((result) => result.needsContext, formatReport)
  .then(agentGenerator)
  .then(incrementRequestCount)
  .tap(async (output) => {
    console.log(`Chat completed: ${output.slice(0, 50)}...`);
  });

const planPipeline = sequencer({ name: "plan-pipeline", inputSchema })
  .then(applyRequestedMode)
  .then(analyzeInput)
  .map((result) => ({
    ...result,
    instructions: "Create a step-by-step plan."
  }))
  .then(agentGenerator)
  .then(incrementRequestCount)
  .rescue([
    {
      when: [Error],
      block: planFallback
    }
  ]);

// RLM pipeline: reshapes the kitchen-sink input into what the patterns
// rlmPipeline expects ({ query, context }), then delegates to the RLM pattern.
const rlmRoute = sequencer({ name: "rlm-pipeline", inputSchema })
  .map((input) => ({
    query: input.message,
    context: input.context ?? "",
    model: MODEL_ID
  }))
  .then(rlmPipeline)
  .map((output) => output.answer);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
// Routers dispatch input to one of several pipelines at runtime. The execute
// callback inspects state (or input) and returns the chosen route. The routes
// array declares all valid targets — this enables static analysis and
// validation that the router can only reach known pipelines.

export const modeRouter = router({
  name: "mode-router",
  inputSchema: inputSchema,
  outputSchema: z.string(),
  sessionStateSchema: z.object({ mode: modeSchema.default("chat") }),
  routes: [chatPipeline, planPipeline, rlmRoute],
  execute: (input, ctx) => {
    const mode = ctx.session.state.mode ?? input.mode;
    if (mode === "rlm") return rlmRoute;
    return mode === "plan" ? planPipeline : chatPipeline;
  }
});

// ---------------------------------------------------------------------------
// Flow definition
// ---------------------------------------------------------------------------
// defineFlow() ties everything together: actions, state schemas, resources,
// and clientData. This is the entry point the server registers and clients
// connect to.
//
// The flow-level schemas are the "full picture" — they're the union of all
// partial schemas declared by individual blocks. The runtime uses them for
// validation and initialization.

const kitchenSinkFlow = defineFlow({
  kind: "kitchen-sink",
  requireUser: true,

  // Actions are the flow's public API — each maps a name to an input schema
  // and an entry-point block. Clients call actions by name.
  actions: {
    run: {
      inputSchema,
      block: modeRouter,
      userMessage: (input: z.infer<typeof inputSchema>) => input.message
    },
    saveArtifact: {
      inputSchema: updateArtifactInputSchema,
      block: updateArtifact
    }
  },

  // Session scope: state, resources, and clientData scoped to a session.
  session: {
    stateSchema: sessionStateSchema,

    // Resources are named, typed state containers that blocks can read/write.
    // They live alongside session state but have their own schemas and can
    // be independently writable.
    resources: {
      artifacts: {
        stateSchema: artifactResourceStateSchema,
        writable: true
      },
      context: {
        stateSchema: contextResourceStateSchema,
        writable: true
      }
    },

    // clientData entries are derived values computed from scope state and
    // resources, delivered to clients on every state snapshot request.
    // Each entry is a simple function: (ctx) => value.
    clientData: {
      artifactsList: (ctx) => {
        const artifacts = (ctx.resources as Record<string, { state: unknown }>).artifacts?.state as
          | { order: string[]; byId: Record<string, { id: string; title: string; content: string }> }
          | undefined;
        if (!artifacts?.order?.length) return [];
        return artifacts.order.map((id) => ({
          id,
          title: artifacts.byId[id]?.title ?? "Untitled",
          content: artifacts.byId[id]?.content ?? ""
        }));
      },
      artifactsDetail: (ctx) => {
        const artifacts = (ctx.resources as Record<string, { state: unknown }>).artifacts?.state as
          | { order: string[]; byId: Record<string, { id: string; title: string; content: string; updatedAt: number }> }
          | undefined;
        if (!artifacts?.order?.length) return [];
        return artifacts.order
          .map((id) => artifacts.byId[id])
          .filter((a): a is NonNullable<typeof a> => a !== undefined);
      },
      modeStatus: (ctx) => ({
        currentMode: modeSchema.parse(ctx.state.mode ?? "chat"),
        requestCount: Number(ctx.state.requestCount ?? 0)
      })
    }
  },

  // User scope: state and clientData that persist across sessions for a user.
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
