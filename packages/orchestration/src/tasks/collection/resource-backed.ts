/**
 * ResourceCollection-backed TaskCollection (FIX-443 §3.2).
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
 * the same updater. Since FIX-992 that updater runs under a conditional
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
import { readCommitted, updateStateWith } from "@flow-state-dev/core/helpers";
import { withMigratedWait, type Task, type TaskClaimIdentity, type TaskStatus } from "../schema/task";
import type { TaskFilter } from "../schema/task-init";
import {
  assertTransitionAllowed,
  isTerminalStatus,
} from "../schema/task-status";
import { withRetiredShapes } from "../schema/retired-shapes";
import type {
  TaskCollectionRef,
  TaskTransitionOptions,
  TaskWriteDeclineReason,
  TaskWriteOutcome,
} from "./types";
import {
  ATTEMPT_OWNED_STATUSES,
  applyAbandonmentSettlement,
  applyClaimToTask,
  applyTransition,
  type EndingRecording,
  assertValidLeaseDeadline,
  linkRunGuards,
  waitingOnPatch,
  completionPatch,
  cancelPatch,
  progressPatch,
  reportsProgress,
  RENEW_LEASE_TICKET_DETAIL,
  requireClaimTicket,
  runLinkPatch,
  assertValidLeaseDuration,
  buildInitialTask,
  claimDisposition,
  leaseLapsed,
  readAbandonments,
  createTaskHandleWrapper,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_MAX_ABANDONMENTS,
  defaultOrder,
  grantRetry,
  isClaimable,
  listTasks,
  routeFailure,
  transitionDeclineReason,
  assigneeChangeDecline,
  lapseWaitWrite,
  markWaitWrite,
  releaseWaitWrite,
  noticeReadByWaitWrite,
  noticeTakeWrite,
  settingsWrite,
  settingsChangeKind,
  type TaskSettingsPatch,
  type FilingStamp,
} from "./internal";
import { assertAskable, hasOpenQuestion, questionWrite, questionsDue, newRowQuestions, type QuestionChange } from "./questions";
import { stampWrite } from "../write-provenance";
import { generateId } from "../generate-id";
import { steerWrite, takeSteersPatch, untakenSteers } from "../steers";
import type { TaskEndingRecorder } from "./ending";
import type { DeliveryHooks } from "../notice/delivery";
import { NOTICE_DUE_MS, LAPSED_SLOT_CHECK_MS, owesUntakenNotice, resendNowPatch } from "../notice/task-notice";
import type { TaskChangeEvent, TaskChangeKind } from "./change-event";
import { createTaskChangeEmitter } from "./change-event";
import { assertDepsFileable, assertFilingSettings, assertParentsOpen, withFollowUpPlacement, type TaskSettingsSupport } from "./filing";
import {
  cascadeCancelPatch,
  endsDependents,
  openDependentsOf,
  payCascadeAfterWrite,
  payOwedCascades,
  type CascadeWrites,
  type TaskFiledCascade,
} from "./cascade";

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
 * advisory `ifAllowed` / `claim` decline, and the patch helper for the
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
  /**
   * Execution coordinate stamped onto `task.claimedBy` at claim time
   * (FIX-1005). The factory reads it off the `BlockContext` it already
   * receives; omit it and claims record no coordinate.
   */
  claimIdentity?: TaskClaimIdentity;
  /**
   * The user stamped onto every task this collection adds (`task.createdBy`).
   * The factory reads it off the running session; omit it and tasks record
   * no filer.
   */
  createdBy?: string;
  /**
   * Refuse `setAssignee` on a task an attempt holds (FIX-982, narrowed by
   * FIX-1780 to `in_progress`).
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
   * Record that this partition holds a task id, before the row is written
   * (FIX-2160): the partitioned ledger's id index. Omitted on a ledger with
   * no partitions.
   */
  recordTaskId?: (taskId: string) => Promise<void>;
  /**
   * The ledger's ending recorder (`defineTaskCollection({ recordEnding })`),
   * run inside every write that records how a task ended. Its `metadata`
   * lands in that same write. See `./ending`.
   */
  recordEnding?: TaskEndingRecorder;
  /**
   * The filing settings this board honours (FIX-2080;
   * `defineTaskCollection({ settings })`). Omitted, only the defaults.
   */
  settings?: TaskSettingsSupport;
  /** What every row this collection files is stamped with beside its filer (FIX-2133). */
  filing?: FilingStamp;
  /**
   * The board's payer for the tasks a task filed (FIX-2080 D2;
   * `defineTaskCollection({ cascadeFiled })`), bound to the running context.
   * Omitted, a cascade covers only this board's dependents.
   */
  cascadeFiled?: TaskFiledCascade;
  /**
   * The ledger's delivery (FIX-2078), bound to the running request: the
   * session filing through this resolution (stamped as each row's filer) and
   * the hooks run around every write that may end a row. Omitted on a ledger
   * no board hands rows out from.
   */
  delivery?: {
    ownSession: string;
    /** The running request, by its engine identity (FIX-2123): stamped as the filing request of each row it files in its own session. */
    ownRequest?: string;
    hooks: DeliveryHooks;
  };
}

