/**
 * Kitchen Sink Flow
 *
 * A multi-modal AI assistant demonstrating the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, clientData, and tool-use.
 *
 * Pipeline:
 *   applyRequestedMode → resolveThinkingStyle → thinkingStyleRouter
 *     ├─ chain-of-thought  → assistantGenerator (direct generation)
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
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { system as memorySystem } from "@thought-fabric/core/memory";
import { z } from "zod";
import {
  updateArtifact,
  updateArtifactInputSchema,
  eventQueueDemo,
  eventQueueDemoInputSchema,
  readArtifact,
  artifactListContext,
  voiceContext,
  createThinkingStyleRouter,
  autoClassifyStyle,
  thinkingStyleSchema,
  thinkingStyleSessionStateSchema,
} from "./blocks";
import { modeSchema, artifactResources } from "./schemas";
import { CHAT_PROMPT, CREATE_PROMPT } from "./prompts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_ID = "preset/fast";
const THINKING_MODEL_ID = "preset/thinking-small";

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
  .enum(["auto", "plan-and-execute", "supervisor", "chain-of-thought"])
  .default("auto");

const inputSchema = z.object({
  message: z.string().min(1),
  mode: modeSchema,
  thinkingStyle: thinkingStyleInputSchema,
});

const sessionStateSchema = z.object({
  mode: modeSchema,
  thinkingStyle: thinkingStyleSchema.optional(),
  requestCount: z.number().default(0),
  lastAction: z.string().optional(),
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
  model: (_input, ctx) => {
    const userModel = ctx.user?.state.preferredModel as string | undefined;
    if (userModel && userModel !== MODEL_ID) return userModel;
    const style = (ctx.session.state as Record<string, unknown>).thinkingStyle as string | undefined;
    return style === "chain-of-thought" ? THINKING_MODEL_ID : MODEL_ID;
  },
});

// ---------------------------------------------------------------------------
// Thinking style router (via factory — see blocks/thinking-styles.ts)
// ---------------------------------------------------------------------------

const { thinkingStyleRouter } = createThinkingStyleRouter({
  assistantGenerator,
  modelId: MODEL_ID,
  context: [mem.contextFormatter, artifactListContext] as any,
  tools: [readArtifact, updateArtifact],
  sessionResources: artifactResources,
});

export { thinkingStyleRouter };

// ---------------------------------------------------------------------------
// Inline blocks (small, flow-level concerns)
// ---------------------------------------------------------------------------

const applyRequestedMode = handler({
  name: "apply-requested-mode",
  inputSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("chat") }),
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
    (input, ctx) => (input.thinkingStyle !== "auto" && input.thinkingStyle !== ctx.session.state.thinkingStyle),
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

// ---------------------------------------------------------------------------
// Run sequencer
// ---------------------------------------------------------------------------

const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(resolveThinkingStyle)
  .then(thinkingStyleRouter)
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
