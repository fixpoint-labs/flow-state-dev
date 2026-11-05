/**
 * Shared conformance suite for `findBy` on a resource collection, run through
 * `createFlowState` over a real store registry.
 *
 * Every adapter must give the same answer: the rows with the value, in key
 * order, across partitions, including rows written before any lookup and rows
 * written around the engine. A store that keeps index entries
 * (`ResourceStateStore.indexes`, so `indexes: true` here) must also answer a
 * lookup on a built index without a prefix or whole-scope read of resource
 * state, and must still find a row a writer that does not declare the index
 * wrote after the build. A store without index verbs is served by a scan, and
 * those read-count cases do not apply to it.
 *
 * The cases read which rows come back and which store reads ran, never the
 * index table, so a store that kept entries but still scanned would fail.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler, ownerSegment } from "@flow-state-dev/core";
import type { FlowInstance, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState } from "../../flowstate/createFlowState";
import { runAction } from "../../execution/runAction";
import type { StoreRegistry } from "../types";

/** Options for {@link createFindByConformanceTests}. */
export type CreateFindByConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block. */
  name: string;
  /** Build a fresh, empty store registry. Called once per case. */
  createStores: () => StoreRegistry | Promise<StoreRegistry>;
  /** Optional teardown for adapters with external resources. */
  cleanup?: (stores: StoreRegistry) => Promise<void> | void;
  /** `true` when the resource-state store implements the index verbs. */
  indexes: boolean;
};

const ORG = "acme";
const rowSchema = z.object({ id: z.string(), owner: z.string().default("") });
const fileInput = z.object({ rows: z.array(z.object({ key: z.string(), id: z.string() })) });
const findInput = z.object({ value: z.string() });

/**
 * The collection under test, at `version` with index function `value`. Lazy,
 * as a ledger kept per partition is, so a request reads none of its rows
 * until something asks: the read counts below are `findBy`'s own.
 */
function ledger(version: number, value: (key: string, state: { id: string }) => string) {
  return defineResourceCollection({
    pattern: "work/**",
    scope: "org",
    flowIsolation: false,
    prefetchMode: "lazy",
    stateSchema: rowSchema,
    indexes: { byTaskId: { version, value: (key, state) => value(key, state as { id: string }) } },
  });
}

function ledgerFlow(work: ReturnType<typeof ledger>) {
  const file = handler({
    name: "file",
    inputSchema: fileInput,
    outputSchema: z.object({}),
    resources: { work },
    execute: async (input, ctx) => {
      const ref = ctx.resources.work as unknown as ResourceCollectionRef;
      for (const row of input.rows) await ref.upsert(row.key, { id: row.id });
      return {};
    },
  });
  const find = handler({
    name: "find",
    inputSchema: findInput,
    outputSchema: z.array(z.string()),
    resources: { work },
    execute: async (input, ctx) =>
      (await (ctx.resources.work as unknown as ResourceCollectionRef).findBy("byTaskId", input.value)).map(
        (row) => row.path
      ),
  });
  return defineFlow({
    kind: "find-by-ledger",
    actions: { file: { inputSchema: fileInput, block: file }, find: { inputSchema: findInput, block: find } },
  })();
}

