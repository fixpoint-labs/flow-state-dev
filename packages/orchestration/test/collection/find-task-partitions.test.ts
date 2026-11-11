/**
 * Which partitions of a partitioned ledger hold a task id
 * (`findTaskPartitions`), answered by the ledger's declared `byTaskId` index
 * through `findBy` (FIX-2532, amending FIX-2160 D1), through `createFlowState`
 * on the in-memory store (which scans) and SQLite (which reads its index).
 *
 * Why it matters: a message addressed `{ task: id }` names a row the sender
 * can't place, since rows live at `<partition>/<id>`. The lookup must find
 * every partition that holds the id, a duplicate included, without loading
 * every conversation's rows on each send, and must find rows an older release
 * wrote, which carry no index entries and sit beside the `__ids` markers that
 * release kept.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { encodeUserSegment, type ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreAdapter, StoreRegistry } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  taskSchema,
} from "../../src/tasks";
import { findTaskPartitions } from "../../src/tasks/collection/find-task-partitions";
import { taskLedgerResources } from "../../src/tasks/collection/define-task-collection";
import { resolveTaskPartition } from "../../src/tasks/collection/partition";

const LEDGER = "convo-tasks";
const USER = "u_find_partitions";
/** The user cell a ledger with no flow isolation keeps its rows in. */
const CELL = `${USER}:~org:${DEFAULT_ORG_ID}`;

const ledger = defineTaskCollection({ id: LEDGER, scope: "user", partitionBy: ({ sessionId }) => sessionId });

const fileInput = z.object({ ids: z.array(z.string()) });
const findInput = z.object({ id: z.string() });

const file = handler({
  name: "file",
  inputSchema: fileInput,
  outputSchema: z.object({}),
  execute: async (input, ctx) => {
    const collection = ctx.resources[LEDGER] as unknown as ResourceCollectionRef;
    const partition = await resolveTaskPartition(LEDGER, ledger.__taskCollection.partitionBy!, ctx);
    const ref = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: LEDGER, collection, partition });
    await ref.createTasks(input.ids.map((id) => ({ id, goal: `do ${id}` })));
    return {};
  },
});

const find = handler({
  name: "find",
  inputSchema: findInput,
  outputSchema: z.array(z.string()),
  execute: async (input, ctx) => (await findTaskPartitions(ctx, LEDGER, input.id)).sort(),
});

const flow = defineFlow({
  kind: "partitions",
  resources: taskLedgerResources(ledger),
  actions: { file, find },
})({ id: "partitions" });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const stores: Record<string, () => StoreAdapter> = {
  memory: () => inMemoryStores(),
  sqlite: () => {
    const dir = mkdtempSync(join(tmpdir(), "find-task-partitions-"));
    dirs.push(dir);
    return sqliteStores({ filename: join(dir, "store.db") });
  },
};

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

async function boot(adapter: StoreAdapter) {
  const raw = (await adapter.resolve(["primary"])) as StoreRegistry;
  const state = createFlowState({
    flows: { partitions: flow } as never,
    stores: { default: { primary: { capabilities: ["primary"], resolve: () => Promise.resolve(raw) } } },
    modelResolver: createMockModelResolver({}),
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
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never);
    if (result.error !== undefined) throw result.error;
    return result.output;
  };
  return {
    raw,
    file: (sessionId: string, ids: string[]) => act("file", { ids }, sessionId),
    find: async (id: string) => (await act("find", { id }, "s_reader")) as string[],
  };
}

/** A ledger row as an older release left it: written straight to the store, with no index entries. */
async function seedLegacyRow(raw: StoreRegistry, partition: string, id: string): Promise<void> {
  const state = taskSchema.parse({ id, goal: `legacy ${id}`, status: "pending", createdAt: 1, updatedAt: 1 });
  const key = `${LEDGER}/${encodeUserSegment(partition)}/${id}`;
  expect((await raw.resourceState.set("user", CELL, key, state as never, "absent")).ok).toBe(true);
}