/**
 * The read boundary for this backing. Collection instances are stored, not
 * parsed, so a row written before the wait rename arrives carrying its legacy
 * wait mark, and one in a shape the retired-shape map reads (FIX-2080); both
 * are mapped forward here (see `withMigratedWait` and
 * `withRetiredShapes`), before any filter or the transition guard sees it.
 *
 * Every read of committed task state goes through this — `readTaskState` for
 * a ref, and directly for the `current` a CAS updater is handed, since that
 * mutator re-reads committed state on each retry.
 */
function readTaskStateOf<TInput, TOutput>(
  state: JsonObject
): Task<TInput, TOutput> {
  return withRetiredShapes(withMigratedWait(state)) as unknown as Task<TInput, TOutput>;
}

function readTaskState<TInput, TOutput>(
  ref: ResourceRef<JsonObject>
): Task<TInput, TOutput> {
  return readTaskStateOf<TInput, TOutput>(ref.state);
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

/**
 * Add the stored task rows `mirror` doesn't hold yet (FIX-2080 D2), for a
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
  const onChange = options.onChange;
  // Every write hands the ledger's recorder to the one place an ending is
  // detected and recorded (`applyTransition`, `applyAbandonmentSettlement`).
  // A cascade is owed (FIX-2080 D2) when a failed or cancelled row has an open
  // dependent on this board, or the board's filed-task payer says this ending
  // owes it one. Read inside the write, against the rows as committed.
  const filed = options.cascadeFiled;
  const delivery = options.delivery;
  const recording: EndingRecording = {
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
    owesCascade: (row, ending) =>
      (endsDependents(ending) && openDependentsOf(listAll() as Task[], row.id).length > 0) ||
      filed?.owes(row, ending) === true,
  };
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

  const emit = createTaskChangeEmitter<TInput, TOutput>(
    options.collectionId,
    onChange
  );

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
   *
   * `kind: null` performs the transition without publishing a `task-change`
   * item. Exactly one caller passes it — `renewLease` (FIX-1005) — and the
   * reason is that a renewal is **not a lifecycle change**: nothing about the
   * task moved, and announcing one every cadence tick per running job would
   * both spam every subscribed client with a re-claim that did not happen and
   * wake every idle worker on the board into a full collection scan. The
   * store's own `resource_change` still fires, unchanged.
   *
   * The ending itself is detected where every write passes,
   * `applyTransition`, which runs the ledger's recorder in the same write
   * (FIX-1794 P2).
   */
  async function transitionRef(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind | null,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>,
    guards?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome> {
    const ref = mirror.get(id);
    if (ref === undefined) {
      throw new Error(`[tasks] task "${id}" not found`);
    }
    // A write that may end a delegated row owes the filer's wake first (FIX-2078).
    const ending = delivery !== undefined && mayEnd(readTaskState(ref) as Task, targetStatus);
    if (ending) await delivery!.hooks.beforeEnding(readTaskState(ref) as Task);
    const ownCancel =
      guards?.viaTool === true &&
      targetStatus === "cancelled" &&
      delivery !== undefined &&
      delivery.hooks.filerOf(readTaskState(ref) as Task) === delivery.ownSession;
    const writeRecording: EndingRecording = {
      ...recording,
      ...(ownCancel ? { ownCancel: true } : {}),
    };

    let committed: { task: Task<TInput, TOutput>; prevStatus: TaskStatus } | undefined;

    try {
      committed = await updateStateWith(ref, (current) => {
        const task = readTaskStateOf<TInput, TOutput>(current);
        const reason = transitionDeclineReason(
          task as Task,
          targetStatus,
          guards,
          options.collectionId,
          now(),
          kind ?? undefined
        );
        if (reason !== undefined) {
          throw new WriteDeclined(reason, task.status);
        }
        assertTransitionAllowed(task.status, targetStatus, id);
        // Stamped here, inside the serialized write, off the `task` this
        // invocation read. Since FIX-992 this updater is re-run against
        // refreshed state on a version conflict, so a stamp derived from
        // anything captured outside would describe an attempt that never
        // committed — deriving it from `current` is what makes a replay correct
        // with nothing to reset (FIX-989).
        const next = stampWrite(
          task,
          applyTransition(
            task,
            { ...patch(task), status: targetStatus },
            now(),
            writeRecording
          ),
          guards?.write
        );
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
    if (kind !== null) emit(kind, committed.task, committed.prevStatus);
    // The ending's own pass pays the cascade it owes (FIX-2080 D2).
    await payCascadeAfterWrite(cascadeWrites, committed.task as Task);
    // Then the delivery, so a notice names the dependents just cancelled.
    if (ending) await deliverAfter(committed.task as Task);
    return { outcome: "recorded" };
  }

  /** Deliver what `row` owes its filer now (FIX-2078). Never fails the committed write. */
  async function deliverAfter(row: Task): Promise<void> {
    if (delivery === undefined) return;
    await delivery.hooks.afterEnding(row, listAll() as Task[], async (id, patch) => {
      await ref.patchMetadata(id, patch);
    });
  }

  /**
   * Whether a write to `target` may end the row, or make it ready (a retry):
   * either owes the filer's pass. Read off the mirror,
   * outside the write, so it errs toward owing: no check of the row's status,
   * which a concurrent writer may have moved. A spare wake costs one pass that
   * finds nothing.
   */
  function mayEnd(_row: Task, target: TaskStatus): boolean {
    return target === "completed" || target === "errored" || target === "cancelled" || target === "pending";
  }

  /**
   * Patch a task's fields inside the resource's serialized write, returning what
   * it did (FIX-976).
   *
   * `declineOnTerminal` is the terminal guard for the writes that change a
   * task's future (epic constraint A1): `setAssignee` and the settings write
   * pass it. The four sibling patch methods pass nothing and keep
   * writing to terminal tasks, which a first-party block depends on (the
   * supervisor's failure-category audit). Making this helper-wide would break it.
   *
   * `patch` runs inside the same write, so it may decline too by throwing
   * `WriteDeclined` (as `setAssignee`'s dispatch rule does).
   *
   * The decline throws `WriteDeclined` out of the updater rather than returning
   * `current`, for the reason documented on that class: on this backing
   * returning `current` still persists and still notifies.
   */
  async function patchRef(
    id: string,
    kind: TaskChangeKind | null | ((prev: Task<TInput, TOutput>, next: Task<TInput, TOutput>) => TaskChangeKind),
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>> | undefined,
    options?: { declineOnTerminal?: boolean }
  ): Promise<TaskWriteOutcome> {
    const ref = mirror.get(id);
    if (ref === undefined) {
      throw new Error(`[tasks] task "${id}" not found`);
    }

    let written: { next: Task<TInput, TOutput>; prev: Task<TInput, TOutput> } | undefined;

    try {
      written = await updateStateWith(ref, (current) => {
        const task = readTaskStateOf<TInput, TOutput>(current);
        if (options?.declineOnTerminal === true && isTerminalStatus(task.status)) {
          throw new WriteDeclined("terminal", task.status);
        }
        const update = patch(task);
        if (update === undefined) return { state: current, result: undefined };
        const next = stampWrite(task, applyTransition(task, update, now(), recording));
        return { state: next as unknown as JsonObject, result: { next, prev: task } };
      });
    } catch (err) {
      if (!(err instanceof WriteDeclined)) throw err;
      return { outcome: "declined", reason: err.reason, status: err.status };
    }

    if (written === undefined) return { outcome: "unchanged" };
    const changeKind = typeof kind === "function" ? kind(written.prev, written.next) : kind;
    if (changeKind !== null) {
      emit(changeKind, written.next, written.prev.status !== written.next.status ? written.prev.status : undefined);
    }
    return { outcome: "recorded" };
  }

  /**
   * The filer a new row is stamped with (FIX-2078): the session filing it, or,
   * for a follow-up, its root's filer, whoever typed it. With the request
   * filing it when that is the filer's session (FIX-2123): the row's notice
   * waits for that request to end.
   */
  function filerFor(init: { followUpOf?: string }): Task["filer"] {
    if (delivery === undefined) return undefined;
    const root = init.followUpOf === undefined ? undefined : lookupRow(init.followUpOf);
    const sessionId = (root === undefined ? undefined : delivery.hooks.filerOf(root)) ?? delivery.ownSession;
    const filing = sessionId === delivery.ownSession ? delivery.ownRequest : undefined;
    return { sessionId, ...(filing !== undefined ? { requestId: filing } : {}) };
  }

  /**
   * Note a row this request filed with itself as the filing request
   * (FIX-2123), and ask to be called as the request ends: a notice turned
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

  /**
   * Note a wait slot this request lapsed (FIX-2170), and ask to be called as
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
      for (const filed of listAll() as Task[]) {
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

  /**
   * Run a conditional write, and confirm a decline against the committed row
   * before reporting it. A request reads a resource as the snapshot it first
   * took, and a throw from the updater skips the store's check of that
   * snapshot, so a row another request has moved on since (claimed,
   * dispatched, its wait slot released) could be refused on a stale read. A
   * `terminal` decline needs no second look: an ending is final.
   */
  async function confirmedDecline(id: string, write: () => Promise<TaskWriteOutcome>): Promise<TaskWriteOutcome> {
    const outcome = await write();
    if (outcome.outcome !== "declined" || outcome.reason === "terminal") return outcome;
    const ref = mirror.get(id);
    if (ref === undefined) return outcome;
    await readCommitted(ref, () => undefined);
    return write();
  }

  /**
   * The one hold write (FIX-2133), decided on the committed row inside the
   * serialized write: `decline` first (a claim fence), then the hold rule.
   */
  function writeHolds(
    id: string,
    kind: TaskChangeKind,
    change: QuestionChange,
    decline?: (task: Task<TInput, TOutput>) => TaskWriteDeclineReason | undefined
  ): Promise<TaskWriteOutcome> {
    return patchRef(id, kind, (task) => {
      const fenced = decline?.(task);
      if (fenced !== undefined) throw new WriteDeclined(fenced, task.status);
      const decided = questionWrite(task as Task, change);
      if (decided === "unchanged") return undefined;
      if ("decline" in decided) throw new WriteDeclined(decided.decline, task.status);
      return decided.patch as Partial<Task<TInput, TOutput>>;
    });
  }

  /** The board's committed row by id, read through the mirror. */
  function lookupRow(id: string): Task | undefined {
    const r = mirror.get(id);
    return r === undefined ? undefined : (readTaskState(r) as Task);
  }

  /** Each outside dependency as stored now, so one another request ended is refused here (FIX-2114). */
  async function refreshDeps(batch: readonly Pick<Task, "id" | "deps" | "filedByTask">[]): Promise<void> {
    const filed = new Set(batch.map((row) => row.id));
    // The rows each filing depends on, and the task that files it (FIX-2129):
    // both are read committed, not from this process's mirror.
    const read = batch.flatMap((row) => [...(row.deps ?? []), ...(row.filedByTask !== undefined ? [row.filedByTask] : [])]);
    for (const id of new Set(read)) {
      if (!filed.has(id)) await ref.refresh?.(id);
    }
  }

  /**
   * The guarded settings write (FIX-2080, ER-4): `patchSettings`, and `hold`
   * and `release` under their own names, decided on the committed row inside
   * the write.
   */
  function writeSettings(id: string, settings: TaskSettingsPatch): Promise<TaskWriteOutcome> {
    return patchRef(
      id,
      (prev, next) => settingsChangeKind(prev.status, next.status),
      (task) => {
        const decided = settingsWrite(task as Task, settings, lookupRow);
        if (decided === undefined) return undefined;
        if ("decline" in decided) throw new WriteDeclined(decided.decline, task.status);
        return decided.patch as Partial<Task<TInput, TOutput>>;
      },
      { declineOnTerminal: true }
    );
  }

  /**
   * A dependency that ended while `id` was being written (FIX-2080 D2). The
   * check before a filing or a deps edit reads the board outside any write,
   * and an ending's cascade reads it inside its own write: a cancel that
   * commits between the check and the dependent's write sees no dependent,
   * and the check saw no ending, so neither cancels it. Re-read once the
   * dependent has committed: a dependency ended by now cancels it, as its
   * cascade would have. This mirror only sees what this process wrote or
   * listed, so a cancel from another process lands on the next touch's read.
   *
   * @returns Whether the row was cancelled.
   */
  async function cancelIfDepEnded(id: string): Promise<boolean> {
    const row = lookupRow(id);
    if (row === undefined || isTerminalStatus(row.status)) return false;
    for (const depId of row.deps ?? []) {
      const dep = lookupRow(depId);
      if (dep !== undefined && (dep.status === "errored" || dep.status === "cancelled")) {
        await cascadeWrites.cancelDependent(id, dep);
        return true;
      }
    }
    return false;
  }

  /** The reads and writes a cascade is paid with on this board (FIX-2080 D2). */
  const cascadeWrites: CascadeWrites = {
    get: lookupRow,
    list: () => listAll() as Task[],
    cancelDependent: async (id, cause) => {
      await transitionRef(
        id,
        "cancelled",
        "cancelled",
        (dependent) => cascadeCancelPatch(dependent as Task, cause, now()) as Partial<Task<TInput, TOutput>>,
        { ifAllowed: true }
      );
    },
    settle: async (id, due) => {
      await patchRef(id, null, (task) =>
        task.cascadeOwed != null && task.cascadeOwed.due === due ? { cascadeOwed: undefined } : undefined
      );
    },
    ...(filed !== undefined ? { filed } : {}),
  };

  // A request that runs again after a park (FIX-2123) is a new resolution of
  // the board: its own rows, and the slots it lapsed (FIX-2170), are noted
  // again, so it sends what it held when it ends, and a second park owes the
  // pass a wake again.
  if (delivery?.ownRequest !== undefined) {
    const own = listAll().find((row) => row.filer?.requestId === delivery.ownRequest);
    if (own !== undefined) noteFiled(own as Task);
    noteLapsed((listAll() as Task[]).find((row) => row.wait?.lapsed === true && row.wait.requestId === delivery.ownRequest));
  }

  const ref: TaskCollectionRef<TInput, TOutput> = {
    collectionId: options.collectionId,
    ...(options.partition !== undefined ? { partition: options.partition } : {}),
    // The one clock this collection stamps and judges leases against
    // (FIX-1005). Everything comparing against `leaseUntil` reads it, so the
    // claim write and the readers cannot end up on two timelines.
    now,
    // This backing COUNTS retries but never enforces a budget (FIX-948): the
    // check has to be atomic against the whole ledger and the resource layer has
    // no CAS across instances. `null` says "no limit is in force", which is the
    // truth here — so a caller can never read a non-zero retry count off this
    // board as evidence that a budget applied.
    maxTotalRetries: null,

    async createTask(init) {
      assertFilingSettings(init, options.settings, options.collectionId);
      const task = buildInitialTask<TInput, TOutput>(withFollowUpPlacement(init, lookupRow), now(), options.createdBy, filerFor(init), options.filing);
      await refreshDeps([task as Task]);
      assertDepsFileable([task as Task], lookupRow);
      assertParentsOpen([task as Task], lookupRow);
      await options.recordTaskId?.(task.id);
      const created = await options.collection.create(
        task.id,
        task as unknown as JsonObject
      );
      mirror.set(task.id, created);
      emit("added", task);
      noteFiled(task as Task);
      if (await cancelIfDepEnded(task.id)) return lookupRow(task.id) as Task<TInput, TOutput>;
      return task;
    },

    async createTasks(inits) {
      for (const init of inits) assertFilingSettings(init, options.settings, options.collectionId);
      const built = inits.map((init) =>
        buildInitialTask<TInput, TOutput>(withFollowUpPlacement(init, lookupRow), now(), options.createdBy, filerFor(init), options.filing)
      );
      // Every row is checked before any is written; ids in the batch count (FIX-2080).
      await refreshDeps(built as Task[]);
      assertDepsFileable(built as Task[], lookupRow);
      assertParentsOpen(built as Task[], lookupRow);
      const created: Task<TInput, TOutput>[] = [];
      for (const task of built) {
        await options.recordTaskId?.(task.id);
        const createdRef = await options.collection.create(
          task.id,
          task as unknown as JsonObject
        );
        mirror.set(task.id, createdRef);
        created.push(task);
        emit("added", task);
        noteFiled(task as Task);
      }
      // A dependency that ended meanwhile cancels its dependents, and a row
      // that cancels can end another of the batch's, so the pass repeats
      // until it cancels nothing (at most once per row).
      let cancelled = true;
      while (cancelled) {
        cancelled = false;
        for (const task of created) if (await cancelIfDepEnded(task.id)) cancelled = true;
      }
      return created.map((task) => (lookupRow(task.id) ?? task) as Task<TInput, TOutput>);
    },

    async claim(_workerId, claimOptions) {
      // Live lookup so eligibility re-checks see the freshest dep state
      // even when concurrent workers complete dependencies mid-scan.
      const lookup = (id: string): Task | undefined => {
        const r = mirror.get(id);
        return r === undefined ? undefined : (readTaskState(r) as Task);
      };
      // A caller's `eligibility` NARROWS the substrate's candidate set; it does
      // not replace it (FIX-1005). Before this it replaced the default outright,
      // which made recovery unreachable for any dispatcher asserting
      // `status === "pending"` — including the recipe the docs recommended.
      // Widening the built-in predicate could not reach a caller's, so without
      // this composition the substrate's newest invariant would be the one most
      // easily opted out of by accident.
      const narrow = claimOptions?.eligibility;
      const admits = (task: Task, at: number): boolean =>
        isClaimable(task, lookup, at) && (narrow === undefined || narrow(task, listAll() as Task[]));
      const order = claimOptions?.order ?? defaultOrder;

      const leaseDurationMs = claimOptions?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
      assertValidLeaseDuration(leaseDurationMs);

      const candidates = listAll()
        .filter((task) => admits(task as Task, now()))
        .slice()
        .sort(order);

      /** What one candidate's write did — returned, never captured outward. */
      type ClaimWrite = {
        kind: "claimed" | "errored";
        task: Task<TInput, TOutput>;
        prevStatus: TaskStatus;
      };

      for (const candidate of candidates) {
        const candidateRef = mirror.get(candidate.id);
        if (candidateRef === undefined) continue;
        // Before the write, the filer's wake (FIX-2078). A row this write
        // could settle (a lapsed lease, or a worker that died before) owes it
        // now: the snapshot may say "claim" where the committed row settles,
        // so err toward owing. Any other row's claim owes it at the lease's
        // end, when a worker that died lets the lease lapse.
        if (delivery !== undefined) {
          const at = now();
          if (leaseLapsed(candidate as Task, at) || readAbandonments(candidate as Task) > 0) {
            await delivery.hooks.beforeEnding(candidate as Task);
          } else {
            await delivery.hooks.owePassAt(candidate as Task, at + leaseDurationMs);
          }
        }

        const written = await updateStateWith<JsonObject, ClaimWrite | undefined>(
          candidateRef,
          (current) => {
            const task = readTaskStateOf<TInput, TOutput>(current);
            const at = now();
            // Re-check admission on the freshest state — another worker
            // may have claimed this task in the time between scan and CAS.
            if (!admits(task as Task, at)) return { state: current, result: undefined };
            // ADMISSION decided that the claim path should look at this row;
            // DISPOSITION decides what happens to it, here, against committed
            // state. Keeping them apart is what lets the predicate admit a row
            // this branch is about to settle.
            if (claimDisposition(task as Task, at, DEFAULT_MAX_ABANDONMENTS) === "claim") {
              // Three stamps, composed: the claim records where it runs
              // (FIX-1005), the lease is stamped, and the write records its
              // provenance (FIX-989).
              const next = stampWrite(
                task,
                applyClaimToTask(task, at, leaseDurationMs, options.claimIdentity)
              );
              return {
                state: next as unknown as JsonObject,
                result: { kind: "claimed" as const, task: next, prevStatus: task.status },
              };
            }
            // The abandonment settlement is a committed write too, so it
            // advances the record the same way (FIX-989). It is an ending
            // the board made on its own, recorded like any other (FIX-1794 P2).
            const settled = stampWrite(
              task,
              applyAbandonmentSettlement(task, at, DEFAULT_MAX_ABANDONMENTS, recording)
            );
            return {
              state: settled as unknown as JsonObject,
              result: { kind: "errored" as const, task: settled, prevStatus: task.status },
            };
          }
        );

        if (written === undefined) continue;
        // Emitted only after the write commits, so a CAS that lost announces
        // nothing. A settlement is a successful mutation like any other and
        // owes its `task-change` — without it a streamed UI keeps showing
        // `in_progress` on a row storage has terminalized.
        emit(written.kind, written.task, written.prevStatus);
        // Settling is not claiming: keep scanning so one exhausted row at the
        // head of the queue does not hide the work behind it.
        if (written.kind === "errored") {
          await payCascadeAfterWrite(cascadeWrites, written.task as Task);
          await deliverAfter(written.task as Task);
          continue;
        }
        return written.task;
      }

      return null;
    },

    async renewLease(id, leaseUntil, renewOptions) {
      assertValidLeaseDeadline(leaseUntil);
      requireClaimTicket(renewOptions.claim, "renewLease", RENEW_LEASE_TICKET_DETAIL);
      // `in_progress → in_progress` is same-status and therefore legal, so this
      // rides the ordinary transition path and picks up all four decline arms
      // — including the lease fence, which is the one that motivated the verb:
      // a renewal that COMMITS after the lease it held is refused rather than
      // installing a deadline on a row nobody holds.
      //
      // ONE field. `updatedAt` moves because every write through
      // `applyTransition` moves it, and that is the right answer here rather
      // than an exception: the claim commits `leaseUntil` and `updatedAt` from
      // one clock, so keeping them in step is what preserves
      // `leaseUntil - updatedAt === the committed span` across a renewal.
      // A held row renews no lease (FIX-2133): a renewal racing a midway question loses.
      return transitionRef(
        id,
        "in_progress",
        null,
        () => ({ leaseUntil }),
        { ...renewOptions, ifAllowed: true, refuseWithOpenQuestion: "any" }
      );
    },

    async linkRun(id, run, linkOptions) {
      // The run naming itself on its task (FIX-1668). Same-status, so this
      // rides the ordinary transition path with renewal's guards; unlike a
      // renewal it IS a change a reader acts on, so it publishes `run_linked`.
      return transitionRef(id, "in_progress", "run_linked", () => runLinkPatch(run), linkRunGuards(linkOptions));
    },

    async setKeptOpenBy(id, keptOpenBy, waitOptions) {
      requireClaimTicket(
        waitOptions?.claim,
        "setKeptOpenBy",
        "of the attempt that waits. Only the request holding a task's claim records what it waits on."
      );
      // Same-status, fenced like a run link: a finished, recreated or reclaimed
      // row declines. No `task-change`, as a renewal publishes none.
      return transitionRef(
        id,
        "in_progress",
        null,
        (task) => waitingOnPatch(task as Task, keptOpenBy, waitOptions) as Partial<Task<TInput, TOutput>>,
        // A mirror of a run's stop is refused on a row a question holds (FIX-2133).
        { ...linkRunGuards({ claim: waitOptions.claim }), ...(waitOptions.question !== undefined ? { refuseWithOpenQuestion: "row" as const } : {}) }
      );
    },

    async ask(id, asks, askOptions) {
      requireClaimTicket(askOptions?.claim, "ask", "of the turn that asks. Only the request holding a task's claim asks midway.");
      assertAskable(asks);
      const guards = linkRunGuards({ claim: askOptions.claim });
      // Minted once, outside the write, so a retried write opens the same holds.
      const holds = newRowQuestions(asks, now(), { ...(options.filing?.questionDueMs !== undefined ? { dueMs: options.filing.questionDueMs } : {}), midway: true });
      const outcome = await confirmedDecline(id, () =>
        writeHolds(id, "asked", { op: "ask", questions: holds }, (task) =>
          transitionDeclineReason(task as Task, "in_progress", guards, options.collectionId, now())
        )
      );
      return outcome.outcome === "recorded" ? { ...outcome, questions: holds.map((hold) => hold.id) } : outcome;
    },

    async answer(id, answer) {
      // Minted once, outside the write, so a retried write keeps one steer.
      const change: QuestionChange = { op: "answer", answer, steerId: generateId("steer"), at: now() };
      return confirmedDecline(id, () => writeHolds(id, "answered", change));
    },

    async payQuestionDeadlines() {
      // Rows another process filed are read too, so their deadlines are paid.
      await adoptUnknownRows(mirror, options.collection);
      const at = now();
      const paid: string[] = [];
      for (const row of listAll() as Task[]) {
        if (questionsDue(row, at).length === 0) continue;
        const outcome = await writeHolds(row.id, "answered", { op: "deadline", at });
        if (outcome.outcome === "recorded") paid.push(row.id);
      }
      return paid;
    },

    async complete(id, output, options) {
      // A checkpoint the worker reported stays the output (FIX-2081).
      return transitionRef(
        id,
        "completed",
        "completed",
        (task) => completionPatch(task as Task, output, now()) as Partial<Task<TInput, TOutput>>,
        options
      );
    },

    async reportProgress(id, progress, progressOptions) {
      requireClaimTicket(
        progressOptions?.claim,
        "reportProgress",
        "of the attempt it reports on. Only the request holding a task's claim reports its progress."
      );
      if (!reportsProgress(progress)) return { outcome: "unchanged" };
      // Same-status, fenced like a run link: a finished, recreated or reclaimed row declines.
      return transitionRef(
        id,
        "in_progress",
        "progress_reported",
        () => progressPatch(progress) as Partial<Task<TInput, TOutput>>,
        linkRunGuards(progressOptions)
      );
    },

    async fail(id, error, options) {
      // Retry-vs-terminal is `routeFailure`'s decision, as on the sequencer
      // backing — see its JSDoc.
      //
      // ACCOUNTING WITHOUT ENFORCEMENT (FIX-948). The budget passed here is
      // always `undefined`, so the routing can never deny; the per-task
      // granted-retry count is still maintained exactly as the sequencer
      // backing maintains it. Why the two are split, and why the count is not
      // optional, is stated once in `task-caps.ts` → "Lifetime" →
      // Resource-backed. Don't restate it here.
      //
      // `options` must reach BOTH branches — see the state backing's
      // `fail` for why the status-blind retry predicate makes this the most
      // likely place to ship a partial fix.
      // `noRetry`: a failure no retry can change skips the retry route.
      const candidateRef = options?.noRetry === true ? undefined : mirror.get(id);
      if (candidateRef !== undefined) {
        const current = readTaskState<TInput, TOutput>(candidateRef);
        if (routeFailure(current as Task, () => 0, undefined).action === "retry") {
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
              const fresh = routeFailure(task as Task, () => 0, undefined);
              const counts = fresh.action === "retry" && fresh.countsAgainstBudget;
              return {
                feedback: error,
                leaseUntil: undefined,
                claimedBy: undefined,
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
          claimedBy: undefined,
        }),
        options
      );
    },

    async hold(id) {
      return writeSettings(id, { held: true });
    },

    async release(id) {
      return writeSettings(id, { held: false });
    },

    async patchSettings(id, settings) {
      const outcome = await writeSettings(id, settings);
      // New dependencies have the filing's window (`cancelIfDepEnded`).
      if (settings.deps !== undefined && outcome.outcome === "recorded") await cancelIfDepEnded(id);
      return outcome;
    },

    async steer(id, input) {
      // Minted once, outside the write, so a retried write keeps one id and one time.
      const steerId = generateId("steer");
      const at = now();
      return patchRef(
        id,
        "steered",
        (task) => {
          const decided = steerWrite(task as Task, input, steerId, at);
          if (decided === "limit") throw new WriteDeclined("steer-limit", task.status);
          return decided === "unchanged" ? undefined : (decided.patch as Partial<Task<TInput, TOutput>>);
        },
        // A finished task takes no steer: its output never changes (FIX-2086).
        { declineOnTerminal: true }
      );
    },

    async takeSteers(id, takeOptions) {
      requireClaimTicket(
        takeOptions?.claim,
        "takeSteers",
        "of the attempt that reads them. Only the request holding a task's claim takes its steers."
      );
      const guards = linkRunGuards({ claim: takeOptions.claim });
      // The steers the committed row had untaken, as the write that lands read them.
      let taken: string[] = [];
      const outcome = await patchRef(id, null, (task) => {
        // Fenced like a run link, on the committed row: a finished, recreated
        // or reclaimed row declines.
        const declined = transitionDeclineReason(task as Task, "in_progress", guards, options.collectionId, now());
        if (declined !== undefined) throw new WriteDeclined(declined, task.status);
        taken = untakenSteers(task as Task).map((steer) => steer.id);
        return takeSteersPatch(task as Task, takeOptions.takenIn) as Partial<Task<TInput, TOutput>> | undefined;
      });
      return { ...outcome, taken: outcome.outcome === "recorded" ? taken : [] };
    },

    async cancel(id, reason, options) {
      // The decline is now REPORTED (FIX-976) — behaviour is unchanged, but the
      // caller learns the cancel did nothing instead of reading silence as
      // success. Substrate write-backs discard this and stay silent.
      return transitionRef(
        id,
        "cancelled",
        "cancelled",
        () => cancelPatch(reason, options?.via, now()) as Partial<Task<TInput, TOutput>>,
        // `ifAllowed` is forced AFTER the spread, not merged into it (FIX-981):
        // a caller's ticket must reach the guard, but "advisory by
        // construction" is this method's contract and a caller cannot switch it
        // off. Unchanged behaviour: cancelling an already-settled task is a
        // no-op, and it emits no `resource_change` for the write it skipped.
        { ...options, ifAllowed: true }
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
          task.leaseUntil >= at ||
          // A held row is never taken back (FIX-2133).
          hasOpenQuestion(task as Task)
        ) {
          continue;
        }

        const next = await updateStateWith(taskRef, (current) => {
          const t = readTaskStateOf<TInput, TOutput>(current);
          if (
            t.status !== "in_progress" ||
            t.leaseUntil === undefined ||
            t.leaseUntil >= at ||
            hasOpenQuestion(t as Task)
          ) {
            return { state: current, result: undefined };
          }
          // Preserve `assignee` — it's the user-set worker-registry
          // routing key, not the runtime worker identity. Clearing it
          // would break re-dispatch through a worker registry.
          const reset: Task<TInput, TOutput> = stampWrite(t, {
            ...t,
            status: "pending",
            leaseUntil: undefined,
            claimedBy: undefined,
            updatedAt: at,
          });
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
      // task is refused, because its work will never run again. On a dispatched
      // board a task an attempt holds (`in_progress`) is refused too (FIX-982,
      // narrowed by FIX-1780): its dispatch is keyed by the assignee it was
      // claimed with.
      // The check runs inside the write, so a claim that lands first refuses
      // the move rather than racing it.
      const write = () =>
        patchRef(
          id,
          "assignee_changed",
          (task) => {
            if (options.immutableAssignee === true && ATTEMPT_OWNED_STATUSES.has(task.status)) {
              throw new WriteDeclined("immutable-assignee", task.status);
            }
            const refused = assigneeChangeDecline(task as Task, assignee);
            if (refused !== undefined) throw new WriteDeclined(refused, task.status);
            return task.assignee === assignee ? undefined : { assignee };
          },
          { declineOnTerminal: true }
        );
      const outcome = await write();
      // A request reads a resource as the snapshot it first took, and a throw
      // from the updater skips the store's check of that snapshot. Unlike
      // `terminal`, an attempt-held status is one another request moves on,
      // so confirm the decline against the committed row before reporting it.
      if (outcome.outcome === "declined" && outcome.reason === "immutable-assignee") {
        const ref = mirror.get(id);
        if (ref !== undefined) {
          await readCommitted(ref, () => undefined);
          return write();
        }
      }
      return outcome;
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

    async clearResumeOwed(id) {
      return patchRef(id, "resume_settled", (task) =>
        task.resumeOwed === true ? { resumeOwed: undefined } : undefined
      );
    },

    ...(delivery !== undefined ? { filerOf: (row: Task) => delivery.hooks.filerOf(row) } : {}),
    ...(delivery?.hooks.tellMidwayQuestions !== undefined
      ? { tellMidwayQuestions: (row: Task) => delivery.hooks.tellMidwayQuestions!(row) }
      : {}),

    async markCancelOwed(id) {
      return patchRef(id, "cancel_owed", (task) =>
        task.wait != null && !isTerminalStatus(task.status) && task.cancelOwed !== true
          ? { cancelOwed: true }
          : undefined
      );
    },

    async markWait(id, slot) {
      return confirmedDecline(id, () =>
        patchRef(id, "wait_changed", (task) => {
          const decided = markWaitWrite(task as Task, slot);
          if (decided === undefined) return undefined;
          if ("decline" in decided) throw new WriteDeclined(decided.decline, task.status);
          return decided.patch as Partial<Task<TInput, TOutput>>;
        })
      );
    },

    async lapseWait(id, gateId, requestId) {
      // A lapsed slot is released when its request ends, by the filer's pass
      // once the request parks (FIX-2170), and by that pass when nothing in
      // this process will (a crash). The wake first, so a crash between
      // leaves a wake that pays nothing, never a slot with none.
      const row = lookupRow(id);
      if (delivery !== undefined && row?.wait?.gateId === gateId && row.wait.lapsed !== true) {
        // Read as lapsed: a ledger that owes no notices owes no pass for a lapsed slot either.
        await delivery.hooks.owePassAt({ ...row, wait: { ...row.wait, lapsed: true } } as Task, now() + LAPSED_SLOT_CHECK_MS);
      }
      const lapsed = await patchRef(id, "wait_changed", (task) => {
        const decided = lapseWaitWrite(task as Task, gateId, requestId);
        if (decided === undefined) return undefined;
        if ("decline" in decided) throw new WriteDeclined(decided.decline, task.status);
        return decided.patch as Partial<Task<TInput, TOutput>>;
      });
      if (lapsed.outcome === "recorded") noteLapsed(lookupRow(id));
      return lapsed;
    },

    async releaseWait(id, release) {
      const dueAt = now() + NOTICE_DUE_MS;
      // An ending held for the request is owed to the filer once released:
      // the filer's wake first, so a crash between leaves a wake that pays
      // nothing, never a debt with none. Read off the mirror, so it errs
      // toward owing.
      const row = lookupRow(id);
      if (!release.read && delivery !== undefined && row?.wait?.lapsed === true && row.wait.requestId === release.requestId) {
        await delivery.hooks.owePassAt(row, dueAt);
      }
      return patchRef(id, "wait_changed", (task) => releaseWaitWrite(task as Task, { ...release, dueAt })?.patch as Partial<Task<TInput, TOutput>> | undefined);
    },

    async dropNoticeReadByWait(id) {
      return patchRef(id, "metadata_changed", (task) => noticeReadByWaitWrite(task as Task)?.patch as Partial<Task<TInput, TOutput>> | undefined);
    },

    async takeNotice(id, notice, take) {
      const at = now();
      return patchRef(id, "metadata_changed", (task) => noticeTakeWrite(task as Task, notice, { ...take, at })?.patch as Partial<Task<TInput, TOutput>> | undefined);
    },

    async refresh(id) {
      const taskRef = mirror.get(id);
      if (taskRef !== undefined) await readCommitted(taskRef, () => undefined);
    },

    async payOwedCascades() {
      // Another process may have filed rows this mirror has never seen, whose
      // dependency has since ended: adopt them first, so the sweep can cancel
      // them. Only unknown rows: a ref the mirror already holds is live, and
      // replacing it with a listed one could read back what this request has
      // already moved past.
      await adoptUnknownRows(mirror, options.collection);
      return payOwedCascades(cascadeWrites, now());
    },

    get(id) {
      const taskRef = mirror.get(id);
      return taskRef === undefined
        ? undefined
        : wrap(readTaskState<TInput, TOutput>(taskRef));
    },

    async getCommitted(id) {
      // A request reads a resource as the snapshot it first took; another
      // request's write (a steer, say) lands in the store, not in that
      // snapshot. A read that changes nothing brings this one up to date.
      const taskRef = mirror.get(id);
      if (taskRef === undefined) return undefined;
      await readCommitted(taskRef, () => undefined);
      return wrap(readTaskState<TInput, TOutput>(taskRef));
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
