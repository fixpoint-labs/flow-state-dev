/**
 * chatFlow — Multi-turn conversational agent.
 *
 * The most common flow archetype. Maintains conversation history across requests,
 * streams text responses token-by-token, and tracks a simple message counter
 * in session state. Supports tools, search, and voice out of the box.
 *
 * @example
 * ```ts
 * import { chatFlow } from "@flow-state-dev/flows";
 *
 * // Minimal — works with zero config
 * const flow = chatFlow()({ id: "my-chat" });
 *
 * // Configured
 * const flow = chatFlow({
 *   model: "anthropic/claude-sonnet-4-20250514",
 *   prompt: "You are a coding assistant.",
 *   tools: [searchTool],
 * })({ id: "code-chat" });
 * ```
 */
import {
  defineFlow,
  generator,
  sequencer,
} from "@flow-state-dev/core";
import type {
  FlowType,
  GeneratorSearchConfig,
  GeneratorTool,
  VoiceConfig,
} from "@flow-state-dev/core";

import {
  DEFAULT_MODEL,
  chatInputSchema,
  messageCountStateSchema,
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
}

/**
 * Creates a multi-turn conversational chat flow.
 *
 * Returns a `FlowType` that can be called with `FlowInstanceOptions` to
 * create instances. The flow has a single `chat` action accepting
 * `{ message: string }`.
 */
export function chatFlow(config: ChatFlowConfig = {}): FlowType {
  const {
    model = DEFAULT_MODEL,
    prompt = "You are a helpful, concise assistant.",
    tools,
    search,
    maxIterations = 10,
    voice,
  } = config;

  const chatGenerator = generator({
    name: "chat-generator",
    model,
    prompt,
    inputSchema: chatInputSchema,
    history: (_input: unknown, ctx: any) => ctx.session.items.llm(),
    user: (input: { message: string }) => input.message,
    tools,
    search,
    maxIterations,
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
    },
    session: {
      stateSchema: messageCountStateSchema,
    },
    voice,
  });
}
