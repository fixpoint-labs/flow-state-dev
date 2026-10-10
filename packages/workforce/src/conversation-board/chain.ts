/**
 * How far a chain of split tasks goes (FIX-1802 S5): its depth, and how many
 * tasks one top task may have under it.
 *
 * A *chain* starts at a task a session that isn't a task session files: its
 * *top*. That task's session may split it into pieces on its own board, each
 * piece's session may split again, and so on. Two limits bound it, both
 * refused in the ref the board's resolver returns, by throwing the task
 * substrate's own `TaskCapExceededError`, which the task tools and actions
 * answer as `total_task_cap_exceeded`:
 *
 * - **Depth.** The top's board is the first; a piece filed from the session
 *   of a task on board *n* lands on board *n + 1*. Board
 *   {@link MAX_TASK_DEPTH} takes tasks, the next one doesn't. Each task
 *   session is born knowing its depth, the parent's plus one, from the
 *   hand-over's server-written state, never from input.
 * - **Breadth.** At most {@link DEFAULT_TASK_CHAIN_LIMIT} tasks under one top
 *   task, at any depth, finished ones included, unless the app sets
 *   `hireWorkforce`'s `taskChainLimit`. Counted in one versioned record per
 *   chain at the owner's user scope, keyed by the top's board partition and
 *   the top task's id, so two sessions' tops with one id count apart. A
 *   filing reserves its task's id before the add (idempotent by id: nothing
 *   is given back) and marks it added once the add commits. At the limit, a
 *   reservation whose add never landed is dropped once
 *   {@link CHAIN_RESERVATION_LEASE_MS} has passed since it was made, and the
 *   count is taken again. No other board's rows are read. The record is
 *   deleted when the top task ends.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import type { BlockContext, ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { TaskCapExceededError } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { retryOnConflict } from "../projects/cas-retry";
import { TASK_CHAIN_STATE_KEY } from "../workers/keys";

/** The deepest board a chain reaches: the top's board is the first. Fixed. */
export const MAX_TASK_DEPTH = 5;

/** The most tasks under one top task, at any depth, when the app sets none. */
export const DEFAULT_TASK_CHAIN_LIMIT = 100;

/**
 * How long a reservation whose add never landed holds its place before a
 * filing at the limit may drop it: comfortably longer than one add.
 */
export const CHAIN_RESERVATION_LEASE_MS = 5 * 60_000;

/** The accessor a flow declares the chain records under. */
export const TASK_CHAINS_RESOURCE = "workforceTaskChains";

/** Where a chain's top is: the board partition it was filed on, and its id. */
export const chainTopSchema = z.object({ partition: z.string().min(1), taskId: z.string().min(1) }).strict();

export type ChainTop = z.infer<typeof chainTopSchema>;

/**
 * A task session's place in its chain, written by the hand-over at its birth:
 * the board its task is on (the top's is 1) and the chain's top.
 */
export const taskChainSchema = z.object({ depth: z.number().int().min(1), top: chainTopSchema }).strict();

export type TaskChain = z.infer<typeof taskChainSchema>;

const chainEntrySchema = z.object({
  /** `reserved` until its add commits, then `added`. */
  state: z.enum(["reserved", "added"]),
  /** When it was reserved, in ms. */
  at: z.number()
});

/** One chain's record: every task filed under its top, by board and id. */
export const chainRecordSchema = z.object({
  top: chainTopSchema,
  entries: z.record(chainEntrySchema).default({})
});

export type ChainRecord = z.infer<typeof chainRecordSchema>;

/**
 * The chain records, at `workforce/task-chains/*` in the owner's user scope.
 * Shared across flows: a chain's sessions run on whatever flows its
 * delegates do. Server-written; no browser read.
 */
export const taskChainsCollection = defineResourceCollection({
  pattern: "workforce/task-chains/*",
  scope: "user",
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: chainRecordSchema
});

/** The flow resources that install the chain records. */
export const taskChainResources = { [TASK_CHAINS_RESOURCE]: taskChainsCollection } as const;

/** The running session's place in its chain, or none: a session that isn't a task session is no piece. */
export function taskChainOf(ctx: { readonly session: { readonly state: unknown } }): TaskChain | undefined {
  const value = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_CHAIN_STATE_KEY];
  const parsed = taskChainSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The chain a task filed now on the running session's board would be in: the
 * board it lands on, and the top it counts under (`undefined` for a top, which
 * counts under none).
 *
 * @param partition The running session's own board partition.
 */
