/**
 * A read across sessions filtered by a declared index, on SQLite, through a
 * real router: the filter is answered by the index in the store's query only
 * in a session whose index is built. So a session's first write builds its
 * declared indexes, and a session written before that (its index unbuilt) is
 * built once, by the first read across sessions that meets it, never on every
 * page.
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import { declaredIndexes, type FlowInstance } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter } from "@flow-state-dev/engine";
import { createSQLiteStores } from "../src/host";

const notes = defineResourceCollection({
  pattern: "notes/*",
  scope: "session",
  stateSchema: z.object({ text: z.string(), status: z.string().default("done") }),
  indexes: { byStatus: (_key: string, state: { status: string }) => state.status }
});
const STATUS = declaredIndexes(notes as unknown as { indexes: Record<string, unknown> })[0]!.stored;

const file = handler({
  name: "file",
  inputSchema: z.object({ key: z.string(), status: z.string() }),
  outputSchema: z.object({}),
  execute: async ({ key, status }, ctx) => {
    await (ctx.resources as any).notes.create(key, { text: key, status });
    return {};
  }
});
const open = handler({
  name: "open",
  inputSchema: z.object({}),
  outputSchema: z.object({ entries: z.array(z.string()) }),
  execute: async (_input, ctx) => {
    const seen: string[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await (ctx.resources as any).acrossSessions().notes.list({ where: { index: "byStatus", value: "open" }, ...(after ? { after } : {}) });
      for (const entry of page.entries) seen.push(`${entry.session} ${entry.key}`);
      if (page.next === undefined) return { entries: seen };
      after = page.next;
    }
  }
});
const desk = defineFlow({
  kind: "desk",
  actions: { file },
  resources: { notes },
  views: { open: defineView({ scope: "user", block: open }) }
})() as unknown as FlowInstance;

/** Every statement better-sqlite3 runs in this file, taken off its statements. */
const sent: string[] = [];
{
  const probe = new Database(":memory:");
  const proto = Object.getPrototypeOf(probe.prepare("SELECT 1")) as Record<string, (...args: unknown[]) => unknown>;
  probe.close();
  for (const method of ["all", "get", "run", "iterate"]) {
    const original = proto[method]!;
    proto[method] = function (this: { source: string }, ...args: unknown[]) {
      sent.push(this.source);
      return original.apply(this, args);
    };
  }
}

type Router = ReturnType<typeof createFlowApiRouter>;
const routers: Router[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function boot() {
  const registry = createFlowRegistry();
  registry.register(desk);
  const stores = createSQLiteStores({ filename: ":memory:" });
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    resolvePrincipal: (context) => ({ userId: "alice", orgId: context.request?.headers.get("x-org") ?? "acme" })
  });
  routers.push(router);
  const post = async (path: string[], body: unknown) => {
    const response = await router.POST(
      new Request(`http://test/api/flows/${path.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: { path } }
    );
    return { status: response.status, body: await response.text() };
  };
  const fileIn = async (sessionId: string, key: string, status: string) => {
    const res = await post(["desk", sessionId, "actions", "file"], { input: { key, status } });
    expect(res.status, res.body).toBe(202);
    const { request } = JSON.parse(res.body) as { request: { id: string } };
    for (let i = 0; i < 200 && (await stores.request.get(request.id))?.status !== "completed"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const view = async () => {
    const res = await post(["desk", "views", "open"], { input: {} });
    expect(res.status, res.body).toBe(200);
    return (JSON.parse(res.body) as { output: { entries: string[] } }).output.entries;
  };
  return { stores, fileIn, view };
}

const builds = () => sent.filter((sql) => /INSERT INTO resource_index_built/i.test(sql)).length;

describe("a read across sessions filtered by a declared index", () => {
  it("is answered by the index in a session written through the engine, whose first write built it", async () => {
    const env = boot();
    await env.fileIn("s1", "a", "open");
    await env.fileIn("s1", "b", "done");
    await env.fileIn("s2", "c", "done");
    expect(await env.stores.resourceState.indexes!.state("session", "s1", notes.pattern, STATUS)).toBe("built");
    expect(await env.stores.resourceState.indexes!.state("session", "s2", notes.pattern, STATUS)).toBe("built");
    sent.length = 0;
    expect(await env.view()).toEqual(["s1 notes/a"]);
    expect(builds()).toBe(0);
  });

  it("builds a session written before its index was kept, once, at the first read that meets it", async () => {
    const env = boot();
    await env.fileIn("old", "seed", "done");
    // As a session written before the writer built indexes holds it: its rows, no build marker.
    for (const [key, status] of [["a", "open"], ["b", "done"], ["c", "open"]] as const) {
      await env.stores.resourceState.set("session", "old", `notes/${key}`, { text: key, status }, "any", {
        indexEntries: [{ collection: notes.pattern, index: STATUS, values: [JSON.stringify(status)] }]
      });
    }
    // Leave its index unbuilt, as a session from before the writer built one is.
    await env.stores.resourceState.indexes!.beginBuild("session", "old", notes.pattern, STATUS);
    expect(await env.stores.resourceState.indexes!.state("session", "old", notes.pattern, STATUS)).not.toBe("built");

    sent.length = 0;
    expect(await env.view()).toEqual(["old notes/a", "old notes/c"]);
    expect(builds(), "the first read builds the unbuilt session").toBe(1);
    expect(await env.stores.resourceState.indexes!.state("session", "old", notes.pattern, STATUS)).toBe("built");

    sent.length = 0;
    expect(await env.view()).toEqual(["old notes/a", "old notes/c"]);
    expect(builds(), "a later read builds nothing").toBe(0);
  });
});
