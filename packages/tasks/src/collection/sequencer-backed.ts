/**
 * Sequencer-state-backed TaskCollection (FIX-443 §3.1, default backing).
 *
 * Tasks live as a `Record<id, Task>` on the outer sequencer's state. All
 * lifecycle mutations go through `sequencer.atomicState` so two workers
 * contending for the same task cannot both win — `atomicState` is
 * CAS-guarded by core's state container and retries on conflict.
 *
 * Why default: locality. Each sequencer instance owns its own tasks
 * without manufacturing unique resource keys, and nested patterns
 * automatically get isolated collections. Durability follows the
 * sequencer's checkpoint contract (FIX-401, latest-only with always-on
 * default).
 */
import type { StateRef } from "@flow-state-dev/core/types";
import type { Task, TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
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
import {
  buildTaskChangeItem,
  type TaskChangeEmissionFrame,
  type TaskChangeKind,
} from "../items/task-change";

export interface SequencerBackedOptions {
  collectionId: string;
  /** Sequencer state ref — typically `ctx.sequencer`. The sequencer's stateSchema
   *  must include a record at `[stateKey]`, e.g. `tasks: z.record(taskSchema)`. */
  sequencer: StateRef<Record<string, unknown>>;
  /** Key on sequencer state that holds the `Record<id, Task>`. Default: `"tasks"`. */
  stateKey?: string;
  /** Runtime emitter frame for `task_change` items. */
  emit: (item: ReturnType<typeof buildTaskChangeItem>) => void;
  /** Frame factory used to stamp ids/provenance on each emitted item. */
  frame: TaskChangeEmissionFrame;
  /** When true, omit `transient` on emitted `task_change` items so they persist. Default: false. */
  persistTaskEvents?: boolean;
  /** Clock injection for tests. Default: `Date.now`. */
  now?: () => number;
}

/** Create a `TaskCollectionRef` backed by a sequencer's state record. */
export function createSequencerBackedTaskCollection<TInput = unknown, TOutput = unknown>(
  options: SequencerBackedOptions
): TaskCollectionRef<TInput, TOutput> {
  const stateKey = options.stateKey ?? "tasks";
  const now = options.now ?? Date.now;
  const transient = options.persistTaskEvents !== true;

  function readTasks(): Record<string, Task<TInput, TOutput>> {
    const raw = options.sequencer.state as Record<string, unknown>;
    const slot = raw[stateKey];
    return slot && typeof slot === "object"
      ? (slot as Record<string, Task<TInput, TOutput>>)
      : {};
  }

  function emit(
    kind: TaskChangeKind,
    task: Task<TInput, TOutput>,
    prevStatus?: TaskStatus
  ): void {
    options.emit(
      buildTaskChangeItem({
        collectionId: options.collectionId,
        taskId: task.id,
        kind,
        task: task as Task,
        prevStatus,
        frame: options.frame,
        transient,
      })
    );
  }

  /**
   * Run a CAS-guarded write. The `mutate` callback returns the next tasks
   * map (or `undefined` for a no-op). Errors thrown inside `mutate`
   * propagate; the CAS retry loop in `atomicState` re-runs the callback
   * with the freshest committed tasks map.
   *
   * This helper does not emit. Each public method emits explicitly after
   * `casWrite` returns, using the post-mutation task it captured (the
   * captured value reflects the final winning attempt — earlier retry
   * attempts are overwritten).
   */
  async function casWrite(
    mutate: (
      tasks: Readonly<Record<string, Task<TInput, TOutput>>>
    ) => Record<string, Task<TInput, TOutput>> | undefined
  ): Promise<void> {
    await options.sequencer.atomicState((state) => {
      const raw = state as Record<string, unknown>;
      const currentTasks =
        raw[stateKey] && typeof raw[stateKey] === "object"
          ? (raw[stateKey] as Record<string, Task<TInput, TOutput>>)
          : {};

      const next = mutate(currentTasks);
      if (next === undefined) return {} as Partial<Record<string, unknown>>;
      return { [stateKey]: next } as Partial<Record<string, unknown>>;
    });
  }

  async function transitionTo(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>,
    flags?: { allowTerminalNoop?: boolean }
  ): Promise<void> {
    let captured:
      | { task: Task<TInput, TOutput>; prevStatus: TaskStatus }
      | undefined;

    await casWrite((tasks) => {
      const task = tasks[id];
      if (task === undefined) {
        throw new Error(`[tasks] task "${id}" not found`);
      }
      if (flags?.allowTerminalNoop === true && isTerminalStatus(task.status)) {
        captured = undefined;
        return undefined;
      }
      assertTransitionAllowed(task.status, targetStatus, id);
      const next = applyTransition(task, { ...patch(task), status: targetStatus }, now());
      captured = { task: next, prevStatus: task.status };
      return { ...tasks, [id]: next };
    });

    if (captured !== undefined) {
      emit(kind, captured.task, captured.prevStatus);
    }
  }

  async function patchOne(
    id: string,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>> | undefined
  ): Promise<void> {
    let captured: Task<TInput, TOutput> | undefined;

    await casWrite((tasks) => {
      const task = tasks[id];
      if (task === undefined) {
        throw new Error(`[tasks] task "${id}" not found`);
      }
      const update = patch(task);
      if (update === undefined) {
        captured = undefined;
        return undefined;
      }
      const next = applyTransition(task, update, now());
      captured = next;
      return { ...tasks, [id]: next };
    });

    if (captured !== undefined) {
      emit(kind, captured);
    }
  }

  const ref: TaskCollectionRef<TInput, TOutput> = {
    collectionId: options.collectionId,

    async addTask(init) {
      // Build the task once — id and createdAt are stable across CAS retries
      // so the emitted item matches what's in state on a successful write.
      const task = buildInitialTask<TInput, TOutput>(init, now());
      await casWrite((tasks) => {
        if (tasks[task.id] !== undefined) {
          throw new Error(`[tasks] task with id "${task.id}" already exists`);
        }
        return { ...tasks, [task.id]: task };
      });
      emit("added", task);
      return task;
    },

    async addTasks(inits) {
      const built = inits.map((init) => buildInitialTask<TInput, TOutput>(init, now()));
      if (built.length === 0) return [];
      await casWrite((tasks) => {
        const next = { ...tasks };
        for (const task of built) {
          if (next[task.id] !== undefined) {
            throw new Error(`[tasks] task with id "${task.id}" already exists`);
          }
          next[task.id] = task;
        }
        return next;
      });
      for (const task of built) {
        emit("added", task);
      }
      return built;
    },

    async claim(_workerId, claimOptions) {
      let captured:
        | { task: Task<TInput, TOutput>; prevStatus: TaskStatus }
        | undefined;

      await casWrite((tasks) => {
        const lookup = (id: string): Task | undefined =>
          (tasks[id] as unknown as Task | undefined);
        const eligibility = claimOptions?.eligibility ?? defaultEligibility(lookup);
        const order = claimOptions?.order ?? defaultOrder;

        const candidates = Object.values(tasks).filter(eligibility).slice().sort(order);
        const pick = candidates[0];
        if (pick === undefined) {
          captured = undefined;
          return undefined;
        }

        const next = applyClaimToTask(
          pick,
          now(),
          claimOptions?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS
        );
        captured = { task: next, prevStatus: pick.status };
        return { ...tasks, [next.id]: next };
      });

      if (captured === undefined) return null;
      emit("claimed", captured.task, captured.prevStatus);
      return captured.task;
    },

    async complete(id, output) {
      await transitionTo(id, "completed", "completed", () => ({
        output,
        completedAt: now(),
        leaseUntil: undefined,
        error: undefined,
      }));
    },

    async fail(id, error) {
      await transitionTo(id, "errored", "errored", () => ({
        error,
        completedAt: now(),
        leaseUntil: undefined,
      }));
    },

    async block(id, reason) {
      await transitionTo(id, "blocked", "blocked", () =>
        reason !== undefined ? { error: reason } : {}
      );
    },

    async unblock(id) {
      await transitionTo(id, "pending", "unblocked", () => ({
        error: undefined,
      }));
    },

    async awaitReview(id, feedback) {
      await transitionTo(id, "awaiting_review", "review_requested", () =>
        feedback !== undefined ? { feedback } : {}
      );
    },

    async resumeFromReview(id, feedback) {
      await transitionTo(id, "pending", "resumed", () => ({
        feedback: feedback ?? undefined,
        leaseUntil: undefined,
      }));
    },

    async cancel(id, reason) {
      await transitionTo(
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

      await casWrite((tasks) => {
        const next: Record<string, Task<TInput, TOutput>> = { ...tasks };
        reclaimed.length = 0;
        for (const task of Object.values(tasks)) {
          if (
            task.status === "in_progress" &&
            task.leaseUntil !== undefined &&
            task.leaseUntil < at
          ) {
            const reset: Task<TInput, TOutput> = {
              ...task,
              status: "pending",
              assignee: undefined,
              leaseUntil: undefined,
              updatedAt: at,
            };
            next[task.id] = reset;
            reclaimed.push(reset);
          }
        }
        return reclaimed.length === 0 ? undefined : next;
      });

      // `kind: "resumed"` covers both human-review resume and lease reclaim
      // — the canonical "task is back to pending" event for a lifecycle UI.
      for (const task of reclaimed) {
        emit("resumed", task, "in_progress");
      }
      return reclaimed.length;
    },

    async setAssignee(id, assignee) {
      await patchOne(id, "assignee_changed", (task) =>
        task.assignee === assignee ? undefined : { assignee }
      );
    },

    async setPriority(id, priority) {
      await patchOne(id, "priority_changed", (task) =>
        task.priority === priority ? undefined : { priority }
      );
    },

    async addLabel(id, label) {
      await patchOne(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        if (labels.includes(label)) return undefined;
        return { labels: [...labels, label] };
      });
    },

    async removeLabel(id, label) {
      await patchOne(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        if (!labels.includes(label)) return undefined;
        return { labels: labels.filter((l) => l !== label) };
      });
    },

    async patchMetadata(id, patch) {
      await patchOne(id, "metadata_changed", (task) => {
        const merged = { ...(task.metadata ?? {}), ...patch };
        return { metadata: merged };
      });
    },

    get(id) {
      return readTasks()[id];
    },

    list(filter?: TaskFilter) {
      return listTasks(Object.values(readTasks()), filter);
    },

    count(filter?: TaskFilter) {
      return ref.list(filter).length;
    },
  };

  return ref;
}
