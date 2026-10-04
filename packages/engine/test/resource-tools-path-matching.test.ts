/**
 * Path matching for the generic resource tools, against the real resource registry.
 *
 * A collection instance's path is its storage key, and its uri is
 * `${scope}/${path}`. So a path and a uri should reach the same instance
 * through every entry point: the four CRUD tools, `resolveResourceByPath`,
 * and `resolveResourceByUri`. A path belongs to the collection whose pattern
 * matches it under the collection's own rule (`matchesPattern`): `*` is one
 * segment, `**` is any depth, `[param]` is one segment bound to that param.
 *
 * The table below is the contract. Each row runs on a fresh context, so no
 * row sees another row's writes. The existing unit tests stub the collection
 * refs; this file does not, so the real `get`/`create`/`getOptional`
 * validation is what answers.
 */
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineProjectedResourceCollection,
  defineResourceCollection,
  defineResource,
  handler,
  ownerSegment,
  resolveResourceByPath,
  resolveResourceByUri,
  resourceTools,
} from "@flow-state-dev/core";
import { asRuntime } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext, createInMemoryStores } from "../src";

const s = z.object({ v: z.string().default("") });
const OWNER = ownerSegment("user_1");
const OTHER = ownerSegment("user_2");

async function makeCtx() {
  const resources = {
    profile: defineResource({ scope: "session", stateSchema: s }),
    files: defineResourceCollection({ scope: "session", pattern: "files/*", stateSchema: s }),
    docs: defineResourceCollection({ scope: "session", pattern: "docs/**", stateSchema: s }),
    // Registered shallow-first on purpose: a shallow collection must not claim
    // a nested path it can't hold and so hide the deep one behind it.
    nestShallow: defineResourceCollection({ scope: "session", pattern: "nest/*", stateSchema: s }),
    nestDeep: defineResourceCollection({ scope: "session", pattern: "nest/**", stateSchema: s }),
    obs: defineResourceCollection({ scope: "session", pattern: "[topic]/observations", stateSchema: s }),
    notes: defineResourceCollection({
      scope: "org",
      pattern: "notes/[owner]/[id]",
      ownerPrivate: { param: "owner" },
      stateSchema: s,
    }),
    positions: defineProjectedResourceCollection({
      pattern: "positions/*",
      scope: "session",
      stateSchema: s,
      read: async ({ key }: { key: string }) => (key === "AAPL" ? { v: "aapl" } : null),
      search: (async () => ({ hits: [] })) as never,
    }),
  };
  const block = handler({ name: "noop", resources, execute: () => "ok" });
  const flow = defineFlow({
    kind: "resource-path-matching",
    actions: { run: { inputSchema: z.string(), block } },
  })();
  const ctx: any = await createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores: createInMemoryStores(),
  });
  // Seed through each collection's own API, never through the matcher under test.
  await ctx.resources.files.create("seed.md", { v: "f" });
  await ctx.resources.docs.create("a/b.md", { v: "d" });
  await ctx.resources.nestDeep.create("x/y", { v: "n" });
  await ctx.resources.obs.create({ topic: "react" }, { v: "o" });
  await ctx.resources.notes.create({ owner: OWNER, id: "mine" }, { v: "m" });
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
const exec = (name: string, input: unknown) => (ctx: any) => asRuntime(tools[name]!).run(input, ctx);
const byPath = (path: string) => (ctx: any) => resolveResourceByPath(path, ctx);
const byUri = (uri: string) => (ctx: any) => resolveResourceByUri(uri, ctx);

const NO_COLLECTION = (path: string) => `throw No resource collection found matching path: ${path}`;
const REFUSED = "throw A row of an owner-private collection is readable only by the user it belongs to.";

type Row = readonly [label: string, run: (ctx: any) => Promise<unknown>, expected: string];

