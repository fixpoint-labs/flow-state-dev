/**
 * The task collection's method table: every `TaskCollectionRef` method,
 * written once over a {@link TaskStorage} each backing supplies.
 *
 * A backing (`state-backed.ts`, `resource-backed.ts`) owns how rows are
 * stored: reading one, reading it committed, listing, a compare-and-set write,
 * and what it runs around a write (the resource backing's delivery). The
 * table owns what a write means: the guards, the decline, the stamps, the
 * ending's recording, the emitted change and the cascade it owes.
 *
 * Every row write passes through one of two functions here, {@link patch}
 * for a field write and {@link transition} for a status move (claims and
 * lease reclaims are a third shape of the same write, through
 * `storage.writeEach`). A refused write is decided as a value (`decide`
 * returns `{ decline }`), never thrown by a table method; a backing may
 * throw internally to unwind its own write.
 *
 * Internal to orchestration: not exported from any entry.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { Task, TaskClaimIdentity, TaskStatus } from "../schema/task";
import type { TaskFilter, TaskInit } from "../schema/task-init";
import { assertTransitionAllowed, isTerminalStatus } from "../schema/task-status";
import type { TaskCollectionRef, TaskTransitionOptions, TaskWriteDeclineReason, TaskWriteOutcome } from "./types";
import {
  ATTEMPT_OWNED_STATUSES,
  applyAbandonmentSettlement,
  applyClaimToTask,
  applyTransition,
  assertValidLeaseDeadline,
  assertValidLeaseDuration,
  assigneeChangeDecline,
  buildInitialTask,
  cancelPatch,
  claimDisposition,
  completionPatch,
  createTaskHandleWrapper,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_MAX_ABANDONMENTS,
  defaultOrder,
  denyRetry,
  grantRetry,
  isClaimable,
  lapseWaitWrite,
  linkRunGuards,
  listTasks,
  markWaitWrite,
  noticeReadByWaitWrite,
  noticeTakeWrite,
  progressPatch,
  releaseWaitWrite,
  RENEW_LEASE_TICKET_DETAIL,
  reportsProgress,
  requireClaimTicket,
  retryBudgetExhaustedError,
  retryWrite,
  routeFailure,
  runLinkPatch,
  settingsChangeKind,
  settingsWrite,
  sumGrantedRetries,
  transitionDeclineReason,
  waitingOnPatch,
  type EndingRecording,
  type FilingStamp,
  type TaskSettingsPatch,
} from "./internal";
import { assertAskable, hasOpenHold, holdWrite, holdsDue, newRowHolds, type HoldChange } from "./holds";
import { stampWrite } from "../write-provenance";
import { spendAfterWrite } from "../spend";
import { ticketNamesIncarnation } from "../claim-ticket";
import { generateId } from "../generate-id";
import { steerWrite, takeSteersPatch, untakenSteers } from "../steers";
import { NOTICE_DUE_MS } from "../notice/task-notice";
import type { DeliveryHooks } from "../notice/delivery";
import { createTaskChangeEmitter, type TaskChangeEvent, type TaskChangeKind } from "./change-event";
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

/** The board as a write reads it: the committed rows, inside the write where the storage has one. */
export interface TaskBoardView {
  /** One row by id, or `undefined` when the board has none. */
  row(id: string): Task | undefined;
  /** Every row. */
  rows(): readonly Task[];
}

/**
 * What a row write decided, on the committed row inside the write: refuse it,
 * write `row` and report `result`, or (`undefined`) change nothing.
 */
export type RowDecision<R> = { readonly decline: TaskWriteDeclineReason } | { readonly row: Task; readonly result: R } | undefined;

/** What a row write did: refused (with the row's status), committed `result`, or (`undefined`) nothing. */
export type RowWritten<R> =
  | { readonly declined: TaskWriteDeclineReason; readonly status: TaskStatus }
  | { readonly committed: R }
  | undefined;

/**
 * The steps the resource backing runs around a write for its ledger's
 * delivery (FIX-2078): the filer's wake before a write that may end a row,
 * and the notice after it. Absent on a ledger no board hands rows out from.
 */
