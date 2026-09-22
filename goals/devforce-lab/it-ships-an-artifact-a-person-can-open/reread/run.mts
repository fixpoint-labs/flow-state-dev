/**
 * BR-11's fresh process — **not a goal**, despite the filename.
 *
 * It is spelled `run.mts` and sits in its own directory for one reason: the
 * goals `tsconfig.json` includes `**​/run.mts`, so a file spelled anything else
 * would be the only part of this check that `pnpm typecheck` never sees. It
 * carries no `goal.md`, so the `goal:all` sweep walks past it — discovery keys
 * on `goal.md`, never on a runner.
 *
 * BR-11 says the row, the run record and the transcript are readable from a
 * **fresh process over the same file**. Re-opening the database in the process
 * that wrote it is a weaker claim: that process still holds the caches, the
 * registry and the open handles. So the goal closes its store, spawns this,
 * and grades what comes back on stdout.
 *
 *   pnpm tsx .../reread/run.mts <db-file> <user-id> <ledger-key> <channel-session-id>
 *
 * Prints one JSON object and exits 0, or prints the reason and exits 1. It
 * asserts nothing: the goal owns the grading, and a reader that graded would be
 * a second opinion about what BR-11 means.
 */

import { createSQLiteStores } from "@flow-state-dev/store-sqlite";

/** What the goal reads back off stdout. */
interface Reread {
  /** The board row's settled status, or null when the key is gone. */
  rowStatus: string | null;
  /** How many `runs/**` records survived, and the outcome of the first. */
  runRecords: number;
  runOutcome: string | null;
  /** How many transcript lines the channel's session still carries. */
  transcriptLines: number | null;
}

const [dbFile, userId, ledgerKey, channelSessionId] = process.argv.slice(2);
if (
  dbFile === undefined ||
  userId === undefined ||
  ledgerKey === undefined ||
  channelSessionId === undefined
) {
  console.error("usage: run.mts <db-file> <user-id> <ledger-key> <channel-session-id>");
  process.exit(1);
}

const stores = createSQLiteStores({ filename: dbFile });
try {
  const row = await stores.resourceState.get("user", userId, ledgerKey);
  const runs = await stores.resourceState.getByPrefix("user", userId, "runs/");
  const session = (await stores.session.get(channelSessionId)) as
    | { state?: { transcript?: unknown[] } }
    | undefined;

  const firstRun = Object.values(runs)[0]?.state as { outcome?: unknown } | undefined;

  const result: Reread = {
    rowStatus: ((row?.state as { status?: string } | undefined)?.status ?? null) as string | null,
    runRecords: Object.keys(runs).length,
    runOutcome: firstRun?.outcome === undefined ? null : String(firstRun.outcome),
    transcriptLines: session?.state?.transcript?.length ?? null,
  };
  console.log(JSON.stringify(result));
} finally {
  stores.close();
}
