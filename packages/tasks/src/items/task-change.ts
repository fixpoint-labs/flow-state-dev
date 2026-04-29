/**
 * `task_change` item — emitted on every TaskCollection lifecycle transition
 * (FIX-443 §3.4).
 *
 * The substrate emits one `task_change` per mutation. `<Plan />` and the
 * DevTool subscribe by `collectionId` and rebuild the visible state from
 * the stream. Items are transient by default; consumers that need
 * post-hoc replay opt in via `persistTaskEvents: true` on the factory.
 *
 * The item shape conforms to the open `OutputItem` contract (id, type,
 * itemIndex, ts, requestId, provenance) so the streaming layer treats it
 * like any other typed item even though `TaskChangeItem` is not in
 * core's discriminated union — core stays agnostic of task semantics.
 */
import type { Task, TaskStatus } from "../schema/task";

export type TaskChangeKind =
  | "added"
  | "claimed"
  | "completed"
  | "errored"
  | "blocked"
  | "unblocked"
  | "review_requested"
  | "resumed"
  | "cancelled"
  | "label_changed"
  | "metadata_changed"
  | "priority_changed"
  | "assignee_changed";

/**
 * Lifecycle item emitted on the active stream by every TaskCollection
 * mutation. Carries the post-mutation task plus the previous status so
 * consumers can render diffs without keeping a parallel state.
 */
export type TaskChangeItem = {
  type: "task_change";
  /** Stable identifier for the source TaskCollection — matches `TaskCollectionRef.collectionId`. */
  collectionId: string;
  taskId: string;
  kind: TaskChangeKind;
  task: Task;
  /** Previous status when the mutation transitioned the task; omitted on pure metadata edits. */
  prevStatus?: TaskStatus;

  /** Required OutputItem fields, populated by the substrate's emission helper. */
  id: string;
  status: "completed";
  itemIndex: number;
  ts: number;
  requestId: string;
  transient?: boolean;
  provenance: {
    blockName: string;
    blockInstanceId: string;
    parentBlockInstanceId?: string;
    phase: "main" | "work";
    blockDefinitionId?: string;
    stepIndex?: number;
    workGroupId?: string;
    attempt?: number;
  };
  ownedBy?: string;
};

let monotonicCounter = 0;
function nextItemId(): string {
  monotonicCounter += 1;
  return `item_task_change_${monotonicCounter}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Builds a `TaskChangeItem` from substrate-side fields and the runtime
 * frame supplied by the binding adapter. `transient` defaults to true —
 * `persistTaskEvents` flips it for the whole collection.
 */
export function buildTaskChangeItem(input: {
  collectionId: string;
  taskId: string;
  kind: TaskChangeKind;
  task: Task;
  prevStatus?: TaskStatus;
  frame: TaskChangeEmissionFrame;
  transient: boolean;
}): TaskChangeItem {
  return {
    id: nextItemId(),
    type: "task_change",
    status: "completed",
    itemIndex: input.frame.nextItemIndex(),
    ts: Date.now(),
    requestId: input.frame.requestId,
    transient: input.transient || undefined,
    provenance: input.frame.provenance(),
    ownedBy: input.frame.ownedBy,
    collectionId: input.collectionId,
    taskId: input.taskId,
    kind: input.kind,
    task: input.task,
    prevStatus: input.prevStatus,
  };
}

/**
 * The runtime frame the binding adapter wires from a `BlockContext`. Lets
 * the collection emit items without depending on `@flow-state-dev/server`.
 */
export interface TaskChangeEmissionFrame {
  requestId: string;
  nextItemIndex: () => number;
  provenance: () => TaskChangeItem["provenance"];
  ownedBy?: string;
}
