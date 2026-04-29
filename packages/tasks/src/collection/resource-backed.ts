/**
 * ResourceCollection-backed TaskCollection (FIX-443 §3.2).
 *
 * Tasks live as instances of a parameterized resource collection
 * (typically `tasks/{id}` pattern), with `scope ∈ { session, user, org }`.
 * Per-task CAS rides the underlying ResourceRef.updateState contract — no
 * sibling projection map needed.
 *
 * When to use over the sequencer-state default: when the collection
 * outlives a single request (a user's persistent todo list, an org-wide
 * work queue, a skill that persists Tasks across sessions).
 *
 * Concurrency model for `claim`:
 *   1. List candidates via the collection's instances.
 *   2. Sort by `order`, filter by `eligibility`.
 *   3. For the first candidate, call `ref.updateState((current) => ...)`.
 *      Inside the updater, re-check eligibility on the freshest state. If
 *      the candidate is no longer eligible (lost the race), return
 *      `current` unchanged and skip to the next candidate.
 *   4. Loop until a claim succeeds or the candidate list is exhausted.
 *
 * Two concurrent workers attempting to claim the same id flow through
 * the same updater. The updater serializes through the underlying scope
 * state's persistence pipeline, so the second worker reads the now-
 * `in_progress` task and skips it. Result: at most one worker claims any
 * given task.
 */
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import type { Task, TaskStatus } from "../schema/task";
import type { TaskFilter } from "../schema/task-init";
import { assertTransitionAllowed, isTerminalStatus } from "../schema/task-status";
import type { TaskCollectionRef } from "./types";
import {
  applyClaimToTask,
  applyTransition,
  buildInitialTask,
  DEFAULT_LEASE_DURATION_MS,
  defaultEligibility,
  defaultOrder,
  listTasks,
} from "./internal";
import type { TaskChangeEvent, TaskChangeKind } from "./change-event";

export interface ResourceBackedOptions {
  collectionId: string;
  /** The parameterized resource collection ref. Pattern must be `someTopic/{id}` style. */
  collection: ResourceCollectionRef<JsonObject>;
  /**
   * Optional callback fired after every successful task mutation. The
   * `getOrCreateTaskCollection` factory wires this to `ctx.emitComponent`
   * to publish lifecycle changes onto the framework item stream.
   */
  onChange?: (event: TaskChangeEvent) => void;
  /** Clock injection for tests. Default: `Date.now`. */
  now?: () => number;
}

function readTaskState<TInput, TOutput>(
  ref: ResourceRef<JsonObject>
): Task<TInput, TOutput> {
  return ref.state as unknown as Task<TInput, TOutput>;
}

