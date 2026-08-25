/**
 * FIX-1026: the status `setFieldsIfStatus` reports on a FAILED predicate must
 * be the status that failed it.
 *
 * `POST /abort` predicates on `["in_progress"]` and turns `{ applied: false }`
 * into `409 … already in terminal state "<status>"`. So a reported status that
 * came from a LATER lifecycle state is not cosmetic: reporting `in_progress`
 * there both contradicts the verb's own contract (the predicate cannot have
 * failed on a status inside it) and rejects a stop request for a request that
 * is, by then, running.
 *
 * Postgres is the only adapter where the report can come from a different
 * observation than the predicate — it is the one that answers with a second
 * statement. The window between the two is staged here at the executor seam:
 * a continuation commits `suspended → in_progress` the instant the conditional
 * write has been attempted, which is what `runAction`'s point-of-no-return
 * does (`runAction.ts`, "suspended / interrupted → in_progress"). PGlite runs
 * one connection, so an interposed write between two statements IS the
 * concurrent commit — no second connection needed to make it real.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPostgresRequestStore,
  initializeSchema,
  type QueryExecutor
} from "../src";
import type { RequestRecord, RequestStatus } from "@flow-state-dev/engine";

const pglites: PGlite[] = [];

/**
 * A `QueryExecutor` that runs `afterQuery` once each statement has completed,
 * giving the test a deterministic point to commit a concurrent transition into.
 */
function hookedExecutor(
  pglite: PGlite,
  afterQuery: () => Promise<void>
): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      await afterQuery();
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

function makeRecord(requestId: string, status: RequestStatus): RequestRecord {
  const now = Date.now();
  return {
    id: requestId,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    flowKind: "status-race-flow",
    actionName: "run",
    userId: "u_race",
    source: "http",
    status,
    startedAtMs: now
  };
}

describe("PostgresRequestStore — the status a failed predicate reports", () => {
  afterEach(async () => {
    while (pglites.length > 0) {
      const pglite = pglites.pop();
      await pglite?.close();
    }
  });

  it("reports the status that failed the predicate, not one a continuation set afterwards", async () => {
    const pglite = new PGlite();
    pglites.push(pglite);
    const requestId = "req_status_race";

    let armed = false;
    let fired = false;
    // The continuation's point-of-no-return, committed in the narrowest window
    // the conditional write leaves open: immediately after it has attempted
    // its write and before it can report anything.
    const continuationResumesTheRequest = async (): Promise<void> => {
      if (!armed || fired) return;
      fired = true;
      await pglite.query(
        "UPDATE requests SET status = 'in_progress' WHERE id = $1",
        [requestId]
      );
    };

    const executor = hookedExecutor(pglite, continuationResumesTheRequest);
    await initializeSchema(executor);
    const store = createPostgresRequestStore(executor, { liveTailPool: null });

    // A suspended request: outside `/abort`'s predicate, and — unlike a
    // completed one — able to come back.
    await store.set(requestId, makeRecord(requestId, "suspended"), "any");

    armed = true;
    const result = await store.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
    armed = false;

    // Without this the assertions below could pass on a window that never opened.
    expect(fired).toBe(true);

    expect(result.applied).toBe(false);
    // `suspended` is what the write actually predicated on. `in_progress` is
    // the contradiction: the route would answer
    // `409 … already in terminal state "in_progress"` and refuse to stop a
    // request that is running.
    expect(result.status).toBe("suspended");

    // The refusal is real either way — the flag must not have been written.
    expect(await store.isAbortRequested(requestId)).toBe(false);
  });

  it("still reports a terminal status the predicate genuinely failed on", async () => {
    const pglite = new PGlite();
    pglites.push(pglite);
    const requestId = "req_status_terminal";

    const executor = hookedExecutor(pglite, async () => {});
    await initializeSchema(executor);
    const store = createPostgresRequestStore(executor, { liveTailPool: null });

    await store.set(requestId, makeRecord(requestId, "completed"), "any");

    const result = await store.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );

    expect(result).toEqual({ applied: false, status: "completed" });
  });

  it("reports no status for a request that does not exist", async () => {
    const pglite = new PGlite();
    pglites.push(pglite);

    const executor = hookedExecutor(pglite, async () => {});
    await initializeSchema(executor);
    const store = createPostgresRequestStore(executor, { liveTailPool: null });

    const result = await store.setFieldsIfStatus(
      "req_status_missing",
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );

    expect(result).toEqual({ applied: false, status: undefined });
  });
});
