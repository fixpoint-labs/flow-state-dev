import { describe, expect, it, vi } from "vitest";
import {
  createClient,
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

describe("client.sessions", () => {
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

    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });
    const result = await client.sessions.list({
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

  it("lists the client's own user's sessions unless it names another user", async () => {
    const fetcher = vi.fn<ClientFetch>(async () => createJsonResponse({ sessions: [] }));
    const client = createClient({ userId: "u 1", baseUrl: "", fetcher });

    await client.sessions.list();
    await client.sessions.list({ flowKind: "demo" });
    await client.sessions.list({ userId: "u2" });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/flows/sessions?userId=u+1",
      "/api/flows/sessions?flowKind=demo&userId=u+1",
      "/api/flows/sessions?userId=u2"
    ]);
  });

  it("sends a listing's state filter as one state.<field> parameter per field", async () => {
    const fetcher = vi.fn<ClientFetch>(async () => createJsonResponse({ sessions: [] }));
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });
    await client.sessions.list({ flowKind: "agent", userId: "devuser", state: { workerId: "researcher" } });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions?flowKind=agent&userId=devuser&state.workerId=researcher"
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

    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });
    const created = await client.flow("demo").createSession();

    expect(created.id).toBe("sess_1");

    await client.sessions.delete("sess_1");

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

    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    const session = await client.sessions.get("sess_1");
    expect(session.orgId).toBe("proj_1");

    const requests = await client.sessions.requests("sess_1", {
      status: "completed",
      limit: 10
    });
    expect(requests).toHaveLength(1);

    const snapshot = await client.sessions.state("sess_1");
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
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    await client.sessions.requests("sess_1", { includeItems: true });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/requests?include_items=true"
    );
  });

  it("asks for each request's action output only with includeResultOutput", async () => {
    // The list carries `result.error` and `hasOutput` either way; the output
    // itself is opt-in, so a caller that polls pays for it only on request.
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({
        requests: [{ ...REQUESTS[0], result: { output: { ok: false, error: "no" }, hasOutput: true } }]
      })
    );
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    const [listed] = await client.sessions.requests("sess_1", { includeItems: true, includeResultOutput: true });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/requests?include_items=true&include_result_output=true"
    );
    expect(listed?.result).toEqual({ output: { ok: false, error: "no" }, hasOutput: true });
  });

  it("lists debug suspensions with status filter and parses the response", async () => {
    const suspensions = [
      {
        suspensionId: "sus_1",
        requestId: "req_1",
        flowKind: "demo",
        actionName: "run",
        userId: "devuser",
        reason: "user_approval",
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
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    const result = await client.sessions.debug.listSuspensions("sess_1", {
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
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    await client.sessions.state("sess_1", {
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

describe("client.sessions.children", () => {
  const CHILD: ChildSessionSummary = {
    id: "dsx_9f3a",
    parentSessionId: "sess_1",
    createdAt: 1,
    updatedAt: 2,
    topic: "FIX-981",
    coordinate: "implementer",
    status: "active"
  };

  it("addresses the parent conversation and unwraps the response envelope", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ children: [CHILD] })
    );
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    const result = await client.sessions.children("sess_1");

    expect(result).toEqual([CHILD]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/children"
    );
  });

  it("passes paging options through as canonical query params", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ children: [] })
    );
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    await client.sessions.children("sess_1", { limit: 50, offset: 25 });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/children?limit=50&offset=25"
    );
  });

  it("reads back a row that carries no labels and no status (BP-030)", async () => {
    // A server that predates the labels, or a ChildSession that has not run
    // anything yet. Absent must stay absent — never an empty name, never a
    // defaulted status.
    const bare = {
      id: "dsx_bare",
      parentSessionId: "sess_1",
      createdAt: 1,
      updatedAt: 2
    };
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ children: [bare] })
    );
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    const [row] = await client.sessions.children("sess_1");

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
        children: [
          CHILD,
          { ...CHILD, id: "dsx_other", parentSessionId: "sess_2" }
        ]
      })
    );
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    const result = await client.sessions.children("sess_1");

    expect(result.map((row) => row.id)).toEqual(["dsx_9f3a"]);
  });

  it("warns in development when it drops a mismatched row", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({
        children: [
          { ...CHILD, id: "dsx_warn_child", parentSessionId: "sess_warn_other" }
        ]
      })
    );
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    await client.sessions.children("sess_warn_parent");

    expect(spy).toHaveBeenCalledTimes(1);
    const [message] = spy.mock.calls[0] ?? [];
    expect(message).toContain("sess_warn_parent");
    expect(message).toContain("dsx_warn_child");
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
          children: [
            { ...CHILD, id: "dsx_silent_child", parentSessionId: "sess_silent_other" }
          ]
        })
      );
      const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

      const result = await client.sessions.children("sess_silent_parent");

      expect(result).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      spy.mockRestore();
    }
  });

  it("rejects an empty parent session id", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse({ children: [] })
    );
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher });

    await expect(client.sessions.children("  ")).rejects.toMatchObject({
      name: "ClientHttpError",
      status: 0,
      message: "parentSessionId is required"
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
