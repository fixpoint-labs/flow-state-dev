/**
 * agentFlow — Tool-using task agent.
 *
 * Optimized for agentic workflows where the LLM drives tool use to accomplish
 * goals. Differs from chatFlow in its input shape (`{ goal }` instead of
 * `{ message }`), higher default iteration limit, and task-oriented system
 * prompt.
 *
 * @example
 * ```ts
 * import { agentFlow } from "@flow-state-dev/flows";
 *
 * const flow = agentFlow({
 *   model: "anthropic/claude-sonnet-4-20250514",
 *   prompt: "You are a research agent.",
 *   tools: [searchTool, readUrlTool],
 * })({ id: "researcher" });
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
} from "@flow-state-dev/core";

import {
  DEFAULT_MODEL,
  goalInputSchema,
  taskCountStateSchema,
} from "./shared";

/** Configuration options for {@link agentFlow}. `tools` is required. */
export interface AgentFlowConfig {
  /** LLM model identifier. Default: `"openai/gpt-4o-mini"`. */
  model?: string;
  /** System prompt for the generator. */
  prompt?: string;
  /** Tool blocks the LLM can invoke. Required for agent flows. */
  tools: GeneratorTool[];
  /** Enable web search grounding. */
  search?: boolean | GeneratorSearchConfig;
  /** Maximum tool-loop iterations. Default: `25`. */
  maxIterations?: number;
}

/**
 * Creates a tool-using task agent flow.
 *
 * Returns a `FlowType` with a single `run` action accepting `{ goal: string }`.
 * The agent uses the provided tools to accomplish the goal, with a higher
 * default iteration limit than chatFlow.
 */
export function agentFlow(config: AgentFlowConfig): FlowType {
  const {
    model = DEFAULT_MODEL,
    prompt = "You are a capable agent. Use the available tools to accomplish the user's goal. Think step by step, use tools as needed, and provide a clear summary when done.",
    tools,
    search,
    maxIterations = 25,
  } = config;

  const agentGenerator = generator({
    name: "agent-generator",
    model,
    prompt,
    inputSchema: goalInputSchema,
    history: (_input: unknown, ctx: any) => ctx.session.items.llm(),
    user: (input: { goal: string }) => input.goal,
    tools,
    search,
    maxIterations,
    emit: { reasoning: true },
  });

  const agentPipeline = sequencer({ name: "agent-pipeline", inputSchema: goalInputSchema })
    .then(agentGenerator)
    .tap((_output: unknown, ctx: any) => {
      const count = (ctx.session.state.taskCount as number) ?? 0;
      ctx.session.patchState({ taskCount: count + 1 });
    });

  return defineFlow({
    kind: "agent",
    requireUser: true,
    actions: {
      run: {
        inputSchema: goalInputSchema,
        block: agentPipeline,
        userMessage: (input: { goal: string }) => input.goal,
      },
    },
    session: {
      stateSchema: taskCountStateSchema,
    },
  });
}
