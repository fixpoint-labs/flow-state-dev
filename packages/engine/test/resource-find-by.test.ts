/**
 * `findBy` on a resource collection, and the index writer every resource write
 * passes, through `createFlowState` on the in-memory store.
 *
 * The memory store keeps no index entries, so `findBy` here scans the
 * collection: what these cases pin is the answer every store must give (the
 * same rows, in key order, re-checked against each row, behind the same fence
 * as `list`), and that the runtime's stores hand every write its entries,
 * computed from every registered declaration, whoever writes. The SQL stores
 * run the same lookups against their index tables in their own packages.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler, ownerSegment } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, createInMemoryStores, inMemoryStores, runAction } from "../src";
import type { ResourceStateSetOptions, StoreRegistry } from "../src";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { createFindByConformanceTests } from "../src/testing";

const ORG = "acme";
const taskSchema = z.object({ id: z.string(), tags: z.array(z.string()).default([]) });

const work = defineResourceCollection({
  pattern: "work/**",
  scope: "org",
  stateSchema: taskSchema,
  indexes: {
    byTaskId: (_key, state) => state.id,
    byTag: { version: 2, value: (_key, state) => state.tags },
  },
});

const lookupInput = z.object({
  index: z.string(),
  value: z.union([z.string(), z.number()]),
  /** Writes to make before the lookup, inside the same request. */
  before: z
    .array(z.object({ key: z.string(), id: z.string().optional(), delete: z.boolean().optional() }))
    .default([]),
});

const lookup = handler({
  name: "lookup",
  inputSchema: lookupInput,
  outputSchema: z.object({ keys: z.array(z.string()), ids: z.array(z.string()) }),
  resources: { work },
  execute: async (input, ctx) => {
    const ref = ctx.resources.work as unknown as ResourceCollectionRef<{ id: string }>;
    for (const write of input.before) {
      if (write.delete === true) await ref.delete(write.key);
      else await ref.upsert(write.key, { id: write.id! });
    }
    const rows = await ref.findBy(input.index, input.value);
    return { keys: rows.map((row) => row.path), ids: rows.map((row) => row.state.id) };
  },
});

const ledgerFlow = defineFlow({
  kind: "ledger",
  actions: { lookup: { inputSchema: lookupInput, block: lookup } },
});

async function boot(flows: Record<string, unknown> = { ledger: ledgerFlow() }) {
  const adapter = inMemoryStores();
  const raw = await adapter.resolve(["primary"]);
  const state = createFlowState({
    flows: flows as never,
    stores: { default: { primary: adapter } },
    modelResolver: createMockModelResolver({}),
  });
  const runtime = await state.getRuntime();
  const run = async (input: z.input<typeof lookupInput>, userId = "alice") => {
    const result = await runAction({
      flow: ledgerFlow(),
      actionName: "lookup",
      input,
      userId,
      orgId: ORG,
      stores: runtime.stores,
      runtimeConfig: { modelResolver: createMockModelResolver({}) },
    });
    if (result.error !== undefined) throw result.error;
    return result.output as { keys: string[]; ids: string[] };
  };
  return { raw: raw as StoreRegistry, runtime, run };
}

