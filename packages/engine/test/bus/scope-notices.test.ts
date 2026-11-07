/**
 * Resource and scope-state notices (FIX-1506): a run's write to session, user
 * or org state, and to a resource a client can read, publishes a notice on
 * that scope's topic once it lands, with or without a stream, naming the
 * request that made it. Another session's live view hears it there.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResource, defineResourceCollection, handler, ownerSegment } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  handleCreateCollectionItem,
  handleDeleteCollectionItem,
  handleUpdateResourceContent
} from "../../src/routes/resource-routes";
import { publishScopeChange } from "../../src/bus/scope-changes";
import {
  createFlowRegistry,
  runAction
} from "../../src";
import {
  createInMemoryStores
} from "../../src/host";
import {
  createInMemoryBus,
  type BusTopic,
  type ChangeBus,
  type ChangeNotice
} from "../../src/host";

const ORG = "acme";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every notice `bus` delivers on `topic`, in order. */
function hear(bus: ChangeBus, topic: BusTopic): ChangeNotice[] {
  const heard: ChangeNotice[] = [];
  bus.subscribe(topic, (notice) => heard.push(notice));
  return heard;
}

const orgTopic: BusTopic = { scope: "org", id: ORG, tenantId: "" };
const userTopic: BusTopic = { scope: "user", id: "alice", tenantId: "" };
const sessionTopic = (id: string): BusTopic => ({ scope: "session", id, tenantId: "" });

const licenses = defineResourceCollection({
  pattern: "licenses/*",
  scope: "org",
  stateSchema: z.object({ name: z.string().default("") }),
  client: { state: { read: true } }
});

/** An org collection with no `client` config, in a scope whose derived value may read it. */
/** An org collection whose rows only their owner may read. */
const drafts = defineResourceCollection({
  pattern: "drafts/[owner]/[id]",
  ownerPrivate: { param: "owner" },
  scope: "org",
  flowIsolation: false,
  stateSchema: z.object({ title: z.string().default("") }),
  // A write grant, and an org scope with a derived value: either makes it publish.
  client: { content: { update: true } }
});

/** A user single resource a client can read, neither live nor reactive. */
const profile = defineResource({
  scope: "user",
  stateSchema: z.object({ bio: z.string().default("") }),
  default: { bio: "" },
  client: { expose: ["bio"] }
});

const audit = defineResourceCollection({
  pattern: "audit/*",
  scope: "org",
  stateSchema: z.object({ n: z.number().default(0) })
});

/** A session collection no client can read, in a scope with no derived value. */
const ledger = defineResourceCollection({
  pattern: "ledger/*",
  scope: "session",
  stateSchema: z.object({ n: z.number().default(0) })
});

function app() {
  const write = (name: string, execute: (input: { value: string }, ctx: any) => Promise<unknown>) =>
    handler({ name, inputSchema: z.object({ value: z.string() }), execute });
  return defineFlow({
    kind: "desk",
    org: {
      stateSchema: z.object({ plan: z.string().default("free") }),
      client: { expose: ["plan"], derived: { audited: () => true } }
    },
    user: { stateSchema: z.object({ theme: z.string().default("light") }) },
    session: { stateSchema: z.object({ topic: z.string().default("") }) },
    request: { stateSchema: z.object({ step: z.string().default("") }) },
    resources: { licenses, audit, ledger, profile, drafts },
    actions: {
      orgPlan: { inputSchema: z.object({ value: z.string() }), block: write("org-plan", async ({ value }, ctx) => ctx.org.patchState({ plan: value })) },
      userTheme: { inputSchema: z.object({ value: z.string() }), block: write("user-theme", async ({ value }, ctx) => ctx.user.patchState({ theme: value })) },
      sessionTopic: { inputSchema: z.object({ value: z.string() }), block: write("session-topic", async ({ value }, ctx) => ctx.session.patchState({ topic: value })) },
      requestStep: { inputSchema: z.object({ value: z.string() }), block: write("request-step", async ({ value }, ctx) => ctx.request.patchState({ step: value })) },
      addLicense: {
        inputSchema: z.object({ value: z.string() }),
        block: write("addLicense", async ({ value }, ctx) => {
          await ctx.resources.licenses.create(value, { name: value });
          return {};
        })
      },
      draft: {
        inputSchema: z.object({ value: z.string() }),
        block: write("draft", async ({ value }, ctx) => {
          await ctx.resources.drafts.create({ owner: ownerSegment(ctx.session.identity.userId), id: value }, { title: value });
          return {};
        })
      },
      bio: {
        inputSchema: z.object({ value: z.string() }),
        block: write("bio", async ({ value }, ctx) => {
          await ctx.resources.profile.patchState({ bio: value });
          return {};
        })
      },
      audit: {
        inputSchema: z.object({ value: z.string() }),
        block: write("audit", async ({ value }, ctx) => {
          await ctx.resources.audit.create(value, { n: 1 });
          return {};
        })
      },
      note: {
        inputSchema: z.object({ value: z.string() }),
        block: write("note", async ({ value }, ctx) => {
          await ctx.resources.ledger.create(value, { n: 1 });
          return {};
        })
      }
    }
  })() as unknown as FlowInstance;
}

async function run(bus: ChangeBus, actionName: string, value: string, sessionId = "s1") {
  const stores = { ...createInMemoryStores(), bus };
  const result = await runAction({
    orgId: ORG,
    flow: app(),
    actionName: actionName as never,
    input: { value } as never,
    userId: "alice",
    sessionId,
    stores,
    runtimeConfig: {}
  });
  if (result.error !== undefined) throw result.error;
  await tick();
  await tick();
  return result.requestId;
}

