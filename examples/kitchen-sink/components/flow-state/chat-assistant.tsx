import type { RendererRegistry } from "@flow-state-dev/react";
import { Message } from "./message";
import { Reasoning } from "./reasoning";
import { Tool } from "./tool";
import { Status } from "./status";
import { ErrorDisplay } from "./error";
import { Plan } from "./plan";
import { Blackboard } from "./blackboard";

/**
 * Pre-wired renderer registry for standard chat assistant UIs.
 * Pass directly to <FlowProvider renderers={chatAssistantRenderers}>.
 *
 * Sources are excluded (source: false) — render them grouped via
 * <SourcesGroup items={session.items} /> alongside <ItemsRenderer>.
 */
export const chatAssistantRenderers: RendererRegistry = {
  message: Message,
  reasoning: Reasoning,
  block_output: false,
  block_tool_output: Tool,
  status: Status,
  error: ErrorDisplay,
  step_error: ErrorDisplay,
  source: false,
  component: { plan: Plan, blackboard: Blackboard },
};