const ROWS: readonly Row[] = [
  // ── CRUD tools ────────────────────────────────────────────────────────────
  ["create files/new.md", exec("createResource", { path: "files/new.md" }), `ok {"path":"files/new.md","ok":true}`],
  // `files/*` holds one segment, and no other collection matches: a miss, not a wrong claim.
  ["create files/a/b.md", exec("createResource", { path: "files/a/b.md" }), NO_COLLECTION("files/a/b.md")],
  ["create files/", exec("createResource", { path: "files/" }), NO_COLLECTION("files/")],
  ["create docs/p/q.md", exec("createResource", { path: "docs/p/q.md" }), `ok {"path":"docs/p/q.md","ok":true}`],
  // Nested under a shallow collection: the deep collection owns it.
  ["create nest/p/q", exec("createResource", { path: "nest/p/q" }), `ok {"path":"nest/p/q","ok":true}`],
  // Named slot: the segment binds to `topic`.
  ["create vue/observations", exec("createResource", { path: "vue/observations" }), `ok {"path":"vue/observations","ok":true}`],
  ["create nowhere/x", exec("createResource", { path: "nowhere/x" }), NO_COLLECTION("nowhere/x")],
  // Projected collections are read-through: never a CRUD target.
  ["create positions/MSFT", exec("createResource", { path: "positions/MSFT" }), NO_COLLECTION("positions/MSFT")],
  ["read files/seed.md", exec("readResource", { path: "files/seed.md" }), `ok {"path":"files/seed.md","state":{"v":"f"}}`],
  ["read files/missing.md", exec("readResource", { path: "files/missing.md" }), `throw Resource instance "files/missing.md" not found in collection "files/*"`],
  ["read docs/a/b.md", exec("readResource", { path: "docs/a/b.md" }), `ok {"path":"docs/a/b.md","state":{"v":"d"}}`],
  ["read nest/x/y", exec("readResource", { path: "nest/x/y" }), `ok {"path":"nest/x/y","state":{"v":"n"}}`],
  ["read react/observations", exec("readResource", { path: "react/observations" }), `ok {"path":"react/observations","state":{"v":"o"}}`],
  ["update files/seed.md", exec("updateResource", { path: "files/seed.md", state: { v: "u" } }), `ok {"path":"files/seed.md","ok":true}`],
  ["update react/observations", exec("updateResource", { path: "react/observations", state: { v: "u" } }), `ok {"path":"react/observations","ok":true}`],
  ["delete files/seed.md", exec("deleteResource", { path: "files/seed.md" }), `ok {"path":"files/seed.md","ok":true}`],
  ["delete nest/x/y", exec("deleteResource", { path: "nest/x/y" }), `ok {"path":"nest/x/y","ok":true}`],
  // Separator noise still normalizes the way a string key always has.
  ["read files/seed.md/ (trailing slash)", exec("readResource", { path: "files/seed.md/" }), `ok {"path":"files/seed.md/","state":{"v":"f"}}`],
  ["read files//seed.md (doubled slash)", exec("readResource", { path: "files//seed.md" }), `ok {"path":"files//seed.md","state":{"v":"f"}}`],
  // Traversal never reaches a collection.
  ["read docs/../files/seed.md", exec("readResource", { path: "docs/../files/seed.md" }), NO_COLLECTION("docs/../files/seed.md")],
  // Owner-private rows: reachable by path for their owner, refused for anyone else.
  [`read notes/${OWNER}/mine`, exec("readResource", { path: `notes/${OWNER}/mine` }), `ok {"path":"notes/${OWNER}/mine","state":{"v":"m"}}`],
  [`create notes/${OTHER}/theirs`, exec("createResource", { path: `notes/${OTHER}/theirs` }), REFUSED],
  [`read notes/${OTHER}/mine`, exec("readResource", { path: `notes/${OTHER}/mine` }), REFUSED],

  // ── resolveResourceByPath ─────────────────────────────────────────────────
  ["byPath profile", byPath("profile"), "ref session/profile"],
  ["byPath files/seed.md", byPath("files/seed.md"), "ref session/files/seed.md"],
  ["byPath files/missing.md", byPath("files/missing.md"), "undefined"],
  ["byPath docs/a/b.md", byPath("docs/a/b.md"), "ref session/docs/a/b.md"],
  ["byPath nest/x/y", byPath("nest/x/y"), "ref session/nest/x/y"],
  ["byPath react/observations", byPath("react/observations"), "ref session/react/observations"],
  ["byPath vue/observations (unseeded)", byPath("vue/observations"), "undefined"],
  ["byPath positions/AAPL", byPath("positions/AAPL"), "undefined"],
  ["byPath nowhere", byPath("nowhere"), "undefined"],
  [`byPath notes/${OWNER}/mine`, byPath(`notes/${OWNER}/mine`), `ref org/notes/${OWNER}/mine`],
  [`byPath notes/${OTHER}/mine`, byPath(`notes/${OTHER}/mine`), REFUSED],

  // ── resolveResourceByUri ──────────────────────────────────────────────────
  ["byUri session/profile", byUri("session/profile"), "ref session/profile"],
  ["byUri session/files/seed.md", byUri("session/files/seed.md"), "ref session/files/seed.md"],
  ["byUri session/files/missing.md", byUri("session/files/missing.md"), "undefined"],
  ["byUri session/docs/a/b.md", byUri("session/docs/a/b.md"), "ref session/docs/a/b.md"],
  ["byUri session/nest/x/y", byUri("session/nest/x/y"), "ref session/nest/x/y"],
  ["byUri session/react/observations", byUri("session/react/observations"), "ref session/react/observations"],
  ["byUri user/files/seed.md", byUri("user/files/seed.md"), "undefined"],
  ["byUri session/positions/AAPL", byUri("session/positions/AAPL"), "ref session/positions/AAPL"],
  ["byUri session/positions/ZZZ", byUri("session/positions/ZZZ"), "undefined"],
  ["byUri session/positions/AAPL/h", byUri("session/positions/AAPL/h"), "undefined"],
  ["byUri noslash", byUri("noslash"), "undefined"],
  ["byUri session/", byUri("session/"), "undefined"],
  [`byUri org/notes/${OWNER}/mine`, byUri(`org/notes/${OWNER}/mine`), `ref org/notes/${OWNER}/mine`],
  [`byUri org/notes/${OTHER}/mine`, byUri(`org/notes/${OTHER}/mine`), "undefined"],
];

