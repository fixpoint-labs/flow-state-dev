/**
 * FIX-1484 · Path-matching characterization — what the legacy matchers do today.
 *
 * `resource-tools.ts` routes a path to a collection through `tryMatchPath`,
 * called from four sites (`resolvePathToCollection` for the four CRUD tools,
 * `resolveResourceByPath`, and the store-backed and projected loops of
 * `resolveResourceByUri`). The refactor must not change what any path resolves
 * to. The existing unit tests stub the collection refs and re-implement the
 * prefix rule inside the stub, so they cannot see a change in the real
 * `get`/`create`/`getOptional` behaviour. This file runs every entry point
 * against the REAL engine resource registry and pins the outcome of each probe
 * path — success, `undefined`, or the exact error — as one golden table.
 *
 * Run it before and after the refactor. The table must be byte-identical.
 *
 * The rows marked (edge) are the ones a "just use matchesPattern" rewrite would
 * silently change: a nested path claimed by a single-wildcard collection, a
 * parameterized path, and an empty key.
 *
 * Retained design evidence, not a product test: it lives outside every
 * package's vitest root, so `pnpm test` never discovers it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineProjectedResourceCollection,
  defineResource,
  defineResourceCollection,
  handler,
  resolveResourceByPath,
  resolveResourceByUri,
  resourceTools,
} from "../../../../../packages/core/src/index";
import { asRuntime } from "../../../../../packages/core/src/types/block";
import { createExecutionContext, createInMemoryStores } from "../../../../../packages/engine/src/index";

const s = z.object({ v: z.string().default("") });

async function makeCtx() {
  const resources = {
    profile: defineResource({ scope: "session", stateSchema: s }),
    files: defineResourceCollection({ scope: "session", pattern: "files/*", stateSchema: s }),
    docs: defineResourceCollection({ scope: "session", pattern: "docs/**", stateSchema: s }),
    // Registration order matters: the legacy loop is first-claim-wins.
    nestShallow: defineResourceCollection({ scope: "session", pattern: "nest/*", stateSchema: s }),
    nestDeep: defineResourceCollection({ scope: "session", pattern: "nest/**", stateSchema: s }),
    obs: defineResourceCollection({ scope: "session", pattern: "[topic]/observations", stateSchema: s }),
    positions: defineProjectedResourceCollection({
      pattern: "positions/*",
      scope: "session",
      stateSchema: s,
      read: async ({ key }: { key: string }) => (key === "AAPL" ? { v: "aapl" } : null),
      search: (async () => ({ hits: [] })) as never,
    }),
  };
  const block = handler({ name: "noop", resources, execute: () => "ok" });
  const flow = defineFlow({ kind: "fix-1484-char", actions: { run: { inputSchema: z.string(), block } } })();
  const ctx: any = await createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores: createInMemoryStores(),
  });
  // Seed through the collections' own API, never through the matcher under test.
  await ctx.resources.files.create("seed.md", { v: "f" });
  await ctx.resources.docs.create("a/b.md", { v: "d" });
  await ctx.resources.nestDeep.create("x/y", { v: "n" });
  await ctx.resources.obs.create({ topic: "react" }, { v: "o" });
  return ctx;
}

async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    const r: any = await fn();
    if (r === undefined) return "undefined";
    if (r && typeof r === "object" && "uri" in r) return `ref ${r.uri}`;
    return `ok ${JSON.stringify(r)}`;
  } catch (err) {
    return `throw ${err instanceof Error ? err.message : String(err)}`;
  }
}

const tools = resourceTools() as Record<string, any>;
// Drive the tool through the block runtime, as a model tool call would.
const exec = (name: string, input: unknown, ctx: any) => asRuntime(tools[name]!).run(input, ctx);

describe("FIX-1484 legacy path matching — golden table", () => {
  it("every entry point, every probe path", async () => {
    const rows: string[] = [];
    const row = async (label: string, fn: (ctx: any) => Promise<unknown>) => {
      const ctx = await makeCtx();
      rows.push(`${label} => ${await outcome(() => fn(ctx))}`);
    };

    // resolvePathToCollection, via the four CRUD tools
    await row("create files/new.md", (c) => exec("createResource", { path: "files/new.md" }, c));
    await row("create files/a/b.md (edge)", (c) => exec("createResource", { path: "files/a/b.md" }, c));
    await row("create files/ (edge)", (c) => exec("createResource", { path: "files/" }, c));
    await row("create docs/p/q.md", (c) => exec("createResource", { path: "docs/p/q.md" }, c));
    await row("create nest/p/q (edge)", (c) => exec("createResource", { path: "nest/p/q" }, c));
    await row("create vue/observations (edge)", (c) => exec("createResource", { path: "vue/observations" }, c));
    await row("create nowhere/x", (c) => exec("createResource", { path: "nowhere/x" }, c));
    await row("create positions/MSFT", (c) => exec("createResource", { path: "positions/MSFT" }, c));
    await row("read files/seed.md", (c) => exec("readResource", { path: "files/seed.md" }, c));
    await row("read files/missing.md", (c) => exec("readResource", { path: "files/missing.md" }, c));
    await row("read docs/a/b.md", (c) => exec("readResource", { path: "docs/a/b.md" }, c));
    await row("read nest/x/y (edge)", (c) => exec("readResource", { path: "nest/x/y" }, c));
    await row("read react/observations (edge)", (c) => exec("readResource", { path: "react/observations" }, c));
    await row("update files/seed.md", (c) => exec("updateResource", { path: "files/seed.md", state: { v: "u" } }, c));
    await row("delete files/seed.md", (c) => exec("deleteResource", { path: "files/seed.md" }, c));

    // resolveResourceByPath
    await row("byPath profile", (c) => resolveResourceByPath("profile", c));
    await row("byPath files/seed.md", (c) => resolveResourceByPath("files/seed.md", c));
    await row("byPath files/missing.md", (c) => resolveResourceByPath("files/missing.md", c));
    await row("byPath docs/a/b.md", (c) => resolveResourceByPath("docs/a/b.md", c));
    await row("byPath nest/x/y (edge)", (c) => resolveResourceByPath("nest/x/y", c));
    await row("byPath react/observations (edge)", (c) => resolveResourceByPath("react/observations", c));
    await row("byPath positions/AAPL", (c) => resolveResourceByPath("positions/AAPL", c));
    await row("byPath nowhere", (c) => resolveResourceByPath("nowhere", c));

    // resolveResourceByUri (store-backed loop, then projected loop)
    await row("byUri session/profile", (c) => resolveResourceByUri("session/profile", c));
    await row("byUri session/files/seed.md", (c) => resolveResourceByUri("session/files/seed.md", c));
    await row("byUri session/files/missing.md", (c) => resolveResourceByUri("session/files/missing.md", c));
    await row("byUri session/docs/a/b.md", (c) => resolveResourceByUri("session/docs/a/b.md", c));
    await row("byUri session/nest/x/y (edge)", (c) => resolveResourceByUri("session/nest/x/y", c));
    await row("byUri session/react/observations (edge)", (c) => resolveResourceByUri("session/react/observations", c));
    await row("byUri user/files/seed.md", (c) => resolveResourceByUri("user/files/seed.md", c));
    await row("byUri session/positions/AAPL", (c) => resolveResourceByUri("session/positions/AAPL", c));
    await row("byUri session/positions/ZZZ", (c) => resolveResourceByUri("session/positions/ZZZ", c));
    await row("byUri session/positions/AAPL/h (edge)", (c) => resolveResourceByUri("session/positions/AAPL/h", c));
    await row("byUri noslash", (c) => resolveResourceByUri("noslash", c));

    // Print so a reviewer sees the table without reading the snapshot.
    console.log(rows.join("\n"));
    expect(rows.join("\n")).toMatchInlineSnapshot(`
      "create files/new.md => ok {"path":"files/new.md","ok":true}
      create files/a/b.md (edge) => throw Key "files/a/b.md" does not match collection pattern "files/*"
      create files/ (edge) => throw Resource key must be a non-empty string
      create docs/p/q.md => ok {"path":"docs/p/q.md","ok":true}
      create nest/p/q (edge) => throw Key "nest/p/q" does not match collection pattern "nest/*"
      create vue/observations (edge) => throw Pattern "[topic]/observations" requires an object key with parameters, not a string
      create nowhere/x => throw No resource collection found matching path: nowhere/x
      create positions/MSFT => throw No resource collection found matching path: positions/MSFT
      read files/seed.md => ok {"path":"files/seed.md","state":{"v":"f"}}
      read files/missing.md => throw Resource instance "files/missing.md" not found in collection "files/*"
      read docs/a/b.md => ok {"path":"docs/a/b.md","state":{"v":"d"}}
      read nest/x/y (edge) => throw Key "nest/x/y" does not match collection pattern "nest/*"
      read react/observations (edge) => throw Pattern "[topic]/observations" requires an object key with parameters, not a string
      update files/seed.md => ok {"path":"files/seed.md","ok":true}
      delete files/seed.md => ok {"path":"files/seed.md","ok":true}
      byPath profile => ref session/profile
      byPath files/seed.md => ref session/files/seed.md
      byPath files/missing.md => undefined
      byPath docs/a/b.md => ref session/docs/a/b.md
      byPath nest/x/y (edge) => throw Key "nest/x/y" does not match collection pattern "nest/*"
      byPath react/observations (edge) => throw Pattern "[topic]/observations" requires an object key with parameters, not a string
      byPath positions/AAPL => undefined
      byPath nowhere => undefined
      byUri session/profile => ref session/profile
      byUri session/files/seed.md => ref session/files/seed.md
      byUri session/files/missing.md => undefined
      byUri session/docs/a/b.md => ref session/docs/a/b.md
      byUri session/nest/x/y (edge) => ref session/nest/x/y
      byUri session/react/observations (edge) => throw Pattern "[topic]/observations" requires an object key with parameters, not a string
      byUri user/files/seed.md => undefined
      byUri session/positions/AAPL => ref session/positions/AAPL
      byUri session/positions/ZZZ => undefined
      byUri session/positions/AAPL/h (edge) => undefined
      byUri noslash => undefined"
    `);
  });
});
