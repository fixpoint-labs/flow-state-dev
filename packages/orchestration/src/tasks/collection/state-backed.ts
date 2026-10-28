/**
 * State-backed TaskCollection (FIX-443 §3.1).
 *
 * Tasks live as a `Record<id, Task>` on an atomic state you pass — a
 * sequencer's state, a generator's own state, or the request (adapted by
 * `getOrCreateTaskCollection` when `backing: "state"` omits `state`). All
 * lifecycle mutations go through `state.atomicState` so two workers
 * contending for the same task cannot both win — `atomicState` is
 * CAS-guarded by core's state container and retries on conflict.
 *
 * Locality: each state owns its own tasks without manufacturing unique
 * resource keys, and nested patterns automatically get isolated collections.
 * Durability follows the ref you pass, and only a sequencer's state is
 * checkpointed (FIX-401, latest-only with always-on default); a generator's
 * own state and the request are not restored on resume.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { StateRef } from "@flow-state-dev/core/types";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { withMigratedWait, type Task, type TaskClaimIdentity, type TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import {
  assertTransitionAllowed,
  isTerminalStatus,
} from "../schema/task-status";
import { withRetiredShapes } from "../schema/retired-shapes";
import type { FilingStamp, TaskSettingsPatch } from "./internal";
import { assertAskable, hasOpenQuestion, questionWrite, questionsDue, newRowQuestions, type QuestionChange } from "./questions";
import { NOTICE_DUE_MS } from "../notice/task-notice";
import type {
  TaskCollectionRef,
  TaskTransitionOptions,
  TaskWriteDeclineReason,
  TaskWriteOutcome,
} from "./types";
import {
  applyAbandonmentSettlement,
  applyClaimToTask,
  applyTransition,
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
  createTaskHandleWrapper,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_MAX_ABANDONMENTS,
  defaultOrder,
  denyRetry,
  grantRetry,
  isClaimable,
  listTasks,
  retryBudgetExhaustedError,
  routeFailure,
  sumGrantedRetries,
  transitionDeclineReason,
  assigneeChangeDecline,
  lapseWaitWrite,
  markWaitWrite,
  releaseWaitWrite,
  noticeReadByWaitWrite,
  noticeTakeWrite,
  settingsWrite,
  settingsChangeKind,
  type EndingRecording,
} from "./internal";
import { stampWrite } from "../write-provenance";
import { spendAfterWrite } from "../spend";
import { ticketNamesTask } from "../claim-ticket";
import { generateId } from "../generate-id";
import { steerWrite, takeSteersPatch, untakenSteers } from "../steers";
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
} from "./cascade";
import {
  TaskCapExceededError,
  validateTaskCaps,
  type TaskCapOptions,
} from "./task-caps";

/** Options for {@link createStateBackedTaskCollection}. */
export interface StateBackedOptions extends TaskCapOptions {
  collectionId: string;
  /** The atomic state that holds the tasks — e.g. `ctx.sequencer`. Its state
   *  schema must include a record at `[stateKey]`, e.g. `tasks: z.record(taskSchema)`. */
  state: StateRef<Record<string, unknown>>;
  /** Key on the state that holds the `Record<id, Task>`. Default: `"tasks"`. */
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
   * The filing settings this board honours (FIX-2080). Omitted, only the
   * defaults: a filing with any other `session` or `resultTo` is refused.
   */
  settings?: TaskSettingsSupport;
  /** What every row this collection files is stamped with beside its filer (FIX-2133). */
  filing?: FilingStamp;
}

/**
 * Own-property task lookup (FIX-965). `id` is model-supplied (task tool
 * calls declare `taskId: z.string()`), so BP-031 applies — indexing directly
 * could resolve an inherited `Object.prototype` member instead of missing.
 * Same guard as `keyedRouter` (FIX-943).
 */
function ownTask<T>(tasks: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(tasks, id) ? tasks[id] : undefined;
}

