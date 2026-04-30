import type { ComponentItem } from "@flow-state-dev/core/items";
import type { RendererRegistry } from "@flow-state-dev/react";
import { Message } from "./message";
import { Reasoning } from "./reasoning";
import { Tool } from "./tool";
import { Status } from "./status";
import { ErrorDisplay } from "./error";
import { Blackboard } from "./blackboard";
import { ReactiveBlackboard } from "./reactive-blackboard";
import { AuditAnnotation } from "./audit-annotation";
import { TaskPlan } from "./task-plan";

/**
 * Renders `<TaskPlan />` once per task board. The board emits a
 * `task-board-meta` item keyed by collectionId — latest-wins keeps a single
 * TaskPlan mounted per board across phase transitions. `task-change` items
 * are read by TaskPlan internally via `useSessionItems`, so they need no
 * standalone renderer.
 */
function TaskBoardMeta({ item }: { item: ComponentItem }) {
  const collectionId = (item.data as { collectionId?: string } | undefined)
    ?.collectionId;
  if (collectionId === undefined) return null;
  return <TaskPlan collectionId={collectionId} />;
}

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
  component: {
    "audit-annotation": AuditAnnotation,
    "task-board-meta": TaskBoardMeta,
    "task-change": false,
  },
  container: { blackboard: Blackboard, "reactive-blackboard": ReactiveBlackboard },
};
