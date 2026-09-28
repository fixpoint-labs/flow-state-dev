/**
 * Tests for mutable session metadata: title, description, tags, and setMetadata.
 */
import { isDeepStrictEqual } from "node:util";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  parseFlowRoute
} from "../src";
import type { SessionRecord, StoreRegistry } from "../src";

function makeFlow(kind: string): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block: handler<{ value: string }, { ok: boolean }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    }
  })({ id: kind });
}

function makeMetadataFlow(kind: string): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      setTitle: {
        inputSchema: z.object({ title: z.string() }),
        block: handler<{ title: string }, { ok: boolean }>({
          name: `${kind}-setTitle`,
          async execute(input, ctx) {
            await ctx.session.setMetadata({ title: input.title });
            return { ok: true };
          }
        })
      },
      setAll: {
        inputSchema: z.object({
          title: z.string(),
          description: z.string(),
          tags: z.array(z.string())
        }),
        block: handler<{ title: string; description: string; tags: string[] }, { ok: boolean }>({
          name: `${kind}-setAll`,
          async execute(input, ctx) {
            await ctx.session.setMetadata({
              title: input.title,
              description: input.description,
              tags: input.tags,
              metadata: { custom: "value" }
            });
            return { ok: true };
          }
        })
      }
    }
  })({ id: kind });
}

function createRouter() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const flow = makeFlow("demo");
  const metaFlow = makeMetadataFlow("meta");
  registry.register(flow);
  registry.register(metaFlow);

  const router = createFlowApiRouter({ registry, stores });
  return { router, stores };
}

describe("parseFlowRoute — PATCH session metadata", () => {
  it("parses PATCH /sessions/:id/metadata", () => {
    expect(parseFlowRoute("PATCH", ["sessions", "sess_1", "metadata"])).toEqual({
      kind: "patch_session_metadata",
      sessionId: "sess_1"
    });
  });

  it("returns not_found for PATCH without metadata segment", () => {
    expect(parseFlowRoute("PATCH", ["sessions", "sess_1"])).toEqual({
      kind: "not_found"
    });
  });
});

describe("session creation with title, description, tags", () => {
  it("creates a session with first-class metadata fields", async () => {
    const { router } = createRouter();

    const response = await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user_1",
          title: "My Session",
          description: "A test session",
          tags: ["test", "demo"]
        })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      session: {
        title?: string;
        description?: string;
        tags?: string[];
      };
    };
    expect(body.session.title).toBe("My Session");
    expect(body.session.description).toBe("A test session");
    expect(body.session.tags).toEqual(["test", "demo"]);
  });

  it("creates a session without optional metadata fields", async () => {
    const { router } = createRouter();

    const response = await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1" })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      session: {
        title?: string;
        description?: string;
        tags?: string[];
      };
    };
    expect(body.session.title).toBeUndefined();
    expect(body.session.description).toBeUndefined();
    expect(body.session.tags).toBeUndefined();
  });
});

