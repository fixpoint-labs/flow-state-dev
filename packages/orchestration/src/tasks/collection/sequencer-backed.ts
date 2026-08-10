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
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { Task, TaskClaimIdentity, TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import { assertTransitionAllowed, isTerminalStatus } from "../schema/task-status";
import type {
  TaskCollectionRef,
  TaskTransitionOptions,
  TaskWriteOutcome,
} from "./types";
import {
  applyAbandonmentSettlement,
  applyClaimToTask,
  applyTransition,
  assertValidLeaseDeadline,
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
  assertTransitionFrom,
  transitionDeclineReason,
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
  /**
   * Execution coordinate stamped onto `task.claimedBy` at claim time
   * (FIX-1005). The factory reads it off the `BlockContext` it already
   * receives; omit it and claims record no coordinate.
   */
  claimIdentity?: TaskClaimIdentity;
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
   * The verdict travels out as the callback's return value, so it describes the
   * invocation that committed even when `casWrite` replays this closure with a
   * fresher tasks map.
   */
  async function transitionTo(
    id: string,
    targetStatus: TaskStatus,
    kind: TaskChangeKind | null,
    patch: (task: Task<TInput, TOutput>) => Partial<Task<TInput, TOutput>>,
    guards?: TaskTransitionOptions,
    requireFrom?: TaskStatus
  ): Promise<TaskWriteOutcome> {
    return transitionDerived(id, () => ({ targetStatus, kind, patch, requireFrom }), guards);
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
    /** The one source status this verb may run from — see `assertTransitionFrom`. */
    requireFrom?: TaskStatus;
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
        const { targetStatus, kind, patch, requireFrom } = derive(task, tasks);
        const reason = transitionDeclineReason(
          task as Task,
          targetStatus,
          guards,
          collectionId,
          now(),
          requireFrom
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
        assertTransitionFrom(task as Task, requireFrom, targetStatus, id);
        assertTransitionAllowed(task.status, targetStatus, id);
        const next = applyTransition(task, { ...patch(task), status: targetStatus }, now());
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
    /** What one `patchOne` invocation did — returned, never captured outward. */
    type PatchResult =
      | { kind: "declined"; verdict: TaskWriteOutcome }
      | { kind: "unchanged" }
      | { kind: "recorded"; task: Task<TInput, TOutput> };

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
        const update = patch(task);
        if (update === undefined) return { state: undefined, result: { kind: "unchanged" } };
        const next = applyTransition(task, update, now());
        return {
          state: { ...tasks, [id]: next },
          result: { kind: "recorded", task: next },
        };
      }
    );

    if (outcome === undefined || outcome.kind === "unchanged") return { outcome: "unchanged" };
    if (outcome.kind === "declined") return outcome.verdict;
    emit(kind, outcome.task);
    return { outcome: "recorded" };
  }

  const ref: TaskCollectionRef<TInput, TOutput> = {
    collectionId: options.collectionId,
    // The one clock this collection stamps and judges leases against
    // (FIX-1005). Everything comparing against `leaseUntil` reads it, so the
    // claim write and the readers cannot end up on two timelines.
    now,
    // This backing enforces, so the resolved budget IS the limit in force.
    maxTotalRetries: maxTotalRetries ?? null,

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
          const admits = (task: Task): boolean =>
            isClaimable(task, lookup, at) && (narrow === undefined || narrow(task));
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
              const claimed = applyClaimToTask(
                candidate,
                at,
                leaseDurationMs,
                options.claimIdentity
              );
              next[claimed.id] = claimed;
              pass.claimed = { task: claimed, prevStatus: candidate.status };
              break;
            }
            const settled = applyAbandonmentSettlement(candidate, at, DEFAULT_MAX_ABANDONMENTS);
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
      if (captured.claimed === undefined) return null;
      emit("claimed", captured.claimed.task, captured.claimed.prevStatus);
      return captured.claimed.task;
    },

    async renewLease(id, leaseUntil, renewOptions) {
      assertValidLeaseDeadline(leaseUntil);
      if (renewOptions.claim === undefined) {
        throw new Error(
          `[tasks] renewLease requires the claim ticket the lease belongs to. ` +
            `Renewal is the holder asserting it is still alive, so an unfenced ` +
            `renewal would let anything keep anyone's lease open.`
        );
      }
      // Same-status, so this rides the ordinary transition path and picks up
      // all four decline arms — the lease fence among them. See the resource
      // backing's `renewLease` for why `updatedAt` moving is the right answer.
      return transitionTo(
        id,
        "in_progress",
        null,
        () => ({ leaseUntil }),
        { ...renewOptions, ifAllowed: true }
      );
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
          claimedBy: undefined,
          error: undefined,
        }),
        options
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
          const routing = routeFailure(
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

    async block(id, reason, options) {
      return transitionTo(
        id,
        "blocked",
        "blocked",
        () => (reason !== undefined ? { error: reason } : {}),
        options
      );
    },

    async unblock(id, options) {
      return transitionTo(
        id,
        "pending",
        "unblocked",
        () => ({ error: undefined }),
        options,
        // `blocked` is the ONLY status this may run from. The other two paths
        // to `pending` have their own verbs (`reclaim`, `resumeFromReview`),
        // and those clear the lease and the claim coordinate; this one has
        // nothing to clear because `blocked` is reachable only from `pending`.
        "blocked"
      );
    },

    async awaitReview(id, feedback, options) {
      return transitionTo(
        id,
        "awaiting_review",
        "review_requested",
        () => (feedback !== undefined ? { feedback } : {}),
        options
      );
    },

    async resumeFromReview(id, feedback, options) {
      return transitionTo(
        id,
        "pending",
        "resumed",
        () => ({
          feedback: feedback ?? undefined,
          leaseUntil: undefined,
          claimedBy: undefined,
        }),
        options
      );
    },

    async cancel(id, reason, options) {
      // The decline is now REPORTED (FIX-976) — behaviour is unchanged, but the
      // caller learns the cancel did nothing instead of reading silence as
      // success. Substrate write-backs discard this and stay silent.
      return transitionTo(
        id,
        "cancelled",
        "cancelled",
        () =>
          reason !== undefined
            ? {
                error: reason,
                completedAt: now(),
                leaseUntil: undefined,
                claimedBy: undefined,
              }
            : {
                completedAt: now(),
                leaseUntil: undefined,
                claimedBy: undefined,
              },
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
            task.leaseUntil < at
          ) {
            // Preserve `assignee` — it's the user-set worker-registry
            // routing key, not the runtime worker identity. Clearing it
            // would break re-dispatch through a worker registry.
            const reset: Task<TInput, TOutput> = {
              ...task,
              status: "pending",
              leaseUntil: undefined,
              claimedBy: undefined,
              updatedAt: at,
            };
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