export interface TaskStorageDelivery {
  /** The ledger's delivery hooks, bound to the running request. */
  readonly hooks: DeliveryHooks;
  /**
   * Before a status move to one of `targets`: owe the filer's wake when the
   * move may end the row. `ending` says whether {@link afterEnding} runs once
   * the write commits; `ownCancel` that the filer cancelled through its own tool.
   */
  beforeTransition(row: Task, targets: readonly TaskStatus[], guards: TaskTransitionOptions | undefined): Promise<{ readonly ending: boolean; readonly ownCancel: boolean }>;
  /** After a committed write that may have ended `row`: deliver what it owes its filer. */
  afterEnding(row: Task): Promise<void>;
  /** Before a claim's write to `row`, which may settle it. */
  beforeClaim(row: Task, leaseDurationMs: number): Promise<void>;
  /** Before lapsing `row`'s wait slot for `gateId`. */
  beforeLapseWait(row: Task | undefined, gateId: string): Promise<void>;
  /** After a committed lapse of `row`'s wait slot. */
  afterLapsed(row: Task | undefined): void;
  /** Before releasing `row`'s lapsed wait slot. */
  beforeReleaseWait(row: Task | undefined, release: { readonly requestId: string; readonly read: boolean }, dueAt: number): Promise<void>;
  /** The filer a new row is stamped with. */
  filerFor(init: { followUpOf?: string }): Task["filer"];
}

/**
 * How a backing stores rows: what the method table writes through. Each
 * backing supplies one, over its own state slot or shared store.
 */
export interface TaskStorage {
  /** The board as this process reads it now. */
  readonly board: TaskBoardView;
  /**
   * Bring one row up to its committed state; a no-op for a row the board
   * doesn't hold. Absent where every read is already the committed one (the
   * state slot): then a decline is never re-read, and the ref has no `refresh`.
   */
  readCommitted?(id: string): Promise<void>;
  /**
   * Read the rows the store holds that this board hasn't read yet (another
   * process filed them), before a sweep over every row. Absent where the
   * board is the store.
   */
  adoptStoredRows?(): Promise<void>;
  /**
   * Compare-and-set write of one row: `decide` runs on the committed row,
   * again on each retry, and its decision is written or refused.
   *
   * @throws when the board has no row `id`.
   */
  write<R>(id: string, decide: (row: Task, board: TaskBoardView) => RowDecision<R>): Promise<RowWritten<R>>;
  /**
   * Compare-and-set write over the rows `select` picks, in its order: each is
   * decided as {@link write} decides one, `committed` runs for each committed
   * result in order, and `stop` ends the batch after a result. A storage that
   * writes the batch in one compare-and-set runs `select` inside it and has
   * no per-row step before it, so it never declares one (`before`).
   */
  writeEach<R>(
    select: (board: TaskBoardView) => readonly Task[],
    decide: (row: Task, board: TaskBoardView) => RowDecision<R>,
    options: {
      readonly stop?: (result: R) => boolean;
      readonly before?: (row: Task) => Promise<void>;
      readonly committed: (result: R) => Promise<void>;
    }
  ): Promise<void>;
  /**
   * Add new rows, after `check` (which throws to refuse them all) has read
   * the board; `inserted` runs for each row as it lands.
   *
   * @throws when a row's id is already on the board.
   */
  insert(rows: readonly Task[], check: (board: TaskBoardView) => void, inserted: (row: Task) => void): Promise<void>;
  /** The retry budget this storage enforces atomically against the whole board; omitted, retries are counted, not capped. */
  readonly retryBudget?: number;
  /** What every ending records besides its cascade: the ledger's recorder and the delivery's notice. */
  readonly recording?: Omit<EndingRecording, "owesCascade" | "ownCancel">;
  /** The delivery steps, where the ledger has a delivery. */
  readonly delivery?: TaskStorageDelivery;
}

/** Options for {@link createTaskMethodTable}: the storage, and what the ref stamps and reports. */
export interface TaskMethodTableOptions {
  readonly collectionId: string;
  /** The partition the storage is narrowed to, reported as the ref's `partition`. */
  readonly partition?: string;
  /** The one clock this collection stamps and judges leases against. */
  readonly now: () => number;
  readonly storage: TaskStorage;
  /** Fired after every committed lifecycle change. */
  readonly onChange?: (event: TaskChangeEvent) => void;
  /** Fired after a committed write that is no lifecycle change. */
  readonly onWrite?: (task: Task) => void;
  /** Item-log accessor for `TaskHandle.items()`. */
  readonly getItems?: () => readonly OutputItem[];
  /** Execution coordinate stamped onto `task.claimedBy` at claim time. */
  readonly claimIdentity?: TaskClaimIdentity;
  /** The user stamped onto every row this collection adds. */
  readonly createdBy?: string;
  /** The filing settings this board honours. */
  readonly settings?: TaskSettingsSupport;
  /** What every row this collection files is stamped with beside its filer. */
  readonly filing?: FilingStamp;
  /** Refuse `setAssignee` on a row an attempt holds (a dispatched board). */
  readonly immutableAssignee?: boolean;
  /** The board's payer for the tasks a task filed. */
  readonly cascadeFiled?: TaskFiledCascade;
}