describe("findBy", () => {
  it("returns every row with the value, across partitions, in key order, rows written store-direct included", async () => {
    const h = await boot();
    // Written before any lookup and around the engine, as a seed or an older
    // release would leave them.
    await h.raw.resourceState.set("org", ORG, "work/c2/t1", { id: "t1", tags: [] }, "any");
    await h.raw.resourceState.set("org", ORG, "work/c1/t1", { id: "t1", tags: ["red"] }, "any");
    await h.raw.resourceState.set("org", ORG, "work/c1/t2", { id: "t2", tags: ["red"] }, "any");

    expect(await h.run({ index: "byTaskId", value: "t1" })).toEqual({
      keys: ["work/c1/t1", "work/c2/t1"],
      ids: ["t1", "t1"],
    });
    expect((await h.run({ index: "byTag", value: "red" })).keys).toEqual(["work/c1/t1", "work/c1/t2"]);
    expect((await h.run({ index: "byTaskId", value: "nope" })).keys).toEqual([]);
  });

  it("checks every hit against its row: this request's own writes and deletes count", async () => {
    const h = await boot();
    await h.raw.resourceState.set("org", ORG, "work/c1/a", { id: "t1", tags: [] }, "any");
    await h.raw.resourceState.set("org", ORG, "work/c1/b", { id: "t1", tags: [] }, "any");

    const seen = await h.run({
      index: "byTaskId",
      value: "t1",
      before: [
        { key: "c1/a", id: "moved" },
        { key: "c1/b", delete: true },
        { key: "c3/new", id: "t1" },
      ],
    });
    expect(seen.keys).toEqual(["work/c3/new"]);
  });

  it("keeps types apart: the number 1 does not find the string '1'", async () => {
    const h = await boot();
    await h.raw.resourceState.set("org", ORG, "work/c1/a", { id: "1", tags: [] }, "any");
    expect((await h.run({ index: "byTaskId", value: 1 })).keys).toEqual([]);
    expect((await h.run({ index: "byTaskId", value: "1" })).keys).toEqual(["work/c1/a"]);
  });

  it("refuses an index the collection does not declare", async () => {
    const h = await boot();
    await expect(h.run({ index: "byNothing", value: "x" })).rejects.toThrow(/byNothing/);
  });

  it("passes the same owner fence as list: another user's owner-private rows are never returned", async () => {
    const notes = defineResourceCollection({
      pattern: "notes/[owner]/[id]",
      scope: "org",
      ownerPrivate: { param: "owner" },
      flowIsolation: false,
      stateSchema: z.object({ topic: z.string() }),
      indexes: { byTopic: (_key, state) => state.topic },
    });
    const find = handler({
      name: "find",
      inputSchema: z.object({}),
      outputSchema: z.array(z.string()),
      resources: { notes },
      execute: async (_input, ctx) =>
        (await (ctx.resources.notes as unknown as ResourceCollectionRef).findBy("byTopic", "x")).map((r) => r.path),
    });
    const notesFlow = defineFlow({ kind: "notes", actions: { find: { inputSchema: z.object({}), block: find } } });
    const h = await boot({ notes: notesFlow() });
    await h.raw.resourceState.set("org", ORG, `notes/${ownerSegment("alice")}/a`, { topic: "x" }, "any");
    await h.raw.resourceState.set("org", ORG, `notes/${ownerSegment("bob")}/b`, { topic: "x" }, "any");
    const as = async (userId: string) =>
      (
        await runAction({
          flow: notesFlow(),
          actionName: "find",
          input: {},
          userId,
          orgId: ORG,
          stores: h.runtime.stores,
          runtimeConfig: { modelResolver: createMockModelResolver({}) },
        })
      ).output;
    expect(await as("alice")).toEqual([`notes/${ownerSegment("alice")}/a`]);
    expect(await as("bob")).toEqual([`notes/${ownerSegment("bob")}/b`]);
  });
});

