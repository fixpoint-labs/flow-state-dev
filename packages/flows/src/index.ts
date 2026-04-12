/**
 * @flow-state-dev/flows — Ready-to-use flow definitions.
 *
 * This package provides opinionated, configurable flow factories for the most
 * common AI application archetypes. Each factory returns a `FlowType` that
 * works out of the box with sensible defaults and can be customized via config
 * or `FlowInstanceOptions`.
 *
 * Two archetypes are included:
 *
 * - **chatFlow** — Multi-turn conversational agent with model selection,
 *   capability support (memory, etc.), tools, search, and voice.
 * - **componentFlow** — AI-enabled UI component with named content-
 *   transformation actions (improve, shorten, translate, etc.).
 */

export { chatFlow } from "./chat";
export type { ChatFlowConfig } from "./chat";

export { componentFlow } from "./component";
export type { ComponentFlowConfig, ComponentActionConfig } from "./component";

export {
  chatInputSchema,
  componentInputSchema,
  setPreferredModelInputSchema,
  messageCountStateSchema,
  preferredModelUserStateSchema,
  DEFAULT_MODEL,
} from "./shared";
