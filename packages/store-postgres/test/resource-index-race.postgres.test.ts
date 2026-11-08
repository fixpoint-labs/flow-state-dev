/**
 * Index build races that only a real Postgres server can show: PGlite is one
 * connection, so no two statements ever overlap in it.
 *
 * Runs when `FSD_TEST_POSTGRES_URL` is set. Without it the suite skips locally,
 * visibly, and fails in CI (`CI` set), so a CI job that lost its Postgres
 * service cannot pass by skipping the only test of the multi-connection path.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createPostgresResourceStateStore, initializeSchema, type QueryExecutor } from "../src/host";

const POSTGRES_URL = process.env.FSD_TEST_POSTGRES_URL;

/** `describe` for a suite that needs Postgres: runs, skips, or fails as above. */
function describeWithPostgres(name: string, body: () => void): void {
  if (POSTGRES_URL !== undefined && POSTGRES_URL !== "") {
    describe(name, body);
    return;
  }
  if (process.env.CI) {
    describe(name, () => {
      it("needs a Postgres server", () => {
        throw new Error(
          "FSD_TEST_POSTGRES_URL is not set. In CI these cases fail rather than skip: give the job a Postgres service."
        );
      });
    });
    return;
  }
  describe.skip(`${name} (skipped: FSD_TEST_POSTGRES_URL is not set)`, body);
}

function clientExecutor(client: pg.Client): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await client.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    }
  };
}

/** Poll until backend `pid` is waiting on a lock, or fail. */
async function untilBlocked(observer: pg.Client, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await observer.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
      [pid]
    );
    if (result.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${pid} never blocked on a lock`);
}

describeWithPostgres("Postgres resource index: a first build racing a write that does not list it", () => {
  const clients: pg.Client[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const client = new pg.Client({ connectionString: POSTGRES_URL });
      await client.connect();
      clients.push(client);
    }
    await initializeSchema(clientExecutor(clients[0]!));
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end()));
  });

  // The invariant is "superset, never missing": an index marked built must
  // find every row that has the value. A writer that does not know the index
  // (a rolling deploy) cannot add the entry, so it must clear the marker
  // instead — even when the marker was committed after its statement began,
  // which its own statement snapshot cannot see.
  it("never leaves the index built without the row the write committed", async () => {
    const [locker, writer, builder] = clients as [pg.Client, pg.Client, pg.Client];
    const scope = `race-${randomUUID()}`;
    const collection = "work/**";
    const index = "byId@1";
    const writes = createPostgresResourceStateStore(clientExecutor(writer));
    const builds = createPostgresResourceStateStore(clientExecutor(builder));
    await builds.set("session", scope, "work/k", { id: "old" }, 0);

    // Hold the row so the index-unaware write blocks after taking its snapshot.
    await locker.query("BEGIN");
    await locker.query(
      "SELECT 1 FROM resource_state WHERE scope_type = 'session' AND scope_id = $1 AND resource_key = 'work/k' FOR UPDATE",
      [scope]
    );
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const written = writes.set("session", scope, "work/k", { id: "new" }, "any");
    await untilBlocked(locker, writerPid);

    // A whole first build runs while the write waits: it sees only the old row.
    const build = await builds.indexes!.beginBuild("session", scope, collection, index);
    const scanned = await builds.getByPrefix("session", scope, "work/");
    const completed = await builds.indexes!.completeBuild(
      "session",
      scope,
      collection,
      index,
      build,
      Object.entries(scanned).map(([key, row]) => ({ key, values: [String(row.state.id)] }))
    );
    expect(completed).toBe(true);

    await locker.query("COMMIT");
    expect(await written).toMatchObject({ ok: true });

    expect(await builds.get("session", scope, "work/k")).toMatchObject({ state: { id: "new" } });
    const state = await builds.indexes!.state("session", scope, collection, index);
    const found = await builds.indexes!.findKeys("session", scope, collection, index, "new");
    // Built and missing the row is the one unrecoverable answer.
    expect({ state, found }).not.toEqual({ state: "built", found: [] });
    expect(state).toBe("unbuilt");
  });
});
