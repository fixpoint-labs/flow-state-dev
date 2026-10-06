/**
 * The owner-writes key fence, through `createFlowState` and the HTTP router.
 *
 * A collection declaring `ownerWrites: { param }` keys each row with the
 * owner's segment, like an owner-private one. Every read path serves the row
 * to anyone the scope serves; a create, update or delete is refused unless the
 * session's user is the one the key names. The rule holds at the store, so it
 * holds through the handle, through a ref obtained by reading, through the
 * browser routes and from a second process over the same store.
 *
 * The collections here are generic (`entries/…`). No package's key shape is
 * Engine's contract.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler, ownerSegment } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "../src";
import {
  OWNER_ROW_REFUSAL,
  OWNER_WRITE_REFUSAL,
  ownerKeyAdmits,
  ownerKeyMaySeed,
  ownerWriteRefusal,
} from "../src/resources/owner-private";
import { createMockModelResolver } from "@flow-state-dev/testing";

const WRITE_REFUSAL = OWNER_WRITE_REFUSAL;
const PRIVATE_REFUSAL = OWNER_ROW_REFUSAL;
const ALICE_KEY = `entries/apollo/${ownerSegment("alice")}/checkout`;
const ALICE_STATE = { status: "ALICE-ON-TRACK" };
const passthrough = z.object({}).passthrough();
const tagInput = z.object({ tag: z.string() });

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
async function bootApp(flows: Record<string, unknown>, stores: ReturnType<typeof inMemoryStores>) {
  const state = createFlowState({
    flows: flows as never,
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
    debugEndpointsEnabled: true,
    debugAllowAnonymousLocal: true,
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
  /** Run `action` as `user` and return the JSON the probe wrote at `probes/<tag>`. */
  const probe = async (flow: string, user: string, action: string, tag: string) => {
    const sessionId = await open(flow, user);
    const posted = await call(user, "POST", [flow, sessionId, "actions", action], { userId: user, input: { tag } });
    expect(posted.status).toBe(202);
    let row: { state?: { seen?: string } } | undefined;
    for (let i = 0; i < 400 && row === undefined; i++) {
      row = await runtime.stores.resourceState.get("org", "acme", `probes/${tag}`);
      if (row === undefined) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return JSON.parse(row!.state!.seen!);
  };
  const stored = async (key: string) => ({
    state: (await runtime.stores.resourceState.get("org", "acme", key))?.state,
    content: await runtime.stores.content.get("org", "acme", key),
  });
  return { state, runtime, call, open, probe, stored };
}

const probes = defineResourceCollection({
  pattern: "probes/*",
  scope: "org",
  stateSchema: z.object({ seen: z.string() }),
});

const entries = defineResourceCollection({
  pattern: "entries/[project]/[owner]/[entry]",
  ownerWrites: { param: "owner" },
  scope: "org",
  flowIsolation: false,
  stateSchema: passthrough,
  client: { state: { read: true }, content: { read: true } },
});

const entryKey = (user: string, entry = "checkout") => ({ project: "apollo", owner: ownerSegment(user), entry });

/** Each user writes their own entry, then tries every write on Alice's. */
const probeEntries = handler({
  name: "probe-entries",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { entries, probes },
  execute: async (input, ctx) => {
    const me = ctx.session.identity.userId!;
    const col = ctx.resources.entries as unknown as ResourceCollectionRef;
    const alice = entryKey("alice");
    const seen = {
      writeOwn: await attempt(async () => (await col.upsert(entryKey(me, "mine"), { status: `${me}-own` })).state),
      list: (await col.list()).map((row) => row.path).sort(),
      count: await col.count(),
      getOptionalAlice: await attempt(async () => (await col.getOptional(alice))?.state),
      getAlice: await attempt(async () => (await col.get(alice)).state),
      listUnderProject: (await col.list("apollo/")).map((row) => row.path).sort(),
      createUnderAlice: await attempt(async () => (await col.create(entryKey("alice", "forged"), { status: "F" })).state),
      replaceAlice: await attempt(async () => (await col.create(alice, { status: "F" }, { replace: true })).state),
      upsertAlice: await attempt(async () => (await col.upsert(alice, { status: "F" })).state),
      getOrCreateAlice: await attempt(async () => (await col.getOrCreate(entryKey("alice", "other"), {})).state),
      deleteAlice: await attempt(() => col.delete(alice)),
      patchThroughRef: await attempt(async () => (await col.get(alice)).patchState({ status: "F" })),
      setThroughRef: await attempt(async () => (await col.get(alice)).setState({ status: "F" })),
      contentThroughRef: await attempt(async () =>
        ((await col.get(alice)) as unknown as { writeContent(c: string): Promise<void> }).writeContent("FORGED")
      ),
    };
    await (ctx.resources.probes as unknown as ResourceCollectionRef).create(input.tag, { seen: JSON.stringify(seen) });
    return { ok: true };
  },
});