export function chainOfFiling(
  ctx: { readonly session: { readonly state: unknown } },
  partition: string,
  taskId: string
): { depth: number; top: ChainTop | undefined; birth: TaskChain } {
  const own = taskChainOf(ctx);
  const depth = (own?.depth ?? 0) + 1;
  return {
    depth,
    top: own?.top,
    // What a session opened for this task is born with.
    birth: { depth, top: own?.top ?? { partition, taskId } }
  };
}

/** A chain record's key: one per top board partition and top task id. */
async function chainKey(top: ChainTop): Promise<string> {
  const bytes = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([top.partition, top.taskId])))
  );
  let hex = "";
  for (const byte of bytes.subarray(0, 16)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** The key a task holds in its chain's record: its board and its id. */
export function chainEntryKey(partition: string, taskId: string): string {
  return JSON.stringify([partition, taskId]);
}

function chainsOf(ctx: BlockContext): ResourceCollectionRef<ChainRecord> {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[TASK_CHAINS_RESOURCE];
  if (ref === undefined) {
    throw new Error(
      `The running flow doesn't declare the task chain records ("${TASK_CHAINS_RESOURCE}"), so a split task's pieces can't be counted. ` +
        "Spread the filing kit's `resources` into the flow."
    );
  }
  return ref as unknown as ResourceCollectionRef<ChainRecord>;
}

async function recordOf(ctx: BlockContext, top: ChainTop): Promise<ResourceRef<ChainRecord>> {
  return chainsOf(ctx).getOrCreate(await chainKey(top), { top, entries: {} });
}

/**
 * Reserve a place for a task in its chain, before its add: idempotent by the
 * task's board and id. At the limit, reservations older than the lease are
 * dropped first; still at it, refused.
 *
 * @throws TaskCapExceededError when the chain is full.
 */
export async function reserveInChain(
  ctx: BlockContext,
  options: { top: ChainTop; entry: string; limit: number; now: number; collectionId: string }
): Promise<void> {
  const record = await recordOf(ctx, options.top);
  const outcome = await retryOnConflict(() =>
    updateStateWith<ChainRecord, "held" | "reserved" | number>(record, (state: ChainRecord) => {
      const entries = { ...state.entries };
      if (entries[options.entry] !== undefined) return { state, result: "held" as const };
      if (Object.keys(entries).length >= options.limit) {
        for (const [key, entry] of Object.entries(entries)) {
          if (entry.state === "reserved" && options.now - entry.at >= CHAIN_RESERVATION_LEASE_MS) delete entries[key];
        }
      }
      const count = Object.keys(entries).length;
      if (count >= options.limit) return { state, result: count + 1 };
      entries[options.entry] = { state: "reserved", at: options.now };
      return { state: { ...state, entries }, result: "reserved" as const };
    })
  );
  if (typeof outcome === "number") {
    throw new TaskCapExceededError({
      cap: "total",
      limit: options.limit,
      attempted: outcome,
      collectionId: options.collectionId
    });
  }
}

/**
 * Mark the tasks at `entries` added in their chain's record: their adds
 * committed. Only a reserved entry moves: writes nothing when none is, and
 * never brings back a record its top's ending deleted.
 */
export async function markAddedInChain(ctx: BlockContext, top: ChainTop, entries: readonly string[]): Promise<void> {
  if (entries.length === 0) return;
  const record = await chainsOf(ctx).getOptional(await chainKey(top));
  if (record === undefined) return;
  if (!entries.some((entry) => record.state.entries[entry]?.state === "reserved")) return;
  await retryOnConflict(() =>
    updateStateWith(record, (state: ChainRecord) => {
      const reserved = entries.filter((entry) => state.entries[entry]?.state === "reserved");
      if (reserved.length === 0) return { state, result: undefined };
      const next = { ...state.entries };
      for (const entry of reserved) next[entry] = { state: "added", at: next[entry]!.at };
      return { state: { ...state, entries: next }, result: undefined };
    })
  );
}

/** Delete a chain's record: its top task ended. */
export async function deleteChain(ctx: BlockContext, top: ChainTop): Promise<void> {
  // A flow that doesn't declare the records keeps none to delete.
  if ((ctx.resources as Record<string, unknown> | undefined)?.[TASK_CHAINS_RESOURCE] === undefined) return;
  const chains = chainsOf(ctx);
  const key = await chainKey(top);
  if ((await chains.getOptional(key)) === undefined) return;
  await chains.delete(key);
}