/** The `__ids` marker an older release wrote beside each row (FIX-2160's id index). */
async function seedLegacyMarker(raw: StoreRegistry, partition: string, id: string): Promise<string> {
  const key = `${LEDGER}__ids/${encodeUserSegment(id)}/${encodeUserSegment(partition)}`;
  expect((await raw.resourceState.set("user", CELL, key, { partition } as never, "absent")).ok).toBe(true);
  return key;
}

describe.each(Object.keys(stores))("findTaskPartitions on the %s store", (name) => {
  it("finds the partition an add filed the id in, and every id of a batch", async () => {
    const h = await boot(stores[name]!());
    await h.file("conv-a", ["t1", "t2"]);

    expect(await h.find("t1")).toEqual(["conv-a"]);
    expect(await h.find("t2")).toEqual(["conv-a"]);
  });

  it("keeps both partitions of an id filed twice, never one over the other", async () => {
    // Ids a caller picks are unique per partition only, so the lookup must
    // see both and let the caller refuse the ambiguity.
    const h = await boot(stores[name]!());
    await h.file("conv-a", ["t1"]);
    await h.file("conv-b", ["t1"]);

    expect(await h.find("t1")).toEqual(["conv-a", "conv-b"]);
  });

  it("answers nothing for an id no add filed, an id that only prefixes one, or an empty id", async () => {
    const h = await boot(stores[name]!());
    await h.file("conv-a", ["t10"]);

    expect(await h.find("t1")).toEqual([]);
    expect(await h.find("")).toEqual([]);
  });

  it("finds rows an older release wrote on the first lookup, and never reads its leftover __ids markers", async () => {
    // BP-030: rows written before the index existed carry no entries, and the
    // markers that release kept are still in the store. One of them names a
    // partition whose add failed after its marker: a lookup that still read
    // the markers would answer it.
    const h = await boot(stores[name]!());
    await seedLegacyRow(h.raw, "conv-old", "t1");
    await seedLegacyRow(h.raw, "conv-old", "t2");
    const markers = [
      await seedLegacyMarker(h.raw, "conv-old", "t1"),
      await seedLegacyMarker(h.raw, "conv-failed-add", "t1"),
    ];

    expect(await h.find("t1")).toEqual(["conv-old"]);
    // A row filed after the first lookup's build is found beside the legacy one.
    await h.file("conv-new", ["t1"]);
    expect(await h.find("t1")).toEqual(["conv-new", "conv-old"]);
    expect(await h.find("t2")).toEqual(["conv-old"]);
    // The leftover markers stay where they were: tolerated, unread, unwritten.
    const left = await h.raw.resourceState.getByPrefix("user", CELL, `${LEDGER}__ids/`);
    expect(Object.keys(left).sort()).toEqual([...markers].sort());
  });
});

describe("findTaskPartitions on a store that keeps index entries", () => {
  it("answers a lookup on a built index without a prefix or whole-scope read", async () => {
    // The control for the cases above: on the memory store the same answers
    // come from a scan. Here the second lookup must come from the index.
    const h = await boot(stores.sqlite!());
    await h.file("conv-a", ["t1"]);
    await h.file("conv-b", ["t1"]);
    expect(await h.find("t1")).toEqual(["conv-a", "conv-b"]);

    const counter = countScans(h.raw);
    expect(await h.find("t1")).toEqual(["conv-a", "conv-b"]);
    expect(counter.scans).toBe(0);
  });
});

describe("taskLedgerResources", () => {
  it("installs the ledger alone, partitioned or not", () => {
    // The ledger's id lookup is its own declared index now: nothing is
    // installed beside it.
    expect(Object.keys(taskLedgerResources(ledger))).toEqual([LEDGER]);
    expect(Object.keys(taskLedgerResources(defineTaskCollection({ id: "plain", scope: "user" })))).toEqual(["plain"]);
  });
});
