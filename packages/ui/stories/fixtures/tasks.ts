/**
 * Helpers that produce `task-change` and `task-board-meta` `DataItem`s
 * shaped exactly the way `<TaskPlan />` expects to read them off the session
 * stream.
 */
import type { DataItem } from "@flow-state-dev/core/items";
import type {
  BoardMeta,
  Task,
  TaskChangeKind,
  TaskStatus,
} from "../../registry/components/task-plan-state";
import {
  TASK_BOARD_META_DATA_TYPE,
  TASK_CHANGE_DATA_TYPE,
} from "../../registry/components/task-plan-state";

import { dataItem } from "./items";

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

export function makeTaskChange(options: TaskChangeOptions): DataItem {
  const { collectionId, task, kind, requestId = "req-tasks", id } = options;
  return dataItem({
    dataType: TASK_CHANGE_DATA_TYPE,
    value: {
      collectionId,
      taskId: task.id,
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

export function makeBoardMeta(options: BoardMetaOptions): DataItem {
  const { collectionId, meta = { status: "active" }, requestId = "req-tasks", id } = options;
  return dataItem({
    dataType: TASK_BOARD_META_DATA_TYPE,
    value: { collectionId, ...meta },
    key: collectionId,
    requestId,
    ...(id !== undefined ? { id } : {}),
  });
}