/** The user writes their own entry and nothing else. */
const seedOwn = handler({
  name: "seed-own",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { entries, probes },
  execute: async (input, ctx) => {
    const me = ctx.session.identity.userId!;
    const col = ctx.resources.entries as unknown as ResourceCollectionRef;
    const seen = {
      writeOwn: await attempt(async () => (await col.upsert(entryKey(me, "mine"), { status: `${me}-own` })).state),
    };
    await (ctx.resources.probes as unknown as ResourceCollectionRef).create(input.tag, { seen: JSON.stringify(seen) });
    return { ok: true };
  },
});

const entriesFlow = defineFlow({
  kind: "entries",
  resources: { entries, probes },
  org: {
    client: {
      derived: {
        entriesSeen: (ctx: { resources: Record<string, unknown> }) => {
          const col = ctx.resources.entries as { list(): Array<{ path: string }>; count(): number };
          return { list: col.list().map((row) => row.path).sort(), count: col.count() };
        },
      },
    },
  },
  actions: {
    probe: { inputSchema: tagInput, block: probeEntries },
    seed: { inputSchema: tagInput, block: seedOwn },
  },
  authentication: verified,
});

async function bootEntries(stores = inMemoryStores()) {
  const app = await bootApp({ entries: entriesFlow }, stores);
  // Alice writes her own entry through the app: nothing is planted.
  const alice = await app.probe("entries", "alice", "seed", "alice-seed");
  expect(alice.writeOwn).toBe(`ok:${JSON.stringify({ status: "alice-own" })}`);
  return { ...app, stores };
}

