/**
 * Kitchen Sink Flow
 *
 * A multi-modal AI assistant that demonstrates the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, projections, and tool-use.
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
 *   - Projections  — derived views over state, pushed to the client reactively
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
  updateArtifact
} from "./blocks";
import {
  modeSchema,
  artifactResourceStateSchema
} from "./schemas";

const MODEL_ID = "gpt-5-mini";
// ---------------------------------------------------------------------------
// Flow-level schemas
// ---------------------------------------------------------------------------
// These define the "full picture" of state, resources, and projections that
// the flow exposes to the runtime and to clients. Individual blocks only see
// the slices they declare.

const inputSchema = z.object({
  message: z.string().min(1),
  mode: modeSchema.default("chat")
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

// Projection output schemas — projections are derived views computed from
// state and resources, pushed to clients reactively. They decouple the
// client's view of state from the internal representation.
const artifactsListOutputSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string()
  })
);

const modeStatusOutputSchema = z.object({
  currentMode: modeSchema,
  requestCount: z.number()
});

const userPrefsOutputSchema = z.object({
  displayName: z.string(),
  preferredModel: z.string()
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
//   - emit.reasoning: reasoning comes from the provider's native tokens, not
//     from asking the LLM to generate a reasoning field
//   - providerOptions: enables detailed reasoning summaries from OpenAI models
const agentGenerator = generator({
  name: "agent-generator",
  userStateSchema: z.object({ preferredModel: z.string().default(MODEL_ID) }),
  model: (_input, ctx) => ctx.user?.state.preferredModel ?? MODEL_ID,
  prompt: "You are a development assistant that can read and modify project artifacts.",
  context: [
    "You are operating in the flow-state-dev kitchen-sink example.",
    "Available tools: read-artifact, update-artifact."
  ],
  inputSchema: analysisOutputSchema,
  user: (input) => input.message,
  tools: [readArtifact, updateArtifact],
  maxIterations: 2,
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
  routes: [chatPipeline, planPipeline],
  execute: (input, ctx) => {
    const mode = ctx.session.state.mode ?? input.mode;
    return mode === "plan" ? planPipeline : chatPipeline;
  }
});

// ---------------------------------------------------------------------------
// Flow definition
// ---------------------------------------------------------------------------
// defineFlow() ties everything together: actions, state schemas, resources,
// and projections. This is the entry point the server registers and clients
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
    }
  },

  // Session scope: state, resources, and projections scoped to a session.
  session: {
    stateSchema: sessionStateSchema,

    // Resources are named, typed state containers that blocks can read/write.
    // They live alongside session state but have their own schemas and can
    // be independently writable.
    resources: {
      artifacts: {
        stateSchema: artifactResourceStateSchema,
        writable: true
      }
    },

    // Projections are derived views computed from state and resources.
    // client: true means they're pushed to the client on every state change.
    projections: {
      artifactsList: {
        client: true,
        outputSchema: artifactsListOutputSchema,
        compute: (ctx) => {
          const artifacts = artifactResourceStateSchema.parse(
            ctx.session.resources.get("artifacts")?.state ?? {}
          );

          return artifacts.order.map((id) => ({
            id,
            title: artifacts.byId[id]?.title ?? "Untitled"
          }));
        }
      },
      modeStatus: {
        client: true,
        outputSchema: modeStatusOutputSchema,
        compute: (ctx) => ({
          currentMode: modeSchema.parse(ctx.session.state.mode ?? "chat"),
          requestCount: Number(ctx.session.state.requestCount ?? 0)
        })
      }
    }
  },

  // User scope: state and projections that persist across sessions for a user.
  user: {
    stateSchema: userStateSchema,
    projections: {
      preferences: {
        client: true,
        outputSchema: userPrefsOutputSchema,
        compute: (ctx) => ({
          displayName: String(ctx.user?.state.displayName ?? "Developer"),
          preferredModel: String(ctx.user?.state.preferredModel ?? MODEL_ID)
        })
      }
    }
  }
});

// Export schemas needed by client code
export {
  artifactsListOutputSchema,
  modeStatusOutputSchema,
  userPrefsOutputSchema
};

const flow = kitchenSinkFlow({ id: "default" });

export default flow;
