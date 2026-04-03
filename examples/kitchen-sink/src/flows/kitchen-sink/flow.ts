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
import { z } from "zod";
import {
  analyzeInput,
  analysisOutputSchema,
  formatReport,
  readArtifact,
  summarizeArtifacts,
  updateArtifact,
  updateArtifactInputSchema
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
// These define the "full picture" of state, resources, and clientData that
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
  sessionResources: {
    ...artifactResources
  },
  model: (_input, ctx) => ctx.user?.state.preferredModel ?? MODEL_ID,

  prompt: `You are a helpful development assistant. You help users create, read, and manage project artifacts.

When users ask you to create or write something, save it as an artifact using the update-artifact tool. Choose a short, descriptive id (kebab-case) and a clear title.

When users ask about existing artifacts, use the read-artifact tool to fetch the full content before responding.

When users ask questions that require up-to-date information, search the web to find relevant results.

Be concise and helpful. Never show the artifact id unless specifically asked to do so.`,

  context: [
    // Memory system: injects active memories (working + episodic) into the
    // LLM context, categorized as facts, current focus, and preferences.
    mem.contextFormatter,
    // Dynamic: current artifact list, re-evaluated each tool loop step so
    // the LLM sees artifacts created by earlier tool calls in the same turn.
    // Shows title + summary (populated by the background summarize-artifacts
    // work block) so the LLM has context without reading full content.
    (_input, ctx) => {
      const artifacts = ctx.session.resources.artifacts;
      const instances = artifacts.list();
      if (instances.length === 0) {
        return "No artifacts exist yet in this session.";
      }
      const list = instances
        .map((ref) => {
          const id = ref.name.replace("artifacts/", "");
          const title = ref.state.title ?? "Untitled";
          const summary = ref.state.summary ? ` — ${ref.state.summary}` : "";
          return `- ${id}: ${title}${summary}`;
        })
        .join("\n");
      return `Current artifacts:\n${list}`;
    },
    // Voice context: when TTS is active or the user spoke, tell the LLM
    // so it can adapt its output style (shorter sentences, no markdown
    // tables, no code blocks, conversational tone).
    (_input, ctx) => {
      const voice = ctx.requestRuntime?.metadata?.voice as
        | { ttsEnabled?: boolean; inputModality?: string }
        | undefined;
      if (!voice) return undefined;
      const parts: string[] = [];
      if (voice.ttsEnabled) {
        parts.push("Your response will be read aloud via text-to-speech. Keep sentences short and conversational. Avoid markdown formatting, tables, code blocks, and bullet lists — they sound bad when spoken.");
      }
      if (voice.inputModality === "speech") {
        parts.push("The user spoke this message (voice input). Respond conversationally.");
      }
      return parts.length > 0 ? parts.join(" ") : undefined;
    }
  ],

  inputSchema: analysisOutputSchema,
  history: (_input, ctx) => ctx.session.items.llm({ limit: 8 }),
  user: (input) => input.message,
  tools: [readArtifact, updateArtifact],
  search: true,
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

// Auto-generate a session title from recent conversation messages.
// Runs as background work — doesn't block the client response.
const autoTitle = utility.sessionTitleGenerator({
  name: "auto-title",
  model: MODEL_ID
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
  .work(autoTitle)
  // Background work: runs after the generator completes, non-blocking.
  // Memory capture reads session items to build working/episodic memory.
  // Artifact summarization generates summaries for any newly created/updated
  // artifacts so clientData and LLM context have useful previews.
  // Auto-title generates a session title from recent messages.
  .work(mem.captureFromItems)
  .work(summarizeArtifacts)  
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
  .work(mem.captureFromItems)
  .work(summarizeArtifacts)
  .work(autoTitle)
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
// and clientData. This is the entry point the server registers and clients
// connect to.
//
// The flow-level schemas are the "full picture" — they're the union of all
// partial schemas declared by individual blocks. The runtime uses them for
// validation and initialization.

const kitchenSinkFlow = defineFlow({
  kind: "kitchen-sink",
  requireUser: true,

  // Voice: enable TTS so assistant responses are synthesized to audio.
  // Uses OpenAI's tts-1 model — fast and widely available.
  voice: {
    tts: {
      model: "tts-1",
      voice: "alloy",
    },
  },

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
      ...artifactResources
    },

    // clientData entries are derived values computed from scope state and
    // resources, delivered to clients on every state snapshot request.
    // Each entry is a simple function: (ctx) => value.
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
