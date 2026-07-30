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
 * Freshness boundary (FIX-990). The mirror is **shared by every
 * `TaskCollectionRef` resolved over the same resource-collection
 * instance**, so within one request every resolution reads one task set:
 * a task added through any of them is immediately visible to all of them,
 * synchronously. That is what a task-board worker parked in
 * `.waitForCondition` depends on — it caches the ref it resolved on
 * entering the wait, and a sibling's mid-wait add has to reach it.
 *
 * The boundary is the request, and it is a boundary, not a deferral: a
 * concurrently running separate action resolves its own resource
 * collection in its own execution context, so its writes are invisible to
 * an already-waiting drain here. **Re-resolving does not bridge that.**
 * `collection.list()` enumerates the execution context's own in-memory
 * resource state, eagerly loaded when the request started
 * (`createExecutionContext.ts` — "all reads during execution use the
 * in-memory cache"), and nothing re-reads the durable store mid-request. So
 * a running request never sees another request's write however often it
 * resolves; a *later* request does. The durable backing has no
 * cross-process concurrency control to build anything stronger on (blind
 * puts, last-write-wins).
 *
 * Removals reconcile at resolution, not continuously. `TaskCollectionRef`
 * has no `delete`, but the underlying resource collection does, and a
 * capacity eviction removes an instance the same way — so every resolution
 * both adopts what that in-memory state holds and drops what it no longer
 * holds (`reconcileTaskSet`). This works within the request precisely
 * because the request's own writes and deletes go through the same state the
 * reads do. A ref that is *already* held when something else removes a task
 * keeps seeing it until the next resolution reconciles the shared record;
 * that was equally true of the per-ref mirror this replaces, which never
 * re-read anything at all after construction.
 */
import type { JsonObject } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import type { Task, TaskStatus } from "../schema/task";
import type { TaskFilter } from "../schema/task-init";
import { assertTransitionAllowed } from "../schema/task-status";
import type { TaskCollectionRef, TaskTransitionOptions } from "./types";
import {
  applyClaimToTask,
  applyTransition,
  buildInitialTask,
  createTaskHandleWrapper,
  DEFAULT_LEASE_DURATION_MS,
  defaultEligibility,
  defaultOrder,
  listTasks,
  shouldDeclineTransition,
  shouldRetryOnFail,
} from "./internal";
import type { TaskChangeEvent, TaskChangeKind } from "./change-event";

/**
 * Module-private signal that an advisory write declined (FIX-951).
 *
 * Thrown from inside `updateState`'s updater and caught around the call.
 * Never crosses this module's boundary, and never reaches a user: the only
 * `updateState` it is thrown from is the one that catches it.
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
 */
class TransitionDeclined extends Error {
  constructor() {
    super("[tasks] advisory transition declined");
    this.name = "TransitionDeclined";
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
 * Per-resource-collection task-set record, module-scoped (FIX-990). See the
 * file header for the freshness contract this implements.
 *
 * Keyed on the `ResourceCollectionRef` **instance**, never on the
 * `collectionId` string. The resource registry builds one collection handle
 * per execution context per scope instance and hands the same object back on
 * every `resolveResourceCollection` call, so instance identity buys
 * per-request and per-scope-instance isolation for free — two sessions,
 * users, or orgs holding a same-named board get separate records. A string
 * key would merge them. Same keying as `skills/seeding.ts` and
 * `skills/internal/delegation-memo.ts`.
 *
 * A `WeakMap` because the record's lifetime is the collection handle's: when
 * the execution context is collected, so is the record. Nothing to clear on
 * teardown, and a drain that errors leaves behind only refs to tasks that do
 * exist — a retry within the same request reads them and is correct to.
 */
const taskSets = new WeakMap<
  ResourceCollectionRef<JsonObject>,
  Map<string, ResourceRef<JsonObject>>
>();

/** Get (or create) the task-set record shared across resolutions of `collection`. */
function sharedTaskSet(
  collection: ResourceCollectionRef<JsonObject>
): Map<string, ResourceRef<JsonObject>> {
  const existing = taskSets.get(collection);
  if (existing !== undefined) return existing;
  const created = new Map<string, ResourceRef<JsonObject>>();
  taskSets.set(collection, created);
  return created;
}

/**
 * Bring the shared record in line with the store: adopt every task the store
 * lists, and drop every task the store no longer has.
 *
 * Both halves are load-bearing, and each naive version breaks the other:
 *
 * - **A plain merge leaks ghosts.** Another block can remove a task through the
 *   underlying `ResourceCollectionRef` — an explicit `delete()`, or a capacity
 *   eviction, which reaches the store through the same per-key delete and is
 *   therefore indistinguishable here. Merge-only would keep the removed ref in
 *   a record every later resolution reads, so `get`/`list` would report a task
 *   that no longer exists and a mutation against it would fail or recreate it.
 *   Before the record was shared this was safe only by accident: each
 *   resolution built a private map, so a removed task was simply absent.
 *
 * - **A plain replace loses concurrent additions.** `collection.list()` is
 *   awaited, and a sibling resolution can insert into the shared record while
 *   that await is outstanding. Those ids are legitimately absent from a
 *   snapshot taken before they existed, so treating "absent from the list" as
 *   "removed" would delete exactly the mid-flight adds this record exists to
 *   keep — the case the durable-wake scenario turns on.
 *
 * - **Keying the cleanup on the id loses a same-id replacement.** A task can be
 *   removed and then recreated under the same id while the read is outstanding.
 *   The id is in the pre-read set and absent from the snapshot, so a cleanup
 *   asking "is this key still known?" deletes the replacement the store now
 *   holds, and every ref reports it missing until something resolves again.
 *
 * So the cleanup retires a specific **ref**, not an id: each entry captured
 * before the read is dropped only if the record still points at that exact
 * object. An entry that changed identity during the await — a replacement — or
 * an id that appeared during it is newer than the snapshot and cannot be judged
 * by it, so it stays.
 */
async function reconcileTaskSet(
  mirror: Map<string, ResourceRef<JsonObject>>,
  collection: ResourceCollectionRef<JsonObject>
): Promise<void> {
  // The exact entries this pass is allowed to retire, captured before the read.
  const retirable = new Map(mirror);
  const listed = await collection.list();

  const stored = new Set<string>();
  for (const ref of listed) {
    const id = readTaskState(ref).id;
    stored.add(id);
    mirror.set(id, ref);
  }

  for (const [id, refBeforeRead] of retirable) {
    if (stored.has(id)) continue;
    // Identity, not key presence: only retire the object we decided to retire.
    if (mirror.get(id) === refBeforeRead) mirror.delete(id);
  }
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

  // Sync mirror of resource refs keyed by task id — shared with every other
  // resolution over this same resource collection (see `taskSets`). Reads go
  // through each ref's live `.state` getter, so the mirror reflects the
  // latest committed state for every task it knows about, and sharing the
  // record extends that to every task any sibling resolution *creates*.
  //
  // Construction still hydrates (the only async step) and reconciles the
  // record against the store in both directions — see `reconcileTaskSet` for
  // why a plain merge and a plain replace are each wrong.
  const mirror = sharedTaskSet(options.collection);
  await reconcileTaskSet(mirror, options.collection);

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
   * Run one lifecycle transition inside the resource's serialized write.
   *
   * `guards` makes the write advisory (FIX-951): evaluated against the
   * freshest state from inside the updater, so the decision is race-free
   * rather than a caller-side pre-check. A declined write aborts the whole
   * write via `TransitionDeclined` — see that type for why returning
   * `current` would not be silent here.
   */
  async function transitionRef(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>,
    guards?: TaskTransitionOptions
  ): Promise<void> {
    const ref = mirror.get(id);
    if (ref === undefined) {
      throw new Error(`[tasks] task "${id}" not found`);
    }

    let prevStatus: TaskStatus | undefined;
    let nextTask: Task<TInput, TOutput> | undefined;

    try {
      await ref.updateState((current) => {
        const task = current as unknown as Task<TInput, TOutput>;
        if (shouldDeclineTransition(task as Task, targetStatus, guards)) {
          throw new TransitionDeclined();
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
      if (!(err instanceof TransitionDeclined)) throw err;
      return;
    }

    if (nextTask !== undefined) {
      emit(kind, nextTask, prevStatus);
    }
  }

  async function patchRef(
    id: string,
    kind: TaskChangeKind,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>> | undefined
  ): Promise<void> {
    const ref = mirror.get(id);
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
      await transitionRef(
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
