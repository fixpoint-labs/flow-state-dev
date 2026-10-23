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

/** The stores the upgrade reads and writes: the engine's `StoreRegistry` fits. */
export interface EntryNameUpgradeStores {
  readonly request: {
    list(options: { status: readonly (typeof UNFINISHED)[number][] }): Promise<
      ReadonlyArray<{ id: string; flowKind: string; flowId?: string; actionName: string; incarnation?: string }>
    >;
    setFieldsIfStatus(
      id: string,
      fields: { actionName: string },
      allowedStatuses: readonly (typeof UNFINISHED)[number][],
      updatedAt: number,
      expectedIncarnation?: string
    ): Promise<unknown>;
  };
  /** Absent on a store that keeps no wakes: none is rewritten. */
  readonly wakes?: {
    listDue(now: number, limit: number): Promise<readonly StoredWake[]>;
    owe(input: Omit<StoredWake, "version">): Promise<unknown>;
    clear(key: { tenantId?: string; sessionId: string; entry: string }, version: number): Promise<boolean>;
  };
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
 * @returns How many requests and wakes it rewrote.
 */
export async function upgradeWorkerEntryNames(
  stores: EntryNameUpgradeStores,
  flows: readonly EntryNameFlow[]
): Promise<{ requests: number; wakes: number }> {
  const byId = new Map(flows.map((flow) => [flow.id, flow]));
  let requests = 0;
  for (const record of await stores.request.list({ status: UNFINISHED })) {
    const to = renamed(byId.get(record.flowId ?? record.flowKind), record.actionName);
    if (to === undefined) continue;
    await stores.request.setFieldsIfStatus(record.id, { actionName: to }, UNFINISHED, Date.now(), record.incarnation);
    requests += 1;
  }

  let wakes = 0;
  if (stores.wakes !== undefined) {
    for (const wake of await stores.wakes.listDue(Number.MAX_SAFE_INTEGER, WAKE_READ_LIMIT)) {
      const to = renamed(byId.get(wake.flowKind), wake.entry);
      if (to === undefined) continue;
      const { version, ...kept } = wake;
      // The new wake first: a crash between the two leaves a wake that pays nothing, never a lost one.
      await stores.wakes.owe({ ...kept, entry: to });
      await stores.wakes.clear({ ...(wake.tenantId === undefined ? {} : { tenantId: wake.tenantId }), sessionId: wake.sessionId, entry: wake.entry }, version);
      wakes += 1;
    }
  }
  return { requests, wakes };
}
