// FIX-992; FIX-443 §3.2; FIX-990.
/**
 * ResourceCollection-backed TaskCollection.
 *
 * Tasks live as instances of a parameterized resource collection
 * (typically `tasks/{id}` pattern), with `scope ∈ { session, user, org }`.
 * Per-task CAS rides the underlying ResourceRef.updateState contract — no
 * sibling projection map needed.
 *
 * When to use over the default state backing: when the collection
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
 * the same updater. That updater runs under a conditional
 * write: a version conflict **re-runs the mutator against refreshed
 * state**, so the loser's re-check sees the winner's `in_progress` row
 * and skips the candidate. A lost race therefore resolves to *no task*,
 * never to an error and never to a second holder.
 *
 * **What that guarantee is scoped to.** At most one holder at a time,
 * for concurrent executions **in one process** — which every adapter
 * satisfies, the filesystem store via a per-key mutex on the store
 * instance. It is not exactly-once dispatch (a lease reclaim
 * deliberately re-dispatches an abandoned task), and it does not hold
 * across two OS processes on the filesystem store, which compares under
 * that in-process lock only. Use SQLite or Postgres where two processes
 * share a board.
 *
 * Async construction + sync mirror: `ResourceCollectionRef` read methods
 * (`get`/`getOptional`/`list`/`count`) are uniformly async. To keep the
 * public `TaskCollectionRef.get/list/count` synchronous, the factory is
 * `async` and hydrates a sync mirror of resource refs (keyed by task id)
 * once at construction via a single `await collection.list()`. Each
 * `ResourceRef.state` is a live getter, so reads through the mirror always
 * reflect the latest committed state for every task the mirror knows
 * about — the mirror only tracks the SET of refs, never a frozen
 * snapshot of their data. Tasks created via `createTask`/`createTasks` are
 * inserted into the mirror as they are created.
 *
 * Freshness boundary. The mirror is **shared by every
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
 *
 * This file is the storage: the mirror, one conditional write per row, the
 * re-read of a stale row, and the ledger's delivery around a write. Every
 * `TaskCollectionRef` method is the method table's (`./method-table`).
 */
import type { JsonObject } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { readCommitted, updateStateWith } from "@flow-state-dev/core/helpers";
import type { Task, TaskClaimIdentity, TaskStatus } from "../schema/task";
import { withRetiredShapes } from "../schema/retired-shapes";
import type { TaskCollectionRef, TaskWriteDeclineReason } from "./types";
import { leaseLapsed, readAbandonments, type FilingStamp } from "./internal";
import type { TaskEndingRecorder } from "./ending";
import type { DeliveryHooks } from "../notice/delivery";
import { LAPSED_SLOT_CHECK_MS, owesUntakenNotice, resendNowPatch } from "../notice/task-notice";
import type { TaskChangeEvent } from "./change-event";
import type { TaskSettingsSupport } from "./filing";
import type { TaskFiledCascade } from "./cascade";
import {
  createTaskMethodTable,
  type TaskDecision,
  type TaskWritten,
  type TaskBoardView,
  type TaskStorage,
  type TaskStorageDelivery,
} from "./method-table";