describe("the index writer on the runtime's stores", () => {
  /** Record the options every `set` reaches the underlying store with. */
  function recordSets(raw: StoreRegistry): Array<{ key: string; options?: ResourceStateSetOptions }> {
    const seen: Array<{ key: string; options?: ResourceStateSetOptions }> = [];
    const real = raw.resourceState.set.bind(raw.resourceState);
    raw.resourceState.set = async (scopeType, scopeId, key, state, expected, options) => {
      seen.push({ key, options });
      return real(scopeType, scopeId, key, state, expected, options);
    };
    return seen;
  }

  it("hands a direct store write the entries of every declared index whose pattern matches its key", async () => {
    const h = await boot();
    const seen = recordSets(h.raw);
    await h.runtime.stores.resourceState.set("org", ORG, "work/c1/t9", { id: "t9", tags: ["a", "b"] }, "any");
    await h.runtime.stores.resourceState.set("org", ORG, "elsewhere/x", { id: "t9" }, "any");
    // Another scope: an org-scoped declaration does not cover a user cell.
    await h.runtime.stores.resourceState.set("user", "alice", "work/c1/t9", { id: "t9" }, "any");

    expect(seen).toEqual([
      {
        key: "work/c1/t9",
        options: {
          indexEntries: [
            { collection: "work/**", index: "byTaskId@1", values: ['"t9"'] },
            { collection: "work/**", index: "byTag@2", values: ['"a"', '"b"'] },
          ],
        },
      },
      { key: "elsewhere/x", options: { indexEntries: [] } },
      { key: "work/c1/t9", options: { indexEntries: [] } },
    ]);
  });

  it("computes entries from another flow's declaration when the writing flow declares the pattern without indexes", async () => {
    const plainWork = defineResourceCollection({ pattern: "work/**", scope: "org", stateSchema: taskSchema });
    const writer = handler({
      name: "write",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      resources: { work: plainWork },
      execute: async (_input, ctx) => {
        await (ctx.resources.work as unknown as ResourceCollectionRef).create("c9/x", { id: "t-other" });
        return {};
      },
    });
    const writerFlow = defineFlow({ kind: "writer", actions: { write: { inputSchema: z.object({}), block: writer } } });
    const h = await boot({ ledger: ledgerFlow(), writer: writerFlow() });
    const seen = recordSets(h.raw);
    await runAction({
      flow: writerFlow(),
      actionName: "write",
      input: {},
      userId: "alice",
      orgId: ORG,
      stores: h.runtime.stores,
      runtimeConfig: { modelResolver: createMockModelResolver({}) },
    });
    const written = seen.find((entry) => entry.key === "work/c9/x");
    expect(written?.options?.indexEntries).toContainEqual({
      collection: "work/**",
      index: "byTaskId@1",
      values: ['"t-other"'],
    });
  });
});

describe("the index writer and flow-isolated collections", () => {
  it("applies only the writing cell's own declarations: another flow's isolated index never sees this flow's rows", async () => {
    // Two flows declare `docs/*` isolated to themselves, with different
    // schemas. A's index reads `tags`, which B's rows do not have.
    const tagged = defineResourceCollection({
      pattern: "docs/*",
      scope: "org",
      flowIsolation: true,
      stateSchema: z.object({ tags: z.array(z.string()) }),
      indexes: { byTag: (_key, state) => state.tags.map((tag: string) => tag.toLowerCase()) },
    });
    const titled = defineResourceCollection({
      pattern: "docs/*",
      scope: "org",
      flowIsolation: true,
      stateSchema: z.object({ title: z.string() }),
    });
    const flowOf = (kind: string, docs: typeof tagged | typeof titled, state: { tags: string[] } | { title: string }) =>
      defineFlow({
        kind,
        actions: {
          write: {
            inputSchema: z.object({}),
            block: handler({
              name: `write-${kind}`,
              inputSchema: z.object({}),
              outputSchema: z.object({}),
              resources: { docs },
              execute: async (_input, ctx) => {
                await (ctx.resources.docs as unknown as ResourceCollectionRef).upsert("a", state);
                return {};
              },
            }),
          },
        },
      })();
    const a = flowOf("tagged", tagged, { tags: ["Red"] });
    const b = flowOf("titled", titled, { title: "hello" });
    const h = await boot({ tagged: a, titled: b });
    const seen: Array<{ scopeId: string; options?: ResourceStateSetOptions }> = [];
    const real = h.raw.resourceState.set.bind(h.raw.resourceState);
    h.raw.resourceState.set = async (scopeType, scopeId, key, state, expected, options) => {
      if (key === "docs/a") seen.push({ scopeId, options });
      return real(scopeType, scopeId, key, state, expected, options);
    };
    const write = async (flow: typeof a) => {
      const result = await runAction({
        flow,
        actionName: "write",
        input: {},
        userId: "alice",
        orgId: ORG,
        stores: h.runtime.stores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      });
      if (result.error !== undefined) throw result.error;
    };
    await write(b);
    await write(a);
    expect(seen).toEqual([
      { scopeId: `${ORG}:titled`, options: { indexEntries: [] } },
      {
        scopeId: `${ORG}:tagged`,
        options: { indexEntries: [{ collection: "docs/*", index: "byTag@1", values: ['"red"'] }] },
      },
    ]);
  });
});