describe("PATCH /sessions/:id/metadata", () => {
  it("updates title via PATCH", async () => {
    const { router } = createRouter();

    // Create session first
    await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_patch" })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    // PATCH metadata
    const patchResponse = await router.PATCH(
      new Request("http://localhost/api/flows/sessions/sess_patch/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated Title" })
      }),
      { params: { path: ["sessions", "sess_patch", "metadata"] } }
    );

    expect(patchResponse.status).toBe(200);
    const body = (await patchResponse.json()) as {
      session: {
        title?: string;
        description?: string;
        tags?: string[];
        metadata?: Record<string, unknown>;
      };
    };
    expect(body.session.title).toBe("Updated Title");
  });

  it("merges metadata fields (last-write-wins)", async () => {
    const { router } = createRouter();

    // Create session with initial metadata
    await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user_1",
          sessionId: "sess_merge",
          metadata: { existing: "value", overwrite: "old" }
        })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    // PATCH with partial metadata
    const patchResponse = await router.PATCH(
      new Request("http://localhost/api/flows/sessions/sess_merge/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "New Title",
          tags: ["a", "b"],
          metadata: { overwrite: "new", added: "field" }
        })
      }),
      { params: { path: ["sessions", "sess_merge", "metadata"] } }
    );

    expect(patchResponse.status).toBe(200);
    const body = (await patchResponse.json()) as {
      session: {
        title?: string;
        tags?: string[];
        metadata?: Record<string, unknown>;
      };
    };
    expect(body.session.title).toBe("New Title");
    expect(body.session.tags).toEqual(["a", "b"]);
    expect(body.session.metadata).toEqual({
      existing: "value",
      overwrite: "new",
      added: "field"
    });
  });

  it("returns 404 for unknown session", async () => {
    const { router } = createRouter();

    const patchResponse = await router.PATCH(
      new Request("http://localhost/api/flows/sessions/unknown_sess/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "nope" })
      }),
      { params: { path: ["sessions", "unknown_sess", "metadata"] } }
    );

    expect(patchResponse.status).toBe(404);
  });

  it("persists metadata changes to the store", async () => {
    const { router, stores } = createRouter();

    await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_store" })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    await router.PATCH(
      new Request("http://localhost/api/flows/sessions/sess_store/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Persisted",
          description: "Stored",
          tags: ["stored"]
        })
      }),
      { params: { path: ["sessions", "sess_store", "metadata"] } }
    );

    const record = await stores.session.get("sess_store");
    expect(record?.title).toBe("Persisted");
    expect(record?.description).toBe("Stored");
    expect(record?.tags).toEqual(["stored"]);
  });
});

describe("ctx.session.setMetadata during execution", () => {
  it("updates session metadata and emits SSE event", async () => {
    const { router, stores } = createRouter();

    // Create session
    await router.POST(
      new Request("http://localhost/api/flows/meta/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_exec" })
      }),
      { params: { path: ["meta", "sessions"] } }
    );

    // Execute action that calls setMetadata (returns 202 for SSE stream)
    const execResponse = await router.POST(
      new Request("http://localhost/api/flows/meta/sess_exec/actions/setTitle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { title: "Runtime Title" },
          userId: "user_1",
          sessionId: "sess_exec"
        })
      }),
      { params: { path: ["meta", "sess_exec", "actions", "setTitle"] } }
    );

    expect(execResponse.status).toBe(202);

    // Consume response and allow async execution to complete
    await execResponse.json();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the session record was updated in the store
    const record = await stores.session.get("sess_exec");
    expect(record?.title).toBe("Runtime Title");
  });

  it("updates all metadata fields via setMetadata", async () => {
    const { router, stores } = createRouter();

    // Create session
    await router.POST(
      new Request("http://localhost/api/flows/meta/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_all" })
      }),
      { params: { path: ["meta", "sessions"] } }
    );

    // Execute action that calls setMetadata with all fields
    const execResponse = await router.POST(
      new Request("http://localhost/api/flows/meta/sess_all/actions/setAll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            title: "Full Title",
            description: "Full Description",
            tags: ["tag1", "tag2"]
          },
          userId: "user_1",
          sessionId: "sess_all"
        })
      }),
      { params: { path: ["meta", "sess_all", "actions", "setAll"] } }
    );

    // Consume the SSE stream to allow execution to complete
    await execResponse.text();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const record = await stores.session.get("sess_all");
    expect(record?.title).toBe("Full Title");
    expect(record?.description).toBe("Full Description");
    expect(record?.tags).toEqual(["tag1", "tag2"]);
    expect(record?.metadata).toEqual({ custom: "value" });
  });
});

// ---------------------------------------------------------------------------
// An edit and another write to the same session record, at once
// ---------------------------------------------------------------------------

/** A flow that delivers a run into an existing session by its id. */
function deliveryFlow(kind: string): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      deliver: {
        block: dispatcher({
          name: `${kind}-deliver`,
          action: "work",
          inputSchema: z.object({ to: z.string() }),
          session: { id: (input: { to: string }) => input.to },
          payload: () => ({})
        })
      }
    },
    internal: { actions: { work: { block: handler({ name: `${kind}-work`, execute: () => ({}) }) } } }
  })({ id: kind });
}

async function keepSession(stores: StoreRegistry, id: string, fields: Partial<SessionRecord> = {}): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    id,
    {
      orgId: DEFAULT_ORG_ID,
      id,
      flowKind: "relay",
      userId: "alice",
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
      ...fields
    },
    "any"
  );
}