describe("an owner-writes collection: the scope reads every row, only its owner writes it", () => {
  it("the owner writes her rows, by every write", async () => {
    const app = await bootEntries();
    const alice = await app.probe("entries", "alice", "probe", "alice-2");
    // Her own key, through each write the handle and a ref offer.
    expect(alice.createUnderAlice).toBe(`ok:${JSON.stringify({ status: "F" })}`);
    expect(alice.upsertAlice).not.toMatch(/^threw:/);
    expect(alice.deleteAlice).toBe("ok:null");
  });

  it("another user lists, counts and reads the owner's rows through the handle", async () => {
    const app = await bootEntries();
    await app.runtime.stores.resourceState.set("org", "acme", ALICE_KEY, ALICE_STATE, "any");
    const bob = await app.probe("entries", "bob", "probe", "bob");
    const aliceMine = `entries/apollo/${ownerSegment("alice")}/mine`;
    const bobMine = `entries/apollo/${ownerSegment("bob")}/mine`;
    expect(bob.list).toEqual([ALICE_KEY, aliceMine, bobMine].sort());
    expect(bob.listUnderProject).toEqual([ALICE_KEY, aliceMine, bobMine].sort());
    expect(bob.count).toBe(3);
    expect(bob.getOptionalAlice).toBe(`ok:${JSON.stringify(ALICE_STATE)}`);
    expect(bob.getAlice).toBe(`ok:${JSON.stringify(ALICE_STATE)}`);
  });

  it("refuses another user's create, replace, upsert, getOrCreate and delete under the owner's key, and every write through a ref he read", async () => {
    const app = await bootEntries();
    await app.runtime.stores.resourceState.set("org", "acme", ALICE_KEY, ALICE_STATE, "any");
    await app.runtime.stores.content.set("org", "acme", ALICE_KEY, "ALICE-REPORT");
    const bob = await app.probe("entries", "bob", "probe", "bob");
    const refused = `threw:${WRITE_REFUSAL}`;
    expect(bob).toMatchObject({
      writeOwn: `ok:${JSON.stringify({ status: "bob-own" })}`,
      createUnderAlice: refused,
      replaceAlice: refused,
      upsertAlice: refused,
      getOrCreateAlice: refused,
      deleteAlice: refused,
      patchThroughRef: refused,
      setThroughRef: refused,
      contentThroughRef: refused,
    });
    // Nothing changed, and nothing new landed under Alice's segment.
    expect(await app.stored(ALICE_KEY)).toEqual({ state: ALICE_STATE, content: "ALICE-REPORT" });
    const rows = await app.runtime.stores.resourceState.getByPrefix("org", "acme", "entries/");
    expect(Object.keys(rows).sort()).toEqual(
      [ALICE_KEY, `entries/apollo/${ownerSegment("alice")}/mine`, `entries/apollo/${ownerSegment("bob")}/mine`].sort()
    );
  });

  it("a second process over the same store refuses the same writes", async () => {
    const first = await bootEntries();
    await first.runtime.stores.resourceState.set("org", "acme", ALICE_KEY, ALICE_STATE, "any");
    const second = await bootApp({ entries: entriesFlow }, first.stores);
    const bob = await second.probe("entries", "bob", "probe", "bob-elsewhere");
    expect(bob.getAlice).toBe(`ok:${JSON.stringify(ALICE_STATE)}`);
    expect(bob.upsertAlice).toBe(`threw:${WRITE_REFUSAL}`);
    expect(bob.patchThroughRef).toBe(`threw:${WRITE_REFUSAL}`);
    expect(bob.deleteAlice).toBe(`threw:${WRITE_REFUSAL}`);
    expect(await first.stored(ALICE_KEY)).toMatchObject({ state: ALICE_STATE });
  });

  it("the browser routes, the state snapshot and the debug endpoints read the owner's row", async () => {
    const app = await bootEntries();
    await app.runtime.stores.resourceState.set("org", "acme", ALICE_KEY, ALICE_STATE, "any");
    await app.runtime.stores.content.set("org", "acme", ALICE_KEY, "ALICE-REPORT");
    const sessionId = await app.open("entries", "bob");
    const resources = ["sessions", sessionId, "resources", "entries"];

    const listed = await app.call("bob", "GET", resources);
    expect(listed.status).toBe(200);
    expect(listed.json.items.map((item: { storageKey: string }) => item.storageKey)).toContain(ALICE_KEY);
    const item = await app.call("bob", "GET", [...resources, ...ALICE_KEY.split("/")]);
    expect(item.status).toBe(200);
    expect(item.text).toContain("ALICE-ON-TRACK");
    const content = await app.call("bob", "GET", [...resources, ...ALICE_KEY.split("/"), "content"]);
    expect(content.status).toBe(200);
    expect(content.text).toContain("ALICE-REPORT");

    const snapshot = await app.call("bob", "GET", ["sessions", sessionId, "state"]);
    expect(snapshot.status).toBe(200);
    expect(snapshot.json.resources.org.entries.count).toBe(2);
    expect(snapshot.json.clientData.org.entriesSeen.list).toContain(ALICE_KEY);

    const debug = await app.call("bob", "GET", ["sessions", sessionId, "debug", "resources", "entries", "items"]);
    expect(debug.status).toBe(200);
    expect(JSON.stringify(debug.json)).toContain("ALICE-ON-TRACK");
  });

  // The browser create route takes a bare topic, which a parameterized
  // pattern refuses before any owner check, so only update and delete apply.
  it("the browser update and delete routes refuse another user's key and take the owner's", async () => {
    const drafts = defineResourceCollection({
      pattern: "drafts/[owner]/[id]",
      ownerWrites: { param: "owner" },
      scope: "session",
      stateSchema: passthrough,
      client: { state: { read: true }, content: { read: true, update: true, delete: true } },
    });
    const draftsFlow = defineFlow({
      kind: "drafts",
      resources: { drafts },
      actions: {},
      authentication: verified,
    });
    const app = await bootApp({ drafts: draftsFlow }, inMemoryStores());
    const sessionId = await app.open("drafts", "bob");
    const resources = ["sessions", sessionId, "resources", "drafts"];
    const aliceDraft = `drafts/${ownerSegment("alice")}/d1`;
    const bobDraft = `drafts/${ownerSegment("bob")}/d1`;
    await app.runtime.stores.resourceState.set("session", sessionId, aliceDraft, { text: "A" }, "any");
    await app.runtime.stores.resourceState.set("session", sessionId, bobDraft, { text: "B" }, "any");

    const patched = await app.call("bob", "PATCH", [...resources, ...aliceDraft.split("/"), "content"], {
      content: "FORGED",
    });
    expect(patched).toMatchObject({ status: 403, json: { error: WRITE_REFUSAL } });
    const deleted = await app.call("bob", "DELETE", [...resources, ...aliceDraft.split("/")]);
    expect(deleted).toMatchObject({ status: 403, json: { error: WRITE_REFUSAL } });
    expect((await app.runtime.stores.resourceState.get("session", sessionId, aliceDraft))?.state).toEqual({ text: "A" });
    expect(await app.runtime.stores.content.get("session", sessionId, aliceDraft)).toBeUndefined();

    const ownPatch = await app.call("bob", "PATCH", [...resources, ...bobDraft.split("/"), "content"], { content: "MINE" });
    expect(ownPatch.status).toBe(200);
    const ownDelete = await app.call("bob", "DELETE", [...resources, ...bobDraft.split("/")]);
    expect(ownDelete.status).toBe(200);
  });
});

