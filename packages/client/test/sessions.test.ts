import { describe, expect, it, vi } from "vitest";
import {
  createSessionClient,
  type ClientFetch,
  type SessionDetail,
  type SessionRequestSummary,
  type SessionStateSnapshotResponse,
  type SessionSummary
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
