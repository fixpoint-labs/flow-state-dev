/**
 * Goal check — a flow finds a collection's rows by a declared field and gets
 * the same rows on every store; on SQLite and Postgres it reads an index kept
 * in step with the rows, including rows written before the index existed
 * (FIX-2532).
 *
 * **Model-free.** A real `createFlowState` host per store (memory, SQLite on a
 * file, Postgres on PGlite), each serving one flow over a task ledger kept per
 * partition (`defineTaskCollection({ partitionBy })`, which declares
 * `byTaskId`). The flow's `file` action files tasks through the ledger's own
 * add, in the partition its session names; its `find` action answers which
 * partitions hold an id, through `findTaskPartitions`, which is `findBy`.
 *
 * Order, per store:
 *   1. Seed ledger rows and `__ids` markers straight into the store, as an
 *      older release left them: no index entries, one marker naming a
 *      partition that holds no row.
 *   2. Look up every seeded id (the first lookups: they build the index).
 *   3. File the fixture's tasks in three partitions, one id in two of them.
 *   4. Look up every id again, counting the prefix and whole-scope reads of
 *      resource state that reach the store.
 *
 * Signals (each failure is tagged `<signal>:<store>:<detail>`):
 *   a  every lookup in step 4 returns exactly the fixture's partitions for the
 *      id, a duplicate id included, and the three stores return the same sets
 *   b  on SQLite and Postgres, step 4 makes zero prefix or whole-scope reads
 *   c  every lookup in step 2 returns the seeded rows' partitions, on the
 *      first call
 *
 * Controls (`GOAL_CONTROL`):
 *   wrong-index-values  every write's `byTaskId` entries reach the store with
 *     a wrong value. Must FAIL (a) on the rows filed in step 3 (SQL stores
 *     miss them; memory, which keeps no entries, still finds them).
 *   scan-only  the SQL stores' index verbs are hidden, so `findBy` scans.
 *     Must FAIL (b).
 *
 * Run: pnpm tsx goals/collection-indexes/find-rows-by-a-declared-field/run.mts
 * Fixture: GOAL_FIXTURE=<file in fixtures/> (default `default.json`)
 */
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { encodeUserSegment, type ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { ResourceStateSetOptions, StoreRegistry } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  taskSchema
} from "@flow-state-dev/orchestration/tasks";
import { findTaskPartitions, taskLedgerResources } from "@flow-state-dev/orchestration/internal";
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { resolveTaskPartition } from "../../../packages/orchestration/src/tasks/collection/partition.ts";
import { goalTmpDir, loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["", "wrong-index-values", "scan-only"];
if (!CONTROLS.includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL ${JSON.stringify(CONTROL)}`);

const fixtureSchema = z.object({
  legacyRows: z.array(z.object({ partition: z.string(), id: z.string() })).min(1),
  legacyMarkers: z.array(z.object({ partition: z.string(), id: z.string() })),
  filed: z.array(z.object({ partition: z.string(), ids: z.array(z.string()).min(1) })).min(1),
  absent: z.array(z.string())
});
const fixture = fixtureSchema.parse(loadFixture(import.meta.url, process.env.GOAL_FIXTURE ?? "default.json"));

const LEDGER = "goal-work";
const USER = "u_find_rows";
/** The user cell a ledger with no flow isolation keeps its rows in. */
const CELL = `${USER}:~org:${DEFAULT_ORG_ID}`;

// ── the flow ─────────────────────────────────────────────────────────────────

const ledger = defineTaskCollection({ id: LEDGER, scope: "user", partitionBy: ({ sessionId }) => sessionId });

const fileInput = z.object({ ids: z.array(z.string()) });
const findInput = z.object({ id: z.string() });

const flow = defineFlow({
  kind: "find-rows",
  resources: taskLedgerResources(ledger),
  actions: {
    file: {
      inputSchema: fileInput,
      block: handler({
        name: "file",
        inputSchema: fileInput,
        outputSchema: z.object({}),
        execute: async (input, ctx) => {
          const collection = ctx.resources[LEDGER] as unknown as ResourceCollectionRef;
          const partition = await resolveTaskPartition(LEDGER, ledger.__taskCollection.partitionBy!, ctx);
          const ref = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: LEDGER, collection, partition });
          await ref.createTasks(input.ids.map((id: string) => ({ id, goal: `do ${id}` })));
          return {};
        }
      })
    },
    find: {
      inputSchema: findInput,
      block: handler({
        name: "find",
        inputSchema: findInput,
        outputSchema: z.array(z.string()),
        execute: async (input, ctx) => (await findTaskPartitions(ctx, LEDGER, input.id)).sort()
      })
    }
  }
})({ id: "find-rows" });

// ── the stores, and what the controls do to them ─────────────────────────────

type StoreName = "memory" | "sqlite" | "postgres";

async function rawStores(name: StoreName): Promise<StoreRegistry> {
  if (name === "memory") return (await inMemoryStores().resolve(["primary"])) as StoreRegistry;
  if (name === "sqlite") return createSQLiteStores({ filename: join(goalTmpDir("find-rows-by-field"), "store.db") });
  const pglite = new PGlite();
  return createPostgresStores({
    executor: {
      async query(text: string, values?: unknown[]) {
        const result = await pglite.query(text, values);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
      }
    }
  });
}

/** Count the prefix and whole-scope reads of resource state that reach the store. */
function countScans(raw: StoreRegistry): { scans: number } {
  const counter = { scans: 0 };
  const store = raw.resourceState;
  const getByPrefix = store.getByPrefix.bind(store);
  const getAll = store.getAll.bind(store);
  store.getByPrefix = async (...args) => {
    counter.scans++;
    return getByPrefix(...args);
  };
  store.getAll = async (...args) => {
    counter.scans++;
    return getAll(...args);
  };
  return counter;
}

/** What the store underneath the engine is, under the running control. */
function underControl(raw: StoreRegistry): StoreRegistry {
  const store = raw.resourceState;
  if (CONTROL === "wrong-index-values") {
    const set = store.set.bind(store);
    store.set = (scopeType, scopeId, key, state, expectedVersion, options?: ResourceStateSetOptions) =>
      set(scopeType, scopeId, key, state, expectedVersion, {
        ...options,
        indexEntries: options?.indexEntries?.map((entry) =>
          entry.index.startsWith("byTaskId@") ? { ...entry, values: ['"not-this-id"'] } : entry
        )
      });
    return raw;
  }
  if (CONTROL === "scan-only") {
    const hidden = new Proxy(store, {
      get(target, key) {
        if (key === "indexes") return undefined;
        const value = Reflect.get(target, key, target) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    return { ...raw, resourceState: hidden };
  }
  return raw;
}

async function boot(raw: StoreRegistry) {
  const stores = underControl(raw);
  const state = createFlowState({
    flows: { "find-rows": flow } as never,
    stores: { default: { primary: { capabilities: ["primary"], resolve: () => Promise.resolve(stores) } } }
  });
  const runtime = await state.getRuntime();
  const act = async (actionName: "file" | "find", input: unknown, sessionId: string) => {
    const result = await runAction({
      flow,
      actionName,
      input,
      userId: USER,
      orgId: DEFAULT_ORG_ID,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig, logger: silentLogger }
    } as never);
    if (result.error !== undefined) throw result.error;
    return result.output;
  };
  return {
    file: (partition: string, ids: string[]) => act("file", { ids }, partition),
    find: async (id: string) => (await act("find", { id }, "s_reader")) as string[]
  };
}

// ── what the fixture says each lookup must answer ────────────────────────────

const partitionsOf = (rows: ReadonlyArray<{ partition: string; id: string }>) => {
  const out = new Map<string, string[]>();
  for (const { partition, id } of rows) out.set(id, [...new Set([...(out.get(id) ?? []), partition])].sort());
  return out;
};
const filedRows = fixture.filed.flatMap(({ partition, ids }) => ids.map((id) => ({ partition, id })));
const beforeFiling = partitionsOf(fixture.legacyRows);
const afterFiling = partitionsOf([...fixture.legacyRows, ...filedRows]);
const lookedUp = [...new Set([...afterFiling.keys(), ...fixture.legacyMarkers.map((m) => m.id), ...fixture.absent])].sort();

// ── the run ──────────────────────────────────────────────────────────────────

await runGoal(async (failures, tell) => {
  const answers = new Map<StoreName, Map<string, string[]>>();
  const scansAfter = new Map<StoreName, number>();
  for (const name of ["memory", "sqlite", "postgres"] as const) {
    const raw = await rawStores(name);
    // 1. Rows and markers as an older release left them, before this host
    //    (and so the index) existed.
    for (const { partition, id } of fixture.legacyRows) {
      const row = taskSchema.parse({ id, goal: `legacy ${id}`, status: "pending", createdAt: 1, updatedAt: 1 });
      await raw.resourceState.set("user", CELL, `${LEDGER}/${encodeUserSegment(partition)}/${id}`, row as never, "absent");
    }
    for (const { partition, id } of fixture.legacyMarkers) {
      const key = `${LEDGER}__ids/${encodeUserSegment(id)}/${encodeUserSegment(partition)}`;
      await raw.resourceState.set("user", CELL, key, { partition } as never, "absent");
    }
    const counter = countScans(raw);
    const host = await boot(raw);

    // 2. The first lookups: built from the rows they find.
    for (const id of tell.over(`c:${name} · seeded ids`, [...beforeFiling.keys()])) {
      const got = await host.find(id);
      const want = beforeFiling.get(id)!;
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures.push(`c:${name}:${id}: first lookup returned ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      }
    }

    // 3. File the fixture's tasks, each partition in its own session.
    for (const { partition, ids } of fixture.filed) await host.file(partition, ids);

    // 4. Every id again, counting reads.
    const before = counter.scans;
    const seen = new Map<string, string[]>();
    for (const id of tell.over(`a:${name} · looked-up ids`, lookedUp)) {
      const got = await host.find(id);
      seen.set(id, got);
      const want = afterFiling.get(id) ?? [];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures.push(`a:${name}:${id}: returned ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      }
    }
    answers.set(name, seen);
    scansAfter.set(name, counter.scans - before);
    if (name !== "memory" && counter.scans - before !== 0) {
      failures.push(`b:${name}: the lookups after the build made ${counter.scans - before} prefix or whole-scope reads, want 0`);
    }
  }

  const memory = JSON.stringify([...answers.get("memory")!]);
  for (const name of ["sqlite", "postgres"] as const) {
    if (JSON.stringify([...answers.get(name)!]) !== memory) failures.push(`a:same-everywhere: ${name} answered differently from memory`);
  }

  const duplicates = [...afterFiling].filter(([, partitions]) => partitions.length > 1).map(([id]) => id);
  tell.over("a · ids held in more than one partition", duplicates);
  return {
    failures,
    evidence:
      `${lookedUp.length} ids × 3 stores matched the fixture (duplicates: ${duplicates.join(", ")}); ` +
      `reads after the build: sqlite ${scansAfter.get("sqlite")}, postgres ${scansAfter.get("postgres")} ` +
      `(memory scans: ${scansAfter.get("memory")}); seeded rows found on the first lookup` +
      (CONTROL === "" ? "" : ` · control ${CONTROL}`)
  };
});