// FIX-951; extended by FIX-976.
/**
 * Module-private signal that a write declined, on the complete and patch
 * paths, with its reason.
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
 * The method table decides a decline as a value (`{ decline }`); this
 * backing's row write (`writeRow`) is the one place that turns it into this
 * throw and back.
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
   * Fired after a committed write that is no lifecycle change (a run's spend, a
   * cleared marker): with `onChange`, every row write reaches one of the two.
   */
  onWrite?: (task: Task) => void;
  // FIX-480.
  /**
   * Item-log accessor for `TaskHandle.items()`. Reads the
   * response's persistent item buffer at call time so synthesizer
   * prompt-builders can pick from a worker's natural emissions
   * (messages, sources, tool calls). When omitted, `items()` returns
   * `[]` — useful for tests that don't wire a response.
   */
  getItems?: () => readonly OutputItem[];
  /** Clock injection for tests. Default: `Date.now`. */
  now?: () => number;
  // FIX-1005.
  /**
   * Execution coordinate stamped onto `task.claimedBy` at claim time.
   * The factory reads it off the `BlockContext` it already
   * receives; omit it and claims record no coordinate.
   */
  claimIdentity?: TaskClaimIdentity;
  /**
   * The user stamped onto every task this collection adds (`task.createdBy`).
   * The factory reads it off the running session; omit it and tasks record
   * no filer.
   */
  createdBy?: string;
  // FIX-1780; FIX-982.
  /**
   * Refuse `setAssignee` on a task an attempt holds (narrowed to `in_progress`).
   *
   * Set by a task board with dispatcher assignees. The assignee is what a
   * dispatched task's routing key derives from, so reassigning a task whose
   * dispatch is in flight silently strands it — see `TaskCollectionRef.setAssignee`.
   * A pending or blocked task is claimed afresh before it runs, so it can
   * change hands.
   *
   * Only the resource backing carries this, and that is deliberate rather than
   * an omission: a dispatched board is refused at construction unless its backing
   * is durable, so no other backing can host one.
   */
  immutableAssignee?: boolean;
  /**
   * The partition `collection` is narrowed to, reported as the ref's
   * `partition`. The narrowing itself is `collection`'s: this backing reads and
   * writes only through it.
   */
  partition?: string;
  /**
   * The ledger's ending recorder (`defineTaskCollection({ recordEnding })`),
   * run inside every write that records how a task ended. Its `metadata`
   * lands in that same write. See `./ending`.
   */
  recordEnding?: TaskEndingRecorder;
  // FIX-2080.
  /**
   * The filing settings this board honours (`defineTaskCollection({ settings })`). Omitted, only the defaults.
   */
  settings?: TaskSettingsSupport;
  // FIX-2133.
  /** What every row this collection files is stamped with beside its filer. */
  filing?: FilingStamp;
  // FIX-2080 D2.
  /**
   * The board's payer for the tasks a task filed (`defineTaskCollection({ cascadeFiled })`), bound to the running context.
   * Omitted, a cascade covers only this board's dependents.
   */
  cascadeFiled?: TaskFiledCascade;
  // FIX-2078.
  /**
   * The ledger's delivery, bound to the running request: the
   * session filing through this resolution (stamped as each row's filer) and
   * the hooks run around every write that may end a row. Omitted on a ledger
   * no board hands rows out from.
   */
  delivery?: {
    ownSession: string;
    // FIX-2123.
    /** The running request, by its engine identity: stamped as the filing request of each row it files in its own session. */
    ownRequest?: string;
    hooks: DeliveryHooks;
  };
}

// FIX-2080.
/**
 * The read boundary for this backing. Collection instances are stored, not
 * parsed, so a row in a shape the retired-shape map reads arrives
 * as stored; it is mapped forward here (see `withRetiredShapes`), before any
 * filter or the transition guard sees it.
 *
 * Every read of committed task state goes through this — `readTaskState` for
 * a ref, and directly for the `current` a CAS updater is handed, since that
 * mutator re-reads committed state on each retry.
 */
function readTaskStateOf<TInput, TOutput>(
  state: JsonObject
): Task<TInput, TOutput> {
  return withRetiredShapes(state) as unknown as Task<TInput, TOutput>;
}

function readTaskState<TInput, TOutput>(
  ref: ResourceRef<JsonObject>
): Task<TInput, TOutput> {
  return readTaskStateOf<TInput, TOutput>(ref.state);
}

// FIX-990.
/**
 * Per-resource-collection task-set record, module-scoped. See the
 * file header for the freshness contract this implements.
 *
 * Keyed on the `ResourceCollectionRef` **instance**, never on the
 * `collectionId` string. The resource registry builds one collection handle
 * per execution context per scope instance and hands the same object back on
 * every `resolveResourceCollection` call, so instance identity buys
 * per-request and per-scope-instance isolation for free — two sessions,
 * users, or orgs holding a same-named board get separate records. A string
 * key would merge them. Same keying as `skills/seeding.ts`.
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

// FIX-2080 D2.
/**
 * Add the stored tasks `mirror` doesn't hold yet, for a
 * touch's sweep: rows another process filed after this mirror was hydrated.
 * Never replaces or retires an entry; construction's {@link reconcileTaskSet}
 * owns that, for the reasons it lists.
 */