/** Create a `TaskCollectionRef` backed by a record on an atomic state. */
export function createStateBackedTaskCollection<TInput = unknown, TOutput = unknown>(
  options: StateBackedOptions
): TaskCollectionRef<TInput, TOutput> {
  const stateKey = options.stateKey ?? "tasks";
  const now = options.now ?? Date.now;
  const onChange = options.onChange;
  // Captured because `fail`'s own `options` parameter shadows the factory's.
  const collectionId = options.collectionId;
  validateTaskCaps(`[tasks] collection "${options.collectionId}"`, options);
  // `null` (explicitly unbounded) and omission collapse to the same runtime
  // state here — the distinction only matters at the construction points that
  // decide whether to apply a default.
  const maxTotalTasks = options.maxTotalTasks ?? undefined;
  const maxEnqueuedTasks = options.maxEnqueuedTasks ?? undefined;
  const maxTotalRetries = options.maxTotalRetries ?? undefined;
  const wrap = createTaskHandleWrapper<TInput, TOutput>(
    options.collectionId,
    options.getItems,
  );

  /**
   * The read boundary for this backing — same job as the resource backing's
   * `readTaskState`. Atomic state is stored, not parsed, so a row written
   * before the wait rename arrives carrying its legacy wait mark, and one in
   * a shape the retired-shape map reads (`withRetiredShapes`, FIX-2080); both
   * are mapped forward here, before any filter or the transition guard sees it.
   *
   * The map is rebuilt only when a legacy row is actually present, so the
   * common path returns the stored object itself.
   */
  function migrateTasks(slot: unknown): Record<string, Task<TInput, TOutput>> {
    if (!slot || typeof slot !== "object") return {};
    const stored = slot as Record<string, Task<TInput, TOutput>>;
    let migrated: Record<string, Task<TInput, TOutput>> | undefined;
    for (const [id, task] of Object.entries(stored)) {
      const next = withRetiredShapes(withMigratedWait(task));
      if (next === task) continue;
      migrated ??= { ...stored };
      migrated[id] = next;
    }
    return migrated ?? stored;
  }

  function readTasks(): Record<string, Task<TInput, TOutput>> {
    const raw = options.state.state as Record<string, unknown>;
    return migrateTasks(raw[stateKey]);
  }

  const emit = createTaskChangeEmitter<TInput, TOutput>(
    options.collectionId,
    onChange
  );

  /**
   * What an ending write records besides the ending (FIX-2080 D2): a cascade
   * is owed when a failed or cancelled row has an open dependent on this
   * board, read from the committed map the write runs against. A state-held
   * board files no task elsewhere, so it owes no filed half.
   */
  function recordingFor(tasks: Readonly<Record<string, Task<TInput, TOutput>>>): EndingRecording {
    return {
      owesCascade: (row, ending) =>
        endsDependents(ending) && openDependentsOf(Object.values(tasks) as Task[], row.id).length > 0,
    };
  }

  /** The tasks map `casWrite` hands to its mutator and expects back. */
  type TasksMap<I, O> = Record<string, Task<I, O>>;

  /**
   * Run a CAS-guarded write. The `mutate` callback returns the next tasks
   * map (or `undefined` for a no-op). Errors thrown inside `mutate`
   * propagate; the CAS retry loop in `atomicState` re-runs the callback
   * with the freshest committed tasks map.
   *
   * This helper does not emit. Each public method emits explicitly after the
   * write returns, using the outcome its callback returned through
   * `withOutcome` — which is by construction the invocation that committed.
   */
  async function casWrite(
    mutate: (
      tasks: Readonly<Record<string, Task<TInput, TOutput>>>
    ) => Record<string, Task<TInput, TOutput>> | undefined
  ): Promise<void> {
    await options.state.atomicState((state) => {
      const raw = state as Record<string, unknown>;
      // Through the same boundary as `readTasks`: the mutator re-reads
      // committed state on every CAS retry, so a legacy row would otherwise
      // reach the transition guard here even though the read path is clean.
      const currentTasks = migrateTasks(raw[stateKey]);

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
   * makes a batch `createTasks` all-or-nothing.
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
   * The verdict travels out as the callback's return value, so it describes the
   * invocation that committed even when `casWrite` replays this closure with a
   * fresher tasks map.
   */
  async function transitionTo(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind | null,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>,
    guards?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome> {
    return transitionDerived(id, () => ({ targetStatus, kind, patch }), guards);
  }

  /**
   * What a derived transition decided to write, computed inside the CAS.
   *
   * `kind: null` performs the transition without publishing a `task-change`
   * item — see the resource backing's `transitionRef` for the one caller
   * (`renewLease`) and why a renewal is not a lifecycle change.
   */
  interface DerivedTransition {
    targetStatus: TaskStatus;
    kind: TaskChangeKind | null;
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>;
  }

  /**
   * `transitionTo` for a transition whose TARGET depends on the ledger (FIX-948).
   *
   * `fail()` is the only caller: its retry-vs-terminal routing now reads a
   * board-wide sum, and a sum read outside the write races the write it gates.
   * So `derive` runs inside the mutator, against the committed map, and re-runs
   * on every CAS retry — which is what makes "the budget's worth lands, and no
   * more" a claim we can hold rather than a cosmetic one.
   *
   * **`derive` must be pure.** It only chooses what to write; the write itself
   * happens below, after the decline check. That ordering is a correctness
   * requirement, not a style preference — see the mutator body.
   */
  async function transitionDerived(
    id: string,
    derive: (
      task: Task<TInput, TOutput>,
      tasks: Readonly<Record<string, Task<TInput, TOutput>>>
    ) => DerivedTransition,
    guards?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome> {
    /** What one invocation did — returned, never captured outward. */
    type TransitionResult =
      | { kind: "declined"; verdict: TaskWriteOutcome }
      | {
          kind: "recorded";
          changeKind: TaskChangeKind | null;
          task: Task<TInput, TOutput>;
          prevStatus: TaskStatus;
        };

    const outcome = await withOutcome(
      casWrite,
      (tasks): { state: TasksMap<TInput, TOutput> | undefined; result: TransitionResult } => {
        const task = ownTask(tasks, id);
        if (task === undefined) {
          throw new Error(`[tasks] task "${id}" not found`);
        }
        // Choosing the target is pure — it reads the ledger and writes nothing —
        // so running it here does not weaken the ordering the decline check
        // below depends on. NOTHING may be recorded before that check: the
        // board's failure write-back passes `{ ifAllowed, claim }` so a
        // displaced worker's late failure is discarded, and a retry grant or a
        // denial marker written ahead of the decline would let that stale
        // failure spend another task's retry allowance, or mark the board
        // "retry-budget-exhausted" when nothing was ever refused. Both are
        // invisible to a test that only checks the task's status.
        const { targetStatus, kind, patch } = derive(task, tasks);
        const reason = transitionDeclineReason(
          task as Task,
          targetStatus,
          guards,
          collectionId,
          now(),
          kind ?? undefined
        );
        if (reason !== undefined) {
          return {
            state: undefined,
            result: {
              kind: "declined",
              verdict: { outcome: "declined", reason, status: task.status },
            },
          };
        }
        assertTransitionAllowed(task.status, targetStatus, id);
        // Provenance is stamped here, inside the CAS, off the `task` this
        // invocation read — so a replay against a fresher map stamps off that
        // map and there is nothing to reset (FIX-989).
        const next = stampWrite(
          task,
          applyTransition(task, { ...patch(task), status: targetStatus }, now(), recordingFor(tasks)),
          guards?.write
        );
        return {
          state: { ...tasks, [id]: next },
          result: { kind: "recorded", changeKind: kind, task: next, prevStatus: task.status },
        };
      }
    );

    if (outcome === undefined) return { outcome: "unchanged" };
    if (outcome.kind === "declined") return outcome.verdict;
    if (outcome.changeKind !== null) {
      emit(outcome.changeKind, outcome.task, outcome.prevStatus);
    }
    // The ending's own pass pays the cascade it owes (FIX-2080 D2).
    await payCascadeAfterWrite(cascadeWrites, outcome.task as Task);
    return { outcome: "recorded" };
  }

  /**
   * Patch a task's fields inside the CAS, returning what it did (FIX-976).
   *
   * `declineOnTerminal` is the terminal guard for the writes that change a
   * task's future (epic constraint A1): `setAssignee` and the settings write
   * pass it. The four sibling patch methods pass nothing and keep
   * writing to terminal tasks, which a first-party block depends on (the
   * supervisor's failure-category audit). Making this helper-wide would break it.
   *
   * Evaluated against the freshest committed task from inside the mutator, so
   * the decision is race-free rather than a caller-side pre-check.
   */
  async function patchOne(
    id: string,
    kind: TaskChangeKind | null | ((prev: Task<TInput, TOutput>, next: Task<TInput, TOutput>) => TaskChangeKind),
    patch: (
      task: Task<TInput, TOutput>,
      tasks: Readonly<Record<string, Task<TInput, TOutput>>>
    ) => Partial<Task<TInput, TOutput>> | undefined,
    options?: {
      declineOnTerminal?: boolean;
      /** A refusal decided on the freshest committed task, inside the write. */
      decline?: (
        task: Task<TInput, TOutput>,
        tasks: Readonly<Record<string, Task<TInput, TOutput>>>
      ) => TaskWriteDeclineReason | undefined;
    }
  ): Promise<TaskWriteOutcome> {
    /** What one `patchOne` invocation did — returned, never captured outward. */
    type PatchResult =
      | { kind: "declined"; verdict: TaskWriteOutcome }
      | { kind: "unchanged" }
      | { kind: "recorded"; task: Task<TInput, TOutput>; prev: Task<TInput, TOutput> };

    const outcome = await withOutcome(
      casWrite,
      (tasks): { state: TasksMap<TInput, TOutput> | undefined; result: PatchResult } => {
        const task = ownTask(tasks, id);
        if (task === undefined) {
          throw new Error(`[tasks] task "${id}" not found`);
        }
        if (options?.declineOnTerminal === true && isTerminalStatus(task.status)) {
          return {
            state: undefined,
            result: {
              kind: "declined",
              verdict: { outcome: "declined", reason: "terminal", status: task.status },
            },
          };
        }
        const refused = options?.decline?.(task, tasks);
        if (refused !== undefined) {
          return {
            state: undefined,
            result: { kind: "declined", verdict: { outcome: "declined", reason: refused, status: task.status } },
          };
        }
        const update = patch(task, tasks);
        if (update === undefined) return { state: undefined, result: { kind: "unchanged" } };
        // No token: these five methods take no options object, so they bump the
        // revision and mint no receipt (FIX-989).
        const next = stampWrite(task, applyTransition(task, update, now()));
        return {
          state: { ...tasks, [id]: next },
          result: { kind: "recorded", task: next, prev: task },
        };
      }
    );

    if (outcome === undefined || outcome.kind === "unchanged") return { outcome: "unchanged" };
    if (outcome.kind === "declined") return outcome.verdict;
    const changeKind = typeof kind === "function" ? kind(outcome.prev, outcome.task) : kind;
    if (changeKind !== null) {
      emit(changeKind, outcome.task, outcome.prev.status !== outcome.task.status ? outcome.prev.status : undefined);
    }
    return { outcome: "recorded" };
  }

  /**
   * The guarded settings write (FIX-2080, ER-4): `patchSettings`, and `hold`
   * and `release` under their own names. Decided on the committed row inside
   * the write, dependencies against the committed map.
   */
  function writeSettings(id: string, settings: TaskSettingsPatch): Promise<TaskWriteOutcome> {
    return patchOne(
      id,
      (prev, next) => settingsChangeKind(prev.status, next.status),
      (task, tasks) => {
        const decided = settingsWrite(task as Task, settings, (other) => ownTask(tasks, other) as Task | undefined);
        return decided === undefined || "decline" in decided ? undefined : (decided.patch as Partial<Task<TInput, TOutput>>);
      },
      {
        declineOnTerminal: true,
        // The field table's refusal, decided on the same committed row the patch reads.
        decline: (task, tasks) => {
          const decided = settingsWrite(task as Task, settings, (other) => ownTask(tasks, other) as Task | undefined);
          return decided !== undefined && "decline" in decided ? decided.decline : undefined;
        },
      }
    );
  }

  /**
   * The one hold write (FIX-2133), decided on the committed row inside the
   * CAS: `decline` first (a claim fence), then the hold rule itself.
   */
  function writeHolds(
    id: string,
    kind: TaskChangeKind,
    change: QuestionChange,
    decline?: (task: Task<TInput, TOutput>) => TaskWriteDeclineReason | undefined
  ): Promise<TaskWriteOutcome> {
    return patchOne(
      id,
      kind,
      (task) => {
        const decided = questionWrite(task as Task, change);
        return typeof decided === "object" && "patch" in decided ? (decided.patch as Partial<Task<TInput, TOutput>>) : undefined;
      },
      {
        decline: (task) => {
          const fenced = decline?.(task);
          if (fenced !== undefined) return fenced;
          const decided = questionWrite(task as Task, change);
          return typeof decided === "object" && "decline" in decided ? decided.decline : undefined;
        },
      }
    );
  }

  /** The board's row by id, as stored now. */
  const committedRow = (id: string): Task | undefined => ownTask(readTasks(), id) as Task | undefined;

  /** The reads and writes a cascade is paid with on this board (FIX-2080 D2). */
  const cascadeWrites: CascadeWrites = {
    get: (id) => ownTask(readTasks(), id) as Task | undefined,
    list: () => Object.values(readTasks()) as Task[],
    cancelDependent: async (id, cause) => {
      await transitionTo(
        id,
        "cancelled",
        "cancelled",
        (dependent) => cascadeCancelPatch(dependent as Task, cause, now()) as Partial<Task<TInput, TOutput>>,
        { ifAllowed: true }
      );
    },
    settle: async (id, due) => {
      await patchOne(id, null, (task) =>
        task.cascadeOwed != null && task.cascadeOwed.due === due ? { cascadeOwed: undefined } : undefined
      );
    },
  };

  const ref: TaskCollectionRef<TInput, TOutput> = {
    collectionId: options.collectionId,
    // The one clock this collection stamps and judges leases against
    // (FIX-1005). Everything comparing against `leaseUntil` reads it, so the
    // claim write and the readers cannot end up on two timelines.
    now,
    // This backing enforces, so the resolved budget IS the limit in force.
    maxTotalRetries: maxTotalRetries ?? null,

    async createTask(init) {
      assertFilingSettings(init, options.settings, collectionId);
      // Build the task once — id and createdAt are stable across CAS retries
      // so the emitted item matches what's in state on a successful write.
      const task = buildInitialTask<TInput, TOutput>(withFollowUpPlacement(init, committedRow), now(), options.createdBy, undefined, options.filing);
      await casWrite((tasks) => {
        if (ownTask(tasks, task.id) !== undefined) {
          throw new Error(`[tasks] task with id "${task.id}" already exists`);
        }
        // Against the committed map, inside the write (FIX-2080).
        assertDepsFileable([task as Task], (id) => ownTask(tasks, id) as Task | undefined);
        assertParentsOpen([task as Task], (id) => ownTask(tasks, id) as Task | undefined);
        const next = { ...tasks, [task.id]: task };
        assertWithinCaps(next);
        return next;
      });
      emit("added", task);
      return task;
    },

    async createTasks(inits) {
      for (const init of inits) assertFilingSettings(init, options.settings, collectionId);
      const built = inits.map((init) => buildInitialTask<TInput, TOutput>(withFollowUpPlacement(init, committedRow), now(), options.createdBy, undefined, options.filing));
      if (built.length === 0) return [];
      await casWrite((tasks) => {
        // Ids filed in the same batch count (FIX-2080).
        assertDepsFileable(built as Task[], (id) => ownTask(tasks, id) as Task | undefined);
        assertParentsOpen(built as Task[], (id) => ownTask(tasks, id) as Task | undefined);
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
      const leaseDurationMs = claimOptions?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
      assertValidLeaseDuration(leaseDurationMs);

      /** What one attempt wrote — returned, never captured outward, so a CAS
       *  replay reports only the invocation that committed. */
      type ClaimPass = {
        claimed?: { task: Task<TInput, TOutput>; prevStatus: TaskStatus };
        settled: { task: Task<TInput, TOutput>; prevStatus: TaskStatus }[];
      };

      const captured = await withOutcome(
        casWrite,
        (tasks): { state: TasksMap<TInput, TOutput> | undefined; result: ClaimPass } => {
          const lookup = (id: string): Task | undefined =>
            ownTask(tasks, id) as unknown as Task | undefined;
          // A caller's `eligibility` NARROWS the substrate's candidate set; it
          // does not replace it (FIX-1005) — see the resource backing's `claim`
          // for why replacement made recovery opt-out-by-accident.
          const narrow = claimOptions?.eligibility;
          const at = now();
          const rows = Object.values(tasks) as Task[];
          const admits = (task: Task): boolean =>
            isClaimable(task, lookup, at) && (narrow === undefined || narrow(task, rows));
          const order = claimOptions?.order ?? defaultOrder;

          const candidates = Object.values(tasks)
            .filter((task) => admits(task as Task))
            .slice()
            .sort(order);

          const next: Record<string, Task<TInput, TOutput>> = { ...tasks };
          const pass: ClaimPass = { settled: [] };

          // Admission said the claim path should look at these rows;
          // disposition decides what happens to each. Scanning past a
          // settlement rather than returning `null` keeps one exhausted row at
          // the head of the queue from hiding the work behind it — the whole
          // map is already inside this one write, so it costs nothing here.
          for (const candidate of candidates) {
            if (
              claimDisposition(candidate as Task, at, DEFAULT_MAX_ABANDONMENTS) === "claim"
            ) {
              // Three stamps, composed: the claim records where it runs
              // (FIX-1005), the lease is stamped, and the write records its
              // provenance (FIX-989).
              const claimed = stampWrite(
                candidate,
                applyClaimToTask(candidate, at, leaseDurationMs, options.claimIdentity)
              );
              next[claimed.id] = claimed;
              pass.claimed = { task: claimed, prevStatus: candidate.status };
              break;
            }
            // The abandonment settlement is a committed write too, so it
            // advances the record the same way (FIX-989).
            const settled = stampWrite(
              candidate,
              applyAbandonmentSettlement(candidate, at, DEFAULT_MAX_ABANDONMENTS, recordingFor(tasks))
            );
            next[settled.id] = settled;
            pass.settled.push({ task: settled, prevStatus: candidate.status });
          }

          if (pass.claimed === undefined && pass.settled.length === 0) {
            return { state: undefined, result: pass };
          }
          return { state: next, result: pass };
        }
      );

      if (captured === undefined) return null;
      // A settlement is a successful mutation and owes its `task-change`, or a
      // streamed UI keeps showing `in_progress` on a row storage terminalized.
      for (const settled of captured.settled) {
        emit("errored", settled.task, settled.prevStatus);
      }
      for (const settled of captured.settled) {
        await payCascadeAfterWrite(cascadeWrites, settled.task as Task);
      }
      if (captured.claimed === undefined) return null;
      emit("claimed", captured.claimed.task, captured.claimed.prevStatus);
      return captured.claimed.task;
    },

    async renewLease(id, leaseUntil, renewOptions) {
      assertValidLeaseDeadline(leaseUntil);
      requireClaimTicket(renewOptions.claim, "renewLease", RENEW_LEASE_TICKET_DETAIL);
      // Same-status, so this rides the ordinary transition path and picks up
      // all four decline arms — the lease fence among them. See the resource
      // backing's `renewLease` for why `updatedAt` moving is the right answer.
      // A held row renews no lease (FIX-2133): a renewal racing a midway question loses.
      return transitionTo(
        id,
        "in_progress",
        null,
        () => ({ leaseUntil }),
        { ...renewOptions, ifAllowed: true, refuseWithOpenQuestion: "any" }
      );
    },

    async recordSpend(id, write, spendOptions) {
      requireClaimTicket(spendOptions?.claim, "recordSpend", "of the request whose spend it records. Only a task's run records what it spent.");
      // Fenced by the row's identity only (FIX-2288): a terminal row and a
      // lapsed claim still take a spend; a recreated row declines.
      return patchOne(
        id,
        null,
        (task) => {
          const spend = spendAfterWrite(task as Task, write);
          return spend === undefined ? undefined : ({ spend } as Partial<Task<TInput, TOutput>>);
        },
        { decline: (task) => (ticketNamesTask(spendOptions.claim, collectionId, task as Task) ? undefined : "not-my-task") }
      );
    },

    async linkRun(id, run, linkOptions) {
      // The run naming itself on its task (FIX-1668). Same-status, so this
      // rides the ordinary transition path with renewal's guards; unlike a
      // renewal it IS a change a reader acts on, so it publishes `run_linked`.
      return transitionTo(id, "in_progress", "run_linked", () => runLinkPatch(run), linkRunGuards(linkOptions));
    },

    async setKeptOpenBy(id, keptOpenBy, waitOptions) {
      requireClaimTicket(
        waitOptions?.claim,
        "setKeptOpenBy",
        "of the attempt that waits. Only the request holding a task's claim records what it waits on."
      );
      // Same-status, fenced like a run link: a finished, recreated or reclaimed
      // row declines. No `task-change`, as a renewal publishes none.
      return transitionTo(
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
      // Minted once, outside the write, so a CAS replay opens the same holds.
      const holds = newRowQuestions(asks, now(), { ...(options.filing?.questionDueMs !== undefined ? { dueMs: options.filing.questionDueMs } : {}), midway: true });
      const outcome = await writeHolds(id, "asked", { op: "ask", questions: holds }, (task) =>
        transitionDeclineReason(task as Task, "in_progress", guards, collectionId, now())
      );
      return outcome.outcome === "recorded" ? { ...outcome, questions: holds.map((hold) => hold.id) } : outcome;
    },

    async answer(id, answer) {
      // Minted once, outside the write, so a CAS replay keeps one steer.
      const change: QuestionChange = { op: "answer", answer, steerId: generateId("steer"), at: now() };
      return writeHolds(id, "answered", change);
    },

    async payQuestionDeadlines() {
      const at = now();
      const paid: string[] = [];
      for (const row of Object.values(readTasks()) as Task[]) {
        if (questionsDue(row, at).length === 0) continue;
        const outcome = await writeHolds(row.id, "answered", { op: "deadline", at });
        if (outcome.outcome === "recorded") paid.push(row.id);
      }
      return paid;
    },

    async complete(id, output, options) {
      // A checkpoint the worker reported stays the output (FIX-2081).
      return transitionTo(
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
      return transitionTo(
        id,
        "in_progress",
        "progress_reported",
        () => progressPatch(progress) as Partial<Task<TInput, TOutput>>,
        linkRunGuards(progressOptions)
      );
    },

    async fail(id, error, options) {
      // Retry-vs-terminal, and whether a retry counts against the board's
      // budget, is `routeFailure`'s decision — gate order, and the reason the
      // budget is scoped to attempt-owned failures, are documented there.
      //
      // Two things belong to this call site rather than to that helper:
      //
      // 1. The decision runs INSIDE the atomic write (FIX-948). `fail` used to
      //    read the task outside the CAS and then open a write — already a
      //    latent race on `maxAttempts`, and fatal for a board-wide budget,
      //    since the sum a concurrent failure reads must include the grant its
      //    rival committed, or two failures at the boundary both retry.
      // 2. `options` reaches EVERY branch. The routing is status-blind on the
      //    `maxAttempts` half, so threading the guards into only the hard-fail
      //    branch leaves live an escape out of a terminal status — and passes
      //    any test that never sets `maxAttempts`.
      return transitionDerived(
        id,
        (task, tasks) => {
          // `noRetry`: a failure no retry can change ends the task here.
          const routing =
            options?.noRetry === true
              ? ({ action: "terminal", deniedByBudget: false } as const)
              : routeFailure(
                  task as Task,
                  () => sumGrantedRetries(Object.values(tasks) as Task[]),
                  maxTotalRetries
                );
          if (routing.action === "retry") {
            return {
              targetStatus: "pending" as const,
              kind: "retried" as const,
              patch: (current: Task<TInput, TOutput>) => ({
                feedback: error,
                leaseUntil: undefined,
                claimedBy: undefined,
                error: undefined,
                ...(routing.countsAgainstBudget
                  ? { retryLedger: grantRetry(current) }
                  : {}),
              }),
            };
          }
          return {
            targetStatus: "errored" as const,
            kind: "errored" as const,
            patch: (current: Task<TInput, TOutput>) => ({
              error: routing.deniedByBudget
                ? retryBudgetExhaustedError(error, routing.limit, collectionId)
                : error,
              completedAt: now(),
              leaseUntil: undefined,
              claimedBy: undefined,
              ...(routing.deniedByBudget ? { retryLedger: denyRetry(current) } : {}),
            }),
          };
        },
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
      return writeSettings(id, settings);
    },

    async steer(id, input) {
      // Minted once, outside the write, so a CAS replay keeps one id and one time.
      const steerId = generateId("steer");
      const at = now();
      // Decided once per row read: the decline and the patch see the same row.
      let decidedFor: { task: unknown; decided: ReturnType<typeof steerWrite> } | undefined;
      const decide = (task: unknown) => {
        if (decidedFor === undefined || decidedFor.task !== task) {
          decidedFor = { task, decided: steerWrite(task as Task, input, steerId, at) };
        }
        return decidedFor.decided;
      };
      return patchOne(
        id,
        "steered",
        (task) => {
          const decided = decide(task);
          return typeof decided === "string" ? undefined : (decided.patch as Partial<Task<TInput, TOutput>>);
        },
        {
          // A finished task takes no steer: its output never changes (FIX-2086).
          declineOnTerminal: true,
          decline: (task) => (decide(task) === "limit" ? "steer-limit" : undefined),
        }
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
      const outcome = await patchOne(
        id,
        null,
        (task) => {
          taken = untakenSteers(task as Task).map((steer) => steer.id);
          return takeSteersPatch(task as Task, takeOptions.takenIn) as Partial<Task<TInput, TOutput>> | undefined;
        },
        {
          // Fenced like a run link, on the committed row: a finished, recreated
          // or reclaimed row declines.
          decline: (task) => transitionDeclineReason(task as Task, "in_progress", guards, collectionId, now()),
        }
      );
      return { ...outcome, taken: outcome.outcome === "recorded" ? taken : [] };
    },

    async cancel(id, reason, options) {
      // The decline is now REPORTED (FIX-976) — behaviour is unchanged, but the
      // caller learns the cancel did nothing instead of reading silence as
      // success. Substrate write-backs discard this and stay silent.
      return transitionTo(
        id,
        "cancelled",
        "cancelled",
        () => cancelPatch(reason, options?.via, now()) as Partial<Task<TInput, TOutput>>,
        // `ifAllowed` is forced AFTER the spread, not merged into it (FIX-981):
        // a caller's ticket must reach the guard, but "advisory by
        // construction" is this method's contract and a caller cannot switch it
        // off. Unchanged behaviour: cancelling an already-settled task is a
        // no-op; the disallowed arm, for a `cancelled` target, can only fire
        // where the terminal arm already did.
        { ...options, ifAllowed: true }
      );
    },

    async reclaim(nowOverride) {
      const at = nowOverride ?? now();

      const reclaimed = (await withOutcome(casWrite, (tasks) => {
        const next: Record<string, Task<TInput, TOutput>> = { ...tasks };
        // Built per invocation, so a replay reports only the attempt that
        // committed rather than concatenating every attempt's tasks.
        const claimedBack: Task<TInput, TOutput>[] = [];
        for (const task of Object.values(tasks)) {
          if (
            task.status === "in_progress" &&
            task.leaseUntil !== undefined &&
            task.leaseUntil < at &&
            // A held row is never taken back (FIX-2133): it holds no lease, and a renewal racing a midway question is refused.
            !hasOpenQuestion(task as Task)
          ) {
            // Preserve `assignee` — it's the user-set worker-registry
            // routing key, not the runtime worker identity. Clearing it
            // would break re-dispatch through a worker registry.
            const reset: Task<TInput, TOutput> = stampWrite(task, {
              ...task,
              status: "pending",
              leaseUntil: undefined,
              claimedBy: undefined,
              updatedAt: at,
            });
            next[task.id] = reset;
            claimedBack.push(reset);
          }
        }
        return {
          state: claimedBack.length === 0 ? undefined : next,
          result: claimedBack,
        };
      })) ?? [];

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
        { declineOnTerminal: true, decline: (task) => assigneeChangeDecline(task as Task, assignee) }
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

    async clearResumeOwed(id) {
      return patchOne(id, "resume_settled", (task) =>
        task.resumeOwed === true ? { resumeOwed: undefined } : undefined
      );
    },

    async markCancelOwed(id) {
      return patchOne(id, "cancel_owed", (task) =>
        task.wait != null && !isTerminalStatus(task.status) && task.cancelOwed !== true
          ? { cancelOwed: true }
          : undefined
      );
    },

    async markWait(id, slot) {
      // One CAS write: of two requests that read the slot free, one takes it.
      return patchOne(
        id,
        "wait_changed",
        (task) => {
          const decided = markWaitWrite(task as Task, slot);
          return decided === undefined || "decline" in decided ? undefined : (decided.patch as Partial<Task<TInput, TOutput>>);
        },
        {
          decline: (task) => {
            const decided = markWaitWrite(task as Task, slot);
            return decided !== undefined && "decline" in decided ? decided.decline : undefined;
          },
        }
      );
    },

    async lapseWait(id, gateId, requestId) {
      return patchOne(
        id,
        "wait_changed",
        (task) => {
          const decided = lapseWaitWrite(task as Task, gateId, requestId);
          return decided === undefined || "decline" in decided ? undefined : (decided.patch as Partial<Task<TInput, TOutput>>);
        },
        { declineOnTerminal: true }
      );
    },

    async releaseWait(id, release) {
      const dueAt = now() + NOTICE_DUE_MS;
      return patchOne(id, "wait_changed", (task) => releaseWaitWrite(task as Task, { ...release, dueAt })?.patch as Partial<Task<TInput, TOutput>> | undefined);
    },

    async dropNoticeReadByWait(id) {
      return patchOne(id, "metadata_changed", (task) => noticeReadByWaitWrite(task as Task)?.patch as Partial<Task<TInput, TOutput>> | undefined);
    },

    async takeNotice(id, notice, take) {
      const at = now();
      return patchOne(id, "metadata_changed", (task) => noticeTakeWrite(task as Task, notice, { ...take, at })?.patch as Partial<Task<TInput, TOutput>> | undefined);
    },

    async payOwedCascades() {
      return payOwedCascades(cascadeWrites, now());
    },

    get(id) {
      const task = ownTask(readTasks(), id);
      return task === undefined ? undefined : wrap(task);
    },

    // Request or sequencer state: every write of this ledger is this run's, so
    // the committed row is the one `get` reads.
    async getCommitted(id) {
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