function patchMetadata(router: ReturnType<typeof createFlowApiRouter>, id: string, body: Record<string, unknown>) {
  return router.PATCH(
    new Request(`http://localhost/api/flows/sessions/${id}/metadata`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: { path: ["sessions", id, "metadata"] } }
  );
}

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`never: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("an edit and another write to one session at once", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A run delivered into an existing child moves the child's update time when
  // it is accepted, so a live view of the parent sees it. That write must not
  // put back a title the child was given after the child was read for it.
  it("keeps a title edited while a run delivered into the child is accepted", async () => {
    const registry = createFlowRegistry();
    registry.register(deliveryFlow("relay"));
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    await keepSession(stores, "parent");
    await keepSession(stores, "seat", { parentSessionId: "parent", title: "Seat" });

    const set = stores.session.set.bind(stores.session);
    const get = stores.session.get.bind(stores.session);
    let renamed = false;
    vi.spyOn(stores.session, "set").mockImplementation(async (id, value, expected) => {
      const stored = renamed || id !== "seat" ? undefined : await get(id);
      // The write that moves only the child's update time.
      const touch = { ...value, updatedAt: 0, version: 0 };
      if (stored !== undefined && isDeepStrictEqual(touch, { ...stored, updatedAt: 0, version: 0 })) {
        renamed = true;
        expect((await patchMetadata(router, "seat", { title: "Renamed" })).status).toBe(200);
      }
      return set(id, value, expected);
    });

    const res = await router.POST(
      new Request("http://localhost/api/flows/relay/parent/actions/deliver", {
        method: "POST",
        body: JSON.stringify({ userId: "alice", input: { to: "seat" } })
      }),
      { params: { path: ["relay", "parent", "actions", "deliver"] } }
    );
    expect(res.status).toBe(202);
    await until(() => renamed, "the run moved the child's update time");
    await until(
      async () => (await stores.request.list({ sessionId: "seat" })).every((r) => r.status !== "in_progress"),
      "the delivered run finished"
    );

    expect((await get("seat"))?.title).toBe("Renamed");
  });

  // A write of a session record names the version it writes. One that kept
  // the version it read would let a writer holding that older copy put it back.
  it("advances the child's version when a delivered run moves its update time", async () => {
    const registry = createFlowRegistry();
    registry.register(deliveryFlow("relay"));
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    await keepSession(stores, "parent");
    await keepSession(stores, "seat", { parentSessionId: "parent", updatedAt: Date.now() - 60_000 });
    const before = (await stores.session.get("seat"))!;

    const res = await router.POST(
      new Request("http://localhost/api/flows/relay/parent/actions/deliver", {
        method: "POST",
        body: JSON.stringify({ userId: "alice", input: { to: "seat" } })
      }),
      { params: { path: ["relay", "parent", "actions", "deliver"] } }
    );
    expect(res.status).toBe(202);
    await until(async () => (await stores.session.get("seat"))!.updatedAt > before.updatedAt, "the child moved");
    await until(
      async () => (await stores.request.list({ sessionId: "seat" })).every((r) => r.status !== "in_progress"),
      "the delivered run finished"
    );

    expect((await stores.session.get("seat"))!.version).toBeGreaterThan(before.version);
  });

  it("keeps a change another write made while the edit was being applied", async () => {
    const { router, stores } = createRouter();
    await keepSession(stores, "sess_race", { flowKind: "demo" });

    const set = stores.session.set.bind(stores.session);
    const get = stores.session.get.bind(stores.session);
    let raced = false;
    vi.spyOn(stores.session, "set").mockImplementation(async (id, value, expected) => {
      if (!raced && id === "sess_race" && value.title === "Mine") {
        raced = true;
        const stored = (await get(id))!;
        const theirs = { ...stored, tags: ["theirs"], version: stored.version + 1, updatedAt: Date.now() };
        await set(id, theirs, stored.version);
      }
      return set(id, value, expected);
    });

    expect((await patchMetadata(router, "sess_race", { title: "Mine" })).status).toBe(200);
    expect(raced).toBe(true);
    const record = await get("sess_race");
    expect(record?.title).toBe("Mine");
    expect(record?.tags).toEqual(["theirs"]);
  });
});
