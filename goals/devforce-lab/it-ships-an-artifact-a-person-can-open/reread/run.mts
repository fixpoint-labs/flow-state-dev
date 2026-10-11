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
 *   pnpm tsx .../reread/run.mts <db-file> <user-id> <org-id> <row-key> <workstream-session-id>
 *
 * The row is read from the user's storage, because the board is the
 * workstream session's and a session's board is kept in its owner's storage;
 * so is the run record.
 *
 * Prints one JSON object and exits 0, or prints the reason and exits 1. It
 * asserts nothing: the goal owns the grading, and a reader that graded would be
 * a second opinion about what BR-11 means.
 */

import { resolveUserStorageKey } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";

/** What the goal reads back off stdout. */
interface Reread {
  /** The board row's settled status, or null when the key is gone. */
  rowStatus: string | null;
  /** How many `runs/**` records survived, and the outcome of the first. */
  runRecords: number;
  runOutcome: string | null;
  /** How many lines from the person the workstream's session still carries. */
  transcriptLines: number | null;
}

const [dbFile, userId, orgId, rowKey, sessionId] = process.argv.slice(2);
if (
  dbFile === undefined ||
  userId === undefined ||
  orgId === undefined ||
  rowKey === undefined ||
  sessionId === undefined
) {
  console.error("usage: run.mts <db-file> <user-id> <org-id> <row-key> <workstream-session-id>");
  process.exit(1);
}

const stores = createSQLiteStores({ filename: dbFile });
try {
  // The row and the run records live in the user's cell in the org, like all user data.
  const userCell = resolveUserStorageKey(userId, orgId, { id: "", isolateUserState: false });
  const row = await stores.resourceState.get("user", userCell, rowKey);
  const runs = await stores.resourceState.getByPrefix("user", userCell, "runs/");
  const session = await stores.session.get(sessionId);
  const firstRun = Object.values(runs)[0]?.state as { outcome?: unknown } | undefined;

  // A person's line is a user message item on the session's requests.
  const requests = await stores.request.list({ sessionId, withItems: true } as never);
  const postedLines = requests
    .flatMap((request) => (request as { items?: unknown[] }).items ?? [])
    .filter((item) => {
      const typed = item as { type?: string; role?: unknown };
      return typed.type === "message" && typed.role === "user";
    }).length;

  const result: Reread = {
    rowStatus: ((row?.state as { status?: string } | undefined)?.status ?? null) as string | null,
    runRecords: Object.keys(runs).length,
    runOutcome: firstRun?.outcome === undefined ? null : String(firstRun.outcome),
    transcriptLines: session === undefined ? null : postedLines,
  };
  console.log(JSON.stringify(result));
} finally {
  stores.close();
}