/** What a status move decided to write, chosen on the committed row inside the write. */
interface DerivedTransition {
  readonly targetStatus: TaskStatus;
  /** `null` writes without publishing a `task-change` item (a lease renewal is no lifecycle change). */
  readonly kind: TaskChangeKind | null;
  readonly patch: (task: Task) => Partial<Task>;
}

/** A field write's decision: refuse it, write `patch`, or (`undefined`) change nothing. */
type PatchDecision = { readonly decline: TaskWriteDeclineReason } | { readonly patch: Partial<Task> } | undefined;

/** A write rule's answer (`settingsWrite`, `retryWrite`, …) as a field write's decision. */
function decided(rule: { patch: Partial<Task> } | { decline: TaskWriteDeclineReason } | "unchanged" | undefined): PatchDecision {
  return rule === undefined || rule === "unchanged" ? undefined : rule;
}

/** Build a `TaskCollectionRef` whose every method is written over `options.storage`. */
export function createTaskMethodTable<TInput = unknown, TOutput = unknown>(
  options: TaskMethodTableOptions
): TaskCollectionRef<TInput, TOutput> {
  const { collectionId, now, storage, cascadeFiled } = options;
  const board = storage.board;
  const delivery = storage.delivery;
  const retryBudget = storage.retryBudget;
  const wrap = createTaskHandleWrapper<TInput, TOutput>(collectionId, options.getItems);
  const emit = createTaskChangeEmitter<unknown, unknown>(collectionId, options.onChange, options.onWrite);

  /** The board's row by id, as read now. */
  const lookup = (id: string): Task | undefined => board.row(id);

  /**
   * What an ending records besides the ending (FIX-2080 D2): a cascade is owed
   * when a failed or cancelled row has an open dependent on the board the
   * write reads, or the board's filed-task payer says this ending owes one.
   */
  function recordingIn(view: TaskBoardView, ownCancel = false): EndingRecording {
    return {
      ...storage.recording,
      ...(ownCancel ? { ownCancel: true } : {}),
      owesCascade: (row, ending) =>
        (endsDependents(ending) && openDependentsOf(view.rows(), row.id).length > 0) || cascadeFiled?.owes(row, ending) === true,
    };
  }

  function requireRow(id: string): Task {
    const row = lookup(id);
    if (row === undefined) throw new Error(`[tasks] task "${id}" not found`);
    return row;
  }

  /**
   * Move a row's status, returning what it did (FIX-976). `derive` chooses
   * the target on the committed row inside the write and must be pure:
   * nothing may be recorded before the decline check, or a displaced worker's
   * late failure could spend another task's retry allowance (FIX-948).
   * `guards` make the write advisory (FIX-951), decided race-free on the same
   * row. `targets` are the statuses `derive` can choose, read by the
   * delivery's wake before the write.
   */
  async function transition(
    id: string,
    targets: readonly TaskStatus[],
    derive: (task: Task, view: TaskBoardView) => DerivedTransition,
    guards?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome> {
    const around = delivery === undefined ? undefined : await delivery.beforeTransition(requireRow(id), targets, guards);
    const written = await storage.write<{ kind: TaskChangeKind | null; task: Task; prevStatus: TaskStatus }>(id, (task, view) => {
      const { targetStatus, kind, patch } = derive(task, view);
      const reason = transitionDeclineReason(task, targetStatus, guards, collectionId, now(), kind ?? undefined);
      if (reason !== undefined) return { decline: reason };
      assertTransitionAllowed(task.status, targetStatus, id);
      // Stamped inside the write, off the row this invocation read, so a
      // replay against a fresher row stamps off that one (FIX-989).
      const next = stampWrite(
        task,
        applyTransition(task, { ...patch(task), status: targetStatus }, now(), recordingIn(view, around?.ownCancel)),
        guards?.write
      );
      return { row: next, result: { kind, task: next, prevStatus: task.status } };
    });
    if (written === undefined) return { outcome: "unchanged" };
    if ("declined" in written) return { outcome: "declined", reason: written.declined, status: written.status };
    const { kind, task, prevStatus } = written.committed;
    emit(kind, task, prevStatus);
    // The ending's own pass pays the cascade it owes (FIX-2080 D2), then the
    // delivery, so a notice names the dependents just cancelled.
    await payCascadeAfterWrite(cascadeWrites, task);
    if (around?.ending === true) await delivery!.afterEnding(task);
    return { outcome: "recorded" };
  }

  /** {@link transition} to one fixed target. */
  function transitionTo(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind | null,
    patch: (task: Task) => Partial<Task>,
    guards?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome> {
    return transition(id, [targetStatus], () => ({ targetStatus, kind, patch }), guards);
  }

  /**
   * Write a row's fields, returning what it did (FIX-976). `declineOnTerminal`
   * is the terminal guard for the writes that change a task's future (epic
   * constraint A1); the plain field writes keep writing to terminal rows,
   * which the supervisor's failure-category audit depends on.
   */
  async function patch(
    id: string,
    kind: TaskChangeKind | null | ((prev: Task, next: Task) => TaskChangeKind),
    decide: (task: Task, view: TaskBoardView) => PatchDecision,
    patchOptions?: { declineOnTerminal?: boolean }
  ): Promise<TaskWriteOutcome> {
    const written = await storage.write<{ next: Task; prev: Task }>(id, (task, view) => {
      if (patchOptions?.declineOnTerminal === true && isTerminalStatus(task.status)) return { decline: "terminal" };
      const decision = decide(task, view);
      if (decision === undefined || "decline" in decision) return decision;
      const next = stampWrite(task, applyTransition(task, decision.patch, now(), recordingIn(view)));
      return { row: next, result: { next, prev: task } };
    });
    if (written === undefined) return { outcome: "unchanged" };
    if ("declined" in written) return { outcome: "declined", reason: written.declined, status: written.status };
    const { next, prev } = written.committed;
    emit(typeof kind === "function" ? kind(prev, next) : kind, next, prev.status !== next.status ? prev.status : undefined);
    return { outcome: "recorded" };
  }

  /**
   * Run a write, and where the storage's reads can lag the store, confirm a
   * decline against the committed row before reporting it: a row another
   * request moved on since (claimed, its wait slot released) could be refused
   * on a stale read. `confirms` picks which declines are re-read; a `terminal`
   * one never is, as an ending is final unless a retry reopens it.
   */
  async function confirmed(
    id: string,
    write: () => Promise<TaskWriteOutcome>,
    confirms: (reason: TaskWriteDeclineReason) => boolean = (reason) => reason !== "terminal"
  ): Promise<TaskWriteOutcome> {
    const outcome = await write();
    if (outcome.outcome !== "declined" || !confirms(outcome.reason) || storage.readCommitted === undefined) return outcome;
    if (lookup(id) === undefined) return outcome;
    await storage.readCommitted(id);
    return write();
  }

  /** Bring each outside row a batch depends on, and the task filing it, up to its committed state (FIX-2114, FIX-2129). */
  async function refreshDeps(batch: readonly Pick<Task, "id" | "deps" | "filedByTask">[]): Promise<void> {
    if (storage.readCommitted === undefined) return;
    const filed = new Set(batch.map((row) => row.id));
    const read = batch.flatMap((row) => [...(row.deps ?? []), ...(row.filedByTask !== undefined ? [row.filedByTask] : [])]);
    for (const id of new Set(read)) {
      if (!filed.has(id)) await storage.readCommitted(id);
    }
  }

  /**
   * A dependency that ended while `id` was written (FIX-2080 D2). Where the
   * check before a filing or a deps edit reads the board outside the row's
   * write, an ending committed between the check and the write sees no
   * dependent, and the check saw no ending, so neither cancels it. Re-read
   * once the row has committed: a dependency ended by now cancels it, as its
   * cascade would have. Where the check runs inside the write, it finds none.
   *
   * @returns Whether the row was cancelled.
   */
  async function cancelIfDepEnded(id: string): Promise<boolean> {
    const row = lookup(id);
    if (row === undefined || isTerminalStatus(row.status)) return false;
    for (const depId of row.deps ?? []) {
      const dep = lookup(depId);
      if (dep !== undefined && (dep.status === "errored" || dep.status === "cancelled")) {
        await cascadeWrites.cancelDependent(id, dep);
        return true;
      }
    }
    return false;
  }

  /** The guarded settings write (FIX-2080, ER-4): `patchSettings`, and `hold` and `release` under their own names. */
  function writeSettings(id: string, settings: TaskSettingsPatch): Promise<TaskWriteOutcome> {
    return patch(
      id,
      (prev, next) => settingsChangeKind(prev.status, next.status),
      (task, view) => decided(settingsWrite(task, settings, view.row)),
      { declineOnTerminal: true }
    );
  }

  /** The one hold write (FIX-2133): `fence` first (a claim fence), then the hold rule. */
  function writeHolds(
    id: string,
    kind: TaskChangeKind,
    change: HoldChange,
    fence?: (task: Task) => TaskWriteDeclineReason | undefined
  ): Promise<TaskWriteOutcome> {
    return patch(id, kind, (task) => {
      const fenced = fence?.(task);
      return fenced !== undefined ? { decline: fenced } : decided(holdWrite(task, change));
    });
  }

  /**
   * File `inits`: every row is checked before any is written, ids in the
   * batch count (FIX-2080), and a dependency that ended meanwhile cancels its
   * dependents, repeated until it cancels nothing (a cancel can end another
   * row of the batch).
   */
  async function file(inits: readonly TaskInit<TInput>[]): Promise<Task<TInput, TOutput>[]> {
    for (const init of inits) assertFilingSettings(init, options.settings, collectionId);
    // Built once, outside the write, so id and createdAt are stable across retries.
    const built = inits.map(
      (init) =>
        buildInitialTask<TInput, TOutput>(
          withFollowUpPlacement(init, lookup),
          now(),
          options.createdBy,
          delivery?.filerFor(init),
          options.filing
        ) as Task
    );
    if (built.length === 0) return [];
    await refreshDeps(built);
    await storage.insert(
      built,
      (view) => {
        assertDepsFileable(built, view.row);
        assertParentsOpen(built, view.row);
      },
      (row) => emit("added", row)
    );
    let cancelled = true;
    while (cancelled) {
      cancelled = false;
      for (const row of built) if (await cancelIfDepEnded(row.id)) cancelled = true;
    }
    return built.map((row) => (lookup(row.id) ?? row) as Task<TInput, TOutput>);
  }

  /** The reads and writes a cascade is paid with on this board (FIX-2080 D2). */
  const cascadeWrites: CascadeWrites = {
    get: lookup,
    list: () => board.rows(),
    cancelDependent: async (id, cause) => {
      await transitionTo(id, "cancelled", "cancelled", (dependent) => cascadeCancelPatch(dependent, cause, now()), { ifAllowed: true });
    },
    settle: async (id, due) => {
      await patch(id, null, (task) =>
        task.cascadeOwed != null && task.cascadeOwed.due === due ? { patch: { cascadeOwed: undefined } } : undefined
      );
    },
    ...(cascadeFiled !== undefined ? { filed: cascadeFiled } : {}),
  };

  const ref: TaskCollectionRef<TInput, TOutput> = {
    collectionId,
    ...(options.partition !== undefined ? { partition: options.partition } : {}),
    now,
    // `null` means no limit is in force: a storage that counts retries
    // without capping them reports it too (FIX-948).
    maxTotalRetries: retryBudget ?? null,

    async createTask(init) {
      const [row] = await file([init]);
      return row!;
    },

    async createTasks(inits) {
      return file(inits);
    },

    async claim(_workerId, claimOptions) {
      const leaseDurationMs = claimOptions?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
      assertValidLeaseDuration(leaseDurationMs);
      // A caller's `eligibility` NARROWS the substrate's candidate set; it does
      // not replace it (FIX-1005), or recovery would be opt-out by accident.
      const narrow = claimOptions?.eligibility;
      const admits = (task: Task, view: TaskBoardView, at: number): boolean =>
        isClaimable(task, view.row, at) && (narrow === undefined || narrow(task, view.rows() as Task[]));
      const order = claimOptions?.order ?? defaultOrder;
      type ClaimWrite = { kind: "claimed" | "errored"; task: Task; prevStatus: TaskStatus };
      let claimed: Task | null = null;
      await storage.writeEach<ClaimWrite>(
        (view) => {
          const at = now();
          return view.rows().filter((task) => admits(task, view, at)).slice().sort(order);
        },
        (task, view) => {
          const at = now();
          // Re-checked on the committed row: another worker may have claimed it since the scan.
          if (!admits(task, view, at)) return undefined;
          // Admission said the claim path looks at this row; disposition decides
          // what happens to it. Settling is not claiming: the scan goes on, so
          // one exhausted row at the head of the queue hides no work behind it.
          if (claimDisposition(task, at, DEFAULT_MAX_ABANDONMENTS) === "claim") {
            const next = stampWrite(task, applyClaimToTask(task, at, leaseDurationMs, options.claimIdentity));
            return { row: next, result: { kind: "claimed", task: next, prevStatus: task.status } };
          }
          const settled = stampWrite(task, applyAbandonmentSettlement(task, at, DEFAULT_MAX_ABANDONMENTS, recordingIn(view)));
          return { row: settled, result: { kind: "errored", task: settled, prevStatus: task.status } };
        },
        {
          stop: (written) => written.kind === "claimed",
          ...(delivery !== undefined ? { before: (row: Task) => delivery.beforeClaim(row, leaseDurationMs) } : {}),
          committed: async (written) => {
            // A settlement owes its `task-change` too, or a streamed UI keeps
            // showing `in_progress` on a row storage has ended.
            emit(written.kind, written.task, written.prevStatus);
            if (written.kind === "claimed") {
              claimed = written.task;
              return;
            }
            await payCascadeAfterWrite(cascadeWrites, written.task);
            await delivery?.afterEnding(written.task);
          },
        }
      );
      return claimed as Task<TInput, TOutput> | null;
    },

    async renewLease(id, leaseUntil, renewOptions) {
      assertValidLeaseDeadline(leaseUntil);
      requireClaimTicket(renewOptions.claim, "renewLease", RENEW_LEASE_TICKET_DETAIL);
      // Same-status, so it rides the transition path and takes every decline
      // arm, the lease fence among them. `updatedAt` moves with `leaseUntil`,
      // keeping the committed span. A held row renews no lease (FIX-2133).
      return transitionTo(id, "in_progress", null, () => ({ leaseUntil }), {
        ...renewOptions,
        ifAllowed: true,
        refuseWithOpenHold: "any",
      });
    },

    async recordSpend(id, write, spendOptions) {
      requireClaimTicket(spendOptions?.claim, "recordSpend", "of the request whose spend it records. Only a task's run records what it spent.");
      // Fenced by the row's identity only (FIX-2288): a terminal row and a
      // lapsed claim still take a spend; a recreated row declines.
      return patch(id, null, (task) => {
        if (!ticketNamesIncarnation(spendOptions.claim, collectionId, task)) return { decline: "not-my-task" };
        const spend = spendAfterWrite(task, write);
        return spend === undefined ? undefined : { patch: { spend } };
      });
    },

    async linkRun(id, run, linkOptions) {
      // The run naming itself on its task (FIX-1668): renewal's guards, and a `run_linked` change.
      return transitionTo(id, "in_progress", "run_linked", () => runLinkPatch(run), linkRunGuards(linkOptions));
    },

    async setKeptOpenBy(id, keptOpenBy, waitOptions) {
      requireClaimTicket(
        waitOptions?.claim,
        "setKeptOpenBy",
        "of the attempt that waits. Only the request holding a task's claim records what it waits on."
      );
      // Fenced like a run link; no `task-change`, as a renewal publishes none.
      // A mirror of a run's stop is refused on a row a question holds (FIX-2133).
      return transitionTo(id, "in_progress", null, (task) => waitingOnPatch(task, keptOpenBy, waitOptions), {
        ...linkRunGuards({ claim: waitOptions.claim }),
        ...(waitOptions.hold !== undefined ? { refuseWithOpenHold: "row" as const } : {}),
      });
    },

    async ask(id, asks, askOptions) {
      requireClaimTicket(askOptions?.claim, "ask", "of the turn that asks. Only the request holding a task's claim asks midway.");
      assertAskable(asks);
      const guards = linkRunGuards({ claim: askOptions.claim });
      // Minted once, outside the write, so a retried write opens the same holds.
      const holds = newRowHolds(asks, now(), {
        ...(options.filing?.holdDueMs !== undefined ? { dueMs: options.filing.holdDueMs } : {}),
        midway: true,
      });
      const outcome = await confirmed(id, () =>
        writeHolds(id, "asked", { op: "ask", holds }, (task) => transitionDeclineReason(task, "in_progress", guards, collectionId, now()))
      );
      return outcome.outcome === "recorded" ? { ...outcome, questions: holds.map((hold) => hold.id) } : outcome;
    },

    async answer(id, answer) {
      // Minted once, outside the write, so a retried write keeps one steer.
      const change: HoldChange = { op: "answer", answer, steerId: generateId("steer"), at: now() };
      return confirmed(id, () => writeHolds(id, "answered", change));
    },

    async payHoldDeadlines() {
      // Rows another process filed are read too, so their deadlines are paid.
      await storage.adoptStoredRows?.();
      const at = now();
      const paid: string[] = [];
      for (const row of board.rows()) {
        if (holdsDue(row, at).length === 0) continue;
        const outcome = await writeHolds(row.id, "answered", { op: "deadline", at });
        if (outcome.outcome === "recorded") paid.push(row.id);
      }
      return paid;
    },

    async complete(id, output, completeOptions) {
      // A checkpoint the worker reported stays the output (FIX-2081).
      return transitionTo(id, "completed", "completed", (task) => completionPatch(task, output, now()), completeOptions);
    },

    async reportProgress(id, progress, progressOptions) {
      requireClaimTicket(
        progressOptions?.claim,
        "reportProgress",
        "of the attempt it reports on. Only the request holding a task's claim reports its progress."
      );
      if (!reportsProgress(progress)) return { outcome: "unchanged" };
      // Fenced like a run link: a finished, recreated or reclaimed row declines.
      return transitionTo(id, "in_progress", "progress_reported", () => progressPatch(progress), linkRunGuards(progressOptions));
    },

    async fail(id, error, failOptions) {
      // Retry-vs-terminal, and whether a retry counts against the board's
      // budget, is `routeFailure`'s decision, made INSIDE the write (FIX-948):
      // the sum a concurrent failure reads must include its rival's grant.
      // `failOptions` reaches both branches, or a retry is an escape out of a
      // terminal status. Without a budget the storage counts and never denies.
      return transition(
        id,
        ["pending", "errored"],
        (task, view) => {
          // `noRetry`: a failure no retry can change ends the task here.
          const routing =
            failOptions?.noRetry === true
              ? ({ action: "terminal", deniedByBudget: false } as const)
              : routeFailure(task, () => sumGrantedRetries(view.rows() as Task[]), retryBudget);
          if (routing.action === "retry") {
            return {
              targetStatus: "pending",
              kind: "retried",
              patch: (current) => ({
                feedback: error,
                leaseUntil: undefined,
                claimedBy: undefined,
                error: undefined,
                ...(routing.countsAgainstBudget ? { retryLedger: grantRetry(current) } : {}),
              }),
            };
          }
          return {
            targetStatus: "errored",
            kind: "errored",
            patch: (current) => ({
              error: routing.deniedByBudget ? retryBudgetExhaustedError(error, routing.limit, collectionId) : error,
              completedAt: now(),
              leaseUntil: undefined,
              claimedBy: undefined,
              ...(routing.deniedByBudget ? { retryLedger: denyRetry(current) } : {}),
            }),
          };
        },
        failOptions
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

    async retry(id) {
      // Dependencies are read as committed, so one another request ended is refused here (FIX-2383).
      await refreshDeps([lookup(id) ?? { id }]);
      return confirmed(id, () =>
        patch(id, "retry_requested", (task, view) =>
          decided(
            retryWrite(
              task,
              view.row,
              // The board's budget, against the committed ledger, as `fail()` reads it.
              () => retryBudget !== undefined && sumGrantedRetries(view.rows() as Task[]) >= retryBudget
            )
          )
        )
      );
    },

    async steer(id, input) {
      // Minted once, outside the write, so a retried write keeps one id and one time.
      const steerId = generateId("steer");
      const at = now();
      return patch(
        id,
        "steered",
        (task) => {
          const steered = steerWrite(task, input, steerId, at);
          return steered === "limit" ? { decline: "steer-limit" } : decided(steered);
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
      const outcome = await patch(id, null, (task) => {
        // Fenced like a run link: a finished, recreated or reclaimed row declines.
        const declined = transitionDeclineReason(task, "in_progress", guards, collectionId, now());
        if (declined !== undefined) return { decline: declined };
        taken = untakenSteers(task).map((steer) => steer.id);
        const taking = takeSteersPatch(task, takeOptions.takenIn);
        return taking === undefined ? undefined : { patch: taking };
      });
      return { ...outcome, taken: outcome.outcome === "recorded" ? taken : [] };
    },

    async cancel(id, reason, cancelOptions) {
      // `ifAllowed` is forced AFTER the spread (FIX-981): a caller's ticket
      // reaches the guard, but "advisory by construction" is this method's
      // contract. Cancelling a settled task is a reported no-op (FIX-976).
      return transitionTo(id, "cancelled", "cancelled", () => cancelPatch(reason, cancelOptions?.via, now()), {
        ...cancelOptions,
        ifAllowed: true,
      });
    },

    async reclaim(nowOverride) {
      const at = nowOverride ?? now();
      // A held row is never taken back (FIX-2133): it holds no lease.
      const lapsed = (task: Task): boolean =>
        task.status === "in_progress" && task.leaseUntil !== undefined && task.leaseUntil < at && !hasOpenHold(task);
      let reclaimed = 0;
      await storage.writeEach<Task>(
        (view) => view.rows().filter(lapsed),
        (task) => {
          if (!lapsed(task)) return undefined;
          // `assignee` stays: it is the worker-registry routing key, not the
          // runtime worker identity, and re-dispatch needs it.
          const reset = stampWrite(task, { ...task, status: "pending", leaseUntil: undefined, claimedBy: undefined, updatedAt: at });
          return { row: reset, result: reset };
        },
        {
          committed: async (reset) => {
            reclaimed++;
            // `resumed` is the one "back to pending" change a lifecycle UI reads.
            emit("resumed", reset, "in_progress");
          },
        }
      );
      return reclaimed;
    },

    async setAssignee(id, assignee) {
      // Reassigning a finished task is refused (FIX-976 / A1). On a dispatched
      // board a row an attempt holds is refused too (FIX-982, FIX-1780): its
      // dispatch is keyed by the assignee it was claimed with. Decided inside
      // the write, so a claim that lands first refuses the move.
      return confirmed(
        id,
        () =>
          patch(
            id,
            "assignee_changed",
            (task) => {
              if (options.immutableAssignee === true && ATTEMPT_OWNED_STATUSES.has(task.status)) return { decline: "immutable-assignee" };
              const refused = assigneeChangeDecline(task, assignee);
              if (refused !== undefined) return { decline: refused };
              return task.assignee === assignee ? undefined : { patch: { assignee } };
            },
            { declineOnTerminal: true }
          ),
        // An attempt-held status is one another request moves on.
        (reason) => reason === "immutable-assignee"
      );
    },

    async setPriority(id, priority) {
      return patch(id, "priority_changed", (task) => (task.priority === priority ? undefined : { patch: { priority } }));
    },

    async addLabel(id, label) {
      return patch(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        return labels.includes(label) ? undefined : { patch: { labels: [...labels, label] } };
      });
    },

    async removeLabel(id, label) {
      return patch(id, "label_changed", (task) => {
        const labels = task.labels ?? [];
        return labels.includes(label) ? { patch: { labels: labels.filter((l) => l !== label) } } : undefined;
      });
    },

    async patchMetadata(id, metadata) {
      return patch(id, "metadata_changed", (task) => ({ patch: { metadata: { ...(task.metadata ?? {}), ...metadata } } }));
    },

    async clearResumeOwed(id) {
      return patch(id, "resume_settled", (task) => (task.resumeOwed === true ? { patch: { resumeOwed: undefined } } : undefined));
    },

    async markCancelOwed(id) {
      return patch(id, "cancel_owed", (task) =>
        task.wait != null && !isTerminalStatus(task.status) && task.cancelOwed !== true ? { patch: { cancelOwed: true } } : undefined
      );
    },

    ...(delivery !== undefined ? { filerOf: (row: Task) => delivery.hooks.filerOf(row) } : {}),
    ...(delivery?.hooks.tellMidwayQuestions !== undefined
      ? { tellMidwayQuestions: (row: Task) => delivery.hooks.tellMidwayQuestions!(row) }
      : {}),

    async markWait(id, slot) {
      // One compare-and-set write: of two requests that read the slot free, one takes it.
      return confirmed(id, () => patch(id, "wait_changed", (task) => decided(markWaitWrite(task, slot))));
    },

    async lapseWait(id, gateId, requestId) {
      await delivery?.beforeLapseWait(lookup(id), gateId);
      const lapsed = await patch(id, "wait_changed", (task) => decided(lapseWaitWrite(task, gateId, requestId)));
      if (lapsed.outcome === "recorded") delivery?.afterLapsed(lookup(id));
      return lapsed;
    },

    async releaseWait(id, release) {
      const dueAt = now() + NOTICE_DUE_MS;
      await delivery?.beforeReleaseWait(lookup(id), release, dueAt);
      return patch(id, "wait_changed", (task) => decided(releaseWaitWrite(task, { ...release, dueAt })));
    },

    async dropNoticeReadByWait(id) {
      return patch(id, "metadata_changed", (task) => decided(noticeReadByWaitWrite(task)));
    },

    async takeNotice(id, notice, take) {
      const at = now();
      return patch(id, "metadata_changed", (task) => decided(noticeTakeWrite(task, notice, { ...take, at })));
    },

    ...(storage.readCommitted !== undefined
      ? { refresh: async (id: string) => storage.readCommitted!(id) }
      : {}),

    async payOwedCascades() {
      // Another process may have filed rows whose dependency has since ended:
      // read them first, so the sweep can cancel them.
      await storage.adoptStoredRows?.();
      return payOwedCascades(cascadeWrites, now());
    },

    get(id) {
      const row = lookup(id);
      return row === undefined ? undefined : wrap(row as Task<TInput, TOutput>);
    },

    async getCommitted(id) {
      // A request may read a resource as the snapshot it first took; a read
      // that changes nothing brings it up to date. A state slot already is.
      if (lookup(id) === undefined) return undefined;
      await storage.readCommitted?.(id);
      const row = lookup(id);
      return row === undefined ? undefined : wrap(row as Task<TInput, TOutput>);
    },

    list(filter?: TaskFilter) {
      return listTasks(board.rows() as Task<TInput, TOutput>[], filter).map(wrap);
    },

    // Counts without the per-task wrap: `shouldExit` predicates call `count()` every drain tick.
    count(filter?: TaskFilter) {
      return listTasks(board.rows() as Task[], filter).length;
    },
  };

  return ref;
}