describe("resource tools · path matching against the real registry", () => {
  it.each(ROWS)("%s", async (_label, run, expected) => {
    const ctx = await makeCtx();
    expect(await outcome(() => run(ctx))).toBe(expected);
  });

  // A path and its uri name the same instance, whichever door the caller uses.
  it.each([
    ["files/seed.md"],
    ["docs/a/b.md"],
    ["nest/x/y"],
    ["react/observations"],
  ])("path %s and its session uri resolve to the same instance", async (path) => {
    const ctx = await makeCtx();
    const viaPath = await resolveResourceByPath(path, ctx);
    const viaUri = await resolveResourceByUri(`session/${path}`, ctx);
    expect(viaPath?.uri).toBe(`session/${path}`);
    expect(viaUri?.uri).toBe(viaPath?.uri);
  });

  // What a path tool writes is what the uri reader and the collection's own API see.
  it.each([
    ["nest/p/q", (c: any) => c.resources.nestDeep.getOptional("p/q")],
    ["vue/observations", (c: any) => c.resources.obs.getOptional({ topic: "vue" })],
  ] as const)("createResource %s lands where the collection keeps it", async (path, own) => {
    const ctx = await makeCtx();
    await exec("createResource", { path, state: { v: "w" } })(ctx);
    expect((await own(ctx))?.state).toEqual({ v: "w" });
    expect((await resolveResourceByUri(`session/${path}`, ctx))?.state).toEqual({ v: "w" });
    // The shallow collection must not have taken the nested write.
    expect(await ctx.resources.nestShallow.list()).toEqual([]);
  });
});
