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
 *
 * This file is the storage: the state slot, read through the retired-shape
 * boundary, and written in one compare-and-set over the whole map. Every
 * `TaskCollectionRef` method is the method table's (`./method-table`).
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { StateRef } from "@flow-state-dev/core/types";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { Task, TaskClaimIdentity } from "../schema/task";
import { withRetiredShapes } from "../schema/retired-shapes";
import type { FilingStamp } from "./internal";
import type { TaskCollectionRef } from "./types";
import type { TaskChangeEvent } from "./change-event";
import type { TaskSettingsSupport } from "./filing";
import { TaskCapExceededError, validateTaskCaps, type TaskCapOptions } from "./task-caps";
import { createTaskMethodTable, type RowDecision, type RowWritten, type TaskBoardView, type TaskStorage } from "./method-table";

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
   * Fired after a committed write that is no lifecycle change (a run's spend, a
   * cleared marker): with `onChange`, every row write reaches one of the two.
   */
  onWrite?: (task: Task) => void;
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
  validateTaskCaps(`[tasks] collection "${options.collectionId}"`, options);
  // `null` (explicitly unbounded) and omission collapse to the same runtime
  // state here — the distinction only matters at the construction points that
  // decide whether to apply a default.
  const maxTotalTasks = options.maxTotalTasks ?? undefined;
  const maxEnqueuedTasks = options.maxEnqueuedTasks ?? undefined;
  const maxTotalRetries = options.maxTotalRetries ?? undefined;

  /**
   * The read boundary for this backing — same job as the resource backing's
   * `readTaskState`. Atomic state is stored, not parsed, so a row in a shape
   * the retired-shape map reads (`withRetiredShapes`, FIX-2080) arrives as
   * stored; it is mapped forward here, before any filter or the transition
   * guard sees it.
   *
   * The map is rebuilt only when a legacy row is actually present, so the
   * common path returns the stored object itself.
   */
  function migrateTasks(slot: unknown): Record<string, Task> {
    if (!slot || typeof slot !== "object") return {};
    const stored = slot as Record<string, Task>;
    let migrated: Record<string, Task> | undefined;
    for (const [id, task] of Object.entries(stored)) {
      const next = withRetiredShapes(task);
      if (next === task) continue;
      migrated ??= { ...stored };
      migrated[id] = next;
    }
    return migrated ?? stored;
  }

  function readTasks(): Record<string, Task> {
    const raw = options.state.state as Record<string, unknown>;
    return migrateTasks(raw[stateKey]);
  }

  /**
   * The board as `tasks` holds it. The map a write reads is immutable for
   * that invocation, so its rows are listed once and shared: a narrowed
   * claim hands them to `eligibility` per candidate.
   */
  function viewOf(tasks: Readonly<Record<string, Task>>): TaskBoardView {
    let rows: readonly Task[] | undefined;
    return { row: (id) => ownTask(tasks, id), rows: () => (rows ??= Object.values(tasks)) };
  }

  /**
   * Run a CAS-guarded write. The `mutate` callback returns the next tasks
   * map (or `undefined` for a no-op). Errors thrown inside `mutate`
   * propagate; the CAS retry loop in `atomicState` re-runs the callback
   * with the freshest committed tasks map.
   */
  async function casWrite(
    mutate: (tasks: Readonly<Record<string, Task>>) => Record<string, Task> | undefined
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
  function assertWithinCaps(next: Record<string, Task>): void {
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
   * Every write is one compare-and-set over the whole map, decided against
   * the committed map inside it. The outcome travels out as the callback's
   * return value (`withOutcome`), so it describes the invocation that
   * committed even when `atomicState` replays it. A state slot is read as
   * committed, so this storage has no `readCommitted`.
   */
  const storage: TaskStorage = {
    board: { row: (id) => ownTask(readTasks(), id), rows: () => Object.values(readTasks()) },

    async write<R>(id: string, decide: (row: Task, view: TaskBoardView) => RowDecision<R>): Promise<RowWritten<R>> {
      return withOutcome(casWrite, (tasks): { state: Record<string, Task> | undefined; result: RowWritten<R> } => {
        const task = ownTask(tasks, id);
        if (task === undefined) throw new Error(`[tasks] task "${id}" not found`);
        const decision = decide(task, viewOf(tasks));
        if (decision === undefined) return { state: undefined, result: undefined };
        if ("decline" in decision) return { state: undefined, result: { declined: decision.decline, status: task.status } };
        return { state: { ...tasks, [id]: decision.row }, result: { committed: decision.result } };
      });
    },

    // The whole batch is one write: `select` runs inside it, on the map it
    // commits against, so a replay re-selects from the winner's rows.
    async writeEach(select, decide, { stop, committed }) {
      type Result = Parameters<typeof committed>[0];
      const results =
        (await withOutcome(casWrite, (tasks) => {
          const view = viewOf(tasks);
          const next: Record<string, Task> = { ...tasks };
          const landed: Result[] = [];
          for (const candidate of select(view)) {
            const decision = decide(candidate, view);
            if (decision === undefined || "decline" in decision) continue;
            next[decision.row.id] = decision.row;
            landed.push(decision.result);
            if (stop?.(decision.result) === true) break;
          }
          return { state: landed.length === 0 ? undefined : next, result: landed };
        })) ?? [];
      for (const result of results) await committed(result);
    },

    async insert(rows, check, inserted) {
      await casWrite((tasks) => {
        // Against the committed map, inside the write (FIX-2080).
        check(viewOf(tasks));
        const next = { ...tasks };
        for (const task of rows) {
          if (ownTask(next, task.id) !== undefined) {
            throw new Error(`[tasks] task with id "${task.id}" already exists`);
          }
          // Own-property insertion (FIX-965): `next[task.id] = task` is a
          // phantom write when task.id is `"__proto__"` — it sets the
          // object's prototype instead of creating an own property, so the
          // task reports as added but is then absent from get/list/count.
          Object.defineProperty(next, task.id, { value: task, enumerable: true, writable: true, configurable: true });
        }
        assertWithinCaps(next);
        return next;
      });
      for (const task of rows) inserted(task);
    },

    // This backing enforces, so the resolved budget IS the limit in force.
    ...(maxTotalRetries !== undefined ? { retryBudget: maxTotalRetries } : {}),
  };

  return createTaskMethodTable<TInput, TOutput>({
    collectionId: options.collectionId,
    // The one clock this collection stamps and judges leases against (FIX-1005).
    now: options.now ?? Date.now,
    storage,
    ...(options.onChange !== undefined ? { onChange: options.onChange } : {}),
    ...(options.onWrite !== undefined ? { onWrite: options.onWrite } : {}),
    ...(options.getItems !== undefined ? { getItems: options.getItems } : {}),
    ...(options.claimIdentity !== undefined ? { claimIdentity: options.claimIdentity } : {}),
    ...(options.createdBy !== undefined ? { createdBy: options.createdBy } : {}),
    ...(options.settings !== undefined ? { settings: options.settings } : {}),
    ...(options.filing !== undefined ? { filing: options.filing } : {}),
  });
}