async function adoptUnknownRows(
  mirror: Map<string, ResourceRef<JsonObject>>,
  collection: ResourceCollectionRef<JsonObject>
): Promise<void> {
  for (const ref of await collection.list()) {
    const id = readTaskState(ref).id;
    if (typeof id === "string" && id.length > 0 && !mirror.has(id)) mirror.set(id, ref);
  }
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
  const delivery = options.delivery;

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

  function listAll(): Task[] {
    return Array.from(mirror.values()).map((ref) => readTaskState<unknown, unknown>(ref) as Task);
  }

  /** The board's committed row by id, read through the mirror. */
  function lookupRow(id: string): Task | undefined {
    const r = mirror.get(id);
    return r === undefined ? undefined : (readTaskState(r) as Task);
  }

  /** The board as this process reads it: the mirror, every ref through its live getter. */
  const board: TaskBoardView = { row: lookupRow, rows: listAll };

  /**
   * One row's conditional write. A decline throws {@link WriteDeclined} out of
   * the updater, for the reason documented on that class (returning `current`
   * would still persist and notify), and is caught here into a value. A write
   * that changes nothing writes `current` back, as the store's own no-op.
   */
  async function writeRow<R>(id: string, decide: (row: Task, view: TaskBoardView) => TaskDecision<R>): Promise<TaskWritten<R>> {
    const ref = mirror.get(id);
    if (ref === undefined) {
      throw new Error(`[tasks] task "${id}" not found`);
    }
    try {
      return await updateStateWith<JsonObject, TaskWritten<R>>(ref, (current) => {
        const task = readTaskStateOf<unknown, unknown>(current) as Task;
        const decision = decide(task, board);
        if (decision === undefined) return { state: current, result: undefined };
        if ("decline" in decision) throw new WriteDeclined(decision.decline, task.status);
        return { state: decision.row as unknown as JsonObject, result: { committed: decision.result } };
      });
    } catch (err) {
      // Only the decline is absorbed. A store failure, CAS exhaustion, or an
      // illegal transition the caller did not opt out of still propagates.
      if (!(err instanceof WriteDeclined)) throw err;
      return { declined: err.reason, status: err.status };
    }
  }

  // FIX-2078.
  /** Deliver what `row` owes its filer now. Never fails the committed write. */
  async function deliverAfter(row: Task): Promise<void> {
    if (delivery === undefined) return;
    await delivery.hooks.afterEnding(row, listAll(), async (id, patch) => {
      await ref.patchMetadata(id, patch);
    });
  }

  /**
   * Whether a write to `target` may end the row, or make it ready (a retry):
   * either owes the filer's pass. Decided before the write, so it errs toward
   * owing: no check of the row's status, which a concurrent writer may have
   * moved. A spare wake costs one pass that finds nothing.
   */
  function mayEnd(target: TaskStatus): boolean {
    return target === "completed" || target === "errored" || target === "cancelled" || target === "pending";
  }

  // FIX-2078; FIX-2123.
  /**
   * The filer a new row is stamped with: the session filing it, or,
   * for a follow-up, its root's filer, whoever typed it. With the request
   * filing it when that is the filer's session: the row's notice
   * waits for that request to end.
   */
  function filerFor(init: { followUpOf?: string }): Task["filer"] {
    if (delivery === undefined) return undefined;
    const root = init.followUpOf === undefined ? undefined : lookupRow(init.followUpOf);
    const sessionId = (root === undefined ? undefined : delivery.hooks.filerOf(root)) ?? delivery.ownSession;
    const filing = sessionId === delivery.ownSession ? delivery.ownRequest : undefined;
    return { sessionId, ...(filing !== undefined ? { requestId: filing } : {}) };
  }

  // FIX-2123.
  /**
   * Note a row this request filed with itself as the filing request,
   * and ask to be called as the request ends: a notice turned
   * away while it ran is sent then, past any backoff, rather than at the
   * pass's next resend. The delivery registers once per request and board,
   * so the call reads every row the request filed there, whichever
   * resolution of the board filed it. At a park `send` doesn't run: the
   * delivery owes the filer's pass a wake, and the pass sends.
   */
  function noteFiled(row: Task): void {
    if (delivery?.ownRequest === undefined || row.filer?.requestId !== delivery.ownRequest) return;
    sendOwedAtStop();
  }

  // FIX-2170.
  /**
   * Note a wait slot this request lapsed, and ask to be called as
   * the request ends, as {@link noteFiled} does: at a park, the delivery owes
   * the filer's pass a wake, and that pass releases the slot, so an ending it
   * holds goes out while the request is parked. No row is read or written at
   * the park. The request's end releases the slot itself (`waitOnTask`).
   */
  function noteLapsed(row: Task | undefined): void {
    const own = delivery?.ownRequest;
    if (own === undefined || row?.wait?.lapsed !== true || row.wait.requestId !== own) return;
    sendOwedAtStop();
  }

  /**
   * Ask the delivery to send, as this request ends, what the rows it filed
   * still owe: once per request and board. Registered for a row the request
   * filed ({@link noteFiled}) and for a wait slot it lapsed
   * ({@link noteLapsed}): either way its park owes the filer's pass a wake.
   */
  function sendOwedAtStop(): void {
    const own = delivery?.ownRequest;
    if (delivery === undefined || own === undefined) return;
    delivery.hooks.whenRequestEnds?.(async () => {
      await adoptUnknownRows(mirror, options.collection);
      for (const filed of listAll()) {
        if (filed.filer?.requestId !== own) continue;
        await ref.refresh?.(filed.id);
        const current = lookupRow(filed.id);
        if (current === undefined || !owesUntakenNotice(current)) continue;
        const sooner = resendNowPatch(current);
        if (Object.keys(sooner).length > 0) await ref.patchMetadata(current.id, sooner);
        await deliverAfter(lookupRow(current.id) ?? current);
      }
    });
  }

  /** The ledger's delivery, run around the writes that may end a row. */
  const deliverySteps: TaskStorageDelivery | undefined =
    delivery === undefined
      ? undefined
      : {
          hooks: delivery.hooks,
          // A write that may end a delegated row owes the filer's wake first (FIX-2078).
          async beforeTransition(row, targets, guards) {
            const ending = targets.some(mayEnd);
            if (ending) await delivery.hooks.beforeEnding(row);
            const ownCancel =
              guards?.viaTool === true && targets.includes("cancelled") && delivery.hooks.filerOf(row) === delivery.ownSession;
            return { ending, ownCancel };
          },
          afterEnding: deliverAfter,
          // A row this write could settle (a lapsed lease, or a worker that died
          // before) owes the filer's wake now: the snapshot may say "claim"
          // where the committed row settles, so err toward owing. Any other
          // row's claim owes it at the lease's end, when a worker that died
          // lets the lease lapse.
          async beforeClaim(row, leaseDurationMs) {
            const at = now();
            if (leaseLapsed(row, at) || readAbandonments(row) > 0) {
              await delivery.hooks.beforeEnding(row);
            } else {
              await delivery.hooks.owePassAt(row, at + leaseDurationMs);
            }
          },
          // A lapsed slot is released when its request ends, by the filer's pass
          // once the request parks (FIX-2170), and by that pass when nothing in
          // this process will (a crash). The wake first, so a crash between
          // leaves a wake that pays nothing, never a slot with none.
          async beforeLapseWait(row, gateId) {
            if (row?.wait?.gateId === gateId && row.wait.lapsed !== true) {
              // Read as lapsed: a ledger that owes no notices owes no pass for a lapsed slot either.
              await delivery.hooks.owePassAt({ ...row, wait: { ...row.wait, lapsed: true } } as Task, now() + LAPSED_SLOT_CHECK_MS);
            }
          },
          afterLapsed: noteLapsed,
          // An ending held for the request is owed to the filer once released:
          // the filer's wake first, so a crash between leaves a wake that pays
          // nothing, never a debt with none. Read off the mirror, so it errs
          // toward owing.
          async beforeReleaseWait(row, release, dueAt) {
            if (!release.read && row?.wait?.lapsed === true && row.wait.requestId === release.requestId) {
              await delivery.hooks.owePassAt(row, dueAt);
            }
          },
          filerFor,
        };

  const storage: TaskStorage = {
    board,

    async readCommitted(id) {
      const taskRef = mirror.get(id);
      if (taskRef !== undefined) await readCommitted(taskRef, () => undefined);
    },

    // Rows another process filed after this mirror was hydrated.
    adoptStoredRows: () => adoptUnknownRows(mirror, options.collection),

    write: writeRow,

    // One conditional write per row, in order: the resource layer has no
    // compare-and-set across instances.
    async writeEach(select, decide, { stop, before, committed }) {
      for (const candidate of select(board)) {
        if (!mirror.has(candidate.id)) continue;
        await before?.(candidate);
        const written = await writeRow(candidate.id, decide);
        if (written === undefined || "declined" in written) continue;
        await committed(written.committed);
        if (stop?.(written.committed) === true) return;
      }
    },

    // The check reads the board outside the writes: the method table re-reads
    // a dependency that ended meanwhile once the rows commit.
    async insert(rows, check, inserted) {
      check(board);
      for (const task of rows) {
        const created = await options.collection.create(task.id, task as unknown as JsonObject);
        mirror.set(task.id, created);
        inserted(task);
        noteFiled(task);
      }
    },

    // No `retryBudget`: this backing COUNTS retries but never enforces a
    // budget (FIX-948), as the check has to be atomic against the whole ledger
    // and the resource layer has no CAS across instances. Why the count is not
    // optional is stated once in `task-caps.ts` → "Lifetime" → Resource-backed.

    recording: {
      ...(options.recordEnding !== undefined ? { recordEnding: options.recordEnding } : {}),
      // A delegated row's ending owes its filer a notice (FIX-2078); a cascaded
      // cancel owes none when its cause shares the filer (D2).
      ...(delivery !== undefined
        ? {
            // A ledger that owes no notices still resumes a parked wait (FIX-2082).
            delivers: delivery.hooks.notices !== false,
            causeSharesFiler: (row: Task) => {
              const cause = row.causedBy === undefined ? undefined : lookupRow(row.causedBy);
              return cause !== undefined && delivery.hooks.filerOf(cause) === delivery.hooks.filerOf(row);
            },
          }
        : {}),
    },

    ...(deliverySteps !== undefined ? { delivery: deliverySteps } : {}),
  };

  const ref = createTaskMethodTable<TInput, TOutput>({
    collectionId: options.collectionId,
    ...(options.partition !== undefined ? { partition: options.partition } : {}),
    // The one clock this collection stamps and judges leases against (FIX-1005).
    now,
    storage,
    ...(options.onChange !== undefined ? { onChange: options.onChange } : {}),
    ...(options.onWrite !== undefined ? { onWrite: options.onWrite } : {}),
    ...(options.getItems !== undefined ? { getItems: options.getItems } : {}),
    ...(options.claimIdentity !== undefined ? { claimIdentity: options.claimIdentity } : {}),
    ...(options.createdBy !== undefined ? { createdBy: options.createdBy } : {}),
    ...(options.settings !== undefined ? { settings: options.settings } : {}),
    ...(options.filing !== undefined ? { filing: options.filing } : {}),
    ...(options.immutableAssignee !== undefined ? { immutableAssignee: options.immutableAssignee } : {}),
    ...(options.cascadeFiled !== undefined ? { cascadeFiled: options.cascadeFiled } : {}),
  });

  // A request that runs again after a park (FIX-2123) is a new resolution of
  // the board: its own rows, and the slots it lapsed (FIX-2170), are noted
  // again, so it sends what it held when it ends, and a second park owes the
  // pass a wake again.
  if (delivery?.ownRequest !== undefined) {
    const own = listAll().find((row) => row.filer?.requestId === delivery.ownRequest);
    if (own !== undefined) noteFiled(own);
    noteLapsed(listAll().find((row) => row.wait?.lapsed === true && row.wait.requestId === delivery.ownRequest));
  }

  return ref;
}