describe("the owner-writes predicates", () => {
  it("read with no caller, and write only as the owner", () => {
    expect(ownerKeyAdmits(entries, ALICE_KEY, undefined)).toBe(true);
    expect(ownerWriteRefusal(entries, ALICE_KEY, undefined)).toBe(WRITE_REFUSAL);
    expect(ownerWriteRefusal(entries, ALICE_KEY, "")).toBe(WRITE_REFUSAL);
    expect(ownerWriteRefusal(entries, ALICE_KEY, "bob")).toBe(WRITE_REFUSAL);
    expect(ownerWriteRefusal(entries, ALICE_KEY, "alice")).toBeUndefined();
  });

  it("serve no key whose first ~ segment is not at the owner parameter", () => {
    const tildeBefore = `entries/~team/${ownerSegment("alice")}/checkout`;
    expect(ownerKeyAdmits(entries, tildeBefore, "alice")).toBe(false);
    expect(ownerWriteRefusal(entries, tildeBefore, "alice")).toBe(PRIVATE_REFUSAL);
    expect(ownerKeyAdmits(entries, "entries/apollo/alice/checkout", "alice")).toBe(false);
  });

  it("let another user's row into the run's cache only beside a collection that reads it", () => {
    expect(ownerKeyMaySeed(ALICE_KEY, "bob")).toBe(false);
    expect(ownerKeyMaySeed(ALICE_KEY, "bob", [entries])).toBe(true);
    expect(ownerKeyMaySeed(`notes/${ownerSegment("alice")}/n1`, "bob", [entries])).toBe(false);
  });
});

describe("the startup fence reaches owner-writes rows too", () => {
  const ping = handler({
    name: "ping",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true }),
  });
  const flowWith = (kind: string, resources: Record<string, unknown>) =>
    defineFlow({ kind, resources: resources as never, actions: { ping: { inputSchema: z.object({}), block: ping } }, authentication: verified });
  const wide = flowWith("wide", {
    everything: defineResourceCollection({ pattern: "entries/**", scope: "org", stateSchema: passthrough }),
  });
  const owned = flowWith("owned", { entries });
  const reach = 'Collection pattern "entries/**" can reach the rows of owner-writes collection "entries/[project]/[owner]/[entry]".';

  it("refuses a wider collection registered after it", async () => {
    await expect(bootApp({ owned, wide }, inMemoryStores())).rejects.toThrow(reach);
  });

  it("refuses a wider collection registered before it, naming the held flow", async () => {
    await expect(bootApp({ wide, owned }, inMemoryStores())).rejects.toThrow(
      `${reach} Only that collection reads or writes them. Flow "wide" declares it and is already registered.`
    );
  });

  it("refuses the same pattern declared owner-private beside it", async () => {
    const privateCopy = flowWith("private-copy", {
      entries: defineResourceCollection({
        pattern: "entries/[project]/[owner]/[entry]",
        ownerPrivate: { param: "owner" },
        scope: "org",
        stateSchema: passthrough,
      }),
    });
    await expect(bootApp({ owned, privateCopy }, inMemoryStores())).rejects.toThrow(
      'Collection pattern "entries/[project]/[owner]/[entry]" can reach the rows of owner-writes collection "entries/[project]/[owner]/[entry]".'
    );
  });

  it("admits the same declaration on several flows", async () => {
    const again = flowWith("again", { entries });
    await expect(bootApp({ owned, again }, inMemoryStores())).resolves.toBeDefined();
  });
});

describe("an owner-private collection keeps its refusal beside the new mode", () => {
  it("still reads another user's row as absent and refuses its write with the read refusal", async () => {
    const notes = defineResourceCollection({
      pattern: "notes/[owner]/[id]",
      ownerPrivate: { param: "owner" },
      scope: "org",
      flowIsolation: false,
      stateSchema: passthrough,
    });
    const probeNotes = handler({
      name: "probe-notes",
      inputSchema: tagInput,
      outputSchema: z.object({ ok: z.boolean() }),
      resources: { notes, probes, entries },
      execute: async (input, ctx) => {
        const col = ctx.resources.notes as unknown as ResourceCollectionRef;
        const key = { owner: ownerSegment("alice"), id: "n1" };
        const seen = {
          list: (await col.list()).map((row) => row.path),
          write: await attempt(async () => (await col.upsert(key, { text: "F" })).state),
        };
        await (ctx.resources.probes as unknown as ResourceCollectionRef).create(input.tag, { seen: JSON.stringify(seen) });
        return { ok: true };
      },
    });
    const flow = defineFlow({
      kind: "notes",
      resources: { notes, probes, entries },
      actions: { probe: { inputSchema: tagInput, block: probeNotes } },
      authentication: verified,
    });
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set("org", "acme", `notes/${ownerSegment("alice")}/n1`, { text: "A" }, "any");
    const app = await bootApp({ notes: flow }, stores);
    const bob = await app.probe("notes", "bob", "probe", "bob");
    expect(bob).toEqual({ list: [], write: `threw:${PRIVATE_REFUSAL}` });
  });
});
