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
 * collection in its own execution context, so its writes are not something
 * an already-waiting drain here can rely on seeing. A *later* request does.
 * The durable backing has no cross-process concurrency control to build
 * anything stronger on (blind puts, last-write-wins).
 *
 * Do not strengthen that into "a running request never sees another
 * request's write, however often it resolves" — an earlier version of this
 * header said exactly that and it is false. It holds for an eagerly loaded
 * collection, whose state is read once when the request starts. A
 * `prefetchMode: "lazy"` collection is loaded on first read instead, so the
 * first `list()` per prefix is a store round-trip that imports whatever is
 * committed at that moment, including another request's writes. What that
 * read can no longer do is resurrect a key this request deleted
 * (`createExecutionContext.ts` — the prefix merge skips deleted keys).
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
import { updateStateWith } from "@flow-state-dev/core/helpers";
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
  grantRetry,
  listTasks,
  routeFailure,
  transitionDeclineReason,
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
 *
 * ---
 *
 * **The read window, enumerated.** Three separate races were found here one at a
 * time, each after the previous was fixed, so the cases are written out rather
 * than left to be rediscovered. `collection.list()` is async: call it at T0, it
 * materializes a ref array at T1, and this function's continuation runs at T2.
 * Between T0 and T2 the underlying collection accepts inserts (`create`,
 * `getOrCreate`, `upsert`), removals (`delete`, and capacity eviction as a side
 * effect of `create`), and per-instance state writes. Membership is what has to
 * reconcile; state rides live getters. For a task id X:
 *
 *  1. **Inserted before T1** — in the snapshot, so adopted. The ordinary case.
 *  2. **Inserted after T1 through a task ref** — the record already holds it, and
 *     it is absent from both the snapshot and `retirable`, so nothing touches it.
 *  3. **Inserted after T1 straight onto the resource collection** — invisible to
 *     this pass; the next resolution adopts it. A boundary, not a bug: the record
 *     cannot know about a write nothing routed through it.
 *  4. **Removed before T1, entry predates T0** — absent from the snapshot, in
 *     `retirable`, identity intact, so retired.
 *  5. **Removed before T1 and recreated after it** — absent from the snapshot and
 *     in `retirable`, but the record now points at a different ref, so kept.
 *  6. **Removed after T1** — the snapshot still carries a ref whose instance is
 *     gone. Its `state` getter falls back to schema defaults, and a task envelope
 *     cannot be defaulted (`id` and `goal` are required), so it reads `{}` with no
 *     id. Adopting that would key the record on `undefined`. Skipped by the id
 *     guard below; if the entry predated T0 it is then retired by rule 4, because
 *     skipping the adopt leaves it out of `stored`.
 *  7. **Removed and recreated after T1** — the snapshot's ref resolves against the
 *     live instance again, so it carries an id and is adopted, and `stored` holds
 *     it so rule 4 leaves it alone.
 *  8. **State-only write (a lifecycle transition)** — membership unchanged, and
 *     every entry reads through a live getter, so there is nothing to reconcile.
 *  9. **A stored instance whose record carries no `id`** (hand-written or
 *     corrupted data, not a race) — indistinguishable here from case 6, and the
 *     same guard covers it. This is why the guard tests the id rather than trying
 *     to detect whether the instance vanished.
 * 10. **Two reconciliations overlapping** — each captures its own `retirable`
 *     before its own read, and retiring is identity-gated, so neither can retire
 *     what the other just adopted. The gate is safe because refs for one storage
 *     key are interchangeable: each reads its state through a live getter over
 *     the same execution-context state, so a slower pass overwriting a newer ref
 *     for the same key loses nothing.
 * 11. **The read itself mutating the cache** — the first nine cases all assume
 *     `collection.list()` observes; for a `prefetchMode: "lazy"` collection it
 *     also writes, bulk-loading the prefix into the execution context on first
 *     call. That once let the pre-read store snapshot reinstate a key the
 *     request had already deleted, producing exactly the ghost rule 4 exists to
 *     prevent, by a route no rule here could see. Fixed underneath us: the
 *     prefix merge now skips keys deleted this request
 *     (`createExecutionContext.ts`). Listed because the enumeration claims to
 *     cover the window, and a read that is not a pure read belongs in it.
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
    // Cases 6 and 9: no usable id means the instance went away mid-read, or the
    // stored record is malformed. Either way there is nothing to key on, and
    // adopting it would plant an unaddressable phantom in a record every handle
    // reads. Leaving it out of `stored` also lets rule 4 retire a prior entry.
    if (typeof id !== "string" || id.length === 0) continue;
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

    let committed: { task: Task<TInput, TOutput>; prevStatus: TaskStatus } | undefined;

    try {
      committed = await updateStateWith(ref, (current) => {
        const task = current as unknown as Task<TInput, TOutput>;
        const reason = transitionDeclineReason(task as Task, targetStatus, guards);
        if (reason !== undefined) {
          throw new WriteDeclined(reason, task.status);
        }
        assertTransitionAllowed(task.status, targetStatus, id);
        const next = applyTransition(task, { ...patch(task), status: targetStatus }, now());
        return {
          state: next as unknown as JsonObject,
          result: { task: next, prevStatus: task.status },
        };
      });
    } catch (err) {
      // Only the decline is absorbed. A store failure, CAS exhaustion, or an
      // illegal transition the caller did not opt out of still propagates.
      if (!(err instanceof WriteDeclined)) throw err;
      return { outcome: "declined", reason: err.reason, status: err.status };
    }

    // The outcome describes the invocation that committed, so a replay that
    // took a different branch cannot report an earlier attempt's write.
    if (committed === undefined) return { outcome: "unchanged" };
    emit(kind, committed.task, committed.prevStatus);
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
      nextTask = await updateStateWith(ref, (current) => {
        const task = current as unknown as Task<TInput, TOutput>;
        if (options?.declineOnTerminal === true && isTerminalStatus(task.status)) {
          throw new WriteDeclined("terminal", task.status);
        }
        const update = patch(task);
        if (update === undefined) return { state: current, result: undefined };
        const next = applyTransition(task, update, now());
        return { state: next as unknown as JsonObject, result: next };
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
    // This backing COUNTS retries but never enforces a budget (FIX-948): the
    // check has to be atomic against the whole ledger and the resource layer has
    // no CAS across instances. `null` says "no limit is in force", which is the
    // truth here — so a caller can never read a non-zero retry count off this
    // board as evidence that a budget applied.
    maxTotalRetries: null,

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

        const claimed = await updateStateWith(candidateRef, (current) => {
          const task = current as unknown as Task<TInput, TOutput>;
          // Re-check eligibility on the freshest state — another worker
          // may have claimed this task in the time between scan and CAS.
          if (!eligibility(task as Task)) return { state: current, result: undefined };
          const next = applyClaimToTask(task, now(), leaseDurationMs);
          return {
            state: next as unknown as JsonObject,
            result: { task: next, prevStatus: task.status },
          };
        });

        if (claimed !== undefined) {
          emit("claimed", claimed.task, claimed.prevStatus);
          return claimed.task;
        }
      }

      return null;
    },

    async complete(id, output, options) {
      return transitionRef(
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
      // ACCOUNTING WITHOUT ENFORCEMENT (FIX-948). This backing maintains the
      // per-task granted-retry count exactly as the sequencer backing does —
      // passing `undefined` for the budget, so the routing can never deny — but
      // it enforces no cumulative bound, because that check must be atomic
      // against the whole ledger and there is no CAS across resource instances.
      // The count is not optional here: it is a public `Task` field feeding the
      // board's retry report, so a durable board that skipped it would report
      // zero retries having actually retried. That is a false statement on a
      // public surface, not a coverage gap.
      //
      // `options` must reach BOTH branches — see the sequencer backing's
      // `fail` for why the status-blind retry predicate makes this the most
      // likely place to ship a partial fix.
      const candidateRef = mirror.get(id);
      if (candidateRef !== undefined) {
        const current = readTaskState<TInput, TOutput>(candidateRef);
        if (routeFailure(current as Task, 0, undefined).action === "retry") {
          return transitionRef(
            id,
            "pending",
            "retried",
            (task) => {
              // Re-decided against the task the write actually sees, so the
              // grant is not recorded off a status that moved since the
              // candidate read above. The patch runs only after the decline
              // check and the legality assert, so nothing lands on a write that
              // is about to be refused.
              const fresh = routeFailure(task as Task, 0, undefined);
              const counts = fresh.action === "retry" && fresh.countsAgainstBudget;
              return {
                feedback: error,
                leaseUntil: undefined,
                error: undefined,
                ...(counts ? { retryLedger: grantRetry(task as Task) } : {}),
              };
            },
            options
          );
        }
      }
      return transitionRef(
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

        const next = await updateStateWith(taskRef, (current) => {
          const t = current as unknown as Task<TInput, TOutput>;
          if (
            t.status !== "in_progress" ||
            t.leaseUntil === undefined ||
            t.leaseUntil >= at
          ) {
            return { state: current, result: undefined };
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
          return { state: reset as unknown as JsonObject, result: reset };
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
