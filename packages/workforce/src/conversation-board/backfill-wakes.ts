/**
 * The upgrade's one-off backfill of wakes (FIX-2078, BP-030).
 *
 * A debt a board recorded before wakes existed has no due time the engine
 * keeps: an owed notice or report marker on a row. Nothing would pay it in a quiet conversation. Run once at host start
 * (or as a migration step), this reads every user's conversation rows and owes
 * a wake, due now, for the board's pass in each session that holds such a
 * debt. The pass then pays it the way it pays any debt: an old notice is
 * stamped due and sent, and an old report marker is sent to the Error
 * Reporter once. A running task a queued message held open (`keptOpenBy:
 * "queued"`) gets a wake for its task session's check entry instead
 * (`CHECK_TASK_ENTRY`, FIX-2077): it reads as answered and waiting on its
 * filed work, and the check settles it with the answer it kept.
 *
 * Safe to run again: a wake coalesces into the one already kept, and a pass
 * that finds nothing owed clears it.
 */
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { CHECK_TASK_ENTRY, DISPATCH_ENTRY } from "./board-entries";
import { sessionIdOfFiling } from "./filing-session";
import { CONVERSATION_LEDGER_ID } from "./ledger";

/** A stored session, as the backfill reads it. */
interface StoredSession {
  readonly id: string;
  readonly flowKind: string;
  readonly flowId?: string | null;
  readonly userId: string;
  readonly orgId?: string | null;
  readonly tenantId?: string | null;
}

/** The stores the backfill reads and writes: the engine's `StoreRegistry` fits. */
export interface BoardWakeBackfillStores {
  readonly session: { list(options?: { parentage?: "all" }): Promise<StoredSession[]> };
  readonly resourceState: {
    getByPrefix(scopeType: "user", scopeId: string, prefix: string): Promise<Record<string, { state: unknown }>>;
  };
  /** Absent on a store that keeps no wakes: the backfill writes nothing. */
  readonly wakes?: {
    owe(input: {
      tenantId?: string;
      sessionId: string;
      entry: string;
      flowKind: string;
      userId: string;
      orgId: string;
      dueAt: number;
      landBy: number;
    }): Promise<unknown>;
  };
}

export interface BoardWakeBackfillOptions {
  /**
   * The storage key of a user's cell, where user-scoped rows are kept: the
   * engine's `resolveUserStorageKey(userId, orgId, { id, isolateUserState: false })`.
   * The shared cell is the only one to read: the conversation ledger is
   * partitioned, and a partitioned ledger is never isolated per flow
   * (`defineTaskCollection` sets `flowIsolation: false`), also on a flow that
   * isolates its user state.
   */
  readonly userCell: (userId: string, orgId: string) => string;
  /** When the wakes fall due. Defaults to now. */
  readonly now?: number;
}

/** A stored row, as far as the backfill reads it. */
interface StoredRow {
  readonly goal?: unknown;
  readonly status?: unknown;
  readonly keptOpenBy?: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly filer?: { sessionId?: unknown };
  readonly run?: { sessionId?: unknown };
}

const OWED_MARKER = /^(noticeOwed|reportOwed):/;

/** The session a row's debt is paid in and the entry that pays it, or `undefined` when it owes nothing. */
function payerOf(row: StoredRow, partition: string): { session: string; entry: string } | undefined {
  // Known gap: a "queued" row with no `run.sessionId` names no session, so it gets no check.
  const checked = row.status === "in_progress" && row.keptOpenBy === "queued";
  if (checked) return typeof row.run?.sessionId === "string" ? { session: row.run.sessionId, entry: CHECK_TASK_ENTRY } : undefined;
  // A paid marker is kept as `null`.
  if (!Object.entries(row.metadata ?? {}).some(([key, value]) => value != null && OWED_MARKER.test(key))) return undefined;
  return { session: typeof row.filer?.sessionId === "string" ? row.filer.sessionId : sessionIdOfFiling(partition), entry: DISPATCH_ENTRY };
}

/** The bare session id of a stored record, whose id carries its tenant. */
function bareId(session: StoredSession): string {
  const tenant = session.tenantId;
  return tenant != null && tenant.length > 0 && session.id.startsWith(`${tenant}:`) ? session.id.slice(tenant.length + 1) : session.id;
}

/**
 * Owe a wake for the board's pass in every session that holds a debt recorded
 * before wakes existed. Returns how many sessions it owed one for.
 */
export async function backfillBoardWakes(stores: BoardWakeBackfillStores, options: BoardWakeBackfillOptions): Promise<number> {
  const wakes = stores.wakes;
  if (wakes === undefined) return 0;
  const now = options.now ?? Date.now();
  const sessions = new Map<string, StoredSession>();
  // Every session, not only the ones a user started: a task session (a
  // child session) is where a piece's notice and a held-open row are paid.
  for (const session of await stores.session.list({ parentage: "all" })) sessions.set(bareId(session), session);

  const cells = new Map<string, { userId: string; orgId: string }>();
  for (const session of sessions.values()) {
    const orgId = session.orgId ?? DEFAULT_ORG_ID;
    cells.set(options.userCell(session.userId, orgId), { userId: session.userId, orgId });
  }

  const payers = new Map<string, { session: string; entry: string }>();
  for (const cell of cells.keys()) {
    const stored = await stores.resourceState.getByPrefix("user", cell, `${CONVERSATION_LEDGER_ID}/`);
    for (const [key, value] of Object.entries(stored)) {
      const row = value.state as StoredRow | null;
      if (row === null || typeof row !== "object" || typeof row.goal !== "string" || typeof row.status !== "string") continue;
      // `<ledger>/<partition segment>/<task id>`.
      const parts = key.split("/");
      if (parts.length !== 3 || parts[0] !== CONVERSATION_LEDGER_ID) continue;
      const payer = payerOf(row, decodeURIComponent(parts[1]!));
      if (payer !== undefined) payers.set(`${payer.session}\u0000${payer.entry}`, payer);
    }
  }

  let owed = 0;
  for (const { session: payer, entry } of payers.values()) {
    const session = sessions.get(payer);
    if (session === undefined) continue;
    await wakes.owe({
      ...(session.tenantId != null && session.tenantId.length > 0 ? { tenantId: session.tenantId } : {}),
      sessionId: payer,
      entry,
      flowKind: session.flowId ?? session.flowKind,
      userId: session.userId,
      orgId: session.orgId ?? DEFAULT_ORG_ID,
      dueAt: now,
      landBy: now
    });
    owed += 1;
  }
  return owed;
}
