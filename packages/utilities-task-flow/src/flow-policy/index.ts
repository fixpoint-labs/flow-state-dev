/**
 * Task flow policy (FIX-610 Wave 2, Layer A).
 *
 * The substrate maintains an *observation ledger* for each Task Board
 * run: an append-only list of every tool call (and its result/error)
 * any worker made during the run. Before dispatching a task, the board
 * consults the configured `TaskFlowPolicy` to pick which observations
 * to surface on the new worker's `TaskWorkerInput.priorWork` slot.
 *
 * Two halves:
 *
 * 1. **Ledger** — `createObservationLedger` (in-memory store +
 *    `ObservationLedgerView`) and `createObservationLedgerCapability`
 *    for installing as a capability on standalone generators. The board
 *    wires its own per-run ledger directly via the bind helpers.
 *
 * 2. **Policies** — `flowPolicy.none()`, `declaredDepsOnly()`,
 *    `ancestors()`, `recentTrajectory()`, `allCompleted()`, `compact()`,
 *    `custom(fn)`. All return a `TaskFlowPolicy` shape the board calls
 *    once per dispatch.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/tasks";

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/** One recorded tool-call observation. Cheap to copy; values are not cloned. */
export interface Observation {
  /** Monotonic sequence within the ledger; assigned on append. */
  seq: number;
  /** The Task Board collection id that owns this ledger. */
  collectionId: string;
  /** Id of the task whose worker made the call. May be absent for non-board generators. */
  taskId?: string;
  /** Stable id of the worker block / iteration that made the call. */
  workerId?: string;
  toolName: string;
  args: unknown;
  /** Set when the call succeeded (or returned a cached hit). */
  result?: unknown;
  /** Set when the call threw. Errors do NOT populate `result`. */
  error?: string;
  /** True when the call was served from the per-tool memoization cache. */
  cached: boolean;
  /** `Date.now()` at observation time. */
  ts: number;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** Read-only projection helpers over a ledger. Policies use this to select. */
export interface ObservationLedgerView {
  /** All observations, oldest first. Read-only snapshot. */
  all(): readonly Observation[];
  /** The most recent N observations (chronological, newest last). */
  recent(n: number): Observation[];
  /** Observations whose `taskId` is in the supplied set. */
  fromTasks(taskIds: readonly string[]): Observation[];
  /**
   * Observations from the supplied task's declared deps (and, when
   * `transitive: true`, the deps' deps). Resolved against the live
   * collection so a replan-introduced dep is honored.
   */
  fromAncestors(
    task: Task,
    collection: TaskCollectionRef,
    opts?: { transitive?: boolean },
  ): Observation[];
  /** Observations from tasks the collection currently marks `"completed"`. */
  fromCompleted(collection: TaskCollectionRef): Observation[];
  /**
   * Token-bounded slice of the supplied observations. Uses a simple
   * character-count heuristic (~4 chars/token) — the spec calls for a
   * pluggable token counter in a future revision.
   */
  bounded(observations: Observation[], maxTokens: number): Observation[];
}

export interface ObservationLedger {
  view(): ObservationLedgerView;
  /** Append a new observation; `seq` is assigned. Returns the stored value. */
  append(o: Omit<Observation, "seq">): Observation;
  /** Drop every observation. Called by the board's run-end cleanup. */
  clear(): void;
  size(): number;
}

export function createObservationLedger(opts: {
  maxEntries?: number;
} = {}): ObservationLedger {
  const maxEntries = opts.maxEntries ?? 10_000;
  const entries: Observation[] = [];
  let nextSeq = 1;

  function view(): ObservationLedgerView {
    return {
      all: () => entries,
      recent(n) {
        if (n <= 0) return [];
        return entries.slice(Math.max(0, entries.length - n));
      },
      fromTasks(taskIds) {
        const set = new Set(taskIds);
        return entries.filter((e) => e.taskId !== undefined && set.has(e.taskId));
      },
      fromAncestors(task, collection, fromAncestorsOpts) {
        const transitive = fromAncestorsOpts?.transitive === true;
        const ancestorIds = new Set<string>();
        const stack: string[] = [...(task.deps ?? [])];
        while (stack.length > 0) {
          const id = stack.pop()!;
          if (ancestorIds.has(id)) continue;
          ancestorIds.add(id);
          if (transitive) {
            const dep = collection.get(id);
            if (dep !== undefined && Array.isArray(dep.deps)) {
              for (const d of dep.deps) stack.push(d);
            }
          }
        }
        return entries.filter(
          (e) => e.taskId !== undefined && ancestorIds.has(e.taskId),
        );
      },
      fromCompleted(collection) {
        const completedIds = new Set(
          collection.list({ status: "completed" }).map((t) => t.id),
        );
        return entries.filter(
          (e) => e.taskId !== undefined && completedIds.has(e.taskId),
        );
      },
      bounded(observations, maxTokens) {
        if (maxTokens <= 0 || observations.length === 0) return [];
        const out: Observation[] = [];
        let used = 0;
        for (let i = observations.length - 1; i >= 0; i--) {
          const o = observations[i]!;
          // safeStringify so circular references or non-JSON values
          // in args/result don't crash the policy — `formatPriorWork`
          // already uses the same guard for the same reason.
          const approx = Math.ceil(
            (safeStringify(o.args).length +
              safeStringify(o.result ?? o.error ?? "").length) /
              4,
          );
          if (used + approx > maxTokens) break;
          out.unshift(o);
          used += approx;
        }
        return out;
      },
    };
  }

  return {
    view,
    append(o) {
      const stored: Observation = { ...o, seq: nextSeq++ };
      entries.push(stored);
      if (entries.length > maxEntries) {
        entries.splice(0, entries.length - maxEntries);
      }
      return stored;
    },
    clear() {
      entries.length = 0;
    },
    size: () => entries.length,
  };
}

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

export type ObservationLedgerAccessor = {
  view: () => ObservationLedgerView;
  stats: () => { entries: number };
} & Record<string, (...args: any[]) => any>;

export interface CreateObservationLedgerCapabilityOptions {
  name?: string;
  maxEntries?: number;
}

/**
 * Capability that installs an observation ledger on the active context.
 * Task Board wiring binds its own ledger directly via
 * `bindObservationLedger`; the capability path is for standalone
 * generators that want flow-policy semantics without a board.
 */
export function createObservationLedgerCapability(
  options: CreateObservationLedgerCapabilityOptions = {},
) {
  const name = options.name ?? "observationLedger";
  const maxEntries = options.maxEntries ?? 10_000;
  return defineCapability({
    name,
    fns: (ctx: BlockContext): ObservationLedgerAccessor => {
      const ledger = resolveOrCreateLedger(ctx, name, maxEntries);
      bindObservationLedger(ctx, ledger);
      return {
        view: () => ledger.view(),
        stats: () => ({ entries: ledger.size() }),
      };
    },
  });
}

// Hidden bag on `ctx.request` for the same reason described in the
// tool-cache module: the ledger carries function properties, so it
// can't go through `ctx.request.state` (which gets structured-cloned
// for snapshots). The request handle is shared by reference across
// every nested ctx, so a bag attached here is reachable from any
// block executing in the request.
const LEDGER_BAG_KEY = "__fsd_fix610_observationLedgers";

function resolveOrCreateLedger(
  ctx: BlockContext,
  name: string,
  maxEntries: number,
): ObservationLedger {
  const req = ctx.request as unknown as Record<string, unknown>;
  let bag = req[LEDGER_BAG_KEY] as Record<string, ObservationLedger> | undefined;
  if (bag === undefined) {
    bag = {};
    Object.defineProperty(req, LEDGER_BAG_KEY, {
      value: bag,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  const existing = bag[name];
  if (existing !== undefined) return existing;
  const ledger = createObservationLedger({ maxEntries });
  bag[name] = ledger;
  return ledger;
}

/**
 * Bind a ledger to the active context's tool-observation hook so the
 * substrate writes every cacheable tool call into it. Used by Task
 * Board wiring to attach the per-run ledger to the worker subtree.
 *
 * The substrate's `_writeToolObservation` slot accepts a normalised
 * payload; this binder fills in the board attribution (collectionId,
 * taskId, workerId) when available.
 */
export function bindObservationLedger(
  ctx: BlockContext,
  ledger: ObservationLedger,
  attribution?: { collectionId: string; getTaskId?: () => string | undefined; getWorkerId?: () => string | undefined },
): void {
  (ctx as {
    _writeToolObservation?: (e: {
      toolName: string;
      args: unknown;
      result?: unknown;
      error?: string;
      cached: boolean;
    }) => void;
  })._writeToolObservation = (e) => {
    ledger.append({
      collectionId: attribution?.collectionId ?? "",
      taskId: attribution?.getTaskId?.(),
      workerId: attribution?.getWorkerId?.(),
      toolName: e.toolName,
      args: e.args,
      ...(e.result !== undefined ? { result: e.result } : {}),
      ...(e.error !== undefined ? { error: e.error } : {}),
      cached: e.cached,
      ts: Date.now(),
    });
  };
}

// ---------------------------------------------------------------------------
// TaskPriorWork & TaskFlowPolicy
// ---------------------------------------------------------------------------

/**
 * Structured value the board stamps on `TaskWorkerInput.priorWork`.
 * Workers can either consume `observations` directly or use the
 * pre-rendered `narrative` (when a policy produced one) as a context
 * blob.
 */
export interface TaskPriorWork {
  observations: ReadonlyArray<{
    taskId?: string;
    toolName: string;
    args: unknown;
    result?: unknown;
    error?: string;
    cached: boolean;
    ts: number;
  }>;
  /** Optional pre-rendered prompt-ready summary. */
  narrative?: string;
  /** Selection metadata for observability / DevTool. */
  meta?: {
    policy: string;
    selected: number;
    available: number;
    tokensApprox?: number;
  };
}

/**
 * A flow policy decides which observations a soon-to-dispatch worker
 * sees on its `priorWork` slot. The board calls `select` once per task
 * dispatch with the live ledger view and the task about to run.
 */
export interface TaskFlowPolicy {
  /** Human-readable label stamped on `priorWork.meta.policy`. */
  readonly name: string;
  select(args: {
    task: Task;
    ledger: ObservationLedgerView;
    collection: TaskCollectionRef;
    ctx: BlockContext;
  }): TaskPriorWork | Promise<TaskPriorWork>;
}

// ---------------------------------------------------------------------------
// Built-in policies
// ---------------------------------------------------------------------------

function toPriorWork(
  name: string,
  observations: Observation[],
  available: number,
): TaskPriorWork {
  return {
    observations: observations.map((o) => ({
      taskId: o.taskId,
      toolName: o.toolName,
      args: o.args,
      ...(o.result !== undefined ? { result: o.result } : {}),
      ...(o.error !== undefined ? { error: o.error } : {}),
      cached: o.cached,
      ts: o.ts,
    })),
    meta: { policy: name, selected: observations.length, available },
  };
}

function none(): TaskFlowPolicy {
  return {
    name: "none",
    select: () => ({ observations: [], meta: { policy: "none", selected: 0, available: 0 } }),
  };
}

function declaredDepsOnly(): TaskFlowPolicy {
  return {
    name: "declaredDepsOnly",
    select: ({ task, ledger }) => {
      const all = ledger.all();
      if (task.deps === undefined || task.deps.length === 0) {
        return toPriorWork("declaredDepsOnly", [], all.length);
      }
      const selected = ledger.fromTasks(task.deps);
      return toPriorWork("declaredDepsOnly", selected, all.length);
    },
  };
}

function ancestors(opts: { transitive?: boolean } = {}): TaskFlowPolicy {
  return {
    name: "ancestors",
    select: ({ task, ledger, collection }) => {
      const selected = ledger.fromAncestors(task, collection, opts);
      return toPriorWork("ancestors", selected, ledger.all().length);
    },
  };
}

function recentTrajectory(opts: { n: number; maxTokens?: number }): TaskFlowPolicy {
  return {
    name: "recentTrajectory",
    select: ({ ledger }) => {
      let selected = ledger.recent(opts.n);
      if (opts.maxTokens !== undefined) {
        selected = ledger.bounded(selected, opts.maxTokens);
      }
      return toPriorWork("recentTrajectory", selected, ledger.all().length);
    },
  };
}

function allCompleted(opts: { maxTokens?: number } = {}): TaskFlowPolicy {
  return {
    name: "allCompleted",
    select: ({ ledger, collection }) => {
      let selected = ledger.fromCompleted(collection);
      if (opts.maxTokens !== undefined) {
        selected = ledger.bounded(selected, opts.maxTokens);
      }
      return toPriorWork("allCompleted", selected, ledger.all().length);
    },
  };
}

/**
 * v1 stub — keeps verbatim recent N and drops older ones. Future
 * iteration will route the older observations through a summarizer
 * block. The signature is forward-compatible so callers can switch in
 * a real summarizer when one ships.
 */
function compact(opts: { recentN: number; summarizer?: unknown }): TaskFlowPolicy {
  return {
    name: "compact",
    select: ({ ledger }) => {
      const all = ledger.all();
      const recent = ledger.recent(opts.recentN);
      return toPriorWork("compact", recent, all.length);
    },
  };
}

function custom(
  selectFn: TaskFlowPolicy["select"],
  label = "custom",
): TaskFlowPolicy {
  return { name: label, select: selectFn };
}

/**
 * Built-in flow policies. Import as `flowPolicy` and call as
 * `flowPolicy.recentTrajectory({ n: 8 })`. The naming follows the
 * `[domain]Verb` capability-helper convention.
 */
export const flowPolicy = {
  none,
  declaredDepsOnly,
  ancestors,
  recentTrajectory,
  allCompleted,
  compact,
  custom,
};

// ---------------------------------------------------------------------------
// Format helper
// ---------------------------------------------------------------------------

/**
 * Pretty-print prior-work observations for a worker prompt. Workers
 * that don't want to interpret the structured shape can call this
 * directly to get a Markdown-ish list. The default rendering is
 * `[#seq] toolName(args) → result | error` plus a header noting which
 * task the observation came from.
 */
export function formatPriorWork(priorWork: TaskPriorWork): string {
  if (priorWork.observations.length === 0) return "";
  const lines = priorWork.observations.map((o, i) => {
    const head = o.taskId !== undefined ? `[${o.taskId}] ` : "";
    const argStr = truncate(safeStringify(o.args), 200);
    const resultStr =
      o.error !== undefined
        ? `error: ${truncate(o.error, 200)}`
        : `result: ${truncate(safeStringify(o.result), 400)}`;
    const cachedFlag = o.cached ? " (cached)" : "";
    return `- ${head}${o.toolName}(${argStr}) → ${resultStr}${cachedFlag}`;
  });
  return ["Prior work in this run:", ...lines].join("\n");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
