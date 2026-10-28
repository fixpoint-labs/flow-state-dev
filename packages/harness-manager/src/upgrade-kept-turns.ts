/**
 * The upgrade's one-off step for a person's lines the coding door kept
 * (FIX-2086, BP-030).
 *
 * Before FIX-2086 a person's line into a coding run was kept in the
 * `turns/**` collection for the attempt that would act on it. Lines now reach
 * a run as steers on its task (`Task.steers`), so nothing writes `turns/**`
 * and nothing reads it but this step. Run once at host start (or as a
 * migration step), it reads every user's kept turns and writes each one no
 * attempt took (neither delivered nor withdrawn) onto its task's row as an
 * untaken steer from the person, keyed by the turn's own key so a second run
 * adds nothing. A turn whose task has finished is left: a finished task takes
 * no steer. A row waiting on its filed work keeps waiting on it: nothing here
 * starts the turn a live steer's sender starts, so the check its filed work
 * wakes when it ends owes the steer its turn.
 *
 * Which row: a turn is kept under its run's issue and phase; the run record
 * of that issue-phase on a board names the task (`taskId`), and the row is
 * found on the ledgers the host names, under the board segment the record's
 * topic leads with (`runBoardSegment`).
 */
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { isTerminalStatus, steerWrite, type Task } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { runBoardSegment } from "./workspace";

/** The kept turns' storage prefix, as the coding door wrote them. */
const TURNS_PREFIX = "turns/";
/** The run records' storage prefix. */
const RUNS_PREFIX = "runs/";

/** A kept turn, as the door stored it. Every field defaults, as it did. */
const keptTurnSchema = z.object({
  message: z.string().default(""),
  keptAt: z.number().nullable().default(null),
  forAttempt: z.number().nullable().default(null),
  deliveredTo: z.number().nullable().default(null),
  withdrawn: z.boolean().default(false),
});

/** A stored session, as the step reads it. */
interface StoredSession {
  readonly userId: string;
  readonly orgId?: string | null;
}

/** The stores the step reads and writes: the engine's `StoreRegistry` fits. */
export interface KeptTurnUpgradeStores {
  readonly session: { list(options?: { parentage?: "all" }): Promise<StoredSession[]> };
  readonly resourceState: {
    getByPrefix(scopeType: "user", scopeId: string, prefix: string): Promise<Record<string, { state: unknown; version: number }>>;
    set(
      scopeType: "user",
      scopeId: string,
      resourceKey: string,
      state: Record<string, unknown>,
      expectedVersion: number,
    ): Promise<{ ok: boolean } | unknown>;
  };
}

export interface KeptTurnUpgradeOptions {
  /**
   * The storage key of a user's cell: the engine's
   * `resolveUserStorageKey(userId, orgId, { id, isolateUserState: false })`.
   * Kept turns, run records and a partitioned ledger all live in the shared
   * cell.
   */
  readonly userCell: (userId: string, orgId: string) => string;
  /** The task ledgers the managers ran rows from, by collection id (a conversation's board is `"tasks"`). */
  readonly ledgers: readonly string[];
}

/** One kept turn no attempt took. */
interface Untaken {
  readonly key: string;
  readonly issue: string;
  readonly phase: string;
  readonly message: string;
  readonly keptAt: number;
}

/**
 * Write every kept turn no attempt took onto its task as an untaken steer.
 * Returns how many it wrote.
 */
