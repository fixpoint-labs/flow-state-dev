/**
 * The session routes answer with a session as a client may see it.
 *
 * Scope state is private by default: a client sees a state field only when the
 * flow names it in `session.client.expose`, or declares it readonly (the
 * session's identity, which the listing already filters on). The session read, the listing, and
 * the create and metadata-edit responses all carry the session record, so each
 * is held to that rule here. The record's journal and its stored resource
 * state are server-side too, and never leave on these routes.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";
import type { SessionRecord, StoreRegistry } from "../src";

const SECRET = "server-only-routing-table";
const JOURNAL_SECRET = "journal-note-for-the-server";
const RESOURCE_SECRET = "stored-resource-state";

function makeFlow(kind: string, client?: { expose: Array<"visible" | "secret"> }): FlowInstance {
  return defineFlow({
    kind,
    session: {
      stateSchema: z.object({
        visible: z.string().default(""),
        secret: z.string().default("")
      }),
      ...(client === undefined ? {} : { client })
    },
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler<Record<string, never>, { ok: boolean }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    }
  })({ id: kind });
}

function setup() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(makeFlow("projected", { expose: ["visible"] }));
  registry.register(makeFlow("private"));
  const router = createFlowApiRouter({ registry, stores });
  return { router, stores };
}

type Router = ReturnType<typeof setup>["router"];

async function create(router: Router, flowKind: string, sessionId: string): Promise<Response> {
  return await router.POST(
    new Request(`http://localhost/api/flows/${flowKind}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user_1",
        sessionId,
        title: "Visible title",
        metadata: { note: "caller-written" },
        state: { visible: "shown", secret: SECRET }
      })
    }),
    { params: { path: [flowKind, "sessions"] } }
  );
}

/** What a run leaves on the record: a journal line and stored resource state. */
async function addServerSideHistory(stores: StoreRegistry, sessionId: string): Promise<void> {
  const current = (await stores.session.get(sessionId)) as SessionRecord;
  const written = await stores.session.set(
    sessionId,
    {
      ...current,
      journal: [{ id: "j1", ts: 1, text: JOURNAL_SECRET }],
      resources: { ledger: { value: RESOURCE_SECRET } },
      version: current.version + 1
    },
    current.version
  );
  expect(written.ok).toBe(true);
}

async function read(router: Router, sessionId: string) {
  const response = await router.GET(new Request(`http://localhost/api/flows/sessions/${sessionId}`), {
    params: { path: ["sessions", sessionId] }
  });
  return { status: response.status, text: await response.text() };
}

function expectNoServerOnlyData(text: string): void {
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(JOURNAL_SECRET);
  expect(text).not.toContain(RESOURCE_SECRET);
}

describe("session routes send only what the flow exposes", () => {
  it("a session read carries exposed state and no unexposed field, journal or stored resources", async () => {
    const { router, stores } = setup();
    expect((await create(router, "projected", "sess_read")).status).toBe(201);
    await addServerSideHistory(stores, "sess_read");

    const { status, text } = await read(router, "sess_read");

    expect(status).toBe(200);
    expectNoServerOnlyData(text);
    const session = (JSON.parse(text) as { session: Record<string, unknown> }).session;
    expect(session.state).toEqual({ visible: "shown" });
    expect(session).not.toHaveProperty("journal");
    expect(session).not.toHaveProperty("resources");
    // The envelope a client uses is unchanged.
    expect(session).toMatchObject({
      id: "sess_read",
      flowKind: "projected",
      flowId: "projected",
      userId: "user_1",
      title: "Visible title",
      metadata: { note: "caller-written" }
    });
  });

  it("a flow that exposes nothing sends an empty state: private is the default", async () => {
    const { router } = setup();
    expect((await create(router, "private", "sess_private")).status).toBe(201);

    const { status, text } = await read(router, "sess_private");

    expect(status).toBe(200);
    expectNoServerOnlyData(text);
    expect((JSON.parse(text) as { session: { state: unknown } }).session.state).toEqual({});
  });

  it("a session whose owner is not registered here sends no state at all", async () => {
    const { router, stores } = setup();
    expect((await create(router, "projected", "sess_orphan")).status).toBe(201);
    const current = (await stores.session.get("sess_orphan")) as SessionRecord;
    // Owned by an instance this process does not run: there is no `expose` to
    // honour, so nothing is exposed.
    await stores.session.set(
      "sess_orphan",
      { ...current, flowId: "gone", version: current.version + 1 },
      current.version
    );

    const { status, text } = await read(router, "sess_orphan");

    expect(status).toBe(200);
    expectNoServerOnlyData(text);
    expect(text).not.toContain("shown");
  });

  it("a readonly field is visible: it is the session's identity, already a listing filter", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(
      defineFlow({
        kind: "bound",
        session: {
          stateSchema: z.object({ projectId: z.string().readonly(), secret: z.string().default("") })
        },
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler<Record<string, never>, { ok: boolean }>({ name: "bound-run", execute: () => ({ ok: true }) })
          }
        }
      })({ id: "bound" })
    );
    const router = createFlowApiRouter({ registry, stores });
    const created = await router.POST(
      new Request("http://localhost/api/flows/bound/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_bound", state: { projectId: "q3", secret: SECRET } })
      }),
      { params: { path: ["bound", "sessions"] } }
    );
    expect(created.status).toBe(201);

    const { text } = await read(router, "sess_bound");

    expectNoServerOnlyData(text);
    expect((JSON.parse(text) as { session: { state: unknown } }).session.state).toEqual({ projectId: "q3" });
  });

  it("the session listing projects every row the same way", async () => {
    const { router, stores } = setup();
    await create(router, "projected", "sess_list_a");
    await create(router, "private", "sess_list_b");
    await addServerSideHistory(stores, "sess_list_a");

    const response = await router.GET(new Request("http://localhost/api/flows/sessions?userId=user_1"), {
      params: { path: ["sessions"] }
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expectNoServerOnlyData(text);
    const rows = (JSON.parse(text) as { sessions: Array<Record<string, unknown>> }).sessions;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("sess_list_a")?.state).toEqual({ visible: "shown" });
    expect(byId.get("sess_list_b")?.state).toEqual({});
  });

  it("the create response does not echo unexposed state back", async () => {
    const { router } = setup();

    const response = await create(router, "projected", "sess_create");
    const text = await response.text();

    expect(response.status).toBe(201);
    expectNoServerOnlyData(text);
    expect((JSON.parse(text) as { session: { state: unknown } }).session.state).toEqual({ visible: "shown" });
  });

  it("the metadata edit response is projected too", async () => {
    const { router, stores } = setup();
    await create(router, "projected", "sess_patch");
    await addServerSideHistory(stores, "sess_patch");

    const response = await router.PATCH(
      new Request("http://localhost/api/flows/sessions/sess_patch/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed" })
      }),
      { params: { path: ["sessions", "sess_patch", "metadata"] } }
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expectNoServerOnlyData(text);
    expect(JSON.parse(text)).toMatchObject({ session: { title: "Renamed", state: { visible: "shown" } } });
    // The edit wrote over the full record: projection is on the wire only.
    const stored = (await stores.session.get("sess_patch")) as SessionRecord;
    expect(stored.state).toEqual({ visible: "shown", secret: SECRET });
    expect(stored.journal).toHaveLength(1);
  });
});
