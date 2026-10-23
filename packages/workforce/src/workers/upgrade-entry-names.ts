/**
 * The host-start rewrite of worker entries an older host stored under their
 * old names (BP-030).
 *
 * Every worker flow's door was `run` (Shift Manager's own, `message`) and its
 * board's pass `runTaskBoard`; they are `respond` and `dispatch` now, and no
 * alias takes the old names. A request an older host left unfinished under
 * an old name (running when it stopped, or parked on a question) would resume
 * by that name, and a wake an older host owed would fire it, and both would
 * fail as an unknown action. Run once at host start, after the workers are
 * hired, this rewrites each to the new name, so an upgrade mid-reply or
 * mid-wait loses nothing.
 *
 * It rewrites only what a worker flow the host registered no longer has under
 * the old name and has under the new one, so another flow's own `run` is left
 * alone. Safe to run again: a second run finds nothing under an old name.
 * Run it before the host's router is built, so the durability sweep can't
 * fire an old-name wake first.
 *
 * Not covered: a job already queued on an external dispatcher (BullMQ) under
 * an old name. Let the queues empty before deploying.
 */
import { DISPATCH_ENTRY } from "../conversation-board/board-entries";
import { RESPOND_ACTION } from "../worker-door";

/** A rename: the old name, the new one, and where the new one lives on a flow. */
const RENAMES = [
  { from: "run", to: RESPOND_ACTION, section: "actions" },
  { from: "message", to: RESPOND_ACTION, section: "actions" },
  { from: "runTaskBoard", to: DISPATCH_ENTRY, section: "internal" }
] as const;

/** The statuses a request still resumes from. */
const UNFINISHED = ["in_progress", "suspended", "interrupted"] as const;

/** The most wakes read in one pass: far more than any host keeps due at start. */
const WAKE_READ_LIMIT = 1_000_000;

/** How many times a wake bumped while it is moved is read and moved again. */
const WAKE_MOVE_ATTEMPTS = 5;

/** A registered flow copy, as far as the upgrade reads it: what `hireWorkforce` returns. */
export interface EntryNameFlow {
  readonly id: string;
  readonly actions?: Readonly<Record<string, unknown>>;
  readonly internal?: { readonly actions?: Readonly<Record<string, unknown>> };
  readonly task?: { readonly actions?: Readonly<Record<string, unknown>> };
}

type StoredWake = {
  readonly tenantId?: string;
  readonly sessionId: string;
  readonly entry: string;
  readonly flowKind: string;
  readonly userId: string;
  readonly orgId: string;
  readonly dueAt: number;
  readonly landBy: number;
  readonly version: number;
};

/** A stored request, as far as the upgrade reads it. */
export interface EntryNameRequest {
  readonly id: string;
  readonly flowKind: string;
  readonly flowId?: string;
  readonly actionName: string;
  readonly createdAt: number;
  readonly incarnation?: string | null;
}

type ActiveEntry = { readonly requestId: string; readonly flowKind: string; readonly flowId?: string; readonly actionName: string };

/** The stores the upgrade reads and writes: the engine's `StoreRegistry` fits. */
export interface EntryNameUpgradeStores {
  readonly request: {
    list(options: { status: readonly (typeof UNFINISHED)[number][] }): Promise<ReadonlyArray<EntryNameRequest>>;
    setFieldsIfStatus(
      id: string,
      fields: { actionName: string },
      allowedStatuses: readonly (typeof UNFINISHED)[number][],
      updatedAt: number,
      expectedIncarnation?: string
    ): Promise<{ applied: boolean }>;
  };
  /** The live-request registry, whose entries name their action too. */
  readonly activeRequests?: {
    listAll(): Promise<ReadonlyArray<ActiveEntry>>;
    register(entry: never): Promise<void>;
  };
  /** Absent on a store that keeps no wakes: none is rewritten. */
  readonly wakes?: {
    listDue(now: number, limit: number): Promise<readonly StoredWake[]>;
    get(key: { tenantId?: string; sessionId: string; entry: string }): Promise<StoredWake | null>;
    owe(input: Omit<StoredWake, "version">): Promise<unknown>;
    clear(key: { tenantId?: string; sessionId: string; entry: string }, version: number): Promise<boolean>;
  };
}