/** The notices of `kind` among `heard`. */
const ofKind = (heard: ChangeNotice[], kind: string) => heard.filter((n) => n.kind === kind);

describe("scope-state writes publish on their scope's topic", () => {
  it("publishes an org patch from a run with no stream, naming its request", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, orgTopic);
    const requestId = await run(bus, "orgPlan", "pro");
    expect(ofKind(heard, "state")).toEqual([{ topic: orgTopic, kind: "state", origin: { requestId } }]);
  });

  it("publishes user and session patches on their own topics, and request state on none", async () => {
    const bus = createInMemoryBus();
    const user = hear(bus, userTopic);
    const session = hear(bus, sessionTopic("s1"));
    const org = hear(bus, orgTopic);
    const themed = await run(bus, "userTheme", "dark");
    const topiced = await run(bus, "sessionTopic", "billing");
    await run(bus, "requestStep", "two");
    expect(ofKind(user, "state").map((n) => n.origin)).toEqual([{ requestId: themed }]);
    expect(ofKind(session, "state").map((n) => n.origin)).toEqual([{ requestId: topiced }]);
    expect(ofKind(org, "state")).toEqual([]);
  });
});

describe("resource writes publish on their scope's topic, narrowed to the resource", () => {
  it("publishes an org collection create from a run with no stream", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, orgTopic);
    const requestId = await run(bus, "addLicense", "ada");
    expect(ofKind(heard, "resource")).toEqual([
      { topic: { ...orgTopic, resource: "licenses/ada" }, kind: "resource", origin: { requestId } }
    ]);
  });

  it("publishes a resource with no client config when its scope declares a derived value", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, orgTopic);
    await run(bus, "audit", "a1");
    expect(ofKind(heard, "resource").map((n) => n.topic.resource)).toEqual(["audit/a1"]);
  });

  it("publishes a single resource a client can read, though it is neither live nor reactive", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, userTopic);
    const requestId = await run(bus, "bio", "hello");
    expect(ofKind(heard, "resource")).toEqual([
      { topic: { ...userTopic, resource: "profile" }, kind: "resource", origin: { requestId } }
    ]);
  });

  it("names no owner-private row on the org topic every member hears, and still wakes the scope", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, orgTopic);
    const requestId = await run(bus, "draft", "confidential-title");
    const resources = ofKind(heard, "resource");
    // An org member subscribed to the org topic learns nothing of Alice's key.
    expect(JSON.stringify(heard)).not.toContain("~alice");
    expect(JSON.stringify(heard)).not.toContain("confidential-title");
    // Every view of the scope, Alice's included, still wakes and re-reads.
    expect(resources).toEqual([{ topic: orgTopic, kind: "resource", origin: { requestId } }]);
  });

  it("publishes nothing for a resource no client can read", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, sessionTopic("s1"));
    await run(bus, "note", "n1");
    expect(ofKind(heard, "resource")).toEqual([]);
  });
});

describe("the client's resource routes publish the session's topic", () => {
  it("publishes a create, a content update and a delete from a browser, naming no request", async () => {
    const notes = defineResourceCollection({
      scope: "session",
      pattern: "notes/*",
      stateSchema: z.object({ title: z.string().default("") }),
      client: { content: { read: true, create: true, update: true, delete: true }, state: { read: true } }
    });
    const flow = defineFlow({
      kind: "notes-flow",
      actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", resources: { notes }, execute: () => "ok" }) } }
    })();
    const registry = createFlowRegistry();
    registry.register(flow);
    const bus = createInMemoryBus();
    const stores = { ...createInMemoryStores(), bus };
    const now = Date.now();
    await stores.session.set(
      "sess_1",
      { orgId: DEFAULT_ORG_ID, id: "sess_1", flowKind: "notes-flow", userId: "u1", state: {}, version: 0, createdAt: now, updatedAt: now, journal: [] },
      "any"
    );
    const heard = hear(bus, sessionTopic("sess_1"));
    const ctx = { registry, stores };

    const created = await handleCreateCollectionItem(
      new Request("http://x/sessions/sess_1/resources/notes", { method: "POST", body: JSON.stringify({ topic: "a" }) }),
      { kind: "create_collection_item", sessionId: "sess_1", ref: "notes" },
      ctx
    );
    await tick();
    const updated = await handleUpdateResourceContent(
      new Request("http://x/sessions/sess_1/resources/notes/a/content", { method: "PATCH", body: JSON.stringify({ content: "x" }) }),
      { kind: "update_resource_content", sessionId: "sess_1", ref: "notes", topic: "a" },
      ctx
    );
    await tick();
    const deleted = await handleDeleteCollectionItem(
      new Request("http://x/sessions/sess_1/resources/notes/a", { method: "DELETE" }),
      { kind: "delete_collection_item", sessionId: "sess_1", ref: "notes", topic: "a" },
      ctx
    );
    await tick();
    expect([created.status, updated.status, deleted.status]).toEqual([201, 200, 200]);
    const notice = { topic: { ...sessionTopic("sess_1"), resource: "notes/a" }, kind: "resource" };
    expect(ofKind(heard, "resource")).toEqual([notice, notice, notice]);
  });
});

describe("notices raised in one turn", () => {
  it("fold per request, so each writer's view skips only its own and hears the other's", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, orgTopic);
    publishScopeChange(bus, { scope: "org", id: ORG, tenantId: undefined, kind: "state", requestId: "r1" });
    publishScopeChange(bus, { scope: "org", id: ORG, tenantId: undefined, kind: "state", requestId: "r2" });
    publishScopeChange(bus, { scope: "org", id: ORG, tenantId: undefined, kind: "state", requestId: "r2" });
    await tick();
    expect(heard.map((n) => n.origin?.requestId)).toEqual(["r1", "r2"]);
  });
});