export async function upgradeKeptTurns(stores: KeptTurnUpgradeStores, options: KeptTurnUpgradeOptions): Promise<number> {
  const cells = new Map<string, string>();
  for (const session of await stores.session.list({ parentage: "all" })) {
    cells.set(options.userCell(session.userId, session.orgId ?? DEFAULT_ORG_ID), session.userId);
  }
  let written = 0;
  for (const [cell, userId] of cells) {
    const untaken = await untakenTurns(stores, cell);
    if (untaken.length === 0) continue;
    const runs = await stores.resourceState.getByPrefix("user", cell, RUNS_PREFIX);
    for (const ledger of options.ledgers) {
      const rows = await stores.resourceState.getByPrefix("user", cell, `${ledger}/`);
      for (const [key, stored] of Object.entries(rows)) {
        const located = locate(ledger, key);
        const segment = runBoardSegment(ledger, located.partition);
        const mine = untaken.filter((turn) => {
          const record = runs[`${RUNS_PREFIX}${segment}/${turn.issue}/${turn.phase}`]?.state as { taskId?: unknown } | undefined;
          return record?.taskId === located.taskId;
        });
        if (mine.length === 0) continue;
        written += await writeSteers(stores, cell, key, stored, mine, userId);
      }
    }
  }
  return written;
}

/** A ledger row's key, read back to its partition and task id: `<ledger>/<partition segment>/<task id>` or `<ledger>/<task id>`. */
function locate(ledger: string, key: string): { partition: string | undefined; taskId: string } {
  const rest = key.slice(ledger.length + 1);
  const slash = rest.indexOf("/");
  if (slash < 0) return { partition: undefined, taskId: rest };
  return { partition: decodeURIComponent(rest.slice(0, slash)), taskId: rest.slice(slash + 1) };
}

/** A cell's kept turns that no attempt took and no door withdrew. */
async function untakenTurns(stores: KeptTurnUpgradeStores, cell: string): Promise<Untaken[]> {
  const kept = await stores.resourceState.getByPrefix("user", cell, TURNS_PREFIX);
  const untaken: Untaken[] = [];
  for (const [key, value] of Object.entries(kept)) {
    // `turns/<issue>/<phase>/<forAttempt>/<id>`.
    const parts = key.slice(TURNS_PREFIX.length).split("/");
    if (parts.length !== 4) continue;
    const turn = keptTurnSchema.safeParse(value.state ?? {});
    if (!turn.success || turn.data.withdrawn || turn.data.deliveredTo !== null || turn.data.forAttempt === null) continue;
    untaken.push({ key, issue: parts[0]!, phase: parts[1]!, message: turn.data.message, keptAt: turn.data.keptAt ?? 0 });
  }
  return untaken.sort((a, b) => a.keptAt - b.keptAt || (a.key < b.key ? -1 : 1));
}

/**
 * Append `turns` to the row stored at `key` as steers, each keyed by its turn,
 * through the same decision a live steer takes (`steerWrite`): a key already
 * there adds nothing and the limit stops it. A row waiting on its filed work
 * keeps that wait (see the file header). A finished row takes none. One
 * conditional write, read again on a conflict.
 */
async function writeSteers(
  stores: KeptTurnUpgradeStores,
  cell: string,
  key: string,
  stored: { state: unknown; version: number },
  turns: readonly Untaken[],
  userId: string,
): Promise<number> {
  let current = stored;
  for (let tries = 0; tries < 3; tries += 1) {
    const stored = (current.state ?? {}) as Task;
    if (typeof stored.status !== "string" || isTerminalStatus(stored.status)) return 0;
    let row = stored;
    let added = 0;
    for (const turn of turns) {
      const id = `turn:${turn.key}`;
      const decided = steerWrite(row, { message: turn.message, from: "user", by: userId, key: id }, id, turn.keptAt);
      if (decided === "limit") break;
      if (decided === "unchanged") continue;
      // Only the steer: waiting on it would need a turn started now, and a
      // check turn that takes no steer settles over one it waits on.
      row = { ...row, steers: decided.patch.steers };
      added += 1;
    }
    if (added === 0) return 0;
    const result = (await stores.resourceState.set("user", cell, key, row as unknown as Record<string, unknown>, current.version)) as {
      ok?: boolean;
    };
    if (result.ok !== false) return added;
    const fresh = (await stores.resourceState.getByPrefix("user", cell, key))[key];
    if (fresh === undefined) return 0;
    current = fresh;
  }
  return 0;
}
