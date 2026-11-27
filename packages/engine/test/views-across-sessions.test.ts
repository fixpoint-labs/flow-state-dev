/**
 * A user view reading a collection across the caller's sessions, through the
 * view route and the change bus.
 *
 * Why it matters: a board of every task in a user's sessions must hear a task
 * filed in a session made after it opened, so its read is heard on one change
 * topic for the collection and the owner, which every write to any session's
 * copy publishes on. That topic is the owner's: the same user in another org
 * never hears it, and no notice on it names the session that changed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter } from "../src";
import { createInMemoryStores } from "../src/host";
import { withChangeBus } from "../src/bus/publish-writes";
import { ownerTopic } from "../src/bus/owner-topic";
import type { ChangeNotice } from "../src/bus/types";
import { hearsNotice, type ViewHearing } from "@flow-state-dev/contracts/types/view-hearing";
import type { StoreRegistry } from "../src/stores/types";

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  }
};

const notes = defineResourceCollection({ pattern: "notes/*", scope: "session", stateSchema: z.object({ text: z.string() }) });

function desk(): FlowInstance {
  const file = handler({
    name: "file",
    inputSchema: z.object({ key: z.string(), text: z.string() }),
    outputSchema: z.object({}),
    execute: async ({ key, text }, ctx) => {
      await (ctx.resources as any).notes.create(key, { text });
      return {};
    }
  });
  const board = handler({
    name: "board",
    inputSchema: z.object({ after: z.string().optional() }),
    outputSchema: z.object({ entries: z.array(z.string()) }),
    execute: async ({ after }, ctx) => {
      const page = await (ctx.resources as any).acrossSessions().notes.list(after === undefined ? {} : { after });
      return { entries: page.entries.map((entry: { session: string; value: { text: string } }) => `${entry.session} ${entry.value.text}`) };
    }
  });
  return defineFlow({
    kind: "desk",
    authentication: verified,
    actions: { file },
    resources: { notes },
    views: { board: defineView({ scope: "user", block: board }) }
  })() as unknown as FlowInstance;
}

type Router = ReturnType<typeof createFlowApiRouter>;
const routers: Router[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

async function post(router: Router, path: string[], user: string, org: string, body: unknown) {
  const response = await router.POST(
    new Request(`http://test/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-verified-user": user, "x-verified-org": org },
      body: JSON.stringify(body)
    }),
    { params: { path } }
  );
  return { status: response.status, body: await response.text() };
}

function boot() {
  const registry = createFlowRegistry();
  registry.register(desk());
  const stores: StoreRegistry = withChangeBus(createInMemoryStores());
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  const file = async (sessionId: string, key: string, text: string, user = "alice", org = "acme") => {
    const res = await post(router, ["desk", sessionId, "actions", "file"], user, org, { input: { key, text } });
    expect(res.status, res.body).toBe(202);
    const { request } = JSON.parse(res.body) as { request: { id: string } };
    for (let i = 0; i < 200 && (await stores.request.get(request.id))?.status !== "completed"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  /** The board's raw answer to `input`, status and body. */
  const ask = (input: unknown) => post(router, ["desk", "views", "board"], "alice", "acme", { input });
  const view = async (user = "alice", org = "acme") => {
    const res = await post(router, ["desk", "views", "board"], user, org, { input: {} });
    expect(res.status, res.body).toBe(200);
    return JSON.parse(res.body) as { output: { entries: string[] }; hears: ViewHearing[] };
  };
  /** Every notice on `owner`'s change topic for `notes`, as the bus delivers it. */
  const hear = (userId: string, orgId: string) => {
    const heard: ChangeNotice[] = [];
    stores.bus!.subscribe(ownerTopic({ userId, orgId, tenantId: undefined }, "notes"), (notice) => heard.push(notice));
    return heard;
  };
  return { stores, file, view, hear, ask };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("a user view reading across sessions", () => {
  it("lists the caller's rows from every session, and is heard on the owner's change topic for the collection", async () => {
    const env = boot();
    await env.file("s1", "1", "first");
    await env.file("s2", "1", "second");
    await env.file("bob-s", "1", "bob's", "bob");
    const answer = await env.view();
    expect(answer.output.entries).toEqual(["s1 first", "s2 second"]);
    const changeTopic = answer.hears.find((hearing) => hearing.topic.scope === "user" && hearing.topic.resource !== undefined);
    expect(changeTopic).toEqual({ topic: { scope: "user", resource: "/sessions/notes" }, kinds: ["resource"], paths: ["/sessions/notes"] });
  });

  it("hears a row filed in a session made after it ran: the write publishes on the owner's topic, naming no session", async () => {
    const env = boot();
    await env.file("s1", "1", "first");
    const before = await env.view();
    const heard = env.hear("alice", "acme");
    await env.file("made-later", "1", "late");
    await settle();
    expect(heard.length).toBeGreaterThan(0);
    for (const notice of heard) {
      expect(notice.kind).toBe("resource");
      expect(notice.ids).toBeUndefined();
      // On the bus, raw; the push edge sends it only as a keyed digest.
      expect(notice.partition).toBe("made-later");
    }
    // The notice, as the socket delivers it, is one the answer's hearing hears.
    const wire = { topic: { scope: "user" as const, resource: "/sessions/notes" }, kind: "resource" as const };
    expect(hearsNotice(before.hears, wire)).toBe(true);
    expect((await env.view()).output.entries).toEqual(["made-later late", "s1 first"]);
  });

  it("never publishes a write by the same user in another org on this owner's topic", async () => {
    const env = boot();
    const acme = env.hear("alice", "acme");
    const globex = env.hear("alice", "globex");
    await env.file("elsewhere", "1", "other org", "alice", "globex");
    await settle();
    expect(acme).toEqual([]);
    expect(globex.length).toBeGreaterThan(0);
    expect((await env.view()).output.entries).toEqual([]);
  });

  it("answers a cursor it can't open with 400 invalid_cursor, so the client can start the listing again", async () => {
    const env = boot();
    await env.file("s1", "1", "first");
    for (const after of ["not-a-cursor", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]) {
      const res = await env.ask({ after });
      expect(res.status, res.body).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({ error: "invalid_cursor" });
    }
  });
});

