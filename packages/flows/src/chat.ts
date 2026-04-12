/**
 * chatFlow — Multi-turn conversational agent.
 *
 * A full-featured chat flow with conversation history, model selection via
 * user preference, capability support (memory, artifacts, etc.), tools,
 * search, and voice. Includes a built-in `setPreferredModel` action so
 * users can switch models at runtime.
 *
 * @example
 * ```ts
 * import { chatFlow } from "@flow-state-dev/flows";
 *
 * // Minimal — works with zero config
 * const flow = chatFlow()({ id: "my-chat" });
 *
 * // With memory and model selection
 * import { memory } from "@thought-fabric/core";
 *
 * const mem = memory.system({ model: "openai/gpt-4o-mini", working: true });
 *
 * const flow = chatFlow({
 *   model: "openai/gpt-4o",
 *   prompt: "You are a coding assistant.",
 *   tools: [searchTool],
 *   uses: [mem.capability],
 *   context: [mem.contextFormatter],
 * })({ id: "code-chat" });
 * ```
 */
import {
  defineFlow,
  generator,
  handler,
  selectModel,
  sequencer,
} from "@flow-state-dev/core";
import type {
  CapabilityRef,
  FlowType,
  GeneratorSearchConfig,
  GeneratorSlotEntry,
  GeneratorTool,
  VoiceConfig,
} from "@flow-state-dev/core";

import {
  DEFAULT_MODEL,
  chatInputSchema,
  messageCountStateSchema,
  setPreferredModelInputSchema,
  preferredModelUserStateSchema,
} from "./shared";

/** Configuration options for {@link chatFlow}. All fields are optional. */
export interface ChatFlowConfig {
  /** LLM model identifier. Default: `"openai/gpt-4o-mini"`. */
  model?: string;
  /** System prompt for the generator. */
  prompt?: string;
  /** Tool blocks the LLM can invoke during its tool loop. */
  tools?: GeneratorTool[];
  /** Enable web search grounding. */
  search?: boolean | GeneratorSearchConfig;
  /** Maximum tool-loop iterations. Default: `10`. */
  maxIterations?: number;
  /** Voice / TTS config. */
  voice?: VoiceConfig;
  /**
   * Capabilities to install on the generator. Installs resources, state
   * schemas, and preset surfaces (context, tools) automatically.
   *
   * @example
   * ```ts
   * uses: [mem.capability, artifactsCapability]
   * ```
   */
  uses?: CapabilityRef[];
  /**
   * Context formatters for the generator. Functions or strings injected
   * into the system prompt alongside any capability-provided context.
   *
   * @example
   * ```ts
   * context: [mem.contextFormatter, voiceContext]
   * ```
   */
  context?: GeneratorSlotEntry[];
  /**
   * Maximum number of prior LLM messages to include in history.
   * Default: no limit (all session items).
   */
  historyLimit?: number;
}

const setPreferredModel = handler({
  name: "set-preferred-model",
  inputSchema: setPreferredModelInputSchema,
  userStateSchema: preferredModelUserStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ preferredModel: input.preferredModel });
  },
});

/**
 * Creates a multi-turn conversational chat flow.
 *
 * Returns a `FlowType` with two actions:
 * - `chat` — send a message, get a streamed response
 * - `setPreferredModel` — switch the active model (persisted in user state)
 *
 * The generator uses `selectModel` to honor the user's preferred model,
 * falling back to the configured default.
 */
export function chatFlow(config: ChatFlowConfig = {}): FlowType {
  const {
    model = DEFAULT_MODEL,
    prompt = "You are a helpful, concise assistant.",
    tools,
    search,
    maxIterations = 10,
    voice,
    uses,
    context,
    historyLimit,
  } = config;

  const historySlot = historyLimit !== undefined
    ? (_input: unknown, ctx: any) => ctx.session.items.llm({ limit: historyLimit })
    : (_input: unknown, ctx: any) => ctx.session.items.llm();

  const chatGenerator = generator({
    name: "chat-generator",
    model: selectModel(model, {
      prefer: (_input: unknown, ctx: any) => ctx.user?.state?.preferredModel,
    }),
    prompt,
    inputSchema: chatInputSchema,
    userStateSchema: preferredModelUserStateSchema,
    history: historySlot,
    user: (input: { message: string }) => input.message,
    tools,
    search,
    maxIterations,
    uses,
    context,
    emit: { reasoning: true },
  });

  const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema: chatInputSchema })
    .then(chatGenerator)
    .tap((_output: unknown, ctx: any) => {
      const count = (ctx.session.state.messageCount as number) ?? 0;
      ctx.session.patchState({ messageCount: count + 1 });
    });

  return defineFlow({
    kind: "chat",
    requireUser: true,
    actions: {
      chat: {
        inputSchema: chatInputSchema,
        block: chatPipeline,
        userMessage: (input: { message: string }) => input.message,
      },
      setPreferredModel: {
        inputSchema: setPreferredModelInputSchema,
        block: setPreferredModel,
      },
    },
    session: {
      stateSchema: messageCountStateSchema,
    },
    user: {
      stateSchema: preferredModelUserStateSchema,
    },
    voice,
  });
}
