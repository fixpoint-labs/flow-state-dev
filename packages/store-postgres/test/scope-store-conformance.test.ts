/**
 * Postgres adapter compliance with the shared scope-store CAS contract
 * (FIX-1007).
 *
 * The suite is the engine's; this file only supplies the backends. The
 * cross-connection pair is two `PostgresStoreRegistry` instances over one
 * PGlite database — the same "simulates two nodes" arrangement
 * `cas-contract.test.ts` uses, and what makes the `ON CONFLICT (id) DO
 * NOTHING` insert the thing actually deciding the create race rather than a
 * read-then-insert in front of it.
 */
import { afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createScopeStoreConformanceTests, type ScopeStoreUnderTest } from "@flow-state-dev/engine/testing";
import { createPostgresStores, type QueryExecutor } from "../src";

// Each conformance case gets its own PGlite engine (a full embedded Postgres),
// so it must be closed as soon as that case is done rather than left open
// until `afterAll` — a dozen live PGlite instances at once is what blew up
// this suite's memory. `cleanup` below closes the PGlite belonging to the
// case's store the moment the case finishes; `pglites`/`afterAll` remain only
// as a backstop for anything that doesn't go through that path.
const pglites: PGlite[] = [];
const pgliteByStore = new WeakMap<ScopeStoreUnderTest, PGlite>();

function freshPglite(): PGlite {
  const pglite = new PGlite();
  pglites.push(pglite);
  return pglite;
}

function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

async function closePglite(pglite: PGlite): Promise<void> {
  const index = pglites.indexOf(pglite);
  if (index !== -1) pglites.splice(index, 1);
  await pglite.close();
}

afterAll(async () => {
  await Promise.all(pglites.map((pglite) => pglite.close()));
});

createScopeStoreConformanceTests({
  name: "PostgresSessionStore",
  createStore: async () => {
    const pglite = freshPglite();
    const stores = await createPostgresStores({ executor: pgliteExecutor(pglite) });
    pgliteByStore.set(stores.session, pglite);
    return stores.session;
  },
  cleanup: async (store) => {
    const pglite = pgliteByStore.get(store);
    if (!pglite) return;
    pgliteByStore.delete(store);
    await closePglite(pglite);
  },
  createSharedPair: async () => {
    const pglite = freshPglite();
    const executor = pgliteExecutor(pglite);
    const a = await createPostgresStores({ executor });
    const b = await createPostgresStores({ executor });
    return { a: a.session, b: b.session, cleanup: () => closePglite(pglite) };
  }
});