/** Create a `TaskCollectionRef` backed by a parameterized resource collection. */
export function createResourceBackedTaskCollection<TInput = unknown, TOutput = unknown>(
  options: ResourceBackedOptions
): TaskCollectionRef<TInput, TOutput> {
  const now = options.now ?? Date.now;
  const onChange = options.onChange;

  function emit(
    kind: TaskChangeKind,
    task: Task<TInput, TOutput>,
    prevStatus?: TaskStatus
  ): void {
    if (onChange === undefined) return;
    onChange({
      collectionId: options.collectionId,
      taskId: task.id,
      kind,
      task: task as Task,
      prevStatus,
    });
  }

  function listAll(): Task<TInput, TOutput>[] {
    return options.collection
      .list()
      .map((ref) => readTaskState<TInput, TOutput>(ref));
  }

  async function transitionRef(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>,
    flags?: { allowTerminalNoop?: boolean }
  ): Promise<void> {
    const ref = options.collection.getOptional(id);
    if (ref === undefined) {
      throw new Error(`[tasks] task "${id}" not found`);
    }

    let prevStatus: TaskStatus | undefined;
    let nextTask: Task<TInput, TOutput> | undefined;

    await ref.updateState((current) => {
      const task = current as unknown as Task<TInput, TOutput>;
      if (flags?.allowTerminalNoop === true && isTerminalStatus(task.status)) {
        return current;
      }
      assertTransitionAllowed(task.status, targetStatus, id);
      prevStatus = task.status;
      const next = applyTransition(task, { ...patch(task), status: targetStatus }, now());
      nextTask = next;
      return next as unknown as JsonObject;
    });

    if (nextTask !== undefined) {
      emit(kind, nextTask, prevStatus);
    }
  }

  async function patchRef(
    id: string,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>> | undefined
  ): Promise<void> {
    const ref = options.collection.getOptional(id);
    if (ref === undefined) {
      throw new Error(`[tasks] task "${id}" not found`);
    }

    let nextTask: Task<TInput, TOutput> | undefined;

    await ref.updateState((current) => {
      const task = current as unknown as Task<TInput, TOutput>;
      const update = patch(task);
      if (update === undefined) return current;
      const next = applyTransition(task, update, now());
      nextTask = next;
      return next as unknown as JsonObject;
    });

    if (nextTask !== undefined) {
      emit(kind, nextTask);
    }
  }

  const ref: TaskCollectionRef<TInput, TOutput> = {
    collectionId: options.collectionId,

    async addTask(init) {
      const task = buildInitialTask<TInput, TOutput>(init, now());
      await options.collection.create(task.id, task as unknown as JsonObject);
      emit("added", task);
      return task;
    },

    async addTasks(inits) {
      const created: Task<TInput, TOutput>[] = [];
      for (const init of inits) {
        const task = buildInitialTask<TInput, TOutput>(init, now());
        await options.collection.create(task.id, task as unknown as JsonObject);
        created.push(task);
        emit("added", task);
      }
      return created;
    },

    async claim(_workerId, claimOptions) {
      // Live lookup so eligibility re-checks see the freshest dep state
      // even when concurrent workers complete dependencies mid-scan.
      const lookup = (id: string): Task | undefined => {
        const r = options.collection.getOptional(id);
        return r === undefined ? undefined : (readTaskState(r) as Task);
      };
      const eligibility = claimOptions?.eligibility ?? defaultEligibility(lookup);
      const order = claimOptions?.order ?? defaultOrder;
      const candidates = listAll().filter(eligibility).slice().sort(order);

      const leaseDurationMs = claimOptions?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;

      for (const candidate of candidates) {
        const candidateRef = options.collection.getOptional(candidate.id);
        if (candidateRef === undefined) continue;

        let claimed: Task<TInput, TOutput> | undefined;
        let prevStatus: TaskStatus | undefined;

        await candidateRef.updateState((current) => {
          const task = current as unknown as Task<TInput, TOutput>;
          // Re-check eligibility on the freshest state — another worker
          // may have claimed this task in the time between scan and CAS.
          if (!eligibility(task as Task)) return current;
          prevStatus = task.status;
          const next = applyClaimToTask(task, now(), leaseDurationMs);
          claimed = next;
          return next as unknown as JsonObject;
        });

        if (claimed !== undefined) {
          emit("claimed", claimed, prevStatus);
          return claimed;
        }
      }

      return null;
    },

    async complete(id, output) {
      await transitionRef(id, "completed", "completed", () => ({
        output,
        completedAt: now(),
        leaseUntil: undefined,
        error: undefined,
      }));
    },

    async fail(id, error) {
      await transitionRef(id, "errored", "errored", () => ({
        error,
        completedAt: now(),
        leaseUntil: undefined,
      }));
    },

    async block(id, reason) {
      await transitionRef(id, "blocked", "blocked", () =>
        reason !== undefined ? { error: reason } : {}
      );
    },

    async unblock(id) {
      await transitionRef(id, "pending", "unblocked", () => ({
        error: undefined,
      }));
    },

    async awaitReview(id, feedback) {
      await transitionRef(id, "awaiting_review", "review_requested", () =>
        feedback !== undefined ? { feedback } : {}
      );
    },

    async resumeFromReview(id, feedback) {
      await transitionRef(id, "pending", "resumed", () => ({
        feedback: feedback ?? undefined,
        leaseUntil: undefined,
      }));
    },

    async cancel(id, reason) {
      await transitionRef(
        id,
        "cancelled",
        "cancelled",
        () =>
          reason !== undefined
            ? { error: reason, completedAt: now(), leaseUntil: undefined }
            : { completedAt: now(), leaseUntil: undefined },
        { allowTerminalNoop: true }
      );
    },

    async reclaim(nowOverride) {
      const at = nowOverride ?? now();
      const reclaimed: Task<TInput, TOutput>[] = [];

      for (const taskRef of options.collection.list()) {
        const task = readTaskState<TInput, TOutput>(taskRef);
        if (
          task.status !== "in_progress" ||
          task.leaseUntil === undefined ||
          task.leaseUntil >= at
        ) {
          continue;
        }

        let next: Task<TInput, TOutput> | undefined;
        await taskRef.updateState((current) => {
          const t = current as unknown as Task<TInput, TOutput>;
          if (
            t.status !== "in_progress" ||
            t.leaseUntil === undefined ||
            t.leaseUntil >= at
          ) {
            return current;
          }
          // Preserve `assignee` — it's the user-set worker-registry
          // routing key, not the runtime worker identity. Clearing it
          // would break re-dispatch through a worker registry.
          const reset: Task<TInput, TOutput> = {
            ...t,
            status: "pending",
            leaseUntil: undefined,
            updatedAt: at,
          };
          next = reset;
          return reset as unknown as JsonObject;
        });

        if (next !== undefined) {
          reclaimed.push(next);
          emit("resumed", next, "in_progress");
        }
      }

      return reclaimed.length;
    },

    async setAssignee(id, assignee) {
      await patchRef(id, "assignee_changed", (task) =>
        task.assignee === assignee ? undefined : { assignee }
      );
    },

    async setPriority(id, priority) {
      await patchRef(id, "priority_changed", (task) =>
        task.priority === priority ? undefined : { priority }
      );
    },

    async addLabel(id, label) {
      await patchRef(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        if (labels.includes(label)) return undefined;
        return { labels: [...labels, label] };
      });
    },

    async removeLabel(id, label) {
      await patchRef(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        if (!labels.includes(label)) return undefined;
        return { labels: labels.filter((l) => l !== label) };
      });
    },

    async patchMetadata(id, patch) {
      await patchRef(id, "metadata_changed", (task) => {
        const merged = { ...(task.metadata ?? {}), ...patch };
        return { metadata: merged };
      });
    },

    get(id) {
      const taskRef = options.collection.getOptional(id);
      return taskRef === undefined ? undefined : readTaskState<TInput, TOutput>(taskRef);
    },

    list(filter?: TaskFilter) {
      return listTasks(listAll(), filter);
    },

    count(filter?: TaskFilter) {
      return ref.list(filter).length;
    },
  };

  return ref;
}