/** Count the prefix and whole-scope reads of resource state that reach the store. */
function countScans(stores: StoreRegistry): { scans: number } {
  const counter = { scans: 0 };
  const store = stores.resourceState;
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

/** Boot an app over `raw` and return its actions. */
async function boot(raw: StoreRegistry, flow: FlowInstance) {
  const state = createFlowState({
    flows: { ledger: flow } as never,
    stores: { default: { primary: { capabilities: ["primary"], resolve: () => Promise.resolve(raw) } } },
  });
  const runtime = await state.getRuntime();
  const act = async (actionName: "file" | "find", input: unknown, userId = "alice") => {
    const result = await runAction({
      flow,
      actionName,
      input,
      userId,
      orgId: ORG,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never);
    if (result.error !== undefined) throw result.error;
    return result.output;
  };
  return {
    runtime,
    file: (rows: Array<{ key: string; id: string }>) => act("file", { rows }),
    find: async (value: string) => (await act("find", { value })) as string[],
  };
}

/** Register the `findBy` conformance cases against a store registry. */
export function createFindByConformanceTests(options: CreateFindByConformanceTestsOptions): void {
  const { name, createStores, cleanup, indexes } = options;
  const withStores = async (body: (raw: StoreRegistry) => Promise<void>): Promise<void> => {
    const raw = await createStores();
    try {
      await body(raw);
    } finally {
      await cleanup?.(raw);
    }
  };
  const byId = ledger(1, (_key, state) => state.id);

  describe(`${name} (findBy conformance)`, () => {
    it("finds rows written before the first lookup, a duplicate id in two partitions included", async () => {
      await withStores(async (raw) => {
        // Around the engine, as a seed or an older release would leave them.
        await raw.resourceState.set("org", ORG, "work/p1/a", { id: "t1" }, "any");
        await raw.resourceState.set("org", ORG, "work/p2/a", { id: "t1" }, "any");
        await raw.resourceState.set("org", ORG, "work/p2/b", { id: "t2" }, "any");
        const app = await boot(raw, ledgerFlow(byId));
        expect(await app.find("t1")).toEqual(["work/p1/a", "work/p2/a"]);
        expect(await app.find("t2")).toEqual(["work/p2/b"]);
        expect(await app.find("missing")).toEqual([]);
      });
    });

    it("finds rows filed after the first lookup, and a changed value stops finding its row", async () => {
      await withStores(async (raw) => {
        const app = await boot(raw, ledgerFlow(byId));
        expect(await app.find("t1")).toEqual([]);
        await app.file([
          { key: "p1/x", id: "t1" },
          { key: "p3/y", id: "t1" },
          { key: "p3/z", id: "t2" },
        ]);
        expect(await app.find("t1")).toEqual(["work/p1/x", "work/p3/y"]);
        await app.file([{ key: "p1/x", id: "moved" }]);
        expect(await app.find("t1")).toEqual(["work/p3/y"]);
        expect(await app.find("moved")).toEqual(["work/p1/x"]);
      });
    });

    it("follows a writer that does not declare the index: its new rows are found, its changed rows are not", async () => {
      await withStores(async (raw) => {
        const app = await boot(raw, ledgerFlow(byId));
        expect(await app.find("t1")).toEqual([]);
        await app.file([{ key: "p1/x", id: "t1" }]);
        // The raw store is a process that registered no indexed flow: one row
        // it adds, one whose value it changes, leaving that row's old entry.
        await raw.resourceState.set("org", ORG, "work/p9/late", { id: "t1" }, "any");
        await raw.resourceState.set("org", ORG, "work/p1/x", { id: "moved" }, "any");
        expect(await app.find("t1")).toEqual(["work/p9/late"]);
        expect(await app.find("moved")).toEqual(["work/p1/x"]);
      });
    });

    it("rebuilds when the index's version changes, and answers by the new function", async () => {
      await withStores(async (raw) => {
        const v1 = await boot(raw, ledgerFlow(byId));
        await v1.file([{ key: "p1/x", id: "t1" }]);
        expect(await v1.find("t1")).toEqual(["work/p1/x"]);
        const v2 = await boot(raw, ledgerFlow(ledger(2, (key) => key.split("/")[1]!)));
        expect(await v2.find("p1")).toEqual(["work/p1/x"]);
        expect(await v2.find("t1")).toEqual([]);
      });
    });

    it("never returns another user's owner-private row", async () => {
      await withStores(async (raw) => {
        const notes = defineResourceCollection({
          pattern: "notes/[owner]/[id]",
          scope: "org",
          flowIsolation: false,
          ownerPrivate: { param: "owner" },
          // Lazy, so a hit is loaded by key: the path that must ask the fence first.
          prefetchMode: "lazy",
          stateSchema: z.object({ topic: z.string() }),
          indexes: { byTopic: (_key, state) => (state as { topic: string }).topic },
        });
        const find = handler({
          name: "find-notes",
          inputSchema: z.object({}),
          outputSchema: z.array(z.string()),
          resources: { notes },
          execute: async (_input, ctx) =>
            (await (ctx.resources.notes as unknown as ResourceCollectionRef).findBy("byTopic", "x")).map(
              (row) => row.path
            ),
        });
        const flow = defineFlow({ kind: "find-by-notes", actions: { find: { inputSchema: z.object({}), block: find } } })();
        const state = createFlowState({
          flows: { notes: flow } as never,
          stores: { default: { primary: { capabilities: ["primary"], resolve: () => Promise.resolve(raw) } } },
        });
        const runtime = await state.getRuntime();
        await runtime.stores.resourceState.set("org", ORG, `notes/${ownerSegment("alice")}/a`, { topic: "x" }, "any");
        await runtime.stores.resourceState.set("org", ORG, `notes/${ownerSegment("bob")}/b`, { topic: "x" }, "any");
        const as = async (userId: string) =>
          (await runAction({
              flow,
              actionName: "find",
              input: {},
              userId,
              orgId: ORG,
              stores: runtime.stores,
              runtimeConfig: runtime.runtimeConfig,
            } as never))
            .output;
        expect(await as("alice")).toEqual([`notes/${ownerSegment("alice")}/a`]);
        expect(await as("bob")).toEqual([`notes/${ownerSegment("bob")}/b`]);
      });
    });

    it("finds a row a narrower collection keeps in another cell, as list() shows it", async () => {
      await withStores(async (raw) => {
        // The broad collection is shared; the narrower one under it is
        // isolated to this flow, so its rows live in a different cell.
        const docs = defineResourceCollection({
          pattern: "docs/**",
          scope: "org",
          flowIsolation: false,
          stateSchema: rowSchema,
          indexes: { byTaskId: (_key, state) => state.id },
        });
        const drafts = defineResourceCollection({
          pattern: "docs/drafts/*",
          scope: "org",
          flowIsolation: true,
          stateSchema: rowSchema,
        });
        const file = handler({
          name: "file",
          inputSchema: fileInput,
          outputSchema: z.object({}),
          resources: { docs, drafts },
          execute: async (input, ctx) => {
            for (const row of input.rows) {
              const draft = row.key.startsWith("drafts/");
              const ref = (draft ? ctx.resources.drafts : ctx.resources.docs) as unknown as ResourceCollectionRef;
              await ref.upsert(draft ? row.key.slice("drafts/".length) : row.key, { id: row.id });
            }
            return {};
          },
        });
        const find = handler({
          name: "find",
          inputSchema: findInput,
          outputSchema: z.array(z.string()),
          resources: { docs, drafts },
          execute: async (input, ctx) => {
            const ref = ctx.resources.docs as unknown as ResourceCollectionRef;
            const listed = (await ref.list()).map((row) => row.path).filter((path) => path.endsWith("/x"));
            const found = (await ref.findBy("byTaskId", input.value)).map((row) => row.path);
            // findBy answers from the rows list() reads.
            expect(found.filter((path) => path.endsWith("/x"))).toEqual(listed);
            return found;
          },
        });
        const flow = defineFlow({
          kind: "find-by-cells",
          actions: { file: { inputSchema: fileInput, block: file }, find: { inputSchema: findInput, block: find } },
        })();
        const app = await boot(raw, flow);
        await app.file([
          { key: "drafts/x", id: "t1" },
          { key: "public/x", id: "t1" },
        ]);
        expect(await app.find("t1")).toEqual(["docs/drafts/x", "docs/public/x"]);
      });
    });

    if (indexes) {
      it("answers a lookup on a built index without a prefix or whole-scope read of resource state", async () => {
        await withStores(async (raw) => {
          await raw.resourceState.set("org", ORG, "work/p1/a", { id: "t1" }, "any");
          const app = await boot(raw, ledgerFlow(byId));
          expect(await app.find("t1")).toEqual(["work/p1/a"]);
          await app.file([{ key: "p2/b", id: "t1" }]);
          const counter = countScans(raw);
          expect(await app.find("t1")).toEqual(["work/p1/a", "work/p2/b"]);
          expect(await app.find("t1")).toEqual(["work/p1/a", "work/p2/b"]);
          expect(counter.scans).toBe(0);
        });
      });

      it("never returns a stale entry: a row that changed while the index was being built", async () => {
        await withStores(async (raw) => {
          await raw.resourceState.set("org", ORG, "work/p1/x", { id: "t1" }, "any");
          const app = await boot(raw, ledgerFlow(byId));
          // A declared write lands between the build's scan and its
          // completion, so the build adds the value the scan saw, which the
          // row no longer has. Entries are a superset by design.
          const store = raw.resourceState;
          const getByPrefix = store.getByPrefix.bind(store);
          store.getByPrefix = async (...args) => {
            const rows = await getByPrefix(...args);
            store.getByPrefix = getByPrefix;
            await app.runtime.stores.resourceState.set("org", ORG, "work/p1/x", { id: "moved" }, "any");
            return rows;
          };
          expect(await app.find("t1")).toEqual([]);
          expect(await app.find("t1")).toEqual([]);
          expect(await app.find("moved")).toEqual(["work/p1/x"]);
        });
      });

      it("a write that does not carry the index's entries costs one rebuild, then lookups read the index again", async () => {
        await withStores(async (raw) => {
          const app = await boot(raw, ledgerFlow(byId));
          expect(await app.find("t1")).toEqual([]);
          await raw.resourceState.set("org", ORG, "work/p9/late", { id: "t1" }, "any");
          const counter = countScans(raw);
          expect(await app.find("t1")).toEqual(["work/p9/late"]);
          expect(counter.scans).toBe(1);
          expect(await app.find("t1")).toEqual(["work/p9/late"]);
          expect(counter.scans).toBe(1);
        });
      });
    }
  });
}
