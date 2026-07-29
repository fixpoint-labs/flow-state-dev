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
import type { OutputItem } from "@flow-state-dev/core/items";
import type { StateRef } from "@flow-state-dev/core/types";
import type { Task, TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import { assertTransitionAllowed, isTerminalStatus } from "../schema/task-status";
import type {
  TaskCollectionRef,
  TaskTransitionOptions,
  TaskWriteOutcome,
} from "./types";
import {
  applyClaimToTask,
  applyTransition,
  buildInitialTask,
  createTaskHandleWrapper,
  DEFAULT_LEASE_DURATION_MS,
  defaultEligibility,
  defaultOrder,
  listTasks,
  transitionDeclineReason,
  shouldRetryOnFail,
} from "./internal";
import type { TaskChangeEvent, TaskChangeKind } from "./change-event";
import {
  TaskCapExceededError,
  validateTaskCaps,
  type TaskCapOptions,
} from "./task-caps";

export interface SequencerBackedOptions extends TaskCapOptions {
  collectionId: string;
  /** Sequencer state ref — typically `ctx.sequencer`. The sequencer's stateSchema
   *  must include a record at `[stateKey]`, e.g. `tasks: z.record(taskSchema)`. */
  sequencer: StateRef<Record<string, unknown>>;
  /** Key on sequencer state that holds the `Record<id, Task>`. Default: `"tasks"`. */
  stateKey?: string;
  /**
   * Optional callback fired after every successful task mutation. The
   * `getOrCreateTaskCollection` factory wires this to `ctx.emit.component`
   * to publish lifecycle changes onto the framework item stream.
   */
  onChange?: (event: TaskChangeEvent) => void;
  /**
   * Item-log accessor for `TaskHandle.items()` (FIX-480). Reads the
   * response's persistent item buffer at call time so synthesizer
   * prompt-builders can pick from a worker's natural emissions
   * (messages, sources, tool calls). When omitted, `items()` returns
   * `[]` — useful for tests that don't wire a response.
   */
  getItems?: () => readonly OutputItem[];
  /** Clock injection for tests. Default: `Date.now`. */
  now?: () => number;
}

/**
 * Own-property task lookup (FIX-965). `id` is model-supplied (task tool
 * calls declare `taskId: z.string()`), so BP-031 applies — indexing directly
 * could resolve an inherited `Object.prototype` member instead of missing.
 * Same guard as `keyedRouter` and `dispatch-and-execute.ts` (FIX-943).
 */
function ownTask<T>(tasks: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(tasks, id) ? tasks[id] : undefined;
}

/** Create a `TaskCollectionRef` backed by a sequencer's state record. */
export function createSequencerBackedTaskCollection<TInput = unknown, TOutput = unknown>(
  options: SequencerBackedOptions
): TaskCollectionRef<TInput, TOutput> {
  const stateKey = options.stateKey ?? "tasks";
  const now = options.now ?? Date.now;
  const onChange = options.onChange;
  validateTaskCaps(`[tasks] collection "${options.collectionId}"`, options);
  // `null` (explicitly unbounded) and omission collapse to the same runtime
  // state here — the distinction only matters at the construction points that
  // decide whether to apply a default.
  const maxTotalTasks = options.maxTotalTasks ?? undefined;
  const maxEnqueuedTasks = options.maxEnqueuedTasks ?? undefined;
  const wrap = createTaskHandleWrapper<TInput, TOutput>(
    options.collectionId,
    options.getItems,
  );

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
    if (onChange === undefined) return;
    onChange({
      collectionId: options.collectionId,
      taskId: task.id,
      kind,
      task: task as Task,
      prevStatus,
    });
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

  /**
   * Enforce the creation caps against the map an insertion WOULD produce
   * (FIX-931). Called from inside `casWrite`'s mutator, so it re-evaluates
   * against the winner's committed map on every CAS retry: concurrent same-step
   * adds serialize, and a burst at a boundary lands exactly the cap's worth.
   * Throwing here aborts the mutate, so nothing is written — which is also what
   * makes a batch `addTasks` all-or-nothing.
   *
   * Only creation is capped. Transitions that move a task back into `pending`
   * (retry, unblock, resume, reclaim) never reach this, by design.
   */
  function assertWithinCaps(next: Record<string, Task<TInput, TOutput>>): void {
    if (maxTotalTasks !== undefined) {
      const total = Object.keys(next).length;
      if (total > maxTotalTasks) {
        throw new TaskCapExceededError({
          cap: "total",
          limit: maxTotalTasks,
          attempted: total,
          collectionId: options.collectionId,
        });
      }
    }
    if (maxEnqueuedTasks !== undefined) {
      let pending = 0;
      for (const task of Object.values(next)) {
        if (task.status === "pending") pending++;
      }
      if (pending > maxEnqueuedTasks) {
        throw new TaskCapExceededError({
          cap: "enqueued",
          limit: maxEnqueuedTasks,
          attempted: pending,
          collectionId: options.collectionId,
        });
      }
    }
  }

  /**
   * Run one lifecycle transition inside the CAS, returning what it did
   * (FIX-976).
   *
   * `guards` makes the write advisory (FIX-951): evaluated against the
   * freshest committed task from inside the mutator, so the decision is
   * race-free rather than a caller-side pre-check. A declined write returns
   * `undefined` from the mutator, which patches nothing and emits nothing —
   * and the reason travels out on the verdict.
   *
   * Both `captured` and `declined` are reset on every mutator entry: `casWrite`
   * may replay this closure with a fresher tasks map, and the verdict must
   * describe the winning attempt, not an earlier one.
   */
  async function transitionTo(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>,
    guards?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome> {
    let captured:
      | { task: Task<TInput, TOutput>; prevStatus: TaskStatus }
      | undefined;
    let declined: TaskWriteOutcome | undefined;

    await casWrite((tasks) => {
      const task = ownTask(tasks, id);
      if (task === undefined) {
        throw new Error(`[tasks] task "${id}" not found`);
      }
      const reason = transitionDeclineReason(task as Task, targetStatus, guards);
      if (reason !== undefined) {
        captured = undefined;
        declined = { outcome: "declined", reason, status: task.status };
        return undefined;
      }
      declined = undefined;
      assertTransitionAllowed(task.status, targetStatus, id);
      const next = applyTransition(task, { ...patch(task), status: targetStatus }, now());
      captured = { task: next, prevStatus: task.status };
      return { ...tasks, [id]: next };
    });

    if (declined !== undefined) return declined;
    if (captured === undefined) return { outcome: "unchanged" };
    emit(kind, captured.task, captured.prevStatus);
    return { outcome: "recorded" };
  }

  /**
   * Patch a task's fields inside the CAS, returning what it did (FIX-976).
   *
   * `declineOnTerminal` is the **assignment-only** terminal guard (epic
   * constraint A1). It is keyed by operation and passed by `setAssignee` alone —
   * the four sibling patch methods pass nothing and keep writing to terminal
   * tasks, which two first-party blocks depend on (the supervisor's
   * failure-category audit and `cascadeSkipDependents`' `skipped` label). Making
   * this helper-wide would break both.
   *
   * Evaluated against the freshest committed task from inside the mutator, so
   * the decision is race-free rather than a caller-side pre-check.
   */
  async function patchOne(
    id: string,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>> | undefined,
    options?: { declineOnTerminal?: boolean }
  ): Promise<TaskWriteOutcome> {
    let captured: Task<TInput, TOutput> | undefined;
    let declined: TaskWriteOutcome | undefined;

    await casWrite((tasks) => {
      const task = ownTask(tasks, id);
      if (task === undefined) {
        throw new Error(`[tasks] task "${id}" not found`);
      }
      if (options?.declineOnTerminal === true && isTerminalStatus(task.status)) {
        captured = undefined;
        declined = { outcome: "declined", reason: "terminal", status: task.status };
        return undefined;
      }
      declined = undefined;
      const update = patch(task);
      if (update === undefined) {
        captured = undefined;
        return undefined;
      }
      const next = applyTransition(task, update, now());
      captured = next;
      return { ...tasks, [id]: next };
    });

    if (declined !== undefined) return declined;
    if (captured === undefined) return { outcome: "unchanged" };
    emit(kind, captured);
    return { outcome: "recorded" };
  }

  const ref: TaskCollectionRef<TInput, TOutput> = {
    collectionId: options.collectionId,

    async addTask(init) {
      // Build the task once — id and createdAt are stable across CAS retries
      // so the emitted item matches what's in state on a successful write.
      const task = buildInitialTask<TInput, TOutput>(init, now());
      await casWrite((tasks) => {
        if (ownTask(tasks, task.id) !== undefined) {
          throw new Error(`[tasks] task with id "${task.id}" already exists`);
        }
        const next = { ...tasks, [task.id]: task };
        assertWithinCaps(next);
        return next;
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
          if (ownTask(next, task.id) !== undefined) {
            throw new Error(`[tasks] task with id "${task.id}" already exists`);
          }
          // Own-property insertion (FIX-965): `next[task.id] = task` is a
          // phantom write when task.id is `"__proto__"` — it sets the
          // object's prototype instead of creating an own property, so the
          // task reports as added but is then absent from get/list/count.
          // `defineProperty` always creates/updates an own data property,
          // matching plain-object semantics for every other key.
          Object.defineProperty(next, task.id, {
            value: task,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        assertWithinCaps(next);
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
          (ownTask(tasks, id) as unknown as Task | undefined);
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

    async complete(id, output, options) {
      return transitionTo(
        id,
        "completed",
        "completed",
        () => ({
          output,
          completedAt: now(),
          leaseUntil: undefined,
          error: undefined,
        }),
        options
      );
    },

    async fail(id, error, options) {
      // Retry path: if the task carries a `maxAttempts` budget that
      // hasn't been exhausted, soft-fail back to `pending` and capture
      // the error as `feedback` for the next attempt. The next claim
      // will increment `attempts` again. Hard-fail (no budget left, or
      // no budget set) goes terminal.
      //
      // `options` must reach BOTH branches. `shouldRetryOnFail` is
      // status-blind — it reads only `attempts` vs `maxAttempts` — so a task
      // settled mid-flight that still carries retry budget takes the retry
      // branch and attempts a transition out of a terminal status. Threading
      // the guards into only the hard-fail branch leaves the escape live for
      // exactly that shape, and passes any test that never sets `maxAttempts`.
      const current = ownTask(readTasks(), id);
      if (current !== undefined && shouldRetryOnFail(current)) {
        return transitionTo(
          id,
          "pending",
          "retried",
          () => ({
            feedback: error,
            leaseUntil: undefined,
            error: undefined,
          }),
          options
        );
      }
      return transitionTo(
        id,
        "errored",
        "errored",
        () => ({
          error,
          completedAt: now(),
          leaseUntil: undefined,
        }),
        options
      );
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
      // The decline is now REPORTED (FIX-976) — behaviour is unchanged, but the
      // caller learns the cancel did nothing instead of reading silence as
      // success. Substrate write-backs discard this and stay silent.
      return transitionTo(
        id,
        "cancelled",
        "cancelled",
        () =>
          reason !== undefined
            ? { error: reason, completedAt: now(), leaseUntil: undefined }
            : { completedAt: now(), leaseUntil: undefined },
        // Unchanged behaviour: cancelling an already-settled task is a no-op.
        // The widened condition adds a disallowed arm, which for a `cancelled`
        // target can only fire where the terminal arm already did.
        { ifAllowed: true }
      );
    },

    async reclaim(nowOverride) {
      const at = nowOverride ?? now();
      const reclaimed: Task<TInput, TOutput>[] = [];

      await casWrite((tasks) => {
        const next: Record<string, Task<TInput, TOutput>> = { ...tasks };
        // Reset on every CAS retry — `casWrite` may replay this closure
        // with a fresher tasks snapshot, and we must not push duplicates
        // from a previous attempt onto `reclaimed` (which the post-write
        // emit loop iterates).
        reclaimed.length = 0;
        for (const task of Object.values(tasks)) {
          if (
            task.status === "in_progress" &&
            task.leaseUntil !== undefined &&
            task.leaseUntil < at
          ) {
            // Preserve `assignee` — it's the user-set worker-registry
            // routing key, not the runtime worker identity. Clearing it
            // would break re-dispatch through a worker registry.
            const reset: Task<TInput, TOutput> = {
              ...task,
              status: "pending",
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
      // The one guarded patch operation (FIX-976 / A1): reassigning a finished
      // task is refused, because its work will never run again.
      return patchOne(
        id,
        "assignee_changed",
        (task) => (task.assignee === assignee ? undefined : { assignee }),
        { declineOnTerminal: true }
      );
    },

    async setPriority(id, priority) {
      return patchOne(id, "priority_changed", (task) =>
        task.priority === priority ? undefined : { priority }
      );
    },

    async addLabel(id, label) {
      return patchOne(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        if (labels.includes(label)) return undefined;
        return { labels: [...labels, label] };
      });
    },

    async removeLabel(id, label) {
      return patchOne(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        if (!labels.includes(label)) return undefined;
        return { labels: labels.filter((l) => l !== label) };
      });
    },

    async patchMetadata(id, patch) {
      return patchOne(id, "metadata_changed", (task) => {
        const merged = { ...(task.metadata ?? {}), ...patch };
        return { metadata: merged };
      });
    },

    get(id) {
      const task = ownTask(readTasks(), id);
      return task === undefined ? undefined : wrap(task);
    },

    list(filter?: TaskFilter) {
      return listTasks(Object.values(readTasks()), filter).map(wrap);
    },

    // Counts via `listTasks` directly to skip the per-task wrap allocation.
    // `shouldExit` predicates in patterns call `count()` on every drain
    // tick, so the closure-per-task cost matters under load.
    count(filter?: TaskFilter) {
      return listTasks(Object.values(readTasks()), filter).length;
    },
  };

  return ref;
}
