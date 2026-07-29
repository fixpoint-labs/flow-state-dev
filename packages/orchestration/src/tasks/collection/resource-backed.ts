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
 *
 * Async construction + sync mirror: `ResourceCollectionRef` read methods
 * (`get`/`getOptional`/`list`/`count`) are uniformly async. To keep the
 * public `TaskCollectionRef.get/list/count` synchronous, the factory is
 * `async` and hydrates a sync mirror of resource refs (keyed by task id)
 * once at construction via a single `await collection.list()`. Each
 * `ResourceRef.state` is a live getter, so reads through the mirror always
 * reflect the latest committed state for every task the mirror knows
 * about — the mirror only tracks the SET of refs, never a frozen
 * snapshot of their data. Tasks created via `addTask`/`addTasks` are
 * inserted into the mirror as they are created.
 *
 * Caveat: tasks created in the underlying collection by *other* blocks
 * after construction will not appear in this ref's sync view (accepted
 * tradeoff — the sync surface is a hydrated snapshot of ids, not a live
 * view of external inserts).
 */
import type { JsonObject } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import type { Task, TaskStatus } from "../schema/task";
import type { TaskFilter } from "../schema/task-init";
import { assertTransitionAllowed, isTerminalStatus } from "../schema/task-status";
import type {
  TaskCollectionRef,
  TaskTransitionOptions,
  TaskWriteDeclineReason,
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

/**
 * Module-private signal that a write declined (FIX-951; extended to the patch
 * path and given a reason by FIX-976).
 *
 * Thrown from inside `updateState`'s updater and caught around the call.
 * Never crosses this module's boundary, and never reaches a user: the only
 * `updateState` it is thrown from is the one that catches it. The catch turns it
 * into a `declined` verdict, which is a value — nothing propagates.
 *
 * Why a throw rather than returning `current`. Returning the state unchanged
 * is not a no-op on this backing — `updateState` calls
 * `persistNamespaceInstanceState` and then `notifyInstanceChange`
 * unconditionally, and neither compares `prev` to `post`, so a declined write
 * would announce a `resource_change` for a write that did not happen and
 * could wake a `reactTo.stateUpdated` block. The updater runs *inside*
 * `serializeResourceWrite`, and throwing out of it skips both the persist and
 * the notify while the write chain's tail swallows the rejection, so the next
 * writer to this key is unaffected. That makes the abort atomic — no pre-read,
 * no window — and leaves both backings silent on a declined write.
 *
 * Both write paths use this same mechanism: the transition wrapper for an
 * advisory `ifAllowed` / `expectAttempt` decline, and the patch helper for the
 * assignment terminal guard.
 */
class WriteDeclined extends Error {
  readonly reason: TaskWriteDeclineReason;
  readonly status: TaskStatus;

  constructor(reason: TaskWriteDeclineReason, status: TaskStatus) {
    super(`[tasks] write declined (${reason})`);
    this.name = "WriteDeclined";
    this.reason = reason;
    this.status = status;
  }
}

export interface ResourceBackedOptions {
  collectionId: string;
  /** The parameterized resource collection ref. Pattern must be `someTopic/{id}` style. */
  collection: ResourceCollectionRef<JsonObject>;
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

function readTaskState<TInput, TOutput>(
  ref: ResourceRef<JsonObject>
): Task<TInput, TOutput> {
  return ref.state as unknown as Task<TInput, TOutput>;
}

/**
 * Create a `TaskCollectionRef` backed by a parameterized resource
 * collection. Async because it awaits one `collection.list()` to hydrate
 * the sync mirror (see file header). All other reads are synchronous.
 */
export async function createResourceBackedTaskCollection<TInput = unknown, TOutput = unknown>(
  options: ResourceBackedOptions
): Promise<TaskCollectionRef<TInput, TOutput>> {
  const now = options.now ?? Date.now;
  const onChange = options.onChange;
  const wrap = createTaskHandleWrapper<TInput, TOutput>(
    options.collectionId,
    options.getItems,
  );

  // Sync mirror of resource refs keyed by task id. Hydrated once at
  // construction (the only async step); reads go through each ref's live
  // `.state` getter, so the mirror reflects the latest committed state for
  // every task it knows about. New tasks added via addTask/addTasks are
  // inserted here. Tasks created in the underlying collection by *other*
  // blocks after construction will not appear (accepted tradeoff: the
  // sync TaskCollectionRef surface is a hydrated snapshot of ids, not a
  // live view of external inserts).
  const mirror = new Map<string, ResourceRef<JsonObject>>();
  for (const ref of await options.collection.list()) {
    mirror.set(readTaskState(ref).id, ref);
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

  function listAll(): Task<TInput, TOutput>[] {
    return Array.from(mirror.values()).map((ref) =>
      readTaskState<TInput, TOutput>(ref)
    );
  }

  /**
   * Run one lifecycle transition inside the resource's serialized write,
   * returning what it did (FIX-976).
   *
   * `guards` makes the write advisory (FIX-951): evaluated against the
   * freshest state from inside the updater, so the decision is race-free
   * rather than a caller-side pre-check. A declined write aborts the whole
   * write via `WriteDeclined` — see that type for why returning
   * `current` would not be silent here — and the catch turns it into the
   * `declined` verdict.
   */
  async function transitionRef(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>,
    guards?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome> {
    const ref = mirror.get(id);
    if (ref === undefined) {
      throw new Error(`[tasks] task "${id}" not found`);
    }

    let prevStatus: TaskStatus | undefined;
    let nextTask: Task<TInput, TOutput> | undefined;

    try {
      await ref.updateState((current) => {
        const task = current as unknown as Task<TInput, TOutput>;
        const reason = transitionDeclineReason(task as Task, targetStatus, guards);
        if (reason !== undefined) {
          throw new WriteDeclined(reason, task.status);
        }
        assertTransitionAllowed(task.status, targetStatus, id);
        prevStatus = task.status;
        const next = applyTransition(task, { ...patch(task), status: targetStatus }, now());
        nextTask = next;
        return next as unknown as JsonObject;
      });
    } catch (err) {
      // Only the decline is absorbed. A store failure, CAS exhaustion, or an
      // illegal transition the caller did not opt out of still propagates.
      if (!(err instanceof WriteDeclined)) throw err;
      return { outcome: "declined", reason: err.reason, status: err.status };
    }

    // The updater always runs, so `nextTask` is set on every non-declined path.
    // Reporting `unchanged` rather than `recorded` on the residual keeps the
    // verdict from claiming a write this function did not observe.
    if (nextTask === undefined) return { outcome: "unchanged" };
    emit(kind, nextTask, prevStatus);
    return { outcome: "recorded" };
  }

  /**
   * Patch a task's fields inside the resource's serialized write, returning what
   * it did (FIX-976).
   *
   * `declineOnTerminal` is the **assignment-only** terminal guard (epic
   * constraint A1). It is keyed by operation and passed by `setAssignee` alone —
   * the four sibling patch methods pass nothing and keep writing to terminal
   * tasks, which two first-party blocks depend on (the supervisor's
   * failure-category audit and `cascadeSkipDependents`' `skipped` label). Making
   * this helper-wide would break both.
   *
   * The decline throws `WriteDeclined` out of the updater rather than returning
   * `current`, for the reason documented on that class: on this backing
   * returning `current` still persists and still notifies.
   */
  async function patchRef(
    id: string,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>> | undefined,
    options?: { declineOnTerminal?: boolean }
  ): Promise<TaskWriteOutcome> {
    const ref = mirror.get(id);
    if (ref === undefined) {
      throw new Error(`[tasks] task "${id}" not found`);
    }

    let nextTask: Task<TInput, TOutput> | undefined;

    try {
      await ref.updateState((current) => {
        const task = current as unknown as Task<TInput, TOutput>;
        if (options?.declineOnTerminal === true && isTerminalStatus(task.status)) {
          throw new WriteDeclined("terminal", task.status);
        }
        const update = patch(task);
        if (update === undefined) return current;
        const next = applyTransition(task, update, now());
        nextTask = next;
        return next as unknown as JsonObject;
      });
    } catch (err) {
      if (!(err instanceof WriteDeclined)) throw err;
      return { outcome: "declined", reason: err.reason, status: err.status };
    }

    // The idempotent case returns `current` from the updater, so this backing
    // still persists and still emits a `resource_change`. `unchanged` is a
    // TASK-level verdict — no task field written, no `task-change` item — and
    // deliberately says nothing about the store's own notification, which is
    // unchanged from before FIX-976.
    if (nextTask === undefined) return { outcome: "unchanged" };
    emit(kind, nextTask);
    return { outcome: "recorded" };
  }

  const ref: TaskCollectionRef<TInput, TOutput> = {
    collectionId: options.collectionId,

    async addTask(init) {
      const task = buildInitialTask<TInput, TOutput>(init, now());
      const created = await options.collection.create(
        task.id,
        task as unknown as JsonObject
      );
      mirror.set(task.id, created);
      emit("added", task);
      return task;
    },

    async addTasks(inits) {
      const created: Task<TInput, TOutput>[] = [];
      for (const init of inits) {
        const task = buildInitialTask<TInput, TOutput>(init, now());
        const createdRef = await options.collection.create(
          task.id,
          task as unknown as JsonObject
        );
        mirror.set(task.id, createdRef);
        created.push(task);
        emit("added", task);
      }
      return created;
    },

    async claim(_workerId, claimOptions) {
      // Live lookup so eligibility re-checks see the freshest dep state
      // even when concurrent workers complete dependencies mid-scan.
      const lookup = (id: string): Task | undefined => {
        const r = mirror.get(id);
        return r === undefined ? undefined : (readTaskState(r) as Task);
      };
      const eligibility = claimOptions?.eligibility ?? defaultEligibility(lookup);
      const order = claimOptions?.order ?? defaultOrder;
      const candidates = listAll().filter(eligibility).slice().sort(order);

      const leaseDurationMs = claimOptions?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;

      for (const candidate of candidates) {
        const candidateRef = mirror.get(candidate.id);
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

    async complete(id, output, options) {
      await transitionRef(
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
      // `options` must reach BOTH branches — see the sequencer backing's
      // `fail` for why the status-blind retry predicate makes this the most
      // likely place to ship a partial fix.
      const candidateRef = mirror.get(id);
      if (candidateRef !== undefined) {
        const current = readTaskState<TInput, TOutput>(candidateRef);
        if (shouldRetryOnFail(current as Task)) {
          await transitionRef(
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
          return;
        }
      }
      await transitionRef(
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
      // The decline is now REPORTED (FIX-976) — behaviour is unchanged, but the
      // caller learns the cancel did nothing instead of reading silence as
      // success. Substrate write-backs discard this and stay silent.
      return transitionRef(
        id,
        "cancelled",
        "cancelled",
        () =>
          reason !== undefined
            ? { error: reason, completedAt: now(), leaseUntil: undefined }
            : { completedAt: now(), leaseUntil: undefined },
        // Unchanged behaviour: cancelling an already-settled task is a no-op.
        // It no longer emits a `resource_change` for the write it skipped.
        { ifAllowed: true }
      );
    },

    async reclaim(nowOverride) {
      const at = nowOverride ?? now();
      const reclaimed: Task<TInput, TOutput>[] = [];

      for (const taskRef of mirror.values()) {
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
      // The one guarded patch operation (FIX-976 / A1): reassigning a finished
      // task is refused, because its work will never run again.
      return patchRef(
        id,
        "assignee_changed",
        (task) => (task.assignee === assignee ? undefined : { assignee }),
        { declineOnTerminal: true }
      );
    },

    async setPriority(id, priority) {
      return patchRef(id, "priority_changed", (task) =>
        task.priority === priority ? undefined : { priority }
      );
    },

    async addLabel(id, label) {
      return patchRef(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        if (labels.includes(label)) return undefined;
        return { labels: [...labels, label] };
      });
    },

    async removeLabel(id, label) {
      return patchRef(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        if (!labels.includes(label)) return undefined;
        return { labels: labels.filter((l) => l !== label) };
      });
    },

    async patchMetadata(id, patch) {
      return patchRef(id, "metadata_changed", (task) => {
        const merged = { ...(task.metadata ?? {}), ...patch };
        return { metadata: merged };
      });
    },

    get(id) {
      const taskRef = mirror.get(id);
      return taskRef === undefined
        ? undefined
        : wrap(readTaskState<TInput, TOutput>(taskRef));
    },

    list(filter?: TaskFilter) {
      return listTasks(listAll(), filter).map(wrap);
    },

    // Counts via `listTasks` directly to skip the per-task wrap allocation.
    count(filter?: TaskFilter) {
      return listTasks(listAll(), filter).length;
    },
  };

  return ref;
}