describe("the owner's change topic, by organization", () => {
  /** A host with no sign-in of its own: every caller is in the default organization. */
  function bootOpen() {
    const registry = createFlowRegistry();
    const open = defineFlow({
      kind: "desk",
      actions: {
        file: handler({
          name: "file-open",
          inputSchema: z.object({ key: z.string(), text: z.string() }),
          outputSchema: z.object({}),
          execute: async ({ key, text }, ctx) => {
            await (ctx.resources as any).notes.create(key, { text });
            return {};
          }
        })
      },
      resources: { notes },
      views: { board: defineView({ scope: "user", block: handler({ name: "board-open", inputSchema: z.object({}), outputSchema: z.object({}), execute: () => ({}) }) }) }
    })() as unknown as FlowInstance;
    registry.register(open);
    const stores: StoreRegistry = withChangeBus(createInMemoryStores());
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    routers.push(router);
    const file = async (sessionId: string) => {
      const response = await router.POST(
        new Request(`http://test/api/flows/desk/${sessionId}/actions/file`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "alice", input: { key: "1", text: "x" } })
        }),
        { params: { path: ["desk", sessionId, "actions", "file"] } }
      );
      return { status: response.status, body: await response.text() };
    };
    return { stores, file };
  }

  it("hears a write in an app with no sign-in on the default organization's topic, where its view listens", async () => {
    const env = bootOpen();
    const heard: ChangeNotice[] = [];
    env.stores.bus!.subscribe(ownerTopic({ userId: "alice", orgId: DEFAULT_ORG_ID, tenantId: undefined }, "notes"), (notice) => heard.push(notice));
    const res = await env.file("s1");
    expect(res.status, res.body).toBe(202);
    for (let i = 0; i < 100 && heard.length === 0; i += 1) await settle();
    expect(heard.length).toBeGreaterThan(0);
  });

  it("refuses a write into a session with no organization, so nothing reaches any owner's topic", async () => {
    const env = bootOpen();
    const now = Date.now();
    await env.stores.session.set(
      "no-org",
      { id: "no-org", flowKind: "desk", flowId: "desk", userId: "alice", state: {}, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
      "absent"
    );
    const heard: ChangeNotice[] = [];
    for (const orgId of [DEFAULT_ORG_ID, undefined]) {
      env.stores.bus!.subscribe(ownerTopic({ userId: "alice", orgId, tenantId: undefined }, "notes"), (notice) => heard.push(notice));
    }
    const res = await env.file("no-org");
    // Accepted at the door, refused by the run before it writes anything.
    if (res.status === 202) {
      const { request } = JSON.parse(res.body) as { request: { id: string } };
      let status: string | undefined;
      for (let i = 0; i < 200; i += 1) {
        status = (await env.stores.request.get(request.id))?.status;
        if (status !== undefined && status !== "in_progress") break;
        await settle();
      }
      expect(status).toBe("failed");
    }
    await settle();
    expect(heard).toEqual([]);
    expect(await env.stores.resourceState.getByPrefix("session", "no-org", "notes/")).toEqual({});
  });
});