/** What {@link upgradeWorkerEntryNames} takes beside the stores and the flows. */
export interface EntryNameUpgradeOptions {
  /**
   * Which request a stored record is, as the store compares it: pass the
   * engine's `resolveRequestIncarnation`. Each rewrite is fenced on it, so a
   * record deleted and made again under the same id is never rewritten.
   */
  readonly incarnationOf: (record: EntryNameRequest) => string;
}

/** Whether `name` is declared anywhere on `flow`. */
function declares(flow: EntryNameFlow, name: string): boolean {
  return [flow.actions, flow.internal?.actions, flow.task?.actions].some((section) => section !== undefined && Object.hasOwn(section, name));
}

/** The new name for `name` on `flow`, or `undefined` when it isn't one this upgrade rewrites there. */
function renamed(flow: EntryNameFlow | undefined, name: string): string | undefined {
  if (flow === undefined || declares(flow, name)) return undefined;
  const rename = RENAMES.find((candidate) => candidate.from === name);
  if (rename === undefined) return undefined;
  const section = rename.section === "actions" ? flow.actions : flow.internal?.actions;
  return section !== undefined && Object.hasOwn(section, rename.to) ? rename.to : undefined;
}

/**
 * Rewrite the unfinished requests and the wakes an older host stored under a
 * worker entry's old name to its new one.
 *
 * @param stores The host's stores (`runtime.stores`).
 * @param flows The flows the host registered: `hireWorkforce`'s copies.
 * @param options `incarnationOf`: the engine's `resolveRequestIncarnation`.
 * @returns How many requests and wakes it rewrote: only writes that applied count.
 */
export async function upgradeWorkerEntryNames(
  stores: EntryNameUpgradeStores,
  flows: readonly EntryNameFlow[],
  options: EntryNameUpgradeOptions
): Promise<{ requests: number; wakes: number }> {
  const byId = new Map(flows.map((flow) => [flow.id, flow]));
  let requests = 0;
  for (const record of await stores.request.list({ status: UNFINISHED })) {
    const to = renamed(byId.get(record.flowId ?? record.flowKind), record.actionName);
    if (to === undefined) continue;
    const written = await stores.request.setFieldsIfStatus(
      record.id,
      { actionName: to },
      UNFINISHED,
      Date.now(),
      options.incarnationOf(record)
    );
    if (written.applied) requests += 1;
  }

  // The live registry names each running request's action as well; it is read
  // for listings, and kept in step with the record.
  if (stores.activeRequests !== undefined) {
    for (const entry of await stores.activeRequests.listAll()) {
      const to = renamed(byId.get(entry.flowId ?? entry.flowKind), entry.actionName);
      if (to !== undefined) await stores.activeRequests.register({ ...entry, actionName: to } as never);
    }
  }

  let wakes = 0;
  if (stores.wakes !== undefined) {
    for (const due of await stores.wakes.listDue(Number.MAX_SAFE_INTEGER, WAKE_READ_LIMIT)) {
      const to = renamed(byId.get(due.flowKind), due.entry);
      if (to === undefined) continue;
      const oldKey = { ...(due.tenantId === undefined ? {} : { tenantId: due.tenantId }), sessionId: due.sessionId, entry: due.entry };
      // The new wake first: a crash between the two leaves a wake that pays
      // nothing, never a lost one. A clear that loses to a write bumping the
      // old wake reads it again and moves what it holds now.
      let wake: StoredWake | null = due;
      for (let attempt = 0; wake !== null && attempt < WAKE_MOVE_ATTEMPTS; attempt += 1) {
        const { version, ...kept } = wake;
        await stores.wakes.owe({ ...kept, entry: to });
        if (await stores.wakes.clear(oldKey, version)) {
          wakes += 1;
          wake = null;
        } else {
          wake = await stores.wakes.get(oldKey);
        }
      }
    }
  }
  return { requests, wakes };
}
