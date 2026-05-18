import type { ComponentItem } from "@flow-state-dev/core/items";
import type { RendererRegistry } from "@flow-state-dev/react";
import { Message } from "./message";
import { Reasoning } from "./reasoning";
import { Tool } from "./tool";
import { Status } from "./status";
import { ErrorDisplay } from "./error";
import { RoutedSpecialists } from "./routed-specialists";
import { EventedActors } from "./evented-actors";
import { Debate } from "./debate";
import { AuditAnnotation } from "./audit-annotation";
import { TaskPlan } from "./task-plan";

/**
 * Renders `<TaskPlan />` once per task board, keyed to the request that
 * emitted the `task-board-meta`. Many requests in the chat history can
 * run the same `collectionId`; passing `requestId` binds each rendered
 * board to its own run instead of the global "latest run" view.
 *
 * `task-change` items are read by TaskPlan internally via
 * `useSessionItems`, so they need no standalone renderer.
 */
function TaskBoardMeta({ item }: { item: ComponentItem }) {
  const collectionId = (item.data as { collectionId?: string } | undefined)
    ?.collectionId;
  if (collectionId === undefined) return null;
  return <TaskPlan collectionId={collectionId} requestId={item.requestId} />;
}

/**
 * Pre-wired renderer registry for standard chat assistant UIs.
 * Pass directly to <FlowProvider renderers={chatAssistantRenderers}>.
 *
 * Sources are excluded (source: false) — render them grouped via
 * <SourcesGroup items={session.items} /> alongside <ItemsRenderer>.
 *
 * Component renderers (routedSpecialists, audit-annotation, task-board-meta) receive
 * a single ComponentItem with the full snapshot data.
 */
export const chatAssistantRenderers: RendererRegistry = {
  message: Message,
  reasoning: Reasoning,
  block_trace: false,
  tool_output: Tool,
  status: Status,
  error: ErrorDisplay,
  source: false,
  container: {
    "evented-actors": EventedActors,
    debate: Debate,
  },
  component: {
    routedSpecialists: RoutedSpecialists,
    "audit-annotation": AuditAnnotation,
    "task-board-meta": TaskBoardMeta,
    "task-change": false,
    // Debate's per-round, per-decision, and verdict items are collected
    // and rendered by the <Debate /> container renderer above.
    "debate-turn": false,
    "debate-decision": false,
    "debate-verdict": false,
  },
};
