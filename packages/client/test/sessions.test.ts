import { describe, expect, it, vi } from "vitest";
import {
  createSessionClient,
  type ClientFetch,
  type SessionDetail,
  type SessionRequestSummary,
  type SessionStateSnapshotResponse,
  type SessionSummary,
  type ChildSessionSummary
} from "../src";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

const SESSION: SessionDetail = {
  id: "sess_1",
  flowKind: "demo",
  userId: "devuser",
  createdAt: 1,
  updatedAt: 2,
  orgId: "proj_1"
};

const REQUESTS: SessionRequestSummary[] = [
  {
    id: "req_1",
    flowKind: "demo",
    actionName: "run",
    userId: "devuser",
    sessionId: "sess_1",
    status: "completed",
    createdAt: 1,
    updatedAt: 2
  }
];

const SNAPSHOT: SessionStateSnapshotResponse = {
  sessionId: "sess_1",
  flowKind: "demo",
  clientData: {}
};

describe("createSessionClient", () => {
  it("lists sessions using canonical query params", async () => {
    const sessions: SessionSummary[] = [
      {
        id: "sess_1",
        flowKind: "demo",
        userId: "devuser",
        createdAt: 1,
        updatedAt: 2
      }
    ];

    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ sessions })
    );

    const client = createSessionClient({ fetcher });
    const result = await client.listSessions({
      flowKind: "demo",
      userId: "devuser",
      limit: 20,
      offset: 5
    });

    expect(result).toEqual(sessions);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions?flowKind=demo&userId=devuser&limit=20&offset=5"
    );
  });

  it("creates and deletes sessions", async () => {
    const fetcher = vi
      .fn<ClientFetch>()
      .mockImplementationOnce(async (_url, init) => {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          userId: "devuser"
        });
        return createJsonResponse({ session: SESSION }, 201);
      })
      .mockImplementationOnce(async (_url, init) => {
        expect(init?.method).toBe("DELETE");
        return createJsonResponse(undefined, 204);
      });

    const client = createSessionClient({ fetcher });
    const created = await client.createSession({
      flowKind: "demo",
      userId: "devuser"
    });

    expect(created.id).toBe("sess_1");

    await client.deleteSession("sess_1");

    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/flows/demo/sessions");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/flows/sessions/sess_1");
  });

  it("reads session detail, request list, and state snapshot", async () => {
    const fetcher = vi
      .fn<ClientFetch>()
      .mockImplementationOnce(async () =>
        createJsonResponse({ session: SESSION })
      )
      .mockImplementationOnce(async () =>
        createJsonResponse({ requests: REQUESTS })
      )
      .mockImplementationOnce(async () => createJsonResponse(SNAPSHOT));

    const client = createSessionClient({ fetcher });

    const session = await client.getSession("sess_1");
    expect(session.orgId).toBe("proj_1");

    const requests = await client.listSessionRequests("sess_1", {
      status: "completed",
      limit: 10
    });
    expect(requests).toHaveLength(1);

    const snapshot = await client.getSessionState("sess_1");
    expect(snapshot.flowKind).toBe("demo");

    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/flows/sessions/sess_1");
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/api/flows/sessions/sess_1/requests?status=completed&limit=10"
    );
    expect(fetcher.mock.calls[2]?.[0]).toBe("/api/flows/sessions/sess_1/state");
  });

  it("maps listSessionRequests includeItems to the include_items query param", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ requests: REQUESTS })
    );
    const client = createSessionClient({ fetcher });

    await client.listSessionRequests("sess_1", { includeItems: true });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/requests?include_items=true"
    );
  });

  it("lists debug suspensions with status filter and parses the response", async () => {
    const suspensions = [
      {
        suspensionId: "sus_1",
        requestId: "req_1",
        flowKind: "demo",
        actionName: "run",
        userId: "devuser",
        reason: "human_approval",
        message: "Approve?",
        status: "pending",
        blockInstanceId: "b1",
        stepIndex: 0,
        createdAt: 1
      }
    ];
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ suspensions })
    );
    const client = createSessionClient({ fetcher });

    const result = await client.debug.listSuspensions("sess_1", {
      status: "pending"
    });

    expect(result.suspensions).toHaveLength(1);
    expect(result.suspensions[0]?.suspensionId).toBe("sus_1");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/debug/suspensions?status=pending"
    );
  });

  it("supports snapshot query options for items and clientData filters", async () => {
    const fetcher = vi.fn<ClientFetch>(async () => createJsonResponse(SNAPSHOT));
    const client = createSessionClient({ fetcher });

    await client.getSessionState("sess_1", {
      includeItems: true,
      clientData: ["session.artifactsList", "user.topics"],
      itemTypes: ["message"],
      offset: 100,
      limit: 50
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/state?include_items=true&clientData=session.artifactsList%2Cuser.topics&item_types=message&offset=100&limit=50"
    );
  });
});