describe("the index writer and session cells", () => {
  it("takes a session cell's owner from its record when a write names none", async () => {
    // Two flows declare session `docs/*`; only A indexes it, reading `tags`.
    // Host code writing into B's session through the runtime's stores names no
    // flow, so the writer reads B's session record and runs none of A's index.
    const tagged = defineResourceCollection({
      pattern: "docs/*",
      scope: "session",
      stateSchema: z.object({ tags: z.array(z.string()) }),
      indexes: { byTag: (_key, state) => state.tags.map((tag: string) => tag.toLowerCase()) },
    });
    const titled = defineResourceCollection({ pattern: "docs/*", scope: "session", stateSchema: z.object({ title: z.string() }) });
    const flowOf = (kind: string, docs: typeof tagged | typeof titled) =>
      defineFlow({
        kind,
        actions: {
          noop: {
            inputSchema: z.object({}),
            block: handler({ name: `noop-${kind}`, resources: { docs }, execute: () => ({}) }),
          },
        },
      })();
    const b = flowOf("titled", titled);
    const h = await boot({ tagged: flowOf("tagged", tagged), titled: b });
    const opened = await runAction({
      flow: b,
      actionName: "noop",
      input: {},
      userId: "alice",
      orgId: ORG,
      sessionId: "s-titled",
      stores: h.runtime.stores,
      runtimeConfig: { modelResolver: createMockModelResolver({}) },
    });
    if (opened.error !== undefined) throw opened.error;
    const seen: Array<ResourceStateSetOptions | undefined> = [];
    const real = h.raw.resourceState.set.bind(h.raw.resourceState);
    h.raw.resourceState.set = async (scopeType, scopeId, key, state, expected, options) => {
      seen.push(options);
      return real(scopeType, scopeId, key, state, expected, options);
    };
    await h.runtime.stores.resourceState.set("session", "s-titled", "docs/b", { title: "x" }, "any");
    expect(seen).toEqual([{ indexEntries: [] }]);
  });
});

describe("startup check on index declarations", () => {
  const declare = (pattern: string, scope: "org" | "user", version: number, kind: string) => {
    const collection = defineResourceCollection({
      pattern,
      scope,
      stateSchema: taskSchema,
      indexes: { byTaskId: { version, value: (_key, state) => state.id } },
    });
    return defineFlow({
      kind,
      actions: {
        noop: {
          inputSchema: z.object({}),
          block: handler({ name: `noop-${kind}`, resources: { collection }, execute: () => ({}) }),
        },
      },
    })();
  };
  const start = (flows: Record<string, unknown>) =>
    createFlowState({
      flows: flows as never,
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });

  it("refuses one index name at two versions on overlapping patterns in one scope", () => {
    expect(() => start({ a: declare("work/**", "org", 1, "a"), b: declare("work/[c]/[t]", "org", 2, "b") })).toThrow(
      /byTaskId.*version/
    );
  });

  it("admits the same name at two versions in different scopes, or on patterns that cannot meet", () => {
    expect(() => start({ a: declare("work/**", "org", 1, "a"), b: declare("work/**", "user", 2, "b") })).not.toThrow();
    expect(() => start({ a: declare("work/**", "org", 1, "a"), b: declare("other/**", "org", 2, "b") })).not.toThrow();
  });

  it("admits the same declaration on two flows", () => {
    expect(() => start({ a: declare("work/**", "org", 1, "a"), b: declare("work/**", "org", 1, "b") })).not.toThrow();
  });
});

// The cross-store suite, on the in-memory store: no index verbs, so a scan.
createFindByConformanceTests({
  name: "in-memory stores",
  indexes: false,
  createStores: () => createInMemoryStores(),
});
