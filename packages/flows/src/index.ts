/**
 * @flow-state-dev/flows — Ready-to-use flow definitions.
 *
 * This package provides opinionated, configurable flow factories for the most
 * common AI application archetypes. Each factory returns a `FlowType` that
 * works out of the box with sensible defaults and can be customized via config
 * or `FlowInstanceOptions`.
 *
 * Three archetypes are included:
 *
 * - **chatFlow** — Multi-turn conversational agent with history and tools.
 * - **agentFlow** — Tool-using task agent optimized for goal completion.
 * - **generateFlow** — Single-shot generation (summarize, extract, transform).
 */

export { chatFlow } from "./chat";
export type { ChatFlowConfig } from "./chat";

export { agentFlow } from "./agent";
export type { AgentFlowConfig } from "./agent";

export { generateFlow } from "./generate";
export type { GenerateFlowConfig } from "./generate";

export {
  chatInputSchema,
  goalInputSchema,
  textInputSchema,
  messageCountStateSchema,
  taskCountStateSchema,
  DEFAULT_MODEL,
} from "./shared";