describe("createSessionClient.listChildSessions", () => {
  const WORKSTREAM: ChildSessionSummary = {
    id: "ws_9f3a",
    parentSessionId: "sess_1",
    createdAt: 1,
    updatedAt: 2,
    topic: "FIX-981",
    coordinate: "implementer",
    status: "active"
  };

  it("addresses the parent conversation and unwraps the response envelope", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ childSessions: [WORKSTREAM] })
    );
    const client = createSessionClient({ fetcher });

    const result = await client.listChildSessions("sess_1");

    expect(result).toEqual([WORKSTREAM]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/childSessions"
    );
  });

  it("passes paging options through as canonical query params", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ childSessions: [] })
    );
    const client = createSessionClient({ fetcher });

    await client.listChildSessions("sess_1", { limit: 50, offset: 25 });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/childSessions?limit=50&offset=25"
    );
  });

  it("reads back a row that carries no labels and no status (BP-030)", async () => {
    // A server that predates the labels, or a ChildSession that has not run
    // anything yet. Absent must stay absent — never an empty name, never a
    // defaulted status.
    const bare = {
      id: "ws_bare",
      parentSessionId: "sess_1",
      createdAt: 1,
      updatedAt: 2
    };
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ childSessions: [bare] })
    );
    const client = createSessionClient({ fetcher });

    const [row] = await client.listChildSessions("sess_1");

    expect(row).toEqual(bare);
    expect(row?.topic).toBeUndefined();
    expect(row?.coordinate).toBeUndefined();
    expect(row?.status).toBeUndefined();
  });

  it("drops a row the server did not claim is a child of the requested parent", async () => {
    // The client's only filtering, and it is a compatibility check rather than
    // a visibility one: what a caller may see is the server's call, but
    // relabelling someone else's row as this conversation's background work
    // would be the client inventing a meaning.
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({
        childSessions: [
          WORKSTREAM,
          { ...WORKSTREAM, id: "ws_other", parentSessionId: "sess_2" }
        ]
      })
    );
    const client = createSessionClient({ fetcher });

    const result = await client.listChildSessions("sess_1");

    expect(result.map((row) => row.id)).toEqual(["ws_9f3a"]);
  });

  it("warns in development when it drops a mismatched row", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({
        childSessions: [
          { ...WORKSTREAM, id: "ws_warn_child", parentSessionId: "sess_warn_other" }
        ]
      })
    );
    const client = createSessionClient({ fetcher });

    await client.listChildSessions("sess_warn_parent");

    expect(spy).toHaveBeenCalledTimes(1);
    const [message] = spy.mock.calls[0] ?? [];
    expect(message).toContain("sess_warn_parent");
    expect(message).toContain("ws_warn_child");
    expect(message).toContain("sess_warn_other");

    spy.mockRestore();
  });

  it("stays silent on a mismatch when no process global is present (production browser)", async () => {
    // The default a bundler ships to a production browser: no `process` at
    // all, not `NODE_ENV === "production"`. The guard must fail closed here,
    // not treat the absence as development.
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("process", undefined);
    try {
      const fetcher = vi.fn<ClientFetch>(async () =>
        createJsonResponse({
          childSessions: [
            { ...WORKSTREAM, id: "ws_silent_child", parentSessionId: "sess_silent_other" }
          ]
        })
      );
      const client = createSessionClient({ fetcher });

      const result = await client.listChildSessions("sess_silent_parent");

      expect(result).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      spy.mockRestore();
    }
  });

  it("rejects an empty parent session id", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ childSessions: [] })
    );
    const client = createSessionClient({ fetcher });

    await expect(client.listChildSessions("  ")).rejects.toThrow(
      /non-empty parentSessionId/
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
