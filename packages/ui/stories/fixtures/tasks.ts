/**
 * Helpers that produce `task-change` and `task-board-meta` `ComponentItem`s
 * shaped exactly the way `<TaskPlan />` expects to read them off the session
 * stream.
 */
import type { ComponentItem } from "@flow-state-dev/core/items";
import type {
  BoardMeta,
  Task,
  TaskChangeKind,
  TaskStatus,
} from "../../registry/components/task-plan-state";
import {
  TASK_BOARD_META_COMPONENT,
  TASK_CHANGE_COMPONENT,
} from "../../registry/components/task-plan-state";

import { componentItem } from "./items";

export function makeTask(overrides: Partial<Task> & { id: string; goal: string }): Task {
  return {
    status: "pending" as TaskStatus,
    ...overrides,
  };
}

export type TaskChangeOptions = {
  collectionId: string;
  task: Task;
  kind?: TaskChangeKind;
  requestId?: string;
  id?: string;
};

export function makeTaskChange(options: TaskChangeOptions): ComponentItem {
  const { collectionId, task, kind, requestId = "req-tasks", id } = options;
  return componentItem({
    component: TASK_CHANGE_COMPONENT,
    data: {
      collectionId,
      task,
      ...(kind !== undefined ? { kind } : {}),
    },
    key: `${collectionId}/${task.id}`,
    requestId,
    ...(id !== undefined ? { id } : {}),
  });
}

export type BoardMetaOptions = {
  collectionId: string;
  meta?: BoardMeta;
  requestId?: string;
  id?: string;
};

export function makeBoardMeta(options: BoardMetaOptions): ComponentItem {
  const { collectionId, meta = { status: "active" }, requestId = "req-tasks", id } = options;
  return componentItem({
    component: TASK_BOARD_META_COMPONENT,
    data: { collectionId, ...meta },
    key: collectionId,
    requestId,
    ...(id !== undefined ? { id } : {}),
  });
}
