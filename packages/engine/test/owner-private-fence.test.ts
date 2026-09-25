/**
 * The owner-private key fence, through `createFlowState` and the HTTP router.
 *
 * A key's first segment beginning `~` names its owner. Such a row is served
 * only through an owner-private collection whose owner parameter sits at that
 * segment, and only to the user it names. Every other collection lists and
 * counts without it, reads it as absent, and is refused on write, on every
 * read path, in every process.
 *
 * The collections here are generic (`notes/…`). No package's key shape is
 * Engine's contract.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineProjectedResourceCollection,
  defineResource,
  defineResourceCollection,
  handler,
  ownerSegment,
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "../src";
import { ownerKeyAdmits, ownerKeyMaySeed } from "../src/resources/owner-private";
import { createMockModelResolver } from "@flow-state-dev/testing";

const REFUSAL = "A row of an owner-private collection is readable only by the user it belongs to.";
const ALICE_KEY = "notes/~alice/research";
const ALICE_TEXT = "ALICE-PRIVATE";
const tagInput = z.object({ tag: z.string() });
const passthrough = z.object({}).passthrough();

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const attempt = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    const value = await run();
    return `ok:${JSON.stringify(value ?? null)}`;
  } catch (error) {
    return `threw:${(error as Error).message}`;
  }
};

type Router = Record<string, (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>>;

/** Boot one app over `stores`, and a caller that speaks for `user` in org acme. */
async function bootApp(flows: Record<string, () => unknown>, stores: ReturnType<typeof inMemoryStores>) {
  const state = createFlowState({
    flows: Object.fromEntries(Object.entries(flows).map(([kind, make]) => [kind, make()])) as never,
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
    debugEndpointsEnabled: true,
  });
  const router = (await state.getRouter()) as Router;
  const runtime = await state.getRuntime();
  const call = async (user: string, method: string, path: string[], body?: unknown) => {
    const response = await router[method]!(
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": user, "x-verified-org": "acme" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    let json: unknown;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, json: json as any, text };
  };
  const open = async (flow: string, user: string) => {
    const opened = await call(user, "POST", [flow, "sessions"], { userId: user });
    expect(opened.status).toBe(201);
    return opened.json.session.id as string;
  };
  /** Run `action` and return the JSON the probe wrote at `probes/<tag>`. */
  const probe = async (flow: string, user: string, sessionId: string, action: string, tag: string) => {
    const posted = await call(user, "POST", [flow, sessionId, "actions", action], { userId: user, input: { tag } });
    expect(posted.status).toBe(202);
    let row: { state?: { seen?: string } } | undefined;
    for (let i = 0; i < 200 && row === undefined; i++) {
      row = await runtime.stores.resourceState.get("org", "acme", `probes/${tag}`);
      if (row === undefined) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return JSON.parse(row!.state!.seen!);
  };
  return { state, runtime, call, open, probe };
}

const probes = defineResourceCollection({
  pattern: "probes/*",
  scope: "org",
  stateSchema: z.object({ seen: z.string() }),
});

/**
 * An app that declares no owner-private collection, so its registry never
 * arms and every overlapping collection is admitted. Alice's row is planted
 * store-direct, the way a row written by another process, an earlier
 * deployment, or another app over the same store sits. Each read path must
 * answer as if the row were not there.
 */
describe("key fence · a process that never declared an owner-private collection", () => {
  const aliceParams = { a: "notes", b: "~alice", c: "research" };
  const browsable = {
    client: { state: { read: true }, content: { read: true } },
    prefetchWindow: 10,
  } as const;
  const open = {
    wide: defineResourceCollection({
      pattern: "[a]/[b]/[c]",
      scope: "org",
      flowIsolation: false,
      stateSchema: passthrough,
      ...browsable,
    }),
    // A bracketed first segment the matcher reads as a parameter even though
    // it is not a nameable one: it still matches `notes`.
    bracketed: defineResourceCollection({
      pattern: "[a-b]/[b]/[c]",
      scope: "org",
      flowIsolation: false,
      stateSchema: passthrough,
      ...browsable,
    }),
    // A parameterized pattern reads `**` as a literal segment, so this one
    // matches only keys whose second segment is `**`. It lists nothing here
    // with or without the fence, and it is kept so that stays true.
    tenantWide: defineResourceCollection({
      pattern: "[tenant]/**",
      scope: "org",
      flowIsolation: false,
      stateSchema: passthrough,
      ...browsable,
    }),
    notesWide: defineResourceCollection({
      pattern: "notes/**",
      scope: "org",
      flowIsolation: false,
      stateSchema: passthrough,
      ...browsable,
    }),
    // The owner-private collection's pattern, declared without `ownerPrivate`.
    copy: defineResourceCollection({
      pattern: "notes/[owner]/[id]",
      scope: "org",
      flowIsolation: false,
      stateSchema: passthrough,
    }),
    sessionWide: defineResourceCollection({
      pattern: "notes/**",
      scope: "session",
      stateSchema: passthrough,
      client: { state: { read: true }, content: { read: true, create: true, update: true, delete: true } },
    }),
    probes,
    // An app source that answers for a key carrying Alice's owner segment.
    projected: defineProjectedResourceCollection({
      pattern: "shelf/**",
      scope: "org",
      stateSchema: passthrough,
      read: async ({ key }: { key: string }) => (key === "~alice/research" ? { text: ALICE_TEXT } : null),
      search: async () => ({ hits: [{ key: "~alice/research", state: { text: ALICE_TEXT } }] }),
      client: { state: { read: true }, content: { read: true } },
    }),
    // A single resource whose template is read from the run's content cache by
    // storage key: a reader of the raw seed, not of any collection handle.
    peek: defineResource({
      scope: "org",
      ref: "peek",
      stateSchema: passthrough,
      contentTemplateRef: ALICE_KEY,
    }),
  };

  const probeOpen = handler({
    name: "probe-open",
    inputSchema: tagInput,
    outputSchema: z.object({ ok: z.boolean() }),
    resources: open,
    execute: async (input, ctx) => {
      const ref = (name: keyof typeof open) => ctx.resources[name] as unknown as ResourceCollectionRef;
      const wide = ref("wide");
      const notes = ref("notesWide");
      const copy = ref("copy");
      const seen = {
        wideList: (await wide.list()).map((row) => row.path),
        wideCount: await wide.count(),
        tenantList: (await ref("tenantWide").list()).map((row) => row.path),
        bracketedList: (await ref("bracketed").list()).map((row) => row.path),
        bracketedCount: await ref("bracketed").count(),
        notesList: (await notes.list()).map((row) => row.path),
        notesCount: await notes.count(),
        copyList: (await copy.list()).map((row) => row.path),
        getOptional: await attempt(async () => (await wide.getOptional(aliceParams))?.state),
        getOptionalNotes: await attempt(async () => (await notes.getOptional("~alice/research"))?.state),
        get: await attempt(async () => (await wide.get(aliceParams)).state),
        getCopy: await attempt(async () => (await copy.get({ owner: "~alice", id: "research" })).state),
        create: await attempt(async () => (await wide.create(aliceParams, { forged: true })).state),
        createFresh: await attempt(async () => (await notes.create("~draft", { forged: true })).state),
        upsert: await attempt(async () => (await notes.upsert("~alice/research", { forged: true })).state),
        getOrCreate: await attempt(async () => (await copy.getOrCreate({ owner: "~alice", id: "other" }, {})).state),
        delete: await attempt(() => wide.delete(aliceParams)),
        projectedList: (
          await (ctx.resources.projected as unknown as {
            list(): Promise<{ items: Array<{ path: string }> }>;
          }).list()
        ).items.map((row) => row.path),
        projectedGetOptional: await attempt(
          async () => (await ref("projected" as keyof typeof open).getOptional("~alice/research"))?.state
        ),
        projectedGet: await attempt(async () => (await ref("projected" as keyof typeof open).get("~alice/research")).state),
        templatePeek: await attempt(() =>
          (ctx.resources.peek as unknown as { readContentRaw(): Promise<string | null> }).readContentRaw()
        ),
      };
      await (ctx.resources.probes as unknown as ResourceCollectionRef).create(input.tag, { seen: JSON.stringify(seen) });
      return { ok: true };
    },
  });

  const openFlow = defineFlow({
    kind: "open",
    resources: open,
    org: {
      client: {
        derived: {
          wideSeen: (ctx: { resources: Record<string, unknown> }) => {
            const wide = ctx.resources.wide as {
              list(): Array<{ path: string }>;
              count(): number;
              getOptional(key: Record<string, string>): unknown;
              get(key: Record<string, string>): unknown;
            };
            let get: string;
            try {
              wide.get(aliceParams);
              get = "present";
            } catch (error) {
              get = (error as Error).message;
            }
            return {
              list: wide.list().map((row) => row.path),
              count: wide.count(),
              byName: wide.getOptional(aliceParams) === undefined ? "absent" : "present",
              get,
            };
          },
          projectedSeen: async (ctx: { resources: Record<string, unknown> }) => {
            const projected = ctx.resources.projected as {
              getOptional(key: string): Promise<unknown>;
              get(key: string): Promise<unknown>;
            };
            let get: string;
            try {
              await projected.get("~alice/research");
              get = "present";
            } catch (error) {
              get = (error as Error).message;
            }
            return {
              byName: (await projected.getOptional("~alice/research")) === undefined ? "absent" : "present",
              get,
            };
          },
        },
      },
    },
    actions: { probe: { inputSchema: tagInput, block: probeOpen } },
    authentication: verified,
  });

  async function bootOpen() {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set("org", "acme", ALICE_KEY, { text: ALICE_TEXT }, "any");
    await primary.content!.set("org", "acme", ALICE_KEY, ALICE_TEXT);
    await primary.resourceState!.set("org", "acme", "notes/plain", { text: "plain" }, "any");
    const app = await bootApp({ open: openFlow }, stores);
    const sessionId = await app.open("open", "bob");
    const aliceRow = async () => ({
      state: (await app.runtime.stores.resourceState.get("org", "acme", ALICE_KEY))?.state,
      content: await app.runtime.stores.content.get("org", "acme", ALICE_KEY),
    });
    const bob = (method: string, path: string[], body?: unknown) => app.call("bob", method, path, body);
    return { ...app, bob, sessionId, aliceRow };
  }

  it("admits every overlapping collection, because nothing armed the registry", async () => {
    const h = await bootOpen();
    expect(h.sessionId).toBeTruthy();
  });

  it("the resource handle lists, counts and reads without the row, and refuses writes", async () => {
    const h = await bootOpen();
    const seen = await h.probe("open", "bob", h.sessionId, "probe", "bob");
    const refused = `threw:${REFUSAL}`;
    expect(seen).toEqual({
      wideList: [],
      wideCount: 0,
      tenantList: [],
      bracketedList: [],
      bracketedCount: 0,
      notesList: ["notes/plain"],
      notesCount: 1,
      copyList: [],
      getOptional: "ok:null",
      getOptionalNotes: "ok:null",
      get: refused,
      getCopy: refused,
      create: refused,
      createFresh: refused,
      upsert: refused,
      getOrCreate: refused,
      delete: refused,
      projectedList: [],
      projectedGetOptional: "ok:null",
      projectedGet: refused,
      templatePeek: "ok:null",
    });
    expect(JSON.stringify(seen)).not.toContain(ALICE_TEXT);
    expect(await h.aliceRow()).toEqual({ state: { text: ALICE_TEXT }, content: ALICE_TEXT });
    expect(await h.runtime.stores.resourceState.get("org", "acme", "notes/~draft")).toBeUndefined();
  });

  it("the browser resource routes answer as if the row were absent, and refuse writes", async () => {
    const h = await bootOpen();
    const resources = ["sessions", h.sessionId, "resources"];

    for (const [ref, key] of [
      ["wide", ALICE_KEY],
      ["notesWide", ALICE_KEY],
      ["projected", "shelf/~alice/research"],
    ] as const) {
      const listed = await h.bob("GET", [...resources, ref]);
      expect(listed.status).toBe(200);
      expect(listed.json.items.map((item: { storageKey: string }) => item.storageKey)).not.toContain(key);
      expect(listed.text).not.toContain(ALICE_TEXT);

      const item = await h.bob("GET", [...resources, ref, ...key.split("/")]);
      expect(item.status).toBe(200);
      expect(item.json).toBeNull();

      const content = await h.bob("GET", [...resources, ref, ...key.split("/"), "content"]);
      expect(content.status).toBe(404);
      expect(content.text).not.toContain(ALICE_TEXT);
    }

    const created = await h.bob("POST", [...resources, "sessionWide"], { topic: "~alice/research" });
    expect(created).toMatchObject({ status: 403, json: { error: REFUSAL } });
    const patched = await h.bob("PATCH", [...resources, "sessionWide", ...ALICE_KEY.split("/"), "content"], {
      content: "FORGED",
    });
    expect(patched).toMatchObject({ status: 403, json: { error: REFUSAL } });
    const deleted = await h.bob("DELETE", [...resources, "sessionWide", ...ALICE_KEY.split("/")]);
    expect(deleted).toMatchObject({ status: 403, json: { error: REFUSAL } });
    const sessionList = await h.bob("GET", [...resources, "sessionWide"]);
    expect(sessionList.json.items).toEqual([]);

    expect(await h.aliceRow()).toEqual({ state: { text: ALICE_TEXT }, content: ALICE_TEXT });
  });

  it("the session state snapshot counts, prefetches and derives without the row", async () => {
    const h = await bootOpen();
    const snapshot = await h.bob("GET", ["sessions", h.sessionId, "state"]);
    expect(snapshot.status).toBe(200);
    expect(snapshot.text).not.toContain(ALICE_TEXT);
    expect(snapshot.text).not.toContain("~alice");
    expect(snapshot.json.resources.org.wide.count).toBe(0);
    expect(snapshot.json.resources.org.notesWide.count).toBe(1);
    expect(snapshot.json.clientData.org.wideSeen).toEqual({ list: [], count: 0, byName: "absent", get: REFUSAL });
    expect(snapshot.json.clientData.org.projectedSeen).toEqual({ byName: "absent", get: REFUSAL });
  });

  it("the debug endpoints list, count and read without the row", async () => {
    const h = await bootOpen();
    const debug = (...rest: string[]) => h.bob("GET", ["sessions", h.sessionId, "debug", "resources", ...rest]);
    for (const ref of ["wide", "tenantWide", "notesWide", "copy"]) {
      const items = await debug(ref, "items");
      expect(items.status).toBe(200);
      expect(JSON.stringify(items.json)).not.toContain(ALICE_TEXT);
      const content = await debug(ref, ...ALICE_KEY.split("/"), "content");
      expect(content.status).toBe(404);
      expect(content.text).not.toContain(ALICE_TEXT);
    }
    const tree = await debug();
    expect(tree.status).toBe(200);
    expect(JSON.stringify(tree.json)).not.toContain(ALICE_TEXT);
    const count = (name: string) =>
      (tree.json.resources as Array<{ primaryName: string; itemCount?: number }>).find((row) => row.primaryName === name)
        ?.itemCount;
    expect(count("wide")).toBe(0);
    expect(count("notesWide")).toBe(1);
  });
});

/**
 * An app of its own, importing nothing but Core and Engine, declares an
 * owner-private collection and gets the fence: each row is served to the user
 * its owner segment names, and to nobody else.
 */
describe("an owner-private collection serves each row only to its owner", () => {
  const notes = defineResourceCollection({
    pattern: "notes/[owner]/[id]",
    ownerPrivate: { param: "owner" },
    scope: "org",
    flowIsolation: false,
    stateSchema: passthrough,
  });
  // A parameter before the owner, so a `~` value there is a key whose owner
  // segment is not at the owner parameter.
  const cards = defineResourceCollection({
    pattern: "boards/[board]/[owner]/[card]",
    ownerPrivate: { param: "owner" },
    scope: "org",
    flowIsolation: false,
    stateSchema: passthrough,
  });

  const probePrivate = handler({
    name: "probe-private",
    inputSchema: tagInput,
    outputSchema: z.object({ ok: z.boolean() }),
    resources: { notes, cards, probes },
    execute: async (input, ctx) => {
      const mine = ownerSegment(ctx.session.identity.userId!);
      const alice = ownerSegment("alice");
      const own = ctx.resources.notes as unknown as ResourceCollectionRef;
      const board = ctx.resources.cards as unknown as ResourceCollectionRef;
      const seen = {
        list: (await own.list()).map((row) => row.path).sort(),
        count: await own.count(),
        readOwn: await attempt(async () => (await own.getOptional({ owner: mine, id: "research" }))?.state),
        readAlice: await attempt(async () => (await own.getOptional({ owner: alice, id: "research" }))?.state),
        getAlice: await attempt(async () => (await own.get({ owner: alice, id: "research" })).state),
        writeAlice: await attempt(async () => (await own.create({ owner: alice, id: "forged" }, { text: "F" })).state),
        writeBare: await attempt(async () => (await own.create({ owner: "plain", id: "forged" }, { text: "F" })).state),
        writeTildeBefore: await attempt(
          async () => (await board.create({ board: "~team", owner: mine, card: "c1" }, { text: "F" })).state
        ),
        writeOwn: await attempt(async () => (await own.upsert({ owner: mine, id: "~draft" }, { text: "mine" })).state),
        readOwnDraft: await attempt(async () => (await own.getOptional({ owner: mine, id: "~draft" }))?.state),
      };
      await (ctx.resources.probes as unknown as ResourceCollectionRef).create(input.tag, { seen: JSON.stringify(seen) });
      return { ok: true };
    },
  });

  const privateFlow = defineFlow({
    kind: "private",
    resources: { notes, cards, probes },
    actions: { probe: { inputSchema: tagInput, block: probePrivate } },
    authentication: verified,
  });

  async function bootPrivate() {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set("org", "acme", ALICE_KEY, { text: ALICE_TEXT }, "any");
    await primary.resourceState!.set("org", "acme", "notes/~alice/~draft", { text: "ALICE-DRAFT" }, "any");
    await primary.resourceState!.set("org", "acme", `notes/${ownerSegment("Carol.K")}/research`, { text: "CAROL" }, "any");
    return bootApp({ private: privateFlow }, stores);
  }

  it("the owner lists and reads her rows, a later ~ segment included; nobody else does", async () => {
    const app = await bootPrivate();
    const alice = await app.probe("private", "alice", await app.open("private", "alice"), "probe", "alice");
    expect(alice.list).toEqual([ALICE_KEY, "notes/~alice/~draft"]);
    expect(alice.count).toBe(2);
    expect(alice.readOwn).toBe(`ok:${JSON.stringify({ text: ALICE_TEXT })}`);

    const bob = await app.probe("private", "bob", await app.open("private", "bob"), "probe", "bob");
    expect(bob.list).toEqual([]);
    expect(bob.count).toBe(0);
    expect(JSON.stringify(bob)).not.toContain(ALICE_TEXT);
    expect(bob.readAlice).toBe("ok:null");
    expect(bob.getAlice).toBe(`threw:${REFUSAL}`);
  });

  it("refuses a write under another user's segment, a bare owner value, or a ~ before the owner", async () => {
    const app = await bootPrivate();
    const bob = await app.probe("private", "bob", await app.open("private", "bob"), "probe", "bob");
    expect(bob.writeAlice).toBe(`threw:${REFUSAL}`);
    expect(bob.writeBare).toBe(`threw:${REFUSAL}`);
    expect(bob.writeTildeBefore).toBe(`threw:${REFUSAL}`);
    expect(bob.writeOwn).toBe(`ok:${JSON.stringify({ text: "mine" })}`);
    expect(bob.readOwnDraft).toBe(`ok:${JSON.stringify({ text: "mine" })}`);
    const stored = await app.runtime.stores.resourceState.getByPrefix("org", "acme", "");
    expect(Object.keys(stored).sort()).toEqual(
      [`notes/${ownerSegment("Carol.K")}/research`, ALICE_KEY, "notes/~alice/~draft", "notes/~bob/~draft", "probes/bob"].sort()
    );
  });

  it("matches the escaped owner segment, not the raw user id", async () => {
    const app = await bootPrivate();
    const carol = await app.probe("private", "Carol.K", await app.open("private", "Carol.K"), "probe", "carol");
    expect(carol.list).toEqual([`notes/${ownerSegment("Carol.K")}/research`]);
    expect(carol.readOwn).toBe(`ok:${JSON.stringify({ text: "CAROL" })}`);
  });

  it("serves nothing when there is no caller", () => {
    expect(ownerKeyAdmits(notes, ALICE_KEY, undefined)).toBe(false);
    expect(ownerKeyAdmits(notes, ALICE_KEY, "")).toBe(false);
    expect(ownerKeyAdmits(notes, ALICE_KEY, "alice")).toBe(true);
    expect(ownerKeyMaySeed(ALICE_KEY, undefined)).toBe(false);
    expect(ownerKeyMaySeed("notes/plain", undefined)).toBe(true);
  });

  it("the same app with an overlapping collection beside it refuses to start", async () => {
    const wide = defineFlow({
      kind: "wide",
      resources: {
        everything: defineResourceCollection({ pattern: "[a]/[b]/[c]", scope: "org", stateSchema: passthrough }),
      },
      actions: {
        ping: {
          inputSchema: z.object({}),
          block: handler({
            name: "wide-ping",
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true }),
          }),
        },
      },
      authentication: verified,
    });
    await expect(bootApp({ private: privateFlow, wide }, inMemoryStores())).rejects.toThrow(
      'Collection pattern "[a]/[b]/[c]" can reach the rows of owner-private collection "notes/[owner]/[id]".'
    );
  });
});
